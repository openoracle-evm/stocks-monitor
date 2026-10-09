import { PythClient, readV3Pool, stockPrice } from "@openoracle/sdk";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import type { Market } from "./config.js";

export type RefQuote = { price: number; confidence: number; publishTime: number };

/** Reference (real-world) prices for a set of feeds. */
export interface ReferenceSource {
  readonly name: "pyth" | "demo";
  quotes(feedIds: string[]): Promise<Map<string, RefQuote>>;
}

/** On-chain price of a tokenized stock. */
export interface DexSource {
  price(market: Market): Promise<number | null>;
}

export class PythSource implements ReferenceSource {
  readonly name = "pyth" as const;
  constructor(private readonly client: PythClient) {}
  async quotes(feedIds: string[]) {
    const prices = await this.client.latestPrices(feedIds);
    return new Map(prices.map((p) => [p.id, { price: p.price, confidence: p.confidence, publishTime: p.publishTime }]));
  }
}

/** Synthetic random-walk prices so the service runs without an API key. Clearly flagged as `source: "demo"`. */
export class DemoSource implements ReferenceSource {
  readonly name = "demo" as const;
  private readonly last = new Map<string, number>();
  constructor(
    private readonly seeds: Record<string, number> = {},
    private readonly rand: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {}
  async quotes(feedIds: string[]) {
    const out = new Map<string, RefQuote>();
    for (const id of feedIds) {
      const prev = this.last.get(id) ?? this.seeds[id] ?? 100 + (parseInt(id.slice(2, 6), 16) % 400);
      const next = prev * (1 + (this.rand() - 0.5) * 0.002);
      this.last.set(id, next);
      out.set(id, { price: next, confidence: next * 0.0002, publishTime: Math.floor(this.now() / 1000) });
    }
    return out;
  }
}

export class UniswapV3Source implements DexSource {
  private readonly client: PublicClient;
  constructor(rpcUrl: string) {
    this.client = createPublicClient({ transport: http(rpcUrl) });
  }
  async price(market: Market) {
    if (!market.dex) return null;
    const snap = await readV3Pool(this.client, market.dex.pool as Address);
    return stockPrice(snap, market.dex.stockIsToken0);
  }
}
