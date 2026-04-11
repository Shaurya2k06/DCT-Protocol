/**
 * Demo-facing API surface — maps the DCT_DEMO_SCRIPT endpoint shapes to
 * existing server internals. All routes are prefixed /api/* and wired in server.js.
 *
 * Health:   GET  /api/health/{chain|registry|enforcer|erc8004|pimlico|tlsn}
 * Tokens:   POST /api/tokens/create-root
 *           POST /api/tokens/attenuate
 * Delegate: POST /api/delegate
 * Execute:  POST /api/execute/verify-local
 *           POST /api/execute/submit
 * Trust:    GET  /api/trust/:agentId
 * Revoke:   POST /api/revoke
 */

import express from "express";
import {
  mintRootToken,
  attenuateToken,
  authorizeToken,
  execute,
  delegate,
  revoke,
  getTokenByRevocationId,
} from "../lib/dct-sdk.js";
import {
  getRegistry,
  getEnforcer,
  getSigner,
  getProvider,
  getERC8004,
  loadAddresses,
  ethers,
} from "../lib/blockchain.js";
import { sendValidateActionWithScopeUserOp } from "../lib/aa/pimlico-execute.mjs";
import {
  computeDctTrustForAgent,
  trustProfileToApi,
} from "../lib/dctEnforcerTrust.mjs";
import { syncTrustProfileToDb } from "../lib/db.js";

const router = express.Router();

function scheduleTrustProfileRefresh(agentId) {
  const aid = String(agentId ?? "0");
  setImmediate(async () => {
    try {
      const { profile } = await computeDctTrustForAgent(aid);
      const p = trustProfileToApi(profile);
      const sync = await syncTrustProfileToDb(aid, p);
      if (!sync.ok) {
        /* no_database — already warned in db.js */
      }
    } catch (err) {
      console.warn("[execute/submit] trust profile refresh:", err.message);
    }
  });
}

/** Ensure JSON never sends revertReason as a bare object (avoids "[object Object]" in UIs). */
function stringifyRevertReason(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (typeof value.reason === "string") return value.reason;
    if (typeof value.shortMessage === "string") return value.shortMessage;
    if (typeof value.message === "string" && !String(value.message).startsWith("[object ")) {
      return value.message;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function summarizeParsedArgs(parsed) {
  if (!parsed?.fragment?.inputs) return "";
  const parts = [];
  const { inputs } = parsed.fragment;
  const { args } = parsed;
  for (let i = 0; i < Math.min(inputs.length, 10); i++) {
    const inp = inputs[i];
    let v = args[i];
    if (v == null) v = "";
    else if (typeof v === "bigint") v = v.toString();
    else if (typeof v === "string" && v.length > 48) v = `${v.slice(0, 14)}…${v.slice(-10)}`;
    else if (typeof v === "object" && v != null) {
      try {
        v = JSON.stringify(v);
        if (v.length > 80) v = `${v.slice(0, 78)}…`;
      } catch {
        v = String(v);
      }
    }
    parts.push(`${inp.name || `arg${i}`}=${v}`);
  }
  return parts.join(" · ");
}

/**
 * GET /api/chain/tx/:hash
 * RPC-backed tx + receipt decode (method + args) for DCT contracts — no Basescan API key.
 */
router.get("/chain/tx/:hash", async (req, res) => {
  try {
    const { hash } = req.params;
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      return res.status(400).json({ error: "invalid tx hash" });
    }
    const provider = getProvider();
    const tx = await provider.getTransaction(hash);
    if (!tx) return res.status(404).json({ error: "transaction not found" });
    const receipt = await provider.getTransactionReceipt(hash);
    if (!receipt) {
      return res.json({
        hash,
        pending: true,
        from: tx.from,
        to: tx.to,
      });
    }

    const gasUsed = receipt.gasUsed.toString();
    const feeWei = receipt.fee.toString();
    const status = receipt.status === 1 ? "success" : "reverted";

    let methodName = "unknown";
    let contractLabel = receipt.to ? "Contract" : "contract creation";
    let argSummary = "";

    const pairs = [
      [getRegistry(), "DCTRegistry"],
      [getEnforcer(), "DCTEnforcer"],
      [getERC8004(), "ERC-8004 Identity"],
    ];
    const toLower = receipt.to?.toLowerCase();
    for (const [c, label] of pairs) {
      let addr;
      try {
        addr = (await c.getAddress()).toLowerCase();
      } catch {
        continue;
      }
      if (toLower && addr === toLower) {
        contractLabel = label;
        try {
          const parsed = c.interface.parseTransaction({
            data: tx.data,
            value: tx.value ?? 0n,
          });
          if (parsed) {
            methodName = parsed.name;
            argSummary = summarizeParsedArgs(parsed);
          }
        } catch {
          methodName = "unknown";
        }
        break;
      }
    }

    const egp = receipt.gasPrice;
    res.json({
      hash: receipt.hash,
      blockNumber: Number(receipt.blockNumber),
      status,
      from: receipt.from,
      to: receipt.to,
      gasUsed,
      feeWei,
      effectiveGasPrice: egp != null ? egp.toString() : null,
      methodName,
      contractLabel,
      argSummary,
    });
  } catch (e) {
    console.error("chain/tx:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Health checks
// ─────────────────────────────────────────────────────────────────────────────

router.get("/health/chain", async (_req, res) => {
  try {
    const signer = getSigner();
    const network = await signer.provider.getNetwork();
    res.json({
      ok: true,
      chainId: Number(network.chainId),
      name: network.name || "base-sepolia",
    });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

router.get("/health/registry", async (_req, res) => {
  try {
    const addrs = loadAddresses();
    const registry = getRegistry();
    const total = await registry.totalDelegations();
    res.json({ ok: true, address: addrs.DCTRegistry, totalDelegations: Number(total) });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

router.get("/health/enforcer", async (_req, res) => {
  try {
    const addrs = loadAddresses();
    const enforcer = getEnforcer();
    const owner = await enforcer.owner();
    res.json({ ok: true, address: addrs.DCTEnforcer, owner });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

router.get("/health/erc8004", async (_req, res) => {
  try {
    const addrs = loadAddresses();
    res.json({ ok: true, address: addrs.ERC8004IdentityRegistry });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

router.get("/health/pimlico", async (_req, res) => {
  const key = process.env.PIMLICO_API_KEY?.trim();
  if (!key) return res.status(503).json({ ok: false, error: "PIMLICO_API_KEY not set" });
  res.json({ ok: true, configured: true });
});

router.get("/health/tlsn", async (_req, res) => {
  const notaryUrl = process.env.TLSN_NOTARY_URL?.trim() || "http://127.0.0.1:7047";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${notaryUrl}/info`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`notary ${r.status}`);
    const info = await r.json();
    res.json({ ok: true, notaryUrl, version: info.version });
  } catch (e) {
    res.status(503).json({ ok: false, notaryUrl, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Token operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/tokens/create-root
 * Body: { agentTokenId, allowedTools, spendLimitUsdc, maxDepth, expiresAt }
 */
router.post("/tokens/create-root", async (req, res) => {
  try {
    const t0 = Date.now();
    const { agentTokenId, allowedTools, spendLimitUsdc, maxDepth, expiresAt } = req.body;

    const result = mintRootToken({
      agentId: String(agentTokenId ?? "0"),
      allowedTools: allowedTools || ["web_fetch", "x402_pay", "research", "summarize"],
      spendLimitUsdc: Number(spendLimitUsdc ?? 50_000_000),
      maxDepth: Number(maxDepth ?? 3),
      expiresAt: expiresAt || undefined,
    });

    res.json({
      tokenBytes: result.serialized,
      revocationId: result.revocationId,
      creationTimeMs: Date.now() - t0,
      rootPublicKey: result.rootPublicKey,
      scopeHash: result.scopeHash,
      authorityBlock: result.blocks?.[0] || null,
    });
  } catch (e) {
    console.error("tokens/create-root:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/tokens/attenuate
 * Body: { parentTokenId, childAgentTokenId, allowedTools, spendLimitUsdc, maxDepth, expiresAt }
 */
router.post("/tokens/attenuate", async (req, res) => {
  try {
    const t0 = Date.now();
    const { parentTokenId, childAgentTokenId, allowedTools, spendLimitUsdc, maxDepth, expiresAt } =
      req.body;

    const result = attenuateToken({
      parentTokenB64: parentTokenId,
      childAgentId: String(childAgentTokenId ?? "0"),
      allowedTools: allowedTools || [],
      spendLimitUsdc: Number(spendLimitUsdc ?? 1_000_000),
      maxDepth: maxDepth !== undefined ? Number(maxDepth) : undefined,
      expiresAt: expiresAt || undefined,
    });

    res.json({
      childTokenBytes: result.serialized,
      childRevocationId: result.revocationId,
      attenuationTimeMs: Date.now() - t0,
    });
  } catch (e) {
    console.error("tokens/attenuate:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Delegation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/delegate
 * Body: { parentRevocationId, childRevocationId, parentAgentTokenId, childScope }
 * Also supports the full SDK delegate() call if parentTokenB64 is provided.
 */
router.post("/delegate", async (req, res) => {
  try {
    const {
      parentTokenB64,
      parentAgentTokenId,
      childAgentTokenId,
      childTools,
      childSpendLimit,
      // direct registration shape
      parentRevocationId,
      childRevocationId,
      childScope,
    } = req.body;

    // Full SDK delegate flow (preferred — handles Biscuit + on-chain in one call)
    if (parentTokenB64) {
      const result = await delegate({
        parentTokenB64,
        parentAgentTokenId: String(parentAgentTokenId ?? "0"),
        childAgentTokenId: String(childAgentTokenId ?? "1"),
        childTools: childTools || [],
        childSpendLimit: Number(childSpendLimit ?? 10_000_000),
      });
      return res.json({
        txHash: result.txHash,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed ?? null,
        feeWei: result.feeWei ?? null,
        effectiveGasPrice: result.effectiveGasPrice ?? null,
        childRevocationId: result.childRevocationId,
        childTokenBytes: result.childToken,
        actualSpendLimit: result.actualSpendLimit,
      });
    }

    // Direct registration (caller already has revocation IDs + scope)
    const registry = getRegistry();
    const scope = {
      allowedTools: (childScope?.allowedTools || []).map((t) =>
        typeof t === "string" && !t.startsWith("0x")
          ? ethers.keccak256(ethers.toUtf8Bytes(t))
          : t
      ),
      spendLimitUsdc: BigInt(childScope?.spendLimitUsdc || 0),
      maxDepth: Number(childScope?.maxDepth ?? 3),
      expiresAt: BigInt(
        childScope?.expiresAt || Math.floor(Date.now() / 1000) + 86400
      ),
    };
    const tx = await registry.registerDelegation(
      parentRevocationId || ethers.ZeroHash,
      childRevocationId,
      scope,
      BigInt(parentAgentTokenId || 0)
    );
    const receipt = await tx.wait();
    return res.json({
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed?.toString(),
    });
  } catch (e) {
    console.error("delegate:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Execute
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/execute/verify-local
 * Body: { tokenId, agentId, tool, spendAmount }
 * Returns: { passed, checkTimeMs, reason, failedCheck? }
 */
router.post("/execute/verify-local", async (req, res) => {
  try {
    const t0 = Date.now();
    const { tokenId, agentId, tool, spendAmount } = req.body;
    const result = authorizeToken(
      tokenId,
      tool,
      Number(spendAmount ?? 0),
      String(agentId ?? "0")
    );
    res.json({
      passed: result.authorized,
      checkTimeMs: Date.now() - t0,
      reason: result.error || "all Datalog checks passed",
      failedCheck: result.authorized ? null : result.error,
    });
  } catch (e) {
    console.error("execute/verify-local:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/execute/submit
 *
 * Tries ERC-4337 UserOperation (Pimlico) first; falls back to direct EOA
 * execute() if PIMLICO_API_KEY is absent or the AA path errors.
 *
 * Body: { tokenId, agentId, tool, spendAmount, tlsnProof?, forceEoa? }
 * Returns: { txHash, blockNumber, success, reverted, revertReason, gasUsed, path }
 *   path: "aa-4337" | "eoa"
 */
router.post("/execute/submit", async (req, res) => {
  try {
    const { tokenId, agentId, tool, spendAmount, tlsnProof, forceEoa } = req.body;

    const pimlicoKey = process.env.PIMLICO_API_KEY?.trim();
    const useAA      = pimlicoKey && !forceEoa;

    if (useAA) {
      // ── ERC-4337 path ────────────────────────────────────────────────────
      // Reconstruct scope fields from the token metadata in local store.
      const meta = getTokenByRevocationId
        ? getTokenByRevocationId(tokenId)
        : null;

      if (meta) {
        try {
          const ownerPk = (
            process.env.AA_OWNER_PRIVATE_KEY ||
            process.env.PRIVATE_KEY
          )?.trim();

          if (!ownerPk) throw new Error("AA_OWNER_PRIVATE_KEY not set");

          const expiresAt =
            meta.expiresAt ??
            BigInt(Math.floor(Date.now() / 1000) + 86400);

          const aaResult = await sendValidateActionWithScopeUserOp({
            ownerPrivateKey: ownerPk.startsWith("0x") ? ownerPk : `0x${ownerPk}`,
            revocationId: meta.revocationId,
            agentTokenId: String(agentId ?? meta.agentId ?? "0"),
            toolName: tool,
            spendAmount: BigInt(spendAmount ?? 0),
            tlsAttestation: (tlsnProof || "0x"),
            allowedToolNames: meta.allowedTools || [],
            spendLimitUsdc: BigInt(meta.spendLimitUsdc ?? 50_000_000),
            maxDepth: Number(meta.maxDepth ?? 3),
            expiresAt: BigInt(expiresAt),
          });

          scheduleTrustProfileRefresh(agentId ?? meta.agentId ?? "0");

          return res.json({
            txHash:       aaResult.userOpHash,
            blockNumber:  null,
            success:      true,
            reverted:     false,
            revertReason: null,
            gasUsed:      null,
            path:         "aa-4337",
            smartAccount: aaResult.smartAccountAddress,
          });
        } catch (aaErr) {
          // AA failed — log and fall through to EOA
          console.warn("[execute/submit] AA path failed, falling back to EOA:", aaErr.message);
        }
      }
    }

    // ── EOA path (fallback or no Pimlico) ───────────────────────────────────
    const result = await execute({
      tokenB64: tokenId,
      agentTokenId: String(agentId ?? "0"),
      toolName: tool,
      spendAmount: Number(spendAmount ?? 0),
      tlsAttestation: tlsnProof || "0x",
    });

    const rawReason = result.success
      ? null
      : (result.error ?? result.message ?? "reverted");
    res.json({
      txHash:       result.txHash || null,
      blockNumber:  result.blockNumber || null,
      success:      result.success,
      reverted:     !result.success,
      revertReason: result.success ? null : stringifyRevertReason(rawReason),
      gasUsed:      result.gasUsed ?? null,
      feeWei:       result.feeWei ?? null,
      effectiveGasPrice: result.effectiveGasPrice ?? null,
      path:         "eoa",
    });

    if (result.success) scheduleTrustProfileRefresh(agentId);
  } catch (e) {
    console.error("execute/submit:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Trust
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/trust/:agentId
 */
router.get("/trust/:agentId", async (req, res) => {
  try {
    const registry = getRegistry();
    const { agentId } = req.params;
    const [trustScoreRaw, maxGrantable] = await Promise.all([
      registry.trustScore(BigInt(agentId)),
      registry.maxGrantableSpend(BigInt(agentId), 50_000_000n).catch(() => 0n),
    ]);

    let dctTrustProfile = null;
    let dctTrustMeta = null;
    let trustProfileDbSync = null;
    try {
      const { profile, events } = await computeDctTrustForAgent(agentId);
      dctTrustProfile = trustProfileToApi(profile);
      dctTrustMeta = {
        formula: "dct_signals_v1",
        enforcerEventCount: events.length,
      };
      trustProfileDbSync = await syncTrustProfileToDb(agentId, dctTrustProfile);
    } catch (err) {
      dctTrustMeta = { formula: "dct_signals_v1", error: err.message };
    }

    res.json({
      agentId,
      trustScore: ethers.formatEther(trustScoreRaw),
      trustScoreRaw: trustScoreRaw.toString(),
      maxGrantableSpend: maxGrantable.toString(),
      score: Number(trustScoreRaw) / 1e18,
      maxSpend: `$${(Number(maxGrantable) / 1e6).toFixed(2)}`,
      dctTrustProfile,
      dctTrustMeta,
      dctCompositePercent:
        dctTrustProfile != null ? dctTrustProfile.composite_score * 100 : null,
      trustProfileDbSync,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Revoke
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/revoke
 * Body: { tokenId, agentTokenId }
 */
router.post("/revoke", async (req, res) => {
  try {
    const { tokenId, agentTokenId } = req.body;
    const result = await revoke(tokenId, String(agentTokenId ?? "0"));
    res.json({
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      success: result.success,
      message: result.message,
      gasUsed: result.gasUsed ?? null,
      feeWei: result.feeWei ?? null,
      effectiveGasPrice: result.effectiveGasPrice ?? null,
    });
  } catch (e) {
    console.error("revoke:", e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
