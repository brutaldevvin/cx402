import { readFileSync, existsSync } from 'node:fs'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { privateKeyToAccount } from 'viem/accounts'
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
import type { PaymentPayload, PaymentRequirements, Settler, SettlementResult, ComplianceResult, Address } from './types'

interface Deps {
  cv: CleanverseClient
  engine: ComplianceEngine
  settler: Settler
  store: ReceiptStore
  bus: EventBus
  policyEngine: PolicyEngine
  cfg: FacilitatorConfig
  signer?: PrivateKeyAccount
  facilitatorLabel: string
  /** optional UI page path served at `/` (re-read per request for live iteration) */
  uiHtmlPath?: string
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

export function createApp(d: Deps): Hono {
  const app = new Hono()

  const info = () => ({
    name: 'cx402 facilitator',
    network: d.cfg.network,
    asset: d.cfg.settlementAsset,
    settlementMode: d.cfg.settlementMode,
    facilitator: d.facilitatorLabel,
  })
  app.get('/', (c) => {
    if (d.uiHtmlPath && existsSync(d.uiHtmlPath)) return c.html(readFileSync(d.uiHtmlPath, 'utf8'))
    return c.json(info())
  })
  app.get('/info', (c) => c.json(info()))

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

  // set an agent's policy mandate (operator configures once)
  app.post('/policy', async (c) => {
    const { agent, policy } = (await c.req.json()) as { agent: Address; policy: Policy }
    d.policyEngine.register(agent, policy)
    return c.json({ ok: true, agent, policy, spent: d.policyEngine.spentBy(agent).toString() })
  })

  // the compliance gate + policy (no settlement)
  app.post('/verify', async (c) => {
    const { payment, requirements } = (await c.req.json()) as {
      payment: PaymentPayload
      requirements: PaymentRequirements
    }
    const compliance = await evaluate(d, payment, requirements)
    d.bus.emit({ type: 'verify', payer: payment.payer, payee: payment.payee, amount: payment.amount, compliance })
    return c.json({ isValid: compliance.decision === 'CLEARED', compliance })
  })

  // gate + settle + receipt
  app.post('/settle', async (c) => {
    const { payment, requirements } = (await c.req.json()) as {
      payment: PaymentPayload
      requirements: PaymentRequirements
    }
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
export function createFacilitator(cfg: FacilitatorConfig, opts: { uiHtmlPath?: string } = {}) {
  const cv = new CleanverseClient(cfg.cleanverse)
  const engine = new ComplianceEngine(cv, cfg.chain, cfg.complianceAsset)
  const bus = new EventBus()
  const store = new ReceiptStore()
  const policyEngine = new PolicyEngine()

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

  const app = createApp({ cv, engine, settler, store, bus, policyEngine, cfg, signer, facilitatorLabel, uiHtmlPath: opts.uiHtmlPath })
  return { app, bus, store, settler, cv, policyEngine, facilitatorLabel }
}
