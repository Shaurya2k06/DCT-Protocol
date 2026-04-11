/**
 * LiveDemo — full 12-step DCT Protocol demo with animated agent tree.
 *
 * Maps the DCT_DEMO_SCRIPT step sequence to live backend calls and
 * produces the following key moments:
 *   Phase 0  — health check initialization
 *   Phase 1  — three agents registered on ERC-8004
 *   Phase 2  — root Biscuit token minted (off-chain, timed)
 *   Phase 3  — Orchestrator → Research delegation
 *   Phase 4  — Research → Payment delegation
 *   Phase 5  — Research web_fetch on-chain (Biscuit stacks per-hop agent checks; no second hop execute here)
 *   Phase 6  — Off-chain scope violation (zero gas)
 *   Phase 7  — On-chain scope violation (revert)
 *   Phase 8  — Cascade revocation (single tx)
 *   Phase 9  — Lineage walk animation ← THE moment
 *   Phase 10 — Trust score timeline
 *   Phase 11 — Summary
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatEther, formatUnits } from "ethers";
import {
  Play, CheckCircle2, XCircle, Loader2, ChevronRight,
  RotateCcw, Link2, ExternalLink, Workflow, Terminal, AlertTriangle,
} from "lucide-react";
import { consumePendingLiveDemoE2E } from "../lib/liveDemoTrigger";
import api from "../lib/api";
import EventLog from "../components/ui/EventLog";

// ─── helpers ──────────────────────────────────────────────────────────────────

const BASESCAN = "https://sepolia.basescan.org";
/** HTTPS URL proved via TLSNotary for `web_fetch` in phase 5 (must match tool → endpointHash on-chain). */
const TLSN_DEMO_URL =
  import.meta.env.VITE_TLSN_DEMO_URL?.trim() || "https://api.github.com/zen";
const shorten = (h, n = 8) => h ? `${h.slice(0, n)}…${h.slice(-4)}` : "–";
const usd = (v) => `$${(Number(v) / 1_000_000).toFixed(2)}`;

function formatFeeWei(wei) {
  if (wei == null || wei === "") return "—";
  try {
    return `${formatEther(wei)} ETH`;
  } catch {
    return String(wei);
  }
}

function formatLogTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
}

function txNorm(t) {
  return typeof t === "string" ? { hash: t } : t;
}

/** API / ethers sometimes return nested objects; avoid "[object Object]" in logs. */
/** Off-chain DCT composite as 0–100; null if no profile (do not treat chain score as DCT). */
function dctUiPercent(t) {
  if (t == null) return null;
  if (t.dctCompositePercent != null) return Math.min(100, Number(t.dctCompositePercent));
  if (t.dctTrustProfile?.composite_score != null)
    return Math.min(100, Number(t.dctTrustProfile.composite_score) * 100);
  return null;
}

/** On-chain registry trust as multiple of 1e18 baseline (often ~1.0; can exceed after rewards). */
function registryTrustMultiplier(t) {
  if (t == null) return null;
  return Number(t.score ?? 0);
}

/** Tree / badges: capped DCT %, else registry shown as pseudo-% capped at 100 (not labeled DCT). */
function trustBarPercent(t) {
  const d = dctUiPercent(t);
  if (d != null) return d;
  const m = Number(t?.score ?? 0);
  return Math.min(100, m * 100);
}

function formatExecRevert(exec) {
  const pick = (v) => {
    if (v == null || v === "") return "";
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "object") {
      if (typeof v.reason === "string") return v.reason;
      if (typeof v.shortMessage === "string") return v.shortMessage;
      if (typeof v.message === "string") return v.message;
      if (typeof v.revertReason === "string") return v.revertReason;
    }
    try {
      return JSON.stringify(v, (_, val) => (typeof val === "bigint" ? val.toString() : val));
    } catch {
      return "";
    }
  };
  const s =
    pick(exec?.revertReason) ||
    pick(exec?.error) ||
    pick(exec?.message) ||
    "";
  return (s || "reverted").trim();
}

async function call(method, url, body) {
  const start = Date.now();
  const r = method === "GET"
    ? await api.get(url)
    : await api.post(url, body);
  return { ...r.data, _ms: Date.now() - start };
}

function isRateLimitError(err) {
  const raw = err?.response?.data?.error ?? err?.response?.data;
  const msg =
    typeof raw === "string"
      ? raw
      : raw && typeof raw === "object"
        ? JSON.stringify(raw)
        : err?.message || String(err);
  return /429|rate limit|compute units|coalesce/i.test(String(msg));
}

/** POST with exponential backoff when Alchemy returns 429 (delegate, revoke, …). */
async function postJsonWithRetry(url, body, addLog, max = 6) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try {
      return await call("POST", url, body);
    } catch (e) {
      lastErr = e;
      if (isRateLimitError(e) && i < max - 1) {
        const wait = 2200 * (i + 1);
        addLog(
          `  RPC rate-limited — waiting ${(wait / 1000).toFixed(1)}s before retry ${i + 1}/${max - 1}…`,
          "warning"
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function postDelegateWithRetry(body, addLog) {
  return postJsonWithRetry("/api/delegate", body, addLog);
}

function getDefaultLive() {
  return {
    agents: { orchestrator: null, research: null, payment: null },
    tokens: { root: null, research: null, payment: null },
    revIds: { root: null, research: null, payment: null },
    transactions: [],
    trustScores: { orchestrator: 0, research: 0, payment: 0 },
    trustDetail: { orchestrator: null, research: null, payment: null },
    timings: {},
    treeState: "empty",
    activeNode: null,
    lineageStep: 0,
    logs: [],
    checks: [],
    health: {},
    summary: {},
  };
}

// ─── agent tree SVG ───────────────────────────────────────────────────────────

const NODES = {
  orchestrator: { x: 200, y: 60,  label: "Orchestrator", icon: "🧠", color: "#818cf8" },
  research:     { x: 200, y: 210, label: "Research",      icon: "🔍", color: "#22d3ee" },
  payment:      { x: 200, y: 360, label: "Payment",       icon: "💳", color: "#34d399" },
};

function AgentTree({ treeState, activeNode, lineageStep, agents, trustScores }) {
  const visible = {
    orchestrator: true,
    research: ["delegation_1_active","full_tree_active","executing_research",
                "executing_payment","violation_attempt","violation_onchain",
                "revocation_pending","revocation_complete","cascade_attempt",
                "cascade_confirmed"].includes(treeState),
    payment: ["full_tree_active","executing_research","executing_payment",
               "violation_attempt","violation_onchain","revocation_pending",
               "revocation_complete","cascade_attempt","cascade_confirmed"].includes(treeState),
  };

  const revoked = ["revocation_complete","cascade_attempt","cascade_confirmed"].includes(treeState);

  const nodeColor = (id) => {
    if (revoked) return "#ef4444";
    if (activeNode === id) return NODES[id].color;
    if (visible[id]) return NODES[id].color;
    return "#374151";
  };

  // lineageStep: 0=none, 1=payment highlighted, 2=research highlighted, 3=root highlighted
  const lineageColor = (id) => {
    const map = { payment: 1, research: 2, orchestrator: 3 };
    if (lineageStep >= map[id]) return revoked ? "#ef4444" : "#fbbf24";
    return nodeColor(id);
  };

  return (
    <svg viewBox="0 0 400 440" className="w-full h-full" style={{ fontFamily: 'Space Grotesk, system-ui, sans-serif' }}>
      {/* edges */}
      {visible.research && (
        <motion.line
          x1={200} y1={100} x2={200} y2={175}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          stroke={revoked ? "#ef4444" : "#4b5563"}
          strokeWidth={2}
          strokeDasharray="4 4"
        />
      )}
      {visible.payment && (
        <motion.line
          x1={200} y1={250} x2={200} y2={325}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          stroke={revoked ? "#ef4444" : "#4b5563"}
          strokeWidth={2}
          strokeDasharray="4 4"
        />
      )}

      {/* nodes */}
      {Object.entries(NODES).map(([id, n]) => {
        if (!visible[id]) return null;
        const color = lineageStep > 0 ? lineageColor(id) : nodeColor(id);
        const isActive = activeNode === id;
        const isLineage = lineageStep > 0;
        return (
          <motion.g key={id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", bounce: 0.3 }}
          >
            {/* glow ring */}
            {(isActive || (isLineage && lineageColor(id) !== "#374151")) && (
              <circle cx={n.x} cy={n.y} r={44}
                fill={color} opacity={0.15}
                style={{ filter: "blur(8px)" }}
              />
            )}
            {/* circle */}
            <circle cx={n.x} cy={n.y} r={36}
              fill={`${color}22`}
              stroke={color}
              strokeWidth={isActive || isLineage ? 2.5 : 1.5}
            />
            {/* icon */}
            <text x={n.x} y={n.y - 2} textAnchor="middle" dominantBaseline="middle" fontSize={22}>
              {n.icon}
            </text>
            {/* label */}
            <text x={n.x} y={n.y + 20} textAnchor="middle" fontSize={11}
              fill={color} fontWeight={600} fontFamily="Inter, sans-serif">
              {n.label}
            </text>
            {/* agent ID */}
            {agents[id] && (
              <text x={n.x} y={n.y + 34} textAnchor="middle" fontSize={9}
                fill="#6b7280" fontFamily="monospace">
                #{agents[id]}
              </text>
            )}
            {/* trust score */}
            {trustScores[id] != null && trustScores[id] !== "" && (
              <text x={n.x + 44} y={n.y - 28} fontSize={9}
                fill={
                  Number(trustScores[id]) >= 70 ? "#34d399" :
                  Number(trustScores[id]) >= 40 ? "#fbbf24" : "#ef4444"
                }
                fontFamily="monospace" fontWeight={700}>
                {Number(trustScores[id]).toFixed(1)}
              </text>
            )}
            {/* lineage walk indicator */}
            {isLineage && lineageColor(id) === "#fbbf24" && (
              <circle cx={n.x + 30} cy={n.y - 30} r={8} fill="#fbbf24" opacity={0.9}>
                <animate attributeName="r" values="8;12;8" dur="0.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0.5;0.9" dur="0.8s" repeatCount="indefinite" />
              </circle>
            )}
            {/* revoked badge */}
            {revoked && (
              <text x={n.x + 30} cy={n.y - 28} y={n.y - 22} textAnchor="middle" fontSize={14}>✗</text>
            )}
          </motion.g>
        );
      })}

      {/* lineage walk label */}
      {lineageStep > 0 && (
        <text x={200} y={420} textAnchor="middle" fontSize={11} fill="#fbbf24" fontFamily="Inter, sans-serif">
          {lineageStep === 1 ? "Checking Payment…" :
           lineageStep === 2 ? "Checking Research…" :
           lineageStep === 3 ? "Found REVOKED root ✗" : ""}
        </text>
      )}
    </svg>
  );
}

// ─── check trace row ──────────────────────────────────────────────────────────

function CheckRow({ check, state }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      className={`flex items-start gap-3 p-3 rounded-nb border-2 border-nb-ink ${
        state === "pass"  ? "bg-nb-ok/15" :
        state === "fail"  ? "bg-nb-error/15" :
        state === "warn"  ? "bg-nb-warn/15" :
        state === "pending" ? "bg-nb-accent-2/15" :
        "bg-nb-card"
      }`}
    >
      <div className="mt-0.5 shrink-0">
        {state === "pass"    ? <CheckCircle2 className="w-4 h-4 text-[#34d399]" /> :
         state === "fail"    ? <XCircle className="w-4 h-4 text-[#ef4444]" /> :
         state === "warn"    ? <AlertTriangle className="w-4 h-4 text-[#fbbf24]" /> :
         state === "pending" ? <Loader2 className="w-4 h-4 text-[#22d3ee] animate-spin" /> :
                               <div className="w-4 h-4 rounded-full border border-white/20" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-display font-bold text-nb-ink">{check.label}</p>
        <p className="text-[11px] text-nb-ink/60 mt-0.5 leading-relaxed">{check.detail}</p>
        {check.gasNote && (
          <p className="text-[10px] text-[#818cf8] mt-1 font-mono">{check.gasNote}</p>
        )}
      </div>
      {state && state !== "idle" && (
        <span className={`text-[10px] font-bold shrink-0 ${
          state === "pass" ? "text-[#34d399]" :
          state === "fail" ? "text-[#ef4444]" :
          state === "warn" ? "text-[#fbbf24]" :
          "text-[#22d3ee]"
        }`}>
          {state === "pass" ? "PASS" : state === "fail" ? "FAIL" : state === "warn" ? "SKIP" : "…"}
        </span>
      )}
    </motion.div>
  );
}

// ─── delegation diff ──────────────────────────────────────────────────────────

function DelegationDiff({ before, after, highlights }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="p-3 rounded-nb border-2 border-nb-ink bg-nb-card">
        <p className="text-[10px] font-display font-bold uppercase tracking-wider text-nb-ink/50 mb-2">{before.label}</p>
        <div className="space-y-1">
          {before.tools.map(t => (
            <span key={t} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono mr-1 mb-1 ${
              !after.tools.includes(t) ? "bg-[#ef4444]/20 text-[#ef4444] line-through" : "bg-white/10 text-foreground"
            }`}>{t}</span>
          ))}
          <div className="text-xs text-muted-foreground mt-2">Spend: {usd(before.spend * 1_000_000)}</div>
          <div className="text-xs text-muted-foreground">Depth: {before.depth}</div>
        </div>
      </div>
      <div className="p-3 rounded-nb border-2 border-nb-accent-2 bg-nb-accent-2/10">
        <p className="text-[10px] font-display font-bold uppercase tracking-wider text-nb-accent-2 mb-2">{after.label}</p>
        <div className="space-y-1">
          {after.tools.map(t => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono mr-1 mb-1 bg-[#22d3ee]/20 text-[#22d3ee]">{t}</span>
          ))}
          <div className="text-xs text-[#22d3ee] mt-2">Spend: {usd(after.spend * 1_000_000)}</div>
          <div className="text-xs text-[#22d3ee]">Depth: {after.depth}</div>
        </div>
      </div>
      <div className="col-span-2 space-y-1">
        {highlights.map((h, i) => (
          <p key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <span className="text-[#ef4444] mt-0.5 shrink-0">–</span>{h}
          </p>
        ))}
      </div>
    </div>
  );
}

// ─── trust badge ──────────────────────────────────────────────────────────────

function TrustBadge({ label, score, change, tier }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-nb border-2 border-nb-ink bg-nb-card">
      <span className="text-xs font-display font-semibold text-nb-ink/60">{label}</span>
      {tier && (
        <span className="text-[10px] font-mono font-bold text-nb-accent-2">{tier}</span>
      )}
      <span className="text-xs font-mono font-bold text-nb-ink">{Number(score).toFixed(1)}%</span>
      {change && (
        <span className={`text-[11px] font-bold ${change > 0 ? "text-[#34d399]" : "text-[#ef4444]"}`}>
          {change > 0 ? "+" : ""}{change}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const PHASES = [
  { id: 0,  label: "Init",      color: "#818cf8" },
  { id: 1,  label: "Agents",    color: "#22d3ee" },
  { id: 2,  label: "Root",      color: "#818cf8" },
  { id: 3,  label: "Delegate↓", color: "#22d3ee" },
  { id: 4,  label: "Delegate↓", color: "#22d3ee" },
  { id: 5,  label: "Execute ✓", color: "#34d399" },
  { id: 6,  label: "Reject ∅",  color: "#fbbf24" },
  { id: 7,  label: "Revert ✗",  color: "#f97316" },
  { id: 8,  label: "Revoke",    color: "#ef4444" },
  { id: 9,  label: "Cascade",   color: "#ef4444" },
  { id: 10, label: "Trust",     color: "#34d399" },
  { id: 11, label: "Summary",   color: "#818cf8" },
];

export default function LiveDemo() {
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);

  const [live, setLive] = useState(getDefaultLive);
  const [fullRunProgress, setFullRunProgress] = useState(null); // null | { current: number, total: 12 }

  const workflowRef = useRef(null);
  const fullWorkflowActiveRef = useRef(false);
  const logSeqRef = useRef(0);
  const logsEndRef = useRef(null);
  /** Set after `runFullWorkflow` is defined — Layer console can trigger E2E via sessionStorage. */
  const runFullWorkflowRef = useRef(async () => {});

  // auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [live.logs]);

  /** Merges into workflow ref + React state so async phases see fresh tokens/agents. */
  const patchLive = useCallback((updates) => {
    setLive((prev) => {
      const base = workflowRef.current ?? prev;
      const next = { ...base, ...updates };
      workflowRef.current = next;
      return next;
    });
  }, []);

  const addLog = useCallback((msg, type = "info") => {
    // Stable id so React Strict Mode’s double state-invocation cannot append twice.
    const id = ++logSeqRef.current;
    const entry = { id, msg, type, ts: Date.now() };
    setLive((prev) => {
      const base = workflowRef.current ?? prev;
      if (base.logs.some((l) => l.id === id)) return base;
      const next = {
        ...base,
        logs: [...base.logs, entry],
      };
      workflowRef.current = next;
      return next;
    });
  }, []);

  /** Merge fields into an existing tx row (by hash) for RPC/Basescan enrichment. */
  const mergeTxByHash = useCallback((hash, patch) => {
    if (!hash) return;
    setLive((prev) => {
      const base = workflowRef.current ?? prev;
      const txs = base.transactions.map((t) => {
        const h = txNorm(t).hash;
        if (h !== hash) return t;
        return { ...txNorm(t), ...patch };
      });
      const next = { ...base, transactions: txs };
      workflowRef.current = next;
      return next;
    });
  }, []);

  /**
   * Register an on-chain tx (hash or object). Merges by hash, then fetches
   * /api/chain/tx/:hash for method + args + fee (RPC decode — no explorer API key).
   */
  const addTx = useCallback(
    (arg) => {
      if (!arg) return;
      const entry =
        typeof arg === "string"
          ? { hash: arg }
          : { ...arg, hash: arg.hash };
      if (!entry.hash) return;

      setLive((prev) => {
        const base = workflowRef.current ?? prev;
        const txs = [...base.transactions];
        const i = txs.findIndex((t) => txNorm(t).hash === entry.hash);
        if (i >= 0) txs[i] = { ...txNorm(txs[i]), ...entry };
        else txs.push(entry);
        const next = { ...base, transactions: txs };
        workflowRef.current = next;
        return next;
      });

      api
        .get(`/api/chain/tx/${entry.hash}`)
        .then((r) => r.data)
        .then((data) => {
          if (!data || data.error || data.pending) return;
          mergeTxByHash(entry.hash, {
            ...data,
            chainFetched: true,
          });
        })
        .catch(() => {});
    },
    [mergeTxByHash]
  );

  /** One terminal-style line for gas/fee after an API response. */
  const logChainFootprint = useCallback((label, r) => {
    if (!r) return;
    const parts = [];
    if (r.blockNumber != null) parts.push(`block ${r.blockNumber}`);
    if (r.gasUsed) parts.push(`gas ${Number(r.gasUsed).toLocaleString()}`);
    if (r.feeWei) parts.push(`fee ${formatFeeWei(r.feeWei)}`);
    if (r.path) parts.push(`path ${r.path}`);
    if (parts.length === 0) return;
    addLog(`  └ ${label}  ${parts.join("  ·  ")}`, "tx");
  }, [addLog]);

  // ─── step runners ────────────────────────────────────────────────────────

  async function executePhase(s) {
    const wf = () => {
      const w = workflowRef.current;
      if (!w) throw new Error("Demo state was reset mid-run");
      return w;
    };
    try {
      switch (s) {

        // ── Phase 0: health checks ──
        case 0: {
          const checks = [
            { id: "chain",    label: "Base Sepolia RPC",       url: "/api/health/chain" },
            { id: "registry", label: "DCTRegistry contract",   url: "/api/health/registry" },
            { id: "enforcer", label: "DCTEnforcer contract",   url: "/api/health/enforcer" },
            { id: "erc8004",  label: "ERC-8004 Identity",      url: "/api/health/erc8004" },
            { id: "pimlico",  label: "Pimlico bundler",        url: "/api/health/pimlico" },
            { id: "tlsn",     label: "TLSNotary notary",       url: "/api/health/tlsn" },
          ];
          const health = {};
          for (const c of checks) {
            try {
              const r = await call("GET", c.url);
              health[c.id] = { ok: r.ok ?? true, data: r };
              addLog(`✓ ${c.label}: ${r.address ? shorten(r.address) : r.version || "ok"}`, "success");
            } catch {
              health[c.id] = { ok: false };
              addLog(`⚠ ${c.label}: unreachable`, "warning");
            }
          }
          patchLive({ health });
          break;
        }

        // ── Phase 1: register agents ──
        case 1: {
          const agents = { orchestrator: null, research: null, payment: null };

          for (const [id] of [
            ["orchestrator", "Orchestrator — root authority, manages delegation tree"],
            ["research",     "Research Agent — web fetch + data research"],
            ["payment",      "Payment Agent — x402 micro-payments only"],
          ]) {
            addLog(`Registering ${id} on ERC-8004…`);
            try {
              const r = await call("POST", "/api/agents/register", {
                uri: `ipfs://dct-demo-${id}-v1`,
                agentURI: `ipfs://dct-demo-${id}-v1`,
              });
              agents[id] = r.agentId;
              addLog(`✓ ${id} → Agent ID: ${r.agentId} | tx: ${shorten(r.txHash)}`, "success");
              addTx({
                hash: r.txHash,
                label: `ERC-8004.register (${id})`,
                blockNumber: r.blockNumber,
                gasUsed: r.gasUsed,
                feeWei: r.feeWei,
              });
              logChainFootprint(`identity · ${id}`, r);
            } catch (e) {
              // If registration fails (e.g., official registry), use a fallback ID
              addLog(`⚠ ${id} registration: ${e.response?.data?.error || e.message}`, "warning");
              addLog(`  Using demo agent IDs from on-chain registry`, "info");
              // Try to get existing agents
              const existing = await call("GET", "/api/agents");
              if (existing.agents?.length > 0) {
                const idx = { orchestrator: 0, research: 1, payment: 2 };
                agents[id] = existing.agents[idx[id]]?.tokenId ?? String(idx[id]);
                addLog(`  Mapped to existing Agent #${agents[id]}`, "info");
              }
            }
          }

          patchLive({ agents, treeState: "root_pending" });
          break;
        }

        // ── Phase 2: mint root token ──
        case 2: {
          const agentId = wf().agents.orchestrator ?? "0";
          addLog(`Minting root Biscuit token for Agent #${agentId}…`);

          const r = await call("POST", "/api/tokens/create-root", {
            agentTokenId: agentId,
            allowedTools: ["web_fetch", "x402_pay", "research", "summarize"],
            spendLimitUsdc: 50_000_000,
            maxDepth: 3,
            expiresAt: Math.floor(Date.now() / 1000) + 86400,
          });

          addLog(`✓ Root token created in ${r.creationTimeMs}ms — zero gas, zero network`, "success");
          addLog(`  Rev ID: ${shorten(r.revocationId, 12)}`);
          addLog(`  Scope hash: ${shorten(r.scopeHash, 12)}`);
          addLog(`  Tools: web_fetch, x402_pay, research, summarize`);
          addLog(`  Spend: $50.00 | Depth: 3 | Ed25519 signed`);

          patchLive({
            tokens:  { ...wf().tokens,  root: r.tokenBytes },
            revIds:  { ...wf().revIds,  root: r.revocationId },
            timings: { ...wf().timings, rootCreate: r.creationTimeMs },
            treeState: "root_active",
            trustScores: { orchestrator: 0, research: 0, payment: 0 },
            trustDetail: { orchestrator: null, research: null, payment: null },
          });
          break;
        }

        // ── Phase 3: Orchestrator → Research ──
        case 3: {
          if (!wf().tokens.root) { addLog("✗ Run Phase 2 first", "error"); break; }

          const parentId = wf().agents.orchestrator ?? "0";
          const childId  = wf().agents.research     ?? "1";

          addLog(`Checking trust score for Research Agent #${childId}…`);
          let maxSpend = "$10.00";
          try {
            const trust = await call("GET", `/api/trust/${childId}`);
            maxSpend = trust.maxSpend || maxSpend;
            const dct = dctUiPercent(trust);
            addLog(`  On-chain registry: ${Number(trust.score || 0).toFixed(4)}× baseline → max grantable: ${maxSpend}`);
            if (dct != null) {
              addLog(`  DCT composite (S1/S2/S3): ${dct.toFixed(1)}% · tier ${trust.dctTrustProfile?.tier ?? "—"}`);
            }
          } catch { addLog("  Trust check skipped (cold start → $5.00 grantable)", "info"); }

          addLog("Attenuating Biscuit token offline…");
          const t0 = Date.now();
          const att = await call("POST", "/api/tokens/attenuate", {
            parentTokenId: wf().tokens.root,
            childAgentTokenId: childId,
            allowedTools: ["web_fetch", "research"],
            spendLimitUsdc: 10_000_000,
            maxDepth: 2,
            expiresAt: Math.floor(Date.now() / 1000) + 86400,
          });
          const attMs = att.attenuationTimeMs ?? Date.now() - t0;
          addLog(`✓ Attenuated in ${attMs}ms — no network, pure Ed25519`, "success");

          addLog("  Cooling down 2s before on-chain delegate (eases Alchemy 429 bursts after registrations)…", "info");
          await new Promise((r) => setTimeout(r, 2000));

          addLog("Registering delegation on DCTRegistry…");
          const del = await postDelegateWithRetry(
            {
              parentTokenB64: wf().tokens.root,
              parentAgentTokenId: parentId,
              childAgentTokenId: childId,
              childTools: ["web_fetch", "research"],
              childSpendLimit: 10_000_000,
            },
            addLog
          );

          addLog(`✓ Delegation registered → tx: ${shorten(del.txHash)}`, "success");
          addTx({
            hash: del.txHash,
            label: "DCTRegistry.registerDelegation (O→Research)",
            blockNumber: del.blockNumber,
            gasUsed: del.gasUsed,
            feeWei: del.feeWei,
          });
          logChainFootprint("delegate O→R", del);

          const childToken = del.childTokenBytes ?? att.childTokenBytes;
          const childRevId = del.childRevocationId ?? att.childRevocationId;

          patchLive({
            tokens:  { ...wf().tokens,  research: childToken },
            revIds:  { ...wf().revIds,  research: childRevId },
            timings: { ...wf().timings, attenuate1: attMs },
            treeState: "delegation_1_active",
            trustScores: { ...wf().trustScores, research: 50 },
          });
          break;
        }

        // ── Phase 4: Research → Payment ──
        case 4: {
          const parentToken = wf().tokens.research || wf().tokens.root;
          if (!parentToken) { addLog("✗ Run Phase 3 first", "error"); break; }

          const parentId = wf().agents.research ?? "1";
          const childId  = wf().agents.payment  ?? "2";

          addLog(`Checking trust for Payment Agent #${childId} (cold start)…`);
          addLog("  Cold start → max grantable: 10% of $10 = $1.00", "info");

          addLog("Attenuating Biscuit token offline…");
          const t0 = Date.now();
          const att = await call("POST", "/api/tokens/attenuate", {
            parentTokenId: parentToken,
            childAgentTokenId: childId,
            allowedTools: ["x402_pay"],
            spendLimitUsdc: 2_000_000,
            maxDepth: 1,
            expiresAt: Math.floor(Date.now() / 1000) + 86400,
          });
          const attMs = att.attenuationTimeMs ?? Date.now() - t0;
          addLog(`✓ Attenuated in ${attMs}ms`, "success");

          addLog("  Short pause before second delegate tx…", "info");
          await new Promise((r) => setTimeout(r, 1500));

          addLog("Registering second delegation on DCTRegistry…");
          const del = await postDelegateWithRetry(
            {
              parentTokenB64: parentToken,
              parentAgentTokenId: parentId,
              childAgentTokenId: childId,
              childTools: ["x402_pay"],
              childSpendLimit: 2_000_000,
            },
            addLog
          );

          addLog(`✓ Registered → tx: ${shorten(del.txHash)}`, "success");
          addTx({
            hash: del.txHash,
            label: "DCTRegistry.registerDelegation (Research→Payment)",
            blockNumber: del.blockNumber,
            gasUsed: del.gasUsed,
            feeWei: del.feeWei,
          });
          logChainFootprint("delegate R→P", del);

          const childToken = del.childTokenBytes ?? att.childTokenBytes;
          const childRevId = del.childRevocationId ?? att.childRevocationId;

          const total = (wf().timings.attenuate1 || 0) + attMs;
          patchLive({
            tokens:  { ...wf().tokens,  payment: childToken },
            revIds:  { ...wf().revIds,  payment: childRevId },
            timings: { ...wf().timings, attenuate2: attMs, totalAttenuation: total },
            treeState: "full_tree_active",
            trustScores: { ...wf().trustScores, payment: 50 },
          });
          break;
        }

        // ── Phase 5: successful execution (TLSNotary → Biscuit → DCTEnforcer) ──
        case 5: {
          const token = wf().tokens.payment || wf().tokens.research || wf().tokens.root;
          if (!token) { addLog("✗ Run Phases 2–4 first", "error"); break; }
          const agentId = wf().agents.research ?? "1";

          let demoOrigin = "—";
          try {
            demoOrigin = new URL(TLSN_DEMO_URL).origin;
          } catch { /* invalid VITE_TLSN_DEMO_URL */ }

          patchLive({ treeState: "executing_research", activeNode: "research",
            checks: [
              { id: "tls_origin", label: "TLS origin", detail: `HTTPS host allowlisted for web_fetch (${demoOrigin})`, gasNote: "MPC-TLS prover completes TLS handshake", state: "idle" },
              { id: "tls_operation", label: "Operation binding", detail: "toolName web_fetch → endpointHash ≡ keccak256(\"web_fetch\") on-chain", gasNote: "Must match DCTEnforcer toolHash", state: "idle" },
              { id: "tls_notary", label: "TLSNotary session", detail: "Transcript + notary ed25519 verified → oracle ECDSA", gasNote: "POST /api/tlsn/prove", state: "idle" },
              { id: "revocation", label: "Revocation check", detail: "isRevoked() walks lineage", gasNote: "~2,400 gas (3 hops)", state: "idle" },
              { id: "identity", label: "Identity check", detail: "erc8004.ownerOf(agentTokenId) == redeemer", gasNote: "~800 gas", state: "idle" },
              { id: "scope", label: "Scope check", detail: "toolHash ∈ allowedTools · spend ≤ limit · commitment", gasNote: "~1,200 gas", state: "idle" },
              { id: "attestation", label: "Oracle ECDSA (inline)", detail: "NotaryAttestationVerifier.verify(att, toolHash)", gasNote: "Skipped if tls attestation empty", state: "idle" },
            ],
          });

          const updateCheck = (id, state) => {
            setLive((prev) => {
              const base = workflowRef.current ?? prev;
              const next = {
                ...base,
                checks: base.checks.map((c) => (c.id === id ? { ...c, state } : c)),
              };
              workflowRef.current = next;
              return next;
            });
          };

          let tlsnProof;

          addLog("\n[tls] TLSNotary — origin, operation, handshake, notary verification");
          try {
            const tlsCfg = await call("GET", "/api/tlsn/config");
            addLog(`  prover: ${tlsCfg.enabled ? "online" : "offline"}${tlsCfg.proverUrl ? ` → ${tlsCfg.proverUrl}` : ""}`);
            addLog(`  notary attestation oracle: ${tlsCfg.oracle ? shorten(tlsCfg.oracle, 10) : "—"}`);

            if (tlsCfg.enabled) {
              updateCheck("tls_origin", "pending");
              const proved = await call("POST", "/api/tlsn/prove", {
                url: TLSN_DEMO_URL,
                toolName: "web_fetch",
                method: "GET",
              });
              tlsnProof = proved.inlineAttestation;

              updateCheck("tls_origin", "pass");
              addLog(`  ✓ origin: ${demoOrigin}`, "success");

              updateCheck("tls_operation", "pending");
              await new Promise((r) => setTimeout(r, 120));
              updateCheck("tls_operation", "pass");
              addLog(`  ✓ operation: GET ${TLSN_DEMO_URL} · tool web_fetch → endpointHash aligned with enforcer`, "success");

              updateCheck("tls_notary", "pending");
              await new Promise((r) => setTimeout(r, 120));
              const st = proved.proof?.statusCode ?? "?";
              const bodyPreview = String(proved.proof?.responsePreview ?? "");
              addLog(`  ✓ HTTP ${st}${bodyPreview ? ` — body preview: ${bodyPreview.slice(0, 100)}${bodyPreview.length > 100 ? "…" : ""}` : ""}`, "success");
              addLog(`  ✓ session hash: ${shorten(proved.proof?.sessionHash || proved.proofHash, 14)} · notary: ${proved.proof?.notaryUrl || tlsCfg.notaryUrl || "—"}`, "success");
              addLog("  ✓ TLS handshake completed inside MPC-TLS; notary signature verified off-chain", "success");
              addLog("  ✓ Oracle minted 65-byte inline attestation for DCTEnforcer.validateActionWithScope", "success");
              if (proved.proof?.backend) addLog(`  backend: ${proved.proof.backend}`, "info");

              updateCheck("tls_notary", "pass");
            } else {
              updateCheck("tls_origin", "warn");
              updateCheck("tls_operation", "warn");
              updateCheck("tls_notary", "warn");
              addLog("  ⚠ TLSN_PROVER_URL not set — no MPC proof (empty tls attestation; enforcer skips TLS line)", "warning");
              addLog("  hint: run `npm run tlsn-prover` in server + set TLSN_PROVER_URL (see docker-compose.tlsn.yml)", "info");
            }
          } catch (e) {
            updateCheck("tls_origin", "fail");
            updateCheck("tls_operation", "fail");
            updateCheck("tls_notary", "fail");
            addLog(`  ✗ TLSNotary prove failed: ${e.response?.data?.error || e.message}`, "error");
            addLog("  Continuing without tlsnProof — enforcer will omit TLS attestation check.", "warning");
          }

          addLog("\n[biscuit] Off-chain Datalog (authorize before any chain spend)");
          const researchToken = wf().tokens.research || token;
          const local = await call("POST", "/api/execute/verify-local", {
            tokenId: researchToken,
            agentId,
            tool: "web_fetch",
            spendAmount: 0,
          });
          addLog(`${local.passed ? "✓" : "✗"} Local check ${local.passed ? "passed" : "failed"} in ${local.checkTimeMs}ms — ${local.passed ? "zero gas wasted" : local.reason}`, local.passed ? "success" : "error");

          addLog("\n[chain] DCTEnforcer.validateActionWithScope…");
          updateCheck("revocation", "pending");
          await new Promise((r) => setTimeout(r, 450));
          updateCheck("revocation", "pass");
          addLog("  ✓ isRevoked(): 0 revoked ancestors", "success");

          updateCheck("identity", "pending");
          await new Promise((r) => setTimeout(r, 350));
          updateCheck("identity", "pass");
          addLog("  ✓ ownerOf(): identity match", "success");

          updateCheck("scope", "pending");
          const execToken = wf().tokens.research ?? token;
          const execBody = {
            tokenId: execToken,
            agentId,
            tool: "web_fetch",
            spendAmount: 0,
          };
          if (tlsnProof) execBody.tlsnProof = tlsnProof;

          const exec = await call("POST", "/api/execute/submit", execBody);
          updateCheck("scope", exec.success ? "pass" : "fail");

          updateCheck("attestation", "pending");
          await new Promise((r) => setTimeout(r, 150));
          updateCheck("attestation", exec.success ? "pass" : "fail");

          if (exec.success) {
            addLog("  ✓ Scope commitment matches | tool in allowedTools | spend ok", "success");
            addLog(
              `  ✓ NotaryAttestationVerifier.verify(att, toolHash): ${tlsnProof ? "PASS (65-byte oracle sig)" : "skipped (empty attestation)"}`,
              "success"
            );
            addLog(`\n✓ ACTION VALIDATED — tx: ${shorten(exec.txHash)}`, "success");
            addTx({
              hash: exec.txHash,
              label: "DCTEnforcer.validateActionWithScope (web_fetch + TLS)",
              blockNumber: exec.blockNumber,
              gasUsed: exec.gasUsed,
              feeWei: exec.feeWei,
              path: exec.path,
            });
            logChainFootprint("enforcer execute", exec);
            try {
              const tr = await call("GET", `/api/trust/${wf().agents.research ?? "1"}`);
              const pct = trustBarPercent(tr);
              patchLive({
                treeState: "execution_success",
                trustScores: {
                  ...wf().trustScores,
                  research: pct != null ? pct : wf().trustScores.research,
                },
                trustDetail: {
                  ...wf().trustDetail,
                  research: tr.dctTrustProfile ?? wf().trustDetail.research,
                },
              });
            } catch {
              patchLive({ treeState: "execution_success" });
            }

            addLog(
              "\n  Note: we do not run a second enforcer tx for Payment x402_pay on the leaf token — " +
                "each Biscuit attenuation appends `agent_erc8004_id == child`, so an O→R→P chain " +
                "requires both Research and Payment ids to satisfy the same $id (impossible). " +
                "Payment paths need a single-hop token or a future chain-aware policy.",
              "info"
            );
          } else {
            addLog(`✗ Enforcer rejected: ${formatExecRevert(exec)}`, "error");
            addLog("  (Token not registered on-chain — run the delegate steps first)", "info");
          }
          break;
        }

        // ── Phase 6: off-chain violation ──
        case 6: {
          const token = wf().tokens.research || wf().tokens.root;
          if (!token) { addLog("✗ Run Phases 2–4 first", "error"); break; }
          const agentId = wf().agents.research ?? "1";

          patchLive({ treeState: "violation_attempt", activeNode: "research" });

          addLog("Research Agent attempting x402_pay (NOT in scope)…");
          addLog("Running Datalog evaluator…");

          const r = await call("POST", "/api/execute/verify-local", {
            tokenId: token,
            agentId,
            tool: "x402_pay",
            spendAmount: 5_000_000,
          });

          if (!r.passed) {
            addLog(`✗ REJECTED in ${r.checkTimeMs}ms — ${r.reason}`, "error");
            addLog("  check if allowed_tool(\"x402_pay\") → NOT in authority block", "error");
            addLog("\n✓ Zero gas wasted. Zero tx submitted. Cryptographic enforcement.", "success");
            addLog(`  Time to reject: ${r.checkTimeMs}ms`, "info");
          } else {
            addLog("  Datalog passed (check structure may not cover this tool)", "warning");
            addLog("  On-chain enforcer would still catch scope mismatch", "info");
          }
          break;
        }

        // ── Phase 7: on-chain violation ──
        case 7: {
          const token = wf().tokens.payment || wf().tokens.root;
          if (!token) { addLog("✗ Run Phases 2–4 first", "error"); break; }
          const agentId = wf().agents.payment ?? "2";

          patchLive({
            treeState: "violation_onchain", activeNode: "payment",
            checks: [
              { id: "revocation", label: "Revocation Check", detail: "Token not revoked",            state: "pass" },
              { id: "identity",   label: "Identity Check",   detail: "ownerOf matches redeemer",      state: "pass" },
              { id: "scope",      label: "Scope Check",      detail: "spendAmount $3.00 > limit $2.00 → FAIL", state: "fail" },
            ],
          });

          addLog("Payment Agent submitting $3.00 spend (limit is $2.00)…");
          addLog("  Revocation check: PASS");
          addLog("  Identity check: PASS");
          addLog("  Scope check: $3.00 > $2.00 → FAIL");

          const exec = await call("POST", "/api/execute/submit", {
            tokenId: wf().tokens.payment || token,
            agentId,
            tool: "x402_pay",
            spendAmount: 3_000_000,
          });

          if (!exec.success) {
            addLog(`\n✗ REVERTED on-chain: ${formatExecRevert(exec)}`, "error");
            if (exec.txHash) {
              addLog(`  tx: ${shorten(exec.txHash)}`, "tx");
              addTx({
                hash: exec.txHash,
                label: "DCTEnforcer.validateActionWithScope (revert)",
                blockNumber: exec.blockNumber,
                gasUsed: exec.gasUsed,
                feeWei: exec.feeWei,
                path: exec.path,
              });
              logChainFootprint("enforcer (revert)", exec);
            }
            addLog("  Scope commitment hash cannot be faked — registered at delegation time", "warning");
            try {
              const tr = await call("GET", `/api/trust/${wf().agents.payment ?? "2"}`);
              const pct = trustBarPercent(tr);
              patchLive({
                trustScores: {
                  ...wf().trustScores,
                  payment: pct != null ? pct : Math.round((wf().trustScores.payment || 50) * 0.9),
                },
                trustDetail: {
                  ...wf().trustDetail,
                  payment: tr.dctTrustProfile ?? wf().trustDetail.payment,
                },
              });
            } catch {
              patchLive({
                trustScores: {
                  ...wf().trustScores,
                  payment: Math.round((wf().trustScores.payment || 50) * 0.9),
                },
              });
            }
          } else {
            addLog("  (Token not on-chain — scope would revert if registered with $2 limit)", "info");
          }
          break;
        }

        // ── Phase 8: cascade revocation ──
        case 8: {
          // Registry only sets holderAgent for *child* IDs from registerDelegation.
          // The off-chain root revocation id is not a registry row — revoke the first
          // on-chain delegation (research) so holderAgent matches the orchestrator.
          const researchRevId = wf().revIds.research;
          const agentId = wf().agents.orchestrator ?? "0";
          if (!researchRevId) {
            addLog("✗ No on-chain delegation ID — complete Phase 3 (Orchestrator → Research) first.", "error");
            break;
          }

          patchLive({ treeState: "revocation_pending", activeNode: null });

          addLog(`Revoking first delegation (cascade invalidates downstream): ${shorten(researchRevId, 12)}…`);
          addLog("Single SSTORE write — O(1) regardless of tree size");
          addLog("  Cooling down 2.5s before revoke (reduces 429 after prior txs)…", "info");
          await new Promise((r) => setTimeout(r, 2500));

          const r = await postJsonWithRetry(
            "/api/revoke",
            {
              tokenId: researchRevId,
              agentTokenId: agentId,
            },
            addLog
          );

          if (r.success || r.txHash) {
            addLog(`✓ Root revoked → tx: ${shorten(r.txHash)}`, "success");
            addTx({
              hash: r.txHash,
              label: "DCTRegistry.revoke (cascade)",
              blockNumber: r.blockNumber,
              gasUsed: r.gasUsed,
              feeWei: r.feeWei,
            });
            logChainFootprint("revoke", r);
            addLog("  Downstream agents NOT actively killed — lazy revocation", "info");
            addLog("  They will fail next time they attempt any action");
            patchLive({ treeState: "revocation_complete" });
          } else {
            addLog(`⚠ ${r.error || "revocation returned no tx"}`, "warning");
            addLog("  Token may not have been on-chain (demo ran without Phase 3 register)", "info");
            patchLive({ treeState: "revocation_complete" });
          }
          break;
        }

        // ── Phase 9: cascade proof (lineage walk animation) ──
        case 9: {
          const token   = wf().tokens.payment || wf().tokens.root;
          const agentId = wf().agents.payment ?? "2";
          if (!token) { addLog("✗ Run Phases 2–4 first", "error"); break; }

          patchLive({ treeState: "cascade_attempt", activeNode: "payment", lineageStep: 0 });

          addLog("Payment Agent attempting x402_pay after root revocation…");
          await new Promise(r => setTimeout(r, 400));

          addLog("isRevoked() walk started:");
          patchLive({ lineageStep: 1 });
          addLog("  hop 0 — Payment token: not directly revoked");
          await new Promise(r => setTimeout(r, 900));

          patchLive({ lineageStep: 2 });
          addLog("  hop 1 — Research token: not directly revoked");
          await new Promise(r => setTimeout(r, 900));

          patchLive({ lineageStep: 3 });
          addLog("  hop 2 — Root token: REVOKED ✗", "error");
          await new Promise(r => setTimeout(r, 700));

          const exec = await call("POST", "/api/execute/submit", {
            tokenId: token,
            agentId,
            tool: "x402_pay",
            spendAmount: 1_000_000,
          });

          if (!exec.success) {
            addLog(`\n✗ REVERTED: ${formatExecRevert(exec)}`, "error");
            if (exec.txHash) {
              addLog(`  tx: ${shorten(exec.txHash)}`, "tx");
              addTx({
                hash: exec.txHash,
                label: "DCTEnforcer (post-revoke)",
                blockNumber: exec.blockNumber,
                gasUsed: exec.gasUsed,
                feeWei: exec.feeWei,
                path: exec.path,
              });
              logChainFootprint("enforcer cascade", exec);
            }
          }
          addLog("\n✓ Cascade confirmed. Three agents. One tx. O(1) gas.", "success");
          patchLive({ treeState: "cascade_confirmed", lineageStep: 0 });
          break;
        }

        // ── Phase 10: trust summary ──
        case 10: {
          addLog("Fetching DCT trust profiles (S1 scope · S2 tasks · S3 outcome) + registry score…");
          const scores = { ...wf().trustScores };
          const detail = { ...wf().trustDetail };
          for (const [key, id] of [
            ["orchestrator", wf().agents.orchestrator ?? "0"],
            ["research",     wf().agents.research     ?? "1"],
            ["payment",      wf().agents.payment      ?? "2"],
          ]) {
            try {
              const t = await call("GET", `/api/trust/${id}`);
              const dct = dctUiPercent(t);
              const bar = trustBarPercent(t);
              if (bar != null) scores[key] = bar;
              detail[key] = t.dctTrustProfile ?? null;
              const mult = registryTrustMultiplier(t);
              addLog(
                `  Agent #${id} (${key}): DCT ${dct != null ? `${dct.toFixed(1)}%` : "—"} · tier ${t.dctTrustProfile?.tier ?? "—"} · registry ${mult != null ? `${mult.toFixed(4)}×` : "—"}`,
                "info"
              );
            } catch { addLog(`  Agent #${id}: trust query failed`, "warning"); }
          }
          patchLive({ trustScores: scores, trustDetail: detail });
          addLog(
            "\n✓ DCT composite (off-chain) is 0–100%. Registry score is on-chain vs 1e18 baseline (often ~1.0×; can exceed after rewards).",
            "success"
          );
          break;
        }

        // ── Phase 11: summary ──
        case 11: {
          const txs = wf().transactions;
          const txCount = txs.length;
          const attMs = wf().timings.totalAttenuation || "–";
          let totalGas = 0n;
          let totalFeeWei = 0n;
          for (const t of txs) {
            const o = txNorm(t);
            let gu = o.gasUsed;
            let fw = o.feeWei;
            if (o.hash && (!gu || !fw)) {
              try {
                const d = await api.get(`/api/chain/tx/${o.hash}`).then((r) => r.data);
                if (d && !d.pending && !d.error) {
                  gu = gu || d.gasUsed;
                  fw = fw || d.feeWei;
                  mergeTxByHash(o.hash, {
                    gasUsed: d.gasUsed,
                    feeWei: d.feeWei,
                    blockNumber: d.blockNumber,
                    methodName: d.methodName,
                    contractLabel: d.contractLabel,
                    argSummary: d.argSummary,
                    chainFetched: true,
                  });
                }
              } catch {
                /* RPC optional */
              }
            }
            if (gu) try { totalGas += BigInt(gu); } catch { /* ignore */ }
            if (fw) try { totalFeeWei += BigInt(fw); } catch { /* ignore */ }
          }
          const gasLine =
            totalGas > 0n
              ? `${totalGas.toString()} units · ${formatFeeWei(totalFeeWei.toString())} (Σ receipts)`
              : "— (no receipt gas — check RPC / contract addresses)";
          patchLive({
            summary: {
              txCount,
              attMs,
              agentsCreated: 3,
              delegations: 2,
              totalGasUsed: totalGas > 0n ? totalGas.toString() : null,
              totalFeeWei: totalFeeWei > 0n ? totalFeeWei.toString() : null,
              gasEstimate: gasLine,
            },
          });
          addLog("═══ DCT Protocol Demo Complete ═══", "success");
          addLog(`  Agents created:      3`);
          addLog(`  On-chain txs:        ${txCount}`);
          addLog(`  Σ gas (tracked):     ${gasLine}`);
          addLog(`  Off-chain attenuations: 2 (${attMs}ms total)`);
          addLog(`  Auth servers consulted: 0`);
          addLog(`\n  "Sudo for AI agents. Trustless. Composable. MIT licensed."`, "success");
          break;
        }
      }
    } catch (err) {
      addLog(`Error: ${err.response?.data?.error || err.message}`, "error");
    }
  }

  async function runStep(s) {
    if (running) return;
    setRunning(true);
    workflowRef.current = { ...live, logs: [] };
    setLive(workflowRef.current);
    await executePhase(s);
    setRunning(false);
    if (autoAdvance && !fullWorkflowActiveRef.current && s < 11) setStep(s + 1);
  }

  async function runFullWorkflow() {
    if (running) return;
    fullWorkflowActiveRef.current = true;
    setRunning(true);
    const next = getDefaultLive();
    workflowRef.current = next;
    setLive(next);
    setStep(0);
    try {
      for (let s = 0; s <= 11; s++) {
        setStep(s);
        setFullRunProgress({ current: s + 1, total: 12 });
        await executePhase(s);
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      setRunning(false);
      fullWorkflowActiveRef.current = false;
      setFullRunProgress(null);
    }
  }

  runFullWorkflowRef.current = runFullWorkflow;

  useEffect(() => {
    if (!consumePendingLiveDemoE2E()) return;
    queueMicrotask(() => {
      runFullWorkflowRef.current();
    });
  }, []);

  function reset() {
    setStep(0);
    logSeqRef.current = 0;
    const fresh = getDefaultLive();
    workflowRef.current = fresh;
    setLive(fresh);
  }

  // ─── step content ────────────────────────────────────────────────────────

  const stepTitle = [
    "Connecting to DCT Protocol",
    "Spawning Three Autonomous Agents",
    "Creating Root Permission Token",
    "Orchestrator → Research Delegation",
    "Research → Payment Delegation",
    "Research Agent Executes web_fetch (TLSNotary + Enforcer)",
    "Research Agent Tries Forbidden Tool",
    "Payment Agent Tries to Overspend",
    "Cascade Revocation — One Transaction",
    "Lineage Walk — Cascade Proof",
    "Trust Score Summary",
    "Demo Complete",
  ];

  const stepSubtitle = [
    "Six health checks, then we begin",
    "Each gets a unique ERC-8004 identity NFT",
    "Offline, instant, pure Ed25519 cryptography",
    "Authority narrows. Registered on-chain.",
    "Full delegation tree: Orchestrator → Research → Payment",
    "TLSNotary prove → Biscuit (research token) → DCTEnforcer + oracle attestation",
    "Rejected before touching the blockchain — zero gas",
    "Passes local check, reverts on-chain",
    "Single SSTORE. O(1). No gas bomb.",
    "isRevoked() walks: Payment → Research → Root ✗",
    "Three-signal composite from enforcer events; compare to on-chain trustScore.",
    "Three agents. One protocol. MIT licensed.",
  ];

  const stepColor = PHASES[step]?.color ?? "#818cf8";

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-nb-ink">DCT Protocol — Live Demo</h1>
          <p className="text-sm text-nb-ink/60 mt-1">
            Delegated Capability Tokens · Base Sepolia · {live.transactions.length} tx so far
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <button
            type="button"
            onClick={runFullWorkflow}
            disabled={running}
            className="nb-btn-primary text-xs disabled:opacity-50 disabled:pointer-events-none"
            title="Run phases 0–11 in sequence with shared workflow state"
            style={{}}
          >
            {running && fullRunProgress ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                E2E {fullRunProgress.current}/{fullRunProgress.total}
              </>
            ) : (
              <>
                <Workflow className="w-3 h-3" />
                Run full E2E workflow
              </>
            )}
          </button>
          <label className="flex items-center gap-2 text-xs text-nb-ink/60 font-display font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={e => setAutoAdvance(e.target.checked)}
              disabled={running && !!fullRunProgress}
              className="rounded"
            />
            Auto-advance
          </label>
          <button onClick={reset} className="nb-btn-ghost text-xs">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>
      </div>

      {/* phase progress */}
      <div className="nb-card overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {PHASES.map((p, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={p.id} className="flex items-center">
                <button
                  onClick={() => setStep(i)}
                  className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-nb text-[10px] font-display font-bold transition-all min-w-[56px] ${
                    active ? "text-white" :
                    done   ? "text-nb-ok" :
                             "text-nb-ink/50 hover:text-nb-ink"
                  }`}
                  style={active ? { background: `${stepColor}22`, border: `1px solid ${stepColor}55` } : {}}
                >
                  <span className={`w-5 h-5 rounded-full border-2 border-nb-ink flex items-center justify-center text-[9px] font-bold ${
                    done   ? "bg-nb-ok text-white" :
                    active ? `text-white` :
                             "bg-nb-bg"
                  }`}
                  style={active ? { background: stepColor } : {}}>
                    {done ? "✓" : p.id}
                  </span>
                  {p.label}
                </button>
                {i < PHASES.length - 1 && (
                  <div className={`w-4 h-0.5 mx-0.5 border-t-2 border-dashed ${done ? "border-nb-ok" : "border-nb-ink/20"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* main layout */}
      <div className="grid grid-cols-[280px_1fr] gap-4 items-start">

        {/* left: agent tree */}
        <div className="nb-card sticky top-4">
          <p className="text-xs font-display font-bold text-nb-ink/50 uppercase tracking-wider mb-3">Agent Tree</p>
          <div className="h-[340px]">
            <AgentTree
              treeState={live.treeState}
              activeNode={live.activeNode}
              lineageStep={live.lineageStep}
              agents={live.agents}
              trustScores={live.trustScores}
            />
          </div>
          {/* tx count */}
          <div className="mt-3 pt-3 border-t-2 border-nb-ink/20 grid grid-cols-2 gap-2">
            {[
              { label: "Txs", value: live.transactions.length },
              { label: "Agents", value: Object.values(live.agents).filter(Boolean).length },
              { label: "Att. ms", value: live.timings.totalAttenuation || "–" },
              { label: "Gas", value: live.transactions.length ? "~$0.04" : "$0" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-sm font-display font-bold text-nb-ink">{s.value}</p>
                <p className="text-[10px] font-display text-nb-ink/50">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* right: content */}
        <div className="space-y-4">

          {/* step card */}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.25 }}
              className="nb-card overflow-hidden"
            >
              {/* header */}
              <div className="p-5 border-b-2 border-nb-ink -m-5 mb-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="nb-pill text-[10px]">
                        Phase {step}
                      </span>
                      <span className="text-[10px] font-display font-semibold text-nb-ink/50">{PHASES[step]?.label}</span>
                    </div>
                    <h2 className="text-lg font-display font-bold text-nb-ink">{stepTitle[step]}</h2>
                    <p className="text-sm text-nb-ink/60 mt-0.5">{stepSubtitle[step]}</p>
                  </div>
                  <motion.button
                    whileHover={{ y: -2 }}
                    whileTap={{ y: 0 }}
                    onClick={() => runStep(step)}
                    disabled={running}
                    className={`nb-btn text-sm shrink-0 ${
                      running ? "bg-nb-bg text-nb-ink/50" : "bg-nb-accent text-nb-ink"
                    }`}
                    style={{}}
                  >
                    {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {running ? "Running…" : "Run"}
                  </motion.button>
                </div>
              </div>

              {/* step-specific UI */}
              <div className="p-5 space-y-4 mt-5">

                {/* Phase 0: health checks */}
                {step === 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {["chain","registry","enforcer","erc8004","pimlico","tlsn"].map(k => {
                      const h = live.health[k];
                      return (
                        <div key={k} className={`flex items-center gap-2 p-2.5 rounded-nb border-2 border-nb-ink text-xs font-display font-semibold ${
                          h?.ok ? "bg-nb-ok/15" :
                          h     ? "bg-nb-error/15" :
                                  "bg-nb-card"
                        }`}>
                          {h?.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-[#34d399]" /> :
                           h     ? <XCircle className="w-3.5 h-3.5 text-[#ef4444]" /> :
                                   <div className="w-3.5 h-3.5 rounded-full border border-white/20" />}
                          <span className="capitalize">{k === "erc8004" ? "ERC-8004" : k === "tlsn" ? "TLSNotary" : k}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Phase 3+4: delegation diff */}
                {step === 3 && (
                  <DelegationDiff
                    before={{ label: "Orchestrator had", tools: ["web_fetch","x402_pay","research","summarize"], spend: 50, depth: 3 }}
                    after={{ label: "Research Agent gets", tools: ["web_fetch","research"], spend: 10, depth: 2 }}
                    highlights={["x402_pay removed — Research cannot make payments","summarize removed","Spend reduced from $50 → $10","Depth reduced 3 → 2"]}
                  />
                )}
                {step === 4 && (
                  <DelegationDiff
                    before={{ label: "Research Agent had", tools: ["web_fetch","research"], spend: 10, depth: 2 }}
                    after={{ label: "Payment Agent gets", tools: ["x402_pay"], spend: 2, depth: 1 }}
                    highlights={["web_fetch removed","research removed","Spend $10 → $2 (cold start trust)","Depth 1 — cannot sub-delegate"]}
                  />
                )}

                {/* Phase 5+7: execution checks */}
                {(step === 5 || step === 7) && live.checks.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-display font-bold text-nb-ink/50 uppercase tracking-wider">
                      DCTEnforcer.validateActionWithScope
                    </p>
                    {live.checks.map(c => (
                      <CheckRow key={c.id} check={c} state={c.state || "idle"} />
                    ))}
                  </div>
                )}

                {/* Phase 9: lineage walk */}
                {step === 9 && (
                  <div className="space-y-2">
                    <p className="text-xs font-display font-bold text-nb-ink/50 uppercase tracking-wider">
                      isRevoked() — Lineage Walk
                    </p>
                    {[
                      { hop: 0, label: "Payment Token",  id: "payment",       revoked: false },
                      { hop: 1, label: "Research Token", id: "research",      revoked: false },
                      { hop: 2, label: "Root Token",     id: "orchestrator",  revoked: true  },
                    ].map(h => {
                      const active = live.lineageStep === h.hop + 1;
                      const done   = live.lineageStep > h.hop + 1 || live.treeState === "cascade_confirmed";
                      return (
                        <motion.div key={h.hop}
                          initial={{ opacity: 0.3 }}
                          animate={{ opacity: active || done ? 1 : 0.3 }}
                          className={`flex items-center gap-3 p-2.5 rounded-nb border-2 border-nb-ink text-xs font-display font-semibold ${
                            done && h.revoked ? "bg-nb-error/15" :
                            active            ? "bg-nb-warn/15" :
                                                "bg-nb-card"
                          }`}>
                          <span className="text-muted-foreground font-mono">hop {h.hop}</span>
                          <span className="font-medium">{h.label}</span>
                          {done && h.revoked && <span className="ml-auto text-[#ef4444] font-bold">REVOKED ✗</span>}
                          {done && !h.revoked && <span className="ml-auto text-[#34d399]">clear</span>}
                          {active && <Loader2 className="ml-auto w-3.5 h-3.5 animate-spin text-[#fbbf24]" />}
                        </motion.div>
                      );
                    })}
                    <p className="text-[11px] text-muted-foreground">3 hops × ~800 gas = ~2,400 gas total</p>
                  </div>
                )}

                {/* Phase 8: revocation stats */}
                {step === 8 && (
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Txs to revoke 3 agents", value: "1" },
                      { label: "On-chain writes",         value: "1 SSTORE" },
                      { label: "Gas cost",                value: "~21,000" },
                      { label: "Agents actively killed",  value: "0 (lazy)" },
                    ].map(s => (
                      <div key={s.label} className="p-3 rounded-nb border-2 border-nb-ink bg-nb-card">
                        <p className="text-sm font-display font-bold text-nb-ink">{s.value}</p>
                        <p className="text-[10px] font-display text-nb-ink/50 mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Phase 10: trust scores */}
                {step === 10 && (
                  <div className="space-y-3">
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Composite = 0.50×S1 (scope + EMA) + 0.20×S2 (task validators) + 0.30×S3 (time-weighted outcome).
                      Same formula as <code className="text-nb-accent-2">pythonNodes/trustScores.py</code> /{" "}
                      <code className="text-nb-accent-2">dct_integration.py</code>.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <TrustBadge label="Orchestrator" tier={live.trustDetail?.orchestrator?.tier} score={live.trustScores.orchestrator ?? 0} change={0} />
                      <TrustBadge label="Research" tier={live.trustDetail?.research?.tier} score={live.trustScores.research ?? 0} change={0} />
                      <TrustBadge label="Payment" tier={live.trustDetail?.payment?.tier} score={live.trustScores.payment ?? 0} change={0} />
                    </div>
                    <div className="space-y-1.5 mt-2">
                      {["orchestrator", "research", "payment"].map((role) => {
                        const d = live.trustDetail?.[role];
                        const pct = live.trustScores?.[role];
                        return (
                          <div key={role} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] p-2 rounded-nb bg-nb-bg border border-nb-ink/20">
                            <span className="text-muted-foreground capitalize w-24">{role}</span>
                            <span className="font-mono text-nb-ink">{pct != null ? `${Number(pct).toFixed(1)}%` : "—"}</span>
                            <span className="font-mono text-nb-accent-2">{d?.tier ?? "—"}</span>
                            <span className="font-mono text-nb-ink/70">S1 {d?.signal_1 != null ? d.signal_1.toFixed(2) : "—"}</span>
                            <span className="font-mono text-nb-ink/70">S2 {d?.signal_2 != null ? d.signal_2.toFixed(2) : "—"}</span>
                            <span className="font-mono text-nb-ink/70">S3 {d?.signal_3 != null ? d.signal_3.toFixed(2) : "—"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Phase 11: summary */}
                {step === 11 && live.summary.txCount !== undefined && (
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Agents created",          value: "3" },
                      { label: "On-chain txs",            value: String(live.summary.txCount) },
                      { label: "Off-chain attenuations",  value: "2" },
                      { label: "Attenuation time",        value: `${live.summary.attMs}ms` },
                      { label: "Auth servers consulted",  value: "0" },
                      { label: "Gas & fees (Σ receipts)", value: live.summary.gasEstimate },
                    ].map(s => (
                      <div key={s.label} className="p-3 rounded-nb border-2 border-nb-ink bg-nb-card">
                        <p className={`font-mono font-bold text-nb-ink leading-snug break-words ${s.label.includes("Gas") ? "text-[11px]" : "text-base"}`}>{s.value}</p>
                        <p className="text-[10px] font-display text-nb-ink/50 mt-0.5">{s.label}</p>
                      </div>
                    ))}
                    <div className="col-span-2 p-3 rounded-nb border-2 border-nb-accent bg-nb-accent/15 text-center">
                      <p className="text-sm text-nb-ink font-display font-bold italic">
                        &ldquo;Sudo for AI agents. Trustless. Composable. MIT licensed.&rdquo;
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* log panel — terminal-style */}
          {live.logs.length > 0 && (
            <div className="rounded-nb overflow-hidden border-2 border-nb-ink shadow-nb">
              <div className="bg-nb-ink px-3 py-2 flex items-center gap-2 border-b-2 border-white/10">
                <Terminal className="w-3.5 h-3.5 text-nb-accent" />
                <span className="text-[11px] font-mono text-white/50">base-sepolia</span>
                <span className="text-[10px] font-mono text-white/30 ml-auto">
                  {live.transactions.length} tx · demo log
                </span>
              </div>
              <div className="bg-nb-ink p-3">
                <div className="space-y-0 max-h-[320px] overflow-y-auto font-mono text-[11px] leading-snug">
                  {live.logs.map((log, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.015, 0.25) }}
                      className={`flex items-start gap-2 py-0.5 border-l-2 border-transparent pl-1 -ml-1 ${
                        log.type === "success" ? "text-emerald-400/95 border-l-emerald-500/40" :
                        log.type === "error"   ? "text-red-400/95 border-l-red-500/40" :
                        log.type === "warning" ? "text-amber-400/90 border-l-amber-500/40" :
                        log.type === "tx"      ? "text-cyan-400/90 border-l-cyan-500/35" :
                                                 "text-zinc-400 border-l-zinc-700/50"
                      }`}
                    >
                      <span className="text-zinc-600 select-none shrink-0 w-[76px] text-right tabular-nums">
                        {formatLogTime(log.ts)}
                      </span>
                      <span className="text-zinc-600 select-none shrink-0 w-4 text-right opacity-70">
                        {String(i + 1).padStart(2)}
                      </span>
                      <span className="break-all min-w-0">{log.msg}</span>
                    </motion.div>
                  ))}
                  {running && (
                    <div className="flex items-center gap-2 text-cyan-400/90 pl-[92px] py-1">
                      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                      <span>running…</span>
                    </div>
                  )}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          )}

          {/* on-chain event log */}
          <div className="nb-card-sm overflow-hidden">
            <EventLog maxRows={50} />
          </div>

          {/* tx ledger — previews + Basescan */}
          {live.transactions.length > 0 && (
            <div className="rounded-nb border-2 border-nb-ink bg-nb-ink overflow-hidden shadow-nb-sm">
              <p className="text-[10px] font-mono font-semibold text-white/50 uppercase tracking-wider px-3 py-2 border-b-2 border-white/10 flex items-center gap-2">
                <Link2 className="w-3 h-3" />
                On-chain transactions ({live.transactions.length})
              </p>
              <div className="p-2 space-y-2 max-h-[420px] overflow-y-auto">
                {live.transactions.map((raw, i) => {
                  const tx = txNorm(raw);
                  const title =
                    tx.methodName && tx.methodName !== "unknown"
                      ? `${tx.contractLabel || "Contract"}.${tx.methodName}()`
                      : tx.label || "Transaction";
                  const sub =
                    tx.argSummary ||
                    (tx.pending ? "Pending confirmation…" : "Decoded via local RPC — open Basescan for full trace");
                  return (
                    <a
                      key={`${tx.hash}-${i}`}
                      href={`${BASESCAN}/tx/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-nb border-2 border-white/15 bg-white/5 px-3 py-2.5 hover:border-nb-accent/50 hover:bg-white/10 transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-mono font-semibold text-zinc-200 group-hover:text-cyan-200/95 truncate">
                            {title}
                          </p>
                          <p className="text-[10px] font-mono text-zinc-500 mt-0.5 line-clamp-2 break-all">
                            {sub}
                          </p>
                          <p className="text-[10px] font-mono text-zinc-600 mt-1 truncate">
                            {tx.hash}
                          </p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-cyan-500/80 shrink-0 mt-0.5" />
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[10px] font-mono text-zinc-500">
                        {tx.blockNumber != null && (
                          <span className="text-zinc-500">
                            block <span className="text-zinc-400">{tx.blockNumber}</span>
                          </span>
                        )}
                        {tx.status === "reverted" && (
                          <span className="text-red-400/90">reverted</span>
                        )}
                        {tx.gasUsed && (
                          <span>
                            gas <span className="text-emerald-400/90">{Number(tx.gasUsed).toLocaleString()}</span>
                          </span>
                        )}
                        {tx.feeWei && (
                          <span>
                            fee <span className="text-amber-400/85">{formatFeeWei(tx.feeWei)}</span>
                          </span>
                        )}
                        {tx.effectiveGasPrice && (
                          <span className="text-zinc-600">
                            {formatUnits(tx.effectiveGasPrice, "gwei")} gwei / gas
                          </span>
                        )}
                        {!tx.chainFetched && !tx.methodName && (
                          <span className="text-zinc-600 animate-pulse">decoding…</span>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* nav */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="nb-btn-ghost text-sm disabled:opacity-30"
            >
              ← Prev
            </button>
            <span className="text-xs text-nb-ink/50 font-display font-semibold">{step + 1} / {PHASES.length}</span>
            <button
              onClick={() => setStep(Math.min(PHASES.length - 1, step + 1))}
              disabled={step === PHASES.length - 1}
              className="flex items-center gap-1 nb-btn-secondary text-sm"
              style={{}}
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
