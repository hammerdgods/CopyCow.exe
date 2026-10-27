# GodsEye testing plan

For the first real-money run, when the wallet holds **more than 1 SOL**. Work down the stages in order and don't skip a gate. Each stage widens what can go wrong a little, so a bug costs a small slice of the wallet, not all of it.

> **Why staged:** `COPY_MODE` defaults to `real`. There is no test network (Jupiter is mainnet-only), so the safe path is mainnet with small, tight limits first. Paper mode proves the pipeline; only small real trades prove fills, fees and slippage.

## Before you start

1. **Back up `data/wallet/godseye-keypair.json`** somewhere offline. That file *is* the wallet; losing it loses the funds.
2. Confirm the wallet address (`npm run wallet`) on Solscan and that the SOL you sent is there.
3. **Surplus SOL:** only `COPY_BUDGET_SOL + WALLET_RESERVE_SOL` should live in the hot wallet. Everything above it is unprotected by any limit: move it to a separate wallet and top the hot wallet up as stages pass.
4. Put a real RPC in `.env` (`HELIUS_API_KEY` or `SOLANA_RPC_URL`); add `GRPC_URL` + `GRPC_TOKEN` if you have them. The public RPC is too slow.
5. Decide who watches the agent. **If the agent process stops, stop-loss / take-profit / max-hold exits stop with it** (they run inside the agent). Leader-sell mirroring stops too. Run it under something that restarts it, and check `npm run status` (heartbeat) at least a few times a day.

## Stage overview

| Stage | Mode and limits | Duration | Gate to advance |
|---|---|---|---|
| 0 Offline | none | minutes | `npm run typecheck` and `npm test` green |
| 1 Preflight | none (read-only) | minutes | `npm run preflight` ends in GO, 0 failures |
| 2 Paper | `COPY_MODE=paper` | 48–72 h | see Stage 2 |
| 3 Micro-live | `real`, budget 0.1 SOL | 3–7 days | see Stage 3 |
| 4 Scale | budget 0.3 → 0.5 → 1.0 SOL | ≥ 48 h per step | see Stage 4 |
| 5 Steady state | your chosen limits | ongoing | daily checklist |

## Stage 0: Offline checks

```bash
npm install
npm run typecheck
npm test
```

The suite covers the pure logic (P&L, tiers, AI/human, weights, swap parsing), the pre-signing static check, and the copy engine's limits: daily loss limit, max positions, budget, duplicate tokens, `data/PAUSE`, failed buys, stop-loss / take-profit / max-hold exits, sell back-off and the proof ledger. **Gate:** everything passes.

## Stage 1: Preflight (read-only, spends nothing)

```bash
npm run preflight
```

It checks your settings against the wallet balance, key-file permissions, RPC, Jupiter and RugCheck, and runs one real Jupiter swap (0.001 SOL → USDC) through GodsEye's own pre-signing checks (static check + simulation) **without signing or sending it**. It needs the wallet to hold at least 0.02 SOL for that dry run. Read every ⚠️ line.

**Gate:** `GO`, no ❌. In particular the dry-run swap must pass: if it fails, GodsEye would refuse to sign real swaps too, so find out why before going further.

## Stage 2: Paper (`COPY_MODE=paper`)

```bash
# .env: COPY_MODE=paper
npm run agent        # leave running
npm run dashboard    # second terminal
```

Watch **Who GodsEye Copies**, **Live Copies** and the **Proof Ledger** for 48–72 h.

**Gate (all of):**
- Discovery, analysis and learning all ran on schedule (`npm run status`: recent "last discovery / last learning").
- At least a few leaders have weight, and the reasons make sense (not copying wallets that are losing this week).
- Copy decisions are being recorded, and the skip reasons look sane (late, paused, budget, rug check); not dominated by "couldn't verify the token".
- Typical copy delay is within `COPY_MAX_DELAY_SECONDS` most of the time. If most trades are skipped as late, fix RPC / gRPC first: real trading will be no better.
- Rug check blocks show up for dangerous tokens.
- The log has no repeated unexplained errors.
- The Proof Ledger verifies in the browser (hash chain intact).

**Caveat:** paper fills use quotes, with no failed transactions, fees or real slippage. Treat paper P&L as optimistic. It proves the plumbing, not the profit.

## Stage 3: Micro-live (real money, tiny limits)

```bash
# .env
COPY_MODE=real
COPY_BUDGET_SOL=0.1
COPY_MAX_TRADE_SOL=0.02
COPY_MIN_TRADE_SOL=0.01
COPY_MAX_POSITIONS=2
COPY_DAILY_LOSS_LIMIT_SOL=0.05
```

1. `npm run preflight` again with these settings (real mode now): must be GO.
2. `npm run agent`. **Be at the screen for the first fill.**
3. For every one of the first 3–5 fills, open the signature on Solscan and check:
   - the wallet is the only signer and fee payer; the only SOL leaving goes to the swap (plus fees and token-account rent);
   - the SOL spent ≈ the size the log/dashboard shows, and the token amount received ≈ what the dashboard recorded (GodsEye records the *actual* result, so these should match);
   - the cost is within `COPY_SLIPPAGE_BPS` of the leader's price.
4. Confirm the first **sell** the same way (leader-mirrored or an own exit), and that the position closes in the dashboard.
5. **Kill-switch drills**, done while a position is open, then resume:
   - `npm run pause`: no new buy appears (a skip with "copying is paused"); an exit still works. `npm run resume`.
   - Create the file `data/PAUSE`: same effect; delete it to resume.
   - `Ctrl-C` the agent: note that open positions are now unmanaged until it is restarted. Restart it and confirm it picks the positions back up.
6. Reconcile daily: wallet balance on-chain ≈ starting balance + realized P&L (dashboard) − open cost − fees. Differences larger than rent/fees are a bug: stop and investigate.

**Gate (all of):**
- At least 10 filled copies and at least 90% of attempted copies filled (`failed` rows have an understood cause).
- No "refused to sign" for a swap you would call legitimate, and no unexplained failures.
- Recorded fills match the chain (step 3), and balance reconciles (step 6).
- All kill-switch drills behaved as described.
- Realized loss never exceeded the daily limit by more than one trade.

**Abort now** (pause, then investigate) if: the wallet drops more than 25% of the stage budget; any transaction sends SOL somewhere unexpected; recorded fills disagree with the chain; "refused to sign" keeps repeating; the agent trades while `pause` is on.

## Stage 4: Scale

Raise one step at a time and hold each for at least 48 h before the next. Keep `COPY_MAX_TRADE_SOL` at about 10% of the budget.

| Step | `COPY_BUDGET_SOL` | `COPY_MAX_TRADE_SOL` | `COPY_MAX_POSITIONS` | `COPY_DAILY_LOSS_LIMIT_SOL` |
|---|---|---|---|---|
| 4a | 0.3 | 0.03 | 3 | 0.1 |
| 4b | 0.5 | 0.05 | 4 | 0.2 |
| 4c | 1.0 | 0.1 | 5 | 0.4 |

Run `npm run preflight` after every change (it flags a budget the wallet can't fund and a daily limit that can never trigger). Top the hot wallet up from your separate wallet as needed.

**Gate for each step:**
- Fill rate and reconciliation still good.
- GodsEye's *own* copy P&L (not the leaders') is flat or positive over the step. A leader whose copies lose is dropped by the learning loop after 3+ closed copies; check that this actually happens.
- The daily loss limit either never triggered or triggered and stopped new buys that day.
- No new kind of failure.

If a step loses money, drop back one step rather than pushing on. Past profit of a wallet says nothing about its next trade.

## Stage 5: Steady state: daily checklist

- `npm run status`: LIVE, recent heartbeat, wallet balance as expected.
- Dashboard: no pile of `failed` copies; skip reasons look normal; open positions are not stuck (sell failures retry with back-off, so repeated "Selling … failed" lines need a look).
- Realized P&L today vs the daily loss limit. The limit counts **realized** losses only, so a deep unrealized loss won't pause buying until it's sold.
- Wallet reconciles with the dashboard.
- Key-file backup still exists; surplus SOL still out of the hot wallet.
- `.env` and `data/` are never committed (both are git-ignored).

## Known limits to keep in mind

- Daily loss limit = realized losses in the UTC day. It never looks at open positions.
- Agent down = no automatic exits and no leader-sell mirroring.
- Everything above budget + reserve in the wallet is outside every limit.
- Paper results overstate real results.
- Labels (Insider pattern, AI/bot, …) are automated guesses; nothing here is financial advice.
