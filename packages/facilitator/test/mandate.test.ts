import { describe, it, expect } from 'vitest'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { MandateVerifier, canonicalMandate } from '../src/mandate'
import type { Mandate } from '../src/mandate'
import { loadFacilitatorConfig } from '../src/config'
import { createFacilitator } from '../src/app'

const agent = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())

async function signed(over: Partial<Mandate> = {}, signWith = agent) {
  const mandate: Mandate = {
    agent: agent.address,
    budget: '1000000',
    maxPerTx: '100000',
    nonce: 'n-' + Math.random().toString(36).slice(2),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...over,
  }
  const signature = await signWith.signMessage({ message: canonicalMandate(mandate) })
  return { mandate, signature }
}

describe('signed mandate verification (EIP-191)', () => {
  it('accepts a valid signed mandate', async () => {
    const r = await new MandateVerifier().verify(await signed())
    expect(r.ok).toBe(true)
  })

  it('rejects a mandate signed by a different key (invalid signature)', async () => {
    const r = await new MandateVerifier().verify(await signed({}, stranger))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_signature')
  })

  it('rejects an expired mandate', async () => {
    const r = await new MandateVerifier().verify(await signed({ expiresAt: Math.floor(Date.now() / 1000) - 10 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('mandate_expired')
  })

  it('rejects a replayed nonce (same mandate twice)', async () => {
    const v = new MandateVerifier()
    const sm = await signed({ nonce: 'replay-me' })
    expect((await v.verify(sm)).ok).toBe(true)
    const second = await v.verify(sm)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('nonce_replayed')
  })

  it('rejects a mandate tampered after signing', async () => {
    const sm = await signed({ budget: '1000000' })
    sm.mandate.budget = '999999999999' // raise the budget after signing
    const r = await new MandateVerifier().verify(sm)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_signature')
  })
})

const cfg = loadFacilitatorConfig()
const httpReady = cfg.settlementAsset && cfg.rpcUrl ? describe : describe.skip

httpReady('POST /policy mandate gating', () => {
  const post = (app: { request: (p: string, i: RequestInit) => Response | Promise<Response> }, body: unknown) =>
    Promise.resolve(app.request('/policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

  it('accepts a signed mandate over HTTP', async () => {
    const { app } = createFacilitator(cfg)
    const res = await post(app, await signed())
    expect(res.status).toBe(200)
    const b = (await res.json()) as { ok: boolean; signed: boolean }
    expect(b.ok).toBe(true)
    expect(b.signed).toBe(true)
  })

  it('rejects an unsigned policy when DEMO_ALLOW_UNSIGNED_POLICY is off', async () => {
    const { app } = createFacilitator({ ...cfg, demoAllowUnsignedPolicy: false })
    const res = await post(app, { agent: agent.address, policy: { budget: '1' } })
    expect(res.status).toBe(401)
  })

  it('accepts an unsigned policy only in explicit demo mode', async () => {
    const { app } = createFacilitator({ ...cfg, demoAllowUnsignedPolicy: true })
    const res = await post(app, { agent: agent.address, policy: { budget: '1' } })
    expect(res.status).toBe(200)
    const b = (await res.json()) as { signed: boolean }
    expect(b.signed).toBe(false)
  })

  it('rejects an expired signed mandate over HTTP', async () => {
    const { app } = createFacilitator(cfg)
    const res = await post(app, await signed({ expiresAt: Math.floor(Date.now() / 1000) - 5 }))
    expect(res.status).toBe(401)
  })
})

httpReady('malformed requests return structured errors, not 500', () => {
  it('POST /verify with empty body returns 400 JSON', async () => {
    const { app } = createFacilitator(cfg)
    const res = await app.request('/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_intent')
  })

  it('POST /verify with non-JSON returns 400 JSON', async () => {
    const { app } = createFacilitator(cfg)
    const res = await app.request('/verify', { method: 'POST', body: 'notjson' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_json')
  })

  it('POST /settle with empty body returns 400, not 500', async () => {
    const { app } = createFacilitator(cfg)
    const res = await app.request('/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(400)
  })

  it('GET /proof/mandate accepts a valid mandate and rejects every attack', async () => {
    const { app } = createFacilitator(cfg)
    const res = await app.request('/proof/mandate')
    const b = (await res.json()) as { acceptsValidSignedMandate: boolean; rejects: Record<string, string> }
    expect(b.acceptsValidSignedMandate).toBe(true)
    expect(b.rejects.wrongSigner).toBe('invalid_signature')
    expect(b.rejects.expiredMandate).toBe('mandate_expired')
    expect(b.rejects.tamperedMandate).toBe('invalid_signature')
    expect(b.rejects.replayedNonce).toBe('nonce_replayed')
  })

  it('GET /premium without payment returns a 402 challenge', async () => {
    const { app } = createFacilitator(cfg)
    const res = await app.request('/premium')
    expect(res.status).toBe(402)
    const b = (await res.json()) as { x402Version: number; accepts: Array<{ maxAmountRequired: string }> }
    expect(b.x402Version).toBe(1)
    expect(b.accepts[0]!.maxAmountRequired).toBeTruthy()
  })
})
