import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import { loadFacilitatorConfig, createFacilitator } from '@cx402/facilitator'
import { cx402, type Cx402Agent } from '../src'

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

live('cx402 Agent SDK - E2E (Monad)', () => {
  const fac = createFacilitator(cfg)
  const transport = (path: string, init: RequestInit) => Promise.resolve(fac.app.request(path, init))
  const A = privateKeyToAccount(readPk('W_PKEY')).address // the agent
  const B = privateKeyToAccount(readPk('W2_PKEY')).address // a verified supplier
  let agent: Cx402Agent

  beforeAll(async () => {
    // operator gives the agent a mandate: max $5 per payment
    agent = cx402.agent({ address: A, policy: { maxPerTx: '5' }, transport })
    await agent.init()
  })

  it('pays a verified supplier within mandate → verified receipt + on-chain tx', async () => {
    const r = await agent.pay({ payee: B, amount: '1', purpose: 'market-data feed' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.receipt.compliance.status).toBe('CLEARED')
      expect(r.receipt.originator.cvRecordId).toBeTruthy()
      if (cfg.settlementMode === 'ausdx') expect(r.txHash).toMatch(/^0x[0-9a-f]{64}$/i)
    }
  })

  it('refuses an unverified supplier → blocked by identity', async () => {
    const r = await agent.pay({ payee: DEAD, amount: '1', purpose: 'sketchy seller' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.blockedBy).toBe('identity')
  })

  it('refuses a payment over the mandate cap → blocked by policy', async () => {
    const r = await agent.pay({ payee: B, amount: '10', purpose: 'too big' }) // over maxPerTx 5
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.blockedBy).toBe('policy')
      expect(r.reason).toBe('policy_over_max_per_tx')
    }
  })
})
