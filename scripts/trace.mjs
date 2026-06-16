import { readFileSync } from 'node:fs'
import { createPublicClient, http, formatUnits, formatEther } from 'viem'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const { MONAD_RPC_URL, USDC_ADDRESS, AUSDC_ADDRESS } = env
const ACCESS_CORE = '0x8F118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC'

const rpc = async (method, params) => {
  const r = await fetch(MONAD_RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  return (await r.json())
}
const transfers = async (opts) => {
  const res = await rpc('alchemy_getAssetTransfers', [{ fromBlock: '0x0', toBlock: 'latest',
    category: ['erc20'], withMetadata: false, maxCount: '0x32', ...opts }])
  if (res.error) return { error: res.error.message }
  return res.result?.transfers ?? []
}

console.log('=== USDC transfers INTO access_core (who deposited = the institution/faucet wallet) ===')
const intoCore = await transfers({ toAddress: ACCESS_CORE, contractAddresses: [USDC_ADDRESS] })
console.log(JSON.stringify(intoCore, null, 2))

console.log('\n=== aUSDC transfers (mints + circulation) ===')
const ausdcMoves = await transfers({ contractAddresses: [AUSDC_ADDRESS] })
console.log(JSON.stringify(ausdcMoves, null, 2))

// collect counterparties and check their gas/balances
const pc = createPublicClient({ transport: http(MONAD_RPC_URL) })
const erc = [{ name:'balanceOf', type:'function', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'uint256'}] }]
const b6 = (a,t)=>pc.readContract({address:t,abi:erc,functionName:'balanceOf',args:[a]}).then(v=>formatUnits(v,6)).catch(()=>'err')
const parties = [...new Set([...(Array.isArray(intoCore)?intoCore:[]), ...(Array.isArray(ausdcMoves)?ausdcMoves:[])]
  .flatMap(t => [t.from, t.to]).filter(a => a && a !== '0x0000000000000000000000000000000000000000'))]
console.log('\n=== balances of involved wallets ===')
for (const p of parties) {
  console.log(`${p}  MON=${formatEther(await pc.getBalance({address:p}))}  USDC=${await b6(p,USDC_ADDRESS)}  aUSDC=${await b6(p,AUSDC_ADDRESS)}`)
}
