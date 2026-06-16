import { readFileSync } from 'node:fs'
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const { CLEANVERSE_APP_ID, CLEANVERSE_COOPERATE_BASE, CLEANVERSE_SKILLS_BASE, MONAD_RPC_URL, W_PKEY } = env

const monad = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } } }
const account = privateKeyToAccount(W_PKEY)
const addr = account.address
const pc = createPublicClient({ chain: monad, transport: http(MONAD_RPC_URL) })
const wallet = createWalletClient({ account, chain: monad, transport: http(MONAD_RPC_URL) })
const bal = async (a) => Number(formatEther(await pc.getBalance({ address: a })))
const post = async (path, b) => (await (await fetch(`${CLEANVERSE_COOPERATE_BASE}/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'api-id': CLEANVERSE_APP_ID }, body: JSON.stringify(b) })).json())

// 1) get monad operator / fee-pay addresses from chain config
const cfg = await (await fetch(`${CLEANVERSE_SKILLS_BASE}/query_chain_config`)).json()
const m = cfg.data.chains.find(c => c.chain === 'monad')
const candidates = [...new Set([m.operator_address, m.fee_pay_address].filter(Boolean))]
console.log('monad operator_address:', m.operator_address)
console.log('monad fee_pay_address :', m.fee_pay_address)
console.log('monad fee_receive     :', m.fee_receive_address)
console.log('\nour wallet A MON:', await bal(addr))
for (const c of candidates) console.log(`candidate ${c} MON:`, await bal(c))

// 2) fund any candidate that's near-empty (guard: skip if already funded)
for (const c of candidates) {
  if (await bal(c) < 0.5) {
    console.log(`\n-> sending 1 MON to ${c} ...`)
    const hash = await wallet.sendTransaction({ to: c, value: parseEther('1') })
    console.log('   tx:', hash)
    await pc.waitForTransactionReceipt({ hash })
    console.log('   confirmed. new balance MON:', await bal(c))
  } else {
    console.log(`\n-> ${c} already has gas (>=0.5 MON), NOT sending. Gas may not be the issue.`)
  }
}

// 3) retry faucet now that gas is funded
console.log('\n=== retry faucet on monad ===')
console.log('ausdc -> wallet:', JSON.stringify(await post('faucet', { chain: 'monad', symbol: 'ausdc', depositAddress: addr, amount: '5' })))
console.log('usdc  -> wallet:', JSON.stringify(await post('faucet', { chain: 'monad', symbol: 'usdc',  depositAddress: addr, amount: '5' })))
