import { readFileSync } from 'node:fs'
import { createPublicClient, http, formatUnits, parseAbiItem } from 'viem'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const { MONAD_RPC_URL, USDC_ADDRESS, AUSDC_ADDRESS } = env
const OPERATOR = '0xBd8428761efB5384C4945d16de56817Caa6903dF'
const ACCESS_CORE = '0x8F118338a1fa41E7Fa86Be19A4e8B99Ed58A6EcC'
const WALLET_A = '0x03681955065AF6EA51660dd63e7634fd0dE4d0a8'

const pc = createPublicClient({ transport: http(MONAD_RPC_URL) })
const abi = [
  { name:'balanceOf', type:'function', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'uint256'}] },
  { name:'totalSupply', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'owner', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'address'}] },
]
const read = (addr, fn, args=[]) => pc.readContract({ address: addr, abi, functionName: fn, args }).catch(e => `-(${(e.shortMessage||e.message||'').slice(0,40)})`)
const fmt = (v) => typeof v === 'bigint' ? formatUnits(v, 6) : v

for (const [label, tok] of [['USDC', USDC_ADDRESS], ['aUSDC', AUSDC_ADDRESS]]) {
  console.log(`\n=== ${label} ${tok} ===`)
  console.log('  totalSupply       :', fmt(await read(tok, 'totalSupply')))
  console.log('  owner()           :', await read(tok, 'owner'))
  console.log('  bal[operator BD84]:', fmt(await read(tok, 'balanceOf', [OPERATOR])))
  console.log('  bal[access_core]  :', fmt(await read(tok, 'balanceOf', [ACCESS_CORE])))
  console.log('  bal[wallet A]     :', fmt(await read(tok, 'balanceOf', [WALLET_A])))
}

// who has actually minted aUSDC on monad? (Transfer from 0x0)
console.log('\n=== recent aUSDC mints (Transfer from 0x0) ===')
try {
  const latest = await pc.getBlockNumber()
  const from = latest - 400000n > 0n ? latest - 400000n : 0n
  const logs = await pc.getLogs({ address: AUSDC_ADDRESS,
    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
    args: { from: '0x0000000000000000000000000000000000000000' }, fromBlock: from, toBlock: latest })
  console.log(`  blocks ${from}..${latest}: ${logs.length} mint(s)`)
  for (const l of logs.slice(-5)) console.log(`   -> to ${l.args.to}  amount ${fmt(l.args.value)}  (blk ${l.blockNumber})`)
} catch (e) { console.log('  getLogs failed:', e.shortMessage || e.message) }
