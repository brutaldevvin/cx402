# Deploying cx402

The cx402 facilitator is a single Node server that serves both the explainer UI
(at `/`) and the x402 compliance API (`/verify`, `/settle`, `/policy`, `/events`).
Deploy it once and you get one public URL that runs the whole demo, the page and
the live on-chain settlement behind it.

It is a stateful server (in-memory policy budgets, an SSE event stream, and it
signs on-chain transactions), so it runs on a container host, not a static or
serverless platform. Railway and Render both work out of the box with the
included `Dockerfile`.

## Option A: Railway

1. New Project, Deploy from GitHub repo, pick `brutaldevvin/cx402`.
2. Railway detects the `Dockerfile` and builds it.
3. Add the environment variables below (Variables tab).
4. Settings, Networking, Generate Domain. That URL is what you hand the judges.

## Option B: Render

1. New, Web Service, connect `brutaldevvin/cx402`.
2. Runtime: Docker (auto-detected from the `Dockerfile`).
3. Add the environment variables below.
4. Create Web Service. Render gives you an `onrender.com` URL.

## Environment variables

Public on-chain values (safe to paste as-is):

| Key | Value |
| --- | --- |
| `CHAIN` | `monad` |
| `NETWORK` | `eip155:10143` |
| `CHAIN_ID` | `10143` |
| `SETTLEMENT_MODE` | `ausdx` |
| `SETTLEMENT_ASSET` | `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` (real aUSDC) |
| `AUSDC_ADDRESS` | `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` |
| `APASS_ADDRESS` | `0xbA82D189540CaC9DC6FF46B6837CaC1BFdEC58B9` |
| `EXPLORER_BASE` | `https://testnet.monadscan.com/tx/` |
| `DEMO_ALLOW_UNSIGNED_POLICY` | `true` |

Secrets (copy the values from your local `.env`, never commit them):

| Key | What it is |
| --- | --- |
| `CLEANVERSE_APP_ID` | Cleanverse app id, sent as the `api-id` header |
| `CLEANVERSE_APP_KEY` | Cleanverse AES key, used locally to encrypt request bodies, never sent |
| `MONAD_RPC_URL` | Monad testnet RPC endpoint |
| `FACILITATOR_PKEY` | the facilitator wallet, holds gas and signs `transferFrom` settlements |

The host injects `PORT` automatically; the server reads it. You do not set `PORT`.

Notes:
- `W_PKEY` and `W2_PKEY` are NOT needed on the host. The facilitator settles via
  `transferFrom` using `FACILITATOR_PKEY` plus the buyer's existing on-chain
  approval, so the buyer's key never leaves your machine.
- Without `FACILITATOR_PKEY` the server falls back to simulated settlement (no
  real transactions). Set it for the live on-chain demo.
- The live demo settles real aUSDC at 0.001 per cleared payment. The facilitator
  wallet only holds testnet gas and can move the buyer's pre-approved testnet
  aUSDC. Defund or rotate it after judging.
- `DEMO_ALLOW_UNSIGNED_POLICY=true` lets the page register a policy mandate
  without a signed payload, because the browser holds no key. It is demo-only.
  The production path is a signed EIP-191 mandate (see the README "Signed
  Mandate" section); without this flag the facilitator rejects unsigned policy.
