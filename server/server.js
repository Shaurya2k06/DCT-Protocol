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
import { wireDCTSdk } from "./lib/blockchain.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

wireDCTSdk();
initRootKey();

// Routes
import delegationRoutes from "./routes/delegation.js";
import agentRoutes from "./routes/agents.js";
import biscuitRoutes from "./routes/biscuit.js";

app.use("/api/delegation", delegationRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/biscuit", biscuitRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({
    name: "DCT Protocol Server",
    version: "1.0.0",
    status: "running",
    biscuit: "Eclipse Biscuit WASM v0.6.0 — real Ed25519 tokens",
    chain: "Base Sepolia (84532)",
    endpoints: [
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

app.listen(PORT, () => {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  DCT Protocol Server — Port ${PORT}`);
  console.log(`═══════════════════════════════════════════`);
  console.log(`  Biscuit:  Eclipse Biscuit WASM v0.6.0`);
  console.log(`  Chain:    Base Sepolia via Alchemy`);
  console.log(`  SDK:      delegate() · execute() · revoke()`);
  console.log(`  API:      http://localhost:${PORT}`);
  console.log(`═══════════════════════════════════════════\n`);
});