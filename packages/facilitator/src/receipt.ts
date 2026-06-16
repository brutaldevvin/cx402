import { randomUUID } from 'node:crypto'
import type { PrivateKeyAccount } from 'viem'
import { CleanverseClient } from '@cx402/cleanverse'
import type {
  PaymentPayload,
  PaymentRequirements,
  ComplianceResult,
  SettlementResult,
  Receipt,
  PartyProof,
} from './types'

/** Deterministic JSON (sorted keys) so the signed hash is stable. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}

export async function buildReceipt(args: {
  cv: CleanverseClient
  chain: string
  network: string
  facilitatorLabel: string
  explorerBase: string
  payment: PaymentPayload
  requirements: PaymentRequirements
  compliance: ComplianceResult
  settlement: SettlementResult
  signer?: PrivateKeyAccount
}): Promise<Receipt> {
  const { cv, chain, payment, settlement } = args

  // proof fields: real cvRecordId / kycHash / tier - NO PII
  const [payerRec, payeeRec] = await Promise.all([
    cv.queryApass({ chain, address: payment.payer }),
    cv.queryApass({ chain, address: payment.payee }),
  ])
  const proof = (
    address: string,
    rec: Awaited<ReturnType<CleanverseClient['queryApass']>>,
  ): PartyProof => ({
    address,
    cvRecordId: rec?.cvRecordId,
    kycHash: rec?.currentKycHash,
    tier: rec?.tier,
  })

  const core: Receipt = {
    id: `rcpt_${randomUUID()}`,
    version: 'cx402-receipt/0.1',
    timestamp: Date.now(),
    payment: {
      amount: payment.amount,
      asset: payment.asset,
      network: args.network,
      scheme: 'exact',
      txHash: settlement.txHash,
      explorerUrl: settlement.txHash ? args.explorerBase + settlement.txHash : undefined,
      facilitator: args.facilitatorLabel,
    },
    originator: proof(payment.payer, payerRec),
    beneficiary: proof(payment.payee, payeeRec),
    compliance: {
      status: args.compliance.decision,
      checks: args.compliance.checks,
      reason: args.compliance.reason,
      // a cleared settlement gets an official Cleanverse report, regenerated
      // fresh on demand via /report (the download token is time-limited)
      travelRule: settlement.txHash
        ? {
            available: true,
            type: 'cleanverse_transaction_report',
            format: 'pdf',
            report: `/report?tx=${settlement.txHash}&w=${payment.payer}`,
          }
        : { available: false },
    },
    settlement: { rung: settlement.rung, simulated: settlement.simulated },
  }

  if (args.signer) {
    const value = await args.signer.signMessage({ message: stableStringify(core) })
    core.signature = {
      signer: args.signer.address,
      value,
      alg: 'eip191-personal-sign',
      over: 'stableStringify(receipt without signature)',
    }
  }
  return core
}
