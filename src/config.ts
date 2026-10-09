import { readFileSync } from "node:fs";
import { z } from "zod";

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "expected a 0x address");

export const MarketSchema = z.object({
  symbol: z.string().min(1),
  feedId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 32-byte Pyth feed id"),
  schedule: z.string().optional(),
  dex: z
    .object({
      pool: Address,
      stockIsToken0: z.boolean(),
      label: z.string().optional(),
    })
    .optional(),
});
export type Market = z.infer<typeof MarketSchema>;

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default("0.0.0.0"),
  PYTH_API_KEY: z.string().optional(),
  PYTH_ENDPOINT: z.string().url().default("https://hermes.pyth.network"),
  RPC_URL: z.string().url().optional(),
  POLL_MS: z.coerce.number().int().min(1000).default(5000),
  HISTORY: z.coerce.number().int().min(10).max(10_000).default(720),
  MARKETS_FILE: z.string().default("markets.json"),
  /** Force synthetic prices even if a key is present. Without a key the monitor runs in demo mode automatically. */
  DEMO: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});
export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(env);
}

export function loadMarkets(file: string): Market[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { markets?: unknown };
  return z.array(MarketSchema).min(1).parse(raw.markets);
}
