// One-time setup helper: copies .env.example -> .env if you don't have one yet.
import fs from "node:fs";
if (!fs.existsSync(".env")) {
  fs.copyFileSync(".env.example", ".env");
  console.log("🐄 Created .env from .env.example — open it and paste in any API keys you have.");
} else {
  console.log("🐄 .env already exists — leaving it alone.");
}
fs.mkdirSync("data", { recursive: true });
fs.mkdirSync("content/daily", { recursive: true });
