import type { Address } from './types'

/**
 * An agent's compliance mandate - set once by the operator, enforced on every
 * payment. This is what makes cx402 a policy layer, not a per-payment check:
 * the budget is stateful (depletes across payments).
 */
export interface Policy {
  /** total spend cap over the agent's lifetime/session, in token base units */
  budget?: string
  /** per-payment cap, base units */
  maxPerTx?: string
  /** counterparty must have A-Pass tier >= this */
  minTier?: number
  /** if set, the payee must be one of these addresses (case-insensitive) */
  allowedCounterparties?: string[]
}

export type PolicyReason =
  | 'over_max_per_tx'
  | 'over_budget'
  | 'tier_too_low'
  | 'counterparty_not_allowed'

export interface PolicyResult {
  pass: boolean
  reason?: PolicyReason
  /** remaining budget after this payment would clear, base units */
  remaining?: string
}

/** In-memory policy registry + running spend per agent. */
export class PolicyEngine {
  private policies = new Map<string, Policy>()
  private spent = new Map<string, bigint>()

  register(agent: Address, policy: Policy): void {
    const k = agent.toLowerCase()
    this.policies.set(k, policy)
    // a freshly registered mandate starts a fresh session: reset running spend so
    // the budget depletes within a session, not permanently across registrations
    this.spent.set(k, 0n)
  }

  get(agent: Address): Policy | undefined {
    return this.policies.get(agent.toLowerCase())
  }

  spentBy(agent: Address): bigint {
    return this.spent.get(agent.toLowerCase()) ?? 0n
  }

  /** Evaluate a proposed payment against the agent's mandate. */
  check(agent: Address, p: { payee: string; amount: bigint; payeeTier?: number }): PolicyResult {
    const policy = this.policies.get(agent.toLowerCase())
    if (!policy) return { pass: true } // unmandated agent: policy layer is a no-op

    if (policy.maxPerTx && p.amount > BigInt(policy.maxPerTx)) {
      return { pass: false, reason: 'over_max_per_tx' }
    }
    if (policy.allowedCounterparties && policy.allowedCounterparties.length) {
      const allowed = policy.allowedCounterparties.map((a) => a.toLowerCase())
      if (!allowed.includes(p.payee.toLowerCase())) return { pass: false, reason: 'counterparty_not_allowed' }
    }
    if (policy.minTier != null && (p.payeeTier ?? 0) < policy.minTier) {
      return { pass: false, reason: 'tier_too_low' }
    }
    if (policy.budget) {
      const budget = BigInt(policy.budget)
      const spent = this.spentBy(agent)
      if (spent + p.amount > budget) {
        return { pass: false, reason: 'over_budget', remaining: (budget - spent).toString() }
      }
      return { pass: true, remaining: (budget - spent - p.amount).toString() }
    }
    return { pass: true }
  }

  /** Record a successful settlement against the agent's budget. */
  record(agent: Address, amount: bigint): void {
    const k = agent.toLowerCase()
    this.spent.set(k, (this.spent.get(k) ?? 0n) + amount)
  }

  /** Does this agent's mandate require knowing the payee's tier? */
  needsTier(agent: Address): boolean {
    return this.policies.get(agent.toLowerCase())?.minTier != null
  }
}
