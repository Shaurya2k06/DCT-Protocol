/**
 * Optional VITE_LAYER_* in client/.env — overrides bundled defaults for "Autofill demo".
 * Restart Vite after changing .env. Use literal env keys so Vite can inline them.
 */

import { BUNDLED_LAYER_DEMO } from "./layerDemoDefaults.js";

function trim(s) {
  return typeof s === "string" ? s.trim() : "";
}

/**
 * @returns {{
 *   orchestrator: { url: string, bearer: string },
 *   research: { url: string, bearer: string },
 *   payment: { url: string, bearer: string },
 *   model: string,
 * }}
 */
export function readLayerDemoEnv() {
  const sharedUrl = trim(import.meta.env.VITE_LAYER_SHARED_URL);
  const sharedBearer = trim(import.meta.env.VITE_LAYER_SHARED_BEARER);
  const model = trim(import.meta.env.VITE_LAYER_MODEL);

  return {
    orchestrator: {
      url: trim(import.meta.env.VITE_LAYER_ORCH_URL) || sharedUrl,
      bearer: trim(import.meta.env.VITE_LAYER_ORCH_BEARER) || sharedBearer,
    },
    research: {
      url: trim(import.meta.env.VITE_LAYER_RESEARCH_URL) || sharedUrl,
      bearer: trim(import.meta.env.VITE_LAYER_RESEARCH_BEARER) || sharedBearer,
    },
    payment: {
      url: trim(import.meta.env.VITE_LAYER_PAYMENT_URL) || sharedUrl,
      bearer: trim(import.meta.env.VITE_LAYER_PAYMENT_BEARER) || sharedBearer,
    },
    model,
  };
}

/** @param {ReturnType<typeof readLayerDemoEnv>} env */
export function hasLayerDemoContent(env) {
  const slots = [env.orchestrator, env.research, env.payment];
  if (slots.some((s) => s.url || s.bearer)) return true;
  return Boolean(env.model);
}

/**
 * Bundled tunnel defaults, with optional VITE_LAYER_* overrides (non-empty env wins).
 * @returns {ReturnType<typeof readLayerDemoEnv>}
 */
export function getLayerDemoAutofill() {
  const env = readLayerDemoEnv();
  const b = BUNDLED_LAYER_DEMO;
  return {
    orchestrator: {
      url: env.orchestrator.url || b.orchestrator.url,
      bearer: env.orchestrator.bearer || b.orchestrator.bearer,
    },
    research: {
      url: env.research.url || b.research.url,
      bearer: env.research.bearer || b.research.bearer,
    },
    payment: {
      url: env.payment.url || b.payment.url,
      bearer: env.payment.bearer || b.payment.bearer,
    },
    model: env.model || b.model,
  };
}
