export type Address = `0x${string}`

/** What an x402-protected server demands (subset, pragmatic). */
export interface PaymentRequirements {
  scheme: 'exact'
  network: string // CAIP-2, e.g. eip155:10143
  asset: Address // settlement token
  payTo: Address
  /** required amount in token base units (string for bigint safety) */
  maxAmountRequired: string
  resource?: string
  description?: string
  extra?: { requireApassTier?: number }
}

/** What the payer presents. PoC: facilitator settles via a pre-approved transferFrom. */
export interface PaymentPayload {
  scheme: 'exact'
  network: string
  payer: Address
  payee: Address
  asset: Address
  /** amount in token base units */
  amount: string
}

export interface CheckResult {
  pass: boolean
  code?: number
  detail?: string
}

export interface PartyProof {
  address: string
  cvRecordId?: string
  kycHash?: string
  tier?: string
}

export interface ComplianceResult {
  decision: 'CLEARED' | 'BLOCKED'
  /** error-taxonomy code when BLOCKED (identity_* or policy_*) */
  reason?: string
  /** which guardrail blocked: identity gate, or the agent's policy mandate */
  blockedBy?: 'identity' | 'policy'
  checks: {
    requirements: CheckResult
    payerApass: CheckResult
    payeeApass: CheckResult
    /** present when the agent has a policy mandate */
    policy?: CheckResult & { remaining?: string }
  }
}

export interface SettlementRequest {
  payer: Address
  payee: Address
  asset: Address
  /** base units */
  amount: bigint
}

export interface SettlementResult {
  status: 'settled' | 'failed'
  txHash: string | null
  /** which liveness-ladder rung produced this */
  rung: 'ausdx-transferFrom' | 'simulated' | string
  simulated: boolean
  confirmedAt: number
  error?: string
}

export interface Receipt {
  id: string
  version: string
  timestamp: number
  payment: {
    amount: string
    asset: Address
    network: string
    scheme: 'exact'
    txHash: string | null
    explorerUrl?: string
    facilitator: string
  }
  originator: PartyProof
  beneficiary: PartyProof
  compliance: {
    status: 'CLEARED' | 'BLOCKED'
    checks: ComplianceResult['checks']
    reason?: string
    travelRule: 'ready'
  }
  settlement: { rung: string; simulated: boolean }
  signature?: { signer: string; value: string; alg: string; over: string }
}

export interface Settler {
  settle(req: SettlementRequest): Promise<SettlementResult>
}
