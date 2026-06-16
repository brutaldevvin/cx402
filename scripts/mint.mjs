import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const i = t.indexOf('='); if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}
const { CLEANVERSE_APP_ID, CLEANVERSE_APP_KEY, CLEANVERSE_COOPERATE_BASE,
        AUSDC_ADDRESS, CHAIN } = env

// which wallet: 'A' (buyer / W_PKEY) or 'B' (seller / W2_PKEY)
const which = (process.argv[2] || 'A').toUpperCase()
const pkey = which === 'B' ? env.W2_PKEY : env.W_PKEY
const customerId = which === 'B' ? 'cx402seller0001monad' : 'cx402buyer0001monad'
const subGroup = 'CD'   // matches the verified-working mint (subTier 9 -> tier 20 -> clears aUSDC)
const addr = privateKeyToAccount(pkey).address

const key = Buffer.from(CLEANVERSE_APP_KEY, 'base64')
const aesEncrypt = (plain) => {
  const c = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16, 0))
  return c.update(plain, 'utf8', 'base64') + c.final('base64')
}
const post = async (path, bodyObj, enc = false) => {
  const body = enc ? { data: aesEncrypt(JSON.stringify(bodyObj)) } : bodyObj
  const r = await fetch(`${CLEANVERSE_COOPERATE_BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-id': CLEANVERSE_APP_ID },
    body: JSON.stringify(body),
  })
  let data; try { data = await r.json() } catch { data = await r.text() }
  return { status: r.status, data }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

console.log(`=== MINT A-Pass for wallet ${which}: ${addr} (subTier 99, subGroup ${subGroup}) ===`)
const mintBody = {
  customerId, kycSource: 'sumsub', kycId: `cx402kyc-${which}`, subTier: 9, subGroup, override: false,
  expirationTime: 1863690034,
  wallet: { address: addr, chain: CHAIN },
  identityDataList: [{ idType: 'Passport', fullName: `CX402 Test ${which === 'B' ? 'Seller' : 'Buyer'}`,
    idNumber: `CX402TEST-${which}`, validUntil: '2030-12-31', issuingCountryISO2: 'US' }],
}
let res = await post('generate_apass', mintBody, true)
console.log(JSON.stringify(res.data, null, 2))
// code 1000 = group-overwrite warning -> retry with override
if (res.data?.code === '1000') {
  console.log('\n-> code 1000, retrying with override:true')
  res = await post('generate_apass', { ...mintBody, override: true }, true)
  console.log(JSON.stringify(res.data, null, 2))
}

console.log('\n=== query_apass (what tier did we get?) ===')
console.log(JSON.stringify((await post('query_apass', { chain: CHAIN, address: addr })).data, null, 2))

console.log('\n=== verify_apass vs aUSDC (the oracle: code 4 = clears) ===')
for (let i = 1; i <= 4; i++) {
  const v = await post('verify_apass', { chain: CHAIN, atoken: AUSDC_ADDRESS, address: addr })
  console.log(`try ${i}:`, JSON.stringify(v.data?.data ?? v.data))
  if (v.data?.data?.code === 4) break
  if (i < 4) await sleep(4000)  // allow on-chain confirmation
}
