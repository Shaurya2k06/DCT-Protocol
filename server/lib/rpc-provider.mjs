/**
 * JsonRpcProvider with retries on Alchemy/Infura rate limits (HTTP 429, CU/s bursts).
 *
 * Tune with RPC_HTTP_MAX_RETRIES (default 15) and RPC_HTTP_BASE_DELAY_MS (default 400).
 */
import { FetchRequest, JsonRpcProvider } from "ethers";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run an async RPC call with exponential backoff on 429 / rate limits.
 * @template T
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @param {{ maxRetries?: number, baseDelayMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function withRpcRetry(label, fn, opts = {}) {
  const max = opts.maxRetries ?? 18;
  const base = opts.baseDelayMs ?? 700;
  let lastErr;
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryableRpcError(e) || attempt >= max - 1) throw e;
      const delay = Math.min(40_000, base * 2 ** attempt + Math.random() * 500);
      console.warn(
        `[rpc] ${label} retry ${attempt + 1}/${max} in ${Math.round(delay)}ms (${String(
          /** @type {{ message?: string }} */ (e).message || e
        ).slice(0, 100)})`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

function retryOptsFromEnv() {
  const max = Number(process.env.RPC_HTTP_MAX_RETRIES ?? 20);
  const base = Number(process.env.RPC_HTTP_BASE_DELAY_MS ?? 600);
  return {
    maxRetries: Number.isFinite(max) && max >= 1 ? Math.min(40, max) : 20,
    baseDelayMs: Number.isFinite(base) && base >= 50 ? Math.min(4000, base) : 600,
  };
}

/** Safe stringify for error objects (may be circular). */
function errorFingerprint(err) {
  if (err == null) return "";
  try {
    return JSON.stringify(err);
  } catch {
    try {
      const o = /** @type {Record<string, unknown>} */ (err);
      return JSON.stringify({
        name: o.name,
        message: o.message,
        code: o.code,
        shortMessage: o.shortMessage,
        error: o.error,
        info: o.info,
        payload: o.payload,
      });
    } catch {
      return String(err);
    }
  }
}

/** @param {unknown} err */
export function isRetryableRpcError(err) {
  if (err == null) return false;
  const o = typeof err === "object" && err !== null ? /** @type {Record<string, unknown>} */ (err) : null;
  const directMsg = `${String(o?.message ?? "")} ${String(o?.shortMessage ?? "")}`.toLowerCase();
  if (
    /(^|[^\d])429([^\d]|$)|compute units|exceeded its compute|throughput|rate limit|too many requests/i.test(
      directMsg
    )
  ) {
    return true;
  }

  const fp = errorFingerprint(err).toLowerCase();
  if (fp.includes('"code":429') || fp.includes('"code": 429')) return true;
  if (fp.includes("compute units") && fp.includes("429")) return true;
  if (fp.includes("exceeded") && fp.includes("capacity")) return true;
  if (fp.includes("eth_sendrawtransaction") && fp.includes("429")) return true;

  if (o) {
    const code = o.code;
    const nested = /** @type {Record<string, unknown>} */ (o.error || o.info);
    const nestedCode = nested?.code ?? nested?.error?.code;
    if (code === 429 || nestedCode === 429) return true;
    if (code === "UNKNOWN_ERROR" || code === -32005) {
      if (fp.includes("429")) return true;
    }
  }
  const msg = String(
    /** @type {{ message?: string, shortMessage?: string }} */ (err).message ||
      /** @type {{ shortMessage?: string }} */ (err).shortMessage ||
      err
  ).toLowerCase();
  return (
    /429|rate limit|compute units|too many requests|capacity|throughput|timeout|econnreset|eai_again/i.test(
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
        const delay = Math.min(35_000, baseDelayMs * 2 ** attempt + Math.random() * 400);
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

  const pollEnv = Number(process.env.RPC_POLLING_INTERVAL_MS ?? 6500);
  const pollingInterval =
    Number.isFinite(pollEnv) && pollEnv >= 2000 ? Math.min(30_000, pollEnv) : 6500;

  return new JsonRpcProvider(fetchRequest, undefined, {
    pollingInterval,
  });
}
