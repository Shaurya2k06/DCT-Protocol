# Local dev — Anvil, deploy, integration

Same idea as the hackathon cheat sheet, wired to **this** repo.

## Step 1 — dependencies

- [Foundry](https://book.getfoundry.sh) (`forge`, `cast`, `anvil`)
- Node 20+
- Docker (optional, for TLSNotary notary + dev prover companion)

## Step 2 — Anvil + deploy

**Terminal A — chain**

```bash
anvil
```

**Terminal B — deploy DCT stack (prints proxy addresses)**

```bash
cd contracts

export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export DEPLOY_LOCAL_IDENTITY_REGISTRY=true

forge script script/DeployDCT.s.sol:DeployDCT \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

**Sync addresses into the app** (reads `broadcast/DeployDCT.s.sol/31337/run-latest.json`):

```bash
node scripts/sync-addresses-from-broadcast.mjs --chain 31337
```

That updates `server/addresses.local-anvil.json` and `client/src/addresses.local-anvil.json`. Point the server at them:

```bash
export ADDRESSES_FILE=addresses.local-anvil.json
```

Optional — copy ABIs after `forge build`:

```bash
forge build && node scripts/export-abis.mjs
```

## Step 3 — run integration (this repo)

There is no `dct_integration.py`. Use one of:

**A) Scripted on-chain demo (recommended)**

```bash
cd server
cp .env .env.backup  # if needed
# Set RPC_URL=http://127.0.0.1:8545 and ADDRESSES_FILE=addresses.local-anvil.json in .env
npm run demo:onchain
```

**B) API + UI**

```bash
# Terminal — server (with ADDRESSES_FILE + RPC_URL for Anvil)
cd server && npm start

# Terminal — client
cd client && npm run dev
```

Use **Dashboard → Delegations → Demo** and mint / delegate / execute against your local addresses.

**Layer console (`/layer`) — OpenClaw demo:** bundled tunnel URLs and tokens live in **`client/src/lib/layerDemoDefaults.js`** (update when ngrok rotates). Click **Autofill demo** with no setup, or set optional `VITE_LAYER_*` in `client/.env` to override. Restart Vite after `.env` changes. **Run OpenClaw chain** runs Orchestrator → Research → Payment. **Run DCT live demo** (primary button) navigates to **`/live-demo`** and auto-starts the same **full E2E** as **Run full E2E workflow** on the Live page (phases 0–11: chain, delegations, payments, TLS, trust). Chat and `/health` are **proxied** via `POST /api/layer/openclaw-chat` and `GET /api/layer/openclaw-health` on the DCT server so the browser never hits ngrok directly (avoids CORS). You must run **`cd server && npm start`** alongside the Vite client. Bearers go to the proxy only in memory; `POST /api/layer/snapshot` still stores no tokens. For non-ngrok OpenClaw hosts, set **`LAYER_OPENCLAW_ALLOW_ALL=1`** on the server (see `server/routes/layer-workflow.js`).

Environment variables for **local Anvil** (see `server/.env.example`):

| Variable | Example |
|----------|---------|
| `RPC_URL` | `http://127.0.0.1:8545` |
| `PRIVATE_KEY` | Anvil account #0 private key |
| `ADDRESSES_FILE` | `addresses.local-anvil.json` |

For **Base Sepolia** (testnet), prefer **`INFURA_PROJECT_ID`** in `server/.env` (or a full Infura `RPC_URL`) instead of legacy Alchemy — wider `eth_getLogs` ranges for `/api/agents`. See `server/.env.example`.

**RPC limits:** Default **`DCT_ETH_GETLOGS_CHUNK_BLOCKS=10`** matches **Infura Free** (max 10 blocks per `eth_getLogs`). **`ERC8004_EVENTS_LOOKBACK_BLOCKS`** (default **2000** in code) limits how far back `/api/agents` scans so the endpoint finishes instead of hammering the RPC. **`DCT_ETH_GETLOGS_DELAY_MS`** (default **120**) spaces out requests — raise it if Alchemy still returns **429**. Alchemy PAYG can use a larger chunk + shorter delay. The server **auto-splits** ranges when the RPC returns “10 block range” errors. Restart the API after changing these.

## TLSNotary

The **`/tlsn`** page supports two modes: **Extension** (browser-side MPC-TLS via the Chrome extension) and **Server API** (backend prover).

### Mode 1 — Extension (recommended for browser demos)

The page detects the **[tlsn-extension](https://github.com/tlsnotary/tlsn-extension)** Chrome extension via `window.tlsn`. When found, it sends a plugin script to the extension which runs a real MPC-TLS proof in-browser.

```bash
# Clone & build the extension (separate repo)
git clone https://github.com/tlsnotary/tlsn-extension.git
cd tlsn-extension && npm install && npm run dev

# Load unpacked in Chrome:
#   chrome://extensions → Developer mode → Load unpacked → packages/extension/build

# Start the verifier server (MPC-TLS counterparty, also acts as proxy)
cd packages/verifier && cargo run   # → http://localhost:7047

# Then open http://localhost:5173/tlsn in this project — the page auto-detects the extension
```

### Mode 2 — Server API (headless / CI)

- **`TLSN_PROVER_URL`** is the base URL of a small HTTP service that implements **`POST /prove`** (see `server/lib/tlsn/prover.mjs`). The main API server calls it when generating TLS proofs for `POST /api/tlsn/prove` and `POST /api/delegation/execute` (when a URL is supplied).
- It is **not** the notary. The **notary** is the TLSNotary MPC server (e.g. `http://127.0.0.1:7047` from Docker).

**Local stack:**

```bash
# Notary + WebSocket TCP proxy
docker compose -f docker-compose.tlsn.yml up -d

# Dev "prover" HTTP API (fills TLSN_PROVER_URL)
cd server && npm run tlsn-prover
```

In `server/.env`:

```bash
TLSN_PROVER_URL=http://127.0.0.1:8090
TLSN_NOTARY_URL=http://127.0.0.1:7047
```

Then `GET http://localhost:3000/api/tlsn/config` should show `"enabled": true`.

The dev prover performs a real HTTP fetch to your target URL and returns a presentation-shaped JSON the Node verifier accepts; for production MPC-TLS proofs, replace it with a real tlsn prover binary or service.

## Contract addresses after deploy

The deploy script logs **four** proxies (ERC-8004 test registry or env, Notary, DCTRegistry, DCTEnforcer). Use the **proxy** addresses everywhere — same as `sync-addresses-from-broadcast.mjs` output.
