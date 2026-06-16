import { describe, it, expect } from 'vitest'
import { aesEncrypt, aesDecrypt } from '../src/crypto'
import { CleanverseClient, loadConfigFromEnv, VerifyCode } from '../src'

// Monad testnet, known from our setup
const MONAD = 'monad'
const AUSDC = '0xaC0893567D43C3E7e6e35a72803df05416C1f20D'
const WALLET_A = '0x03681955065AF6EA51660dd63e7634fd0dE4d0a8' // our A-Pass'd buyer, tier 20
const NO_APASS = '0x000000000000000000000000000000000000dEaD' // never registered

describe('crypto (AES-256-CBC, zero IV)', () => {
  it('round-trips a JSON body', () => {
    const key = Buffer.alloc(32, 7).toString('base64')
    const ct = aesEncrypt('{"hello":"world"}', key)
    expect(ct).not.toBe('{"hello":"world"}')
    expect(aesDecrypt(ct, key)).toBe('{"hello":"world"}')
  })
})

const cfg = loadConfigFromEnv()
const live = cfg.apiId && cfg.appKey ? describe : describe.skip

live('live sandbox - compliance gate (Monad)', () => {
  const cv = new CleanverseClient(cfg)

  it('verifyApass: A-Pass\'d wallet A clears aUSDC (code 4)', async () => {
    const r = await cv.verifyApass({ chain: MONAD, atoken: AUSDC, address: WALLET_A })
    expect(r.code).toBe(VerifyCode.Valid)
  })

  it('verifyApass: unregistered wallet is blocked (code 2, no A-Pass)', async () => {
    const r = await cv.verifyApass({ chain: MONAD, atoken: AUSDC, address: NO_APASS })
    expect(r.code).toBe(VerifyCode.NoApass)
  })

  it('isClean: true for verified, false for unverified', async () => {
    expect(await cv.isClean({ chain: MONAD, atoken: AUSDC, address: WALLET_A })).toBe(true)
    expect(await cv.isClean({ chain: MONAD, atoken: AUSDC, address: NO_APASS })).toBe(false)
  })

  it('queryApass: wallet A is tier 20 and active', async () => {
    const rec = await cv.queryApass({ chain: MONAD, address: WALLET_A })
    expect(rec).not.toBeNull()
    expect(rec!.tier).toBe('20')
    expect(rec!.status).toBe(1)
    expect(rec!.cvRecordId).toBeTruthy()
    expect(rec!.currentKycHash).toBeTruthy()
  })

  it('queryApass: unregistered wallet returns null', async () => {
    const rec = await cv.queryApass({ chain: MONAD, address: NO_APASS })
    expect(rec).toBeNull()
  })
})
