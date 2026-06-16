import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createWalletClient, createPublicClient, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// --- load repo-root .env ---
const env = {}
for (const line of readFileSync(join(root, '..', '..', '.env'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const { MONAD_RPC_URL, APASS_ADDRESS, W_PKEY, W2_PKEY } = env

const monad = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [MONAD_RPC_URL] } } }
const artifact = JSON.parse(readFileSync(join(root, 'artifacts', 'AUSDx.json'), 'utf8'))

const deployer = privateKeyToAccount(W_PKEY)
const A = deployer.address
const B = privateKeyToAccount(W2_PKEY).address
const wallet = createWalletClient({ account: deployer, chain: monad, transport: http(MONAD_RPC_URL) })
const pc = createPublicClient({ chain: monad, transport: http(MONAD_RPC_URL) })

console.log('deploying aUSDx (apass registry =', APASS_ADDRESS, ') from', A)
const deployHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [APASS_ADDRESS] })
const receipt = await pc.waitForTransactionReceipt({ hash: deployHash })
const token = receipt.contractAddress
console.log('  deployed at', token, '(tx', deployHash + ')')

for (const [label, to] of [['A buyer', A], ['B seller', B]]) {
  const h = await wallet.writeContract({ address: token, abi: artifact.abi, functionName: 'mint', args: [to, parseUnits('1000', 6)] })
  await pc.waitForTransactionReceipt({ hash: h })
  console.log(`  minted 1000 aUSDx -> ${label} ${to}`)
}

const deployments = { monad: { aUSDx: token, apass: APASS_ADDRESS, deployTx: deployHash } }
writeFileSync(join(root, 'deployments.json'), JSON.stringify(deployments, null, 2))
console.log('\nwrote deployments.json. SETTLEMENT_ASSET =', token)
