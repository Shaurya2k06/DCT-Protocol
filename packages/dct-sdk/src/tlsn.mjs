import { ethers } from "ethers";

/**
 * Digest bound to DCT NotaryAttestationVerifier.sol — must match on-chain:
 *   keccak256(abi.encodePacked("DCT_TLSN", expectedEndpointHash))
 * where expectedEndpointHash is keccak256(toolName) (tool hash).
 */
export function tlsNotaryDigest(expectedEndpointHash) {
  return ethers.keccak256(
    ethers.solidityPacked(["string", "bytes32"], ["DCT_TLSN", expectedEndpointHash])
  );
}

/**
 * 65-byte ECDSA signature over tlsNotaryDigest(toolHash), verifiable on-chain.
 * @param {string} expectedEndpointHash - bytes32 hex (e.g. keccak256(utf8(toolName)))
 * @param {string} privateKeyHex - hex private key of notarySigner (no 0x prefix ok)
 */
export function signNotaryAttestation(expectedEndpointHash, privateKeyHex) {
  const hex = privateKeyHex.startsWith("0x") ? privateKeyHex : `0x${privateKeyHex}`;
  const key = new ethers.SigningKey(hex);
  const digest = tlsNotaryDigest(expectedEndpointHash);
  const sig = key.sign(ethers.getBytes(digest));
  return ethers.Signature.from(sig).serialized;
}
