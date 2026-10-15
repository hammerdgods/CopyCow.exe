/**
 * Token image. Default: a solid-color square with the trend name on it
 * (free, instant). Optional: if OPENAI_API_KEY is set, ask an image model
 * for a cartoon instead (falls back to the plain image on any error).
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { dataPath } from "@copycow/shared";
import { config } from "../config";

function colorFor(term: string): { bg: string; fg: string } {
  const h = createHash("sha256").update(term).digest();
  const hue = Math.round((h[0] / 255) * 360);
  return { bg: `hsl(${hue}, 70%, 45%)`, fg: "#ffffff" };
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function placeholderSvg(name: string, ticker: string): string {
  const { bg, fg } = colorFor(name);
  // Scale the font so long names still fit inside the border.
  const size = Math.min(96, Math.floor(420 / (Math.max(name.length, 1) * 0.72)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${bg}"/>
  <rect x="16" y="16" width="480" height="480" fill="none" stroke="${fg}" stroke-width="6" stroke-dasharray="14 10"/>
  <text x="256" y="250" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="${size}" font-weight="900" fill="${fg}" text-anchor="middle">${esc(name.toUpperCase())}</text>
  <text x="256" y="320" font-family="Courier New, monospace" font-size="40" fill="${fg}" text-anchor="middle">$${esc(ticker)}</text>
  <text x="256" y="470" font-family="Courier New, monospace" font-size="22" fill="${fg}" opacity="0.8" text-anchor="middle">launched by COWBOT.exe</text>
</svg>`;
}

async function aiImage(name: string, term: string): Promise<Buffer | null> {
  if (!config.openaiApiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.openaiApiKey}` },
      body: JSON.stringify({
        model: "gpt-image-1",
        size: "1024x1024",
        prompt: `A bold, funny cartoon meme-coin mascot logo for "${name}", inspired by the internet trend "${term}". Flat colors, thick outlines, centered, no text.`,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch {
    return null;
  }
}

/** Writes the image to data/launch-images/ and returns its path. */
export async function createTokenImage(name: string, ticker: string, term: string): Promise<string> {
  const ai = await aiImage(name, term);
  const base = dataPath("launch-images", `${ticker.toLowerCase()}-${Date.now()}`);
  if (ai) {
    fs.writeFileSync(`${base}.png`, ai);
    return `${base}.png`;
  }
  const svg = placeholderSvg(name, ticker);
  try {
    const sharp = (await import("sharp")).default;
    await sharp(Buffer.from(svg)).png().toFile(`${base}.png`);
    return `${base}.png`;
  } catch {
    fs.writeFileSync(`${base}.svg`, svg); // pump.fun needs PNG/JPG; fine for paper mode
    return `${base}.svg`;
  }
}
