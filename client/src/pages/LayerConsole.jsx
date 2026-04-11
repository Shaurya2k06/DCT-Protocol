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
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin text-[hsl(199,89%,48%)]" />
        Loading layer snapshot…
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1200px]">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              Normal mode
            </span>
            <span className="text-[10px] text-muted-foreground">Operator console</span>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutGrid className="w-7 h-7 text-[hsl(199,89%,48%)]" />
            Layer console
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Connect OpenClaw, design an agent workflow with spend and tool limits, then save.
            The graph is stored on the DCT API; secrets never leave this browser.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleTestOpenClaw}
            disabled={testing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl glass text-sm text-muted-foreground hover:text-foreground border border-white/10"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Test /health
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[hsl(199,89%,48%)]/20 text-[hsl(199,89%,48%)] border border-[hsl(199,89%,48%)]/40 hover:bg-[hsl(199,89%,48%)]/30 text-sm font-medium"
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
          className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm border ${
            msg.type === "ok"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
              : "bg-red-500/10 border-red-500/30 text-red-200"
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
          <div className="glass rounded-2xl border border-white/10 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Server className="w-4 h-4 text-[hsl(199,89%,48%)]" />
              <h2 className="text-sm font-semibold">OpenClaw</h2>
            </div>
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Base URL
            </label>
            <input
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm font-mono mb-3"
              placeholder="https://openclaw.example.com"
              value={openClawBase}
              onChange={(e) => setOpenClawBase(e.target.value)}
            />
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Auth
            </label>
            <select
              className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm mb-3"
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value)}
            >
              <option value="none">None</option>
              <option value="bearer">Bearer token (stored locally)</option>
              <option value="mtls">mTLS client cert (PEM, local only)</option>
            </select>
            {authMode === "bearer" && (
              <>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Bearer token
                </label>
                <input
                  type="password"
                  className="w-full rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-sm font-mono"
                  placeholder="Stored in localStorage only"
                  value={bearer}
                  onChange={(e) => setBearer(e.target.value)}
                />
              </>
            )}
            {authMode === "mtls" && (
              <>
                <label className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1 mt-2">
                  Client PEM (local only)
                </label>
                <textarea
                  className="w-full min-h-[120px] rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-[11px] font-mono"
                  placeholder={"-----BEGIN CERTIFICATE-----\n…"}
                  value={pemText}
                  onChange={(e) => setPemText(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                  Browsers cannot attach PEM to fetch() easily — use a same-origin proxy or your DCT
                  server to bridge OpenClaw. This field is only stored in your browser.
                </p>
              </>
            )}
          </div>

          {/* Inspector */}
          <div className="glass rounded-2xl border border-white/10 p-5">
            <h2 className="text-sm font-semibold mb-3">Selected node</h2>
            {!selectedAgent && (
              <p className="text-xs text-muted-foreground">
                Click an agent node to edit limits, or add a new agent below the canvas.
              </p>
            )}
            {selectedAgent && (
              <div className="space-y-3 text-sm">
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">Name</label>
                  <input
                    className="w-full mt-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2"
                    value={selectedAgent.data?.title ?? ""}
                    onChange={(e) => patchAgent({ title: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">
                    Spend cap (µUSDC, 6 decimals)
                  </label>
                  <input
                    type="number"
                    className="w-full mt-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2 font-mono"
                    value={selectedAgent.data?.spendLimitUsdc ?? 0}
                    onChange={(e) =>
                      patchAgent({ spendLimitUsdc: Number(e.target.value) || 0 })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase text-muted-foreground">Max depth</label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      className="w-full mt-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2"
                      value={selectedAgent.data?.maxDepth ?? 3}
                      onChange={(e) =>
                        patchAgent({ maxDepth: Number(e.target.value) || 1 })
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-muted-foreground">Expires (h)</label>
                    <input
                      type="number"
                      min={1}
                      className="w-full mt-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2"
                      value={selectedAgent.data?.expiresHours ?? 24}
                      onChange={(e) =>
                        patchAgent({ expiresHours: Number(e.target.value) || 1 })
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-muted-foreground">
                    Allowed tools (comma-separated)
                  </label>
                  <input
                    className="w-full mt-1 rounded-lg bg-black/30 border border-white/10 px-3 py-2 font-mono text-xs"
                    value={selectedAgent.data?.allowedTools ?? ""}
                    onChange={(e) => patchAgent({ allowedTools: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  onClick={removeSelected}
                  className="inline-flex items-center gap-2 text-xs text-red-400 hover:text-red-300"
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
            <h2 className="text-sm font-semibold text-muted-foreground">Delegation workflow</h2>
            <button
              type="button"
              onClick={addAgent}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10"
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
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Drag nodes, connect Entry → agents → downstream agents. Limits map to Biscuit / DCT scope
            when you run delegation from the server or SDK.
          </p>
        </div>
      </div>
    </div>
  );
}
