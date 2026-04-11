/**
 * OpenAI-compatible chat completions against an OpenClaw gateway (browser → ngrok, etc.).
 * Bearers stay in localStorage — never pass through the DCT snapshot API.
 */

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

  const url = `${base}/v1/chat/completions`;
  /** @type {Record<string, string>} */
  const headers = {
    "Content-Type": "application/json",
    // ngrok free tier interstitial
    "ngrok-skip-browser-warning": "true",
  };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages }),
  });

  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `OpenClaw returned non-JSON (HTTP ${r.status}): ${text.slice(0, 240)}`
    );
  }
  if (!r.ok) {
    const err =
      (data && (data.error?.message || data.error)) || `HTTP ${r.status}`;
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
