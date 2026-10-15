/**
 * LAUNCH KIT generator — `npm run launch-kit`
 * Edit the text below, run the command, and it rewrites the .txt/.md files
 * in this folder AND checks every character limit for you.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE = "copycow.xyz";
const HANDLE = "@copycowexe";

/** X counts emoji as 2 characters and every link as 23. */
export function xLength(text: string): number {
  const noUrls = text.replace(/https?:\/\/\S+/g, "x".repeat(23));
  let n = 0;
  for (const ch of noUrls) n += (ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
  return n;
}

const PUMPFUN =
  "copycow.exe — an AI cow that grazes on alpha. Mirror its trades. Watch its win rate. All its profits are airdropped weekly to holders. No claim button. Moo.";

const X_BIO = `COWBOT.exe — a public AI agent trading + launching on Solana 24/7. All its profits airdropped weekly to $COPYCOW holders. 🐄 ${SITE}`;

const TWEETS: string[] = [
  `Introducing copycow.exe 🧵\n\nCOWBOT is a public AI trading agent on Solana. Every trade it makes is visible 24/7, and $COPYCOW holders can copy it.\n\nAll its profits, from trading and from the coins it launches, get airdropped to holders. Weekly. No claim button.`,
  `Why another trading bot?\n\nMost "AI agents" are all hat and no cattle: a chat window with a ticker. COWBOT has a wallet, a written strategy and a public record you can audit.\n\nIf it loses, you'll watch it lose. That's the point.`,
  `The strategy is deliberately boring:\n\n• Universe: top 10 Solana tokens by 24h volume (scams + stables filtered out)\n• Enter when 15-min momentum clears a threshold AND volume confirms\n• Exit at +3% take-profit or −1.5% stop\n• Max 3 positions`,
  `What it refuses to do:\n\n• No FOMO: skips anything already up >8% in 15 min\n• No revenge trades: 2h cooldown on a token after a loss\n• 3 losses in a row → it stops and waits an hour\n\nDiscipline is the edge.`,
  `Phase 1 is PAPER trading against live prices: Jupiter quotes for fills, real slippage, every trade logged with timestamp, entry, exit, size and P&L.\n\n30 days of public paper results before a single real SOL moves.`,
  `"Can't you just edit the results?"\n\nNo. Every decision is SHA-256 hashed into a chained proof ledger BEFORE it executes. Change one old trade and every hash after it breaks.\n\nYou can re-verify any entry in your own browser on the dashboard.`,
  `The second engine: trend launches.\n\nCOWBOT scans X + Solana DEX data for mention spikes (>500% vs the 24h average) on memeable, Solana-native names. When a trend clears the bar, it launches a token on pump.fun riding it, and that coin's creator rewards go to its holders.`,
  `Launch guardrails are hard-coded:\n\n• Max 1 launch per 24h\n• Fixed total launch budget\n• No launches if the treasury drops below a floor\n\nThe treasury contract enforces the same limits on-chain.`,
  `Where the money goes:\n\n• COWBOT's profit (trading + selling its launch buys) → $COPYCOW holders, weekly\n• Each launched coin's creator rewards → that coin's holders, daily\n• $COPYCOW's creator rewards → 10% COWBOT (hard cap), 90% team for marketing`,
  `Holders don't click claim.\n\nEvery airdrop: holder snapshot at a fixed slot → Merkle root on-chain → SOL pushed straight into your wallet, gas paid by COWBOT.\n\nLosing week? Nothing paid until it's made back.`,
  `Tiers by holdings:\n\nCALF 100K → dashboard, alerts, airdrops\nHEIFER 1M → real-time Telegram alerts\nCOW 10M → auto-copy API + priority execution\nMAD Cow 50M → config voting + max sizing\n\nMore $COPYCOW = earlier in the copy queue.`,
  `Dashboard: https://${SITE}\nWin rate, live positions, launches, airdrops, proof ledger. All public.\n\nNot financial advice. Paper results are simulated. Size small.\n\nCopy the smartest cow in the room. Moo. 🐄`,
];

const DEXSCREENER = `copycow.exe ($COPYCOW) is the token behind COWBOT, a public AI trading agent on Solana. COWBOT trades momentum + volume signals on the top Solana tokens with fixed take-profit/stop-loss rules, and every decision is SHA-256 hashed into a public proof ledger before it executes. It also scans X and Solana DEX data for trending narratives and launches pump.fun tokens riding them (max 1 per day, hard budget). All of COWBOT's profit (trading + selling its launch buys) is airdropped weekly to $COPYCOW holders, and each launched coin's creator rewards go to that coin's holders daily — automatically, no claim needed. $COPYCOW's own creator rewards: max 10% to COWBOT, 90% to the team for marketing. Holders unlock tiers: alerts, auto-copy and priority execution. Live dashboard: ${SITE}`;

const COINGECKO = `copycow.exe is an autonomous, fully public AI trading agent on Solana, branded COWBOT.

What it does
• Trades: a momentum + volume strategy on the 10 highest-volume Solana tokens (stablecoins, staking tokens and wash-traded pools filtered out). Entries require 15-minute momentum above a threshold, rising volume and more buyers than sellers; exits are +3% take-profit, −1.5% stop-loss or a time limit. Maximum three positions. Rules against FOMO entries and revenge trades are built in.
• Proves: every trade, launch and airdrop decision is SHA-256 hashed into a chained proof ledger before execution, so the published record cannot be edited after the fact.
• Launches: a trend scanner watches X and Solana DEX data for sudden mention spikes on memeable, Solana-native names and can launch a pump.fun token riding the trend (max one launch per 24 hours, fixed budget, treasury floor).
• Shares: ALL of COWBOT's realized profit — momentum trading plus selling its launch buys (at 2x or after 24h), after making back any losing weeks — plus copytrade fees is airdropped weekly to $COPYCOW holders. Each coin COWBOT launches sends 100% of its pump.fun creator rewards to that coin's holders, daily. $COPYCOW's own creator rewards are split on-chain: COWBOT keeps at most 10% (hard-coded) as trading capital, 90% goes to the team wallet for marketing. Every airdrop snapshots holders, publishes a Merkle root and pushes SOL directly into wallets — no claim transaction required.

Token utility ($COPYCOW)
Tiered access by holdings — CALF (100K): dashboard, alerts, airdrop eligibility · HEIFER (1M): real-time Telegram alerts · COW (10M): auto-copy API and priority execution · MAD Cow (50M): agent-config voting and maximum copy sizing.

Status: COWBOT begins with a 30-day public paper-trading period before real funds are used. Dashboard: https://${SITE} · X: ${HANDLE}`;

const LIMITS = { pumpfun: 250, xBio: 160, tweet: 280 };
const problems: string[] = [];
if (PUMPFUN.length > LIMITS.pumpfun) problems.push(`pump.fun description is ${PUMPFUN.length}/${LIMITS.pumpfun}`);
if (xLength(X_BIO) > LIMITS.xBio) problems.push(`X bio is ${xLength(X_BIO)}/${LIMITS.xBio}`);
if (TWEETS.length !== 12) problems.push(`thread has ${TWEETS.length} tweets (need 12)`);
TWEETS.forEach((t, i) => xLength(t) > LIMITS.tweet && problems.push(`tweet ${i + 1} is ${xLength(t)}/${LIMITS.tweet}`));
if (problems.length) {
  console.error("❌ Over the limit:\n  " + problems.join("\n  "));
  process.exit(1);
}

const write = (name: string, body: string) => fs.writeFileSync(path.join(DIR, name), body.endsWith("\n") ? body : `${body}\n`);
write("pumpfun-description.txt", PUMPFUN);
write("x-bio.txt", X_BIO);
write(
  "tweets.md",
  `# copycow.exe launch thread (12 tweets)\n\nPost from ${HANDLE}. Character counts use X's rules (emoji = 2, links = 23).\n\n` +
    TWEETS.map((t, i) => `## ${i + 1}/12  ·  ${xLength(t)}/280\n\n${t}\n`).join("\n"),
);
write("dexscreener-description.txt", DEXSCREENER);
write("coingecko-description.txt", COINGECKO);

console.log("🐄 Launch kit written to launch-kit/:");
console.log(`   pumpfun-description.txt      ${PUMPFUN.length}/250 chars`);
console.log(`   x-bio.txt                    ${xLength(X_BIO)}/160 chars`);
console.log(`   tweets.md                    12 tweets, longest ${Math.max(...TWEETS.map(xLength))}/280`);
console.log(`   dexscreener-description.txt  ${DEXSCREENER.length} chars`);
console.log(`   coingecko-description.txt    ${COINGECKO.length} chars`);
console.log("   Daily recaps: run `npm run recap` → content/daily/");
