# stocks-monitor

**Open Oracle** · Live monitor for tokenized stocks.

Polls real equity prices from **Pyth**, optionally reads the on-chain price of a tokenized version from a **Uniswap v3** pool,
and serves the **premium / discount**, market hours and history over HTTP and Server-Sent Events.

```
Pyth (reference) ─┐
                  ├─► Monitor ─► GET /markets · GET /markets/:symbol · GET /stream (SSE)
Uniswap v3 pool ──┘
```

## Run

```bash
npm install
cp .env.example .env      # add PYTH_API_KEY for real prices
npm run dev               # http://localhost:8787/markets
```

Without `PYTH_API_KEY` the service starts with simulated prices so you can try it (`"source": "demo"` in the API).

## Configure markets

`markets.json` lists the Pyth feeds to watch. To compare against an on-chain tokenized stock, add a `dex` block and set `RPC_URL`:

```json
{ "symbol": "NVDA", "feedId": "0xb107…a593",
  "dex": { "pool": "0xPOOL_ADDRESS", "stockIsToken0": true, "label": "xNVDA/USDC" } }
```

## API

| Route | Description |
|---|---|
| `GET /health` | source (pyth/demo), poll count, last error |
| `GET /markets` | latest snapshot of every market |
| `GET /markets/:symbol` | snapshot + price history |
| `GET /stream` | SSE — `snapshot` event per market per poll |

Snapshot:

```json
{ "symbol": "NVDA", "source": "pyth",
  "reference": { "price": 182.41, "confidence": 0.03, "publishTime": 1791492799, "ageSeconds": 1 },
  "dex": { "label": "xNVDA/USDC", "price": 183.10 },
  "premiumBps": 37.8, "level": "inline",
  "market": { "open": true, "session": "09:30–16:00", "halfDay": false, "holiday": false } }
```

## Depends on

[`oracle-sdk`](https://github.com/openoracle-evm/oracle-sdk). For local development the dependency points to `../oracle-sdk`;
after publishing, switch it to `"@openoracle/sdk": "github:openoracle-evm/oracle-sdk"`.

## Docker

Switch the SDK dependency to the GitHub URL first (Docker can't see `../oracle-sdk`).

```bash
docker build -t stocks-monitor . && docker run -p 8787:8787 --env-file .env stocks-monitor
```

## License

MIT
