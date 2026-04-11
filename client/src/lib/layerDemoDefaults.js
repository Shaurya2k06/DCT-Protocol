/**
 * Bundled OpenClaw demo endpoints for Layer console (/layer) — "Autofill demo".
 * Update this file when ngrok tunnels or tokens change.
 *
 * Optional: set VITE_LAYER_* in client/.env to override any slot (see layerDemoEnv.js).
 */

/** @type {{ orchestrator: { url: string, bearer: string }, research: { url: string, bearer: string }, payment: { url: string, bearer: string }, model: string }} */
export const BUNDLED_LAYER_DEMO = {
  orchestrator: {
    url: "https://onlooker-related-empathy.ngrok-free.dev",
    bearer:
      "04c891bfc44f7aeab568424a97a59f0f68edf5ad49a18f46",
  },
  research: {
    url: "https://uncooked-tartness-bagging.ngrok-free.dev",
    bearer:
      "1cb2f87e1c11aef66b43812873e22c6e7f7318ee49f56d7c",
  },
  payment: {
    url: "https://transpose-unwashed-punk.ngrok-free.dev",
    bearer:
      "841c41083b846a7e2672555d2b9ba0a673010abd27e09aa718e4f5568a114642",
  },
  model: "openclaw/main",
};
