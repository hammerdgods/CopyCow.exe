#!/usr/bin/env bash
# Deploys the three copycow.exe programs.
#   bash scripts/deploy.sh devnet         (free test network — do this first)
#   bash scripts/deploy.sh mainnet-beta   (real network — costs real SOL, ~6-9 SOL for 3 programs)
set -euo pipefail
CLUSTER="${1:-devnet}"
cd "$(dirname "$0")/.."

command -v solana >/dev/null || { echo "❌ Solana CLI not installed. See README → 'Deploy contracts'."; exit 1; }
command -v anchor >/dev/null || { echo "❌ Anchor CLI not installed. See README → 'Deploy contracts'."; exit 1; }
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
[ -f "$WALLET" ] || { echo "❌ No deploy wallet at $WALLET. Create one: solana-keygen new"; exit 1; }

echo "🐄 Deploying to $CLUSTER from wallet $(solana-keygen pubkey "$WALLET")"
solana config set --url "$CLUSTER" >/dev/null
echo "   Wallet balance: $(solana balance)"

if [ "$CLUSTER" = "mainnet-beta" ]; then
  read -r -p "⚠️  MAINNET deploy spends real SOL. Type 'moo' to continue: " ok
  [ "$ok" = "moo" ] || { echo "Cancelled."; exit 1; }
  # Fresh program addresses for mainnet (the committed dev keys are public!).
  mkdir -p keys/mainnet
  for p in dividend_airdrop tier_access treasury; do
    [ -f "keys/mainnet/$p-keypair.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "keys/mainnet/$p-keypair.json"
    mkdir -p target/deploy && cp "keys/mainnet/$p-keypair.json" "target/deploy/$p-keypair.json"
  done
  echo "   ⚠️  BACK UP contracts/keys/mainnet/ — those files control your program upgrades."
  anchor keys sync --provider.cluster mainnet
else
  node scripts/prepare-keys.mjs
fi

# Anchor calls mainnet "mainnet" (the Solana CLI calls it "mainnet-beta").
ANCHOR_CLUSTER="$CLUSTER"
[ "$CLUSTER" = "mainnet-beta" ] && ANCHOR_CLUSTER="mainnet"

anchor build
anchor deploy --provider.cluster "$ANCHOR_CLUSTER" --provider.wallet "$WALLET"
echo
echo "✅ Deployed. Program IDs:"
anchor keys list
echo
echo "Next: initialize them →  npm run init:programs -- --cluster $CLUSTER"
echo "Then copy the dividend_airdrop program ID into ../.env as DIVIDEND_PROGRAM_ID"
