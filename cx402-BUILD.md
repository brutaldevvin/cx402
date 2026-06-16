# cx402 — Build Spec

> Status: **DRAFT / in progress.** We fill this in together before any code is written.
> Goal: think through every part in and out so the build is execution, not decisions.
> **Official dates:** Build June 12–17 · Demo submission June 17 23:59 UTC (to contact@cleanverse.com) · Demo Day June 18. App review ~1 working day after submit.
> Last updated: 2026-06-13

---

## 0. Decisions log (locked)

- **Concept:** the compliant version of x402 — a real x402 facilitator that settles in A-Token and gates on A-Pass, on Monad. Cleanverse Build, Track 2. ✅
- **Brand:** Tender (warm paper, ink, receipt/ledger component). ✅
- **Chain:** Monad Testnet (10143). Fallback: Base Sepolia (same code, swap chain+RPC). ✅
- **Stack:** TypeScript end-to-end — viem, Hono, vitest, Next.js (wall), MCP TS SDK. ✅
- **Demo scenario:** A+B — a buyer agent acquires from paid (402) endpoints, paying aUSDC via cx402; one provider is a **seller agent** so we get the agent-to-agent block moment. Resource bought is **generic/placeholder**. PoC: A-Token isn't adopted yet, so **we control every side** (buyer, seller, endpoints, wallets). ✅ → §10
- **Conform to x402 v2** (`@x402/core` `@x402/evm` `@x402/fetch` `@x402/next`), network `eip155:10143`. Reference = live **Monad facilitator** `https://x402-facilitator.molandak.org` (advertises `exact` + `upto` v2; signer `0x7f6a2850669202519f0FE8aa912451238820Db86`). ✅
- **Settlement = standard x402 v2, gasless via Permit2.** aUSDC has no EIP-3009 (verified; origin USDC does), but `exact` supports a **Permit2-proxy fallback for non-EIP-3009 tokens** (canonical proxy `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002`, `@x402/evm 2.12.0`). So aUSDC settles gaslessly on standard rails — **no custom scheme**. Fallback: payer-submitted txHash (old "Model A"). ✅ → §5
- **cx402 = our own compliant x402 v2 facilitator.** Conforms to `/supported` `/verify` `/settle`; differentiation = (1) A-Pass + blacklist gate in `/verify`, (2) settles the **A-Token (aUSDC)** not plain USDC, (3) Travel-Rule receipt. A stock `@x402/fetch` client pointed at us + aUSDC asset gets compliance for free. ✅ → §7
- **Scheme fidelity (#3):** RESOLVED → strict x402 v2; drop the custom `cleanverse-exact` scheme. ✅
- **Facilitator architecture (#5):** run our OWN compliant x402 v2 facilitator (not composing molandak). ✅
- **Demo agents (#6):** default to a **live LLM agent** driving the real flow via the MCP tool (the agent layer is fully ours → safe to be live). Scripted replay of a known-good run is **break-glass only**, behind the backup video. NOT fully scripted. ✅
- **Endpoints:** 2 verified (CLEARED) + 1 unverified seller agent (BLOCKED). ✅
- **Liveness ladder:** the compliance gate is live + reliable regardless of settlement; only on-chain settlement degrades, and most rungs stay live (§17). ✅
- **Wall:** dark "control-room" variant of Tender (vivid-on-dark, same receipt component), **hero + ledger** layout (live gate center, scrolling ledger + counters), plus an **agent action feed**; single SSE bus on facilitator `GET /events` (`verify`/`settle`/`block`/`agent`). ✅ → §11
- _…(add as we lock them)_

## 0b. Open questions (resolve via discussion)

1. ~~Demo scenario~~ — RESOLVED → §10 (A+B, generic resource, PoC, we control all sides).
2. ~~Settlement Model A vs B~~ — RESOLVED → target B, build A first (§3, §5).
3. ~~Scheme fidelity~~ — RESOLVED → strict x402 v2, standard `exact`, compliance in the facilitator (no custom scheme).
4. **Does aUSDC settle via the Permit2-proxy path** given its A-Pass compliance hook? Permit2 (`0x…78BA3`) + the x402 proxy (`0x4020A4…`) are **confirmed deployed on Monad testnet**; only the aUSDC-hook interaction remains (needs a funded A-Pass wallet → Stage-0 test). Guaranteed fallback: payer-submitted. ← narrowed, low-risk
5. ~~Own vs compose facilitator~~ — RESOLVED → own.
6. ~~Agents scripted vs live~~ — RESOLVED → live LLM agent default; scripted replay = break-glass (§10, §17).
7. ~~Number of endpoints~~ — RESOLVED → 2 verified + 1 blocked.
8. _Cascading decisions DONE. Remaining sections — types §12, env/wallets §13, repo §14, testing §15, deploy §16, stage exit criteria §18 — are **deferred to build-time** (decide with the compiler in front of us, not in the abstract). §10 stage script also TODO at build._

---

## 1. Overview & goals
- One-liner: _x402 lets agents pay; cx402 makes those payments legal._
- **Ethos: ship a real, reusable product** (publishable packages, deployable facilitator), not throwaway demo glue.
- Target demo: a live AI agent autonomously pays compliant providers on Monad; an unverified counterparty is blocked (both proactively by the agent and reactively by the rails). (see §10)
- Judging map: Relevance 20 / Technical 20 / Commercial 20 / Compliance 15 / UX 15 / Presentation 10.
- **Spine (must work):** facilitator + one 402-protected endpoint + one agent payment + wall showing one green + one red.
- **Stretch:** MCP tool, multi-endpoint task, live LLM agent, judge interactivity, Model B gasless.

## 2. Architecture
- Components: `shared` (types) · `facilitator` · `middleware` · `client` · `mcp` · `apps/wall`.
- Data flow (happy path):
  ```
  agent → GET /resource (no payment)
  server(middleware) → 402 + accepts[{scheme:cleanverse-exact, network:monad, asset:aUSDC, payTo, amount}]
  agent(client) → settle aUSDC on-chain (Model A) → retry with X-PAYMENT={txHash,...}
  server → facilitator POST /verify → POST /settle
  facilitator → query_apass(payer),(payee) + query_user(blacklist) + confirm on-chain tx
  facilitator → returns {success, txHash} + Travel-Rule receipt; emits SSE event
  server → 200 + resource + X-PAYMENT-RESPONSE (receipt)
  wall ← SSE event → renders Tender receipt (CLEARED green / BLOCKED red)
  ```
- _TODO: blocked-path flow, sequence for Model B._

## 3. The payment scheme (standard x402 v2 `exact`, no custom scheme)
- **No custom scheme.** Use the standard x402 v2 **`exact`** scheme on `eip155:10143`. aUSDC has no EIP-3009 (verified), but `exact` supports a **Permit2-proxy fallback for non-EIP-3009 tokens**, so the standard wire format works as-is.
- cx402's difference is NOT the scheme; it's (a) **asset = aUSDC (A-Token)** instead of plain USDC, and (b) the **compliance gate** our facilitator runs in `/verify` (§4). A standard `@x402/fetch` client + aUSDC asset, pointed at the cx402 facilitator, gets compliant payments without knowing about A-Pass.
- PaymentRequirements (`accepts[]`, standard v2): `scheme:"exact"`, `network:"eip155:10143"`, asset = aUSDC, payTo = server's A-Pass wallet, price/maxAmountRequired, `extra.facilitatorAddress` (Permit2 binding) like the Monad facilitator advertises. Optionally advertise the A-Pass requirement in `extra` so clients can pre-check (enforcement is still `/verify` + on-chain aUSDC revert).
- Payment payload (standard `exact`): EIP-712-signed; for aUSDC, a Permit2 witness bound to the facilitator address. Client prerequisite: one-time `approve(Permit2, aUSDC)` (facilitator returns 412 PRECONDITION_FAILED until done).
- Use `@x402/evm 2.12.0` (the version with the correct Monad Permit2 proxy `0x4020A4f3…0002`). Stage 0 pulls `@x402/core` types into `shared`.

## 4. Compliance engine
**Confirmed against API v5 docs (2026-06-13). The gate is now ONE authoritative call per party.**
- `verifyParties(payer, payee, amount, asset, payTo)` → "may this payment settle?" **All must pass:**
  1. payer: **`verify_apass(chain, atoken=aUSDC, payer)`** → `data.code == 4` (valid A-Pass + transfer allowed under compliance). Else block, reason mapped from code: `2`→`payer_no_apass`, `3`→`payer_apass_blocked` (expired/frozen/compliance), `1`→`asset_unknown`.
  2. payee: same `verify_apass` → `code == 4`. [`payee_no_apass` / `payee_apass_blocked`] — **both parties gated** (matches the A-Token's on-chain rule; off-chain check yields better errors + the block UX).
  3. payment matches requirements: amount ≥ price, asset == aUSDC, recipient == payTo. [`amount_mismatch` / `asset_mismatch` / `recipient_mismatch`]
- **`verify_apass` subsumes the old multi-check** — it already folds in A-Pass existence, active/expiry/frozen, AND compliance ("whether transfer is allowed"). So no separate `query_user` blacklist call is needed on the primary path (code `3` covers the blocked-counterparty case). On a BLOCK it also returns a `magickLink` we can surface ("get verified here").
- **API surface:** `verify_apass` is on the **Cooperate API** → needs a Service Partner **`api-id`** (dependency, §13). **No-auth fallback** if api-id is delayed: Skills API `query_apass` (status==1 + not expired) + `query_user` (blacklist_reason empty) — replicates the gate, just with two calls and slightly weaker compliance coverage. Build against the fallback now; swap to `verify_apass` when api-id lands.
- For the **receipt**, also call `query_apass(chain, addr)` per party to capture `cvRecordId` / `currentKycHash` / `tier` / `group` (the privacy-preserving proof fields — §6).
- **Tier policy:** OFF by default (any valid A-Pass passes); optional middleware `requireApassTier` for servers wanting `tier ≥ N` (from `query_apass`). [`apass_tier_too_low`]
- On-chain backstop: aUSDC transfer reverts for non-A-Pass → the gate is pre-flight UX + defense-in-depth + the source of clean block reasons.
- Error taxonomy → x402 `invalidReason` + human message + wall block-reason: the bracketed codes above, plus `tx_invalid` (fallback rail) / `replayed`.
- Caching: memoize `verify_apass`/`query_apass` ~5s TTL to keep the gate off the per-request latency path.
- **Future scope (CCP):** swap `verify_apass` for the Validator Compliance pool (`/validator/verify` against a cx402-registered pool encoding payment policy) — Issue Member only, narrative not build.

## 5. Settlement (on-chain)
- Asset: aUSDC A-Token `0xaC08…f20D` (6dp). On-chain A-Pass enforcement = transfer reverts to non-A-Pass wallet (linchpin to verify at kickoff).
- **Primary (gasless): standard x402 v2 Permit2-proxy.** Agent `approve(Permit2, aUSDC)` once, signs a Permit2 witness bound to the facilitator; facilitator settles via canonical proxy `0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002` (`@x402/evm 2.12.0`) and covers gas. **OPEN/critical (#4): confirm the Permit2 transferFrom of aUSDC passes the A-Pass compliance hook** — Stage-0 on-chain test. If it works, gasless is standard, near-zero custom code.
- **Fallback: payer-submitted.** Agent submits `transfer(payTo, amount)`; facilitator confirms tx (to/amount/asset, N confirmations) and marks txHash consumed (replay protection). Dead-simple, guaranteed for the demo even if Permit2-on-aUSDC fails.
- Replay/nonce: Permit2 nonces (primary) / consumed-txHash set (fallback).

## 6. Travel-Rule receipt
- Emitted by the facilitator on `/settle`. Surfaced 3 ways: x402 `X-PAYMENT-RESPONSE` header (base64 JSON), `GET /receipts/:tx`, and the SSE `/events` stream (→ the wall's Tender receipt card).
- **Privacy-preserving Travel Rule (the headline compliance feature):** carries **wallet addresses (public) + a verifiable proof of verification** (`cvRecordId`, `kycHash`, `tier`) per party. NO real-world PII (names/physical address/national ID/DOB) — Cleanverse keeps that local. Honest framing = **"Travel-Rule-ready, privacy-preserving"**: the *proof* both parties were bank-verified travels with the payment; PII stays at the issuing institution, retrievable by `cvRecordId` on lawful request. NOT raw-PII transmission.
- Shape:
  ```
  receipt {
    id, version, timestamp
    payment:    { amount, asset(aUSDC), network "eip155:10143", txHash, explorerUrl, scheme "exact", facilitator }
    originator: { walletAddress, cvRecordId, kycHash, tier }   // payer — proof, not PII
    beneficiary:{ walletAddress, cvRecordId, kycHash, tier }   // payee
    originatingVASP / beneficiaryVASP                          // IVMS101-style institution refs (from A-Pass group, if available)
    compliance: { status: CLEARED|BLOCKED, checks{payerVerify(code 4),payeeVerify(code 4)}, blockReason?, travelRule: "ready", travelRuleReportUrl? }
    signature   // ECDSA(facilitator key) over the receipt hash — tamper-evident, verifiable
  }
  ```
- **Confirmed fields (API v5):** `cvRecordId`, `currentKycHash`, `tier`, `group`/`subGroup` are real `query_apass` outputs → drop straight into originator/beneficiary as the proof (no PII). No assumption left here.
- **Official Travel Rule report (upgrade):** Cleanverse exposes **`POST /download_travel_rule {txHash, wallet}`** → a real Travel Rule / Transaction-Report **PDF** (downloadUrl + fileName). For an A-Token transfer (our case) it's the "Transaction Report" variant (transfer txHash). So cx402's receipt links the **authoritative Cleanverse report** (`travelRuleReportUrl`) instead of only our own JSON — much stronger. (Needs the Service Partner api-id; degrade to our signed JSON alone if absent.)
- **Signed:** facilitator signs the receipt hash (ECDSA with its key); any party can verify authenticity + integrity → audit-ready, not just a JSON blob.
- **IVMS101: LIGHT alignment.** Structure echoes IVMS101 (originator/beneficiary/originatingVASP/beneficiaryVASP); PII fields are replaced by verifiable proofs/refs (`cvRecordId`/`kycHash`). Pitch = "IVMS101-compatible structure, privacy-preserving variant." **Full IVMS101 out of scope/infeasible** — it mandates the actual PII we deliberately don't hold.

## 7. Facilitator service (cx402 = the compliant facilitator)
- Our OWN x402 v2 facilitator. Conforms to `GET /supported` / `POST /verify` / `POST /settle`; advertises `exact` on `eip155:10143` for aUSDC + `extra.facilitatorAddress` (Permit2).
- `/verify` = standard payment validation **+ the compliance gate** (§4: query_apass both parties status 1, query_user blacklist empty). `/settle` = Permit2 settlement of aUSDC + Travel-Rule receipt + emit SSE event.
- Plus `/events` (SSE for the wall), `/receipts/:tx`.
- Config/secrets: Monad RPC, Cleanverse API base, facilitator signer key (covers gas), Permit2 proxy addr. Deploy: Railway/Render/Fly → public URL.
- Decide (#5): run own (recommended — it's the product + the claim) vs compose molandak's settlement behind our compliance gate.
- Reference impl to model: live Monad facilitator `x402-facilitator.molandak.org`.

## 8. Middleware (server)
- Standard `@x402/next` `withX402` (or express/hono) pointed at the cx402 facilitator. Ship a thin preset **`cx402Middleware({ price, payTo, requireApassTier? })`** filling cx402 defaults (facilitator URL, `asset: aUSDC`, `network: eip155:10143`) → one line to make a route accept compliant payments. `requireApassTier` rides in PaymentRequirements `extra`.
- Real publishable package (not demo glue). Plus the demo's 2 verified + 1 unverified endpoints.

## 9. Client SDK + MCP tool
- Client: standard `@x402/fetch` `wrapFetchWithPayment` + `ExactEvmScheme`, wrapped as **`cx402Client(signer)`** presetting chain/asset/facilitator and auto-handling the one-time `approve(Permit2, aUSDC)` onboarding (412 → approve → retry). Publishable package.
- **MCP server** (the live agent's surface). Tools — PROVISIONAL, confirm exact Cleanverse API backing once docs are accessible:
  - `pay_and_fetch(url)` — GET; on 402, pay via cx402, return resource + receipt.
  - `check_counterparty(address)` — `query_apass`/`query_user` → `verified | blacklisted | unknown`.
  - `pay_agent(address, amount)` — direct agent-to-agent payment (scenario B).
  - `get_receipt(txHash)` — fetch a stored receipt.
- PoC: MCP server holds the buyer agent's signer key (env). LLM decides, the tool signs + pays.
- **Two block paths, demo BOTH:** (a) **proactive** — agent calls `check_counterparty` first, sees unverified, declines ("a trusted agent refuses dirty hands"); (b) **reactive** — agent tries to pay, facilitator `/verify` blocks ("the rails enforce it regardless"). Proves agent judgment + hard backstop.

## 10. Demo
- **Scenario (A+B):** a **buyer agent** is given a task and acquires what it needs from a small set of **paid (402) endpoints**, paying each in aUSDC via cx402. One provider is a **seller agent** (agent-to-agent) — that's where the verify-the-counterparty story bites.
- **PoC framing:** A-Token isn't adopted in the wild, so this is self-contained — **we control every side** (buyer agent, seller agent, paid endpoints, all wallets). Pitch = "the compliance layer + facilitator standard the agent-payment ecosystem will need," demonstrated on Monad, not "we have live merchants."
- **Paid resource = generic/placeholder.** Anything x402-payable (a premium API call / data blob / generated artifact). Vertical doesn't matter; stub something trivial. The payment + compliance flow is the point.
- **Money-shot:** buyer pays a verified provider → CLEARED (green receipt). Then it tries to pay an **unverified / blacklisted seller agent** → cx402 BLOCKS it (red, "UNVERIFIED"); the aUSDC transfer would revert on-chain anyway. Stretch: judge picks the rogue wallet.
- **Agents: live LLM agent** drives the run via the MCP `pay_and_fetch` tool (agent layer is fully ours → safe to be live). Scripted replay of a known-good run = break-glass; recorded backup video behind that. Not fully scripted.
- **Endpoints: 2 verified providers (CLEARED) + 1 unverified seller agent (BLOCKED).**
- The compliance decision (CLEARED/BLOCKED) is live + reliable today (sandbox API tested). Only on-chain settlement is uncertain → liveness ladder (§17).
- Stage script (90s): _TODO_
- Fallback: recorded backup video.

## 11. The wall (frontend)

**Purpose:** the live demo surface — turns invisible machine money into a paper trail the room can watch. Read-only subscriber to the facilitator's event bus; every verify/settle/block prints on screen in real time.

**Stack:** Next.js (App Router), a single client `EventSource` → facilitator `GET /events` (SSE). No DB, no auth for the demo (optional shared `?token=`); the facilitator is the only source of truth. Deploy alongside the facilitator (same host or Vercel).

**Brand — dark "control-room" variant of Tender (locked):** the deck is Tender *muted-on-paper*; the wall is Tender *vivid-on-dark* — same JetBrains Mono ledger type, same dashed-rule receipt component, same ink system, but on near-black the **source hexes run at full vividness** (green `#0AF668`, and the unmuted blue/red), which is exactly why they were darkened for paper. Two halves of one brand: the deck is the document, the wall is the terminal. The receipt-card component is **shared** with the deck (one component, light/dark theme tokens).

**Layout — hero + ledger:**
- **Counters (header strip):** the scoreboard — settled (count + value), blocked (count), receipts issued, **tainted value blocked $X**. Ticks live as events land.
- **Hero (center):** the *current* payment as a large receipt; the compliance gate evaluates **live** — the §4 checks (payer a-pass → payee a-pass → payer clean → payee clean → requirements match) light up sequentially (blue/green), then the receipt **stamps** `CLEARED` (green) or one check flips and it stamps `BLOCKED` (red) with the §4 reason code. This is the money-shot, dead center.
- **Ledger (side column):** scrolling list of past payments as compact receipt rows (no. · parties · amount · status). The accumulating paper trail.
- **Agent action feed:** terminal-style log of the buyer agent's actions ("task received… `check_counterparty 0x9af0…` → unverified… declined… `pay_and_fetch` provider A → CLEARED"). Ties agent behavior to the payments and keeps the screen alive between settlements.

**Event bus (the contract the wall reads):** facilitator is the single SSE source on `GET /events`, emitting typed JSON events:
- `verify` — decision + the per-check results (drives the hero gate animation)
- `settle` — txHash + confirmation (drives CLEARED + Monad explorer link)
- `block` — reason code (drives BLOCKED red)
- `agent` — an action breadcrumb the MCP server `POST`s to `/events/agent` (drives the action feed)

Wall is a pure subscriber; reconnects with `Last-Event-ID`. Keeping the agent breadcrumbs on the *same* bus means one connection, one ordering.

**Both block paths render distinctly:** (a) **proactive decline** → an `agent` feed line ("declined unverified counterparty") and **no** receipt prints; (b) **reactive block** → a red `BLOCKED` receipt from the facilitator. The audience sees both kinds of red — agent judgment *and* the hard backstop.

**Money-shot staging:** greens accumulate in the ledger, counters tick up, then the hero slams **red** on the unverified seller agent — the guardrail holding, live, on the big screen.

## 12. Shared types / data model
- PaymentRequirements, PaymentPayload, VerifyResult, SettleResult, Receipt, ApassRecord, UserRecord. _TODO_

## 13. Config, env, secrets, wallets
- Test wallets (≥3 A-Pass'd on Monad + funded aUSDC + faucet MON), env vars, Cleanverse API base (uatapi). _TODO finalize_
- **Refined dependency ask to Cleanverse (was "provision Monad wallets"):**
  1. **Service Partner `api-id` + `api-key`** for the sandbox Cooperate API (`uatapi…/api/cooperate`). Unlocks `verify_apass` (best gate), **`faucet`** (self-serve aUSDC), `download_travel_rule` (official PDF), `query_txs`. ← the real blocker now.
  2. **A-Pass on our ≥3 Monad test wallet addresses** — `generate_apass` is Issue/Gateway-Member only, so either (a) Cleanverse generates for our addresses, (b) they grant us Gateway Member, or (c) we complete the magic-link Sumsub flow (sandbox test docs). We supply the addresses.
- **Funding becomes self-serve once api-id lands:** `POST /faucet {chain:"monad", symbol:"ausdc", depositAddress, amount}` (rate-limited ~1/day) → fund the A-Pass'd wallets ourselves; no manual provisioning needed.
- Docs access: invitation code **`nDmB3PDK`** at docs.cleanverse.com (full ref → see memory `cleanverse-api-reference`).

## 14. Repo structure & stack
- pnpm monorepo: `packages/{shared,facilitator,middleware,client,mcp}` + `apps/wall`. _TODO finalize_

## 15. Testing strategy
- Unit (engine rules), integration (facilitator vs Cleanverse API + Monad), the linchpin (transfer reverts for non-A-Pass), e2e (agent→402→pay→200). _TODO_

## 16. Deployment
- Facilitator public URL, wall hosting, the demo machine. _TODO_

## 17. Risks, dependencies, fallbacks
- Monad wallet provisioning (critical) → fallback Base Sepolia.
- Gas sponsorship mechanism unknown → fallback faucet MON.
- Live-LLM nondeterminism → break-glass scripted replay + backup video (NOT the default).
- **Liveness ladder (settlement degradation — find your rung at Stage 0). The A-Pass/blacklist gate (product + money-shot) is LIVE on every rung:**
  1. **Full live:** gasless Permit2 settlement of aUSDC on Monad, explorer confirms. (best)
  2. **Live, simpler rail:** payer-submitted aUSDC `transfer` on Monad. (if Permit2-on-aUSDC fails)
  3. **Live, plain asset:** settle origin USDC via the standard rail — lose A-Token "clean funds" property, gate still live, real money still moves. (if aUSDC transfers fail entirely)
  4. **Simulated settle:** facilitator returns a simulated confirmation + receipt; gate still live. (worst case — disclose / backup video)

## 18. Build stages & timeline (build June 12–17, submit 17 23:59 UTC, exit criteria)
- Stage 0 Groundwork · 1 Engine · 2 Facilitator · 3 Middleware+Client · 4 MCP · 5 Wall · 6 Polish.
- **Stage 0 now = get the Service Partner api-id + A-Pass'd Monad wallets (§13), then faucet aUSDC + confirm Permit2-on-aUSDC (#4).** Until api-id lands, build the gate against the no-auth Skills API fallback (§4).
- Submission is a demo artifact (video/PDF/link) to contact@cleanverse.com by June 17 23:59 UTC → review ~1 day → present June 18.
- Per-stage exit criteria: _TODO (mostly drafted in chat)_.
