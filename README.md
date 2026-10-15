# 🐄 copycow.exe — Copy the Smartest Cow in the Room

**COWBOT** is a public AI trading agent on Solana. It watches the market every 5 minutes, trades only on momentum + volume (no FOMO, no revenge trades), and shows every trade on a public dashboard. It also scans X (Twitter) and Solana for trending memes, and can launch its own pump.fun token riding a trend. **10% of the creator fees from those launches are airdropped to $COPYCOW holders every week, automatically — nobody clicks "claim".**

> **Everything is PAPER (simulated) by default.** No real money moves until you change `LAUNCH_MODE=paper` to `LAUNCH_MODE=real` in your `.env` file. Trading itself has **no real-money code at all** in this version — it is always paper.

---

## 1. What's in each folder

| Folder | What it is, in plain English |
|---|---|
| `agent/` | **COWBOT itself.** The program that runs 24/7: watches prices, makes paper trades, scans for trends, launches tokens (paper by default), tracks creator fees, splits them 10% / 90%, runs the weekly airdrop, and writes the daily report. |
| `agent/src/trend-scanner/` | The **trend radar**. Reads X (Twitter) + free Solana data (DexScreener, GeckoTerminal), spots names whose mentions suddenly spike, and scores them. |
| `agent/src/token-launcher/` | The **token launcher**. Turns a hot trend into a token (name, ticker, image) and launches it on pump.fun — or, in paper mode, just writes down "would have launched". Safety rules are built in. |
| `dashboard/` | The **public website** (copycow.xyz). Home, Live Trades, History, Performance charts, Launched Tokens, Airdrops, Proof Ledger, Tiers. |
| `copytrade-engine/` | The **copy-trading service**. Holders register their wallet; when COWBOT trades, it lines everyone up by tier (bigger holders go first, with bigger sizes) and logs what it *would* execute. Paper only for now. |
| `contracts/` | The **Solana smart contracts**: Tier Access (what your holdings unlock), Dividend Airdrop (the 10% weekly airdrop), Treasury (the 90% with daily spending limits). |
| `shared/` | Code every part uses: the database, the **hard-coded 10% rule**, the tiers, and the proof hashing. |
| `launch-kit/` | Ready-to-paste text: pump.fun description, X bio, 12-tweet launch thread, DexScreener + CoinGecko descriptions. |
| `content/daily/` | Where COWBOT saves its **daily report** posts (one file per day). |
| `data/` | Created when you run things. Holds the database (`copycow.db`) and **COWBOT's wallet key** (`data/wallet/`). Never shared or uploaded. |

### The money rules (hard-coded, not settings)
- **Exactly 10%** of creator fees (and copytrade fees) go to holders; 90% stays in the treasury. Written as a constant in three places, each marked `FOUNDER RULE: max 10%, do not change`:
  - `shared/src/constants.ts`
  - `contracts/programs/dividend_airdrop/src/lib.rs` (`HOLDER_FEE_BPS = 1000`). The contract **refuses to compile** above 10%.
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
Leave this window open. Stop it with `Ctrl + C`. It runs: trading every 5 min · trend scan every 30 min · fee check every 30 min · weekly airdrop Mondays 00:05 UTC · daily report 23:55 UTC.

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
npm run status       # is COWBOT alive? open positions, win rate, dividend pool
npm run wallet       # COWBOT's wallet address (safe to share) + balance
npm run recap        # write today's daily report to content/daily/
npm run fees         # check creator fees now + show the 10/90 totals
npm run airdrop      # run the weekly airdrop now (paper unless LAUNCH_MODE=real)
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
You should see **31 passing**: the 10% rule, the weekly airdrop pushing SOL into wallets, double-payment and forged-payout protection, tiers 0–4, and the treasury's daily / launch limits.

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
3. **☐ Launch $COPYCOW on pump.fun.** Use `launch-kit/pumpfun-description.txt`, post `launch-kit/tweets.md`, set your X bio from `launch-kit/x-bio.txt`. Put the token address in `.env` as `COPYCOW_MINT=`.
4. **☐ Migrate to Raydium / PumpSwap.** This happens on pump.fun when the bonding curve completes. Then submit `launch-kit/dexscreener-description.txt` and `coingecko-description.txt`. Add the pool/LP addresses to `AIRDROP_EXCLUDE_WALLETS` (pool vaults are also auto-skipped).
5. **☐ Activate the dividend airdrop contract.** Get a free Helius key, then deploy to devnet → test → mainnet (section 2). Put `DIVIDEND_PROGRAM_ID` in `.env`. Run `npm run airdrop` once in paper mode and check the numbers.
6. **☐ Enable real token launches.** Fund COWBOT's wallet (`npm run wallet` shows the address) with your launch budget + the floor (e.g. 5 + 2 SOL). Set `LAUNCH_MODE=real`, restart `npm run agent`, and watch the first launch closely.
7. **☐ First weekly airdrop.** Monday 00:05 UTC it happens by itself. Check the Airdrops page: every payout links to Solscan. If anything was interrupted: `npm run airdrop -- --resume`.

---

## 5. Honest notes (read before going real)

- **Paper creator fees are estimates.** Paper-launched tokens don't exist, so their "fees" are estimated from the real 24h volume of the trend they rode × pump.fun's creator fee rate × a conservative capture share. They're labelled **simulated** everywhere.
- **pump.fun has no official server-side launch SDK.** Real launches use the widely used PumpPortal "local transaction" API: it builds the transaction, and COWBOT **signs it locally** (your keys never leave your machine). Creator fees are claimed the same way. If pump.fun changes its system, this part may need an update.
- **Copytrades are paper only.** The engine builds and logs the exact swap each subscriber would make, sized and ordered by tier, but never signs or sends anything. Real auto-execution needs a custody / delegation design (who signs for the subscriber?). That's a separate, careful decision.
- **Copytrade fees use the same 10/90 split.** Your brief says copytrade fees go to holder dividends, and also that the same splitter applies to them. I followed the more specific rule: **10% to holders, 90% to treasury**, so holders never get more than 10% of anything. If you want 100% of copytrade fees to go to holders, that's a one-line change in `copytrade-engine/src/engine.ts`.
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
