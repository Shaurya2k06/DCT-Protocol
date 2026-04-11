/**
 * JsonRpcProvider with retries on Alchemy/Infura rate limits (HTTP 429, CU/s bursts).
 */
import { FetchRequest, JsonRpcProvider } from "ethers";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const maxRetries = opts.maxRetries ?? 8;
  const baseDelayMs = opts.baseDelayMs ?? 200;

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
        const delay = Math.min(8_000, baseDelayMs * 2 ** attempt + Math.random() * 150);
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
