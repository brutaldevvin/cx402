import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const solc = require('solc')

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = readFileSync(join(root, 'src', 'AUSDx.sol'), 'utf8')

const input = {
  language: 'Solidity',
  sources: { 'AUSDx.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}

const out = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (out.errors ?? []).filter((e) => e.severity === 'error')
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join('\n'))
  process.exit(1)
}
;(out.errors ?? []).forEach((w) => console.warn(w.formattedMessage))

const c = out.contracts['AUSDx.sol']['AUSDx']
const artifact = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }
mkdirSync(join(root, 'artifacts'), { recursive: true })
writeFileSync(join(root, 'artifacts', 'AUSDx.json'), JSON.stringify(artifact, null, 2))
console.log(`compiled AUSDx (solc ${solc.version()}) -> artifacts/AUSDx.json  [${artifact.bytecode.length / 2 - 1} bytes]`)
