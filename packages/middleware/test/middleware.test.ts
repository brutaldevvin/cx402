import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadFacilitatorConfig, createFacilitator } from '@cx402/facilitator'
import { cx402Paywall } from '../src'

function readPk(key: string): `0x${string}` {
  for (const p of [join(process.cwd(), '.env'), join(process.cwd(), '..', '..', '.env')]) {
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim()
      if (t.startsWith(key + '=')) return t.slice(key.length + 1).trim() as `0x${string}`
    }
  }
  throw new Error(`${key} not in .env`)
}

const cfg = loadFacilitatorConfig()
const ready = cfg.cleanverse.apiId && cfg.cleanverse.appKey && cfg.settlementAsset && cfg.rpcUrl
const live = ready ? describe : describe.skip

live('cx402 merchant middleware (paywall, live Monad)', () => {
  const fac = createFacilitator(cfg)
  const transport = (path: string, init: RequestInit) => Promise.resolve(fac.app.request(path, init))
  const A = privateKeyToAccount(readPk('W_PKEY')).address // buyer agent
  const B = privateKeyToAccount(readPk('W2_PKEY')).address // merchant

  // a tiny 402-protected shop - one line of middleware
  const shop = new Hono()
  shop.use('/premium', cx402Paywall({ price: '1', payTo: B, transport }))
  shop.get('/premium', (c) => c.json({ data: 'premium market-data feed' }))

  it('no payment → 402 challenge with the required compliant payment', async () => {
    const res = await shop.request('/premium')
    expect(res.status).toBe(402)
    const body = (await res.json()) as { accepts: Array<{ payTo: string; maxAmountRequired: string }> }
    expect(body.accepts[0]!.payTo.toLowerCase()).toBe(B.toLowerCase())
    expect(body.accepts[0]!.maxAmountRequired).toBe(parseUnits('1', 6).toString())
  })

  it('valid payment → settles, serves the resource, returns the receipt', async () => {
    const payment = {
      scheme: 'exact', network: cfg.network, payer: A, payee: B,
      asset: cfg.settlementAsset, amount: parseUnits('1', 6).toString(),
    }
    const xpay = Buffer.from(JSON.stringify(payment)).toString('base64')
    const res = await shop.request('/premium', { headers: { 'X-PAYMENT': xpay } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: string }
    expect(body.data).toContain('market-data')
    const receiptHeader = res.headers.get('X-PAYMENT-RESPONSE')
    expect(receiptHeader).toBeTruthy()
    const receipt = JSON.parse(Buffer.from(receiptHeader!, 'base64').toString('utf8'))
    expect(receipt.compliance.status).toBe('CLEARED')
  })
})
