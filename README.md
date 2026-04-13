# DCT Protocol

🏆 **Won 1st Place in KJSSE HACK X**

Delegatable Capability Tokens is a full-stack protocol for cryptographically scoped AI agent authorization on Base Sepolia. It combines off-chain Biscuit attenuation, on-chain delegation enforcement, TLSNotary attestations, ERC-4337 sponsorship, and a React/Vite control surface for demos and operator workflows.

| Layer | Technology |
|---|---|
| Identity | ERC-8004 Agent NFT Registry |
| Off-chain auth | Eclipse Biscuit WASM (Ed25519 + Datalog) |
| On-chain enforcement | DCTRegistry + DCTEnforcer (UUPS proxies) |
| Action attestation | TLSNotary extension or server-side prover |
| Gas sponsorship | ERC-4337 via Pimlico bundler + paymaster |
| Backend | Node.js + Express in `server/` |
| Frontend | React + Vite in `client/` |
| Contracts | Foundry in `contracts/` |

## What ships

- `/` landing page with protocol overview.
- `/tlsn` proof builder for TLSNotary, with browser extension mode and server API fallback.
- `/live-demo` 12-phase interactive end-to-end demo with live on-chain event stream.
- `/layer` operator console for OpenClaw workflow setup, CORS proxying, and demo orchestration.
- Backend APIs for agents, Biscuit tokens, delegation, revocation, trust scoring, TLSN proofs, ERC-4337 execution, and workflow snapshots.
- Solidity contracts for registry, enforcer, notary verifier, caveat enforcer, and upgrade scripts.

## Architecture

The core flow is:

1. An ERC-8004 agent is registered or discovered.
2. A Biscuit root token is minted and attenuated offline.
3. Delegation is recorded on-chain in DCTRegistry.
4. Execution is validated by DCTEnforcer using scope, revocation state, and attestation.
5. TLSNotary can prove the HTTP action, and ERC-4337 can sponsor gas when Pimlico is configured.
6. Trust scoring is computed from on-chain and off-chain signals and shown in the UI.

## Repository Layout

- `client/` React UI, demo pages, and local UI state.
- `server/` Express API, blockchain wiring, Biscuit helpers, TLSN prover integration, and demo endpoints.
- `contracts/` Foundry contracts, scripts, tests, and deployment helpers.
- `docs/LOCAL_DEV.md` local Anvil walkthrough and demo instructions.
- `contracts/DELEGATION_FRAMEWORK.md` MetaMask delegation framework notes.
- `scripts/demo-onchain.sh` one-command Base Sepolia demo runner.

## Run The App

### Prerequisites

- Node 20+.
- Docker Desktop if you want the local TLSNotary notary stack.
- Foundry if you want to build or deploy contracts locally.

### Install

```bash
npm install --prefix server
npm install --prefix client
```

### Environment

Copy the example files and fill them in:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Minimum useful variables:

```bash
# server/.env
PRIVATE_KEY=<signer private key>
INFURA_PROJECT_ID=<or set RPC_URL>
ADDRESSES_FILE=addresses.base-sepolia.json
DATABASE_URL=<optional Postgres URL>
PIMLICO_API_KEY=<optional, enables ERC-4337>
TLSN_NOTARY_URL=http://127.0.0.1:7047
TLSN_PROVER_URL=http://127.0.0.1:8090

# client/.env
VITE_API_URL=http://localhost:3000
VITE_BASESCAN_URL=https://sepolia.basescan.org
VITE_TLSN_DEMO_URL=https://api.github.com/zen
```

For the Layer console, optional demo overrides live in `client/.env` as `VITE_LAYER_SHARED_URL`, `VITE_LAYER_SHARED_BEARER`, `VITE_LAYER_MODEL`, `VITE_LAYER_ORCH_URL`, `VITE_LAYER_ORCH_BEARER`, `VITE_LAYER_RESEARCH_URL`, `VITE_LAYER_RESEARCH_BEARER`, `VITE_LAYER_PAYMENT_URL`, and `VITE_LAYER_PAYMENT_BEARER`.

### Start Backend And Frontend

From the repo root:

```bash
npm start --prefix server
npm run dev --prefix client
```

- Server: http://localhost:3000
- Client: http://localhost:5173
- Direct demo routes still work at `/tlsn`, `/live-demo`, and `/layer`.

## Demo Paths

### Fastest UI Demo

1. Start the server and client.
2. Open http://localhost:5173/live-demo.
3. Run the 12-phase demo end to end.

The phases cover:

| Phase | What happens |
|---|---|
| 0 | Health checks for chain, registry, enforcer, ERC-8004, Pimlico, TLSNotary |
| 1 | Three agents are registered |
| 2 | Root Biscuit token is minted |
| 3 | Orchestrator delegates to Research |
| 4 | Research delegates to Payment |
| 5 | Successful execution with revocation, identity, scope, and attestation checks |
| 6 | Off-chain Datalog rejection with zero gas |
| 7 | On-chain revert for out-of-scope action |
| 8 | Single-tx cascade revocation |
| 9 | Lineage walk animation |
| 10 | Trust score timeline |
| 11 | Summary and stats |

The right-hand panel streams `GET /api/events` SSE output from Base Sepolia.

### On-Chain Demo Script

If you want the scripted chain + audit run instead of the browser demo, use:

```bash
./scripts/demo-onchain.sh
```

That loads `server/.env` and runs `npm run demo:onchain` in the server. The same command can be run directly with:

```bash
cd server && npm run demo:onchain
```

### TLSNotary Demo

The `/tlsn` page supports two modes:

- Extension mode: uses the maintained `tlsn-extension` Chrome extension and runs the proof in-browser.
- Server API mode: calls `POST /api/tlsn/prove` on this repo’s server, which proxies to `TLSN_PROVER_URL`.

For the extension path:

```bash
git clone https://github.com/tlsnotary/tlsn-extension.git
cd tlsn-extension && npm install && npm run dev
```

Then load the unpacked extension in Chrome, start the verifier from the tlsn-extension repo, and return to this repo:

```bash
cd /path/to/tlsn-extension
cd packages/verifier && cargo run
```

You can also use the local Docker notary stack instead of the Rust verifier binary.

### Layer Console Demo

The `/layer` page is the operator workflow console for OpenClaw.

- Click Autofill demo to load bundled tunnel URLs and bearer tokens.
- Save snapshot persists workflow metadata only, not secrets.
- Run OpenClaw chain executes the configured Orchestrator → Research → Payment sequence.
- Run DCT live demo navigates to the main demo and starts the same end-to-end workflow.

## TLSNotary Local Stack

Start the notary and WebSocket-to-TCP proxy with Docker:

```bash
docker compose -f docker-compose.tlsn.yml up -d
```

This brings up:

- notary on http://127.0.0.1:7047
- wstcp proxy on ws://127.0.0.1:55688

If you want the optional server-side prover used by `/api/tlsn/prove`, run:

```bash
cd server && npm run tlsn-prover
```

## Base Sepolia And Local Chain Workflows

### Base Sepolia

Use the committed address files as the default app target:

- `server/addresses.base-sepolia.json`
- `client/src/addresses.base-sepolia.json`

If you redeploy the contracts, run the broadcast sync script so both app layers pick up the new proxy addresses.

### Local Anvil

See `docs/LOCAL_DEV.md` for the full walkthrough. The short version is:

```bash
anvil
cd contracts
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export DEPLOY_LOCAL_IDENTITY_REGISTRY=true
forge script script/DeployDCT.s.sol:DeployDCT --rpc-url http://127.0.0.1:8545 --broadcast
node scripts/sync-addresses-from-broadcast.mjs --chain 31337
```

Then point the server at `addresses.local-anvil.json` and start the server and client normally.

## Main API Surface

- `GET /` server health and runtime summary.
- `GET /api/config` public chain and contract metadata.
- `GET /api/events` SSE stream for live on-chain updates.
- `GET /api/agents` agent registry and trust scores.
- `POST /api/agents/register` register an ERC-8004 agent.
- `GET /api/delegation/tree` delegation lineage tree.
- `POST /api/delegation/register` register a root delegation.
- `POST /api/delegation/delegate` full Biscuit + on-chain delegation.
- `POST /api/delegation/execute` Datalog auth plus on-chain enforcement.
- `POST /api/delegation/revoke` cascade revocation.
- `POST /api/biscuit/mint`, `POST /api/biscuit/attenuate`, `POST /api/biscuit/authorize`, `POST /api/biscuit/inspect`.
- `GET /api/tlsn/config`, `POST /api/tlsn/prove`, `POST /api/tlsn/commit`.
- `POST /api/aa/execute-scope` ERC-4337 execution path.
- `GET /api/layer/snapshot`, `POST /api/layer/snapshot`, `GET /api/layer/openclaw-health`, `POST /api/layer/openclaw-chat`.
- `GET /api/integrations/delegation-framework` for the MetaMask caveat-enforcer integration.

## Contracts And SDK

The contracts live in `contracts/src/` and include:

- `DCTRegistry.sol` for lineage, revocation, and trust scoring.
- `DCTEnforcer.sol` for scoped action validation.
- `NotaryAttestationVerifier.sol` for TLSNotary attestations.
- `mocks/TestAgentRegistry.sol` for local development.

Run tests with:

```bash
cd contracts && forge test -v
```

Deploy and upgrade scripts are in `contracts/script/`, and the canonical local guide is `contracts/README.md`.

The local SDK is published as `@shaurya2k06/dctsdk` version 1.1.0 and is consumed by the server through `file:../packages/dct-sdk`. Useful exports include `mintRootToken`, `attenuateToken`, `authorizeToken`, `delegate`, `execute`, `revoke`, and `computeTrustProfile`.

## Security Notes

- Keep `server/.env` and `client/.env` uncommitted.
- Rotate any private key or bearer token that was ever printed.
- `DCTEnforcer.validateAction` is deprecated; use `validateActionWithScope`.
- The registry and enforcer are UUPS upgradeable, and upgrades are owner controlled.
- `POST /api/layer/snapshot` rejects PEM/private-key content by design.

## References

- `docs/LOCAL_DEV.md` for the Anvil workflow.
- `contracts/README.md` for deployment and upgrades.
- `contracts/DELEGATION_FRAMEWORK.md` for the MetaMask delegation caveat setup.
