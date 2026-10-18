/** Updates KEY=value lines in the project's .env (adds missing keys at the end). */
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "@copycow/shared";

export function setEnvValues(values: Record<string, string>): string {
  const file = path.join(repoRoot(), ".env");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, "\n")}${line}\n`;
  }
  fs.writeFileSync(file, text);
  return file;
}
