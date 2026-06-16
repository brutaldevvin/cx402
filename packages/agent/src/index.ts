import { parseUnits } from 'viem'

export type Address = `0x${string}`

/** A policy mandate in human amounts (decimal strings like "1000.00"). */
export interface AgentPolicy {
  budget?: string
  maxPerTx?: string
  minTier?: number
  allowedCounterparties?: string[]
}

export interface AgentConfig {
  /** the agent's A-Pass'd wallet address (payer) */
  address: Address
  policy?: AgentPolicy
  /** facilitator base URL (default http://localhost:8402) */
  facilitatorUrl?: string
  /** in-process / custom transport (path, init) => Response - used for tests */
  transport?: (path: string, init: RequestInit) => Promise<Response>
  /** settlement-asset decimals (default 6) */
  decimals?: number
}

export interface VerifiedReceipt {
  id: string
  payment: { amount: string; asset: Address; network: string; txHash: string | null; explorerUrl?: string }
  originator: { address: string; cvRecordId?: string; kycHash?: string; tier?: string }
  beneficiary: { address: string; cvRecordId?: string; kycHash?: string; tier?: string }
  compliance: { status: 'CLEARED' | 'BLOCKED'; reason?: string; blockedBy?: 'identity' | 'policy' }
  signature?: { signer: string; value: string }
  [k: string]: unknown
}

export type PayResult =
  | { ok: true; receipt: VerifiedReceipt; txHash: string | null }
  | { ok: false; blockedBy?: 'identity' | 'policy'; reason?: string; receipt?: VerifiedReceipt; error?: string }

/**
 * Give an agent a wallet + a compliance mandate. It pays only when the payment
 * is verified (both parties A-Pass'd) and within policy - otherwise it returns
 * a clean refusal carrying which guardrail blocked.
 */
export class Cx402Agent {
  private asset!: Address
  private network!: string
  private readonly dec: number
  private ready = false

  constructor(private readonly cfg: AgentConfig) {
    this.dec = cfg.decimals ?? 6
  }

  private call(path: string, init: RequestInit): Promise<Response> {
    if (this.cfg.transport) return this.cfg.transport(path, init)
    const base = this.cfg.facilitatorUrl ?? 'http://localhost:8402'
    return fetch(base + path, init)
  }
  private post(path: string, body: unknown): Promise<Response> {
    return this.call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  }
  private amt(v: string): string {
    return parseUnits(v, this.dec).toString()
  }

  /** Discover the settlement asset and register the policy mandate. */
  async init(): Promise<this> {
    const sup = (await (await this.call('/supported', { method: 'GET' })).json()) as { kinds: Array<{ asset: Address; network: string }> }
    this.asset = sup.kinds[0]!.asset
    this.network = sup.kinds[0]!.network
    if (this.cfg.policy) {
      const p = this.cfg.policy
      await this.post('/policy', {
        agent: this.cfg.address,
        policy: {
          budget: p.budget != null ? this.amt(p.budget) : undefined,
          maxPerTx: p.maxPerTx != null ? this.amt(p.maxPerTx) : undefined,
          minTier: p.minTier,
          allowedCounterparties: p.allowedCounterparties,
        },
      })
    }
    this.ready = true
    return this
  }

  /** Create a verified payment intent, verify + settle it, or refuse cleanly. */
  async pay(args: { payee: Address; amount: string; purpose?: string }): Promise<PayResult> {
    if (!this.ready) await this.init()
    const amount = this.amt(args.amount)
    const payment = { scheme: 'exact', network: this.network, payer: this.cfg.address, payee: args.payee, asset: this.asset, amount }
    const requirements = {
      scheme: 'exact', network: this.network, asset: this.asset, payTo: args.payee, maxAmountRequired: amount,
      ...(args.purpose ? { description: args.purpose } : {}),
    }
    const res = await this.post('/settle', { payment, requirements })
    const body = (await res.json()) as {
      success?: boolean
      receipt?: VerifiedReceipt
      compliance?: { blockedBy?: 'identity' | 'policy'; reason?: string }
      settlement?: { error?: string }
    }

    if (res.status === 200 && body.success && body.receipt) {
      return { ok: true, receipt: body.receipt, txHash: body.receipt.payment.txHash }
    }
    if (res.status === 402) {
      return {
        ok: false,
        blockedBy: body.compliance?.blockedBy,
        reason: body.compliance?.reason ?? body.receipt?.compliance.reason,
        receipt: body.receipt,
      }
    }
    return { ok: false, error: body.settlement?.error ?? 'settlement_failed', reason: body.receipt?.compliance.reason }
  }
}

/** Toolkit entrypoint: `cx402.agent({ address, policy }).pay(...)`. */
export const cx402 = {
  agent(cfg: AgentConfig): Cx402Agent {
    return new Cx402Agent(cfg)
  },
}

export function createAgent(cfg: AgentConfig): Cx402Agent {
  return new Cx402Agent(cfg)
}
