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
  LayoutGrid, Server, Play, Wand2, Workflow, Shield, TrendingUp,
  ExternalLink,
} from "lucide-react";
import LayerWorkflowCanvas from "../components/layer/LayerWorkflowCanvas";
import {
  getLayerSnapshot,
  saveLayerSnapshot,
  applyLayerOnChain,
  proveTlsn,
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
import { BTC_TLS_DEMO_URL } from "../lib/btcTlsOpenClaw.js";

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

const BASESCAN_TX = "https://sepolia.basescan.org/tx/";

/** Expected phases while POST /api/layer/apply is in flight (server runs these sequentially). */
const APPLY_EXPECTED_PHASES = [
  "ERC-8004 · register orchestrator, research, payment (3 transactions)",
  "Root Biscuit · mint off-chain root token + scope",
  "DCTRegistry · delegate() Orchestrator → Research",
  "DCTRegistry · delegate() Research → Payment",
];

function shortHash(h) {
  if (!h || typeof h !== "string") return "—";
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}

function TxHashLink({ hash, className = "" }) {
  if (!hash) return null;
  return (
    <a
      href={`${BASESCAN_TX}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 font-mono text-[11px] text-nb-accent-2 hover:underline ${className}`}
      title={hash}
    >
      {shortHash(hash)}
      <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
    </a>
  );
}

/** @param {Record<string, unknown>} s */
function describeApplyStep(s) {
  const step = s.step;
  if (step === "erc8004.register") {
    return {
      title: `ERC-8004 register · ${s.slot}`,
      lines: [
        `Agent ID ${s.agentId}`,
        s.blockNumber != null ? `Block ${s.blockNumber}` : null,
      ].filter(Boolean),
      txHash: s.txHash ?? null,
    };
  }
  if (step === "biscuit.root") {
    return {
      title: "Root Biscuit minted (off-chain)",
      lines: [
        s.revocationId ? `revocationId ${String(s.revocationId).slice(0, 24)}…` : null,
        s.scopeHash ? `scopeHash ${String(s.scopeHash).slice(0, 20)}…` : null,
      ].filter(Boolean),
      txHash: null,
    };
  }
  if (step === "delegate.O_to_R") {
    return {
      title: "DCTRegistry · delegate Orchestrator → Research",
      lines: [
        s.childRevocationId
          ? `Child revocationId ${String(s.childRevocationId).slice(0, 20)}…`
          : null,
      ].filter(Boolean),
      txHash: s.txHash,
    };
  }
  if (step === "delegate.R_to_P") {
    return {
      title: "DCTRegistry · delegate Research → Payment",
      lines: [
        s.childRevocationId
          ? `Child revocationId ${String(s.childRevocationId).slice(0, 20)}…`
          : null,
      ].filter(Boolean),
      txHash: s.txHash,
    };
  }
  return {
    title: String(step || "step"),
    lines: [JSON.stringify(s)],
    txHash: s.txHash ?? null,
  };
}

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
  /** TLSNotary (BTC API) + OpenClaw interpretation log */
  const [tlsBtcLog, setTlsBtcLog] = useState([]);
  const [btcTlsBusy, setBtcTlsBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  /** From POST /api/layer/apply + snapshot — ERC-8004 id + OpenClaw URL per slot */
  const [layerBindings, setLayerBindings] = useState(null);
  const [appliedAt, setAppliedAt] = useState(null);
  const [applying, setApplying] = useState(false);
  /** Register & delegate: running | completed steps + tx hashes | error */
  const [applyRun, setApplyRun] = useState(null);

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
        setLayerBindings(s.agentBindings ?? null);
        setAppliedAt(s.appliedAt ?? null);
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

  const handleBtcTlsOpenClaw = async () => {
    persistLocalSecrets();
    setBtcTlsBusy(true);
    setTlsBtcLog([]);
    setMsg(null);
    try {
      setTlsBtcLog((l) => [
        ...l,
        `→ TLSNotary: GET ${BTC_TLS_DEMO_URL}`,
        "  (DCT server runs MPC-TLS prover — needs TLSN_PROVER_URL + notary)",
      ]);
      const tls = await proveTlsn({
        url: BTC_TLS_DEMO_URL,
        toolName: "web_fetch",
        method: "GET",
      });
      const preview = String(tls.proof?.responsePreview ?? "").slice(0, 2_500);
      const sh = tls.proof?.sessionHash;
      const shortHash = sh && typeof sh === "string" ? `${sh.slice(0, 18)}…` : "—";
      setTlsBtcLog((l) => [
        ...l,
        `✓ TLS verified · HTTP ${tls.proof?.statusCode ?? "?"} · session ${shortHash}`,
        `  backend: ${tls.proof?.backend ?? "?"} · oracle ${tls.oracle ? String(tls.oracle).slice(0, 14) + "…" : "—"}`,
        `  response preview (truncated):\n${preview.slice(0, 800)}${preview.length > 800 ? "…" : ""}`,
      ]);

      const ordered = orderWorkflowAgents(nodes, edges);
      const research =
        ordered.find((a) => a.data?.agentSlot === "research") || ordered[0];
      if (!research) {
        throw new Error("Add at least one agent node (prefer Research) with OpenClaw URL + bearer.");
      }
      const { base, bearer: tok, model } = resolveAgentConnection(research);
      if (!base) throw new Error("Set OpenClaw base URL for the research agent (or global default).");
      if (!tok) throw new Error("Set bearer token for that agent.");

      const prompt = [
        "You are a research agent. The following HTTP response was fetched over real TLS and verified by TLSNotary on the DCT server (session hash attested for DCTEnforcer).",
        "",
        "Verified response body:",
        preview || "(empty)",
        "",
        "Reply in 2–3 sentences: current Bitcoin price in USD if present in the JSON (e.g. bitcoin.usd from CoinGecko), and note that the TLS session was proved, not hallucinated.",
      ].join("\n");

      setTlsBtcLog((l) => [...l, "", `→ OpenClaw (${research.data?.title || "agent"}): summarize verified data…`]);
      const chat = await postOpenClawChat({
        baseUrl: base,
        bearer: tok,
        model,
        messages: [{ role: "user", content: prompt }],
      });
      const reply = pickAssistantText(chat);
      setTlsBtcLog((l) => [...l, `← OpenClaw: ${reply}`]);
      setMsg({
        type: "ok",
        text: "TLSNotary proof + OpenClaw interpretation complete. Use Live demo for on-chain enforcer + same attestation.",
      });
    } catch (e) {
      const err =
        e?.response?.data?.error ||
        e?.message ||
        String(e);
      setTlsBtcLog((l) => [...l, "", `✗ ${err}`]);
      setMsg({
        type: "err",
        text:
          err +
          (String(err).includes("TLSN_PROVER_URL") || String(err).includes("prover")
            ? " — set TLSN_PROVER_URL in server/.env and run `cd server && npm run tlsn-prover` (see docs/LOCAL_DEV.md)."
            : ""),
      });
    } finally {
      setBtcTlsBusy(false);
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
        agentBindings: layerBindings,
        appliedAt,
      });
      setMsg({
        type: "ok",
        text:
          layerBindings
            ? "Saved layout + on-chain agent bindings (orchestrator / research / payment) to the server. PEM / bearer stayed in this browser."
            : "Saved layout only (server/data/layer-snapshot.json). Use Register & delegate on-chain to bind ERC-8004 ids + DCT delegations. PEM / bearer stayed in this browser.",
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

  const handleApplyOnChain = async () => {
    persistLocalSecrets();
    setApplying(true);
    setMsg(null);
    setApplyRun({ phase: "running" });
    try {
      const r = await applyLayerOnChain({
        workflow: { nodes, edges },
        openClaw: { baseUrl: openClawBase.trim() },
      });
      const steps = Array.isArray(r.steps) ? r.steps : [];
      setApplyRun({
        phase: "done",
        steps,
        appliedAt: r.appliedAt ?? null,
      });
      setLayerBindings(r.agentBindings ?? null);
      setAppliedAt(r.appliedAt ?? null);
      await saveLayerSnapshot({
        version: 1,
        openClaw: { baseUrl: openClawBase.trim(), authMode },
        workflow: { nodes, edges },
        agentBindings: r.agentBindings ?? null,
        appliedAt: r.appliedAt ?? null,
      });
      const b = r.agentBindings;
      setMsg({
        type: "ok",
        text: b
          ? `On-chain: ERC-8004 #${b.orchestrator?.agentId} / #${b.research?.agentId} / #${b.payment?.agentId} · Biscuit root + DCTRegistry O→R→P. Saved with bindings.`
          : "Apply returned no bindings.",
      });
    } catch (e) {
      const errText =
        e.response?.data?.error || e.message || "Apply failed (need PRIVATE_KEY + contracts on server)";
      setApplyRun({ phase: "error", error: errText });
      setMsg({
        type: "err",
        text: errText,
      });
    } finally {
      setApplying(false);
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
    <div className="w-full max-w-[min(100%,1680px)] mx-auto space-y-5">
      <header className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="nb-pill-accent text-[10px]">Normal mode</span>
              <span className="text-[10px] text-nb-ink/50 font-display font-semibold">Operator console</span>
            </div>
            <h1 className="text-2xl font-display font-bold flex items-center gap-2 text-nb-ink">
              <LayoutGrid className="w-7 h-7 shrink-0 text-nb-accent-2" />
              Layer console
            </h1>
            <p className="text-sm text-nb-ink/60 mt-2 max-w-2xl leading-relaxed">
              <span className="font-display font-semibold text-nb-ink/80">Register & delegate</span> maps this graph to
              ERC-8004 agent IDs (orchestrator / research / payment), mints a root Biscuit, and registers two{" "}
              <span className="font-mono">DCTRegistry</span> delegations (server wallet).{" "}
              <span className="font-display font-semibold text-nb-ink/80">Run DCT live demo</span> opens the full phased UI.
              OpenClaw is optional; tokens stay in localStorage.
            </p>
          </div>
        </div>

        {/* Actions: primary row + secondary row so the header doesn’t sprawl */}
        <div className="flex flex-col gap-2 sm:gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden sm:inline text-[10px] font-display font-bold uppercase tracking-wider text-nb-ink/40 w-full sm:w-auto sm:mr-1">
              Chain
            </span>
            <button
              type="button"
              onClick={handleApplyOnChain}
              disabled={applying || chainBusy || btcTlsBusy}
              className="nb-btn-secondary text-sm border-2 border-emerald-600/80 text-emerald-800 bg-emerald-50/80"
              title="POST /api/layer/apply — requires PRIVATE_KEY + deployed contracts"
            >
              {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              Register & delegate
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingLiveDemoE2E();
                navigate("/live-demo");
              }}
              disabled={btcTlsBusy}
              className="nb-btn-primary text-sm"
              title="Opens Live and auto-runs the full 12-phase E2E"
            >
              <Workflow className="w-4 h-4" />
              Run DCT live demo
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || applying}
              className="nb-btn-secondary text-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save layout
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-nb-ink/10 pt-2 sm:border-t-0 sm:pt-0">
            <span className="hidden sm:inline text-[10px] font-display font-bold uppercase tracking-wider text-nb-ink/40 w-full sm:w-auto sm:mr-1">
              OpenClaw & demos
            </span>
            <button
              type="button"
              onClick={handleAutofillDemo}
              disabled={chainBusy || btcTlsBusy}
              className="nb-btn-ghost text-sm"
              title="Fills from client/src/lib/layerDemoDefaults.js (optional VITE_LAYER_* overrides)"
            >
              <Wand2 className="w-4 h-4" />
              Autofill demo
            </button>
            <button
              type="button"
              onClick={handleTestOpenClaw}
              disabled={testing || chainBusy || btcTlsBusy}
              className="nb-btn-ghost text-sm"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Test /health
            </button>
            <button
              type="button"
              onClick={handleRunChainDemo}
              disabled={chainBusy || testing || btcTlsBusy}
              className="nb-btn-secondary text-sm"
            >
              {chainBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run OpenClaw chain
            </button>
            <button
              type="button"
              onClick={handleBtcTlsOpenClaw}
              disabled={btcTlsBusy || chainBusy || testing || applying}
              className="nb-btn-secondary text-sm border-2 border-sky-600/50 bg-sky-50/80 text-sky-950"
              title={`TLSNotary GET ${BTC_TLS_DEMO_URL} via DCT server, then OpenClaw (research agent)`}
            >
              {btcTlsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              BTC + TLS + OpenClaw
            </button>
          </div>
        </div>
      </header>

      {layerBindings && (
        <div className="rounded-nb border-2 border-emerald-600/40 bg-emerald-50/40 px-4 py-3 text-[11px] font-mono text-nb-ink">
          <p className="font-display font-bold text-nb-ink mb-2">
            On-chain bindings{appliedAt ? ` · ${appliedAt}` : ""}
          </p>
          {(["orchestrator", "research", "payment"]).map((slot, idx) => {
            const b = layerBindings[slot];
            if (!b) return null;
            return (
              <div
                key={slot}
                className={`flex flex-wrap gap-x-4 gap-y-0.5 pt-1.5 ${idx > 0 ? "border-t border-emerald-600/20" : ""}`}
              >
                <span className="w-28 shrink-0 text-nb-ink/60 capitalize">{slot}</span>
                <span>agent #{b.agentId}</span>
                {b.openClawBaseUrl ? (
                  <span className="text-emerald-900/90 truncate max-w-[min(100%,280px)]" title={b.openClawBaseUrl}>
                    OpenClaw {b.openClawBaseUrl.replace(/^https?:\/\//, "")}
                  </span>
                ) : (
                  <span className="text-nb-ink/45">OpenClaw —</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {(applying || applyRun) && (
        <div className="rounded-nb border-2 border-nb-ink bg-nb-card p-4 shadow-nb-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="font-display font-bold text-sm text-nb-ink flex items-center gap-2">
              {applyRun?.phase === "running" || applying ? (
                <Loader2 className="w-4 h-4 animate-spin text-nb-accent-2 shrink-0" />
              ) : applyRun?.phase === "done" ? (
                <CheckCircle2 className="w-4 h-4 text-nb-ok shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-nb-error shrink-0" />
              )}
              Register & delegate — on-chain process
            </p>
            {applyRun?.phase === "done" && applyRun.appliedAt && (
              <span className="text-[10px] font-mono text-nb-ink/50">{applyRun.appliedAt}</span>
            )}
          </div>

          {applyRun?.phase === "running" && (
            <div className="space-y-3">
              <p className="text-xs text-nb-ink/70 leading-relaxed">
                Submitting transactions on <span className="font-semibold">Base Sepolia</span> via the DCT server.
                This usually takes tens of seconds (multiple confirmations).
              </p>
              <ul className="space-y-2 border-l-2 border-nb-accent-2/40 pl-3">
                {APPLY_EXPECTED_PHASES.map((line) => (
                  <li
                    key={line}
                    className="text-[11px] font-mono text-nb-ink/65 animate-pulse"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {applyRun?.phase === "error" && (
            <div className="space-y-2">
              <p className="text-xs text-nb-error font-mono leading-relaxed break-all">{applyRun.error}</p>
              {/429|compute units|alchemy|throughput|capacity/i.test(applyRun.error || "") && (
                <p className="text-[10px] text-nb-ink/65 leading-relaxed font-display">
                  Your RPC endpoint (often Alchemy free tier) is rate-limiting bursts of transactions. The server spaces
                  layer txs and retries JSON-RPC — try raising{" "}
                  <span className="font-mono text-nb-ink/80">LAYER_APPLY_TX_GAP_MS</span> in{" "}
                  <span className="font-mono">server/.env</span>, increase{" "}
                  <span className="font-mono text-nb-ink/80">RPC_HTTP_*</span> retries, or use a higher-throughput RPC URL
                  (e.g. Infura).
                </p>
              )}
            </div>
          )}

          {applyRun?.phase === "done" && Array.isArray(applyRun.steps) && (
            <ol className="space-y-4">
              {applyRun.steps.map((raw, idx) => {
                const s = describeApplyStep(raw);
                return (
                  <li
                    key={`${s.title}-${idx}`}
                    className="border-l-2 border-nb-ink pl-3 pb-1 last:pb-0"
                  >
                    <p className="text-[11px] font-display font-bold text-nb-ink">
                      {idx + 1}. {s.title}
                    </p>
                    {s.lines?.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {s.lines.map((line, li) => (
                          <li key={`${idx}-${li}`} className="text-[10px] font-mono text-nb-ink/70 break-all">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.txHash && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                        <span className="text-nb-ink/50 font-display font-semibold uppercase tracking-wide">
                          Tx
                        </span>
                        <TxHashLink hash={s.txHash} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {applyRun?.phase === "done" && (!applyRun.steps || applyRun.steps.length === 0) && (
            <p className="text-xs text-nb-ink/60">Apply finished but no step log was returned (unexpected).</p>
          )}
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

      {/* Workflow first (primary), config + inspector docked on the right (desktop) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:items-start">
        {/* Canvas — main workspace (first column on desktop, below forms on mobile) */}
        <div className="space-y-3 min-w-0 order-2 lg:order-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-display font-bold text-nb-ink">Delegation workflow</h2>
            <button
              type="button"
              onClick={addAgent}
              className="nb-pill hover:bg-nb-accent/30 transition-colors cursor-pointer self-start sm:self-auto"
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
            <strong className="text-nb-ink/70">Register & delegate on-chain</strong> enforces this graph: three ERC-8004
            registrations, root Biscuit, and <span className="font-mono">registerDelegation</span> O→R and R→P.{" "}
            <strong className="text-nb-ink/70">Save layout</strong> persists JSON + any bindings from a prior apply.
          </p>
        </div>

        {/* OpenClaw + inspector — first on mobile; right column + sticky on large screens */}
        <div className="space-y-4 min-w-0 order-1 lg:order-2 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className="nb-card">
            <div className="flex items-center gap-2 mb-4">
              <Server className="w-4 h-4 text-nb-accent-2" />
              <h2 className="text-sm font-display font-bold text-nb-ink">OpenClaw</h2>
            </div>
            <p className="text-[10px] text-nb-ink/50 mb-3 leading-relaxed">
              Requests are proxied through the DCT server at{" "}
              <span className="font-mono text-nb-ink/70">{DCT_API_BASE}</span> so ngrok does not need CORS.
              <span className="font-semibold text-nb-ink/70"> BTC + TLS + OpenClaw</span> runs a real{" "}
              <span className="font-mono">POST /api/tlsn/prove</span> against a Bitcoin price URL, then sends the verified body
              to your Research agent. Requires <span className="font-mono">TLSN_PROVER_URL</span> on the server.
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
                Click an agent on the graph to edit limits, or use <span className="font-semibold text-nb-ink/70">Add agent</span> in the workflow header.
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
                  disabled={testing || chainBusy || btcTlsBusy}
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
      </div>

      {/* Activity output below the workspace so the graph stays near the top */}
      {chainLog.length > 0 && (
        <div className="rounded-nb border-2 border-nb-ink bg-nb-card p-3 font-mono text-[11px] text-nb-ink/90 max-h-48 overflow-y-auto whitespace-pre-wrap">
          <p className="font-display font-bold text-nb-ink/70 mb-2 text-[10px] uppercase tracking-wide">
            OpenClaw chain log
          </p>
          {chainLog.join("\n")}
        </div>
      )}

      {tlsBtcLog.length > 0 && (
        <div className="rounded-nb border-2 border-sky-600/40 bg-sky-50/50 p-3 font-mono text-[11px] text-nb-ink/90 max-h-64 overflow-y-auto whitespace-pre-wrap">
          <p className="font-display font-bold text-sky-900/90 mb-2 text-[10px] uppercase tracking-wide">
            TLSNotary + OpenClaw (BTC)
          </p>
          {tlsBtcLog.join("\n")}
        </div>
      )}
    </div>
  );
}
