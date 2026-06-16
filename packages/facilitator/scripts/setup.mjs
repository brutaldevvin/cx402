import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createWalletClient, createPublicClient, http, parseEther, formatEther, formatUnits, maxUint256 } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const envPath = join(repoRoot, '.env')

function parseEnv() {
  const out = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i === -1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}
function ensureEnv(key, value) {
  const env = parseEnv()
  if (env[key]) return env[key]
  appendFileSync(envPath, `\n${key}=${value}\n`)
  console.log(`  .env += ${key}`)
  return value
}

let env = parseEnv()

// 1) settlement asset from the contracts deployment
const depPath = join(repoRoot, 'packages', 'contracts', 'deployments.json')
const aUSDx = existsSync(depPath) ? JSON.parse(readFileSync(depPath, 'utf8')).monad?.aUSDx : env.SETTLEMENT_ASSET
if (!aUSDx) throw new Error('no aUSDx address (deploy the contract first)')
ensureEnv('SETTLEMENT_ASSET', aUSDx)
ensureEnv('SETTLEMENT_MODE', 'ausdx')
ensureEnv('NETWORK', 'eip155:10143')
ensureEnv('CHAIN_ID', '10143')

// 2) facilitator wallet
const facPkey = ensureEnv('FACILITATOR_PKEY', generatePrivateKey())
env = parseEnv()

const monad = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [env.MONAD_RPC_URL] } } }
const pc = createPublicClient({ chain: monad, transport: http(env.MONAD_RPC_URL) })
const payer = privateKeyToAccount(env.W_PKEY)          // wallet A - the buyer
const facilitator = privateKeyToAccount(facPkey)
const payerWallet = createWalletClient({ account: payer, chain: monad, transport: http(env.MONAD_RPC_URL) })

console.log('facilitator address:', facilitator.address)
console.log('payer (A) address  :', payer.address)

// 3) fund the facilitator with gas (it submits transferFrom)
const facMon = await pc.getBalance({ address: facilitator.address })
if (facMon < parseEther('0.5')) {
  console.log('funding facilitator with 2 MON for gas...')
  const h = await payerWallet.sendTransaction({ to: facilitator.address, value: parseEther('2') })
  await pc.waitForTransactionReceipt({ hash: h })
}
console.log('facilitator MON:', formatEther(await pc.getBalance({ address: facilitator.address })))

// 4) payer approves the facilitator to move aUSDx on its behalf
const ERC20 = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
]
const allowance = await pc.readContract({ address: aUSDx, abi: ERC20, functionName: 'allowance', args: [payer.address, facilitator.address] })
if (allowance < parseUnitsSafe('100')) {
  console.log('approving facilitator for aUSDx (max)...')
  const h = await payerWallet.writeContract({ address: aUSDx, abi: ERC20, functionName: 'approve', args: [facilitator.address, maxUint256] })
  await pc.waitForTransactionReceipt({ hash: h })
}
const finalAllowance = await pc.readContract({ address: aUSDx, abi: ERC20, functionName: 'allowance', args: [payer.address, facilitator.address] })
const payerBal = await pc.readContract({ address: aUSDx, abi: ERC20, functionName: 'balanceOf', args: [payer.address] })
console.log('payer aUSDx balance:', formatUnits(payerBal, 6))
console.log('facilitator allowance:', finalAllowance === maxUint256 ? 'MAX' : formatUnits(finalAllowance, 6))
console.log('\nsetup complete. facilitator can now settle aUSDx via transferFrom.')

function parseUnitsSafe(v) { return BigInt(Math.round(Number(v) * 1e6)) }
