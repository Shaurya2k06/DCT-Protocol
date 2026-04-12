/**
 * Apply Layer workflow to chain: ERC-8004 ×3 → Biscuit root → delegate O→R → delegate R→P.
 * Uses the same SDK paths as Live demo / POST /api/delegate.
 */

import { mintRootToken, delegate } from "./dct-sdk.js";
import { getERC8004, getSigner, loadAddresses } from "./blockchain.js";
import { audit } from "./audit.js";

/** Pause between sequential txs — reduces Alchemy/Infura CU/s bursts (429). Override with LAYER_APPLY_TX_GAP_MS. */
function txGapMs() {
  const n = Number(process.env.LAYER_APPLY_TX_GAP_MS ?? 2200);
  if (!Number.isFinite(n) || n < 0) return 2200;
  return Math.min(60_000, n);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseTools(s) {
  if (!s || typeof s !== "string") return ["web_fetch"];
  const t = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return t.length ? t : ["web_fetch"];
}

function getSlotNode(nodes, slot) {
  return nodes.find((n) => n.type === "dctAgent" && n.data?.agentSlot === slot);
}

/**
 * @param {string} metaUri
 * @param {import('express').Request | null} req
 */
async function registerErc8004Agent(metaUri, req) {
  const erc8004 = getERC8004();
  const addresses = loadAddresses();
  const variant = addresses.identityRegistryVariant || "official";

  let tx;
  if (variant === "test") {
    const signer = getSigner();
    const to = await signer.getAddress();
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
    throw new Error("Could not parse ERC-8004 registration event");
  }

  const agentId = parsed.args.agentId.toString();
  if (req) {
    await audit(
      "layer.agent.register",
      { agentId, txHash: receipt.hash, blockNumber: receipt.blockNumber, variant },
      req
    );
  }

  return { agentId, txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

/**
 * @param {{ workflow?: { nodes?: unknown[] }, openClaw?: { baseUrl?: string } }, req?: import('express').Request }} opts
 */
export async function applyLayerWorkflow({ workflow, openClaw }, req = null) {
  getSigner();

  const nodes = workflow?.nodes ?? [];
  const ocBase = String(openClaw?.baseUrl ?? "").trim();

  const slots = ["orchestrator", "research", "payment"];
  const bySlot = {};
  for (const slot of slots) {
    const n = getSlotNode(nodes, slot);
    if (!n?.data) {
      throw new Error(
        `Workflow must include three dctAgent nodes with agentSlot "${slots.join('", "')}"`
      );
    }
    bySlot[slot] = n.data;
  }

  const ts = Date.now();
  /** @type {Record<string, { agentId: string, openClawBaseUrl: string | null, title?: string, txHash?: string }>} */
  const agentBindings = {};
  const steps = [];

  const gap = txGapMs();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const metaUri = `ipfs://dct-layer-${slot}-${ts}`;
    const { agentId, txHash, blockNumber } = await registerErc8004Agent(metaUri, req);
    const d = bySlot[slot];
    const url = String(d.openClawBaseUrl ?? "").trim() || ocBase || null;
    agentBindings[slot] = {
      agentId,
      openClawBaseUrl: url,
      title: d.title || slot,
      txHash,
      blockNumber,
    };
    steps.push({ step: `erc8004.register`, slot, agentId, txHash });
    if (i < slots.length - 1) {
      console.info(`[layer] tx gap ${gap}ms before next ERC-8004 registration (rate-limit spacing)`);
      await sleep(gap);
    }
  }

  const orch = bySlot.orchestrator;
  console.info(`[layer] tx gap ${gap}ms before Biscuit root + delegations`);
  await sleep(gap);

  const root = mintRootToken({
    agentId: String(agentBindings.orchestrator.agentId),
    allowedTools: parseTools(orch.allowedTools),
    spendLimitUsdc: Number(orch.spendLimitUsdc ?? 50_000_000),
    maxDepth: Number(orch.maxDepth ?? 3),
    expiresAt: Math.floor(Date.now() / 1000) + Number(orch.expiresHours ?? 168) * 3600,
  });
  steps.push({
    step: "biscuit.root",
    revocationId: root.revocationId,
    scopeHash: root.scopeHash,
  });

  const resData = bySlot.research;
  const d1 = await delegate({
    parentTokenB64: root.serialized,
    parentAgentTokenId: String(agentBindings.orchestrator.agentId),
    childAgentTokenId: String(agentBindings.research.agentId),
    childTools: parseTools(resData.allowedTools),
    childSpendLimit: Number(resData.spendLimitUsdc ?? 10_000_000),
  });
  steps.push({
    step: "delegate.O_to_R",
    txHash: d1.txHash,
    childRevocationId: d1.childRevocationId,
  });

  console.info(`[layer] tx gap ${gap}ms before R→P delegation`);
  await sleep(gap);

  const payData = bySlot.payment;
  const d2 = await delegate({
    parentTokenB64: d1.childToken,
    parentAgentTokenId: String(agentBindings.research.agentId),
    childAgentTokenId: String(agentBindings.payment.agentId),
    childTools: parseTools(payData.allowedTools),
    childSpendLimit: Number(payData.spendLimitUsdc ?? 2_000_000),
  });
  steps.push({
    step: "delegate.R_to_P",
    txHash: d2.txHash,
    childRevocationId: d2.childRevocationId,
  });

  if (req) {
    await audit(
      "layer.workflow.apply",
      {
        agents: agentBindings,
        rootRevocationId: root.revocationId,
        leafRevocationId: d2.childRevocationId,
      },
      req
    );
  }

  return {
    ok: true,
    appliedAt: new Date().toISOString(),
    agentBindings,
    steps,
    tokens: {
      rootSerialized: root.serialized,
      researchTokenSerialized: d1.childToken,
      paymentTokenSerialized: d2.childToken,
    },
  };
}
