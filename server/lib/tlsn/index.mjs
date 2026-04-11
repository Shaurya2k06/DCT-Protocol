/**
 * TLSNotary integration — full pipeline.
 *
 * proveAndAttest(params) is the single entry point for:
 *   1. Generating a real TLSNotary proof (via prover API or tlsn-js WASM)
 *   2. Verifying the notary's ed25519 signature
 *   3. Issuing two ECDSA attestations for on-chain use:
 *        • inlineAttestation  → DCTEnforcer.validateActionWithScope
 *        • commitAttestation  → NotaryAttestationVerifier.verifyAndCommit (audit trail)
 *
 * Usage:
 *   import { proveAndAttest, signNotaryAttestation } from "../lib/tlsn/index.mjs";
 *
 *   // Full real TLSNotary flow
 *   const { inlineAttestation, proofHash, proof } = await proveAndAttest({ url, toolName });
 *
 *   // Simple oracle signing (no TLSNotary proof, backward compat)
 *   const attestation = await signNotaryAttestation(endpointHash);
 */

import { keccak256, toUtf8Bytes } from "ethers";
import { proveHttpCall } from "./prover.mjs";
import { verifyTlsnProof } from "./verify.mjs";
import {
  createInlineAttestation,
  createCommitAttestation,
  getOracleAddress,
} from "./attest.mjs";

export { getOracleAddress };

/**
 * Full TLSNotary → on-chain attestation pipeline.
 *
 * @param {object} params
 * @param {string} params.url           URL to prove (e.g. "https://api.github.com/zen")
 * @param {string} [params.toolName]    Tool name — used as endpointHash input if provided
 * @param {string} [params.method]      HTTP method (default GET)
 * @param {object} [params.headers]     HTTP headers to include in the proof
 * @param {string} [params.body]        Request body (for POST/PUT)
 *
 * @returns {Promise<ProveAndAttestResult>}
 */
export async function proveAndAttest({
  url,
  toolName,
  method = "GET",
  headers = {},
  body,
}) {
  // endpointHash mirrors what DCTEnforcer.validateActionWithScope uses:
  //   toolHash = keccak256(toUtf8Bytes(toolName))
  // If toolName not provided, hash the URL instead.
  const endpointInput = toolName || url;
  const endpointHash = keccak256(toUtf8Bytes(endpointInput));

  // ── Step 1: Generate real TLSNotary proof ─────────────────────────────────
  const proof = await proveHttpCall(url, method, headers, body);

  // proofHash = keccak256 of the raw proof JSON (committed on-chain)
  const proofJsonStr = proof.proofJson || JSON.stringify(proof);
  const proofHash = keccak256(toUtf8Bytes(proofJsonStr));

  // ── Step 2: Verify notary's ed25519 signature off-chain ───────────────────
  const { valid, reason } = await verifyTlsnProof(proof);
  if (!valid) {
    throw new Error(`TLSNotary proof verification failed: ${reason}`);
  }

  // ── Step 3: Issue Ethereum ECDSA attestations ────────────────────────────
  const [inlineAttestation, commitAttestation] = await Promise.all([
    createInlineAttestation(endpointHash),
    createCommitAttestation(proofHash, endpointHash),
  ]);

  return {
    // For DCTEnforcer.validateActionWithScope  (tlsAttestation param)
    inlineAttestation,
    // For NotaryAttestationVerifier.verifyAndCommit  (on-chain audit trail)
    commitAttestation,
    proofHash,
    endpointHash,
    proof,
    oracle: getOracleAddress(),
  };
}

/**
 * Simple oracle signing — no TLSNotary proof, just ECDSA over endpointHash.
 * Backward-compatible with the old signNotaryAttestation(toolHash, pk) helper.
 * Use when TLSNotary is not configured or for quick testing.
 *
 * @param {string} endpointHash  keccak256 of tool name bytes (or toolHash)
 * @returns {Promise<string>} 65-byte hex attestation
 */
export async function signNotaryAttestation(endpointHash) {
  return createInlineAttestation(endpointHash);
}
