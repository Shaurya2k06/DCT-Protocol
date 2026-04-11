/**
 * Load DCTEnforcer ActionValidated / ActionRejected logs into ExecutionEvents
 * and compute the DCT trust profile (pythonNodes/trustScores.py formula via SDK).
 */
import {
  computeTrustProfile,
  revocationIdHex,
} from "@shaurya2k06/dctsdk";
import { getEnforcer, getProvider } from "./blockchain.js";
import { queryFilterChunked } from "./ethQueryFilterChunked.mjs";

/** Default task validators — aligned with pythonNodes/dct_integration.py demo. */
export const DEFAULT_DCT_EXPECTATIONS = {
  web_fetch: {
    tool: "web_fetch",
    validator: (body) => typeof body.content === "string" && body.content.length > 0,
  },
  x402_pay: {
    tool: "x402_pay",
    validator: (body) => body && typeof body === "object" && Object.keys(body).length > 0,
  },
};

function parseScopeHintsEnv() {
  const raw = process.env.DCT_DELEGATION_SCOPE_HINTS?.trim();
  if (!raw) return {};
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === "object") {
      const out = {};
      for (const [k, v] of Object.entries(o)) {
        const key = String(k).toLowerCase();
        out[key] = typeof v === "number" ? v : Number(v);
      }
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * @param {import("@shaurya2k06/dctsdk").ExecutionEvent[]} events
 * @param {Record<string, number>} hints revocationId hex (lowercase) -> spendLimitUsdc
 */
export async function loadExecutionEventsFromEnforcer(fromBlock = 0, hints = null) {
  const enforcer = getEnforcer();
  const provider = getProvider();

  const mergedHints = { ...parseScopeHintsEnv(), ...(hints || {}) };

  const validated = await queryFilterChunked(
    enforcer,
    enforcer.filters.ActionValidated(),
    fromBlock,
    "latest"
  );
  const rejected = await queryFilterChunked(
    enforcer,
    enforcer.filters.ActionRejected(),
    fromBlock,
    "latest"
  );

  if (validated.length === 0 && rejected.length === 0 && process.env.DCT_TRUST_DEBUG === "1") {
    const addr = await enforcer.getAddress();
    console.info(
      `[dctEnforcerTrust] no ActionValidated/Rejected logs (enforcer ${addr}, fromBlock ${fromBlock})`
    );
  }

  /** @type {Array<import("@shaurya2k06/dctsdk").ExecutionEvent>} */
  const out = [];

  for (const log of validated) {
    const args = log.args;
    const ridHex = revocationIdHex(args.revocationId);
    const spendLimit = ridHex ? mergedHints[ridHex] ?? mergedHints[args.revocationId] ?? 0 : 0;

    let timestamp = new Date();
    try {
      const block = await provider.getBlock(log.blockNumber);
      if (block) timestamp = new Date(Number(block.timestamp) * 1000);
    } catch {
      /* use now */
    }

    out.push({
      agent_id: Number(args.agentTokenId),
      tool: args.toolHash.toLowerCase(),
      scope_adhered: true,
      completed: false,
      spend_declared: Number(args.spendAmount),
      spend_limit: Number(spendLimit),
      latency_ms: 0,
      timestamp,
      response_body: {},
      revocation_id: ridHex,
    });
  }

  for (const log of rejected) {
    const args = log.args;
    const ridHex = revocationIdHex(args.revocationId);

    let timestamp = new Date();
    try {
      const block = await provider.getBlock(log.blockNumber);
      if (block) timestamp = new Date(Number(block.timestamp) * 1000);
    } catch {
      /* use now */
    }

    out.push({
      agent_id: Number(args.agentTokenId),
      tool: "",
      scope_adhered: false,
      completed: false,
      spend_declared: 0,
      spend_limit: 0,
      latency_ms: 0,
      timestamp,
      response_body: {},
      revocation_id: ridHex,
    });
  }

  return out;
}

/**
 * @param {string|number} agentTokenId
 * @param {{ fromBlock?: number, expectations?: Record<string, { tool: string, validator: (b: object) => boolean }>, hints?: Record<string, number> }} [opts]
 */
export async function computeDctTrustForAgent(agentTokenId, opts = {}) {
  const id = Number(agentTokenId);
  const fromBlock = Number(opts.fromBlock ?? process.env.DCT_ENFORCER_FROM_BLOCK ?? 0);
  const expectations = opts.expectations ?? DEFAULT_DCT_EXPECTATIONS;
  const events = await loadExecutionEventsFromEnforcer(fromBlock, opts.hints ?? null);
  const profile = computeTrustProfile(id, events, expectations, new Date());
  return { events, profile, expectationKeys: Object.keys(expectations) };
}

/** JSON-safe shape aligned with pythonNodes/dct_integration.py persist payload + tier_code */
export function trustProfileToApi(profile) {
  return {
    agent_id: profile.agent_id,
    composite_score: profile.composite_score,
    tier: profile.tier_name,
    tier_code: profile.tier,
    signal_1: profile.signal_1,
    signal_2: profile.signal_2,
    signal_3: profile.signal_3,
    execution_count: profile.execution_count,
    max_children: profile.max_children,
    max_depth: profile.max_depth,
    max_spend_fraction: profile.max_spend_fraction,
  };
}
