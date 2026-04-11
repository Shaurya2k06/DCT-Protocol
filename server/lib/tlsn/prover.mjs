/**
 * TLSNotary prover module — three backends, tried in order:
 *
 *  1. Prover API service  (TLSN_PROVER_URL env) — Docker/Rust HTTP wrapper (recommended).
 *  2. tlsn-js WASM        (if installed and Node.js >= 20 w/ ws polyfill).
 *  3. Error                (configuration missing).
 *
 * Returns a proof object:
 *   { url, method, statusCode, responsePreview, sessionHash, notarySignatureHex, proofJson }
 *
 * proofJson is the raw string that must be keccak256-hashed to get proofHash for on-chain.
 */

import { createRequire } from "module";
import { keccak256, toUtf8Bytes } from "ethers";

const require = createRequire(import.meta.url);

// ── Backend 1: Prover HTTP API ─────────────────────────────────────────────
// Run via docker-compose.tlsn.yml.  Exposes POST /prove → proof JSON.

async function proveViaApi(url, method, headers, body) {
  const proverUrl = process.env.TLSN_PROVER_URL?.trim();
  if (!proverUrl) return null;

  const resp = await fetch(`${proverUrl}/prove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, method: method || "GET", headers: headers || {}, body }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Prover API error ${resp.status}: ${text}`);
  }

  return resp.json();
}

// ── Backend 2: tlsn-js WASM (Node.js + ws polyfill) ───────────────────────
// Requires:  npm install tlsn-js ws  (already in package.json if installed)
// tlsn-js uses browser WebSocket internally; we inject the ws module.

let tlsnJsAvailable = null; // null = untested, true/false after first attempt

async function proveViaTlsnJs(url, method, headers, body) {
  // Cache availability check
  if (tlsnJsAvailable === false) return null;

  try {
    // Polyfill WebSocket for Node.js
    if (typeof globalThis.WebSocket === "undefined") {
      const { WebSocket: NodeWS } = await import("ws");
      globalThis.WebSocket = NodeWS;
    }

    const { Prover, NotaryServer } = await import("tlsn-js");
    tlsnJsAvailable = true;

    const notaryUrl =
      process.env.TLSN_NOTARY_URL?.trim() || "https://notary.pse.dev";
    const notary = NotaryServer.from(notaryUrl);

    const parsedUrl = new URL(url);
    const prover = await Prover.new({
      serverDns: parsedUrl.hostname,
      maxTranscriptSize: parseInt(process.env.TLSN_MAX_TRANSCRIPT || "16384"),
    });

    const sessionUrl = await notary.sessionUrl(16384);
    await prover.setup(sessionUrl);

    const notarized = await prover.notarize({
      url,
      method: method || "GET",
      headers: headers || {},
      body: body || undefined,
    });

    // Selective disclosure: reveal everything in this demo
    const sentTranscript = await prover.transcript(notarized, "sent");
    const recvTranscript = await prover.transcript(notarized, "recv");

    const presentation = await prover.presentation(notarized, {
      sentRanges: [{ start: 0, end: sentTranscript.length }],
      recvRanges: [{ start: 0, end: Math.min(recvTranscript.length, 2048) }],
    });

    const proofJson = JSON.stringify(presentation);
    const sessionHash = keccak256(toUtf8Bytes(notarized.sessionId || proofJson));

    // Extract notary signature from presentation
    const notarySigHex = presentation?.attestation?.signature
      ?? presentation?.notarySignature
      ?? "0x";

    // Best-effort response preview from transcript
    const recvStr = typeof recvTranscript === "string"
      ? recvTranscript
      : new TextDecoder().decode(new Uint8Array(recvTranscript));
    const headerEnd = recvStr.indexOf("\r\n\r\n");
    const statusLine = recvStr.split("\r\n")[0] ?? "";
    const statusCode = parseInt(statusLine.match(/\d{3}/)?.[0] ?? "200");
    const responsePreview = headerEnd >= 0
      ? recvStr.slice(headerEnd + 4, headerEnd + 500)
      : recvStr.slice(0, 500);

    return {
      url,
      method: method || "GET",
      statusCode,
      responsePreview: responsePreview.slice(0, 500),
      sessionHash,
      notarySignatureHex: notarySigHex,
      notaryUrl,
      proofJson,
      backend: "tlsn-js",
    };
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND" || err.message?.includes("Cannot find")) {
      tlsnJsAvailable = false;
      return null;
    }
    // Other errors (network, notary unreachable) propagate
    throw new Error(`tlsn-js prover failed: ${err.message}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Prove an HTTP call using TLSNotary.
 *
 * @param {string}  url
 * @param {string}  [method="GET"]
 * @param {object}  [headers={}]
 * @param {string}  [body]
 * @returns {Promise<TlsnProof>}  proof object
 * @throws  if no backend is configured / available
 */
export async function proveHttpCall(url, method = "GET", headers = {}, body) {
  // Backend 1: configured prover API
  const viaApi = await proveViaApi(url, method, headers, body);
  if (viaApi) return viaApi;

  // Backend 2: tlsn-js WASM
  const viaWasm = await proveViaTlsnJs(url, method, headers, body);
  if (viaWasm) return viaWasm;

  throw new Error(
    "TLSNotary not configured. Set TLSN_PROVER_URL (Docker prover API) or install tlsn-js + set TLSN_NOTARY_URL. " +
    "See docker-compose.tlsn.yml for the recommended production setup."
  );
}
