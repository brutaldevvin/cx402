import type { Receipt } from './types'

/** Receipts retrievable by their id or settlement txHash. In-memory for the PoC. */
export class ReceiptStore {
  private byId = new Map<string, Receipt>()
  private byTx = new Map<string, string>() // txHash -> id

  put(receipt: Receipt): void {
    this.byId.set(receipt.id, receipt)
    if (receipt.payment.txHash) this.byTx.set(receipt.payment.txHash.toLowerCase(), receipt.id)
  }

  get(key: string): Receipt | undefined {
    const direct = this.byId.get(key)
    if (direct) return direct
    const id = this.byTx.get(key.toLowerCase())
    return id ? this.byId.get(id) : undefined
  }

  all(): Receipt[] {
    return [...this.byId.values()]
  }
}
