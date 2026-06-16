# cx402

**The compliant version of x402.** A composable compliance toolkit for agent payments, built on Cleanverse and settled on Monad.

x402 lets an AI agent pay for a resource over HTTP. cx402 adds the part finance actually requires: every payment is checked against two guardrails before any money moves, and each cleared payment emits a signed, privacy-preserving receipt.

## Two guardrails

1. **Identity.** Both parties must hold a valid Cleanverse A-Pass. The check runs against the live registry, and the settlement asset enforces it on-chain as well, so a transfer to a non-verified wallet reverts by construction.
2. **Policy.** The operator sets a mandate the agent cannot exceed: a spending budget that depletes across payments, a per-payment cap, a minimum counterparty tier, and an optional allow-list. Identity is checked first, then policy.

Anything that fails either guardrail is refused cleanly, with the reason, and never settles.

## How it works

```
AI agent  ->  402 server (+ middleware)  ->  cx402 facilitator  ->  Monad
pays per call     issues the challenge        verify - policy - settle    aUSDC
```

The facilitator implements the x402 facilitator interface (`/verify`, `/settle`, `/supported`) and adds the policy layer and the receipt. Cleared payments settle real aUSDC on Monad and return a signed receipt that proves both parties were verified, with no personal data.

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
