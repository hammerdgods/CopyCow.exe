/**
 * Turns raw text/tickers into clean "terms" and decides whether a term is
 * MEMEABLE (short, catchy, pronounceable) and not an existing large-cap.
 */

/** Big, established names — riding these is pointless (and confusing). */
export const LARGE_CAP_BLOCKLIST = new Set(
  (
    "sol solana bonk wif dogwifhat jup jupiter popcat pengu pudgy trump melania ray raydium pyth jto render bome mew " +
    "fartcoin goat pnut ai16z moodeng chillguy pump pumpfun usdc usdt btc bitcoin eth ethereum hype zec xrp doge " +
    "dogecoin shib pepe spx giga retardio michi wen jitosol msol bnb ton sui apt avax link uni aave ondo tao virtual " +
    "griffain zerebro arc fwog mog brett wojak"
  ).split(" "),
);

/** Common words that show up everywhere and mean nothing. */
const STOPWORDS = new Set(
  (
    "the and for you are with this that from have just will your what when they new now out get all not but can " +
    "its was one has who how more about like into than then them been only also some very time today make here " +
    "coin coins token tokens crypto meme memes memecoin memecoins launch launched launching airdrop presale chart " +
    "pump dump moon send sending buy sell ape aped gem gems alpha call calls ca dex dexscreener birdeye trading " +
    "trade trader market marketcap mcap holders holder community dev devs team project official live soon next " +
    "big bull bullish bear bearish lfg gm gn wagmi ngmi dyor nfa x twitter telegram tg discord web site website " +
    "price volume liquidity chain onchain network wallet wallets degen degens jeet jeets rug rugs ath usd sol " +
    "the1 new1 bonding curve king hill stream streaming"
  ).split(" "),
);

/** Roots that tend to make good memes. A small bonus, not a requirement. */
const MEME_ROOTS = [
  "cat", "dog", "frog", "pepe", "inu", "moo", "cow", "goat", "ape", "monk", "hat", "chill", "based", "wojak",
  "pup", "kitty", "doge", "shib", "bear", "bull", "hamster", "duck", "penguin", "seal", "otter", "capy", "fish",
  "bird", "owl", "fox", "panda", "pig", "chad", "baby", "lil", "king", "wif", "boi", "guy", "gf", "bro", "meow",
];

export function normalizeTerm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[$#@]+/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Words COWBOT must never launch a token about (slurs, sexual violence,
 * hate, extremism, self-harm, hard drugs, scams).
 * BLOCKED_ANYWHERE: blocked even inside another word ("xrapex").
 * BLOCKED_EXACT:    short words that would otherwise hit innocent words
 *                   ("coon" vs raccoon, "spic" vs spicy, "meth" vs method).
 */
const BLOCKED_ANYWHERE = [
  "rape", "rapist", "nigg", "faggot", "retard", "tranny", "kike", "chink", "wetback", "nazi", "hitler", "kkk",
  "jihad", "terroris", "pedo", "loli", "childporn", "porn", "pussy", "cunt", "whore", "slut", "suicide",
  "murder", "massacre", "genocide", "holocaust", "cocaine", "heroin", "fentanyl", "rugpull", "ponzi", "molest",
];
const BLOCKED_EXACT = new Set(["fag", "spic", "coon", "gook", "isis", "meth", "sex", "cum", "cock", "dick", "kill", "scam", "rug"]);

/** Innocent words that happen to contain a blocked piece ("grape" ⊃ "rape"). Removed before checking. */
const INNOCENT_CONTAINING = ["grape", "drape", "scrape", "trapez", "therapist", "parapet", "skunk", "snigger"];

export const isBlockedTerm = (term: string): boolean => {
  let t = term.toLowerCase().replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/[^a-z]/g, "");
  if (BLOCKED_EXACT.has(t)) return true;
  for (const ok of INNOCENT_CONTAINING) t = t.split(ok).join("-");
  return BLOCKED_EXACT.has(t) || BLOCKED_ANYWHERE.some((b) => t.includes(b));
};

export function isMemeable(term: string): boolean {
  if (isBlockedTerm(term)) return false;
  if (term.length < 3 || term.length > 14) return false;
  if (!/^[a-z][a-z0-9]*$/.test(term)) return false;
  if ((term.match(/[0-9]/g) ?? []).length > 2) return false;
  if (!/[aeiouy]/.test(term)) return false; // must be sayable
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(term)) return false; // "xkcdqz" isn't a meme
  if (STOPWORDS.has(term)) return false;
  return true;
}

export const hasMemeRoot = (term: string): boolean => MEME_ROOTS.some((r) => term.includes(r));

export const isLargeCap = (term: string, extraBlock: Set<string> = new Set()): boolean =>
  LARGE_CAP_BLOCKLIST.has(term) || extraBlock.has(term);

/** Pull candidate terms out of a social post: $CASHTAGS, #hashtags, and CapitalizedWords. */
export function termsFromText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/[$#]([A-Za-z][A-Za-z0-9]{1,15})/g)) out.add(normalizeTerm(m[1]));
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,13}|[A-Z]{3,10})\b/g)) out.add(normalizeTerm(m[1]));
  return [...out].filter((t) => t.length >= 3);
}

const SOLANA_HINTS = /solana|\$sol\b|\bsol\b|pump\.?fun|pumpswap|raydium|jupiter|\bjup\b|meteora|phantom|\bca\b|pump\b/i;
export const looksSolanaAdjacent = (text: string): boolean => SOLANA_HINTS.test(text);
