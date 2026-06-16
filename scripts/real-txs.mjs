import { readFileSync } from 'node:fs'
const env={}; for(const l of readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;env[t.slice(0,i).trim()]=t.slice(i+1).trim()}
const A='0x03681955065AF6EA51660dd63e7634fd0dE4d0a8'
const rpc=async(m,p)=>(await(await fetch(env.MONAD_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})})).json())
const r=await rpc('alchemy_getAssetTransfers',[{fromBlock:'0x0',toBlock:'latest',fromAddress:A,category:['erc20'],contractAddresses:[env.SETTLEMENT_ASSET,env.AUSDC_ADDRESS],withMetadata:false,maxCount:'0xa',order:'desc'}])
const t=r.result?.transfers||[]
for(const x of t.slice(0,8)) console.log(`${x.asset||'?'}  ${x.value}  hash ${x.hash}`)
