# DCT Protocol

**Delegatable Capability Tokens** — a full-stack protocol for cryptographically-scoped AI agent authorization on Base.

| Layer | Technology |
|---|---|
| Identity | ERC-8004 Agent NFT Registry |
| Off-chain auth | Eclipse Biscuit WASM (Ed25519 + Datalog) |
| On-chain enforcement | DCTRegistry + DCTEnforcer (UUPS, Base Sepolia) |
| Action attestation | TLSNotary (Dockerized notary + server-side prover) |
| Gas sponsorship | ERC-4337 via Pimlico bundler + paymaster |
| Backend | Node.js / Express (`server/`) |
| Frontend | React / Vite (`client/`) |

---

## Quick start

```bash
# 1 — Install all deps
npm install --prefix server
npm install --prefix client

# 2 — Copy and fill env
cp server/.env.example server/.env
# Required: PRIVATE_KEY, ALCHEMY_API_KEY (or RPC_URL)
# Optional: PIMLICO_API_KEY, DATABASE_URL, TLSN_*

# 3 — Start server (WASM module support required)
cd server && npm start
# → http://localhost:3000

# 4 — Start client
cd client && npm run dev
# → http://localhost:5173  (Live Demo at /live-demo)

# 5 — (Optional) TLSNotary Docker notary
docker compose -f docker-compose.tlsn.yml up -d
# → notary on :7047, wstcp proxy on :55688

# 6 — (Optional) Dev TLS prover
cd server && npm run tlsn-prover
# → prover on :8090
```

---

## Contract addresses — Base Sepolia (chainId 84532)

| Contract | Address |
|---|---|
| ERC8004IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| DCTRegistry | `0x2cec268a5934bfa5aa7f973ac7accf8ac17b89cf` |
| DCTEnforcer | `0x256a633fa2c990a64ec4adf79685f59490a241f8` |
| DCTCaveatEnforcer | `0x8e4c74b1a26663ba734fbeb7a7cc68204cf1eb68` |
| NotaryAttestationVerifier | `0x58874114f6c28c1c782161ed0385680f4d26c558` |

---

## Environment checklist

```
# server/.env (never commit)
PRIVATE_KEY=<deployer / signer EOA private key>
ALCHEMY_API_KEY=<or set RPC_URL directly>
PIMLICO_API_KEY=<for ERC-4337 sponsored gas; omit to use EOA fallback>
DATABASE_URL=<Neon / Postgres connection string; omit to disable audit log>
TLSN_NOTARY_URL=http://127.0.0.1:7047
TLSN_PROVER_URL=http://127.0.0.1:8090
```

Rotate any key that was ever logged, printed, or exposed in chat.  
`server/.env` is in `.gitignore` — confirm before every push with `git status`.

---

## On-chain event stream

`GET /api/events` — Server-Sent Events (SSE) endpoint.  
Emits `DelegationRegistered`, `DelegationRevoked`, `TrustUpdated`, `ActionValidated` from on-chain logs.

```js
const es = new EventSource('http://localhost:3000/api/events');
es.onmessage = (e) => console.log(JSON.parse(e.data));
```

Uses a WebSocket provider when `WS_RPC_URL` or `ALCHEMY_API_KEY` is set;  
falls back to HTTP polling every 6 s otherwise.

The **Live Demo** (`/live-demo`) shows an embedded event log fed from this endpoint.

---

## ERC-4337 execution

`POST /api/execute/submit` tries the ERC-4337 (Pimlico) path first when `PIMLICO_API_KEY` is set:

1. Looks up the token's scope metadata from the in-process Biscuit store.
2. Builds and sends a `validateActionWithScope` UserOperation via Pimlico bundler + paymaster.
3. Falls back to direct EOA `execute()` if `PIMLICO_API_KEY` is absent, the key is missing, or the AA path errors.

Response includes `"path": "aa-4337"` or `"path": "eoa"` so the frontend can surface which was used.

---

## Contracts

```
contracts/
  src/
    DCTRegistry.sol           — delegation lineage + trust scoring (UUPS)
    DCTEnforcer.sol           — validateActionWithScope (UUPS)
    NotaryAttestationVerifier.sol — TLSNotary ECDSA oracle
    mocks/TestAgentRegistry.sol
  test/
    DCTRegistry.t.sol         — 18 unit tests incl. gas snapshots + security
  script/
    DeployDCT.s.sol
    UpgradeDCTEnforcer.s.sol
```

Run tests:

```bash
cd contracts && forge test -v
```

Gas snapshots (from `test_Gas_*`) are printed inline.  
Security tests cover: scope mismatch, over-spend, expiry, wrong tool, scope commitment mismatch, double-registration, revoked-parent block, ancestor revoke, deprecated `validateAction`.

---

## SDK

```bash
npm install @shaurya2k06/dctsdk
```

```js
import { mintRootToken, attenuateToken, authorizeToken, delegate, execute, revoke } from '@shaurya2k06/dctsdk';
```

See [`docs/LOCAL_DEV.md`](docs/LOCAL_DEV.md) for a full local Anvil walkthrough.

---

## Live Demo

Navigate to **`/live-demo`** in the client app for a 12-phase interactive demo:

| Phase | What happens |
|---|---|
| 0 | Health checks (chain, registry, enforcer, ERC-8004, Pimlico, TLSNotary) |
| 1 | Three agents registered on ERC-8004 |
| 2 | Root Biscuit token minted (off-chain, timed) |
| 3 | Orchestrator → Research delegation (on-chain) |
| 4 | Research → Payment delegation (on-chain) |
| 5 | Successful execution — 4-check trace (revocation, identity, scope, attestation) |
| 6 | Off-chain Datalog rejection — zero gas |
| 7 | On-chain revert for out-of-scope action |
| 8 | Single-tx cascade revocation |
| 9 | Lineage walk animation |
| 10 | Trust score timeline |
| 11 | Summary + stats |

The right-hand column shows a live SSE event log from Base Sepolia.

---

## Security notes

- `server/.env` is `.gitignore`-listed; double-check with `git status` before any push.
- `PRIVATE_KEY` / `PIMLICO_API_KEY` should be rotated if ever logged or printed to terminal.
- `DCTEnforcer.validateAction` is permanently deprecated (always reverts); use `validateActionWithScope`.
- All `ownerOf` calls in DCTRegistry use `view` (EVM STATICCALL), making reentrancy through the identity registry impossible by construction. `nonReentrant` guards are defense-in-depth.
- Contract upgrades go through UUPS `upgradeToAndCall`; only the `owner` can upgrade.
