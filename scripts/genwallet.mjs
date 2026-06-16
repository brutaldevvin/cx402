import { readFileSync, appendFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const envPath = new URL('../.env', import.meta.url)
const envText = readFileSync(envPath, 'utf8')

if (envText.includes('W2_PKEY=')) {
  // already generated - just show the address
  const pk = envText.split('\n').find(l => l.startsWith('W2_PKEY='))?.split('=')[1]?.trim()
  console.log('W2 already exists:', privateKeyToAccount(pk).address)
} else {
  const pk = generatePrivateKey()
  const addr = privateKeyToAccount(pk).address
  appendFileSync(envPath, `\n# Second testnet wallet (verified seller)\nW2_PKEY=${pk}\n`)
  console.log('W2 generated (verified seller):', addr)
}

// echo both addresses for the ask
const text = readFileSync(envPath, 'utf8')
const get = (k) => text.split('\n').find(l => l.startsWith(k + '='))?.split('=')[1]?.trim()
console.log('\nWallet A (buyer) :', privateKeyToAccount(get('W_PKEY')).address)
console.log('Wallet B (seller):', privateKeyToAccount(get('W2_PKEY')).address)
