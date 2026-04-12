import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

/** Default HTTP timeout — most routes. Layer apply / TLSN override per-request. */
const api = axios.create({
  baseURL: API_URL,
  timeout: 120000, // 2m (on-chain + slow RPC)
  headers: { "Content-Type": "application/json" },
});

// ── Agents ──
export const getAgents = () => api.get("/api/agents").then((r) => r.data);
/** @returns {Promise<{ tokenId: string, trustScore: string, dctTrustProfile?: object, dctCompositePercent?: number | null, offChainTrustProfile?: object }>} */
export const getAgentTrust = (tokenId) =>
  api.get(`/api/agents/${tokenId}/trust`).then((r) => r.data);
/** @param {{ uri?: string, agentURI?: string, ownerAddress?: string } | string} opts */
export const registerAgent = (opts, legacyOwner) => {
  if (typeof opts === "string") {
    return api
      .post("/api/agents/register", {
        uri: opts,
        ownerAddress: legacyOwner,
      })
      .then((r) => r.data);
  }
  return api.post("/api/agents/register", opts).then((r) => r.data);
};

// ── Biscuit (real Eclipse Biscuit WASM) ──
export const mintBiscuit = (data) =>
  api.post("/api/biscuit/mint", data).then((r) => r.data);
export const attenuateBiscuit = (data) =>
  api.post("/api/biscuit/attenuate", data).then((r) => r.data);
export const authorizeBiscuit = (token, toolName, spendAmount, agentTokenId) =>
  api
    .post("/api/biscuit/authorize", { token, toolName, spendAmount, agentTokenId })
    .then((r) => r.data);
export const inspectBiscuit = (token) =>
  api.post("/api/biscuit/inspect", { token }).then((r) => r.data);
export const getRootKey = () =>
  api.get("/api/biscuit/rootkey").then((r) => r.data);

// ── Delegation (on-chain) ──
export const getDelegationTree = () =>
  api.get("/api/delegation/tree").then((r) => r.data);
export const registerDelegation = (data) =>
  api.post("/api/delegation/register", data).then((r) => r.data);

// Full SDK flow: Biscuit attenuation + on-chain registration
export const delegateFull = (data) =>
  api.post("/api/delegation/delegate", data).then((r) => r.data);

// Full SDK flow: Datalog auth + DCTEnforcer validation
export const executeFull = (data) =>
  api.post("/api/delegation/execute", data).then((r) => r.data);

export const revokeDelegation = (tokenId, agentTokenId) =>
  api.post("/api/delegation/revoke", { tokenId, agentTokenId }).then((r) => r.data);
export const getDelegationStatus = (revocationId) =>
  api.get(`/api/delegation/status/${revocationId}`).then((r) => r.data);

// Legacy endpoint
export const validateAction = (data) =>
  api.post("/api/delegation/validate", data).then((r) => r.data);

// ── Health / config ──
export const healthCheck = () => api.get("/").then((r) => r.data);
export const getConfig = () => api.get("/api/config").then((r) => r.data);

// ── Operator layer (workflow snapshot; no secrets) ──
export const getLayerSnapshot = () =>
  api.get("/api/layer/snapshot").then((r) => r.data);

/** @param {{ version?: number, openClaw: { baseUrl: string, authMode: string }, workflow: { nodes: unknown[], edges: unknown[] }, agentBindings?: object | null, appliedAt?: string | null }} body */
export const saveLayerSnapshot = (body) =>
  api.post("/api/layer/snapshot", body).then((r) => r.data);

/**
 * On-chain: register three agents + root Biscuit + two delegations from Layer workflow nodes.
 * Can take several minutes (5 txs, RPC spacing, confirmations, retries). Override with VITE_LAYER_APPLY_TIMEOUT_MS.
 */
export const applyLayerOnChain = (body) => {
  const ms = Number(import.meta.env.VITE_LAYER_APPLY_TIMEOUT_MS);
  const timeout = Number.isFinite(ms) && ms >= 60000 ? ms : 600000; // default 10m
  return api.post("/api/layer/apply", body, { timeout }).then((r) => r.data);
};

// ── TLSNotary (server-side prover — no browser tlsn-js) ──
export const getTlsnConfig = () =>
  api.get("/api/tlsn/config").then((r) => r.data);

/** @param {{ url: string, toolName?: string, method?: string, headers?: object, body?: string }} body */
export const proveTlsn = (body) =>
  api.post("/api/tlsn/prove", body, { timeout: 120_000 }).then((r) => r.data);

export default api;
