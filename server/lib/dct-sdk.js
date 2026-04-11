/**
 * Re-exports the canonical @shaurya2k06/dctsdk package (Biscuit + on-chain DCT).
 * Host wiring: `wireDCTSdk()` in blockchain.js (called from server.js).
 *
 * Also re-exports TLSNotary helpers from lib/tlsn/ so routes can import from one place.
 * signNotaryAttestation is upgraded: uses the oracle key to sign (same call signature).
 */
export * from "@shaurya2k06/dctsdk";
// TLSNotary — override the package-level signNotaryAttestation with the server-side oracle version
export { signNotaryAttestation, proveAndAttest, getOracleAddress } from "./tlsn/index.mjs";
