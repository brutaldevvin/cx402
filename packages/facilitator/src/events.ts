import type { ComplianceResult, Receipt } from './types'

/** Typed events the wall subscribes to over SSE. */
export type FacilitatorEvent =
  | { type: 'verify'; payer: string; payee: string; amount: string; compliance: ComplianceResult }
  | { type: 'settle'; receipt: Receipt }
  | { type: 'block'; payer: string; payee: string; amount: string; reason?: string; compliance: ComplianceResult }
  | { type: 'agent'; actor: string; action: string; detail?: string }

export type EmittedEvent = FacilitatorEvent & { id: number; ts: number }

/** In-memory pub/sub + short history (for SSE Last-Event-ID replay). */
export class EventBus {
  private subscribers = new Set<(e: EmittedEvent) => void>()
  private history: EmittedEvent[] = []
  private seq = 0

  emit(event: FacilitatorEvent): EmittedEvent {
    const emitted: EmittedEvent = { ...event, id: ++this.seq, ts: Date.now() }
    this.history.push(emitted)
    if (this.history.length > 500) this.history.shift()
    for (const fn of this.subscribers) {
      try { fn(emitted) } catch { /* never let one subscriber break emit */ }
    }
    return emitted
  }

  subscribe(fn: (e: EmittedEvent) => void): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  recent(afterId = 0): EmittedEvent[] {
    return this.history.filter((e) => e.id > afterId)
  }
}
