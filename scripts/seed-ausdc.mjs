// Run real 0.001 aUSDC settlements through the local facilitator and print the
// tx hashes, used to seed the page ledger/ticker with honest, clickable proofs.
const BASE = process.env.BASE || 'http://localhost:8080'
const A = '0x03681955065AF6EA51660dd63e7634fd0dE4d0a8'
const SUP = '0xBe58C5eE13bE6a4aD8C9735c10a2967ED528CfBB'
const post = (b) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })

const sup = await (await fetch(BASE + '/supported')).json()
const ASSET = sup.kinds[0].asset, NETWORK = sup.kinds[0].network
console.log('asset', ASSET, 'network', NETWORK)

// generous mandate so all three clear (this is just to mint proofs)
await fetch(BASE + '/policy', post({ agent: A, policy: { budget: '1000000', maxPerTx: '100000', minTier: 0 } }))

const hashes = []
const purposes = ['market-data feed', 'inference credits', 'storage']
for (let i = 0; i < 3; i++) {
  const amount = '1000' // 0.001 aUSDC at 6dp
  const payment = { scheme: 'exact', network: NETWORK, payer: A, payee: SUP, asset: ASSET, amount }
  const requirements = { scheme: 'exact', network: NETWORK, asset: ASSET, payTo: SUP, maxAmountRequired: amount, description: purposes[i] }
  const r = await fetch(BASE + '/settle', post({ payment, requirements }))
  const b = await r.json()
  const tx = b.receipt?.payment?.txHash
  console.log(`settle ${i}: status=${r.status} success=${b.success} tx=${tx} reason=${b.compliance?.reason || ''}`)
  if (tx) hashes.push(tx)
}
console.log('SEEDHASHES=' + JSON.stringify(hashes))
