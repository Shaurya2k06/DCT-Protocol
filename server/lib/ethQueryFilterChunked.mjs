/**
 * Paginate Contract.queryFilter across small block windows.
 * Infura Free tier rejects eth_getLogs with range &gt; 10 blocks; other tiers allow more.
 */
import { getProvider } from "./blockchain.js";

function contractProvider(contract) {
  const r = contract.runner;
  if (!r) return getProvider();
  return r.provider ?? r;
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
  const chunk = Math.max(1, Math.min(10_000, Number(raw ?? 10)));
  if (from > latest) return [];
  /** @type {import("ethers").Log[]} */
  const out = [];
  for (let start = from; start <= latest; start += chunk) {
    const end = Math.min(start + chunk - 1, latest);
    const batch = await contract.queryFilter(filter, start, end);
    out.push(...batch);
  }
  return out;
}
