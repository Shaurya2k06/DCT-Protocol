/** Client-only storage for sensitive OpenClaw material (never sent to the API). */

const PEM_KEY = "dct-layer-openclaw-pem";
const BEARER_KEY = "dct-layer-openclaw-bearer";

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
