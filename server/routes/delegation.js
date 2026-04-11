/**
 * Delegation Routes — On-chain lineage tree operations.
 * Uses the real DCT SDK for full delegate/execute/revoke flow.
 */

import express from "express";
import {
  delegate,
  execute,
  revoke,
  getTokenByRevocationId,
  signNotaryAttestation,
  proveAndAttest,
} from "../lib/dct-sdk.js";
import {
  getRegistry, getEnforcer, getSigner, ethers,
} from "../lib/blockchain.js";
import { audit } from "../lib/audit.js";

const router = express.Router();

/**
 * GET /api/delegation/tree
 * Returns the full delegation tree for visualization.
 */
router.get("/tree", async (req, res) => {
  try {
    const registry = getRegistry();
    const total = await registry.totalDelegations();
    const nodes = [];
    const edges = [];

    for (let i = 0; i < Number(total); i++) {
      const delegationId = await registry.getDelegationId(i);
      const parentId = await registry.parentOf(delegationId);
      const holderAgentId = await registry.holderAgent(delegationId);
      const isRev = await registry.isRevoked(delegationId);
      const directlyRev = await registry.directlyRevoked(delegationId);
      const trustScoreRaw = await registry.trustScore(holderAgentId);

      nodes.push({
        id: delegationId,
        agentId: holderAgentId.toString(),
        parentId,
        isRevoked: isRev,
        isDirectlyRevoked: directlyRev,
        trustScore: ethers.formatEther(trustScoreRaw),
      });

      if (parentId !== ethers.ZeroHash) {
        edges.push({
          source: parentId,
          target: delegationId,
        });
      }
    }

    res.json({ nodes, edges, total: Number(total) });
  } catch (error) {
    console.error("Error fetching delegation tree:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/delegation/register
 * Register a root delegation on-chain (without Biscuit attenuation).
 * For registering the first node in the tree.
 */
router.post("/register", async (req, res) => {
  try {
    const { parentId, childId, allowedTools, spendLimitUsdc, maxDepth, expiresAt, parentAgentTokenId } = req.body;

    const registry = getRegistry();
    const scope = {
      allowedTools: (allowedTools || []).map((t) =>
        ethers.keccak256(ethers.toUtf8Bytes(t))
      ),
      spendLimitUsdc: BigInt(spendLimitUsdc || 50_000_000),
      maxDepth: maxDepth || 3,
      expiresAt: BigInt(expiresAt || Math.floor(Date.now() / 1000) + 3600),
    };

    const tx = await registry.registerDelegation(
      parentId || ethers.ZeroHash,
      childId,
      scope,
      BigInt(parentAgentTokenId)
    );
    const receipt = await tx.wait();

    await audit(
      "delegation.register",
      { txHash: receipt.hash, childId, blockNumber: receipt.blockNumber },
      req
    );

    res.json({
      success: true,
      txHash: receipt.hash,
      childId,
      blockNumber: receipt.blockNumber,
    });
  } catch (error) {
    console.error("Error registering delegation:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/delegation/delegate
 * Full delegation flow — Biscuit attenuation + on-chain registration.
 * This is the primary SDK call.
 */
router.post("/delegate", async (req, res) => {
  try {
    const {
      parentTokenB64,
      parentAgentTokenId,
      childAgentTokenId,
      childTools,
      childSpendLimit,
    } = req.body;

    const result = await delegate({
      parentTokenB64,
      parentAgentTokenId,
      childAgentTokenId,
      childTools,
      childSpendLimit,
    });

    await audit(
      "delegation.delegate",
      {
        childAgentTokenId,
        txHash: result.txHash,
        blockNumber: result.blockNumber,
        childRevocationId: result.childRevocationId,
      },
      req
    );

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error delegating:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/delegation/execute
 * Execute an action through DCTEnforcer — off-chain Datalog + on-chain validation.
 */
router.post("/execute", async (req, res) => {
  try {
    const { tokenB64, agentTokenId, toolName, spendAmount, tlsAttestation, url } = req.body;
    const toolHash = ethers.keccak256(ethers.toUtf8Bytes(toolName));
    let tls = tlsAttestation;
    let tlsnProof = null;

    if (!tls || tls === "0x") {
      if (url && (process.env.TLSN_PROVER_URL || process.env.TLSN_NOTARY_URL)) {
        // Real TLSNotary proof — prove the HTTP call, then attest
        try {
          const proved = await proveAndAttest({ url, toolName });
          tls = proved.inlineAttestation;
          tlsnProof = { proofHash: proved.proofHash, commitAttestation: proved.commitAttestation };
        } catch (tlsnErr) {
          console.warn("[tlsn] proof failed, falling back to oracle-only attestation:", tlsnErr.message);
          tls = await signNotaryAttestation(toolHash);
        }
      } else {
        // Oracle-only attestation (no TLSNotary backend configured)
        tls = await signNotaryAttestation(toolHash);
      }
    }
    const result = await execute({
      tokenB64,
      agentTokenId,
      toolName,
      spendAmount,
      tlsAttestation: tls || "0x",
    });
    await audit(
      "delegation.execute",
      {
        agentTokenId,
        toolName,
        url: url || null,
        tlsnProofHash: tlsnProof?.proofHash || null,
        success: result.success,
        stage: result.stage,
        txHash: result.txHash,
        blockNumber: result.blockNumber,
      },
      req
    );
    res.json({ ...result, tlsnProof });
  } catch (error) {
    console.error("Error executing:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/delegation/revoke
 * Revoke a delegation — O(1) on-chain write.
 * Children die lazily via isRevoked() walk.
 */
router.post("/revoke", async (req, res) => {
  try {
    const { tokenId, agentTokenId } = req.body;
    const result = await revoke(tokenId, agentTokenId);
    await audit(
      "delegation.revoke",
      { tokenId, agentTokenId, txHash: result.txHash, success: result.success },
      req
    );
    res.json(result);
  } catch (error) {
    console.error("Error revoking:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/delegation/status/:revocationId
 * Check full revocation status of a delegation.
 */
router.get("/status/:revocationId", async (req, res) => {
  try {
    const registry = getRegistry();
    const { revocationId } = req.params;
    const isRev = await registry.isRevoked(revocationId);
    const directlyRev = await registry.directlyRevoked(revocationId);
    const parentId = await registry.parentOf(revocationId);
    const holderAgentId = await registry.holderAgent(revocationId);
    const trustScoreRaw = await registry.trustScore(holderAgentId);

    // Also get local token metadata if available
    const localMeta = getTokenByRevocationId(revocationId);

    res.json({
      revocationId,
      isRevoked: isRev,
      isDirectlyRevoked: directlyRev,
      parentId,
      holderAgentId: holderAgentId.toString(),
      trustScore: ethers.formatEther(trustScoreRaw),
      biscuitToken: localMeta ? {
        hasToken: true,
        blocks: localMeta.token ? undefined : null,
        allowedTools: localMeta.allowedTools,
        spendLimitUsdc: localMeta.spendLimitUsdc,
        depth: localMeta.depth,
      } : { hasToken: false },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/delegation/validate
 * Validate an action through DCTEnforcer (legacy endpoint, uses execute internally).
 */
router.post("/validate", async (req, res) => {
  try {
    const { revocationId, agentTokenId, toolName, spendAmount, tlsAttestation } = req.body;

    const toolHash = ethers.keccak256(ethers.toUtf8Bytes(toolName));
    let tls = tlsAttestation;
    const notaryPk = process.env.NOTARY_PRIVATE_KEY;
    if ((!tls || tls === "0x") && notaryPk) {
      tls = signNotaryAttestation(toolHash, notaryPk);
    }

    const meta = getTokenByRevocationId(revocationId);
    if (meta && meta.serialized) {
      const result = await execute({
        tokenB64: meta.serialized,
        agentTokenId,
        toolName,
        spendAmount,
        tlsAttestation: tls || "0x",
      });
      await audit(
        "delegation.validate",
        {
          revocationId,
          agentTokenId,
          toolName,
          success: result.success,
          stage: result.stage,
          txHash: result.txHash,
        },
        req
      );
      return res.json(result);
    }

    const enforcer = getEnforcer();
    const signerAddr = await getSigner().getAddress();

    const tx = await enforcer.validateAction(
      revocationId,
      BigInt(agentTokenId),
      toolHash,
      BigInt(spendAmount || 0),
      tls || "0x",
      signerAddr
    );
    const receipt = await tx.wait();

    const validatedEvent = receipt.logs.find((log) => {
      try {
        return enforcer.interface.parseLog(log)?.name === "ActionValidated";
      } catch {
        return false;
      }
    });

    const out = {
      success: !!validatedEvent,
      stage: "on-chain",
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    };
    await audit("delegation.validate", { revocationId, agentTokenId, toolName, ...out }, req);
    res.json(out);
  } catch (error) {
    console.error("Error validating action:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
