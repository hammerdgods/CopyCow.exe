/** Turns a trend word into a token name, ticker (max 8 chars) and description. */

export interface TokenIdentity {
  name: string;
  ticker: string;
  description: string;
}

export function makeTokenIdentity(term: string): TokenIdentity {
  const clean = term.toLowerCase().replace(/[^a-z0-9]/g, "");
  let ticker = clean.toUpperCase().slice(0, 8);
  if (ticker.length < 3) ticker = `${ticker}MOO`.slice(0, 8);
  const name = (clean.charAt(0).toUpperCase() + clean.slice(1)).slice(0, 32);
  // pump.fun descriptions: keep it short, honest and on-brand.
  const description =
    `${name} ($${ticker}) — spotted trending on Solana by COWBOT, the AI cow behind copycow.exe. ` +
    `Launched autonomously by an agent riding the "${clean}" narrative. Pure meme, no promises, not financial advice. Moo.`;
  return { name, ticker, description: description.slice(0, 500) };
}
