import { describe, it, expect } from 'vitest'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { PaymentIntentVerifier, canonicalIntent } from '../src/intent'
import type { PaymentIntent } from '../src/intent'
import { loadFacilitatorConfig } from '../src/config'
import { createFacilitator } from '../src/app'

const payer = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())

async function signed(over: Partial<PaymentIntent> = {}, signWith = payer) {
  const intent: PaymentIntent = {
    payer: payer.address,
    payee: '0xBe58C5eE13bE6a4aD8C9735c10a2967ED528CfBB',
    asset: '0xaC0893567D43C3E7e6e35a72803df05416C1f20D',
    amount: '1000',
    network: 'eip155:10143',
    resource: '/premium',
    nonce: 'pi-' + Math.random().toString(36).slice(2),
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    ...over,
  }
  const signature = await signWith.signMessage({ message: canonicalIntent(intent) })
  return { intent, signature }
}

describe('signed payment intent (per-payment authorization, EIP-191)', () => {
  it('accepts a valid signed intent', async () => {
    expect((await new PaymentIntentVerifier().verify(await signed())).ok).toBe(true)
  })

  it('rejects a different signer', async () => {
    const r = await new PaymentIntentVerifier().verify(await signed({}, stranger))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_signature')
  })

  it('rejects a tampered payee (the signature is bound to it)', async () => {
    const s = await signed()
    s.intent.payee = '0x000000000000000000000000000000000000dEaD'
    const r = await new PaymentIntentVerifier().verify(s)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_signature')
  })

  it('rejects a tampered amount', async () => {
    const s = await signed()
    s.intent.amount = '999999999'
    const r = await new PaymentIntentVerifier().verify(s)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_signature')
  })

  it('rejects a tampered resource', async () => {
    const s = await signed()
    s.intent.resource = '/free'
    const r = await new PaymentIntentVerifier().verify(s)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_signature')
  })

  it('rejects an expired intent', async () => {
    const r = await new PaymentIntentVerifier().verify(await signed({ expiresAt: Math.floor(Date.now() / 1000) - 30 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('intent_expired')
  })

  it('rejects a replayed nonce', async () => {
    const v = new PaymentIntentVerifier()
    const s = await signed({ nonce: 'replay-fixed' })
    expect((await v.verify(s)).ok).toBe(true)
    const second = await v.verify(s)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('nonce_replayed')
  })
})

const cfg = loadFacilitatorConfig()
const httpReady = cfg.settlementAsset ? describe : describe.skip

httpReady('GET /proof/payment-intent', () => {
  it('accepts a valid intent and rejects every tamper, expiry, and replay', async () => {
    const { app } = createFacilitator(cfg)
    const res = await app.request('/proof/payment-intent')
    const b = (await res.json()) as { acceptsValidIntent: boolean; rejects: Record<string, string> }
    expect(b.acceptsValidIntent).toBe(true)
    expect(b.rejects.wrongResource).toBe('invalid_signature')
    expect(b.rejects.wrongPayee).toBe('invalid_signature')
    expect(b.rejects.wrongAmount).toBe('invalid_signature')
    expect(b.rejects.expiredIntent).toBe('intent_expired')
    expect(b.rejects.replayedNonce).toBe('nonce_replayed')
  })
})
