import { readFileSync } from 'node:fs'
import { createPublicClient, http, formatUnits, formatEther } from 'viem'
const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const i=t.indexOf('='); if(i<0)continue
  env[t.slice(0,i).trim()]=t.slice(i+1).trim()
}
const pc = createPublicClient({ transport: http(env.MONAD_RPC_URL) })
const erc = [{name:'balanceOf',type:'function',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]}]
const bal6 = (a,tok)=>pc.readContract({address:tok,abi:erc,functionName:'balanceOf',args:[a]}).then(v=>formatUnits(v,6)).catch(()=>'err')
const minter = '0x7A154EA9156D354504ad9A401380AA548039BE8b'
console.log('USDC owner/minter:', minter)
console.log('  MON  :', formatEther(await pc.getBalance({address:minter})))
console.log('  USDC :', await bal6(minter, env.USDC_ADDRESS))
console.log('  aUSDC:', await bal6(minter, env.AUSDC_ADDRESS))
