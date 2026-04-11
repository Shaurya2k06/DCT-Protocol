/**
 * Layer Console — "normal mode" operator UI: OpenClaw connection + n8n-style workflow
 * with per-agent limits. Saved graph is persisted server-side (metadata only); PEM/bearer
 * stay in the browser (localStorage).
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Save, Plus, Trash2, Link2, Loader2, CheckCircle2, AlertCircle,
  LayoutGrid, Server, Play, Wand2, Workflow,
} from "lucide-react";
import LayerWorkflowCanvas from "../components/layer/LayerWorkflowCanvas";
import {
  getLayerSnapshot,
  saveLayerSnapshot,
} from "../lib/api";
import {
  getOpenClawPem,
  setOpenClawPem,
  getOpenClawBearer,
  setOpenClawBearer,
  getAgentBearer,
  setAgentBearer,
} from "../lib/layerLocal";
import {
  orderWorkflowAgents,
  pickAssistantText,
  postOpenClawChat,
} from "../lib/openClawChat";
import { DCT_API_BASE } from "../lib/dctApiBase.js";
import { getLayerDemoAutofill } from "../lib/layerDemoEnv";
import { setPendingLiveDemoE2E } from "../lib/liveDemoTrigger";

/** Stable key for localStorage bearer (each OpenClaw tunnel can differ). */
function bearerKeyForAgentNode(node) {
  if (!node || node.type !== "dctAgent") return "";
  return String(node.data?.agentSlot || `node:${node.id}`).trim();
}

const DEFAULT_NODES = [
  {
    id: "dc-root",
    type: "dctStart",
    position: { x: 220, y: 24 },
    data: { label: "OpenClaw gateway" },
  },
  {
    id: "dc-a1",
    type: "dctAgent",
    position: { x: 200, y: 140 },
    data: {
      title: "Orchestrator",
      agentSlot: "orchestrator",
      openClawBaseUrl: "",
      openClawModel: "openclaw/main",
      spendLimitUsdc: 50_000_000,
      maxDepth: 3,
      allowedTools: "research,web_fetch,x402_pay",
      expiresHours: 168,
    },
  },
  {
    id: "dc-a2",
    type: "dctAgent",
    position: { x: 200, y: 300 },
    data: {
      title: "Research",
      agentSlot: "research",
      openClawBaseUrl: "",
      openClawModel: "openclaw/main",
      spendLimitUsdc: 10_000_000,
      maxDepth: 2,
      allowedTools: "web_fetch,research",
      expiresHours: 72,
    },
  },
  {
    id: "dc-a3",
    type: "dctAgent",
    position: { x: 200, y: 460 },
    data: {
      title: "Payment",
      agentSlot: "payment",
      openClawBaseUrl: "",
      openClawModel: "openclaw/main",
      spendLimitUsdc: 2_000_000,
      maxDepth: 1,
      allowedTools: "x402_pay",
      expiresHours: 48,
    },
  },
];

const DEFAULT_EDGES = [
  { id: "e1", source: "dc-root", target: "dc-a1", animated: true },
  { id: "e2", source: "dc-a1", target: "dc-a2", animated: true },
  { id: "e3", source: "dc-a2", target: "dc-a3", animated: true },
];

function migrateAgentNodes(nodes) {
  return nodes.map((n) => {
    if (n.type !== "dctAgent") return n;
    const d = n.data || {};
    return {
      ...n,
      data: {
        ...d,
        agentSlot: d.agentSlot || `node:${n.id}`,
        openClawBaseUrl: d.openClawBaseUrl ?? "",
        openClawModel: d.openClawModel || "openclaw/main",
      },
    };
  });
}

export default function LayerConsole() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [nodes, setNodes] = useState(DEFAULT_NODES);
  const [edges, setEdges] = useState(DEFAULT_EDGES);
  const [selectedId, setSelectedId] = useState(null);

  const [openClawBase, setOpenClawBase] = useState("");
  const [authMode, setAuthMode] = useState("none");
  const [pemText, setPemText] = useState("");
  const [bearer, setBearer] = useState("");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [chainBusy, setChainBusy] = useState(false);
  const [chainLog, setChainLog] = useState([]);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    setPemText(getOpenClawPem());
    setBearer(getOpenClawBearer());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getLayerSnapshot();
        if (cancelled) return;
        setOpenClawBase(s.openClaw?.baseUrl ?? "");
        setAuthMode(["none", "bearer", "mtls"].includes(s.openClaw?.authMode)
          ? s.openClaw.authMode
          : "none");
        if (s.workflow?.nodes?.length) {
          setNodes(migrateAgentNodes(s.workflow.nodes));
          setEdges(s.workflow.edges?.length ? s.workflow.edges : []);
        } else {
          setNodes(DEFAULT_NODES);
          setEdges(DEFAULT_EDGES);
        }
      } catch {
        if (!cancelled) {
          setNodes(DEFAULT_NODES);
          setEdges(DEFAULT_EDGES);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = nodes.find((n) => n.id === selectedId);
  const selectedAgent = selected?.type === "dctAgent" ? selected : null;
  const selectedBearerKey = selectedAgent ? bearerKeyForAgentNode(selectedAgent) : "";

  const [slotBearerInput, setSlotBearerInput] = useState("");
  useEffect(() => {
    if (!selectedBearerKey) {
      setSlotBearerInput("");
      return;
    }
    setSlotBearerInput(getAgentBearer(selectedBearerKey));
  }, [selectedBearerKey, selectedId]);

  const patchAgent = useCallback(
    (patch) => {
      if (!selectedId) return;
      setNodes((ns) =>
        ns.map((n) =>
          n.id === selectedId && n.type === "dctAgent"
            ? { ...n, data: { ...n.data, ...patch } }
            : n
        )
      );
    },
    [selectedId]
  );

  const addAgent = useCallback(() => {
    const id = crypto.randomUUID();
    const nAgents = nodes.filter((n) => n.type === "dctAgent").length;
    setNodes((ns) => [
      ...ns,
      {
        id,
        type: "dctAgent",
        position: { x: 160 + (nAgents % 3) * 40, y: 140 + nAgents * 28 },
        data: {
          title: `Agent ${nAgents + 1}`,
          agentSlot: `custom-${id.slice(0, 8)}`,
          openClawBaseUrl: "",
          openClawModel: "openclaw/main",
          spendLimitUsdc: 5_000_000,
          maxDepth: 3,
          allowedTools: "research,web_fetch",
          expiresHours: 48,
        },
      },
    ]);
    setSelectedId(id);
  }, [nodes]);

  const removeSelected = useCallback(() => {
    if (!selectedId || selectedId === "dc-root") return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((es) =>
      es.filter((e) => e.source !== selectedId && e.target !== selectedId)
    );
    setSelectedId(null);
  }, [selectedId]);

  const persistLocalSecrets = () => {
    setOpenClawPem(pemText.trim());
    setOpenClawBearer(bearer.trim());
    if (selectedBearerKey) setAgentBearer(selectedBearerKey, slotBearerInput.trim());
  };

  const resolveAgentConnection = useCallback(
    (agentNode) => {
      const d = agentNode?.data || {};
      const base = (d.openClawBaseUrl || openClawBase || "").trim().replace(/\/$/, "");
      const slot = bearerKeyForAgentNode(agentNode);
      const per = getAgentBearer(slot);
      const tok = per || (authMode === "bearer" ? bearer.trim() : "");
      const model = d.openClawModel || "openclaw/main";
      return { base, bearer: tok, model };
    },
    [openClawBase, authMode, bearer]
  );

  const handlePingSelectedAgent = async () => {
    if (!selectedAgent) return;
    persistLocalSecrets();
    const { base, bearer: tok, model } = resolveAgentConnection(selectedAgent);
    if (!base) {
      setMsg({ type: "err", text: "Set this agent’s OpenClaw base URL (or a global default)." });
      return;
    }
    if (!tok) {
      setMsg({ type: "err", text: "Set a bearer for this agent (or global bearer + auth mode)." });
      return;
    }
    setTesting(true);
    setMsg(null);
    try {
      const data = await postOpenClawChat({
        baseUrl: base,
        bearer: tok,
        model,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      });
      const reply = pickAssistantText(data);
      setMsg({
        type: "ok",
        text: `Chat OK — ${selectedAgent.data?.title || "agent"}: ${reply.slice(0, 200)}${reply.length > 200 ? "…" : ""}`,
      });
    } catch (e) {
      setMsg({
        type: "err",
        text:
          e.message ||
          "Chat failed (CORS, wrong URL, or token). OpenClaw must allow browser CORS from this origin.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleRunChainDemo = async () => {
    persistLocalSecrets();
    const agents = orderWorkflowAgents(nodes, edges);
    if (agents.length === 0) {
      setMsg({ type: "err", text: "Connect Gateway → agents in order (no agents reachable from the start node)." });
      return;
    }
    setChainBusy(true);
    setChainLog([]);
    setMsg(null);
    let prior = "";
    try {
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        const title = a.data?.title || `Agent ${i + 1}`;
        const { base, bearer: tok, model } = resolveAgentConnection(a);
        if (!base) {
          setChainLog((log) => [...log, `✗ ${title}: missing OpenClaw base URL`]);
          throw new Error(`"${title}" has no OpenClaw base URL (per-agent or global).`);
        }
        if (!tok) {
          setChainLog((log) => [...log, `✗ ${title}: missing bearer`]);
          throw new Error(`"${title}" has no bearer (per-agent field or global).`);
        }
        const userContent =
          i === 0
            ? `You are "${title}" in a delegated multi-agent workflow (${agents.length} steps). In one short sentence, state your role.`
            : `Prior agent said:\n${prior.slice(0, 2_000)}\n\nYou are "${title}". In one or two sentences, how do you extend that in this chain?`;
        setChainLog((log) => [...log, `→ ${title} …`]);
        const data = await postOpenClawChat({
          baseUrl: base,
          bearer: tok,
          model,
          messages: [{ role: "user", content: userContent }],
        });
        prior = pickAssistantText(data);
        setChainLog((log) => [
          ...log,
          `← ${title}: ${prior.slice(0, 360)}${prior.length > 360 ? "…" : ""}`,
        ]);
      }
      setMsg({
        type: "ok",
        text: `Chain demo finished — ${agents.length} OpenClaw chat completion(s).`,
      });
    } catch (e) {
      setMsg({ type: "err", text: e.message || String(e) });
    } finally {
      setChainBusy(false);
    }
  };

  const handleSave = async () => {
    persistLocalSecrets();
    setSaving(true);
    setMsg(null);
    try {
      await saveLayerSnapshot({
        version: 1,
        openClaw: {
          baseUrl: openClawBase.trim(),
          authMode,
        },
        workflow: { nodes, edges },
      });
      setMsg({
        type: "ok",
        text:
          "Saved graph + OpenClaw defaults to server/data/layer-snapshot.json. This does not run DCT (no ERC-8004, Biscuit, or registry txs). Use Run DCT live demo for on-chain steps. PEM / bearer stayed in this browser.",
      });
    } catch (e) {
      setMsg({
        type: "err",
        text: e.response?.data?.error || e.message || "Save failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAutofillDemo = useCallback(() => {
    const cfg = getLayerDemoAutofill();

    setNodes((ns) =>
      ns.map((n) => {
        if (n.type !== "dctAgent") return n;
        const slot = n.data?.agentSlot;
        const s = slot && cfg[slot];
        const patch = { ...n.data };
        if (s?.url) patch.openClawBaseUrl = s.url;
        if (cfg.model) patch.openClawModel = cfg.model;
        return { ...n, data: patch };
      })
    );

    for (const slot of ["orchestrator", "research", "payment"]) {
      const b = cfg[slot]?.bearer;
      if (b) setAgentBearer(slot, b);
    }

    if (selectedBearerKey) {
      setSlotBearerInput(getAgentBearer(selectedBearerKey));
    }

    setMsg({
      type: "ok",
      text:
        "Applied bundled OpenClaw demo URLs + tokens (client/src/lib/layerDemoDefaults.js). VITE_LAYER_* in client/.env overrides when set. Bearers saved in localStorage per slot.",
    });
  }, [selectedBearerKey]);

  const handleTestOpenClaw = async () => {
    const base = openClawBase.trim().replace(/\/$/, "");
    if (!base) {
      setMsg({ type: "err", text: "Set an OpenClaw base URL first." });
      return;
    }
    setTesting(true);
    setMsg(null);
    try {
      const r = await fetch(
        `${DCT_API_BASE}/api/layer/openclaw-health?baseUrl=${encodeURIComponent(base)}`
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({
          type: "err",
          text:
            j.error ||
            `Health proxy HTTP ${r.status}. Is the DCT server running (${DCT_API_BASE})?`,
        });
        return;
      }
      if (j.ok) {
        setMsg({
          type: "ok",
          text: `Reachable via DCT proxy: ${j.url} → HTTP ${j.status}`,
        });
      } else {
        setMsg({ type: "err", text: `HTTP ${j.status} from ${j.url}` });
      }
    } catch (e) {
      setMsg({
        type: "err",
        text:
          e.message ||
          `Could not reach DCT server at ${DCT_API_BASE} (start with: cd server && npm start).`,
      });
    } finally {
      setTesting(false);
    }
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-nb-ink/60 font-display font-semibold">
        <Loader2 className="w-5 h-5 animate-spin text-nb-accent-2" />
        Loading layer snapshot…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px]">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="nb-pill-accent text-[10px]">
              Normal mode
            </span>
            <span className="text-[10px] text-nb-ink/50 font-display font-semibold">Operator console</span>
          </div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2 text-nb-ink">
            <LayoutGrid className="w-7 h-7 text-nb-accent-2" />
            Layer console
          </h1>
          <p className="text-sm text-nb-ink/60 mt-1 max-w-xl">
            <span className="font-display font-semibold text-nb-ink/80">DCT live demo</span> runs on the{" "}
            <span className="font-mono text-nb-ink/70">Live</span> page (chain, delegations, payments, TLS, trust).
            OpenClaw tools below are optional. Workflow snapshot syncs to the API; tokens stay in localStorage only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="button"
            onClick={() => {
              setPendingLiveDemoE2E();
              navigate("/live-demo");
            }}
            className="nb-btn-primary text-sm"
            title="Opens Live and auto-runs the full 12-phase E2E (same as Run full E2E workflow there)"
          >
            <Workflow className="w-4 h-4" />
            Run DCT live demo
          </button>
          <button
            type="button"
            onClick={handleAutofillDemo}
            disabled={chainBusy}
            className="nb-btn-ghost text-sm"
            title="Fills from client/src/lib/layerDemoDefaults.js (optional VITE_LAYER_* overrides)"
          >
            <Wand2 className="w-4 h-4" />
            Autofill demo
          </button>
          <button
            type="button"
            onClick={handleTestOpenClaw}
            disabled={testing || chainBusy}
            className="nb-btn-ghost text-sm"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Test /health
          </button>
          <button
            type="button"
            onClick={handleRunChainDemo}
            disabled={chainBusy || testing}
            className="nb-btn-secondary text-sm"
          >
            {chainBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run OpenClaw chain
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="nb-btn-secondary text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save to layer
          </button>
        </div>
      </header>

      {chainLog.length > 0 && (
        <div className="rounded-nb border-2 border-nb-ink bg-nb-card p-3 font-mono text-[11px] text-nb-ink/90 max-h-48 overflow-y-auto whitespace-pre-wrap">
          {chainLog.join("\n")}
        </div>
      )}

      {msg && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-start gap-2 rounded-nb px-4 py-3 text-sm border-2 border-nb-ink font-display font-semibold ${
            msg.type === "ok"
              ? "bg-nb-ok/15 text-nb-ok"
              : "bg-nb-error/15 text-nb-error"
          }`}
        >
          {msg.type === "ok" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{msg.text}</span>
        </motion.div>
      )}

      <div className="grid lg:grid-cols-[minmax(300px,360px)_1fr] gap-6 items-start">
        {/* OpenClaw */}
        <div className="space-y-4">
          <div className="nb-card">
            <div className="flex items-center gap-2 mb-4">
              <Server className="w-4 h-4 text-nb-accent-2" />
              <h2 className="text-sm font-display font-bold text-nb-ink">OpenClaw</h2>
            </div>
            <p className="text-[10px] text-nb-ink/50 mb-3 leading-relaxed">
              Requests are proxied through the DCT server at{" "}
              <span className="font-mono text-nb-ink/70">{DCT_API_BASE}</span> so ngrok does not need CORS.
              Start it with <span className="font-mono">cd server && npm start</span> (same host as{" "}
              <span className="font-mono">VITE_API_URL</span>).
            </p>
            <label className="block text-[10px] font-display font-bold uppercase tracking-wider text-nb-ink/50 mb-1">
              Default base URL (fallback if an agent field is empty)
            </label>
            <input
              className="nb-input font-mono mb-3"
              placeholder="https://openclaw.example.com"
              value={openClawBase}
              onChange={(e) => setOpenClawBase(e.target.value)}
            />
            <label className="block text-[10px] font-display font-bold uppercase tracking-wider text-nb-ink/50 mb-1">
              Auth
            </label>
            <select
              className="nb-select mb-3"
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value)}
            >
              <option value="none">None</option>
              <option value="bearer">Bearer token (stored locally)</option>
              <option value="mtls">mTLS client cert (PEM, local only)</option>
            </select>
            {authMode === "bearer" && (
              <>
                <label className="block text-[10px] font-display font-bold uppercase tracking-wider text-nb-ink/50 mb-1">
                  Bearer token
                </label>
                <input
                  type="password"
                  className="nb-input font-mono"
                  placeholder="Stored in localStorage only"
                  value={bearer}
                  onChange={(e) => setBearer(e.target.value)}
                />
              </>
            )}
            {authMode === "mtls" && (
              <>
                <label className="block text-[10px] font-display font-bold uppercase tracking-wider text-nb-ink/50 mb-1 mt-2">
                  Client PEM (local only)
                </label>
                <textarea
                  className="nb-input min-h-[120px] text-[11px] font-mono"
                  placeholder={"-----BEGIN CERTIFICATE-----\n…"}
                  value={pemText}
                  onChange={(e) => setPemText(e.target.value)}
                />
                <p className="text-[10px] text-nb-ink/50 mt-2 leading-relaxed">
                  Browsers cannot attach PEM to fetch() easily — use a same-origin proxy or your DCT
                  server to bridge OpenClaw. This field is only stored in your browser.
                </p>
              </>
            )}
          </div>

          {/* Inspector */}
          <div className="nb-card">
            <h2 className="text-sm font-display font-bold mb-3 text-nb-ink">Selected node</h2>
            {!selectedAgent && (
              <p className="text-xs text-nb-ink/50">
                Click an agent node to edit limits, or add a new agent below the canvas.
              </p>
            )}
            {selectedAgent && (
              <div className="space-y-3 text-sm">
                <div>
                  <label className="text-[10px] font-display font-bold uppercase text-nb-ink/50">Name</label>
                  <input
                    className="nb-input mt-1"
                    value={selectedAgent.data?.title ?? ""}
                    onChange={(e) => patchAgent({ title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-display font-bold uppercase text-nb-ink/50">
                    Spend cap (µUSDC, 6 decimals)
                  </label>
                  <input
                    type="number"
                    className="nb-input mt-1 font-mono"
                    value={selectedAgent.data?.spendLimitUsdc ?? 0}
                    onChange={(e) =>
                      patchAgent({ spendLimitUsdc: Number(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-display font-bold uppercase text-nb-ink/50">Max depth</label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      className="nb-input mt-1"
                      value={selectedAgent.data?.maxDepth ?? 3}
                      onChange={(e) =>
                        patchAgent({ maxDepth: Number(e.target.value) || 1 })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-display font-bold uppercase text-nb-ink/50">Expires (h)</label>
                    <input
                      type="number"
                      min={1}
                      className="nb-input mt-1"
                      value={selectedAgent.data?.expiresHours ?? 24}
                      onChange={(e) =>
                        patchAgent({ expiresHours: Number(e.target.value) || 1 })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-display font-bold uppercase text-nb-ink/50">
                    Allowed tools (comma-separated)
                  </label>
                  <input
                    className="nb-input mt-1 font-mono text-xs"
                    value={selectedAgent.data?.allowedTools ?? ""}
                    onChange={(e) => patchAgent({ allowedTools: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-display font-bold uppercase text-nb-ink/50">
                    OpenClaw base (this agent)
                  </label>
                  <input
                    className="nb-input mt-1 font-mono text-[11px]"
                    placeholder="https://….ngrok-free.dev"
                    value={selectedAgent.data?.openClawBaseUrl ?? ""}
                    onChange={(e) => patchAgent({ openClawBaseUrl: e.target.value })}
                  />
                  <p className="text-[9px] text-nb-ink/45 mt-0.5">
                    Slot <span className="font-mono">{selectedBearerKey}</span> — bearer stored locally per slot.
                  </p>
                </div>
                <div>
                  <label className="text-[10px] font-display font-bold uppercase text-nb-ink/50">Model</label>
                  <input
                    className="nb-input mt-1 font-mono text-xs"
                    value={selectedAgent.data?.openClawModel ?? "openclaw/main"}
                    onChange={(e) => patchAgent({ openClawModel: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-display font-bold uppercase text-nb-ink/50">
                    Bearer (this agent — local only)
                  </label>
                  <input
                    type="password"
                    className="nb-input mt-1 font-mono text-[11px]"
                    autoComplete="off"
                    value={slotBearerInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSlotBearerInput(v);
                      if (selectedBearerKey) setAgentBearer(selectedBearerKey, v);
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handlePingSelectedAgent}
                  disabled={testing || chainBusy}
                  className="nb-btn-ghost text-xs w-full"
                >
                  {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : null}{" "}
                  Ping chat (this agent)
                </button>
                <button
                  type="button"
                  onClick={removeSelected}
                  className="inline-flex items-center gap-2 text-xs font-display font-semibold text-nb-error hover:text-nb-error/80"
                >
                  <Trash2 className="w-3 h-3" /> Remove node
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-display font-bold text-nb-ink/60">Delegation workflow</h2>
            <button
              type="button"
              onClick={addAgent}
              className="nb-pill hover:bg-nb-accent/30 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add agent
            </button>
          </div>
          <LayerWorkflowCanvas
            nodes={nodes}
            setNodes={setNodes}
            edges={edges}
            setEdges={setEdges}
            onSelectNodeId={setSelectedId}
          />
          <p className="text-[10px] text-nb-ink/50 leading-relaxed">
            Drag and connect nodes. <strong className="text-nb-ink/70">Save to layer</strong> only persists the canvas JSON
            (plus default OpenClaw URL) — it does <strong className="text-nb-ink/70">not</strong> bind agent identity or enforce
            scopes on-chain. Those limits are a design record until you run delegation via the{" "}
            <strong className="text-nb-ink/70">Live</strong> demo or SDK. Nothing else reads this file today except this page
            on load.
          </p>
        </div>
      </div>
    </div>
  );
}
