/**
 * JsonRpcProvider with retries on Alchemy/Infura rate limits (HTTP 429, CU/s bursts).
 *
 * Tune with RPC_HTTP_MAX_RETRIES (default 15) and RPC_HTTP_BASE_DELAY_MS (default 400).
 */
import { FetchRequest, JsonRpcProvider } from "ethers";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function retryOptsFromEnv() {
  const max = Number(process.env.RPC_HTTP_MAX_RETRIES ?? 15);
  const base = Number(process.env.RPC_HTTP_BASE_DELAY_MS ?? 400);
  return {
    maxRetries: Number.isFinite(max) && max >= 1 ? Math.min(30, max) : 15,
    baseDelayMs: Number.isFinite(base) && base >= 50 ? Math.min(2000, base) : 400,
  };
}

/** @param {unknown} err */
export function isRetryableRpcError(err) {
  if (err == null) return false;
  if (typeof err === "object") {
    const o = /** @type {Record<string, unknown>} */ (err);
    const code = o.code;
    const nested = /** @type {Record<string, unknown>} */ (o.error || o.info);
    const nestedCode = nested?.code ?? nested?.error?.code;
    if (code === 429 || nestedCode === 429) return true;
    if (code === "UNKNOWN_ERROR" || code === -32005) {
      const payload = JSON.stringify(o).toLowerCase();
      if (payload.includes('"code":429') || payload.includes("429")) return true;
    }
  }
  const msg = String(
    /** @type {{ message?: string, shortMessage?: string }} */ (err).message ||
      /** @type {{ shortMessage?: string }} */ (err).shortMessage ||
      err
  ).toLowerCase();
  return (
    /429|rate limit|compute units|too many requests|capacity|timeout|econnreset|eai_again/i.test(
      msg
    )
  );
}

/**
 * @param {string} rpcUrl
 * @param {{ maxRetries?: number, baseDelayMs?: number }} [opts]
 */
export function createRetryingJsonRpcProvider(rpcUrl, opts = {}) {
  const env = retryOptsFromEnv();
  const maxRetries = opts.maxRetries ?? env.maxRetries;
  const baseDelayMs = opts.baseDelayMs ?? env.baseDelayMs;

  const fetchRequest = new FetchRequest(rpcUrl);
  const origSend = fetchRequest.send.bind(fetchRequest);
  fetchRequest.send = async function retryingSend() {
    let lastErr;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await origSend();
      } catch (e) {
        lastErr = e;
        if (!isRetryableRpcError(e) || attempt >= maxRetries - 1) {
          throw e;
        }
        const delay = Math.min(15_000, baseDelayMs * 2 ** attempt + Math.random() * 200);
        console.warn(
          `[rpc] retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms (${String(
            /** @type {{ message?: string }} */ (e).message || e
          ).slice(0, 120)})`
        );
        await sleep(delay);
      }
    }
    throw lastErr;
  };

  return new JsonRpcProvider(fetchRequest);
}
