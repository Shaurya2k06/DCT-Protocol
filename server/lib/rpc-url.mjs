/**
 * Base Sepolia JSON-RPC resolution — Infura-first, then legacy Alchemy, or explicit RPC_URL.
 *
 * Priority:
 *   1. RPC_URL / WS_RPC_URL (full URL, any provider)
 *   2. INFURA_PROJECT_ID (or INFURA_API_KEY) — builds Infura Base Sepolia URLs
 *   3. ALCHEMY_API_KEY — legacy Alchemy URLs
 */

export function resolveHttpRpcUrl() {
  const explicit = process.env.RPC_URL?.trim();
  if (explicit) return explicit;

  const infura =
    process.env.INFURA_PROJECT_ID?.trim() || process.env.INFURA_API_KEY?.trim();
  if (infura) {
    return `https://base-sepolia.infura.io/v3/${infura}`;
  }

  const alchemy = process.env.ALCHEMY_API_KEY?.trim();
  if (alchemy) {
    return `https://base-sepolia.g.alchemy.com/v2/${alchemy}`;
  }

  return null;
}

/** WebSocket RPC for chain event subscriptions (optional; HTTP polling is the fallback). */
export function resolveWsRpcUrl() {
  const explicit = process.env.WS_RPC_URL?.trim();
  if (explicit) return explicit;

  const infura =
    process.env.INFURA_PROJECT_ID?.trim() || process.env.INFURA_API_KEY?.trim();
  if (infura) {
    return `wss://base-sepolia.infura.io/ws/v3/${infura}`;
  }

  const alchemy = process.env.ALCHEMY_API_KEY?.trim();
  if (alchemy) {
    return `wss://base-sepolia.g.alchemy.com/v2/${alchemy}`;
  }

  return null;
}

/** Short label for logs / GET / (no secrets). */
export function rpcConfigLabel() {
  if (process.env.RPC_URL?.trim()) return "RPC_URL";
  if (
    process.env.INFURA_PROJECT_ID?.trim() ||
    process.env.INFURA_API_KEY?.trim()
  ) {
    return "infura-base-sepolia";
  }
  if (process.env.ALCHEMY_API_KEY?.trim()) return "alchemy-base-sepolia (legacy)";
  return "unset";
}

export function missingRpcHelp() {
  return (
    "Set RPC_URL (HTTPS), or INFURA_PROJECT_ID (Infura dashboard project id), " +
    "or legacy ALCHEMY_API_KEY. See server/.env.example."
  );
}
