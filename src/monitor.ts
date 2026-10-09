import { EventEmitter } from "node:events";
import { NYSE_SCHEDULE, classifyPremium, marketStatus, parseSchedule, premiumBps, type PremiumLevel, type Schedule } from "@openoracle/sdk";
import type { Market } from "./config.js";
import type { DexSource, ReferenceSource } from "./sources.js";

export type Snapshot = {
  symbol: string;
  source: "pyth" | "demo";
  reference: { price: number; confidence: number; publishTime: number; ageSeconds: number } | null;
  dex: { label: string; price: number } | null;
  premiumBps: number | null;
  level: PremiumLevel | null;
  market: { open: boolean; session: string; halfDay: boolean; holiday: boolean };
  updatedAt: string;
  error?: string;
};

export type HistoryPoint = { t: number; ref: number; dex: number | null };

export class Monitor extends EventEmitter {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly history = new Map<string, HistoryPoint[]>();
  private readonly schedules = new Map<string, Schedule>();
  private timer: NodeJS.Timeout | null = null;
  lastPollError: string | null = null;
  polls = 0;

  constructor(
    private readonly markets: Market[],
    private readonly ref: ReferenceSource,
    private readonly dex: DexSource | null,
    private readonly opts: { historySize: number; now?: () => Date } = { historySize: 720 },
  ) {
    super();
    for (const m of markets) this.schedules.set(m.symbol, parseSchedule(m.schedule ?? NYSE_SCHEDULE));
  }

  private now() {
    return this.opts.now ? this.opts.now() : new Date();
  }

  async poll(): Promise<void> {
    const now = this.now();
    let quotes: Awaited<ReturnType<ReferenceSource["quotes"]>>;
    try {
      quotes = await this.ref.quotes(this.markets.map((m) => m.feedId.toLowerCase()));
      this.lastPollError = null;
    } catch (e) {
      this.lastPollError = e instanceof Error ? e.message : String(e);
      this.emit("error", e);
      return;
    }
    this.polls++;

    await Promise.all(
      this.markets.map(async (m) => {
        const q = quotes.get(m.feedId.toLowerCase()) ?? null;
        let dexPrice: number | null = null;
        let error: string | undefined;
        if (this.dex && m.dex) {
          try {
            dexPrice = await this.dex.price(m);
          } catch (e) {
            error = `dex: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        const prem = q && dexPrice !== null ? premiumBps(dexPrice, q.price) : null;
        const snap: Snapshot = {
          symbol: m.symbol,
          source: this.ref.name,
          reference: q ? { ...q, ageSeconds: Math.max(0, Math.floor(now.getTime() / 1000) - q.publishTime) } : null,
          dex: dexPrice !== null ? { label: m.dex?.label ?? `${m.symbol} pool`, price: dexPrice } : null,
          premiumBps: prem,
          level: prem === null ? null : classifyPremium(prem),
          market: marketStatus(this.schedules.get(m.symbol)!, now),
          updatedAt: now.toISOString(),
          ...(error ? { error } : {}),
        };
        const prev = this.snapshots.get(m.symbol);
        this.snapshots.set(m.symbol, snap);
        if (q) {
          const h = this.history.get(m.symbol) ?? [];
          h.push({ t: now.getTime(), ref: q.price, dex: dexPrice });
          if (h.length > this.opts.historySize) h.splice(0, h.length - this.opts.historySize);
          this.history.set(m.symbol, h);
        }
        if (prev && prev.market.open !== snap.market.open) this.emit("market", snap);
        this.emit("snapshot", snap);
      }),
    );
  }

  start(intervalMs: number) {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  all(): Snapshot[] {
    return this.markets.map((m) => this.snapshots.get(m.symbol)).filter((s): s is Snapshot => Boolean(s));
  }

  get(symbol: string): Snapshot | undefined {
    return this.snapshots.get(symbol.toUpperCase());
  }

  historyOf(symbol: string): HistoryPoint[] {
    return this.history.get(symbol.toUpperCase()) ?? [];
  }
}
