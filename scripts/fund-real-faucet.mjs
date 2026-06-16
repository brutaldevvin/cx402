import { readFileSync } from 'node:fs'
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const i=t.indexOf('='); if(i<0)continue
  env[t.slice(0,i).trim()]=t.slice(i+1).trim()
}
const FAUCET_WALLET = '0x8e084646080a35347b2d053dd72f550f12245c8b'
const monad = { id:10143, name:'Monad', nativeCurrency:{name:'MON',symbol:'MON',decimals:18}, rpcUrls:{default:{http:[env.MONAD_RPC_URL]}} }
const account = privateKeyToAccount(env.W_PKEY)
const addr = account.address
const pc = createPublicClient({ chain: monad, transport: http(env.MONAD_RPC_URL) })
const wallet = createWalletClient({ account, chain: monad, transport: http(env.MONAD_RPC_URL) })
const post=async(p,b)=>(await(await fetch(env.CLEANVERSE_COOPERATE_BASE+'/'+p,{method:'POST',headers:{'Content-Type':'application/json','api-id':env.CLEANVERSE_APP_ID},body:JSON.stringify(b)})).json())

console.log('faucet wallet MON before:', formatEther(await pc.getBalance({address:FAUCET_WALLET})))
console.log('sending 1 MON ->', FAUCET_WALLET)
const hash = await wallet.sendTransaction({ to: FAUCET_WALLET, value: parseEther('1') })
console.log('  tx:', hash)
await pc.waitForTransactionReceipt({ hash })
console.log('faucet wallet MON after :', formatEther(await pc.getBalance({address:FAUCET_WALLET})))

console.log('\nretry faucet now that it has gas:')
console.log('  ausdc ->', JSON.stringify(await post('faucet',{chain:'monad',symbol:'ausdc',depositAddress:addr,amount:'1'})))
console.log('  usdc  ->', JSON.stringify(await post('faucet',{chain:'monad',symbol:'usdc', depositAddress:addr,amount:'1'})))
