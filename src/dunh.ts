import { PythClient } from "@openoracle/sdk";
import { loadEnv, loadMarkets } from "./config.js";
import { Monitor } from "./monitor.js";
import { buildServer } from "./server.js";
import { DemoSource, PythSource, UniswapV3Source } from "./sources.js";

const env = loadEnv();
const markets = loadMarkets(env.MARKETS_FILE);

const demo = env.DEMO || !env.PYTH_API_KEY;
// Rough starting points for demo mode only — not live quotes.
const DEMO_SEEDS: Record<string, number> = { NVDA: 182, TSLA: 248, AAPL: 231, MSFT: 512, AMD: 165, COIN: 318 };
const seeds = Object.fromEntries(markets.map((m) => [m.feedId.toLowerCase(), DEMO_SEEDS[m.symbol] ?? 100]));
const ref = demo ? new DemoSource(seeds) : new PythSource(new PythClient({ apiKey: env.PYTH_API_KEY, endpoint: env.PYTH_ENDPOINT }));
const dex = env.RPC_URL ? new UniswapV3Source(env.RPC_URL) : null;

const monitor = new Monitor(markets, ref, dex, { historySize: env.HISTORY });
monitor.on("error", (e) => console.error("[poll]", e instanceof Error ? e.message : e));
monitor.on("market", (s) => console.log(`[market] ${s.symbol} is now ${s.market.open ? "OPEN" : "CLOSED"}`));

const app = buildServer(monitor, { source: ref.name, pollMs: env.POLL_MS });
monitor.start(env.POLL_MS);
await app.listen({ port: env.PORT, host: env.HOST });

console.log(`stocks-monitor on :${env.PORT} · source=${ref.name}${demo ? " (DEMO — set PYTH_API_KEY for real prices)" : ""} · dex=${dex ? "uniswap-v3" : "off"} · ${markets.length} markets`);

const shutdown = async () => {
  monitor.stop();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
