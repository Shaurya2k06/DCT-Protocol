/**
 * Agent routes — ERC-8004 Identity Registry (official Base Sepolia or local test registry).
 */

import express from "express";
import { getERC8004, getRegistry, getSigner, ethers, loadAddresses } from "../lib/blockchain.js";
import { audit } from "../lib/audit.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const erc8004 = getERC8004();
    const registry = getRegistry();
    const addresses = loadAddresses();
    const variant = addresses.identityRegistryVariant || "official";

    const agents = [];

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
      const fromBlock = Number(process.env.ERC8004_EVENTS_FROM_BLOCK || 0);
      const filter = erc8004.filters.Registered();
      const events = await erc8004.queryFilter(filter, fromBlock, "latest");
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

    res.json({ agents, total: agents.length, identityRegistryVariant: variant });
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

    res.json({
      tokenId,
      trustScore: ethers.formatEther(trustScoreRaw),
      trustScoreRaw: trustScoreRaw.toString(),
      maxGrantableSpend: maxGrantable.toString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
