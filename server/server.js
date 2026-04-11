/**
 * DCT Protocol Server
 * Express + Eclipse Biscuit WASM + Ethers.js
 *
 * Requires: node --experimental-wasm-modules server.js
 */

import "./load-env.mjs";
import express from "express";
import cors from "cors";
import { initRootKey } from "./lib/dct-sdk.js";
import { wireDCTSdk, loadAddresses } from "./lib/blockchain.js";
import { initDb, getPool } from "./lib/db.js";
import { subscribeChainEvents, chainEvents } from "./lib/chain-events.mjs";
import { rpcConfigLabel } from "./lib/rpc-url.mjs";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
import delegationRoutes from "./routes/delegation.js";
import agentRoutes from "./routes/agents.js";
import biscuitRoutes from "./routes/biscuit.js";
import configRoutes from "./routes/config.js";
import aaRoutes from "./routes/aa.js";
import integrationsDelegationRoutes from "./routes/integrations-delegation.js";
import tlsnRoutes from "./routes/tlsn.js";
import demoApiRoutes from "./routes/demo-api.js";
import layerWorkflowRoutes from "./routes/layer-workflow.js";

app.use("/api/config", configRoutes);
app.use("/api/integrations", integrationsDelegationRoutes);
app.use("/api/tlsn", tlsnRoutes);
app.use("/api/aa", aaRoutes);
app.use("/api/delegation", delegationRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/biscuit", biscuitRoutes);
// Operator console — workflow snapshot (no secrets)
app.use("/api/layer", layerWorkflowRoutes);
// Demo-facing API surface (health checks + endpoint aliases)
app.use("/api", demoApiRoutes);

// ── SSE: real-time on-chain event stream ─────────────────────────────────────
// GET /api/events — Server-Sent Events; subscribes to DCTRegistry + DCTEnforcer.
// Clients: const es = new EventSource('/api/events');
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send a heartbeat every 25 s to keep proxies alive
  const hb = setInterval(() => res.write(": heartbeat\n\n"), 25_000);

  const handler = (ev) => {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
  chainEvents.on("event", handler);

  req.on("close", () => {
    clearInterval(hb);
    chainEvents.off("event", handler);
  });
});

// Health check
app.get("/", (req, res) => {
  const addrs = loadAddresses();
  const rpcMode = rpcConfigLabel();
  const pool = getPool();
  res.json({
    name: "DCT Protocol Server",
    version: "1.0.0",
    status: "running",
    biscuit: "Eclipse Biscuit WASM v0.6.0 — real Ed25519 tokens",
    chainId: addrs.chainId,
    network: addrs.network,
    rpcMode,
    database: pool ? "connected" : process.env.DATABASE_URL ? "error" : "disabled",
    trustProfileDb:
      pool != null
        ? "writes enabled (GET /api/trust syncs agent_trust_profiles)"
        : process.env.DATABASE_URL
          ? "init failed — see startup logs; trust rows not saved"
          : "disabled — set DATABASE_URL in server/.env (loaded from server dir, not cwd)",
    endpoints: [
      "GET  /api/layer/snapshot              ← Operator workflow (no secrets)",
      "POST /api/layer/snapshot",
      "GET  /api/layer/openclaw-health       ← Proxy OpenClaw /health (CORS)",
      "POST /api/layer/openclaw-chat         ← Proxy OpenClaw chat completions (CORS)",
      "GET  /api/config",
      "GET  /api/integrations/delegation-framework  ← ERC-7710 / EntryPoint / caveat addresses",
      "GET  /api/tlsn/config                        ← TLSNotary backend status + oracle address",
      "POST /api/tlsn/prove                         ← Real TLSNotary proof + ECDSA attestations",
      "POST /api/tlsn/commit                        ← Commit proof hash on-chain (audit trail)",
      "POST /api/aa/execute-scope                   ← ERC-4337 + Pimlico (sponsored gas)",
      "GET  /api/agents",
      "GET  /api/agents/:tokenId/trust   ← on-chain score + DCT composite (trustScores.py)",
      "GET  /api/trust/:agentId          ← demo alias + dctTrustProfile",
      "POST /api/agents/register",
      "GET  /api/delegation/tree",
      "POST /api/delegation/register",
      "POST /api/delegation/delegate     ← full flow: Biscuit + on-chain",
      "POST /api/delegation/execute      ← Datalog auth + DCTEnforcer",
      "POST /api/delegation/revoke       ← O(1) cascade revocation",
      "GET  /api/delegation/status/:id",
      "POST /api/delegation/validate",
      "POST /api/biscuit/mint            ← root authority token",
      "POST /api/biscuit/attenuate       ← offline attenuation",
      "POST /api/biscuit/authorize       ← Datalog check",
      "POST /api/biscuit/inspect         ← decode token blocks",
      "GET  /api/biscuit/rootkey",
      "GET  /api/events                  ← SSE on-chain event stream (DelegationRegistered, Revoked, TrustUpdated, ActionValidated)",
    ],
  });
});

async function start() {
  try {
    await initDb();
    if (getPool()) {
      console.log("  Database: PostgreSQL (Neon) ready");
    } else if (process.env.DATABASE_URL?.trim()) {
      console.warn(
        "  Database: DATABASE_URL is set but pool is null — check initDb / schema errors above"
      );
    } else {
      console.warn(
        "  Database: DATABASE_URL unset — agent_trust_profiles will not persist (use server/.env)"
      );
    }
  } catch (e) {
    console.warn("  Database: init failed —", e.message);
  }

  wireDCTSdk();
  initRootKey();
  subscribeChainEvents().catch((e) =>
    console.warn("  Events:   chain-events startup error —", e.message)
  );

  if (!process.env.PRIVATE_KEY?.trim()) {
    console.warn(
      "  Wallet:   PRIVATE_KEY unset — read-only chain + Biscuit OK; delegate/execute/revoke need a key in .env"
    );
  }

  app.listen(PORT, () => {
    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  DCT Protocol Server — Port ${PORT}`);
    console.log(`═══════════════════════════════════════════`);
    console.log(`  Biscuit:  Eclipse Biscuit WASM v0.6.0`);
    const rpcLabel = rpcConfigLabel();
    console.log(`  Chain:    ${rpcLabel}`);
    console.log(`  SDK:      delegate() · execute() · revoke()`);
    console.log(`  API:      http://localhost:${PORT}`);
    console.log(`═══════════════════════════════════════════\n`);
  });
}

start();
