# 🐄 copycow.exe — Copy the Smartest Cow in the Room

**COWBOT** is a public AI trading agent on Solana. It watches the market every 5 minutes, trades only on momentum + volume (no FOMO, no revenge trades), and shows every trade on a public dashboard. It also scans X (Twitter) and Solana for trending memes, and can launch its own pump.fun token riding a trend.

**The money:**
- **All of COWBOT's profit**, from trading and from selling its launch buys (at 2× or after 24h), is **airdropped to $COPYCOW holders every week** by holdings.
- **Each coin COWBOT launches** sends **100% of its pump.fun creator rewards to that coin's holders, every day.**
- **$COPYCOW's own creator rewards:** **10% to COWBOT** as trading capital (never more), **90% to the team wallet** for marketing, which COWBOT never touches.
- Nobody ever clicks "claim": SOL is pushed straight into wallets.

> **Everything is PAPER (simulated) by default.** No real money moves until you change `LAUNCH_MODE=paper` to `LAUNCH_MODE=real` in your `.env` file. Trading itself has **no real-money code at all** in this version — it is always paper.

---

## 1. What's in each folder

| Folder | What it is, in plain English |
|---|---|
| `agent/` | **COWBOT itself.** The program that runs 24/7: watches prices, makes paper trades, scans for trends, launches tokens (paper by default), sells its launch buys, claims creator rewards (launched coins → their holders; $COPYCOW → 10% COWBOT / 90% team), runs the weekly profit airdrop and the daily coin airdrops, and writes the daily report. |
| `agent/src/trend-scanner/` | The **trend radar**. Reads X (Twitter) + free Solana data (DexScreener, GeckoTerminal), spots names whose mentions suddenly spike, and scores them. |
| `agent/src/token-launcher/` | The **token launcher**. Turns a hot trend into a token (name, ticker, image) and launches it on pump.fun — or, in paper mode, just writes down "would have launched". Safety rules are built in. |
| `dashboard/` | The **public website** (copycow.xyz). Home, Live Trades, History, Performance charts, Launched Tokens, Airdrops, Proof Ledger, Tiers. |
| `copytrade-engine/` | The **copy-trading service**. Holders register their wallet; when COWBOT trades, it lines everyone up by tier (bigger holders go first, with bigger sizes) and logs what it *would* execute. Paper only for now. |
| `contracts/` | The **Solana smart contracts**: Tier Access (what your holdings unlock), Money contract (sends 90% of $COPYCOW creator rewards to the team wallet, lets COWBOT keep max 10%, and runs every holder airdrop), Treasury (optional vault for COWBOT's own capital, with daily spending limits). |
| `shared/` | Code every part uses: the database, the **hard-coded 10% / 90% rule**, the tiers, and the proof hashing. |
| `launch-kit/` | Ready-to-paste text: pump.fun description, X bio, 12-tweet launch thread, DexScreener + CoinGecko descriptions. |
| `content/daily/` | Where COWBOT saves its **daily report** posts (one file per day). |
| `data/` | Created when you run things. Holds the database (`copycow.db`) and **COWBOT's wallet key** (`data/wallet/`). Never shared or uploaded. |

### The money rules (hard-coded, not settings)
- **$COPYCOW creator rewards: COWBOT keeps max 10%, the team gets 90%.** The split happens the moment rewards are claimed, and the 90% is sent straight to `TEAM_WALLET`. COWBOT never holds, spends or redirects it (the contract checks the team address, and only the admin can change it). Written as a constant marked `FOUNDER RULE` in:
  - `shared/src/constants.ts` (`AGENT_SHARE_BPS = 1000`)
  - `contracts/programs/dividend_airdrop/src/lib.rs` (`AGENT_SHARE_BPS = 1000`). The contract **refuses to compile** above 10%.
- **Launched-coin creator rewards: 100% to that coin's holders**, airdropped daily.
- **$COPYCOW holders get ALL of COWBOT's profit.** Every week, its realized profit since the last airdrop (trading + selling launch buys, plus copytrade fees) is airdropped. A losing week pays nothing; losses are made back before the next airdrop, so COWBOT's capital never shrinks.
- COWBOT never spends money that belongs to others: the team's unsent share, coin-holder rewards and this week's profit are all subtracted from its spendable balance.
- Max **1 token launch per 24 hours**, a **total launch budget** (default 5 SOL), and **no launches if the wallet drops below a floor** (default 2 SOL).
- Airdrops are **pushed** to wallets. Holders never click claim.

---

## 2. Copy-paste commands

### Step 0 — one-time install of Node.js
Install **Node.js 20 or newer** from https://nodejs.org (pick "LTS"). Then open a terminal (Mac: *Terminal* app · Windows: *PowerShell*) and go into this folder:
```bash
cd path/to/CopyCow.exe
```

### Install everything
```bash
npm install
npm run setup
```
`npm run setup` creates your `.env` settings file. Open `.env` in any text editor and paste in whatever API keys you have (see section 3). Empty is OK — COWBOT skips what it can't use and prints a `TODO`.

### Run the agent (COWBOT) — starts paper trading immediately
```bash
npm run agent
```
Leave this window open. Stop it with `Ctrl + C`. It runs: trading every 5 min · trend scan every 30 min · creator-reward claim every 30 min · launched-coin airdrops daily 00:20 UTC · $COPYCOW profit airdrop Mondays 00:05 UTC · daily report 23:55 UTC.

### Run the trend scanner on its own
```bash
npm run scan
```
Prints the top trending terms and which ones qualify. (Scanner only — it never launches. Add `-- --watch` to keep it running.)

### Run the dashboard
Open a **second** terminal window in the same folder:
```bash
npm run dashboard
```
Then open **http://localhost:3000** in your browser.

**Want to see what it looks like with lots of data first?**
```bash
npm run seed:demo
COPYCOW_DB_PATH=data/demo.db npm run dashboard
```
(The demo uses a separate file and shows a big **DEMO DATA** banner. It never touches COWBOT's real record.)
*Windows PowerShell:* `$env:COPYCOW_DB_PATH="data/demo.db"; npm run dashboard`

### Run the copytrade engine
```bash
npm run engine
```
API on http://localhost:8787 — `GET /signals`, `POST /subscribe`, `GET /queue`, `GET /executions`, `GET /tiers`.

### Other handy commands
```bash
npm run status       # is COWBOT alive? open positions, win rate, next airdrop
npm run wallet       # COWBOT's wallet address (safe to share) + balance
npm run recap        # write today's daily report to content/daily/
npm run fees         # check creator rewards now + show who gets what
npm run airdrop      # PREVIEW the next airdrops (changes nothing); -- --run = $COPYCOW airdrop now, -- --run-coins = coin airdrops now
npm run launch-kit   # regenerate the launch-kit texts (checks all character limits)
npm test             # run all the JavaScript tests
```

### Test the smart contracts
One-time tools install (Mac/Linux; on Windows use **WSL**: https://learn.microsoft.com/windows/wsl/install):
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
sh -c "$(curl -sSfL https://release.anza.xyz/v2.1.21/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.31.1 && avm use 0.31.1
solana-keygen new --no-bip39-passphrase     # a local test wallet (press Enter)
```
Close and reopen the terminal, then:
```bash
cd contracts
npm install
npm test
```
You should see **33 passing**: the 10% / 90% split (and that COWBOT can't redirect the team's share), deposits for both kinds of airdrop, SOL pushed into wallets, double-payment and forged-payout protection, tiers 0–4, and the treasury's daily / launch limits.

### Deploy the contracts (once you have a Solana wallet with SOL)
**Always do devnet (free test network) first:**
```bash
cd contracts
solana config set --url devnet
solana airdrop 5                    # free test SOL (or use https://faucet.solana.com)
npm run deploy:devnet
cd .. && npm run wallet && cd contracts   # makes sure COWBOT's wallet exists
npm run init:programs -- --cluster devnet
```
Copy the `DIVIDEND_PROGRAM_ID=...` line it prints into your `.env`.

**Mainnet** (real SOL — have ~8 SOL in the deploy wallet: about 5.2 SOL stays locked as program rent, refundable if you ever close the programs; the rest is temporary working space that comes back):
```bash
npm run deploy:mainnet              # asks you to type "moo" to confirm
npm run init:programs -- --cluster mainnet-beta
```
⚠️ Back up `contracts/keys/mainnet/` and `data/wallet/` somewhere safe and offline. Before mainnet, consider making the admin a multisig (e.g. Squads).

---

## 3. API keys you need (all free)

| Service | What it's for | Get it | Required? |
|---|---|---|---|
| **Helius** | Fast, reliable Solana connection (wallet balances, holder snapshots for airdrops) | https://dev.helius.xyz → sign up → copy API key → `HELIUS_API_KEY` | Recommended (public RPC works but is slow and blocks holder snapshots) |
| **Jupiter** | Prices + swap quotes for realistic paper fills | https://station.jup.ag — **works with no key** (free "lite" API). Optional key → `JUPITER_API_KEY` | No |
| **Birdeye** | Backup price feed | https://docs.birdeye.so → free tier → `BIRDEYE_API_KEY` | No |
| **X API v2** | Trend scanning on X | https://developer.x.com → create a Project + App → "Bearer Token" → `X_BEARER_TOKEN` | No (free DexScreener + GeckoTerminal data is used meanwhile) |
| GeckoTerminal, DexScreener | Top tokens by volume, trending pools, new tokens | Free, **no key** | — |
| OpenAI (optional) | Cartoon images for launched tokens | https://platform.openai.com → `OPENAI_API_KEY` | No (plain colored image otherwise) |

**About X's free tier:** it allows only ~100 post reads per month. COWBOT enforces that as a hard budget (`X_MONTHLY_POST_BUDGET`) and spreads it out: about one small X read every 3 days. If your X plan doesn't allow search at all, COWBOT logs a TODO and keeps working on the free sources. A paid X tier makes the X half much stronger.

---

## 4. GO-LIVE CHECKLIST (in this order)

1. **☐ Paper-trade for 30 days.** `npm run agent` on a computer or small cloud server that stays on, plus `npm run dashboard`. Don't touch the strategy settings mid-test.
2. **☐ Publish the results.** Share the dashboard (win rate, equity curve, drawdown, Proof Ledger) and the daily reports from `content/daily/`. Be honest: if the 30 days are bad, fix that before step 3.
3. **☐ Launch $COPYCOW on pump.fun — from COWBOT's wallet.** Import `data/wallet/cowbot-keypair.json` into a wallet app (e.g. Phantom → "Import private key") and create $COPYCOW with it, so $COPYCOW's creator rewards land in COWBOT's reward vault and follow the 10% / 90% rule automatically. Don't buy $COPYCOW with that wallet: COWBOT's own wallet never receives airdrops. (If the team launches it from another wallet, those rewards stay with that wallet and COWBOT never sees them.) Use `launch-kit/pumpfun-description.txt`, post `launch-kit/tweets.md`, set your X bio from `launch-kit/x-bio.txt`. Put the token address in `.env` as `COPYCOW_MINT=`.
4. **☐ Migrate to Raydium / PumpSwap.** This happens on pump.fun when the bonding curve completes. Then submit `launch-kit/dexscreener-description.txt` and `coingecko-description.txt`. Add the pool/LP addresses to `AIRDROP_EXCLUDE_WALLETS` (pool vaults are also auto-skipped).
5. **☐ Set the team wallet and activate the money contract.** Put the team's wallet address in `.env` as `TEAM_WALLET=` (a wallet the team controls, ideally a multisig, NOT COWBOT's). Get a free Helius key, then deploy to devnet → test → mainnet (section 2). Put `DIVIDEND_PROGRAM_ID` in `.env`. Run `npm run airdrop` to preview the numbers (it changes nothing).
6. **☐ Go real: launches, launch sales, reward claims and airdrops.** Fund COWBOT's wallet (`npm run wallet` shows the address) with your launch budget + the floor (e.g. 5 + 2 SOL). Set `LAUNCH_MODE=real`, restart `npm run agent`, and watch the first launch closely. From then on: COWBOT sells each launch buy at 2× or after 24h, claims creator rewards every 30 min (90% of $COPYCOW's → `TEAM_WALLET`), airdrops launched-coin rewards to their holders daily, and airdrops its real profit to $COPYCOW holders every Monday. Check the first of each on Solscan.
7. **☐ Real trading profit — a later step.** Momentum trading is still paper-only, so its profit only appears in the *paper* airdrop record. Real $COPYCOW airdrops come from real launch-sale profit until real trading is built and switched on.

---

## 5. Honest notes (read before going real)

- **Paper creator rewards are estimates.** Paper-launched tokens don't exist, so their rewards are estimated from the real 24h volume of the trend they rode — capped at the token's market cap and 3× its liquidity so fake wash volume can't inflate it — × pump.fun's creator fee rate × a small capture share. They're labelled **simulated** everywhere.
- **Real momentum trading isn't built yet.** COWBOT's momentum trades are paper (simulated against live prices). Real money flows today come from launches: selling launch buys and creator rewards. Real trading is a separate, careful step (it puts COWBOT's capital at risk), so `LAUNCH_MODE=real` doesn't switch it on.
- **One reward vault, many coins.** pump.fun pays all of COWBOT's creator rewards into one vault, so each claim is split between $COPYCOW and the launched coins in proportion to each coin's (believable) 24h trading volume. It's a close estimate, not an exact per-coin figure.
- **Paper-launched coins don't exist,** so their simulated rewards can't be airdropped to anyone; the dashboard shows them as "for coin holders". Their launch-buy profit is simulated by following the real trending token they copied.
- **pump.fun has no official server-side launch SDK.** Real launches use the widely used PumpPortal "local transaction" API: it builds the transaction, and COWBOT **signs it locally** (your keys never leave your machine). Creator fees are claimed the same way. If pump.fun changes its system, this part may need an update.
- **Copytrades are paper only.** The engine builds and logs the exact swap each subscriber would make, sized and ordered by tier, but never signs or sends anything. Real auto-execution needs a custody / delegation design (who signs for the subscriber?). That's a separate, careful decision.
- **Copytrade performance fees go 100% to $COPYCOW holders**, added to the weekly profit airdrop (as in the original brief).
- **The team's 90% is never COWBOT's money.** If sending it ever fails, COWBOT retries every 30 minutes and leaves it out of its own balance, so it can't be spent on launches. With no `TEAM_WALLET` set, COWBOT doesn't claim rewards at all.
- **"Anyone can call distribute()."** On Solana a contract can't list every holder by itself, so the weekly snapshot + Merkle tree is built off-chain by COWBOT (the keeper/relayer) and only the relayer may publish it. Otherwise anyone could publish a fake list. The contract still guarantees: no double payments, no payouts beyond the vault, and every payout must match the published list.
- **Hosting copycow.xyz:** the dashboard reads the same database file as the agent, so host both on the same machine (any small VPS; run `npm run build -w dashboard` then `npm run start -w dashboard`). Platforms like Vercel can't see a local database file.
- Nothing here is financial advice. Meme-token launches are speculative. Start small.

---

## 6. For developers

- Node workspaces: `shared`, `agent`, `copytrade-engine`, `dashboard`. One `.env` at the root; one SQLite DB at `data/copycow.db` (WAL mode, so the dashboard reads while the agent writes).
- Strategy: `agent/src/strategy/momentum.ts` · trading cycle: `agent/src/trading/cycle.ts` · paper fills: `agent/src/trading/paper-broker.ts`
- Proof ledger: `shared/src/proof.ts` — `hash = sha256(prev_hash + "|" + canonical_json_payload)`, verifiable in the browser on `/proof`.
- Merkle format (must match the contract): leaf = `sha256(0x00 ‖ epoch u64le ‖ index u32le ‖ wallet ‖ amount u64le)`, node = `sha256(0x01 ‖ sorted(a, b))`.
- Contracts: Anchor 0.31.1 / Solana 2.1.21. The committed `contracts/keys/*.json` are **dev-only** program keys for tests and devnet; `deploy.sh` makes fresh keys for mainnet. `Cargo.lock` is pinned to crates that build with Solana's bundled Rust.
