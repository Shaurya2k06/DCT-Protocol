/**
 * ERC-4337 path: Pimlico bundler + paymaster + SimpleAccount (EntryPoint v0.7).
 * Gas can be sponsored; the owner private key still signs the UserOperation (not replaced by paymaster).
 *
 * For validateActionWithScope: `redeemer` MUST be the smart account address — ERC-8004 agent NFT
 * must be owned by that address (mint/transfer to the counterfactual address before first tx).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http, encodeFunctionData, keccak256, toBytes } from "viem";
import { baseSepolia } from "viem/chains";
import { createPaymasterClient } from "viem/account-abstraction";
import { entryPoint07Address } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { getPimlicoBundlerRpcUrl } from "../pimlico.js";
import { loadAddresses } from "../blockchain.js";
import { resolveHttpRpcUrl, missingRpcHelp } from "../rpc-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizePk(pk) {
  const s = String(pk).trim();
  return (s.startsWith("0x") ? s : `0x${s}`).slice(0, 66);
}

function loadEnforcerAbi() {
  const p = path.join(__dirname, "..", "..", "abi", "DCTEnforcer.json");
  const j = JSON.parse(fs.readFileSync(p, "utf-8"));
  return j.abi ?? j;
}

function rpcUrl() {
  const u = resolveHttpRpcUrl();
  if (!u) throw new Error(missingRpcHelp());
  return u;
}

/**
 * @param {object} p
 * @param {`0x${string}`} p.ownerPrivateKey - Signs UserOps (AA owner)
 * @param {string} p.revocationId
 * @param {string} p.agentTokenId
 * @param {string} p.toolName
 * @param {bigint|number|string} p.spendAmount
 * @param {`0x${string}`} p.tlsAttestation
 * @param {string[]} p.allowedToolNames - plain names; keccak256 in calldata
 * @param {bigint|number|string} p.spendLimitUsdc
 * @param {number} p.maxDepth
 * @param {bigint|number|string} p.expiresAt - unix seconds
 */
export async function sendValidateActionWithScopeUserOp(p) {
  const bundlerUrl = getPimlicoBundlerRpcUrl();
  if (!bundlerUrl) {
    throw new Error("Set PIMLICO_API_KEY for sponsored UserOperations");
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl()),
  });

  const paymaster = createPaymasterClient({
    transport: http(bundlerUrl),
  });

  const owner = privateKeyToAccount(normalizePk(p.ownerPrivateKey));

  const account = await toSimpleSmartAccount({
    client: publicClient,
    owner,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: baseSepolia,
    client: publicClient,
    bundlerTransport: http(bundlerUrl),
    paymaster,
  });

  const toolHash = keccak256(toBytes(p.toolName));
  const allowedTools = (p.allowedToolNames || []).map((t) => keccak256(toBytes(t)));

  const data = encodeFunctionData({
    abi: loadEnforcerAbi(),
    functionName: "validateActionWithScope",
    args: [
      p.revocationId,
      BigInt(p.agentTokenId),
      toolHash,
      BigInt(p.spendAmount ?? 0),
      p.tlsAttestation || "0x",
      account.address,
      allowedTools,
      BigInt(p.spendLimitUsdc),
      Number(p.maxDepth ?? 3),
      BigInt(p.expiresAt),
    ],
  });

  const addrs = loadAddresses();
  const enforcer = addrs.DCTEnforcer;
  if (!enforcer) throw new Error("DCTEnforcer address missing in addresses.json");

  const userOpHash = await smartAccountClient.sendTransaction({
    to: enforcer,
    data,
    value: 0n,
  });

  return {
    userOpHash,
    smartAccountAddress: account.address,
    redeemer: account.address,
  };
}
