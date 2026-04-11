/**
 * DCT SDK — Delegated Capability Tokens
 *
 * The complete off-chain SDK for the DCT Protocol.
 * Implements: token minting, offline attenuation, authorization,
 * on-chain registration, revocation, and trust-gated delegation.
 *
 * This is the "three SDK calls" from the whitepaper:
 *   delegate(), execute(), revoke()
 *
 * References: context.md §4 (Eclipse Biscuit), §10 (Off-Chain SDK)
 */

import {
  biscuit, block, authorizer, policy,
  Biscuit, BiscuitBuilder, BlockBuilder, AuthorizerBuilder,
  PrivateKey, PublicKey, KeyPair,
  SignatureAlgorithm,
} from "@biscuit-auth/biscuit-wasm";
import { ethers } from "ethers";
import { getRegistry, getEnforcer, getSigner } from "./context.mjs";

function requireServerWallet() {
  const s = getSigner();
  if (!s) {
    throw new Error(
      "Server wallet not configured. Set PRIVATE_KEY in server/.env (Base Sepolia test key with ETH for gas)."
    );
  }
  return s;
}

/** Gas + fee metadata from an ethers v6 TransactionReceipt (for API / demo UI). */
function receiptEconomics(receipt) {
  if (!receipt) {
    return {
      gasUsed: null,
      feeWei: null,
      effectiveGasPrice: null,
    };
  }
  const gasUsed = receipt.gasUsed ?? 0n;
  const fee = receipt.fee ?? 0n;
  const egp = receipt.gasPrice ?? receipt.effectiveGasPrice ?? null;
  return {
    gasUsed: gasUsed.toString(),
    feeWei: fee.toString(),
    effectiveGasPrice: egp != null ? egp.toString() : null,
    blockNumber: receipt.blockNumber,
  };
}

// ── Root Key Management ──
// In production: HSM-backed. For hackathon: in-memory Ed25519 keys.
let rootKeyPair = null;
let rootPrivateKey = null;
let rootPublicKey = null;

/**
 * Initialize root Ed25519 keypair for Biscuit signing.
 * Called once at server startup.
 */
export function initRootKey() {
  rootKeyPair = new KeyPair(SignatureAlgorithm.Ed25519);
  rootPrivateKey = rootKeyPair.getPrivateKey();
  rootPublicKey = rootKeyPair.getPublicKey();
  console.log("  ✓ Root Ed25519 keypair generated for Biscuit signing");
  console.log(`    Public key: ${rootPublicKey.toString().substring(0, 32)}...`);
  return { rootPrivateKey, rootPublicKey };
}

export function getRootPublicKey() {
  if (!rootPublicKey) initRootKey();
  return rootPublicKey;
}

export function getRootPrivateKey() {
  if (!rootPrivateKey) initRootKey();
  return rootPrivateKey;
}

/** biscuit-wasm `authorize()` defaults to ~20ms max Datalog time — too low for Node WASM; raise for authorize(). */
const BISCUIT_RUN_LIMITS = { max_time_micro: 2_000_000 };

// ── Token Storage ──
// Maps serialized token base64 → Biscuit instance for quick lookups.
// Maps revocationId → token metadata.
const tokenStore = new Map();
const revocationIndex = new Map();

/**
 * Mint a new root Biscuit authority token.
 *
 * This creates the authority block — the maximum possible scope
 * for the entire delegation chain. Every subsequent attenuation
 * can only narrow, never widen.
 *
 * @param {Object} params
 * @param {string} params.agentId - ERC-8004 token ID of root agent
 * @param {string[]} params.allowedTools - Tools this token authorizes
 * @param {number} params.spendLimitUsdc - Max spend in 6-decimal USDC
 * @param {number} params.maxDepth - Max delegation depth
 * @param {number} [params.expiresAt] - Unix timestamp expiry
 * @returns {Object} { token: Biscuit, serialized: string, revocationId: string, rootPublicKey: string }
 */
export function mintRootToken({
  agentId,
  allowedTools = ["research", "web_fetch", "x402_pay"],
  spendLimitUsdc = 50_000_000,
  maxDepth = 3,
  expiresAt,
}) {
  const privKey = getRootPrivateKey();
  const pubKey = getRootPublicKey();
  const expiry = expiresAt || Math.floor(Date.now() / 1000) + 3600;
  const expiry64 = BigInt(expiry);

  // Build authority block using Datalog
  // This establishes the maximum scope for the entire chain
  const builder = new BiscuitBuilder();

  // Build the authority facts as a Datalog code block
  let code = `agent_erc8004_id("${agentId}");\n`;
  for (const tool of allowedTools) {
    code += `allowed_tool("${tool}");\n`;
  }
  code += `spend_limit_usdc(${spendLimitUsdc});\n`;
  code += `max_depth(${maxDepth});\n`;
  code += `expires_at(${expiry});\n`;

  // Align with authorizeToken facts: time window + per-action spend (see attenuateToken)
  code += `check if time($t), $t < ${expiry};\n`;
  code += `check if spend_usdc($s), $s <= ${spendLimitUsdc};\n`;

  // Scope commitment — keccak256 of the scope struct, mirrors on-chain
  const scopeHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes32[],uint256,uint8,uint64)"],
      [
        [
          allowedTools.map((t) => ethers.keccak256(ethers.toUtf8Bytes(t))),
          spendLimitUsdc,
          maxDepth,
          expiry64,
        ],
      ]
    )
  );
  code += `scope_commitment("${scopeHash}");\n`;

  builder.addCode(code);
  const token = builder.build(privKey);

  // Extract revocation identifiers
  const revIds = token.getRevocationIdentifiers();
  const revocationId = toBytes32(revIds[0]);

  // Store token
  const serialized = token.toBase64();
  tokenStore.set(serialized, {
    token,
    agentId,
    allowedTools,
    spendLimitUsdc,
    maxDepth,
    expiresAt: expiry,
    revocationId,
    depth: 0,
  });
  revocationIndex.set(revocationId, serialized);

  return {
    token,
    serialized,
    revocationId,
    rootPublicKey: pubKey.toString(),
    scopeHash,
    blocks: getTokenBlocks(token),
  };
}

/**
 * Attenuate a token — append a new block with narrower scope.
 *
 * This happens OFFLINE — zero network calls, pure cryptography.
 * Biscuit's Datalog semantics make scope widening cryptographically
 * impossible, not just a convention.
 *
 * @param {Object} params
 * @param {string} params.parentTokenB64 - Base64 parent Biscuit token
 * @param {string} params.childAgentId - ERC-8004 token ID of child agent
 * @param {string[]} params.allowedTools - Narrowed tool set (must be subset of parent)
 * @param {number} params.spendLimitUsdc - Narrowed spend limit (must be <= parent)
 * @param {number} [params.expiresAt] - Expiry (must be <= parent)
 * @returns {Object} { token: Biscuit, serialized: string, revocationId: string }
 */
export function attenuateToken({
  parentTokenB64,
  childAgentId,
  allowedTools,
  spendLimitUsdc,
  expiresAt,
  maxDepth,
}) {
  const pubKey = getRootPublicKey();
  const parentToken = Biscuit.fromBase64(parentTokenB64, pubKey);
  const parentMeta = tokenStore.get(parentTokenB64);

  const requestedExpiry = expiresAt || Math.floor(Date.now() / 1000) + 3600;
  const parentExpiry = parentMeta?.expiresAt ?? requestedExpiry;
  const effectiveExpiry = Math.min(requestedExpiry, parentExpiry);
  const childMaxDepth =
    maxDepth !== undefined
      ? maxDepth
      : Math.max(0, (parentMeta?.maxDepth ?? 3) - 1);

  // Build attenuation block — scope only narrows (see context.md §4)
  const attBlock = new BlockBuilder();
  let checkCode = "";

  if (allowedTools && allowedTools.length > 0) {
    for (const tool of allowedTools) {
      checkCode += `check if allowed_tool("${tool}");\n`;
    }
  }

  if (spendLimitUsdc !== undefined) {
    checkCode += `check if spend_usdc($s), $s <= ${spendLimitUsdc};\n`;
  }

  // Bind this delegation hop to the child ERC-8004 identity. Note: each append stacks
  // checks across the chain; a leaf token may require ALL prior hops' agent ids to unify
  // with the same $id — so multi-hop "O→R→P" cannot satisfy both R and P as redeemer
  // without a different policy model (future: replace or scope chain facts).
  checkCode += `check if agent_erc8004_id($id), $id == "${childAgentId}";\n`;
  checkCode += `check if time($t), $t < ${effectiveExpiry};\n`;

  attBlock.addCode(checkCode);

  const childToken = parentToken.appendBlock(attBlock);
  const serialized = childToken.toBase64();
  const revIds = childToken.getRevocationIdentifiers();
  const childRevocationId = toBytes32(revIds[revIds.length - 1]);

  // Store — scope fields must match registerDelegation / validateActionWithScope
  tokenStore.set(serialized, {
    token: childToken,
    agentId: childAgentId,
    allowedTools,
    spendLimitUsdc,
    expiresAt: effectiveExpiry,
    maxDepth: childMaxDepth,
    revocationId: childRevocationId,
    depth: (parentMeta?.depth || 0) + 1,
  });
  revocationIndex.set(childRevocationId, serialized);

  return {
    token: childToken,
    serialized,
    revocationId: childRevocationId,
    blocks: getTokenBlocks(childToken),
  };
}

/**
 * Authorize a Biscuit token against a requested action.
 *
 * Runs the Datalog authorizer to check all facts, rules, and checks.
 * This is the off-chain enforcement layer — before any on-chain call.
 *
 * @param {string} tokenB64 - Base64 Biscuit token
 * @param {string} toolName - Tool being invoked
 * @param {number} spendAmount - USDC spend for this action
 * @param {string} [agentTokenId] - ERC-8004 id of the acting agent (required for attenuated tokens)
 * @returns {Object} { authorized: boolean, error?: string }
 */
export function authorizeToken(tokenB64, toolName, spendAmount, agentTokenId) {
  try {
    const pubKey = getRootPublicKey();
    const token = Biscuit.fromBase64(tokenB64, pubKey);

    let authCode = `time(${Math.floor(Date.now() / 1000)});\n`;
    authCode += `allowed_tool("${toolName}");\n`;
    authCode += `spend_usdc(${spendAmount});\n`;
    if (agentTokenId != null && String(agentTokenId).length > 0) {
      authCode += `agent_erc8004_id("${agentTokenId}");\n`;
    }
    authCode += `allow if true;\n`;

    const builder = new AuthorizerBuilder();
    builder.addCode(authCode);
    const auth = builder.buildAuthenticated(token);
    auth.authorizeWithLimits(BISCUIT_RUN_LIMITS);

    return { authorized: true };
  } catch (error) {
    let msg = "authorization failed";
    if (error instanceof Error) msg = error.message;
    else if (typeof error === "string") msg = error;
    else {
      try {
        msg = JSON.stringify(error);
      } catch {
        msg = Object.prototype.toString.call(error);
      }
    }
    return { authorized: false, error: msg };
  }
}

/**
 * Full delegation flow — attenuate Biscuit + register on-chain.
 *
 * This is the primary SDK call: `delegate()`.
 * 1. Query trust score to gate spend limit
 * 2. Attenuate Biscuit offline (zero network calls)
 * 3. Register delegation in DCTRegistry on-chain
 *
 * @param {Object} params
 * @param {string} params.parentTokenB64 - Base64 parent Biscuit token
 * @param {string} params.parentAgentTokenId - ERC-8004 ID of parent agent
 * @param {string} params.childAgentTokenId - ERC-8004 ID of child agent
 * @param {string[]} params.childTools - Tools being delegated
 * @param {number} params.childSpendLimit - Requested spend limit
 * @returns {Object} Transaction result + attenuated token
 */
export async function delegate({
  parentTokenB64,
  parentAgentTokenId,
  childAgentTokenId,
  childTools,
  childSpendLimit,
}) {
  requireServerWallet();
  const registry = getRegistry();
  const parentMeta = tokenStore.get(parentTokenB64);
  const parentSpendCeiling = BigInt(parentMeta?.spendLimitUsdc ?? 50_000_000);

  // 1. Trust-gated spend — maxGrantableSpend(child, parentCeiling) per context.md §10
  const safeSpend = await registry.maxGrantableSpend(
    BigInt(childAgentTokenId),
    parentSpendCeiling
  );
  const requested = BigInt(childSpendLimit ?? Number(parentSpendCeiling));
  const actualSpend = requested < safeSpend ? requested : safeSpend;

  const expiresAtSec = Math.floor(Date.now() / 1000) + 3600;
  const scopeMaxDepth = Math.max(0, (parentMeta?.maxDepth ?? 3) - 1);

  // 2. Attenuate Biscuit OFFLINE — zero network calls, pure cryptography
  const { token: childToken, serialized, revocationId: childRevId } = attenuateToken({
    parentTokenB64,
    childAgentId: childAgentTokenId.toString(),
    allowedTools: childTools,
    spendLimitUsdc: Number(actualSpend),
    expiresAt: expiresAtSec,
    maxDepth: scopeMaxDepth,
  });

  const childMeta = tokenStore.get(serialized);
  const parentRevId = parentMeta?.revocationId || ethers.ZeroHash;

  // 3. Register on-chain — commitment must match validateActionWithScope in execute()
  const scope = {
    allowedTools: childTools.map((t) => ethers.keccak256(ethers.toUtf8Bytes(t))),
    spendLimitUsdc: actualSpend,
    maxDepth: childMeta?.maxDepth ?? scopeMaxDepth,
    expiresAt: BigInt(childMeta?.expiresAt ?? expiresAtSec),
  };

  const tx = await registry.registerDelegation(
    parentRevId,
    childRevId,
    scope,
    BigInt(parentAgentTokenId)
  );
  const receipt = await tx.wait();

  return {
    childToken: serialized,
    childRevocationId: childRevId,
    parentRevocationId: parentRevId,
    actualSpendLimit: actualSpend.toString(),
    txHash: receipt.hash,
    blocks: getTokenBlocks(childToken),
    ...receiptEconomics(receipt),
  };
}

/**
 * Execute an action through DCTEnforcer.
 *
 * This is the `execute()` SDK call:
 * 1. Authorize off-chain via Biscuit Datalog
 * 2. Validate on-chain via DCTEnforcer (4-step check)
 *
 * @param {Object} params
 * @param {string} params.tokenB64 - Base64 Biscuit token
 * @param {string} params.agentTokenId - ERC-8004 ID of executing agent
 * @param {string} params.toolName - Tool being invoked
 * @param {number} params.spendAmount - USDC spend for this action
 * @param {string} [params.tlsAttestation] - 65-byte hex sig for NotaryAttestationVerifier (optional)
 * @returns {Object} Execution result
 */
export async function execute({
  tokenB64,
  agentTokenId,
  toolName,
  spendAmount,
  tlsAttestation = "0x",
}) {
  // 1. Off-chain Biscuit authorization (Datalog check)
  const authResult = authorizeToken(
    tokenB64,
    toolName,
    spendAmount || 0,
    String(agentTokenId)
  );
  if (!authResult.authorized) {
    const err =
      typeof authResult.error === "string"
        ? authResult.error
        : (() => {
            try {
              return JSON.stringify(authResult.error);
            } catch {
              return "Biscuit authorization failed";
            }
          })();
    return {
      success: false,
      stage: "off-chain",
      error: err,
      message: "Biscuit Datalog check failed — action blocked before tx submission (zero gas wasted)",
    };
  }

  // 2. On-chain DCTEnforcer validation
  const meta = tokenStore.get(tokenB64);
  if (!meta) {
    return { success: false, stage: "sdk", error: "Token not found in local store" };
  }

  const enforcer = getEnforcer();
  const signer = requireServerWallet();
  const toolHash = ethers.keccak256(ethers.toUtf8Bytes(toolName));

  const allowedTools = (meta.allowedTools || []).map((t) =>
    ethers.keccak256(ethers.toUtf8Bytes(t))
  );
  if (allowedTools.length === 0) {
    return {
      success: false,
      stage: "sdk",
      error: "Token metadata missing allowedTools — cannot verify on-chain scope",
    };
  }

  const signerAddr = await signer.getAddress();
  const [pendingCount, latestCount] = await Promise.all([
    signer.provider.getTransactionCount(signerAddr, "pending"),
    signer.provider.getTransactionCount(signerAddr, "latest"),
  ]);
  const nonce = Math.max(pendingCount, latestCount);
  const tx = await enforcer.validateActionWithScope(
    meta.revocationId,
    BigInt(agentTokenId),
    toolHash,
    BigInt(spendAmount || 0),
    !tlsAttestation || tlsAttestation === "0x" ? "0x" : tlsAttestation,
    signerAddr,
    allowedTools,
    BigInt(meta.spendLimitUsdc),
    Number(meta.maxDepth ?? 3),
    BigInt(meta.expiresAt),
    { nonce }
  );
  const receipt = await tx.wait();

  const validatedEvent = receipt.logs.find((log) => {
    try {
      return enforcer.interface.parseLog(log)?.name === "ActionValidated";
    } catch {
      return false;
    }
  });

  return {
    success: !!validatedEvent,
    stage: "on-chain",
    txHash: receipt.hash,
    message: validatedEvent
      ? "Enforcer validated: revocation, identity, scope commitment, optional TLS"
      : "Enforcer rejected action",
    ...receiptEconomics(receipt),
  };
}

/**
 * Revoke a delegation token — O(1) on-chain write.
 *
 * This is the `revoke()` SDK call.
 * Children are NOT actively killed — they fail isRevoked()
 * at execution time through lazy lineage traversal.
 *
 * @param {string} revocationId - bytes32 revocation ID
 * @param {string} agentTokenId - ERC-8004 ID of revoking agent
 * @returns {Object} Transaction result
 */
export async function revoke(revocationId, agentTokenId) {
  const registry = getRegistry();
  const signer = requireServerWallet();
  const nonce = await signer.provider.getTransactionCount(await signer.getAddress(), "pending");
  const tx = await registry.revoke(revocationId, BigInt(agentTokenId), { nonce });
  const receipt = await tx.wait();

  return {
    success: true,
    txHash: receipt.hash,
    message: "Token revoked — O(1) write. Children fail isRevoked() lazily at execution time.",
    ...receiptEconomics(receipt),
  };
}

/**
 * Inspect a Biscuit token — decode all blocks and facts.
 *
 * @param {string} tokenB64 - Base64 Biscuit token
 * @returns {Object} Token inspection with blocks, facts, revocation IDs
 */
export function inspectToken(tokenB64) {
  const pubKey = getRootPublicKey();
  const token = Biscuit.fromBase64(tokenB64, pubKey);
  return {
    blocks: getTokenBlocks(token),
    blockCount: token.countBlocks(),
    revocationIds: token.getRevocationIdentifiers().map((id) =>
      typeof id === "string" ? id : toBytes32(id)
    ),
    meta: tokenStore.get(tokenB64) || null,
  };
}

/**
 * Get stored token metadata by revocation ID.
 */
export function getTokenByRevocationId(revocationId) {
  const serialized = revocationIndex.get(revocationId);
  if (!serialized) return null;
  return { serialized, ...tokenStore.get(serialized) };
}

// ── Helpers ──

function getTokenBlocks(token) {
  const blocks = [];
  for (let i = 0; i < token.countBlocks(); i++) {
    blocks.push({
      index: i,
      type: i === 0 ? "authority" : `attenuation_${i}`,
      source: token.getBlockSource(i),
    });
  }
  return blocks;
}

function toBytes32(id) {
  if (typeof id === "string") {
    const s = id.startsWith("0x") ? id : `0x${id}`;
    try {
      const bytes = ethers.getBytes(s);
      if (bytes.length === 32) return ethers.hexlify(bytes);
      if (bytes.length < 32) return ethers.hexlify(ethers.zeroPadBytes(bytes, 32));
      // Long Biscuit revocation ids: canonical bytes32 for on-chain DCTRegistry / DCTEnforcer
      return ethers.keccak256(bytes);
    } catch {
      return ethers.keccak256(ethers.toUtf8Bytes(id));
    }
  }
  const hex = Array.from(new Uint8Array(id))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const bytes = ethers.getBytes("0x" + hex);
  if (bytes.length === 32) return ethers.hexlify(bytes);
  if (bytes.length < 32) return ethers.hexlify(ethers.zeroPadBytes(bytes, 32));
  return ethers.keccak256(bytes);
}
