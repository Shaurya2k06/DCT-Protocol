/**
 * TLSNotary Routes
 *
 * POST /api/tlsn/prove
 *   Prove an HTTP call using TLSNotary, verify the proof, and return both:
 *     • inlineAttestation  — 65-byte hex for DCTEnforcer.validateActionWithScope
 *     • commitAttestation  — 65-byte hex for NotaryAttestationVerifier.verifyAndCommit
 *
 * POST /api/tlsn/commit
 *   Submit a pre-existing TLSNotary proof on-chain (verifyAndCommit on the contract).
 *
 * GET /api/tlsn/config
 *   Returns TLSNotary config (notary URL, backend, oracle address).
 */

import express from "express";
import { ethers } from "ethers";
import { proveAndAttest, getOracleAddress } from "../lib/tlsn/index.mjs";
import { loadAddresses } from "../lib/blockchain.js";
import { audit } from "../lib/audit.js";
import { resolveHttpRpcUrl, missingRpcHelp } from "../lib/rpc-url.mjs";
import { createRetryingJsonRpcProvider } from "../lib/rpc-provider.mjs";

const router = express.Router();

/**
 * GET /api/tlsn/config
 */
router.get("/config", (req, res) => {
  const addrs = loadAddresses();
  const backendConfigured = !!process.env.TLSN_PROVER_URL?.trim();
  res.json({
    enabled: backendConfigured,
    proverUrl: process.env.TLSN_PROVER_URL || null,
    notaryUrl: process.env.TLSN_NOTARY_URL || "https://notary.pse.dev",
    oracle: getOracleAddress(),
    verifierAddress: addrs.NotaryAttestationVerifier || null,
    note: backendConfigured
      ? "TLSN_PROVER_URL set — POST /prove prover API is used for MPC proofs"
      : "No TLSN_PROVER_URL. docker-compose.tlsn.yml starts the notary only; run a separate prover (see tlsnotary/tlsn examples) or use oracle-only ECDSA attestation.",
  });
});

/**
 * POST /api/tlsn/prove
 *
 * Body: { url, toolName?, method?, headers?, body? }
 *
 * Response: {
 *   inlineAttestation,    // for DCTEnforcer
 *   commitAttestation,    // for NotaryAttestationVerifier.verifyAndCommit
 *   proofHash,
 *   endpointHash,
 *   proof: { url, method, statusCode, responsePreview, sessionHash, backend },
 *   oracle,
 * }
 */
router.post("/prove", async (req, res) => {
  try {
    const { url, toolName, method, headers, body } = req.body;

    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    // Validate URL
    try { new URL(url); } catch {
      return res.status(400).json({ error: "invalid url" });
    }

    const result = await proveAndAttest({ url, toolName, method, headers, body });

    await audit(
      "tlsn.prove",
      {
        url,
        toolName,
        proofHash: result.proofHash,
        backend: result.proof?.backend,
        oracle: result.oracle,
      },
      req
    );

    // Don't return full proof JSON in response by default (can be large)
    res.json({
      inlineAttestation: result.inlineAttestation,
      commitAttestation: result.commitAttestation,
      proofHash: result.proofHash,
      endpointHash: result.endpointHash,
      oracle: result.oracle,
      proof: {
        url: result.proof.url,
        method: result.proof.method,
        statusCode: result.proof.statusCode,
        responsePreview: result.proof.responsePreview,
        sessionHash: result.proof.sessionHash,
        backend: result.proof.backend,
        notaryUrl: result.proof.notaryUrl,
      },
    });
  } catch (error) {
    console.error("tlsn prove:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/tlsn/commit
 *
 * Submit a proof commitment on-chain via NotaryAttestationVerifier.verifyAndCommit.
 *
 * Body: { proofHash, endpointHash, commitAttestation }
 *
 * This writes to the blockchain — costs gas (paid by PRIVATE_KEY wallet).
 */
router.post("/commit", async (req, res) => {
  try {
    const { proofHash, endpointHash, commitAttestation } = req.body;

    if (!proofHash || !endpointHash || !commitAttestation) {
      return res.status(400).json({
        error: "proofHash, endpointHash, and commitAttestation are required",
      });
    }

    const addrs = loadAddresses();
    const verifierAddr = addrs.NotaryAttestationVerifier;
    if (!verifierAddr) {
      return res.status(500).json({ error: "NotaryAttestationVerifier address not in addresses.json" });
    }

    const pk = process.env.PRIVATE_KEY?.trim();
    if (!pk) return res.status(500).json({ error: "PRIVATE_KEY not set" });
    const rpc = resolveHttpRpcUrl();
    if (!rpc) return res.status(500).json({ error: missingRpcHelp() });

    const provider = createRetryingJsonRpcProvider(rpc);
    const signer = new ethers.Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);

    const verifierAbi = [
      "function verifyAndCommit(bytes32 proofHash, bytes32 endpointHash, bytes calldata attestation) external returns (bool)",
      "event TlsnProofCommitted(bytes32 indexed proofHash, bytes32 indexed endpointHash, address indexed signer, uint256 blockNumber)",
    ];
    const verifier = new ethers.Contract(verifierAddr, verifierAbi, signer);

    const tx = await verifier.verifyAndCommit(proofHash, endpointHash, commitAttestation);
    const receipt = await tx.wait();

    await audit(
      "tlsn.commit",
      { proofHash, endpointHash, txHash: receipt.hash, blockNumber: receipt.blockNumber },
      req
    );

    res.json({
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      proofHash,
      endpointHash,
      explorerUrl: `https://sepolia.basescan.org/tx/${receipt.hash}`,
    });
  } catch (error) {
    console.error("tlsn commit:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
