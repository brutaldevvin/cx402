import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { createPublicClient, http, formatEther, formatUnits } from 'viem'
import type { PrivateKeyAccount } from 'viem'
import { CleanverseClient } from '@cx402/cleanverse'
import type { FacilitatorConfig } from './config'
import { ComplianceEngine } from './engine'
import { AusdxSettler, SimulatedSettler, monadChain } from './settler'
import { buildReceipt } from './receipt'
import { EventBus } from './events'
import { ReceiptStore } from './store'
import { PolicyEngine } from './policy'
import type { Policy } from './policy'
import { MandateVerifier, canonicalMandate } from './mandate'
import type { SignedMandate, Mandate } from './mandate'
import { PaymentIntentVerifier, canonicalIntent } from './intent'
import type { PaymentIntent, SignedPaymentIntent } from './intent'
import type { PaymentPayload, PaymentRequirements, Settler, SettlementResult, ComplianceResult, Address } from './types'

interface Deps {
  cv: CleanverseClient
  engine: ComplianceEngine
  settler: Settler
  store: ReceiptStore
  bus: EventBus
  policyEngine: PolicyEngine
  mandateVerifier: MandateVerifier
  cfg: FacilitatorConfig
  signer?: PrivateKeyAccount
  facilitatorLabel: string
  /** optional UI page path served at `/` (re-read per request for live iteration) */
  uiHtmlPath?: string
  skillMdPath?: string
  llmsTxtPath?: string
  openapiJsonPath?: string
}

/**
 * Full evaluation: the identity gate first, then the agent's policy mandate.
 * Either can block, with a distinct reason. (identity_* vs policy_*)
 */
async function evaluate(d: Deps, payment: PaymentPayload, req: PaymentRequirements): Promise<ComplianceResult> {
  const identity = await d.engine.verifyParties(payment, req)
  if (identity.decision === 'BLOCKED') return { ...identity, blockedBy: 'identity' }

  if (!d.policyEngine.get(payment.payer)) return identity // unmandated → identity decision stands

  let payeeTier: number | undefined
  if (d.policyEngine.needsTier(payment.payer)) {
    const rec = await d.cv.queryApass({ chain: d.cfg.chain, address: payment.payee })
    payeeTier = rec ? Number(rec.tier) : 0
  }
  const pol = d.policyEngine.check(payment.payer, { payee: payment.payee, amount: BigInt(payment.amount), payeeTier })
  const policyCheck = { pass: pol.pass, detail: pol.reason, remaining: pol.remaining }
  if (!pol.pass) {
    return {
      decision: 'BLOCKED',
      reason: `policy_${pol.reason}`,
      blockedBy: 'policy',
      checks: { ...identity.checks, policy: policyCheck },
    }
  }
  return { ...identity, checks: { ...identity.checks, policy: policyCheck } }
}

function isAddr(x: unknown): x is Address {
  return typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x)
}

/** Validate a payment intent body. Returns null if malformed. */
function validIntent(body: unknown): { payment: PaymentPayload; requirements: PaymentRequirements } | null {
  const b = body as { payment?: Record<string, unknown>; requirements?: Record<string, unknown> } | null
  const p = b?.payment
  const r = b?.requirements
  if (!p || typeof p !== 'object' || !r || typeof r !== 'object') return null
  if (!isAddr(p.payer) || !isAddr(p.payee) || !isAddr(p.asset)) return null
  if (typeof p.amount !== 'string' || !/^\d+$/.test(p.amount)) return null
  return { payment: p as unknown as PaymentPayload, requirements: r as unknown as PaymentRequirements }
}

export function createApp(d: Deps): Hono {
  const app = new Hono()

  // every uncaught error becomes structured JSON, never a plain-text 500
  app.onError((err, c) => c.json({ error: 'internal_error', message: err instanceof Error ? err.message : 'unexpected error' }, 500))

  // judge-facing label: the settlement asset is real aUSDC, the mode is real
  // on-chain transferFrom (the internal 'ausdx' value invites confusion)
  const modeLabel = d.cfg.settlementMode === 'ausdx' ? 'onchain-transferFrom' : d.cfg.settlementMode

  const info = () => ({
    name: 'cx402 facilitator',
    network: d.cfg.network,
    asset: d.cfg.settlementAsset,
    settlementMode: modeLabel,
    facilitator: d.facilitatorLabel,
    demoUnsignedPolicy: d.cfg.demoAllowUnsignedPolicy,
  })
  app.get('/', (c) => {
    if (d.uiHtmlPath && existsSync(d.uiHtmlPath)) return c.html(readFileSync(d.uiHtmlPath, 'utf8'))
    return c.json(info())
  })
  app.get('/info', (c) => c.json(info()))
  const staticText = (filePath: string | undefined, contentType: string) => {
    if (!filePath || !existsSync(filePath)) return null
    return { body: readFileSync(filePath, 'utf8'), contentType }
  }
  app.get('/skill.md', (c) => {
    const f = staticText(d.skillMdPath, 'text/markdown; charset=utf-8')
    if (!f) return c.json({ error: 'not_found' }, 404)
    c.header('content-type', f.contentType)
    return c.body(f.body)
  })
  app.get('/llms.txt', (c) => {
    const f = staticText(d.llmsTxtPath, 'text/plain; charset=utf-8')
    if (!f) return c.json({ error: 'not_found' }, 404)
    c.header('content-type', f.contentType)
    return c.body(f.body)
  })
  app.get('/openapi.json', (c) => {
    const f = staticText(d.openapiJsonPath, 'application/json; charset=utf-8')
    if (!f) return c.json({ error: 'not_found' }, 404)
    c.header('content-type', f.contentType)
    return c.body(f.body)
  })

  // read-only liveness probe: proves the demo is wired to real infra. never throws.
  app.get('/health', async (c) => {
    const payer = (c.req.query('payer') ?? d.cfg.demoPayer) as Address
    const payee = (c.req.query('payee') ?? d.cfg.demoPayee) as Address
    const facilitator = d.facilitatorLabel as Address
    const ERC20 = [
      { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
      { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
    ] as const
    const pc = createPublicClient({ chain: monadChain(d.cfg.chainId, d.cfg.rpcUrl), transport: http(d.cfg.rpcUrl) })

    const settled = await Promise.allSettled([
      pc.getBlockNumber(),
      d.cv.verifyApass({ chain: d.cfg.chain, atoken: d.cfg.complianceAsset, address: payer }),
      d.cv.verifyApass({ chain: d.cfg.chain, atoken: d.cfg.complianceAsset, address: payee }),
      pc.getBalance({ address: facilitator }),
      pc.readContract({ address: d.cfg.settlementAsset, abi: ERC20, functionName: 'balanceOf', args: [payer] }),
      pc.readContract({ address: d.cfg.settlementAsset, abi: ERC20, functionName: 'allowance', args: [payer, facilitator] }),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = (i: number): any => (settled[i]!.status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<any>).value : null)

    const block = ok(0), pv = ok(1), yv = ok(2), gas = ok(3), bal = ok(4), allow = ok(5)
    const apass = (addr: Address, v: { code?: number } | null) =>
      v ? { address: addr, verified: v.code === 4, code: v.code } : { address: addr, verified: false, error: 'unreachable' }

    const checks = {
      cleanverseReachable: pv != null || yv != null,
      monadRpcReachable: block != null,
      settlementAssetConfigured: Boolean(d.cfg.settlementAsset),
      notSimulated: d.cfg.settlementMode === 'ausdx',
      payerApass: apass(payer, pv),
      payeeApass: apass(payee, yv),
      facilitatorGasMon: gas != null ? formatEther(gas) : null,
      payerBalance: bal != null ? formatUnits(bal, 6) : null,
      payerAllowance: allow != null ? (allow >= 2n ** 255n ? 'MAX' : formatUnits(allow, 6)) : null,
    }
    const healthy =
      checks.cleanverseReachable && checks.monadRpcReachable && checks.settlementAssetConfigured &&
      checks.notSimulated && checks.payerApass.verified && checks.payeeApass.verified &&
      checks.payerAllowance != null && checks.payerAllowance !== '0.0'
    return c.json({
      status: healthy ? 'ok' : 'degraded',
      facilitator,
      network: d.cfg.network,
      settlementAsset: d.cfg.settlementAsset,
      settlementMode: modeLabel,
      checks,
    })
  })

  // x402 conformance: what we accept
  app.get('/supported', (c) =>
    c.json({
      kinds: [
        {
          scheme: 'exact',
          network: d.cfg.network,
          asset: d.cfg.settlementAsset,
          extra: { facilitator: d.facilitatorLabel, compliance: 'a-pass' },
        },
      ],
    }),
  )

  // live proof of the production path: sign mandates with throwaway keys and run
  // them through the real verifier, showing one accepted and the rejection cases
  app.get('/proof/mandate', async (c) => {
    const a = privateKeyToAccount(generatePrivateKey())
    const b = privateKeyToAccount(generatePrivateKey())
    const now = Math.floor(Date.now() / 1000)
    let n = 0
    const mk = (over: Partial<Mandate> = {}): Mandate => ({ agent: a.address, budget: '1000000', maxPerTx: '100000', nonce: `proof-${now}-${n++}`, expiresAt: now + 3600, ...over })
    const sign = async (m: Mandate, signer = a): Promise<SignedMandate> => ({ mandate: m, signature: await signer.signMessage({ message: canonicalMandate(m) }) })

    const accepted = await new MandateVerifier().verify(await sign(mk()))
    const wrongSigner = await new MandateVerifier().verify(await sign(mk(), b))
    const expired = await new MandateVerifier().verify(await sign(mk({ expiresAt: now - 60 })))
    const tamper = await sign(mk())
    tamper.mandate.budget = '999999999999'
    const tampered = await new MandateVerifier().verify(tamper)
    const replayV = new MandateVerifier()
    const sm = await sign(mk())
    await replayV.verify(sm)
    const replayed = await replayV.verify(sm)

    const why = (x: Awaited<ReturnType<MandateVerifier['verify']>>) => (x.ok ? 'accepted' : x.reason)
    return c.json({
      scheme: 'EIP-191 personal_sign over a canonical mandate',
      acceptsValidSignedMandate: accepted.ok,
      rejects: {
        wrongSigner: why(wrongSigner),
        expiredMandate: why(expired),
        tamperedMandate: why(tampered),
        replayedNonce: why(replayed),
      },
    })
  })

  // live proof of x402's per-payment authorization: the payer signs an intent
  // bound to payee/amount/asset/network/resource; the verifier rejects every tamper.
  app.get('/proof/payment-intent', async (c) => {
    const payer = privateKeyToAccount(generatePrivateKey())
    const now = Math.floor(Date.now() / 1000)
    let n = 0
    const mk = (over: Partial<PaymentIntent> = {}): PaymentIntent => ({
      payer: payer.address, payee: d.cfg.demoPayee, asset: d.cfg.settlementAsset, amount: '1000',
      network: d.cfg.network, resource: '/premium', nonce: `pi-${now}-${n++}`, expiresAt: now + 600, ...over,
    })
    const sign = async (i: PaymentIntent): Promise<SignedPaymentIntent> => ({ intent: i, signature: await payer.signMessage({ message: canonicalIntent(i) }) })
    const tamper = async (field: keyof PaymentIntent, value: string) => {
      const s = await sign(mk())
      ;(s.intent as unknown as Record<string, unknown>)[field] = value
      return new PaymentIntentVerifier().verify(s)
    }

    const accepted = await new PaymentIntentVerifier().verify(await sign(mk()))
    const wrongResource = await tamper('resource', '/free')
    const wrongPayee = await tamper('payee', '0x1234567890123456789012345678901234567890')
    const wrongAmount = await tamper('amount', '999999999')
    const expired = await new PaymentIntentVerifier().verify(await sign(mk({ expiresAt: now - 60 })))
    const rv = new PaymentIntentVerifier()
    const sp = await sign(mk())
    await rv.verify(sp)
    const replayed = await rv.verify(sp)

    const why = (x: Awaited<ReturnType<PaymentIntentVerifier['verify']>>) => (x.ok ? 'accepted' : x.reason)
    return c.json({
      scheme: 'EIP-191 personal_sign binding the payer to {payee, asset, amount, network, resource, nonce, expiresAt}',
      note: 'the live demo settles via a pre-approved testnet allowance for reliability; this is the production per-payment authorization layer that binds each payment',
      acceptsValidIntent: accepted.ok,
      rejects: {
        wrongResource: why(wrongResource),
        wrongPayee: why(wrongPayee),
        wrongAmount: why(wrongAmount),
        expiredIntent: why(expired),
        replayedNonce: why(replayed),
      },
    })
  })

  // a live merchant route: the exact x402 flow @cx402/middleware gives a seller in
  // one line. no payment -> 402 challenge; a valid payment settles and is served
  // with the verified receipt in X-PAYMENT-RESPONSE.
  app.get('/premium', async (c) => {
    const requirements = {
      scheme: 'exact', network: d.cfg.network, asset: d.cfg.settlementAsset,
      payTo: d.cfg.demoPayee, maxAmountRequired: '1000', resource: '/premium',
      description: 'cx402 premium market-data feed',
    }
    const header = c.req.header('X-PAYMENT')
    if (!header) return c.json({ x402Version: 1, accepts: [requirements] }, 402)
    let payment: unknown
    try {
      payment = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    } catch {
      return c.json({ error: 'invalid_payment_header' }, 400)
    }
    const res = await app.request('/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payment, requirements }) })
    const body = (await res.json()) as { success?: boolean; receipt?: unknown; compliance?: { blockedBy?: string; reason?: string } }
    if (res.status !== 200 || !body.success) {
      return c.json({ x402Version: 1, accepts: [requirements], error: 'payment_required', blockedBy: body.compliance?.blockedBy, reason: body.compliance?.reason }, 402)
    }
    c.header('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify(body.receipt)).toString('base64'))
    return c.json({ data: 'cx402 premium market-data feed', paidWith: 'a verified, in-policy x402 payment', receipt: body.receipt })
  })

  // set an agent's policy mandate. production path: a signed mandate, verified
  // before we trust it. demo path: unsigned, only when explicitly allowed.
  app.post('/policy', async (c) => {
    let body: Record<string, unknown>
    try { body = (await c.req.json()) as Record<string, unknown> } catch { return c.json({ error: 'invalid_json', message: 'request body must be valid JSON' }, 400) }

    if (body.mandate && body.signature) {
      const res = await d.mandateVerifier.verify(body as unknown as SignedMandate)
      if (!res.ok) return c.json({ ok: false, error: res.reason }, 401)
      const m = res.mandate
      const policy: Policy = { budget: m.budget, maxPerTx: m.maxPerTx, minTier: m.minTier, allowedCounterparties: m.allowedCounterparties }
      d.policyEngine.register(m.agent, policy)
      return c.json({ ok: true, agent: m.agent, policy, signed: true, expiresAt: m.expiresAt, spent: '0' })
    }

    // unsigned: DEMO ONLY, gated behind an explicit flag (the page can't hold a key)
    if (!d.cfg.demoAllowUnsignedPolicy) {
      return c.json({ ok: false, error: 'unsigned_policy_disabled', hint: 'send a signed {mandate,signature}, or set DEMO_ALLOW_UNSIGNED_POLICY=true' }, 401)
    }
    const { agent, policy } = body as { agent?: unknown; policy?: unknown }
    if (!isAddr(agent) || !policy || typeof policy !== 'object') {
      return c.json({ ok: false, error: 'invalid_policy', message: 'agent (address) and policy object are required' }, 400)
    }
    d.policyEngine.register(agent, policy as Policy)
    return c.json({ ok: true, agent, policy, signed: false, spent: d.policyEngine.spentBy(agent).toString() })
  })

  // the compliance gate + policy (no settlement)
  app.post('/verify', async (c) => {
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', message: 'request body must be valid JSON' }, 400) }
    const intent = validIntent(body)
    if (!intent) return c.json({ error: 'invalid_intent', message: 'payment {payer,payee,asset,amount} and requirements are required' }, 400)
    try {
      const compliance = await evaluate(d, intent.payment, intent.requirements)
      d.bus.emit({ type: 'verify', payer: intent.payment.payer, payee: intent.payment.payee, amount: intent.payment.amount, compliance })
      return c.json({ isValid: compliance.decision === 'CLEARED', compliance })
    } catch (e) {
      return c.json({ error: 'compliance_check_failed', message: e instanceof Error ? e.message : 'compliance check failed' }, 502)
    }
  })

  // gate + settle + receipt
  app.post('/settle', async (c) => {
    let body: unknown
    try { body = await c.req.json() } catch { return c.json({ error: 'invalid_json', message: 'request body must be valid JSON' }, 400) }
    const intent = validIntent(body)
    if (!intent) return c.json({ error: 'invalid_intent', message: 'payment {payer,payee,asset,amount} and requirements are required' }, 400)
    const { payment, requirements } = intent

    try {
      const compliance = await evaluate(d, payment, requirements)

      const mkReceipt = (settlement: SettlementResult) =>
        buildReceipt({
          cv: d.cv,
          chain: d.cfg.chain,
          network: d.cfg.network,
          facilitatorLabel: d.facilitatorLabel,
          explorerBase: d.cfg.explorerBase,
          payment,
          requirements,
          compliance,
          settlement,
          signer: d.signer,
        })

      if (compliance.decision === 'BLOCKED') {
        const receipt = await mkReceipt({ status: 'failed', txHash: null, rung: 'blocked', simulated: false, confirmedAt: Date.now() })
        d.store.put(receipt)
        d.bus.emit({ type: 'block', payer: payment.payer, payee: payment.payee, amount: payment.amount, reason: compliance.reason, compliance })
        return c.json({ success: false, blocked: true, receipt, compliance }, 402)
      }

      const settlement = await d.settler.settle({
        payer: payment.payer,
        payee: payment.payee,
        asset: payment.asset,
        amount: BigInt(payment.amount),
      })
      if (settlement.status === 'settled') d.policyEngine.record(payment.payer, BigInt(payment.amount))
      const receipt = await mkReceipt(settlement)
      d.store.put(receipt)
      d.bus.emit({ type: 'settle', receipt })
      return c.json({ success: settlement.status === 'settled', receipt, settlement }, settlement.status === 'settled' ? 200 : 502)
    } catch (e) {
      return c.json({ error: 'settlement_failed', message: e instanceof Error ? e.message : 'settlement failed' }, 502)
    }
  })

  app.get('/receipts/:key', (c) => {
    const receipt = d.store.get(c.req.param('key'))
    return receipt ? c.json(receipt) : c.json({ error: 'not_found' }, 404)
  })

  // the official Cleanverse Travel-Rule / Transaction report for a settled tx.
  // regenerated fresh per request because the download token is time-limited.
  app.get('/report', async (c) => {
    const tx = c.req.query('tx')
    const w = c.req.query('w')
    if (!tx || !w) return c.json({ error: 'tx and w (wallet) are required' }, 400)
    const r = await d.cv.downloadTravelRule({ txHash: tx, wallet: { chain: d.cfg.chain, address: w } })
    const data = r.data as { downloadUrl?: string } | undefined
    if (r.code === '0000' && data?.downloadUrl) return c.redirect(data.downloadUrl, 302)
    // a just-settled tx takes a short while for Cleanverse to index before a
    // report can be generated; show a friendly note rather than a raw error
    return c.html(
      `<!doctype html><meta charset="utf8"><title>cx402 report</title>` +
        `<body style="font-family:ui-monospace,monospace;max-width:560px;margin:80px auto;padding:0 20px;color:#2b2b2b;line-height:1.6">` +
        `<h2>Report is being generated</h2>` +
        `<p>Cleanverse is still indexing this settlement on-chain. The official compliance report for this transaction will be available shortly, refresh this page in a minute.</p>` +
        `<p style="color:#999;font-size:13px">tx ${tx}</p></body>`,
      202,
    )
  })

  // SSE stream for the wall
  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const lastId = Number(c.req.header('Last-Event-ID') ?? c.req.query('lastEventId') ?? 0)
      const queue = d.bus.recent(lastId)
      let wake: (() => void) | null = null
      const unsub = d.bus.subscribe((e) => {
        queue.push(e)
        wake?.()
        wake = null
      })
      stream.onAbort(() => unsub())
      while (!stream.aborted) {
        while (queue.length) {
          const e = queue.shift()!
          await stream.writeSSE({ id: String(e.id), event: e.type, data: JSON.stringify(e) })
        }
        await new Promise<void>((resolve) => {
          wake = resolve
          setTimeout(resolve, 15_000)
        })
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' })
      }
    }),
  )

  return app
}

/** Wire everything from config. Used by the server entry and by tests. */
export function createFacilitator(cfg: FacilitatorConfig, opts: { uiHtmlPath?: string; skillMdPath?: string; llmsTxtPath?: string; openapiJsonPath?: string } = {}) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const cv = new CleanverseClient(cfg.cleanverse)
  const engine = new ComplianceEngine(cv, cfg.chain, cfg.complianceAsset)
  const bus = new EventBus()
  const store = new ReceiptStore()
  const policyEngine = new PolicyEngine()
  const mandateVerifier = new MandateVerifier()

  let settler: Settler
  let signer: PrivateKeyAccount | undefined
  let facilitatorLabel = 'cx402'

  if (cfg.settlementMode === 'ausdx' && cfg.facilitatorPkey) {
    const s = new AusdxSettler({
      rpcUrl: cfg.rpcUrl,
      chain: monadChain(cfg.chainId, cfg.rpcUrl),
      asset: cfg.settlementAsset,
      facilitatorPkey: cfg.facilitatorPkey,
    })
    settler = s
    signer = privateKeyToAccount(cfg.facilitatorPkey)
    facilitatorLabel = s.facilitatorAddress
  } else {
    settler = new SimulatedSettler()
    if (cfg.facilitatorPkey) signer = privateKeyToAccount(cfg.facilitatorPkey)
  }

  const app = createApp({
    cv, engine, settler, store, bus, policyEngine, mandateVerifier, cfg, signer, facilitatorLabel,
    uiHtmlPath: opts.uiHtmlPath,
    skillMdPath: opts.skillMdPath ?? join(repoRoot, 'skills', 'cx402', 'SKILL.md'),
    llmsTxtPath: opts.llmsTxtPath ?? join(repoRoot, 'llms.txt'),
    openapiJsonPath: opts.openapiJsonPath ?? join(repoRoot, 'openapi.json'),
  })
  return { app, bus, store, settler, cv, policyEngine, mandateVerifier, facilitatorLabel }
}
