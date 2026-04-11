/** Client-only storage for sensitive OpenClaw material (never sent to the API). */

const PEM_KEY = "dct-layer-openclaw-pem";
const BEARER_KEY = "dct-layer-openclaw-bearer";
/** Per-agent slot (or `node:<id>`) — one bearer per OpenClaw tunnel when agents differ. */
const AGENT_BEARER_PREFIX = "dct-layer-openclaw-agent-bearer:";

export function getOpenClawPem() {
  try {
    return localStorage.getItem(PEM_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setOpenClawPem(value) {
  try {
    if (value) localStorage.setItem(PEM_KEY, value);
    else localStorage.removeItem(PEM_KEY);
  } catch {
    /* ignore quota */
  }
}

export function getOpenClawBearer() {
  try {
    return localStorage.getItem(BEARER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setOpenClawBearer(value) {
  try {
    if (value) localStorage.setItem(BEARER_KEY, value);
    else localStorage.removeItem(BEARER_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} key stable slot: `orchestrator` | `research` | `payment` | `node:<reactFlowId>` | `custom-…`
 */
export function getAgentBearer(key) {
  if (!key) return "";
  try {
    return localStorage.getItem(AGENT_BEARER_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

/**
 * @param {string} key
 * @param {string} value
 */
export function setAgentBearer(key, value) {
  if (!key) return;
  try {
    if (value) localStorage.setItem(AGENT_BEARER_PREFIX + key, value);
    else localStorage.removeItem(AGENT_BEARER_PREFIX + key);
  } catch {
    /* ignore */
  }
}
