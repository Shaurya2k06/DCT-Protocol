/**
 * DCT Trust Score System — JS port of pythonNodes/trustScores.py
 * Three signals → composite score, tier, and delegation gates.
 */
import { keccak256, toUtf8Bytes, hexlify, getBytes, isHexString } from "ethers";

/** @enum {number} */
export const AgentTier = {
  COLD: 0,
  BRONZE: 1,
  SILVER: 2,
  GOLD: 3,
};

export const TIER_NAMES = ["COLD", "BRONZE", "SILVER", "GOLD"];

const DECAY_HALF_LIFE_DAYS = 7.0;
const _W1 = 0.5;
const _W2 = 0.2;
const _W3 = 0.3;
const _S1_RAW = 0.62;
const _S1_EMA = 0.38;
const _PRIOR = 0.5;
const _S2_ABSENT_EXPECTATION_PENALTY = 0.22;
const _GOLD_MIN_DISTINCT_TOOLS = 2;
const _GOLD_DIVERSITY_MIN_EXECUTIONS = 35;

const _TIER_GATES = {
  [AgentTier.COLD]: { max_children: 1, max_depth: 1, max_spend_fraction: 0.1 },
  [AgentTier.BRONZE]: { max_children: 2, max_depth: 2, max_spend_fraction: 0.25 },
  [AgentTier.SILVER]: { max_children: 5, max_depth: 4, max_spend_fraction: 0.6 },
  [AgentTier.GOLD]: { max_children: 10, max_depth: 6, max_spend_fraction: 0.9 },
};

/**
 * @typedef {{
 *   agent_id: number,
 *   tool: string,
 *   scope_adhered: boolean,
 *   completed: boolean,
 *   spend_declared: number,
 *   spend_limit: number,
 *   latency_ms: number,
 *   timestamp: Date,
 *   response_body?: Record<string, unknown>,
 *   revocation_id?: string | null,
 * }} ExecutionEvent
 */

/**
 * @typedef {{ tool: string, validator: (body: Record<string, unknown>) => boolean }} TaskExpectation
 */

function toolMatchesExpectation(eventTool, expectationKey) {
  if (!expectationKey || !eventTool) return false;
  if (eventTool === expectationKey) return true;
  const et = eventTool.trim().toLowerCase();
  if (!(et.startsWith("0x") && et.length === 66)) return false;
  const expectedHash = keccak256(toUtf8Bytes(expectationKey.trim())).toLowerCase();
  return et === expectedHash;
}

export function resolveExpectationForEvent(e, expectations) {
  if (!expectations || typeof expectations !== "object") return null;
  for (const key of Object.keys(expectations)) {
    if (toolMatchesExpectation(e.tool, key)) return expectations[key];
  }
  return null;
}

function responseBodyHasValidatorPayload(body) {
  if (!body || typeof body !== "object") return false;
  for (const v of Object.values(body)) {
    if (v != null && v !== "" && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && v && Object.keys(v).length === 0)) {
      return true;
    }
  }
  return false;
}

export function inferTaskCompleted(e, exp) {
  try {
    if (exp.validator(e.response_body || {})) return true;
  } catch {
    /* ignore */
  }
  if (e.revocation_id == null) return false;
  if (!e.scope_adhered) return false;
  if (e.spend_limit <= 0) return false;
  if (e.spend_declared > e.spend_limit) return false;
  if (responseBodyHasValidatorPayload(e.response_body || {})) return false;
  return true;
}

export function eventsMatchAnyExpectation(agentId, events, expectations) {
  if (!expectations || Object.keys(expectations).length === 0) return false;
  for (const ev of events) {
    if (ev.agent_id !== agentId) continue;
    if (resolveExpectationForEvent(ev, expectations) != null) return true;
  }
  return false;
}

export function signal1ScopeAdherence(agentId, events) {
  const agentEvents = events.filter((e) => e.agent_id === agentId);
  if (agentEvents.length === 0) return null;
  const adhered = agentEvents.filter((e) => e.scope_adhered).length;
  return adhered / agentEvents.length;
}

function scopeAdherenceEma(agentEvents, alpha = 0.12) {
  if (agentEvents.length === 0) return 0.5;
  const ordered = [...agentEvents].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  let ema = ordered[0].scope_adhered ? 1.0 : 0.0;
  for (let i = 1; i < ordered.length; i++) {
    const x = ordered[i].scope_adhered ? 1.0 : 0.0;
    ema = alpha * x + (1.0 - alpha) * ema;
  }
  return ema;
}

export function signal1EffectiveForComposite(agentId, events) {
  const raw = signal1ScopeAdherence(agentId, events);
  if (raw == null) return null;
  const agentEvents = events.filter((e) => e.agent_id === agentId);
  const ema = scopeAdherenceEma(agentEvents);
  return _S1_RAW * raw + _S1_EMA * ema;
}

export function signal2TaskCompletion(agentId, events, expectations) {
  const agentEvents = events.filter(
    (e) => e.agent_id === agentId && resolveExpectationForEvent(e, expectations) != null
  );
  if (agentEvents.length === 0) return null;
  let completed = 0;
  for (const event of agentEvents) {
    const exp = resolveExpectationForEvent(event, expectations);
    if (exp && inferTaskCompleted(event, exp)) completed += 1;
  }
  return completed / agentEvents.length;
}

export function signal3OutcomeQuality(agentId, events, now = new Date(), expectations = null) {
  const agentEvents = events.filter((e) => e.agent_id === agentId);
  if (agentEvents.length === 0) return null;
  const k = Math.log(2) / DECAY_HALF_LIFE_DAYS;
  const weights = [];
  const scores = [];

  for (const e of agentEvents) {
    let ts = e.timestamp;
    const ageDays = Math.max((now.getTime() - ts.getTime()) / 86400000, 0);
    const weight = Math.exp(-k * ageDays);

    let spendEfficiency = e.spend_limit > 0 ? e.spend_declared / e.spend_limit : 1.0;
    spendEfficiency = Math.min(spendEfficiency, 1.0);

    let done;
    if (expectations && Object.keys(expectations).length > 0) {
      const exp = resolveExpectationForEvent(e, expectations);
      if (exp != null) done = inferTaskCompleted(e, exp);
      else done = e.completed;
    } else {
      done = e.completed;
    }

    const quality = 0.6 * (done ? 1 : 0) + 0.3 * (e.scope_adhered ? 1 : 0) + 0.1 * (1.0 - spendEfficiency);
    weights.push(weight);
    scores.push(quality);
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return null;
  return weights.reduce((acc, w, i) => acc + w * scores[i], 0) / totalWeight;
}

function distinctToolCount(agentEvents) {
  const set = new Set();
  for (const e of agentEvents) {
    if (e.tool) set.add(e.tool.toLowerCase());
  }
  return set.size;
}

function deriveTier(composite, executionCount, s2, agentId, expectations, agentEvents) {
  if (executionCount === 0) return AgentTier.COLD;

  if (expectations && Object.keys(expectations).length > 0 && executionCount > 0) {
    if (!eventsMatchAnyExpectation(agentId, agentEvents, expectations)) return AgentTier.BRONZE;
  }

  if (s2 != null && s2 < 0.5) return AgentTier.BRONZE;

  const distinct = distinctToolCount(agentEvents);

  if (executionCount >= 50 && composite >= 0.85) {
    if (executionCount >= _GOLD_DIVERSITY_MIN_EXECUTIONS && distinct < _GOLD_MIN_DISTINCT_TOOLS) return AgentTier.SILVER;
    return AgentTier.GOLD;
  }
  if (executionCount >= 10 && composite >= 0.7) return AgentTier.SILVER;
  return AgentTier.BRONZE;
}

/**
 * @param {number} agentId
 * @param {ExecutionEvent[]} events
 * @param {Record<string, TaskExpectation>} expectations
 * @param {Date} [now]
 */
export function computeTrustProfile(agentId, events, expectations, now = new Date()) {
  const s1 = signal1ScopeAdherence(agentId, events);
  const s1Eff = signal1EffectiveForComposite(agentId, events);
  const s2 = signal2TaskCompletion(agentId, events, expectations);
  const s3 = signal3OutcomeQuality(agentId, events, now, expectations);

  const agentEvents = events.filter((e) => e.agent_id === agentId);
  const executionCount = agentEvents.length;

  if (executionCount === 0) {
    const gates = _TIER_GATES[AgentTier.COLD];
    return {
      agent_id: agentId,
      composite_score: 0,
      tier: AgentTier.COLD,
      tier_name: TIER_NAMES[AgentTier.COLD],
      signal_1: null,
      signal_2: null,
      signal_3: null,
      execution_count: 0,
      ...gates,
    };
  }

  const s1Val = s1Eff != null ? s1Eff : _PRIOR;
  const s3Val = s3 != null ? s3 : _PRIOR;

  const covers = eventsMatchAnyExpectation(agentId, events, expectations);
  let s2Val;
  if (s2 != null) s2Val = s2;
  else if (!expectations || Object.keys(expectations).length === 0) s2Val = _PRIOR;
  else if (!covers) s2Val = _S2_ABSENT_EXPECTATION_PENALTY;
  else s2Val = _PRIOR;

  const composite = _W1 * s1Val + _W2 * s2Val + _W3 * s3Val;
  const tier = deriveTier(composite, executionCount, s2, agentId, expectations, agentEvents);
  const gates = _TIER_GATES[tier];

  return {
    agent_id: agentId,
    composite_score: composite,
    tier,
    tier_name: TIER_NAMES[tier],
    signal_1: s1,
    signal_2: s2,
    signal_3: s3,
    execution_count: executionCount,
    ...gates,
  };
}

/**
 * Decode TLSNotary attestation dict → ExecutionEvent (mirrors Python parse_tlsn_attestation).
 * @param {Record<string, unknown>} raw
 * @returns {ExecutionEvent | null}
 */
export function parseTlsnAttestation(raw) {
  try {
    const tsRaw = raw.timestamp;
    let ts;
    if (typeof tsRaw === "string") {
      ts = new Date(tsRaw.replace("Z", "+00:00"));
    } else if (typeof tsRaw === "number") {
      ts = new Date(tsRaw * 1000);
    } else {
      return null;
    }

    const status = Number(raw.status_code);
    const scopeAdhered = status >= 200 && status < 300;

    return {
      agent_id: Number(raw.agent_id),
      tool: String(raw.tool),
      scope_adhered: scopeAdhered,
      completed: false,
      spend_declared: Number(raw.spend_declared),
      spend_limit: Number(raw.spend_limit),
      latency_ms: Number(raw.latency_ms ?? 0),
      timestamp: ts,
      response_body: typeof raw.response_body === "object" && raw.response_body ? /** @type {Record<string, unknown>} */ (raw.response_body) : {},
      revocation_id: null,
    };
  } catch {
    return null;
  }
}

export function keccakToolHex(toolName) {
  return keccak256(toUtf8Bytes(toolName)).toLowerCase();
}

/** Normalize revocation id to 0x…32 bytes hex for hint maps */
export function revocationIdHex(rid) {
  if (rid == null) return null;
  if (typeof rid === "string" && isHexString(rid)) {
    const b = getBytes(rid);
    const slice = b.length <= 32 ? b : b.slice(-32);
    return hexlify(slice).toLowerCase();
  }
  return null;
}
