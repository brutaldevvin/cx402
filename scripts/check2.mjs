import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http, getContract } from 'viem'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const { CLEANVERSE_APP_ID, CLEANVERSE_COOPERATE_BASE, AUSDC_ADDRESS, USDC_ADDRESS,
        MONAD_RPC_URL, W_PKEY, CHAIN } = env

const addr = privateKeyToAccount(W_PKEY).address
console.log('wallet:', addr, '\n')

// --- on-chain balances ---
const monad = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC_URL] } } }
const pc = createPublicClient({ chain: monad, transport: http(MONAD_RPC_URL) })
const erc20 = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }]

const native = await pc.getBalance({ address: addr })
const ausdc = await pc.readContract({ address: AUSDC_ADDRESS, abi: erc20, functionName: 'balanceOf', args: [addr] }).catch(e => `err: ${e.shortMessage || e.message}`)
const usdc = await pc.readContract({ address: USDC_ADDRESS, abi: erc20, functionName: 'balanceOf', args: [addr] }).catch(e => `err: ${e.shortMessage || e.message}`)
console.log('=== on-chain balances ===')
console.log('MON (native):', Number(native) / 1e18)
console.log('aUSDC        :', typeof ausdc === 'bigint' ? Number(ausdc) / 1e6 : ausdc)
console.log('USDC (origin):', typeof usdc === 'bigint' ? Number(usdc) / 1e6 : usdc)

// --- faucet capability test (origin usdc -> wallet, small amount) ---
console.log('\n=== faucet test (COOPERATE, symbol=usdc, amount=1) ===')
const r = await fetch(`${CLEANVERSE_COOPERATE_BASE}/faucet`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'api-id': CLEANVERSE_APP_ID },
  body: JSON.stringify({ chain: CHAIN, symbol: 'usdc', depositAddress: addr, amount: '1' }),
})
console.log('status', r.status, JSON.stringify(await r.json().catch(() => r.text()), null, 2))
