/** One real aUSDC settlement through cx402 - proof the flow runs on the official A-Token. Sparingly: 1 aUSDC, reversible. */
import { readFileSync } from 'node:fs'
import { createWalletClient, createPublicClient, http, parseUnits, maxUint256, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadFacilitatorConfig, createFacilitator } from '@cx402/facilitator'

const env: Record<string, string> = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i < 0) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const cfg = loadFacilitatorConfig()
const AUSDC = cfg.complianceAsset
const B = '0xBe58C5eE13bE6a4aD8C9735c10a2967ED528CfBB' as const
const monad = { id: 10143, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } }
const A = privateKeyToAccount(env.W_PKEY as `0x${string}`)
const facAddr = privateKeyToAccount(cfg.facilitatorPkey as `0x${string}`).address
const pc = createPublicClient({ chain: monad, transport: http(cfg.rpcUrl) })
const wallet = createWalletClient({ account: A, chain: monad, transport: http(cfg.rpcUrl) })
const erc = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const
const balB = () => pc.readContract({ address: AUSDC, abi: erc, functionName: 'balanceOf', args: [B] }) as Promise<bigint>

// 1) A approves the facilitator to move aUSDC (gas only)
const allowance = (await pc.readContract({ address: AUSDC, abi: erc, functionName: 'allowance', args: [A.address, facAddr] })) as bigint
if (allowance < parseUnits('1', 6)) {
  console.log('approving facilitator for aUSDC…')
  const h = await wallet.writeContract({ address: AUSDC, abi: erc, functionName: 'approve', args: [facAddr, maxUint256] })
  await pc.waitForTransactionReceipt({ hash: h })
}

// 2) settle 1 aUSDC A→B through the facilitator (asset overridden to real aUSDC)
const fac = createFacilitator({ ...cfg, settlementAsset: AUSDC })
const before = await balB()
const amount = parseUnits('1', 6).toString()
const payment = { scheme: 'exact', network: cfg.network, payer: A.address, payee: B, asset: AUSDC, amount }
const requirements = { scheme: 'exact', network: cfg.network, asset: AUSDC, payTo: B, maxAmountRequired: amount, description: 'real aUSDC proof' }
const res = await fac.app.request('/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payment, requirements }) })
const body = (await res.json()) as any
const after = await balB()

console.log('\n=== REAL aUSDC SETTLEMENT ===')
console.log('success:', body.success, '| status:', body.receipt?.compliance?.status)
console.log('txHash :', body.receipt?.payment?.txHash)
console.log('explorer:', body.receipt?.payment?.explorerUrl)
console.log('B aUSDC:', formatUnits(before, 6), '→', formatUnits(after, 6))
console.log('signed by:', body.receipt?.signature?.signer)
