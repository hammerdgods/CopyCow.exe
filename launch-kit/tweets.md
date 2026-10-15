# copycow.exe launch thread (12 tweets)

Post from @copycowexe. Character counts use X's rules (emoji = 2, links = 23).

## 1/12  ·  251/280

Introducing copycow.exe 🧵

COWBOT is a public AI trading agent on Solana. Every trade it makes is visible 24/7, and $COPYCOW holders can copy it.

10% of the creator fees from every token it launches is airdropped to holders. Weekly. No claim button.

## 2/12  ·  227/280

Why another trading bot?

Most "AI agents" are all hat and no cattle: a chat window with a ticker. COWBOT has a wallet, a written strategy and a public record you can audit.

If it loses, you'll watch it lose. That's the point.

## 3/12  ·  241/280

The strategy is deliberately boring:

• Universe: top 10 Solana tokens by 24h volume (scams + stables filtered out)
• Enter when 15-min momentum clears a threshold AND volume confirms
• Exit at +3% take-profit or −1.5% stop
• Max 3 positions

## 4/12  ·  205/280

What it refuses to do:

• No FOMO: skips anything already up >8% in 15 min
• No revenge trades: 2h cooldown on a token after a loss
• 3 losses in a row → it stops and waits an hour

Discipline is the edge.

## 5/12  ·  213/280

Phase 1 is PAPER trading against live prices: Jupiter quotes for fills, real slippage, every trade logged with timestamp, entry, exit, size and P&L.

30 days of public paper results before a single real SOL moves.

## 6/12  ·  240/280

"Can't you just edit the results?"

No. Every decision is SHA-256 hashed into a chained proof ledger BEFORE it executes. Change one old trade and every hash after it breaks.

You can re-verify any entry in your own browser on the dashboard.

## 7/12  ·  220/280

The second engine: trend launches.

COWBOT scans X + Solana DEX data for mention spikes (>500% vs the 24h average) on memeable, Solana-native names. When a trend clears the bar, it launches a token on pump.fun riding it.

## 8/12  ·  193/280

Launch guardrails are hard-coded:

• Max 1 launch per 24h
• Fixed total launch budget
• No launches if the treasury drops below a floor

The treasury contract enforces the same limits on-chain.

## 9/12  ·  221/280

Where the money goes:

Creator fees from every COWBOT launch → agent wallet →
• 10% to $COPYCOW holders (a hard-coded constant that can never exceed 10%)
• 90% to the treasury: compounds, funds trading and future launches

## 10/12  ·  218/280

Holders don't click claim.

Every Monday: holder snapshot at a fixed slot → Merkle root published on-chain → a relayer pushes SOL straight into your wallet and pays the gas.

Every payout tx is linked on the dashboard.

## 11/12  ·  227/280

Tiers by holdings:

CALF 100K → dashboard, alerts, airdrops
HEIFER 1M → real-time Telegram alerts
COW 10M → auto-copy API + priority execution
MAD Cow 50M → config voting + max sizing

More $COPYCOW = earlier in the copy queue.

## 12/12  ·  214/280

Dashboard: https://copycow.xyz
Win rate, live positions, launches, airdrops, proof ledger. All public.

Not financial advice. Paper results are simulated. Size small.

Copy the smartest cow in the room. Moo. 🐄
