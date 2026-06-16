import { verifyMessage } from 'viem'
import type { Address } from './types'

/**
 * A signed payment intent: the payer authorizes one specific payment. The
 * signature binds the payer's key to every field, so changing the payee,
 * amount, asset, network, or resource invalidates it. nonce + expiresAt stop
 * replay and stale authorizations. This is x402's per-payment authorization,
 * the production complement to the signed mandate.
 */
export interface PaymentIntent {
  payer: Address
  payee: Address
  asset: Address
  amount: string
  network: string
  resource: string
  nonce: string
  expiresAt: number
}

export interface SignedPaymentIntent {
  intent: PaymentIntent
  /** EIP-191 personal_sign over canonicalIntent(intent), by `intent.payer` */
  signature: `0x${string}`
}

export type IntentError = 'malformed_intent' | 'intent_expired' | 'invalid_signature' | 'nonce_replayed'

/** Canonical JSON (fixed key order) so the signed bytes are deterministic. */
export function canonicalIntent(i: PaymentIntent): string {
  return JSON.stringify({
    payer: i.payer,
    payee: i.payee,
    asset: i.asset,
    amount: i.amount,
    network: i.network,
    resource: i.resource,
    nonce: i.nonce,
    expiresAt: i.expiresAt,
  })
}

/**
 * Verifies a signed payment intent: not malformed, not expired, signed by the
 * payer (EIP-191), and the nonce is unused. The nonce is only burned after the
 * signature checks out, so a forged signature can't grief a real payer.
 */
export class PaymentIntentVerifier {
  private readonly used = new Map<string, Set<string>>()
  constructor(private readonly now: () => number = () => Date.now()) {}

  async verify(sp: SignedPaymentIntent): Promise<{ ok: true; intent: PaymentIntent } | { ok: false; reason: IntentError }> {
    const i = sp?.intent
    if (!i || !i.payer || !i.payee || !i.nonce || !i.expiresAt || !sp.signature) return { ok: false, reason: 'malformed_intent' }
    if (i.expiresAt * 1000 < this.now()) return { ok: false, reason: 'intent_expired' }

    let valid = false
    try {
      valid = await verifyMessage({ address: i.payer, message: canonicalIntent(i), signature: sp.signature })
    } catch {
      valid = false
    }
    if (!valid) return { ok: false, reason: 'invalid_signature' }

    const key = i.payer.toLowerCase()
    const seen = this.used.get(key) ?? new Set<string>()
    if (seen.has(i.nonce)) return { ok: false, reason: 'nonce_replayed' }
    seen.add(i.nonce)
    this.used.set(key, seen)
    return { ok: true, intent: i }
  }
}
