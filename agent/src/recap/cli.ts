/** `npm run recap` (today) or `npm run recap -- 2026-10-14` (a specific day, UTC). */
import { openDb } from "@copycow/shared";
import { writeDailyRecap } from "./daily";

const date = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const { file, post } = writeDailyRecap(openDb(), date);
console.log(post);
console.log(`\n📝 Saved to ${file}`);
