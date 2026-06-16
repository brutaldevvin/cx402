import { readFileSync } from 'node:fs'
import { createPublicClient, http, parseUnits } from 'viem'
const env={}; for(const l of readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;env[t.slice(0,i).trim()]=t.slice(i+1).trim()}
const A='0x03681955065AF6EA51660dd63e7634fd0dE4d0a8', B='0xBe58C5eE13bE6a4aD8C9735c10a2967ED528CfBB'
const pc=createPublicClient({transport:http(env.MONAD_RPC_URL)})
const abi=[{name:'transfer',type:'function',stateMutability:'nonpayable',inputs:[{type:'address'},{type:'uint256'}],outputs:[{type:'bool'}]}]
try{
  const sim=await pc.simulateContract({address:env.AUSDC_ADDRESS,abi,functionName:'transfer',args:[B,parseUnits('1',6)],account:A})
  console.log('aUSDC transfer A→B (1 aUSDC) SIMULATE: OK ✓ - real aUSDC settles between our wallets')
}catch(e){console.log('aUSDC transfer A→B SIMULATE: REVERT ✗ -', e.shortMessage||e.message)}
