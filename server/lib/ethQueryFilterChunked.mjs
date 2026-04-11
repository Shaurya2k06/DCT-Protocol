/**
 * Paginate Contract.queryFilter across small block windows.
 * Infura Free tier: max 10 blocks per eth_getLogs — default chunk is 10 unless overridden.
 */
import { getProvider } from "./blockchain.js";

function contractProvider(contract) {
  const r = contract.runner;
  if (!r) return getProvider();
  return r.provider ?? r;
}

function isRateLimitError(err) {
  const msg = String(err?.message ?? err ?? "");
  const code = err?.code ?? err?.error?.code;
  return (
    code === 429 ||
    /429|rate|capacity|compute units|too many|throttl/i.test(msg)
  );
}

/** Infura / Alchemy Free: eth_getLogs window too large (ethers nests JSON-RPC in .info / payload) */
function isBlockRangeTooLargeError(err) {
  const msg = String(err?.message ?? err ?? "");
  const blob = `${msg}${JSON.stringify(err?.info ?? err?.error ?? {})}`;
  const code =
    err?.code ?? err?.error?.code ?? err?.info?.error?.code ?? err?.info?.payload?.error?.code;
  return (
    code === -32600 ||
    /10 block range|Free tier|eth_getLogs requests with up to|block range should work/i.test(
      blob
    )
  );
}

/**
 * @param {import("ethers").Contract} contract
 * @param {import("ethers").DeferredTopicFilter} filter
 * @param {number} start
 * @param {number} end
 * @param {number} delayBetweenSubMs
 */
async function queryFilterRange(contract, filter, start, end, delayBetweenSubMs) {
  const maxRetries = Number(process.env.DCT_ETH_GETLOGS_MAX_RETRIES ?? 6);
  let attempt = 0;
  for (;;) {
    try {
      return await contract.queryFilter(filter, start, end);
    } catch (e) {
      const span = end - start + 1;
      if (isBlockRangeTooLargeError(e) && span > 10) {
        console.warn(
          `[ethQueryFilterChunked] provider rejected range ${start}-${end} (${span} blocks); splitting into ≤10-block windows (Infura Free–style limit)`
        );
        /** @type {import("ethers").Log[]} */
        const acc = [];
        for (let s = start; s <= end; s += 10) {
          const e2 = Math.min(s + 9, end);
          const part = await queryFilterRange(contract, filter, s, e2, delayBetweenSubMs);
          acc.push(...part);
          if (delayBetweenSubMs > 0 && e2 < end) {
            await new Promise((r) => setTimeout(r, delayBetweenSubMs));
          }
        }
        return acc;
      }
      if (!isRateLimitError(e) || attempt >= maxRetries) throw e;
      attempt++;
      const base = Number(process.env.DCT_ETH_GETLOGS_RETRY_BASE_MS ?? 400);
      const delay = Math.min(45_000, base * 2 ** (attempt - 1));
      console.warn(
        `[ethQueryFilterChunked] rate limit on blocks ${start}-${end}, retry ${attempt}/${maxRetries} in ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * @param {import("ethers").Contract} contract
 * @param {import("ethers").DeferredTopicFilter} filter
 * @param {number|string} fromBlock
 * @param {number|"latest"} [toBlock]
 */
export async function queryFilterChunked(contract, filter, fromBlock, toBlock = "latest") {
  const prov = contractProvider(contract);
  const latest =
    toBlock === "latest" ? await prov.getBlockNumber() : Number(toBlock);
  const from = Math.max(0, Math.floor(Number(fromBlock)));
  const raw = process.env.DCT_ETH_GETLOGS_CHUNK_BLOCKS;
  /**
   * Default 10 — works on Infura Free. Alchemy PAYG / other providers: set DCT_ETH_GETLOGS_CHUNK_BLOCKS=2000 (or higher).
   * If a request is still rejected, queryFilterRange auto-splits into 10-block sub-ranges.
   */
  const chunk = Math.max(1, Math.min(10_000, Number(raw ?? 10)));
  /** Space out eth_getLogs to stay under Alchemy/Infura CU limits (raise if you still see 429) */
  const delayMs = Math.max(0, Number(process.env.DCT_ETH_GETLOGS_DELAY_MS ?? 120));
  if (from > latest) return [];
  /** @type {import("ethers").Log[]} */
  const out = [];
  let i = 0;
  for (let start = from; start <= latest; start += chunk) {
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    i++;
    const end = Math.min(start + chunk - 1, latest);
    const batch = await queryFilterRange(contract, filter, start, end, delayMs);
    out.push(...batch);
  }
  return out;
}
