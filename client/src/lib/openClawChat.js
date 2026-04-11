/**
 * OpenAI-compatible chat completions — proxied via DCT server to avoid ngrok CORS.
 * Bearers are sent only to your DCT API (`POST /api/layer/openclaw-chat`), not stored on disk.
 */

import { DCT_API_BASE } from "./dctApiBase.js";

/**
 * @param {{ baseUrl: string, bearer?: string, model?: string, messages: Array<{ role: string, content: string }> }} opts
 */
export async function postOpenClawChat({
  baseUrl,
  bearer = "",
  model = "openclaw/main",
  messages,
}) {
  const base = String(baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!base) throw new Error("Missing OpenClaw base URL for this agent.");

  const r = await fetch(`${DCT_API_BASE}/api/layer/openclaw-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: base, bearer, model, messages }),
  });

  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `DCT proxy returned non-JSON (HTTP ${r.status}): ${text.slice(0, 240)}`
    );
  }
  if (!r.ok) {
    const err =
      (data && (data.error || data.message)) || `HTTP ${r.status}`;
    throw new Error(String(err));
  }
  return data;
}

/** @param {unknown} data */
export function pickAssistantText(data) {
  const c = data?.choices?.[0]?.message?.content;
  return typeof c === "string" ? c : "";
}

/**
 * Walk from dctStart along edges; return dctAgent nodes in workflow order (BFS).
 * @param {Array<{ id: string, type?: string }>} nodes
 * @param {Array<{ source: string, target: string }>} edges
 */
export function orderWorkflowAgents(nodes, edges) {
  const start = nodes.find((n) => n.type === "dctStart");
  if (!start) return [];

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  /** @type {Map<string, string[]>} */
  const outgoing = new Map();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source).push(e.target);
  }

  const agents = [];
  const seen = new Set();

  function walk(id) {
    if (seen.has(id)) return;
    seen.add(id);
    const n = byId[id];
    if (!n) return;
    if (n.type === "dctAgent") agents.push(n);
    for (const t of outgoing.get(id) || []) walk(t);
  }

  walk(start.id);
  return agents;
}
