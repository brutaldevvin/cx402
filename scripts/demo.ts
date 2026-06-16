/**
 * cx402 - day in the life of a procurement agent.
 * An agent with a compliance mandate pays suppliers live on Monad:
 * verified + within-policy payments clear; everything else is refused,
 * by identity OR by policy. Run: pnpm demo
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadFacilitatorConfig, createFacilitator } from '@cx402/facilitator'
import { cx402 } from '@cx402/agent'

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m', Y = '\x1b[33m'
const pk = (k: string): `0x${string}` => {
  for (const line of readFileSync(join(process.cwd(), '.env'), 'utf8').split('\n'))
    if (line.trim().startsWith(k + '=')) return line.trim().slice(k.length + 1) as `0x${string}`
  throw new Error(k)
}

const cfg = loadFacilitatorConfig()
if (!cfg.cleanverse.apiId) throw new Error('missing Cleanverse creds in .env')
const fac = createFacilitator(cfg)
const transport = (path: string, init: RequestInit) => Promise.resolve(fac.app.request(path, init))
const A = privateKeyToAccount(pk('W_PKEY')).address
const supplier = privateKeyToAccount(pk('W2_PKEY')).address
const DEAD = '0x000000000000000000000000000000000000dEaD' as const
const usd = (base?: string) => (base ? '$' + formatUnits(BigInt(base), 6) : '-')

console.log(`\n${B}cx402 - verified payment intents${X}  ${D}· procurement agent on Monad testnet${X}`)
console.log(`${D}mandate: budget $50 · max $20/tx · verified counterparties only${X}\n`)

const agent = cx402.agent({ address: A, policy: { budget: '50', maxPerTx: '20' }, transport })
await agent.init()

const steps = [
  { payee: supplier, amount: '15', purpose: 'market-data feed' },
  { payee: supplier, amount: '10', purpose: 'inference credits' },
  { payee: DEAD,     amount: '5',  purpose: 'unknown seller agent' },
  { payee: supplier, amount: '30', purpose: 'bulk data order' },
  { payee: supplier, amount: '20', purpose: 'storage' },
  { payee: supplier, amount: '10', purpose: 'more compute' },
] as const

let i = 0
for (const s of steps) {
  i++
  const who = s.payee === DEAD ? `${s.payee.slice(0, 8)}…` : `supplier ${supplier.slice(0, 8)}…`
  process.stdout.write(`${D}[${i}]${X} pay ${B}$${s.amount}${X} → ${who}  ${D}(${s.purpose})${X}\n`)
  const r = await agent.pay({ payee: s.payee, amount: s.amount, purpose: s.purpose })
  if (r.ok) {
    const remaining = (r.receipt.compliance as { checks?: { policy?: { remaining?: string } } }).checks?.policy?.remaining
    console.log(`    ${G}✓ CLEARED${X}  ${D}tx ${r.txHash?.slice(0, 14)}…  budget left ${usd(remaining)}${X}\n`)
  } else {
    const by = r.blockedBy === 'policy' ? `${Y}policy${X}` : `${R}identity${X}`
    console.log(`    ${R}✗ BLOCKED${X} by ${by}  ${D}· ${r.reason}${X}\n`)
  }
}
console.log(`${D}every cleared payment moved real aUSDx on Monad and emitted a signed Travel-Rule receipt.${X}\n`)
