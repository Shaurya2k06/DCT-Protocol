/**
 * Layer workflow snapshot — operator / "normal mode" console.
 * Persists workflow graph + OpenClaw connection metadata (no PEM or secrets).
 */

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();
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

export default router;
