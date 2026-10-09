import Fastify from "fastify";
import type { Monitor, Snapshot } from "./monitor.js";

export function buildServer(monitor: Monitor, meta: { source: string; pollMs: number }) {
  const app = Fastify({ logger: false });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*");
  });

  app.get("/health", async () => ({
    ok: monitor.lastPollError === null,
    source: meta.source,
    pollMs: meta.pollMs,
    polls: monitor.polls,
    lastError: monitor.lastPollError,
  }));

  app.get("/markets", async () => ({ source: meta.source, markets: monitor.all() }));

  app.get<{ Params: { symbol: string } }>("/markets/:symbol", async (req, reply) => {
    const snap = monitor.get(req.params.symbol);
    if (!snap) return reply.code(404).send({ error: `unknown market ${req.params.symbol}` });
    return { ...snap, history: monitor.historyOf(req.params.symbol) };
  });

  // Server-sent events: one `snapshot` event per market per poll
  app.get("/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
    });
    const send = (s: Snapshot) => reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(s)}\n\n`);
    monitor.all().forEach(send);
    monitor.on("snapshot", send);
    req.raw.on("close", () => monitor.off("snapshot", send));
  });

  return app;
}
