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

Environment variables for **local Anvil** (see `server/.env.example`):

| Variable | Example |
|----------|---------|
| `RPC_URL` | `http://127.0.0.1:8545` |
| `PRIVATE_KEY` | Anvil account #0 private key |
| `ADDRESSES_FILE` | `addresses.local-anvil.json` |

For **Base Sepolia** (testnet), prefer **`INFURA_PROJECT_ID`** in `server/.env` (or a full Infura `RPC_URL`) instead of legacy Alchemy — wider `eth_getLogs` ranges for `/api/agents`. See `server/.env.example`.

## TLSNotary — what is `TLSN_PROVER_URL`?

- **`TLSN_PROVER_URL`** is the base URL of a small HTTP service that implements **`POST /prove`** (see `server/lib/tlsn/prover.mjs`). The main API server calls it when generating TLS proofs for `POST /api/tlsn/prove` and `POST /api/delegation/execute` (when a URL is supplied).
- It is **not** the notary. The **notary** is the TLSNotary MPC server (e.g. `http://127.0.0.1:7047` from Docker).

**Local stack:**

```bash
# Notary + WebSocket TCP proxy (browser demos)
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
