/**
 * Agent routes — ERC-8004 Identity Registry (official Base Sepolia or local test registry).
 */

import express from "express";
import { getERC8004, getRegistry, getSigner, ethers, loadAddresses, getProvider } from "../lib/blockchain.js";
import { audit } from "../lib/audit.js";
import {
  getLatestTrustProfile,
  upsertTrustProfile,
  syncTrustProfileToDb,
} from "../lib/db.js";
import { computeDctTrustForAgent, trustProfileToApi } from "../lib/dctEnforcerTrust.mjs";
import { queryFilterChunked } from "../lib/ethQueryFilterChunked.mjs";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const erc8004 = getERC8004();
    const registry = getRegistry();
    const addresses = loadAddresses();
    const variant = addresses.identityRegistryVariant || "official";

    const agents = [];
    /** @type {number | null} */
    let erc8004ScannedFromBlock = null;

    if (variant === "test") {
      const totalAgents = await erc8004.totalAgents();
      for (let i = 0; i < Number(totalAgents); i++) {
        const owner = await erc8004.ownerOf(i);
        const uri = await erc8004.agentURI(i);
        const trustScoreRaw = await registry.trustScore(i);
        agents.push({
          tokenId: String(i),
          owner,
          uri,
          trustScore: ethers.formatEther(trustScoreRaw),
          trustScoreRaw: trustScoreRaw.toString(),
        });
      }
    } else {
      const provider = getProvider();
      const latest = await provider.getBlockNumber();
      const envFrom = process.env.ERC8004_EVENTS_FROM_BLOCK;
      /** Default 2000 blocks ≈ 200 sequential eth_getLogs (10-block windows) — pair with DCT_ETH_GETLOGS_DELAY_MS to avoid 429 */
      const lookback = Math.max(
        500,
        Number(process.env.ERC8004_EVENTS_LOOKBACK_BLOCKS ?? 2000)
      );
      const fromBlock =
        envFrom != null && String(envFrom).trim() !== ""
          ? Math.max(0, Number(envFrom))
          : Math.max(0, latest - lookback);
      erc8004ScannedFromBlock = fromBlock;
      const filter = erc8004.filters.Registered();
      const events = await queryFilterChunked(erc8004, filter, fromBlock, "latest");
      for (const ev of events) {
        const agentId = ev.args.agentId;
        const owner = await erc8004.ownerOf(agentId);
        let uri = ev.args.agentURI;
        try {
          uri = await erc8004.tokenURI(agentId);
        } catch {
          /* use event */
        }
        const trustScoreRaw = await registry.trustScore(agentId);
        agents.push({
          tokenId: agentId.toString(),
          owner,
          uri,
          trustScore: ethers.formatEther(trustScoreRaw),
          trustScoreRaw: trustScoreRaw.toString(),
        });
      }
    }

    res.json({
      agents,
      total: agents.length,
      identityRegistryVariant: variant,
      ...(erc8004ScannedFromBlock != null ? { erc8004ScannedFromBlock } : {}),
    });
  } catch (error) {
    console.error("Error fetching agents:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:tokenId/trust", async (req, res) => {
  try {
    const registry = getRegistry();
    const { tokenId } = req.params;
    const trustScoreRaw = await registry.trustScore(BigInt(tokenId));
    const maxGrantable = await registry.maxGrantableSpend(BigInt(tokenId), 50_000_000n);
    const offChainTrustProfile = await getLatestTrustProfile(tokenId);

    let dctTrustProfile = null;
    let trustProfileDbSync = null;
    try {
      const { profile } = await computeDctTrustForAgent(tokenId);
      dctTrustProfile = trustProfileToApi(profile);
      trustProfileDbSync = await syncTrustProfileToDb(tokenId, dctTrustProfile);
    } catch (e) {
      console.warn(`[agents/:tokenId/trust] DCT compute failed for ${tokenId}:`, e.message);
    }

    res.json({
      tokenId,
      trustScore: ethers.formatEther(trustScoreRaw),
      trustScoreRaw: trustScoreRaw.toString(),
      maxGrantableSpend: maxGrantable.toString(),
      offChainTrustProfile,
      dctTrustProfile,
      dctCompositePercent:
        dctTrustProfile != null ? dctTrustProfile.composite_score * 100 : null,
      trustProfileDbSync,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/:tokenId/trust-profile", async (req, res) => {
  try {
    const expectedKey = process.env.TRUST_PROFILE_API_KEY?.trim();
    if (expectedKey) {
      const providedKey = req.get("x-trust-profile-key")?.trim();
      if (!providedKey || providedKey !== expectedKey) {
        return res.status(401).json({ error: "unauthorized" });
      }
    }

    const { tokenId } = req.params;
    const body = req.body?.profile || req.body;
    const required = [
      "composite_score",
      "tier",
      "execution_count",
      "max_children",
      "max_depth",
      "max_spend_fraction",
    ];
    const missing = required.filter((k) => body?.[k] == null);
    if (missing.length > 0) {
      return res.status(400).json({ error: `missing fields: ${missing.join(", ")}` });
    }

    const stored = await upsertTrustProfile(tokenId, body);
    if (!stored) {
      return res.status(503).json({ error: "database disabled or unavailable" });
    }

    await audit(
      "trust.profile.upsert",
      {
        agentId: String(tokenId),
        source: req.body?.source || "python",
        compositeScore: body.composite_score,
        tier: body.tier,
      },
      req
    );

    return res.json({ success: true, profile: stored });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/register", async (req, res) => {
  try {
    const erc8004 = getERC8004();
    const addresses = loadAddresses();
    const variant = addresses.identityRegistryVariant || "official";
    const { ownerAddress, uri, agentURI } = req.body;
    const metaUri = uri || agentURI || "ipfs://new-agent";

    let tx;
    if (variant === "test") {
      const signer = getSigner();
      const to = ownerAddress || (await signer.getAddress());
      tx = await erc8004.register(to, metaUri);
    } else {
      tx = await erc8004.register(metaUri);
    }

    const receipt = await tx.wait();
    const iface = erc8004.interface;
    const parsed = receipt.logs
      .map((log) => {
        try {
          return iface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((p) => p && (p.name === "Registered" || p.name === "AgentRegistered"));

    if (!parsed) {
      return res.status(500).json({ error: "Could not parse registration event" });
    }

    const agentId = parsed.args.agentId.toString();
    await audit(
      "agent.register",
      { agentId, txHash: receipt.hash, blockNumber: receipt.blockNumber, variant },
      req
    );

    res.json({
      success: true,
      agentId,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toString(),
      feeWei: receipt.fee?.toString(),
      effectiveGasPrice: receipt.gasPrice?.toString(),
    });
  } catch (error) {
    console.error("Error registering agent:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
