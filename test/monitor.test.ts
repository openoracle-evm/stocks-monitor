import { describe, expect, it } from "vitest";
import type { Market } from "../src/config.js";
import { Monitor } from "../src/monitor.js";
import { buildServer } from "../src/server.js";
import type { DexSource, ReferenceSource } from "../src/sources.js";

const NVDA = "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593";
const TSLA = "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1";
const markets: Market[] = [
  { symbol: "NVDA", feedId: NVDA, dex: { pool: "0x" + "1".repeat(40), stockIsToken0: true, label: "xNVDA/USDC" } },
  { symbol: "TSLA", feedId: TSLA },
];

const OPEN = new Date("2026-10-08T15:00:00Z"); // Thu 11:00 ET
const CLOSED = new Date("2026-10-10T15:00:00Z"); // Saturday

const ref = (prices: Record<string, number>, publishTime = OPEN.getTime() / 1000 - 3): ReferenceSource => ({
  name: "pyth",
  quotes: async (ids) => new Map(ids.filter((id) => prices[id]).map((id) => [id, { price: prices[id]!, confidence: 0.01, publishTime }])),
});
const dex = (price: number): DexSource => ({ price: async (m) => (m.dex ? price : null) });

describe("Monitor", () => {
  it("computes premium vs. reference and classifies it", async () => {
    const m = new Monitor(markets, ref({ [NVDA]: 100, [TSLA]: 250 }), dex(101.2), { historySize: 10, now: () => OPEN });
    await m.poll();
    const nvda = m.get("nvda")!;
    expect(nvda.premiumBps).toBeCloseTo(120);
    expect(nvda.level).toBe("watch");
    expect(nvda.dex?.label).toBe("xNVDA/USDC");
    expect(nvda.reference?.ageSeconds).toBe(3);
    expect(nvda.market.open).toBe(true);
    const tsla = m.get("TSLA")!;
    expect(tsla.premiumBps).toBeNull();
    expect(tsla.reference?.price).toBe(250);
  });

  it("reports the market closed on weekends", async () => {
    const m = new Monitor(markets, ref({ [NVDA]: 100, [TSLA]: 250 }), null, { historySize: 10, now: () => CLOSED });
    await m.poll();
    expect(m.get("NVDA")!.market.open).toBe(false);
  });

  it("caps history and emits a market event on open/close transitions", async () => {
    let now = OPEN;
    const m = new Monitor(markets, ref({ [NVDA]: 100, [TSLA]: 250 }), null, { historySize: 3, now: () => now });
    const events: string[] = [];
    m.on("market", (s) => events.push(`${s.symbol}:${s.market.open}`));
    for (let i = 0; i < 5; i++) await m.poll();
    expect(m.historyOf("NVDA")).toHaveLength(3);
    now = CLOSED;
    await m.poll();
    expect(events).toEqual(["NVDA:false", "TSLA:false"]);
  });

  it("keeps serving the last snapshot when the reference source fails", async () => {
    let fail = false;
    const flaky: ReferenceSource = { name: "pyth", quotes: async (ids) => (fail ? Promise.reject(new Error("Pyth 401")) : ref({ [NVDA]: 100, [TSLA]: 1 }).quotes(ids)) };
    const m = new Monitor(markets, flaky, null, { historySize: 10, now: () => OPEN });
    m.on("error", () => {});
    await m.poll();
    fail = true;
    await m.poll();
    expect(m.lastPollError).toBe("Pyth 401");
    expect(m.get("NVDA")?.reference?.price).toBe(100);
  });

  it("records per-market DEX errors without failing the poll", async () => {
    const broken: DexSource = { price: async () => Promise.reject(new Error("rpc down")) };
    const m = new Monitor(markets, ref({ [NVDA]: 100, [TSLA]: 1 }), broken, { historySize: 10, now: () => OPEN });
    await m.poll();
    expect(m.get("NVDA")?.error).toBe("dex: rpc down");
    expect(m.get("NVDA")?.reference?.price).toBe(100);
  });
});

describe("HTTP API", () => {
  it("serves /health, /markets and /markets/:symbol", async () => {
    const m = new Monitor(markets, ref({ [NVDA]: 100, [TSLA]: 250 }), dex(99), { historySize: 10, now: () => OPEN });
    await m.poll();
    const app = buildServer(m, { source: "pyth", pollMs: 5000 });
    const health = await app.inject("/health");
    expect(health.json()).toMatchObject({ ok: true, source: "pyth", polls: 1 });
    const all = await app.inject("/markets");
    expect(all.json().markets).toHaveLength(2);
    const one = await app.inject("/markets/nvda");
    expect(one.json()).toMatchObject({ symbol: "NVDA", premiumBps: expect.closeTo(-100, 5) });
    expect(one.json().history).toHaveLength(1);
    expect((await app.inject("/markets/XYZ")).statusCode).toBe(404);
    await app.close();
  });
});
