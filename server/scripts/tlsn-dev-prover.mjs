#!/usr/bin/env node
/**
 * Minimal TLSNotary "prover" HTTP API for local dev.
 *
 * The DCT server expects TLSN_PROVER_URL to expose POST /prove (see lib/tlsn/prover.mjs).
 * A full Rust tlsn prover is optional; this service:
 *   1. Optionally GETs the target URL (so status/preview are real)
 *   2. Returns a PresentationJSON-shaped object that lib/tlsn/verify.mjs accepts
 *
 * Usage:
 *   cd server && npm run tlsn-prover
 *   # .env: TLSN_PROVER_URL=http://127.0.0.1:8090
 *
 * Run alongside: docker compose -f docker-compose.tlsn.yml up -d  (notary on :7047)
 */
import express from "express";

const PORT = Number(process.env.TLSN_DEV_PROVER_PORT || 8090);
const NOTARY_URL = process.env.TLSN_NOTARY_URL?.trim() || "http://127.0.0.1:7047";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "dct-tlsn-dev-prover", notaryUrl: NOTARY_URL });
});

/**
 * POST /prove  { url, method?, headers?, body? }
 * Returns PresentationJSON-compatible JSON for the Node TLSN pipeline.
 */
app.post("/prove", async (req, res) => {
  try {
    const { url, method = "GET", headers = {}, body } = req.body || {};
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "url is required" });
    }
    new URL(url);

    let statusCode = 200;
    let responsePreview = "";
    try {
      const r = await fetch(url, {
        method,
        headers: typeof headers === "object" && headers ? headers : {},
        body: body && (method === "POST" || method === "PUT" || method === "PATCH") ? body : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      statusCode = r.status;
      const text = await r.text();
      responsePreview = text.slice(0, 800);
    } catch (e) {
      statusCode = 0;
      responsePreview = `fetch failed: ${e.message}`;
    }

    const payload = {
      url,
      method,
      statusCode,
      responsePreview,
      fetchedAt: new Date().toISOString(),
    };
    const dataHex = Buffer.from(JSON.stringify(payload), "utf8").toString("hex");

    const presentation = {
      version: "0.1",
      data: dataHex,
      meta: {
        notaryUrl: NOTARY_URL,
        backend: "dct-dev-prover",
      },
      url,
      method,
      statusCode,
      responsePreview,
      notarySignatureHex: "0x",
      backend: "dct-dev-prover",
    };

    res.json(presentation);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`DCT TLSN dev prover  http://127.0.0.1:${PORT}`);
  console.log(`  POST /prove   GET /health`);
  console.log(`  TLSN_NOTARY_URL=${NOTARY_URL}`);
});
