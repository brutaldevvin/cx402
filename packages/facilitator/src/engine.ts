import { CleanverseClient, VerifyCode } from '@cx402/cleanverse'
import type { PaymentPayload, PaymentRequirements, ComplianceResult, CheckResult } from './types'

/** Maps a verify_apass code to a stable taxonomy reason for one party. */
function reasonForCode(party: 'payer' | 'payee', code: number): string {
  switch (code) {
    case VerifyCode.NoApass: return `${party}_no_apass`
    case VerifyCode.ApassBlocked: return `${party}_apass_blocked`
    case VerifyCode.AtokenNotFound: return 'asset_unknown'
    default: return `${party}_not_verified`
  }
}

/**
 * The cx402 compliance gate. "May this payment settle?"
 * 1. the payment matches what the server demanded, 2. payer is A-Pass-clean,
 * 3. payee is A-Pass-clean - all against the live Cleanverse registry.
 */
export class ComplianceEngine {
  /**
   * @param complianceAsset the REAL Cleanverse A-Token (aUSDC) used to verify each
   *   party's A-Pass via verify_apass - distinct from the settlement asset, which
   *   may be our stand-in token.
   */
  constructor(
    private readonly cv: CleanverseClient,
    private readonly chain: string,
    private readonly complianceAsset: string,
  ) {}

  async verifyParties(payment: PaymentPayload, req: PaymentRequirements): Promise<ComplianceResult> {
    // 1) requirements match
    const reqChecks: string[] = []
    if (payment.asset.toLowerCase() !== req.asset.toLowerCase()) reqChecks.push('asset_mismatch')
    if (payment.payee.toLowerCase() !== req.payTo.toLowerCase()) reqChecks.push('recipient_mismatch')
    if (payment.network !== req.network) reqChecks.push('network_mismatch')
    try {
      if (BigInt(payment.amount) < BigInt(req.maxAmountRequired)) reqChecks.push('amount_insufficient')
    } catch {
      reqChecks.push('amount_invalid')
    }
    const requirements: CheckResult = reqChecks.length
      ? { pass: false, detail: reqChecks.join(',') }
      : { pass: true }

    // 2) + 3) both parties verified against the real A-Token (aUSDC), not the
    // settlement asset (which may be our stand-in token Cleanverse doesn't know)
    const [payerV, payeeV] = await Promise.all([
      this.cv.verifyApass({ chain: this.chain, atoken: this.complianceAsset, address: payment.payer }),
      this.cv.verifyApass({ chain: this.chain, atoken: this.complianceAsset, address: payment.payee }),
    ])
    const payerApass: CheckResult = { pass: payerV.code === VerifyCode.Valid, code: payerV.code }
    const payeeApass: CheckResult = { pass: payeeV.code === VerifyCode.Valid, code: payeeV.code }

    const decision = requirements.pass && payerApass.pass && payeeApass.pass ? 'CLEARED' : 'BLOCKED'

    let reason: string | undefined
    if (decision === 'BLOCKED') {
      if (!payerApass.pass) reason = reasonForCode('payer', payerV.code)
      else if (!payeeApass.pass) reason = reasonForCode('payee', payeeV.code)
      else reason = requirements.detail
    }

    return { decision, reason, checks: { requirements, payerApass, payeeApass } }
  }
}
