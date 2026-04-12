/**
 * Layer demo: real TLS via DCT TLSNotary (`POST /api/tlsn/prove`), then OpenClaw interprets the verified body.
 * Override with VITE_BTC_TLS_DEMO_URL (must be HTTPS).
 */

export const BTC_TLS_DEMO_URL =
  import.meta.env.VITE_BTC_TLS_DEMO_URL?.trim() ||
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd";
