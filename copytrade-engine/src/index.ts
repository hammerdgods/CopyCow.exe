/** `npm run engine` — starts the copytrade engine API + signal loop (PAPER mode). */
import { openDb } from "@copycow/shared";
import { createApp } from "./api";
import { engineConfig } from "./config";
import { processSignals } from "./engine";

const db = openDb();
const app = createApp(db);

const tick = () => {
  try {
    processSignals(db);
  } catch (e) {
    console.error("copy engine tick failed:", (e as Error).message);
  }
};
tick();
setInterval(tick, engineConfig.pollSeconds * 1000);

app.listen(engineConfig.port, () => {
  console.log(`🐄 copytrade engine (PAPER) on http://localhost:${engineConfig.port}`);
  console.log(`   try: curl http://localhost:${engineConfig.port}/signals`);
});
