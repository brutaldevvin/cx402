import { readFileSync } from 'node:fs'
import { createPublicClient, http } from 'viem'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const { MONAD_RPC_URL, APASS_ADDRESS, AUSDC_ADDRESS, USDC_ADDRESS } = env

const pc = createPublicClient({ transport: http(MONAD_RPC_URL) })
const chainId = await pc.getChainId()
console.log('RPC:', MONAD_RPC_URL.split('/v2/')[0] + '/v2/***')
console.log('chainId reported by RPC:', chainId, chainId === 10143 ? '(Monad TESTNET ✅)' : chainId === 143 ? '(Monad MAINNET ⚠️)' : '(unknown)')

const meta = [
  { n: 'name', t: 'string' }, { n: 'symbol', t: 'string' }, { n: 'decimals', t: 'uint8' },
].map(({ n, t }) => ({ name: n, type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: t }] }))

const probe = async (label, address) => {
  const code = await pc.getCode({ address }).catch(() => null)
  const deployed = code && code !== '0x'
  const read = async (fn) => pc.readContract({ address, abi: meta, functionName: fn }).catch(() => '-')
  const [name, symbol, decimals] = deployed ? await Promise.all([read('name'), read('symbol'), read('decimals')]) : ['-', '-', '-']
  console.log(`\n${label}  ${address}`)
  console.log(`  deployed on this chain: ${deployed ? 'YES ('+(code.length/2-1)+' bytes)' : 'NO - empty'}`)
  console.log(`  name=${name}  symbol=${symbol}  decimals=${decimals}`)
}
await probe('A-Pass', APASS_ADDRESS)
await probe('aUSDC ', AUSDC_ADDRESS)
await probe('USDC  ', USDC_ADDRESS)

// --- compare sandbox vs production chain config for monad ---
const cfg = async (base) => {
  try {
    const r = await fetch(`${base}/api/skills/query_chain_config`, { method: 'GET' })
    const j = await r.json()
    const m = j?.data?.chains?.find(c => c.chain === 'monad')
    if (!m) return `no monad entry (status ${r.status})`
    return { chain_id: m.chain_id, apass: m.apass_address, tokens: (m.tokens || []).map(t => `${t.symbol}=${t.token_address}`) }
  } catch (e) { return `err: ${e.message}` }
}
console.log('\n=== chain_config: monad entry ===')
console.log('SANDBOX (uatapi):', JSON.stringify(await cfg('https://uatapi.cleanverse.com'), null, 2))
console.log('PROD    (api)   :', JSON.stringify(await cfg('https://api.cleanverse.com'), null, 2))
