import { loadConfig } from "./env.ts";
import { startHub } from "./server.ts";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const hub = startHub(config);
console.log(`[hub] listening on ${hub.url} (auth: ${config.authMode})`);

const shutdown = async () => {
  console.log("[hub] shutting down");
  await hub.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
