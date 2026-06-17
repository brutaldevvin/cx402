import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createPublicClient, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function parseEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const i = t.indexOf('='); if (i === -1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

const env = parseEnv(join(root, '..', '..', '.env'))
const depPath = join(root, 'deployments.json')
const token = existsSync(depPath) ? (JSON.parse(readFileSync(depPath, 'utf8')).monad?.aUSDx as string) : undefined
const artifact = JSON.parse(readFileSync(join(root, 'artifacts', 'AUSDx.json'), 'utf8'))
const abi = artifact.abi

const monad = { id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [env.MONAD_RPC_URL ?? ''] } } } as const
const NO_APASS = '0x1234567890123456789012345678901234567890' as const

const ready = token && env.W_PKEY && env.W2_PKEY && env.MONAD_RPC_URL
const live = ready ? describe : describe.skip

live('aUSDx - A-Pass-enforcing stand-in token (Monad)', () => {
  const pc = createPublicClient({ chain: monad, transport: http(env.MONAD_RPC_URL) })
  const A = privateKeyToAccount(env.W_PKEY as `0x${string}`).address
  const B = privateKeyToAccount(env.W2_PKEY as `0x${string}`).address
  const read = (fn: string, args: unknown[]) => pc.readContract({ address: token as `0x${string}`, abi, functionName: fn, args })

  it('both A-Pass\'d wallets hold aUSDx (mint succeeded)', async () => {
    // balances drift as the facilitator settles real transfers, so assert > 0, not an exact amount
    expect((await read('balanceOf', [A])) as bigint).toBeGreaterThan(0n)
    expect((await read('balanceOf', [B])) as bigint).toBeGreaterThan(0n)
  })

  it('transfer between two A-Pass\'d wallets is allowed', async () => {
    const sim = pc.simulateContract({ address: token as `0x${string}`, abi, functionName: 'transfer', args: [B, parseUnits('1', 6)], account: A })
    await expect(sim).resolves.toBeTruthy()
  })

  it('transfer to a NON-A-Pass wallet REVERTS (clean funds by construction)', async () => {
    const sim = pc.simulateContract({ address: token as `0x${string}`, abi, functionName: 'transfer', args: [NO_APASS, parseUnits('1', 6)], account: A })
    await expect(sim).rejects.toThrow(/NoAPass/i)
  })

  it('mint to a NON-A-Pass wallet REVERTS', async () => {
    const sim = pc.simulateContract({ address: token as `0x${string}`, abi, functionName: 'mint', args: [NO_APASS, parseUnits('1', 6)], account: A })
    await expect(sim).rejects.toThrow(/NoAPass/i)
  })
})
