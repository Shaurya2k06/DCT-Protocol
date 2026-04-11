/**
 * DCT Protocol Server
 * Express + Eclipse Biscuit WASM + Ethers.js
 *
 * Requires: node --experimental-wasm-modules server.js
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { initRootKey } from "./lib/dct-sdk.js";
import { wireDCTSdk, loadAddresses } from "./lib/blockchain.js";
import { initDb, getPool } from "./lib/db.js";

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

app.use("/api/config", configRoutes);
app.use("/api/integrations", integrationsDelegationRoutes);
app.use("/api/tlsn", tlsnRoutes);
app.use("/api/aa", aaRoutes);
app.use("/api/delegation", delegationRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/biscuit", biscuitRoutes);

// Health check
app.get("/", (req, res) => {
  const addrs = loadAddresses();
  const rpcMode = process.env.RPC_URL?.trim()
    ? "RPC_URL"
    : process.env.ALCHEMY_API_KEY
      ? "alchemy-base-sepolia"
      : "unset";
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
    endpoints: [
      "GET  /api/config",
      "GET  /api/integrations/delegation-framework  ← ERC-7710 / EntryPoint / caveat addresses",
      "GET  /api/tlsn/config                        ← TLSNotary backend status + oracle address",
      "POST /api/tlsn/prove                         ← Real TLSNotary proof + ECDSA attestations",
      "POST /api/tlsn/commit                        ← Commit proof hash on-chain (audit trail)",
      "POST /api/aa/execute-scope                   ← ERC-4337 + Pimlico (sponsored gas)",
      "GET  /api/agents",
      "GET  /api/agents/:tokenId/trust",
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
    ],
  });
});

async function start() {
  try {
    await initDb();
    if (getPool()) {
      console.log("  Database: PostgreSQL (Neon) ready");
    }
  } catch (e) {
    console.warn("  Database: init failed —", e.message);
  }

  wireDCTSdk();
  initRootKey();

  app.listen(PORT, () => {
    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  DCT Protocol Server — Port ${PORT}`);
    console.log(`═══════════════════════════════════════════`);
    console.log(`  Biscuit:  Eclipse Biscuit WASM v0.6.0`);
    const rpcLabel = process.env.RPC_URL?.trim()
      ? "custom RPC_URL"
      : "Base Sepolia (Alchemy)";
    console.log(`  Chain:    ${rpcLabel}`);
    console.log(`  SDK:      delegate() · execute() · revoke()`);
    console.log(`  API:      http://localhost:${PORT}`);
    console.log(`═══════════════════════════════════════════\n`);
  });
}

start();
