import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadFacilitatorConfig } from '../src/config'
import { createFacilitator } from '../src/app'
import type { EmittedEvent } from '../src/events'
import type { PaymentPayload, PaymentRequirements, Receipt } from '../src/types'

function readPk(key: string): `0x${string}` {
  for (const p of [join(process.cwd(), '.env'), join(process.cwd(), '..', '..', '.env')]) {
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim()
      if (t.startsWith(key + '=')) return t.slice(key.length + 1).trim() as `0x${string}`
    }
  }
  throw new Error(`${key} not in .env`)
}

const cfg = loadFacilitatorConfig()
const ready = cfg.cleanverse.apiId && cfg.cleanverse.appKey && cfg.settlementAsset && cfg.rpcUrl
const live = ready ? describe : describe.skip

const DEAD = '0x000000000000000000000000000000000000dEaD' as const
const ERC20 = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const

live('cx402 facilitator (live Monad)', () => {
  const { app, bus } = createFacilitator(cfg)
  const A = privateKeyToAccount(readPk('W_PKEY')).address
  const B = privateKeyToAccount(readPk('W2_PKEY')).address
  const pc = createPublicClient({
    chain: { id: cfg.chainId, name: 'monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } },
    transport: http(cfg.rpcUrl),
  })

  const requirements = (payTo: string): PaymentRequirements => ({
    scheme: 'exact', network: cfg.network, asset: cfg.settlementAsset, payTo: payTo as `0x${string}`,
    maxAmountRequired: parseUnits('1', 6).toString(), resource: '/premium', description: 'demo',
  })
  const payment = (payee: string): PaymentPayload => ({
    scheme: 'exact', network: cfg.network, payer: A, payee: payee as `0x${string}`,
    asset: cfg.settlementAsset, amount: parseUnits('1', 6).toString(),
  })
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const balOf = (a: `0x${string}`) => pc.readContract({ address: cfg.settlementAsset, abi: ERC20, functionName: 'balanceOf', args: [a] }) as Promise<bigint>

  it('GET /supported advertises the settlement asset', async () => {
    const body = (await (await app.request('/supported')).json()) as { kinds: Array<{ asset: string }> }
    expect(body.kinds[0]!.asset.toLowerCase()).toBe(cfg.settlementAsset.toLowerCase())
  })

  it('POST /verify - A -> B clears (both A-Pass\'d)', async () => {
    const body = (await (await post('/verify', { payment: payment(B), requirements: requirements(B) })).json()) as { isValid: boolean; compliance: { decision: string } }
    expect(body.isValid).toBe(true)
    expect(body.compliance.decision).toBe('CLEARED')
  })

  it('POST /verify - A -> unverified payee is BLOCKED', async () => {
    const body = (await (await post('/verify', { payment: payment(DEAD), requirements: requirements(DEAD) })).json()) as { isValid: boolean; compliance: { decision: string; reason: string } }
    expect(body.isValid).toBe(false)
    expect(body.compliance.decision).toBe('BLOCKED')
    expect(body.compliance.reason).toBe('payee_no_apass')
  })

  it('POST /settle - A -> B settles on-chain, signs a receipt, moves aUSDx', async () => {
    if (cfg.settlementMode !== 'ausdx') return // requires setup (facilitator funded + approved)
    const before = await balOf(B)
    const events: EmittedEvent[] = []
    const unsub = bus.subscribe((e) => events.push(e))

    const res = await post('/settle', { payment: payment(B), requirements: requirements(B) })
    const body = (await res.json()) as { success: boolean; receipt: Receipt }
    unsub()

    expect(body.success).toBe(true)
    expect(body.receipt.compliance.status).toBe('CLEARED')
    expect(body.receipt.payment.txHash).toMatch(/^0x[0-9a-f]{64}$/i)
    expect(body.receipt.originator.cvRecordId).toBeTruthy()
    expect(body.receipt.beneficiary.cvRecordId).toBeTruthy()
    expect(body.receipt.signature?.value).toMatch(/^0x/)
    expect(events.some((e) => e.type === 'settle')).toBe(true)
    expect((await balOf(B)) - before).toBe(parseUnits('1', 6))

    const got = (await (await app.request(`/receipts/${body.receipt.id}`)).json()) as { id: string }
    expect(got.id).toBe(body.receipt.id)
  })

  it('POST /settle - A -> unverified payee is BLOCKED, no settlement', async () => {
    const events: EmittedEvent[] = []
    const unsub = bus.subscribe((e) => events.push(e))
    const res = await post('/settle', { payment: payment(DEAD), requirements: requirements(DEAD) })
    unsub()
    const body = (await res.json()) as { success: boolean; blocked: boolean; receipt: Receipt }
    expect(res.status).toBe(402)
    expect(body.success).toBe(false)
    expect(body.receipt.compliance.status).toBe('BLOCKED')
    expect(body.receipt.payment.txHash).toBeNull()
    expect(events.some((e) => e.type === 'block')).toBe(true)
  })
})

live('cx402 policy layer - beyond an identity check (Monad)', () => {
  const { app, policyEngine } = createFacilitator(cfg)
  const A = privateKeyToAccount(readPk('W_PKEY')).address // the agent
  const B = privateKeyToAccount(readPk('W2_PKEY')).address // a verified supplier
  const u = (v: string) => parseUnits(v, 6).toString()
  const post = (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const intent = (payee: string, amt: string) => ({
    payment: { scheme: 'exact', network: cfg.network, payer: A, payee, asset: cfg.settlementAsset, amount: u(amt) },
    requirements: { scheme: 'exact', network: cfg.network, asset: cfg.settlementAsset, payTo: payee, maxAmountRequired: u(amt) },
  })
  const verify = async (payee: string, amt: string) =>
    (await (await post('/verify', intent(payee, amt))).json()) as {
      isValid: boolean
      compliance: { decision: string; reason?: string; blockedBy?: string; checks: { policy?: { pass: boolean; remaining?: string } } }
    }

  it('within mandate → CLEARED, returns remaining budget', async () => {
    policyEngine.register(A, { budget: u('100'), maxPerTx: u('25') })
    const r = await verify(B, '10')
    expect(r.isValid).toBe(true)
    expect(r.compliance.checks.policy?.pass).toBe(true)
    expect(r.compliance.checks.policy?.remaining).toBe(u('90'))
  })

  it('over per-tx cap → BLOCKED by policy', async () => {
    policyEngine.register(A, { maxPerTx: u('5') })
    const r = await verify(B, '10')
    expect(r.compliance.decision).toBe('BLOCKED')
    expect(r.compliance.blockedBy).toBe('policy')
    expect(r.compliance.reason).toBe('policy_over_max_per_tx')
  })

  it('over budget → BLOCKED by policy', async () => {
    policyEngine.register(A, { budget: u('0.5') })
    const r = await verify(B, '1')
    expect(r.compliance.blockedBy).toBe('policy')
    expect(r.compliance.reason).toBe('policy_over_budget')
  })

  it('disallowed counterparty → BLOCKED by policy', async () => {
    policyEngine.register(A, { allowedCounterparties: [A] }) // B not on the list
    const r = await verify(B, '1')
    expect(r.compliance.blockedBy).toBe('policy')
    expect(r.compliance.reason).toBe('policy_counterparty_not_allowed')
  })

  it('identity is checked before policy (unverified payee → blocked by identity)', async () => {
    policyEngine.register(A, { maxPerTx: u('1') })
    const r = await verify(DEAD, '1000')
    expect(r.compliance.decision).toBe('BLOCKED')
    expect(r.compliance.blockedBy).toBe('identity')
  })

  it('POST /policy registers a mandate over HTTP', async () => {
    const body = (await (await post('/policy', { agent: A, policy: { budget: u('50') } })).json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
