// Copies the committed DEV program keypairs (keys/) into target/deploy/ so
// `anchor test` deploys the programs at the addresses written in the code.
// (These dev keys are for local testing only. Mainnet deploys use FRESH keys:
//  see scripts/deploy.sh.)
import fs from "node:fs";
fs.mkdirSync("target/deploy", { recursive: true });
for (const p of ["dividend_airdrop", "tier_access", "treasury"]) {
  const dest = `target/deploy/${p}-keypair.json`;
  if (!fs.existsSync(dest)) fs.copyFileSync(`keys/${p}-keypair.json`, dest);
}
console.log("program keypairs ready in target/deploy/");
