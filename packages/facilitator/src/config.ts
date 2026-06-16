import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadConfigFromEnv } from '@cx402/cleanverse'
import type { CleanverseConfig } from '@cx402/cleanverse'
import type { Address } from './types'

export interface FacilitatorConfig {
  cleanverse: CleanverseConfig
  /** Cleanverse chain slug (e.g. "monad") */
  chain: string
  /** CAIP-2 network id (e.g. "eip155:10143") */
  network: string
  chainId: number
  rpcUrl: string
  explorerBase: string
  /** what actually moves on settlement (aUSDx stand-in now, real aUSDC later) */
  settlementAsset: Address
  /** the REAL Cleanverse A-Token the A-Pass gate verifies identity against (aUSDC) */
  complianceAsset: Address
  settlementMode: 'ausdx' | 'simulated'
  /** facilitator EOA: settles transferFrom + signs receipts. Optional (simulated mode). */
  facilitatorPkey?: Address
  apassAddress: Address
  /** DEMO ONLY: allow unsigned /policy registration (the page can't hold a key). */
  demoAllowUnsignedPolicy: boolean
  /** public demo payer/payee, used by the /health probe (no keys needed). */
  demoPayer: Address
  demoPayee: Address
}

function readEnvFile(envPath?: string): Record<string, string> {
  let path = envPath
  if (!path) {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, '.env')
      if (existsSync(candidate)) { path = candidate; break }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  if (!path || !existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i === -1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

export function loadFacilitatorConfig(opts: { envPath?: string } = {}): FacilitatorConfig {
  const cleanverse = loadConfigFromEnv(opts.envPath ? { envPath: opts.envPath } : {})
  const raw = readEnvFile(opts.envPath)
  const get = (k: string, fb = ''): string => process.env[k] ?? raw[k] ?? fb

  const pkey = get('FACILITATOR_PKEY')
  const asset = get('SETTLEMENT_ASSET') as Address
  const mode = get('SETTLEMENT_MODE', 'ausdx') as 'ausdx' | 'simulated'

  return {
    cleanverse,
    chain: get('CHAIN', 'monad'),
    network: get('NETWORK', 'eip155:10143'),
    chainId: Number(get('CHAIN_ID', '10143')),
    rpcUrl: get('MONAD_RPC_URL'),
    explorerBase: get('EXPLORER_BASE', 'https://testnet.monadscan.com/tx/'),
    settlementAsset: asset,
    complianceAsset: (get('COMPLIANCE_ASSET') || get('AUSDC_ADDRESS')) as Address,
    // fall back to simulated when we lack the means to settle on-chain
    settlementMode: mode === 'ausdx' && pkey && asset ? 'ausdx' : 'simulated',
    facilitatorPkey: pkey ? (pkey as Address) : undefined,
    apassAddress: get('APASS_ADDRESS') as Address,
    demoAllowUnsignedPolicy: ['true', '1', 'yes', 'on'].includes(get('DEMO_ALLOW_UNSIGNED_POLICY').trim().toLowerCase()),
    demoPayer: get('DEMO_PAYER', '0x03681955065AF6EA51660dd63e7634fd0dE4d0a8') as Address,
    demoPayee: get('DEMO_PAYEE', '0xBe58C5eE13bE6a4aD8C9735c10a2967ED528CfBB') as Address,
  }
}
