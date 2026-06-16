# cx402 for judges

**Live demo: https://cx402.up.railway.app**

A 90-second guide to what this is, what to click, and how to confirm it is real.

## 1. The problem

x402 lets an AI agent pay for things over HTTP. But an autonomous agent moving a
stablecoin has no idea whether that payment is *allowed*: is the counterparty a
verified, sanctioned-clean entity? Is the agent staying inside the budget and
rules its operator set? Without that, no institution, PSP, or merchant can accept
agent payments.

**cx402 is the compliance layer that answers it.** x402 lets agents pay. cx402
makes those payments acceptable to institutions, and gives the merchant proof the
funds were clean.

## 2. What to click (about 90 seconds)

1. Open **https://cx402.up.railway.app**.
2. Scroll to **"Set a mandate. Run the agent."** Leave the defaults (budget
   `0.004`, max per payment `0.002` aUSDC) and press **"run procurement agent."**
3. Watch the agent attempt six payments. Expected outcomes, in order:
   - payment 1 (`0.001` to supplier) -> **CLEARED**, real on-chain tx
   - payment 2 (`0.001` to supplier) -> **CLEARED**, real on-chain tx
   - payment 3 (`0.001` to an unknown seller) -> **BLOCKED by identity** (no A-Pass)
   - payment 4 (`0.005` to supplier) -> **BLOCKED by policy** (over per-tx cap)
   - payment 5 (`0.001` to supplier) -> **CLEARED**, real on-chain tx
   - payment 6 (`0.002` to supplier) -> **BLOCKED by policy** (over budget)
4. On any cleared receipt, click **the settled tx** (opens MonadScan) and
   **"travel rule: official report"** (opens the real Cleanverse compliance PDF).

Only cleared payments move money (0.001 aUSDC each). The blocks are refused before
settlement, so they cost nothing.

## 3. What makes it live (not a mockup)

- **Liveness probe:** https://cx402.up.railway.app/health returns `status: ok`
  and shows Cleanverse reachable, Monad RPC reachable, both parties A-Pass verified
  (code 4), the facilitator's gas, the payer balance, and the allowance. Real time.
- **What it settles:** https://cx402.up.railway.app/supported shows the network
  (`eip155:10143`, Monad testnet) and the settlement asset, **real Cleanverse aUSDC**
  `0xaC0893567D43C3E7e6e35a72803df05416C1f20D`.
- **Real settlements on MonadScan** (aUSDC transfers from the live facilitator):
  - https://testnet.monadscan.com/tx/0xddaa7a3ac684a479f30dc8c8ea29524e1c27367f1778d8c140034a849929fc36
  - https://testnet.monadscan.com/tx/0xedfa58eef84cc5a411e3dab49f1eeacafb7240e8402607b54f803f168e38c9f6
  - https://testnet.monadscan.com/tx/0xa62713d4a811b1ea34e256a08829ed2c76cd519ac3abd10e6378afb8b086b2f1
- **A real Cleanverse compliance report** for a settled tx (PDF):
  https://cx402.up.railway.app/report?tx=0xddaa7a3ac684a479f30dc8c8ea29524e1c27367f1778d8c140034a849929fc36&w=0x03681955065AF6EA51660dd63e7634fd0dE4d0a8
- **48 tests pass live on Monad** (`pnpm test`), including the EIP-191 signed
  mandate (valid, invalid, expired, replayed) and a receipt-has-no-PII check.

## Probe the API directly (for the API-minded judge)

- **Merchant 402 flow** (the x402 protocol, concrete):
  ```
  curl -i https://cx402.up.railway.app/premium
  ```
  No payment returns a `402` challenge with the required compliant payment. A
  request carrying a valid `X-PAYMENT` settles on-chain and returns the resource
  plus the verified receipt in the `X-PAYMENT-RESPONSE` header. This is the exact
  flow `@cx402/middleware` gives a real merchant in one line.
- **Signed mandate, verified live:** https://cx402.up.railway.app/proof/mandate
  accepts a valid EIP-191 mandate and rejects wrong-signer, expired, tampered,
  and replayed. The browser demo uses unsigned policy for convenience; this is
  the production path.
- **Signed payment intent, verified live:** https://cx402.up.railway.app/proof/payment-intent
  accepts a valid per-payment intent and rejects a tampered payee, amount, or
  resource (the signature is bound to all of them), plus expired and replayed.
  The demo settles via a pre-approved testnet allowance for reliability; this is
  x402's per-payment authorization layer, implemented and provable today.
- **Robust errors:** malformed bodies return structured JSON, never a 500. Try
  `curl -i -X POST https://cx402.up.railway.app/verify -d '{}' -H 'content-type: application/json'`
  (returns `400 invalid_intent`).

The page's **live proof panel** at the top reads all of this off the running
facilitator the moment you load the site.

## 4. Cleanverse primitives used

| Primitive | Role in cx402 |
| --- | --- |
| **A-Pass** | payer + payee identity; both must be verified to settle |
| **aUSDC (Wrapped A-Token)** | the clean, A-Pass-gated settlement asset |
| **`verify_apass`** | the pre-settlement compliance gate (code 4 = pass) |
| **`query_apass`** | privacy-preserving receipt proof fields (cvRecordId, KYC hash, tier), no PII |
| **`download_travel_rule`** | the official audit/report path linked from every cleared receipt |
| **mandate model** | the operator's signed policy the agent cannot exceed |

The live deployment settles real aUSDC on Monad. `aUSDx` in the repo is only a
local testing stand-in, not what the demo uses.

## 5. Why this can be piloted

cx402 is middleware, not a product silo. A merchant adds one line
(`cx402Paywall`) to gate a route. An agent operator gives an agent a signed
mandate and an A-Pass'd wallet. A PSP or institution that already issues A-Passes
and aUSDC can route agent payments through cx402 to get: identity on both sides,
policy enforcement, clean settlement, and a signed, auditable, PII-free receipt
with an official Travel-Rule report attached. Everything a compliance team needs
to sign off on autonomous stablecoin payments, and nothing it cannot.

**Who would pilot it:**
- **MCP and API providers** that want paid agent access, with proof the payer is verified and the payment authorized.
- **PSPs and payment facilitators** offering compliant agent payments as a product.
- **Data providers** charging agents per call, who need clean, auditable settlement.
- **Cleanverse member institutions** piloting agent commerce on rails they already issue (A-Pass, aUSDC).
