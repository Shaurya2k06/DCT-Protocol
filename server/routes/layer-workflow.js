/**
 * Layer workflow snapshot — operator / "normal mode" console.
 * Persists workflow graph + OpenClaw connection metadata (no PEM or secrets).
 *
 * OpenClaw chat + health are proxied here so the browser avoids CORS (ngrok has no ACAO).
 */

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

/** Reduce SSRF: only these hosts unless LAYER_OPENCLAW_ALLOW_ALL=1 */
function isAllowedOpenClawBase(base) {
  if (process.env.LAYER_OPENCLAW_ALLOW_ALL === "1") return true;
  try {
    const u = new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`);
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1") return true;
    if (h.endsWith(".ngrok-free.dev") || h.endsWith(".ngrok.io")) return true;
    return false;
  } catch {
    return false;
  }
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "layer-snapshot.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return null;
    const raw = fs.readFileSync(SNAPSHOT_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validateBody(body) {
  if (!body || typeof body !== "object") return "Invalid body";
  if (body.version !== undefined && typeof body.version !== "number") return "version must be a number";
  if (body.openClaw !== undefined && typeof body.openClaw !== "object") return "openClaw must be an object";
  if (body.workflow !== undefined) {
    const w = body.workflow;
    if (typeof w !== "object" || w === null) return "workflow must be an object";
    if (w.nodes !== undefined && !Array.isArray(w.nodes)) return "workflow.nodes must be an array";
    if (w.edges !== undefined && !Array.isArray(w.edges)) return "workflow.edges must be an array";
  }
  return null;
}

/**
 * GET /api/layer/snapshot
 * Returns last saved operator workflow (no secrets).
 */
router.get("/snapshot", (_req, res) => {
  const snap = readSnapshot();
  if (!snap) {
    return res.json({
      version: 1,
      openClaw: { baseUrl: "", authMode: "none" },
      workflow: { nodes: [], edges: [] },
      updatedAt: null,
    });
  }
  res.json(snap);
});

/**
 * POST /api/layer/snapshot
 * Body: { version?, openClaw: { baseUrl, authMode }, workflow: { nodes, edges } }
 * Rejects obvious secret fields if present (defense in depth).
 */
router.post("/snapshot", (req, res) => {
  const err = validateBody(req.body);
  if (err) return res.status(400).json({ error: err });

  const raw = JSON.stringify(req.body);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(raw)) {
    return res.status(400).json({
      error:
        "Do not send PEM or private keys to the API. Keep client TLS material in browser local storage only.",
    });
  }

  const snapshot = {
    version: req.body.version ?? 1,
    openClaw: {
      baseUrl: String(req.body.openClaw?.baseUrl ?? "").trim(),
      authMode: ["none", "bearer", "mtls"].includes(req.body.openClaw?.authMode)
        ? req.body.openClaw.authMode
        : "none",
    },
    workflow: {
      nodes: req.body.workflow?.nodes ?? [],
      edges: req.body.workflow?.edges ?? [],
    },
    updatedAt: new Date().toISOString(),
  };

  ensureDir();
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), "utf-8");

  res.json({ ok: true, snapshot });
});

/**
 * GET /api/layer/openclaw-health?baseUrl=https://….ngrok-free.dev
 * Proxies GET {baseUrl}/health (browser cannot call ngrok directly without CORS).
 */
router.get("/openclaw-health", async (req, res) => {
  const base = String(req.query.baseUrl ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!base) {
    return res.status(400).json({ error: "baseUrl query parameter required" });
  }
  if (!isAllowedOpenClawBase(base)) {
    return res.status(403).json({
      error:
        "Host not allowed for OpenClaw proxy (use ngrok / localhost, or set LAYER_OPENCLAW_ALLOW_ALL=1)",
    });
  }
  const url = `${base}/health`;
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { "ngrok-skip-browser-warning": "true" },
      signal: AbortSignal.timeout(15_000),
    });
    return res.status(200).json({
      ok: r.ok,
      status: r.status,
      url,
    });
  } catch (e) {
    return res.status(502).json({
      error: e.message || "upstream fetch failed",
      url,
    });
  }
});

/**
 * POST /api/layer/openclaw-chat
 * Body: { baseUrl, model?, messages: [...], bearer? }
 * Proxies POST {baseUrl}/v1/chat/completions (Bearer forwarded server-side — avoids browser CORS).
 */
router.post("/openclaw-chat", async (req, res) => {
  const { baseUrl, model, messages, bearer } = req.body || {};
  const base = String(baseUrl ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!base || !Array.isArray(messages)) {
    return res.status(400).json({ error: "baseUrl and messages[] required" });
  }
  if (!isAllowedOpenClawBase(base)) {
    return res.status(403).json({
      error:
        "Host not allowed for OpenClaw proxy (use ngrok / localhost, or set LAYER_OPENCLAW_ALLOW_ALL=1)",
    });
  }

  const url = `${base}/v1/chat/completions`;
  /** @type {Record<string, string>} */
  const headers = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  };
  if (bearer) headers.Authorization = `Bearer ${String(bearer)}`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model || "openclaw/main",
        messages,
      }),
      signal: AbortSignal.timeout(180_000),
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: `OpenClaw returned non-JSON (HTTP ${upstream.status})`,
        bodyPreview: text.slice(0, 400),
      });
    }
    return res.status(upstream.status).json(data);
  } catch (e) {
    console.error("[layer] openclaw-chat:", e.message);
    return res.status(502).json({ error: e.message || "proxy failed" });
  }
});

export default router;
