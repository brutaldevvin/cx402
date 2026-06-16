import { verifyMessage } from 'viem'
import type { Address } from './types'

/**
 * A compliance mandate the operator signs once and the agent presents to the
 * facilitator. The signature binds the policy to the agent's key, so the
 * facilitator never takes a policy on trust. nonce + expiresAt stop replay and
 * stale mandates. The on-the-wire amounts are token base units (like Policy).
 */
export interface Mandate {
  agent: Address
  budget?: string
  maxPerTx?: string
  minTier?: number
  allowedCounterparties?: string[]
  /** unique per mandate, used for replay protection */
  nonce: string
  /** unix seconds; the mandate is rejected after this */
  expiresAt: number
}

export interface SignedMandate {
  mandate: Mandate
  /** EIP-191 personal_sign over canonicalMandate(mandate), by `mandate.agent` */
  signature: `0x${string}`
}

export type MandateError = 'malformed_mandate' | 'mandate_expired' | 'invalid_signature' | 'nonce_replayed'

/** Canonical JSON (fixed key order) so the signed bytes are deterministic. */
export function canonicalMandate(m: Mandate): string {
  return JSON.stringify({
    agent: m.agent,
    budget: m.budget ?? null,
    maxPerTx: m.maxPerTx ?? null,
    minTier: m.minTier ?? null,
    allowedCounterparties: m.allowedCounterparties ?? null,
    nonce: m.nonce,
    expiresAt: m.expiresAt,
  })
}

/**
 * Verifies a signed mandate: not malformed, not expired, signed by the agent
 * (EIP-191), and the nonce has not been used before. A nonce is only burned
 * after the signature checks out, so a bad signature can't grief a real agent.
 */
export class MandateVerifier {
  private readonly used = new Map<string, Set<string>>()
  constructor(private readonly now: () => number = () => Date.now()) {}

  async verify(sm: SignedMandate): Promise<{ ok: true; mandate: Mandate } | { ok: false; reason: MandateError }> {
    const m = sm?.mandate
    if (!m || !m.agent || !m.nonce || !m.expiresAt || !sm.signature) return { ok: false, reason: 'malformed_mandate' }
    if (m.expiresAt * 1000 < this.now()) return { ok: false, reason: 'mandate_expired' }

    let valid = false
    try {
      valid = await verifyMessage({ address: m.agent, message: canonicalMandate(m), signature: sm.signature })
    } catch {
      valid = false
    }
    if (!valid) return { ok: false, reason: 'invalid_signature' }

    const key = m.agent.toLowerCase()
    const seen = this.used.get(key) ?? new Set<string>()
    if (seen.has(m.nonce)) return { ok: false, reason: 'nonce_replayed' }
    seen.add(m.nonce)
    this.used.set(key, seen)
    return { ok: true, mandate: m }
  }
}
