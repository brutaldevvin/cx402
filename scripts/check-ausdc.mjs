import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { createPublicClient, http, formatUnits } from 'viem'
const env={}; for(const l of readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;env[t.slice(0,i).trim()]=t.slice(i+1).trim()}
const A='0x03681955065AF6EA51660dd63e7634fd0dE4d0a8', B='0xBe58C5eE13bE6a4aD8C9735c10a2967ED528CfBB'
const AUSDC=env.AUSDC_ADDRESS, APASS=env.APASS_ADDRESS
const pc=createPublicClient({transport:http(env.MONAD_RPC_URL)})
const erc=[{name:'balanceOf',type:'function',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]}]
const bal=(a,t,d=6)=>pc.readContract({address:t,abi:erc,functionName:'balanceOf',args:[a]}).then(v=>formatUnits(v,d)).catch(e=>'err:'+(e.shortMessage||'').slice(0,30))
for(const [n,a] of [['A (0x0368)',A],['B (0xBe58)',B]]){
  console.log(`${n}: aUSDC=${await bal(a,AUSDC)}  apass-NFT=${await bal(a,APASS,0)}`)
}
// reconcile with the cooperate verify_apass
const key=Buffer.from(env.CLEANVERSE_APP_KEY,'base64')
const post=async(p,b)=>(await(await fetch(env.CLEANVERSE_COOPERATE_BASE+'/'+p,{method:'POST',headers:{'Content-Type':'application/json','api-id':env.CLEANVERSE_APP_ID},body:JSON.stringify(b)})).json())
for(const [n,a] of [['A',A],['B',B]]){
  const v=await post('verify_apass',{chain:'monad',atoken:AUSDC,address:a})
  console.log(`verify_apass(${n}) → code ${v.data?.code} (${v.data?.message})`)
}
