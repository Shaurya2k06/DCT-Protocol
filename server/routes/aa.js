/**
 * ERC-4337 + Pimlico — sponsored gas for DCTEnforcer.validateActionWithScope.
 */

import express from "express";
import { ethers } from "ethers";
import { authorizeToken, inspectToken, signNotaryAttestation, proveAndAttest } from "../lib/dct-sdk.js";
import { sendValidateActionWithScopeUserOp } from "../lib/aa/pimlico-execute.mjs";
import { audit } from "../lib/audit.js";

const router = express.Router();

/**
 * POST /api/aa/execute-scope
 * Biscuit authorize (off-chain) + UserOp to DCTEnforcer (Pimlico may sponsor gas).
 * Owner key signs the UserOp. ERC-8004 NFT must be owned by **smartAccountAddress**.
 */
router.post("/execute-scope", async (req, res) => {
  try {
    const { tokenB64, agentTokenId, toolName, spendAmount, tlsAttestation, ownerPrivateKey } =
      req.body;

    const authResult = authorizeToken(
      tokenB64,
      toolName,
      spendAmount || 0,
      String(agentTokenId)
    );
    if (!authResult.authorized) {
      return res.status(400).json({
        success: false,
        stage: "off-chain",
        error: authResult.error,
      });
    }

    const { meta } = inspectToken(tokenB64);
    if (!meta?.revocationId) {
      return res.status(400).json({
        error:
          "Token metadata missing — mint/attenuate on this server so the Biscuit token is in the local store",
      });
    }

    const toolHash = ethers.keccak256(ethers.toUtf8Bytes(toolName));
    let tls = tlsAttestation;
    let tlsnProofHash = null;

    if (!tls || tls === "0x") {
      const url = req.body.url;
      if (url && (process.env.TLSN_PROVER_URL || process.env.TLSN_NOTARY_URL)) {
        try {
          const proved = await proveAndAttest({ url, toolName });
          tls = proved.inlineAttestation;
          tlsnProofHash = proved.proofHash;
        } catch (e) {
          console.warn("[aa][tlsn] proof failed, falling back:", e.message);
          tls = await signNotaryAttestation(toolHash);
        }
      } else {
        tls = await signNotaryAttestation(toolHash);
      }
    }
    const tlsHex = tls?.startsWith?.("0x") ? tls : `0x${tls || ""}`;

    const pk = ownerPrivateKey || process.env.AA_OWNER_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!pk) {
      return res.status(400).json({
        error:
          "Set ownerPrivateKey in body or AA_OWNER_PRIVATE_KEY / PRIVATE_KEY (smart account owner)",
      });
    }

    const result = await sendValidateActionWithScopeUserOp({
      ownerPrivateKey: pk,
      revocationId: meta.revocationId,
      agentTokenId: String(agentTokenId),
      toolName,
      spendAmount: spendAmount ?? 0,
      tlsAttestation: tlsHex || "0x",
      allowedToolNames: meta.allowedTools || [],
      spendLimitUsdc: meta.spendLimitUsdc ?? 50_000_000,
      maxDepth: meta.maxDepth ?? 3,
      expiresAt: meta.expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
    });

    await audit("aa.execute_scope", { ...result, agentTokenId, toolName, tlsnProofHash }, req);

    res.json({
      success: true,
      mode: "erc4337-pimlico",
      userOpHash: result.userOpHash,
      smartAccountAddress: result.smartAccountAddress,
      redeemer: result.redeemer,
      note:
        "Requires ERC-8004 ownerOf(agentId) == smartAccountAddress. Mint/transfer the agent NFT to that address, or use the direct /delegation/execute path with an EOA.",
    });
  } catch (error) {
    console.error("aa execute-scope:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
