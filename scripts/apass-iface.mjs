import { readFileSync } from 'node:fs'
import { createPublicClient, http } from 'viem'
const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#'))continue; const i=t.indexOf('='); if(i<0)continue
  env[t.slice(0,i).trim()]=t.slice(i+1).trim()
}
const APASS = env.APASS_ADDRESS
const pc = createPublicClient({ transport: http(env.MONAD_RPC_URL) })

const APASS_HOLDER_A = '0x03681955065AF6EA51660dd63e7634fd0dE4d0a8' // ours, A-Pass'd
const APASS_HOLDER_X = '0xb169780186349607224267d7aed7ae387b03a8ab' // holds aUSDC -> must have A-Pass
const NO_APASS       = '0x000000000000000000000000000000000000dEaD' // definitely none

// 1) EIP-1967 implementation slot
const IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
const implRaw = await pc.getStorageAt({ address: APASS, slot: IMPL_SLOT }).catch(()=>null)
const impl = implRaw && implRaw !== '0x' ? '0x' + implRaw.slice(-40) : '(none/!=1967)'
console.log('A-Pass:', APASS)
console.log('impl (EIP-1967):', impl)
if (impl.startsWith('0x') && impl.length===42) {
  const code = await pc.getCode({ address: impl }).catch(()=>null)
  console.log('impl code:', code && code!=='0x' ? (code.length/2-1)+' bytes' : 'none')
}

const tryFn = async (label, abi, fn, args) => {
  try {
    const v = await pc.readContract({ address: APASS, abi, functionName: fn, args })
    console.log(`  ${label} =>`, v)
  } catch (e) { console.log(`  ${label} => revert/none (${(e.shortMessage||'').slice(0,45)})`) }
}

console.log('\n=== balanceOf (ERC-721-style membership) ===')
const balAbi = [{name:'balanceOf',type:'function',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]}]
await tryFn('balanceOf(A-Pass holder A)', balAbi, 'balanceOf', [APASS_HOLDER_A])
await tryFn('balanceOf(A-Pass holder X)', balAbi, 'balanceOf', [APASS_HOLDER_X])
await tryFn('balanceOf(NO A-Pass dead) ', balAbi, 'balanceOf', [NO_APASS])

console.log('\n=== supportsInterface ===')
const siAbi = [{name:'supportsInterface',type:'function',stateMutability:'view',inputs:[{type:'bytes4'}],outputs:[{type:'bool'}]}]
await tryFn('ERC721 (0x80ac58cd) ', siAbi, 'supportsInterface', ['0x80ac58cd'])
await tryFn('ERC1155(0xd9b67a26) ', siAbi, 'supportsInterface', ['0xd9b67a26'])

console.log('\n=== candidate A-Pass validity getters ===')
for (const [name, out] of [['isValid','bool'],['hasAPass','bool'],['isActive','bool'],['valid','bool'],['getTier','uint256'],['tierOf','uint256'],['statusOf','uint256']]) {
  await tryFn(`${name}(holder A)`, [{name,type:'function',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:out}]}], name, [APASS_HOLDER_A])
}
