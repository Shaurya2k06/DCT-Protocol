/**
 * Layer Console — "normal mode" operator UI: OpenClaw connection + n8n-style workflow
 * with per-agent limits. Saved graph is persisted server-side (metadata only); PEM/bearer
 * stay in the browser (localStorage).
 */

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Save, Plus, Trash2, Link2, Loader2, CheckCircle2, AlertCircle,
  LayoutGrid, Server,
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
} from "../lib/layerLocal";

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
    position: { x: 200, y: 180 },
    data: {
      title: "Orchestrator",
      spendLimitUsdc: 50_000_000,
      maxDepth: 3,
      allowedTools: "research,web_fetch,x402_pay",
      expiresHours: 168,
    },
  },
  {
    id: "dc-a2",
    type: "dctAgent",
    position: { x: 200, y: 380 },
    data: {
      title: "Worker",
      spendLimitUsdc: 10_000_000,
      maxDepth: 2,
      allowedTools: "web_fetch",
      expiresHours: 72,
    },
  },
];

const DEFAULT_EDGES = [
  { id: "e1", source: "dc-root", target: "dc-a1", animated: true },
  { id: "e2", source: "dc-a1", target: "dc-a2", animated: true },
];

export default function LayerConsole() {
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
          setNodes(s.workflow.nodes);
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
      setMsg({ type: "ok", text: "Saved — workflow metadata is on the DCT server. PEM / bearer stayed in this browser only." });
    } catch (e) {
      setMsg({
        type: "err",
        text: e.response?.data?.error || e.message || "Save failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestOpenClaw = async () => {
    const base = openClawBase.trim().replace(/\/$/, "");
    if (!base) {
      setMsg({ type: "err", text: "Set an OpenClaw base URL first." });
      return;
    }
    setTesting(true);
    setMsg(null);
    try {
      const url = `${base}/health`;
      const r = await fetch(url, { method: "GET", mode: "cors" });
      if (r.ok) {
        setMsg({ type: "ok", text: `Reachable: ${url} (${r.status})` });
      } else {
        setMsg({ type: "err", text: `HTTP ${r.status} from ${url}` });
      }
    } catch {
      setMsg({
        type: "err",
        text:
          "Could not reach OpenClaw (CORS, TLS, or offline). For mTLS, use a local proxy or server-side bridge — PEM is kept in the browser only.",
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
            Connect OpenClaw, design an agent workflow with spend and tool limits, then save.
            The graph is stored on the DCT API; secrets never leave this browser.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleTestOpenClaw}
            disabled={testing}
            className="nb-btn-ghost text-sm"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Test /health
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
            <label className="block text-[10px] font-display font-bold uppercase tracking-wider text-nb-ink/50 mb-1">
              Base URL
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
            Drag nodes, connect Entry → agents → downstream agents. Limits map to Biscuit / DCT scope
            when you run delegation from the server or SDK.
          </p>
        </div>
      </div>
    </div>
  );
}
