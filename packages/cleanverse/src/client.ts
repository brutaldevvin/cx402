import { aesEncrypt } from './crypto'
import { VerifyCode } from './types'
import type { CleanverseConfig } from './config'
import type {
  CvResponse,
  ApassRecord,
  VerifyResult,
  GenerateApassInput,
  UpdateStatusInput,
} from './types'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Stable business errors must NOT be retried (the answer won't change). */
function isStableError(message: string): boolean {
  return /not found|CN_\d+|already exists|invalid|incorrect|format|must be|cannot be null|parameter|too frequent|NoAPass/i.test(message)
}

/** A non-success response that looks like a transient server/web3 hiccup. */
function isTransient(body: { code?: string; message?: string }): boolean {
  return body?.code !== '0000' && !isStableError(body?.message ?? '')
}

/**
 * Typed client over the two Cleanverse API surfaces:
 *  - cooperate (`/api/cooperate`): needs the api-id header; some bodies AES-encrypted.
 *  - skills    (`/api/skills`): no auth.
 *
 * Read calls retry transient errors (the UAT sandbox intermittently 500s);
 * writes never retry (avoid double-applying a state change).
 */
export class CleanverseClient {
  constructor(private readonly cfg: CleanverseConfig) {}

  private async post<T = unknown>(
    url: string,
    headers: Record<string, string>,
    payload: unknown,
    retry: boolean,
  ): Promise<CvResponse<T>> {
    const attempts = retry ? 3 : 1
    let last: CvResponse<T> | undefined
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await delay(200 * i)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(payload),
        })
        last = (await res.json()) as CvResponse<T>
        if (res.ok && !isTransient(last)) return last
      } catch (err) {
        if (i === attempts - 1) throw err
      }
    }
    if (last) return last
    throw new Error('cleanverse request failed after retries')
  }

  private cooperate<T = unknown>(
    path: string,
    body: unknown,
    opts: { encrypted?: boolean; retry?: boolean } = {},
  ): Promise<CvResponse<T>> {
    const payload = opts.encrypted ? { data: aesEncrypt(JSON.stringify(body), this.cfg.appKey) } : body
    return this.post<T>(`${this.cfg.cooperateBase}/${path}`, { 'api-id': this.cfg.apiId }, payload, opts.retry ?? false)
  }

  private skills<T = unknown>(path: string, body: unknown, retry = false): Promise<CvResponse<T>> {
    return this.post<T>(`${this.cfg.skillsBase}/${path}`, {}, body, retry)
  }

  // ---- the cx402 compliance gate -------------------------------------------

  /** The gate, one call per party. code 4 = valid A-Pass + transfer allowed. */
  async verifyApass(p: { chain: string; atoken: string; address: string }): Promise<VerifyResult> {
    const res = await this.cooperate<{
      code: number
      message: string
      magickLink?: string
      chain?: string
      atoken?: string
      address?: string
    }>('verify_apass', p, { retry: true })
    const d = res.data
    return {
      code: (d?.code ?? VerifyCode.NoApass) as VerifyCode,
      message: d?.message ?? res.message,
      magickLink: d?.magickLink,
      chain: d?.chain ?? p.chain,
      atoken: d?.atoken ?? p.atoken,
      address: d?.address ?? p.address,
    }
  }

  /** Convenience: true iff the wallet may hold/transfer this A-Token. */
  async isClean(p: { chain: string; atoken: string; address: string }): Promise<boolean> {
    return (await this.verifyApass(p)).code === VerifyCode.Valid
  }

  // ---- A-Pass records & management -----------------------------------------

  /** A-Pass record (cvRecordId/kycHash/tier proof fields), or null if none. */
  async queryApass(p: { chain: string; address: string }): Promise<ApassRecord | null> {
    const res = await this.cooperate<ApassRecord>('query_apass', p, { retry: true })
    return res.code === '0000' ? res.data : null
  }

  /** Mint an A-Pass (Gateway/Issue Member; body AES-encrypted). No retry (write). */
  async generateApass(input: GenerateApassInput): Promise<CvResponse> {
    return this.cooperate('generate_apass', input, { encrypted: true })
  }

  /** Freeze (2) / activate (1) an A-Pass (body AES-encrypted). No retry (write). */
  async updateStatus(input: UpdateStatusInput): Promise<CvResponse> {
    const body = {
      customerId: input.customerId,
      cvRecordId: input.cvRecordId,
      status: String(input.status),
      blacklistReason: input.blacklistReason,
      wallet: input.wallet,
    }
    return this.cooperate('update_status', body, { encrypted: true })
  }

  // ---- read helpers (Common Queries) ---------------------------------------

  queryDepositAddress(p: { chain: string; address: string }): Promise<CvResponse> {
    return this.skills('query_deposit_address', p, true)
  }

  queryTxs(p: Record<string, unknown>): Promise<CvResponse> {
    return this.cooperate('query_txs', p, { retry: true })
  }

  /** Official Travel Rule / Transaction report PDF for a txHash. */
  downloadTravelRule(p: {
    txHash: string
    wallet: { chain: string; address: string }
    customerId?: string
    cvRecordId?: string
  }): Promise<CvResponse> {
    return this.cooperate('download_travel_rule', p, { retry: true })
  }

  /** NB: currently broken on the sandbox (their faucet wallet is unfunded). Write, no retry. */
  faucet(p: { chain: string; symbol: string; depositAddress: string; amount: string }): Promise<CvResponse> {
    return this.cooperate('faucet', p)
  }
}
