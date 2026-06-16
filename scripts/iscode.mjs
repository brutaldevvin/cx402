import { readFileSync } from 'node:fs'
import { createPublicClient, http } from 'viem'
const env={}; for(const l of readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')){const t=l.trim();if(!t||t.startsWith('#'))continue;const i=t.indexOf('=');if(i<0)continue;env[t.slice(0,i).trim()]=t.slice(i+1).trim()}
const pc=createPublicClient({transport:http(env.MONAD_RPC_URL)})
for(const [name,a] of [['faucet institution 0x8e08','0x8e084646080a35347b2d053dd72f550f12245c8b'],['operator 0xBd84','0xBd8428761efB5384C4945d16de56817Caa6903dF'],['usdc owner 0x7A15','0x7A154EA9156D354504ad9A401380AA548039BE8b']]){
  const code=await pc.getCode({address:a}).catch(()=>null)
  console.log(`${name}: ${code&&code!=='0x'?'CONTRACT ('+(code.length/2-1)+' bytes)':'EOA (no code)'}`)
}
