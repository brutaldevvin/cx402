# cx402

**The compliant version of x402.** Compliance-gated, audit-ready agent payments using Cleanverse primitives, settled on Monad.

**Live demo:** https://cx402.up.railway.app

x402 lets an AI agent pay for a resource over HTTP. cx402 adds the part finance actually requires: every payment is checked against two guardrails before any money moves, and each cleared payment emits a signed, privacy-preserving receipt.

## Positioning

**x402 lets agents pay. cx402 makes those payments acceptable to institutions.**

By analogy: Stripe answers whether a merchant can accept a card. cx402 answers a different question, whether an autonomous stablecoin payment should be allowed to move at all, and it hands the merchant cryptographic proof that the funds were clean and both parties were verified.

It is not a wallet, a checkout clone, or a chatbot. It is compliance middleware for agentic stablecoin commerce: the layer an agent's payment passes through so an institution, PSP, or merchant can accept it.

## Two guardrails

1. **Identity.** Both parties must hold a valid Cleanverse A-Pass. The check runs against the live registry before settlement, so non-verified counterparties are blocked before funds move.
2. **Policy.** The operator sets a mandate the agent cannot exceed: a spending budget that depletes across payments, a per-payment cap, a minimum counterparty tier, and an optional allow-list. Identity is checked first, then policy.

Anything that fails either guardrail is refused cleanly, with the reason, and never settles. And every attempt, cleared or blocked, emits a signed receipt. A blocked attempt is an auditable record in its own right (who, why, no funds moved), so the refusals prove governance, not just settlement.

## How it works

```
AI agent  ->  402 server (+ middleware)  ->  cx402 facilitator  ->  Monad
pays per call     issues the challenge        verify - policy - settle    aUSDC
```

The facilitator implements the x402 facilitator interface (`/verify`, `/settle`, `/supported`) and adds the policy layer and the receipt. Cleared payments settle real aUSDC on Monad and return a signed receipt that proves both parties were verified, with no personal data.

## How cx402 uses Cleanverse

cx402 is built directly on Cleanverse's compliance primitives. Each one maps to a specific job:

| Cleanverse primitive | How cx402 uses it |
| --- | --- |
| **A-Pass** | payer and payee identity. Both sides must hold a valid A-Pass before a payment can move. |
| **aUSDC (Wrapped A-Token)** | the clean settlement asset used after cx402 verifies both parties through Cleanverse A-Pass. |
| **`verify_apass`** | the pre-settlement compliance gate. Code 4 (valid, transfer allowed) is the only pass. |
| **`query_apass`** | the privacy-preserving proof fields on the receipt (cvRecordId, KYC hash, tier). No personal data. |
| **`download_travel_rule`** | the official audit path. Every cleared payment links to a real Cleanverse compliance report (PDF). |
| **Agent Skill / mandate model** | mandate-governed agent payments: the operator's signed policy that the agent cannot exceed. |

**Settlement asset, to be precise.** The live deployment settles **real Cleanverse aUSDC on Monad**. The repo also ships `aUSDx`, an A-Pass-enforcing ERC-20 stand-in, but that is only a local testing fallback for exercising the on-chain gate freely. It is not what the live demo uses.

## Security model

cx402 is infrastructure, so it is explicit about what is verified and what is production hardening.

### Signed Mandate (implemented)

A policy is never taken on trust. The operator signs a mandate and the facilitator verifies it before registering it. The payload:

```
{ agent, budget, maxPerTx, minTier, allowedCounterparties, nonce, expiresAt }
```

- Signed by the agent key, EIP-191 `personal_sign` over a canonical serialization.
- The facilitator recovers the signer and rejects the mandate unless it equals `agent`.
- Expired mandates (`expiresAt` in the past) are rejected.
- Nonces are single-use, so a replayed mandate is rejected. The nonce is only consumed after the signature checks out, so a forged signature cannot burn a real agent's nonce.

The browser demo holds no key, so unsigned policy registration is allowed only behind an explicit `DEMO_ALLOW_UNSIGNED_POLICY=true` flag, documented as demo-only. With the flag off, unsigned policy is rejected.

### Signed Payment Intent (production hardening)

The hackathon demo settles with a pre-approved testnet `transferFrom`: the payer approves the facilitator once, and the facilitator moves funds only within the verified, in-policy path. That proves the compliance flow end to end, but it is not how production should authorize each payment.

In production, each payment carries a signed intent:

```
{ payer, payee, asset, amount, network, resource, nonce, expiresAt }
```

signed per payment by the payer, or scoped by a session key or a bounded allowance. The facilitator verifies the intent signature alongside the identity and policy checks before settling, so no payment moves without explicit, replay-proof authorization from the payer.

This is not just a plan. The `PaymentIntentVerifier` is implemented and proven live at [`/proof/payment-intent`](https://cx402.up.railway.app/proof/payment-intent): it accepts a valid signed intent and rejects a tampered payee, amount, or resource (the signature is bound to all of them), plus expired and replayed intents. So the per-payment authorization layer is real and demonstrable today. To be plain about the demo: for reliability it settles via the pre-approved testnet allowance, enforcing Cleanverse identity and the signed mandate before moving funds, while the signed payment intent is the production path that binds each payment.

## Quick start

Buyer side. Give an agent a wallet and a mandate:

```ts
import { cx402 } from '@cx402/agent'

const agent = cx402.agent({
  address: '0xYourAgentWallet',
  facilitatorUrl: 'https://your-facilitator',
  policy: { budget: '0.05', maxPerTx: '0.01', minTier: 1 },
})

const r = await agent.pay({ payee: '0xSupplier', amount: '0.001', purpose: 'market-data feed' })
// r.ok === true   -> r.receipt, r.txHash
// r.ok === false  -> r.blockedBy ('identity' | 'policy'), r.reason
```

Seller side. Gate a route behind a compliant paywall in one line of middleware:

```ts
import { cx402Paywall } from '@cx402/middleware'

app.use('/premium', cx402Paywall({ price: '0.001', payTo: '0xMerchant', facilitatorUrl: 'https://your-facilitator' }))
```

A request with no payment gets a 402 challenge. A request carrying a verified, in-policy payment settles, is served, and returns the receipt in the `X-PAYMENT-RESPONSE` header.

## Packages

| Package | What it is |
| --- | --- |
| `@cx402/facilitator` | the compliant x402 facilitator: identity gate, policy engine, settlement, signed receipts, and the explainer UI |
| `@cx402/agent` | buyer SDK: give an agent a wallet and a mandate, it pays only when verified and in policy |
| `@cx402/middleware` | seller paywall: gate any Hono route behind a compliant 402 |
| `@cx402/cleanverse` | typed Cleanverse client: A-Pass verification, queries, AES-encrypted cooperate calls |
| `contracts` | aUSDx, an A-Pass-enforcing ERC-20 used to exercise the on-chain identity gate freely |

`apps/wall` is the explainer page, served by the facilitator at `/`.

## Run it locally

```bash
pnpm install
pnpm demo    # a procurement agent pays suppliers on Monad: cleared, identity-blocked, policy-blocked
pnpm test    # the full suite, live on Monad testnet
```

Configuration is read from `.env` (see `.env.example`). The live demo settles real aUSDC at 0.001 per cleared payment.

## Deploy

The facilitator serves the page and the API from a single container. See [DEPLOY.md](DEPLOY.md) for Railway or Render in a few minutes.

## Built on

- **x402**, the HTTP 402 payment protocol for agents
- **Cleanverse**, A-Pass identity and the aUSDC A-Token
- **Monad**, the settlement chain
