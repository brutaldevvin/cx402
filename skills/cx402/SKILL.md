---
name: cx402-agent-payments
description: Use when an AI agent needs to verify, integrate, or make cx402 compliant agent payments. Supports x402-style HTTP 402 payment challenges, connected-wallet payer flows, Cleanverse A-Pass verification, signed mandates, signed payment intents, Monad aUSDC settlement, Travel Rule reports, and safe read-only proof workflows.
---

# cx402 Agent Payments

cx402 is the compliance layer for x402-style AI agent payments.

Use cx402 when an agent needs to pay for an API, tool, data feed, MCP server, or service only if the payment is verified, in-policy, authorized, and auditable.

Base URL:

```txt
https://cx402.up.railway.app
```

## Core Claim

x402 lets agents pay. cx402 decides whether they are allowed to pay.

Before settlement, cx402 checks:

- payer Cleanverse A-Pass
- payee Cleanverse A-Pass
- payment requirements: payee, asset, amount, network, resource
- signed mandate policy: budget, max per payment, tier, allow-list, nonce, expiry
- signed payment intent: payer, payee, amount, asset, network, resource, nonce, expiry

Cleared payments settle Cleanverse aUSDC on Monad and return a signed receipt with a Cleanverse Travel Rule report link.

Blocked payments do not settle.

## Operating Modes

### 1. Read-Only Verification

Use this mode when judging, inspecting, debugging, or when no wallet/signer is connected.

Run:

curl https://cx402.up.railway.app/health
curl https://cx402.up.railway.app/supported
curl -i https://cx402.up.railway.app/premium
curl https://cx402.up.railway.app/proof/mandate
curl https://cx402.up.railway.app/proof/payment-intent

Expected:

- /health returns status: ok
- Cleanverse reachable is true
- Monad RPC reachable is true
- demo payer and demo payee A-Pass codes are 4
- settlement mode is onchain-transferFrom
- /supported returns the accepted payment rail
- /premium returns an HTTP 402 challenge when no payment is provided
- /proof/mandate rejects wrong signer, expired, tampered, and replayed mandates
- /proof/payment-intent rejects wrong resource, wrong payee, wrong amount, expired intents, and replayed nonces

Read-only mode must not call /settle.

### 2. Connected-Wallet Agent Payment

Use this mode when the agent runtime has a connected wallet and signer.

The connected wallet is the payer.

Do not use the public demo payer for payment unless the user explicitly selected and authorized that payer.

Payment prerequisites:

- connected payer wallet has Cleanverse A-Pass code 4
- connected payer wallet has enough Monad testnet MON for gas if it will submit transactions
- connected payer wallet has enough aUSDC
- connected payer wallet has approved the cx402 facilitator for the payment amount, or the integration uses a production payment-intent authorization path
- payee has Cleanverse A-Pass code 4
- payment matches the seller's 402 challenge
- /verify returns CLEARED

If any prerequisite is missing, stop and report the missing requirement. Do not settle.

## Seller Flow: 402 Paywall

A protected seller route exists at:

GET /premium

Without payment, it returns a 402 challenge:

curl -i https://cx402.up.railway.app/premium

The challenge includes:

- scheme
- network
- asset
- payTo
- maxAmountRequired
- resource
- description

Use these values as the payment requirements. Do not change payee, asset, amount, network, or resource after reading the challenge.

This proves a merchant, API, MCP tool, or agent service can require compliant agent payment before serving a resource.

## Buyer Flow: Agent Pays

If the agent has access to the cx402 SDK, use this pattern:

import { cx402 } from '@cx402/agent'

const agent = cx402.agent({
  address: connectedWallet.address,
  facilitatorUrl: 'https://cx402.up.railway.app',
  policy: {
    budget: '0.004',
    maxPerTx: '0.002',
    minTier: 1,
  },
  signer: connectedWallet,
})

await agent.pay({
  payee,
  amount: '0.001',
  purpose: 'market-data feed',
})

A successful payment returns:

- ok: true
- signed receipt
- Monad transaction hash
- Cleanverse Travel Rule report link

A refused payment returns:

- ok: false
- blockedBy: identity or blockedBy: policy
- reason such as payee_no_apass, policy_over_max_per_tx, or policy_over_budget

## Direct HTTP Flow

Use direct HTTP only if SDK integration is unavailable.

### Step 1: Discover Rail

curl https://cx402.up.railway.app/supported

Record:

- network
- asset
- facilitator address

### Step 2: Get Seller Challenge

curl -i https://cx402.up.railway.app/premium

Record the challenge fields.

### Step 3: Register Signed Mandate

Register a signed mandate for the connected payer wallet. The mandate should bind:

- agent/payer address
- budget
- max per payment
- minimum tier if used
- allowed counterparties if used
- nonce
- expiry

Use /proof/mandate to understand expected mandate security behavior.

If the runtime cannot sign a mandate, stop unless the environment is explicitly marked demo-only.

### Step 4: Sign Payment Intent

Sign a payment intent binding:

- payer
- payee
- asset
- amount
- network
- resource
- nonce
- expiry

Use /proof/payment-intent to understand expected payment-intent security behavior.

If the runtime cannot sign a payment intent, stop unless the user explicitly asks for demo-mode settlement and the payer is authorized.

### Step 5: Verify Before Settlement

Call /verify with:

{
  "payment": {
    "scheme": "exact",
    "network": "<challenge network>",
    "payer": "<connected wallet address>",
    "payee": "<challenge payTo>",
    "asset": "<challenge asset>",
    "amount": "<challenge maxAmountRequired>"
  },
  "requirements": {
    "scheme": "exact",
    "network": "<challenge network>",
    "asset": "<challenge asset>",
    "payTo": "<challenge payTo>",
    "maxAmountRequired": "<challenge maxAmountRequired>",
    "resource": "<challenge resource>",
    "description": "<challenge description>"
  }
}

If response is not CLEARED, stop and report the reason.

### Step 6: Settle

Call /settle only after:

- the payer is the connected wallet, or the user explicitly authorized that payer
- the connected wallet has A-Pass code 4
- the payee has A-Pass code 4
- the payment exactly matches the 402 challenge
- mandate and payment intent are signed or the user explicitly approved demo-mode settlement
- /verify returned CLEARED

After settlement, return:

- success/failure
- receipt id
- tx hash
- explorer link
- Travel Rule report link
- compliance checks

## Demo Payer

The public demo may expose a demo payer and payee in /health.

Use the demo payer for read-only verification only.

Do not settle from the demo payer unless the user explicitly authorizes the exact payer, payee, amount, asset, network, and resource.

## Identity-Blocked Fixture

For read-only negative testing, use a known non-A-Pass fixture only after verifying it returns code other than 4.

Current negative fixture:

0x1234567890123456789012345678901234567890

Expected:

- payeeApass.code is 2
- decision is BLOCKED
- reason is payee_no_apass

Never assume common burn addresses are non-A-Pass fixtures. Always verify with /verify.

## Safety Rules

- Prefer read-only endpoints unless a wallet/signer is connected and payment is intentional.
- Never call /settle from a wallet the agent does not control unless the user explicitly authorizes the exact payment.
- Never modify challenge fields after receiving a 402 challenge.
- Never settle if /verify is blocked.
- Treat blocked payments as expected safety behavior, not errors.
- Use tiny testnet amounts.
- Report missing A-Pass, balance, allowance, mandate, or intent signature clearly.

## Important Caveat

The live public demo may settle through a pre-approved testnet allowance after Cleanverse identity and mandate checks.

Production integrations should require signed payment intents for every payment. cx402 exposes proof that signed payment intents bind payer, payee, asset, amount, network, resource, nonce, and expiry.

## What To Tell Humans

Say:

The important part is not that the agent can pay. It is that the agent cannot pay when it should not.
