import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const api = axios.create({
  baseURL: API_URL,
  timeout: 60000, // 60s for on-chain operations
  headers: { "Content-Type": "application/json" },
});

// ── Agents ──
export const getAgents = () => api.get("/api/agents").then((r) => r.data);
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

// ── Health ──
export const healthCheck = () => api.get("/").then((r) => r.data);

export default api;
