import { createWalletClient, createPublicClient, http, type Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Settler, SettlementRequest, SettlementResult, Address } from './types'

const ERC20_ABI = [
  { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

/** Bottom rung: no chain. Drives the full pipeline while flagged simulated:true. */
export class SimulatedSettler implements Settler {
  async settle(_req: SettlementRequest): Promise<SettlementResult> {
    return { status: 'settled', txHash: null, rung: 'simulated', simulated: true, confirmedAt: Date.now() }
  }
}

/**
 * Live rung: the facilitator submits transferFrom(payer, payee, amount) on the
 * settlement token (aUSDx today, real aUSDC by config). The payer must have
 * approved the facilitator once (onboarding). The token enforces A-Pass on-chain,
 * so this also can't move funds to/from an unverified wallet.
 */
export class AusdxSettler implements Settler {
  private readonly wallet
  private readonly pc
  private readonly account
  constructor(
    private readonly cfg: { rpcUrl: string; chain: Chain; asset: Address; facilitatorPkey: Address },
  ) {
    this.account = privateKeyToAccount(cfg.facilitatorPkey)
    this.wallet = createWalletClient({ account: this.account, chain: cfg.chain, transport: http(cfg.rpcUrl) })
    this.pc = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) })
  }

  get facilitatorAddress(): Address {
    return this.account.address
  }

  async settle(req: SettlementRequest): Promise<SettlementResult> {
    const base = { rung: 'ausdx-transferFrom', simulated: false } as const
    let lastErr: unknown
    // retry transient submission/RPC hiccups (a confirmed on-chain revert is NOT retried)
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt))
      try {
        const hash = await this.wallet.writeContract({
          address: this.cfg.asset,
          abi: ERC20_ABI,
          functionName: 'transferFrom',
          args: [req.payer, req.payee, req.amount],
        })
        const receipt = await this.pc.waitForTransactionReceipt({ hash })
        return {
          ...base,
          status: receipt.status === 'success' ? 'settled' : 'failed',
          txHash: hash,
          confirmedAt: Date.now(),
          ...(receipt.status === 'success' ? {} : { error: 'transaction reverted on-chain' }),
        }
      } catch (err) {
        lastErr = err
      }
    }
    return {
      ...base,
      status: 'failed',
      txHash: null,
      confirmedAt: Date.now(),
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    }
  }
}

export function monadChain(chainId: number, rpcUrl: string): Chain {
  return {
    id: chainId,
    name: 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }
}
