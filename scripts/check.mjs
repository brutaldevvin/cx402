import { readFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'

// --- load .env (split on first '=' so Base64 '=' padding survives) ---
const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}

const { CLEANVERSE_APP_ID, CLEANVERSE_COOPERATE_BASE, CLEANVERSE_SKILLS_BASE,
        AUSDC_ADDRESS, W_PKEY, CHAIN } = env

const account = privateKeyToAccount(W_PKEY)
const addr = account.address
console.log('wallet address:', addr)
console.log('chain:', CHAIN, '\n')

const post = async (base, path, body, headers = {}) => {
  const r = await fetch(`${base}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  let data
  try { data = await r.json() } catch { data = await r.text() }
  return { status: r.status, data }
}

const apiId = { 'api-id': CLEANVERSE_APP_ID }

console.log('=== 1) verify_apass (COOPERATE, tests App ID + role) ===')
console.log(JSON.stringify(await post(CLEANVERSE_COOPERATE_BASE, 'verify_apass',
  { chain: CHAIN, atoken: AUSDC_ADDRESS, address: addr }, apiId), null, 2))

console.log('\n=== 2) query_apass (COOPERATE) ===')
console.log(JSON.stringify(await post(CLEANVERSE_COOPERATE_BASE, 'query_apass',
  { chain: CHAIN, address: addr }, apiId), null, 2))

console.log('\n=== 3) query_apass (SKILLS, no auth - fallback gate) ===')
console.log(JSON.stringify(await post(CLEANVERSE_SKILLS_BASE, 'query_apass',
  { chain: CHAIN, address: addr }), null, 2))

console.log('\n=== 4) query_deposit_address (SKILLS) ===')
console.log(JSON.stringify(await post(CLEANVERSE_SKILLS_BASE, 'query_deposit_address',
  { chain: CHAIN, address: addr }), null, 2))
