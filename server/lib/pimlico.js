/**
 * Pimlico ERC-4337 bundler URL for Base Sepolia (84532).
 * Never expose the API key to clients — use only server-side.
 */

const BASE_SEPOLIA_CHAIN_ID = 84532;

/** @returns {string | null} Full RPC URL including apikey, or null if not configured */
export function getPimlicoBundlerRpcUrl() {
  const key = process.env.PIMLICO_API_KEY?.trim();
  if (!key) return null;
  return `https://api.pimlico.io/v2/${BASE_SEPOLIA_CHAIN_ID}/rpc?apikey=${key}`;
}

/** Safe for JSON responses — no secrets */
export function getPimlicoStatus() {
  return {
    configured: !!process.env.PIMLICO_API_KEY?.trim(),
    chainId: BASE_SEPOLIA_CHAIN_ID,
  };
}
