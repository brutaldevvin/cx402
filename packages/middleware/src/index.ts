import type { MiddlewareHandler } from 'hono'
import { parseUnits } from 'viem'

export type Address = `0x${string}`

export interface PaywallOptions {
  /** price in human units, e.g. "0.50" */
  price: string
  /** the merchant's A-Pass'd wallet that receives payment */
  payTo: Address
  /** facilitator base URL (default http://localhost:8402) */
  facilitatorUrl?: string
  /** in-process / custom transport - used for tests */
  transport?: (path: string, init: RequestInit) => Promise<Response>
  asset?: Address
  network?: string
  decimals?: number
  description?: string
}

/**
 * One-line 402 paywall. No payment header → returns an x402 challenge with the
 * required compliant payment. With a payment → verifies + settles via the
 * facilitator (identity + policy), and only then serves the route, attaching the
 * verified receipt in X-PAYMENT-RESPONSE.
 */
export function cx402Paywall(opts: PaywallOptions): MiddlewareHandler {
  let asset = opts.asset
  let network = opts.network
  const dec = opts.decimals ?? 6
  const call = (path: string, init: RequestInit): Promise<Response> =>
    opts.transport ? opts.transport(path, init) : fetch((opts.facilitatorUrl ?? 'http://localhost:8402') + path, init)

  const ensureConfig = async () => {
    if (asset && network) return
    const sup = (await (await call('/supported', { method: 'GET' })).json()) as { kinds: Array<{ asset: Address; network: string }> }
    asset = sup.kinds[0]!.asset
    network = sup.kinds[0]!.network
  }

  return async (c, next) => {
    await ensureConfig()
    const amount = parseUnits(opts.price, dec).toString()
    const requirements = {
      scheme: 'exact',
      network,
      asset,
      payTo: opts.payTo,
      maxAmountRequired: amount,
      description: opts.description,
      resource: c.req.path,
    }

    const header = c.req.header('X-PAYMENT')
    if (!header) {
      return c.json({ x402Version: 1, accepts: [requirements] }, 402) // the challenge
    }

    let payment: unknown
    try {
      payment = JSON.parse(Buffer.from(header, 'base64').toString('utf8'))
    } catch {
      return c.json({ error: 'invalid_payment_header' }, 400)
    }

    const res = await call('/settle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payment, requirements }),
    })
    const body = (await res.json()) as {
      success?: boolean
      receipt?: unknown
      compliance?: { blockedBy?: string; reason?: string }
    }

    if (res.status !== 200 || !body.success) {
      return c.json(
        { x402Version: 1, accepts: [requirements], error: 'payment_required', blockedBy: body.compliance?.blockedBy, reason: body.compliance?.reason },
        402,
      )
    }

    c.header('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify(body.receipt)).toString('base64'))
    await next()
  }
}
