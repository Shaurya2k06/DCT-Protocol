/**
 * TLSNotary prover — HTTP backend only.
 *
 * tlsn-js is browser-only (see tlsn-js readme). A standalone Rust crate that pulls
 * tlsn-prover from git without the full tlsn workspace fails with mpz-core /
 * hybrid_array conflicts. So we only call a **prover HTTP API** you run separately.
 *
 * Expected POST { url, method?, headers?, body? } → JSON body that includes either:
 *   • TLSNotary PresentationJSON: { version, data, meta } (tlsn-js / v0.1.0-alpha.12), or
 *   • Legacy DCT shape: { url, method, statusCode, responsePreview, sessionHash,
 *     notarySignatureHex, proofJson, backend, notaryUrl }
 *
 * Set TLSN_PROVER_URL=http://host:port in server/.env
 */

import { keccak256, toUtf8Bytes } from "ethers";

/**
 * @param {string} url
 * @param {string} [method="GET"]
 * @param {object} [headers={}]
 * @param {string} [body]
 */
export async function proveHttpCall(url, method = "GET", headers = {}, body) {
  const proverUrl = process.env.TLSN_PROVER_URL?.trim();
  if (!proverUrl) {
    throw new Error(
      "TLSN_PROVER_URL is not set. Run a prover service that exposes POST /prove " +
        "(see tlsnotary/tlsn examples / your own wrapper), then set TLSN_PROVER_URL. " +
        "Docker: `docker compose -f docker-compose.tlsn.yml up -d` starts the notary only; " +
        "the prover is a separate process."
    );
  }

  const resp = await fetch(`${proverUrl.replace(/\/$/, "")}/prove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, method: method || "GET", headers: headers || {}, body }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Prover API error ${resp.status}: ${text}`);
  }

  const raw = await resp.json();

  // Normalize PresentationJSON (tlsn Prover.notarize return shape) → proof envelope
  if (raw && raw.version && raw.data) {
    const proofJson = JSON.stringify(raw);
    const sessionHash = keccak256(toUtf8Bytes(proofJson));
    return {
      url,
      method: method || "GET",
      statusCode: raw.statusCode ?? 200,
      responsePreview: raw.responsePreview ?? "",
      sessionHash,
      notarySignatureHex: raw.notarySignatureHex ?? "0x",
      notaryUrl: raw.meta?.notaryUrl ?? process.env.TLSN_NOTARY_URL ?? "",
      proofJson,
      backend: raw.backend ?? "http-prover-api",
    };
  }

  return raw;
}
