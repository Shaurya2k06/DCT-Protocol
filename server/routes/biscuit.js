/**
 * Biscuit Token Routes — Real Eclipse Biscuit WASM implementation.
 *
 * No mocks. Real Ed25519 signed tokens with Datalog authorization.
 * Requires: node --experimental-wasm-modules
 */

import express from "express";
import {
  mintRootToken,
  attenuateToken,
  authorizeToken,
  inspectToken,
  getRootPublicKey,
} from "../lib/dct-sdk.js";
import { audit } from "../lib/audit.js";

const router = express.Router();

/**
 * POST /api/biscuit/mint
 * Create a root Biscuit authority token (Ed25519 signed).
 *
 * Body: { agentId, allowedTools, spendLimitUsdc, maxDepth, expiresAt }
 */
router.post("/mint", (req, res) => {
  try {
    const { agentId, allowedTools, spendLimitUsdc, maxDepth, expiresAt } = req.body;

    const result = mintRootToken({
      agentId: agentId || "0",
      allowedTools: allowedTools || ["research", "web_fetch", "x402_pay"],
      spendLimitUsdc: spendLimitUsdc || 50_000_000,
      maxDepth: maxDepth || 3,
      expiresAt,
    });

    await audit("biscuit.mint", { agentId: agentId || "0", revocationId: result.revocationId }, req);

    res.json({
      success: true,
      token: result.serialized,
      revocationId: result.revocationId,
      rootPublicKey: result.rootPublicKey,
      scopeHash: result.scopeHash,
      blocks: result.blocks,
    });
  } catch (error) {
    console.error("Error minting Biscuit:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/biscuit/attenuate
 * Append an attenuation block — offline, zero network calls.
 *
 * Body: { parentTokenB64, childAgentId, allowedTools, spendLimitUsdc, expiresAt }
 */
router.post("/attenuate", (req, res) => {
  try {
    const { parentTokenB64, childAgentId, allowedTools, spendLimitUsdc, expiresAt, maxDepth } =
      req.body;

    const result = attenuateToken({
      parentTokenB64,
      childAgentId: childAgentId || "0",
      allowedTools,
      spendLimitUsdc,
      expiresAt,
      maxDepth,
    });

    await audit("biscuit.attenuate", { childAgentId: childAgentId || "0", revocationId: result.revocationId }, req);

    res.json({
      success: true,
      token: result.serialized,
      revocationId: result.revocationId,
      blocks: result.blocks,
    });
  } catch (error) {
    console.error("Error attenuating Biscuit:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/biscuit/authorize
 * Authorize a Biscuit token against a requested action (off-chain Datalog check).
 *
 * Body: { token, toolName, spendAmount, agentTokenId }
 */
router.post("/authorize", (req, res) => {
  try {
    const { token, toolName, spendAmount, agentTokenId } = req.body;
    const result = authorizeToken(token, toolName, spendAmount || 0, agentTokenId);
    await audit("biscuit.authorize", { toolName, agentTokenId, authorized: result?.authorized }, req);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/biscuit/inspect
 * Decode and inspect a Biscuit token's blocks, facts, and revocation IDs.
 *
 * Body: { token }
 */
router.post("/inspect", (req, res) => {
  try {
    const { token } = req.body;
    const result = inspectToken(token);
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/biscuit/rootkey
 * Get the root public key (for client-side verification).
 */
router.get("/rootkey", (req, res) => {
  try {
    const pubKey = getRootPublicKey();
    res.json({ rootPublicKey: pubKey.toString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
