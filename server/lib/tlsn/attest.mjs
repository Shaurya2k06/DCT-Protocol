/**
 * TLSNotary → Ethereum attestation bridge.
 *
 * After the oracle verifies a real TLSNotary ed25519 proof, it issues two ECDSA signatures:
 *
 *  1. verify()        attestation — for DCTEnforcer.validateActionWithScope (fast path, inline)
 *     digest = keccak256("DCT_TLSN", endpointHash)
 *
 *  2. verifyAndCommit() attestation — for NotaryAttestationVerifier.verifyAndCommit (audit path)
 *     digest = keccak256("DCT_TLSN_COMMIT", proofHash, endpointHash)
 *
 * Both signatures use the oracle's secp256k1 key (NOTARY_PRIVATE_KEY env).
 * The oracle MUST have verified the TLSNotary proof before calling these functions.
 */

import { ethers } from "ethers";
import { keccak256, toUtf8Bytes, solidityPackedKeccak256, getBytes } from "ethers";

function getOracleWallet() {
  const pk = process.env.NOTARY_PRIVATE_KEY?.trim() || process.env.PRIVATE_KEY?.trim();
  if (!pk) throw new Error("NOTARY_PRIVATE_KEY not set — oracle cannot attest proofs");
  const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
  return new ethers.Wallet(normalized);
}

/**
 * Create the ECDSA attestation for DCTEnforcer.validateActionWithScope.
 *
 * @param {string} endpointHash  keccak256 of the tool name bytes (what DCTEnforcer checks)
 * @returns {string}  65-byte hex attestation
 */
export async function createInlineAttestation(endpointHash) {
  const wallet = getOracleWallet();
  const digest = keccak256(
    ethers.solidityPacked(["string", "bytes32"], ["DCT_TLSN", endpointHash])
  );
  // Sign raw digest (not Ethereum prefixed) to match ECDSA.recover in Solidity
  const sig = wallet.signingKey.sign(getBytes(digest));
  return sig.serialized; // 65-byte r|s|v hex
}

/**
 * Create the ECDSA attestation for NotaryAttestationVerifier.verifyAndCommit.
 *
 * @param {string} proofHash     keccak256 of raw TLSNotary proof JSON bytes
 * @param {string} endpointHash  keccak256 of the tool name bytes
 * @returns {string}  65-byte hex attestation
 */
export async function createCommitAttestation(proofHash, endpointHash) {
  const wallet = getOracleWallet();
  const digest = keccak256(
    ethers.solidityPacked(
      ["string", "bytes32", "bytes32"],
      ["DCT_TLSN_COMMIT", proofHash, endpointHash]
    )
  );
  const sig = wallet.signingKey.sign(getBytes(digest));
  return sig.serialized;
}

/**
 * Compute the oracle's Ethereum address from NOTARY_PRIVATE_KEY.
 * This address must match `notarySigner` in the deployed NotaryAttestationVerifier.
 */
export function getOracleAddress() {
  try {
    return getOracleWallet().address;
  } catch {
    return null;
  }
}
