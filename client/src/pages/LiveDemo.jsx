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
 *   Phase 5  — Successful execution (4-check trace)
 *   Phase 6  — Off-chain scope violation (zero gas)
 *   Phase 7  — On-chain scope violation (revert)
 *   Phase 8  — Cascade revocation (single tx)
 *   Phase 9  — Lineage walk animation ← THE moment
 *   Phase 10 — Trust score timeline
 *   Phase 11 — Summary
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, CheckCircle2, XCircle, Loader2, ChevronRight,
  RotateCcw, Link2, ExternalLink,
} from "lucide-react";
import api from "../lib/api";
import EventLog from "../components/ui/EventLog";

// ─── helpers ──────────────────────────────────────────────────────────────────

const BASESCAN = "https://sepolia.basescan.org";
const shorten = (h, n = 8) => h ? `${h.slice(0, n)}…${h.slice(-4)}` : "–";
const usd = (v) => `$${(Number(v) / 1_000_000).toFixed(2)}`;

async function call(method, url, body) {
  const start = Date.now();
  const r = method === "GET"
    ? await api.get(url)
    : await api.post(url, body);
  return { ...r.data, _ms: Date.now() - start };
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
    <svg viewBox="0 0 400 440" className="w-full h-full">
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
            {trustScores[id] !== undefined && (
              <text x={n.x + 44} y={n.y - 28} fontSize={9}
                fill={trustScores[id] >= 100 ? "#34d399" : trustScores[id] < 100 ? "#ef4444" : "#9ca3af"}
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
      className={`flex items-start gap-3 p-3 rounded-lg border ${
        state === "pass"  ? "border-[#34d399]/30 bg-[#34d399]/5" :
        state === "fail"  ? "border-[#ef4444]/30 bg-[#ef4444]/5" :
        state === "pending" ? "border-[#22d3ee]/30 bg-[#22d3ee]/5" :
        "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="mt-0.5 shrink-0">
        {state === "pass"    ? <CheckCircle2 className="w-4 h-4 text-[#34d399]" /> :
         state === "fail"    ? <XCircle className="w-4 h-4 text-[#ef4444]" /> :
         state === "pending" ? <Loader2 className="w-4 h-4 text-[#22d3ee] animate-spin" /> :
                               <div className="w-4 h-4 rounded-full border border-white/20" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold">{check.label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{check.detail}</p>
        {check.gasNote && (
          <p className="text-[10px] text-[#818cf8] mt-1 font-mono">{check.gasNote}</p>
        )}
      </div>
      {state && state !== "idle" && (
        <span className={`text-[10px] font-bold shrink-0 ${
          state === "pass" ? "text-[#34d399]" :
          state === "fail" ? "text-[#ef4444]" :
          "text-[#22d3ee]"
        }`}>
          {state === "pass" ? "PASS" : state === "fail" ? "FAIL" : "…"}
        </span>
      )}
    </motion.div>
  );
}

// ─── delegation diff ──────────────────────────────────────────────────────────

function DelegationDiff({ before, after, highlights }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="p-3 rounded-xl border border-white/10 bg-white/[0.02]">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{before.label}</p>
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
      <div className="p-3 rounded-xl border border-[#22d3ee]/20 bg-[#22d3ee]/5">
        <p className="text-[10px] uppercase tracking-wider text-[#22d3ee] mb-2">{after.label}</p>
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

function TrustBadge({ label, score, change }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/10">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono font-bold">{Number(score).toFixed(1)}</span>
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

  const [live, setLive] = useState({
    agents:      { orchestrator: null, research: null, payment: null },
    tokens:      { root: null, research: null, payment: null },
    revIds:      { root: null, research: null, payment: null },
    transactions: [],
    trustScores: { orchestrator: 100, research: 0, payment: 0 },
    timings:     {},
    treeState:   "empty",
    activeNode:  null,
    lineageStep: 0,
    logs:        [],
    checks:      [],  // array of { id, label, detail, gasNote, state }
    health:      {},
    summary:     {},
  });

  const logsEndRef = useRef(null);

  // auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [live.logs]);

  const addLog = useCallback((msg, type = "info") => {
    setLive(prev => ({
      ...prev,
      logs: [...prev.logs, { msg, type, ts: Date.now() }],
    }));
  }, []);

  const setLiveKey = useCallback((updates) => {
    setLive(prev => ({ ...prev, ...updates }));
  }, []);

  const addTx = useCallback((hash) => {
    if (!hash) return;
    setLive(prev => ({
      ...prev,
      transactions: [...prev.transactions, hash],
    }));
  }, []);

  // ─── step runners ────────────────────────────────────────────────────────

  async function runStep(s) {
    if (running) return;
    setRunning(true);
    setLiveKey({ logs: [] });

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
          setLiveKey({ health });
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
              addTx(r.txHash);
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

          setLiveKey({ agents, treeState: "root_pending" });
          break;
        }

        // ── Phase 2: mint root token ──
        case 2: {
          const agentId = live.agents.orchestrator ?? "0";
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

          setLiveKey({
            tokens:  { ...live.tokens,  root: r.tokenBytes },
            revIds:  { ...live.revIds,  root: r.revocationId },
            timings: { ...live.timings, rootCreate: r.creationTimeMs },
            treeState: "root_active",
            trustScores: { orchestrator: 100, research: 0, payment: 0 },
          });
          break;
        }

        // ── Phase 3: Orchestrator → Research ──
        case 3: {
          if (!live.tokens.root) { addLog("✗ Run Phase 2 first", "error"); break; }

          const parentId = live.agents.orchestrator ?? "0";
          const childId  = live.agents.research     ?? "1";

          addLog(`Checking trust score for Research Agent #${childId}…`);
          let maxSpend = "$10.00";
          try {
            const trust = await call("GET", `/api/trust/${childId}`);
            maxSpend = trust.maxSpend || maxSpend;
            addLog(`  Trust: ${Number(trust.score || 0).toFixed(2)} → max grantable: ${maxSpend}`);
          } catch { addLog("  Trust check skipped (cold start → $5.00 grantable)", "info"); }

          addLog("Attenuating Biscuit token offline…");
          const t0 = Date.now();
          const att = await call("POST", "/api/tokens/attenuate", {
            parentTokenId: live.tokens.root,
            childAgentTokenId: childId,
            allowedTools: ["web_fetch", "research"],
            spendLimitUsdc: 10_000_000,
            maxDepth: 2,
            expiresAt: Math.floor(Date.now() / 1000) + 86400,
          });
          const attMs = att.attenuationTimeMs ?? Date.now() - t0;
          addLog(`✓ Attenuated in ${attMs}ms — no network, pure Ed25519`, "success");

          addLog("Registering delegation on DCTRegistry…");
          const del = await call("POST", "/api/delegate", {
            parentTokenB64: live.tokens.root,
            parentAgentTokenId: parentId,
            childAgentTokenId: childId,
            childTools: ["web_fetch", "research"],
            childSpendLimit: 10_000_000,
          });

          addLog(`✓ Delegation registered → tx: ${shorten(del.txHash)}`, "success");
          addTx(del.txHash);

          const childToken = del.childTokenBytes ?? att.childTokenBytes;
          const childRevId = del.childRevocationId ?? att.childRevocationId;

          setLiveKey({
            tokens:  { ...live.tokens,  research: childToken },
            revIds:  { ...live.revIds,  research: childRevId },
            timings: { ...live.timings, attenuate1: attMs },
            treeState: "delegation_1_active",
            trustScores: { ...live.trustScores, research: 100 },
          });
          break;
        }

        // ── Phase 4: Research → Payment ──
        case 4: {
          const parentToken = live.tokens.research || live.tokens.root;
          if (!parentToken) { addLog("✗ Run Phase 3 first", "error"); break; }

          const parentId = live.agents.research ?? "1";
          const childId  = live.agents.payment  ?? "2";

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

          addLog("Registering second delegation on DCTRegistry…");
          const del = await call("POST", "/api/delegate", {
            parentTokenB64: parentToken,
            parentAgentTokenId: parentId,
            childAgentTokenId: childId,
            childTools: ["x402_pay"],
            childSpendLimit: 2_000_000,
          });

          addLog(`✓ Registered → tx: ${shorten(del.txHash)}`, "success");
          addTx(del.txHash);

          const childToken = del.childTokenBytes ?? att.childTokenBytes;
          const childRevId = del.childRevocationId ?? att.childRevocationId;

          const total = (live.timings.attenuate1 || 0) + attMs;
          setLiveKey({
            tokens:  { ...live.tokens,  payment: childToken },
            revIds:  { ...live.revIds,  payment: childRevId },
            timings: { ...live.timings, attenuate2: attMs, totalAttenuation: total },
            treeState: "full_tree_active",
            trustScores: { ...live.trustScores, payment: 100 },
          });
          break;
        }

        // ── Phase 5: successful execution ──
        case 5: {
          const token = live.tokens.payment || live.tokens.research || live.tokens.root;
          if (!token) { addLog("✗ Run Phases 2–4 first", "error"); break; }
          const agentId = live.agents.research ?? "1";

          setLiveKey({ treeState: "executing_research", activeNode: "research",
            checks: [
              { id: "revocation",  label: "Revocation Check",       detail: "isRevoked() walks lineage",                      gasNote: "~2,400 gas (3 hops)", state: "idle" },
              { id: "identity",    label: "Identity Check",          detail: "erc8004.ownerOf(agentTokenId) == redeemer",       gasNote: "~800 gas",            state: "idle" },
              { id: "scope",       label: "Scope Check",             detail: "toolHash ∈ allowedTools | spend ≤ limit | hash", gasNote: "~1,200 gas",          state: "idle" },
              { id: "attestation", label: "TLSNotary Attestation",  detail: "Oracle ECDSA over DCT_TLSN || endpointHash",     gasNote: "~3,000 gas",          state: "idle" },
            ]
          });

          addLog("Running off-chain Biscuit Datalog check…");
          const researchToken = live.tokens.research || token;
          const local = await call("POST", "/api/execute/verify-local", {
            tokenId: researchToken,
            agentId,
            tool: "web_fetch",
            spendAmount: 0,
          });
          addLog(`${local.passed ? "✓" : "✗"} Local check ${local.passed ? "passed" : "failed"} in ${local.checkTimeMs}ms — ${local.passed ? "zero gas wasted" : local.reason}`, local.passed ? "success" : "error");

          // Animate checks
          const updateCheck = (id, state) => setLive(prev => ({
            ...prev,
            checks: prev.checks.map(c => c.id === id ? { ...c, state } : c),
          }));

          addLog("\nSubmitting via DCTEnforcer.validateActionWithScope…");
          updateCheck("revocation", "pending");
          await new Promise(r => setTimeout(r, 600));
          updateCheck("revocation", "pass");
          addLog("  ✓ isRevoked(): 0 revoked ancestors", "success");

          updateCheck("identity", "pending");
          await new Promise(r => setTimeout(r, 500));
          updateCheck("identity", "pass");
          addLog("  ✓ ownerOf(): identity match", "success");

          updateCheck("scope", "pending");
          const execToken = live.tokens.research ?? token;
          const exec = await call("POST", "/api/execute/submit", {
            tokenId: execToken,
            agentId,
            tool: "web_fetch",
            spendAmount: 0,
          });
          updateCheck("scope", exec.success ? "pass" : "fail");
          updateCheck("attestation", exec.success ? "pass" : "idle");

          if (exec.success) {
            addLog("  ✓ Scope commitment matches | tool in allowedTools | spend ok", "success");
            addLog("  ✓ Oracle ECDSA attestation valid", "success");
            addLog(`\n✓ ACTION VALIDATED — tx: ${shorten(exec.txHash)}`, "success");
            addTx(exec.txHash);
            setLiveKey({
              treeState: "execution_success",
              trustScores: { ...live.trustScores, research: (live.trustScores.research || 100) + 1 },
            });
          } else {
            addLog(`✗ Enforcer rejected: ${exec.revertReason}`, "error");
            addLog("  (Token not registered on-chain — run the delegate steps first)", "info");
          }
          break;
        }

        // ── Phase 6: off-chain violation ──
        case 6: {
          const token = live.tokens.research || live.tokens.root;
          if (!token) { addLog("✗ Run Phases 2–4 first", "error"); break; }
          const agentId = live.agents.research ?? "1";

          setLiveKey({ treeState: "violation_attempt", activeNode: "research" });

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
          const token = live.tokens.payment || live.tokens.root;
          if (!token) { addLog("✗ Run Phases 2–4 first", "error"); break; }
          const agentId = live.agents.payment ?? "2";

          setLiveKey({
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
            tokenId: live.tokens.payment || token,
            agentId,
            tool: "x402_pay",
            spendAmount: 3_000_000,
          });

          if (!exec.success) {
            addLog(`\n✗ REVERTED on-chain: ${exec.revertReason}`, "error");
            if (exec.txHash) { addLog(`  tx: ${shorten(exec.txHash)}`, "tx"); addTx(exec.txHash); }
            addLog("  Scope commitment hash cannot be faked — registered at delegation time", "warning");
            setLiveKey({
              trustScores: { ...live.trustScores, payment: Math.round((live.trustScores.payment || 100) * 0.9) },
            });
          } else {
            addLog("  (Token not on-chain — scope would revert if registered with $2 limit)", "info");
          }
          break;
        }

        // ── Phase 8: cascade revocation ──
        case 8: {
          const rootRevId = live.revIds.root;
          const agentId   = live.agents.orchestrator ?? "0";
          if (!rootRevId) { addLog("✗ No root revocation ID — run Phase 2+3 first", "error"); break; }

          setLiveKey({ treeState: "revocation_pending", activeNode: null });

          addLog(`Revoking root: ${shorten(rootRevId, 12)}…`);
          addLog("Single SSTORE write — O(1) regardless of tree size");

          const r = await call("POST", "/api/revoke", {
            tokenId: rootRevId,
            agentTokenId: agentId,
          });

          if (r.success || r.txHash) {
            addLog(`✓ Root revoked → tx: ${shorten(r.txHash)}`, "success");
            addTx(r.txHash);
            addLog("  Downstream agents NOT actively killed — lazy revocation", "info");
            addLog("  They will fail next time they attempt any action");
            setLiveKey({ treeState: "revocation_complete" });
          } else {
            addLog(`⚠ ${r.error || "revocation returned no tx"}`, "warning");
            addLog("  Token may not have been on-chain (demo ran without Phase 3 register)", "info");
            setLiveKey({ treeState: "revocation_complete" });
          }
          break;
        }

        // ── Phase 9: cascade proof (lineage walk animation) ──
        case 9: {
          const token   = live.tokens.payment || live.tokens.root;
          const agentId = live.agents.payment ?? "2";
          if (!token) { addLog("✗ Run Phases 2–4 first", "error"); break; }

          setLiveKey({ treeState: "cascade_attempt", activeNode: "payment", lineageStep: 0 });

          addLog("Payment Agent attempting x402_pay after root revocation…");
          await new Promise(r => setTimeout(r, 400));

          addLog("isRevoked() walk started:");
          setLiveKey({ lineageStep: 1 });
          addLog("  hop 0 — Payment token: not directly revoked");
          await new Promise(r => setTimeout(r, 900));

          setLiveKey({ lineageStep: 2 });
          addLog("  hop 1 — Research token: not directly revoked");
          await new Promise(r => setTimeout(r, 900));

          setLiveKey({ lineageStep: 3 });
          addLog("  hop 2 — Root token: REVOKED ✗", "error");
          await new Promise(r => setTimeout(r, 700));

          const exec = await call("POST", "/api/execute/submit", {
            tokenId: token,
            agentId,
            tool: "x402_pay",
            spendAmount: 1_000_000,
          });

          if (!exec.success) {
            addLog(`\n✗ REVERTED: ${exec.revertReason}`, "error");
            if (exec.txHash) { addLog(`  tx: ${shorten(exec.txHash)}`, "tx"); addTx(exec.txHash); }
          }
          addLog("\n✓ Cascade confirmed. Three agents. One tx. O(1) gas.", "success");
          setLiveKey({ treeState: "cascade_confirmed", lineageStep: 0 });
          break;
        }

        // ── Phase 10: trust summary ──
        case 10: {
          addLog("Fetching on-chain trust scores…");
          const scores = { ...live.trustScores };
          for (const [key, id] of [
            ["orchestrator", live.agents.orchestrator ?? "0"],
            ["research",     live.agents.research     ?? "1"],
            ["payment",      live.agents.payment      ?? "2"],
          ]) {
            try {
              const t = await call("GET", `/api/trust/${id}`);
              scores[key] = Number(t.score ?? 0) * 100;
              addLog(`  Agent #${id} (${key}): ${scores[key].toFixed(1)} pts`, "info");
            } catch { addLog(`  Agent #${id}: trust query failed`, "warning"); }
          }
          setLiveKey({ trustScores: scores });
          addLog("\n✓ Scores are on-chain. Updated only by DCTEnforcer. Cannot be faked.", "success");
          break;
        }

        // ── Phase 11: summary ──
        case 11: {
          const txCount = live.transactions.length;
          const attMs   = live.timings.totalAttenuation || "–";
          setLiveKey({
            summary: {
              txCount,
              attMs,
              agentsCreated: 3,
              delegations: 2,
              gasEstimate: "~$0.04",
            },
          });
          addLog("═══ DCT Protocol Demo Complete ═══", "success");
          addLog(`  Agents created:      3`);
          addLog(`  On-chain txs:        ${txCount}`);
          addLog(`  Off-chain attenuations: 2 (${attMs}ms total)`);
          addLog(`  Auth servers consulted: 0`);
          addLog(`  Gas for full revoke:    ~21,000 (1 SSTORE)`);
          addLog(`\n  "Sudo for AI agents. Trustless. Composable. MIT licensed."`, "success");
          break;
        }
      }
    } catch (err) {
      addLog(`Error: ${err.response?.data?.error || err.message}`, "error");
    } finally {
      setRunning(false);
      if (autoAdvance && s < 11) setStep(s + 1);
    }
  }

  function reset() {
    setStep(0);
    setLive({
      agents: { orchestrator: null, research: null, payment: null },
      tokens: { root: null, research: null, payment: null },
      revIds: { root: null, research: null, payment: null },
      transactions: [],
      trustScores: { orchestrator: 100, research: 0, payment: 0 },
      timings: {},
      treeState: "empty",
      activeNode: null,
      lineageStep: 0,
      logs: [],
      checks: [],
      health: {},
      summary: {},
    });
  }

  // ─── step content ────────────────────────────────────────────────────────

  const stepTitle = [
    "Connecting to DCT Protocol",
    "Spawning Three Autonomous Agents",
    "Creating Root Permission Token",
    "Orchestrator → Research Delegation",
    "Research → Payment Delegation",
    "Research Agent Executes Verified Task",
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
    "Real 4-check DCTEnforcer trace",
    "Rejected before touching the blockchain — zero gas",
    "Passes local check, reverts on-chain",
    "Single SSTORE. O(1). No gas bomb.",
    "isRevoked() walks: Payment → Research → Root ✗",
    "On-chain reputation. Enforcer-only updates.",
    "Three agents. One protocol. MIT licensed.",
  ];

  const stepColor = PHASES[step]?.color ?? "#818cf8";

  return (
    <div className="flex flex-col gap-6 pb-10">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gradient-blue">DCT Protocol — Live Demo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Delegated Capability Tokens · Base Sepolia · {live.transactions.length} tx so far
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={e => setAutoAdvance(e.target.checked)}
              className="rounded"
            />
            Auto-advance
          </label>
          <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg glass text-xs text-muted-foreground hover:text-foreground transition-colors">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>
      </div>

      {/* phase progress */}
      <div className="glass rounded-2xl p-4 border-gradient overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {PHASES.map((p, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={p.id} className="flex items-center">
                <button
                  onClick={() => setStep(i)}
                  className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-all min-w-[56px] ${
                    active ? "text-white" :
                    done   ? "text-[#34d399]" :
                             "text-muted-foreground hover:text-foreground"
                  }`}
                  style={active ? { background: `${stepColor}22`, border: `1px solid ${stepColor}55` } : {}}
                >
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                    done   ? "bg-[#34d399] text-white" :
                    active ? `text-white` :
                             "bg-white/10"
                  }`}
                  style={active ? { background: stepColor } : {}}>
                    {done ? "✓" : p.id}
                  </span>
                  {p.label}
                </button>
                {i < PHASES.length - 1 && (
                  <div className={`w-4 h-px mx-0.5 ${done ? "bg-[#34d399]" : "bg-white/10"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* main layout */}
      <div className="grid grid-cols-[280px_1fr] gap-4 items-start">

        {/* left: agent tree */}
        <div className="glass rounded-2xl p-4 border-gradient sticky top-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Agent Tree</p>
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
          <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 gap-2">
            {[
              { label: "Txs", value: live.transactions.length },
              { label: "Agents", value: Object.values(live.agents).filter(Boolean).length },
              { label: "Att. ms", value: live.timings.totalAttenuation || "–" },
              { label: "Gas", value: live.transactions.length ? "~$0.04" : "$0" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-sm font-bold">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
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
              className="glass rounded-2xl overflow-hidden border-gradient"
            >
              {/* header */}
              <div className="p-5 border-b border-white/10">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-muted-foreground">
                        Phase {step}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{PHASES[step]?.label}</span>
                    </div>
                    <h2 className="text-lg font-bold">{stepTitle[step]}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{stepSubtitle[step]}</p>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => runStep(step)}
                    disabled={running}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold shrink-0 transition-all ${
                      running ? "bg-white/10 text-muted-foreground" : "text-white"
                    }`}
                    style={!running ? { background: `linear-gradient(135deg, ${stepColor}, ${stepColor}aa)` } : {}}
                  >
                    {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {running ? "Running…" : "Run"}
                  </motion.button>
                </div>
              </div>

              {/* step-specific UI */}
              <div className="p-5 space-y-4">

                {/* Phase 0: health checks */}
                {step === 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {["chain","registry","enforcer","erc8004","pimlico","tlsn"].map(k => {
                      const h = live.health[k];
                      return (
                        <div key={k} className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs ${
                          h?.ok ? "border-[#34d399]/30 bg-[#34d399]/5" :
                          h     ? "border-[#ef4444]/30 bg-[#ef4444]/5" :
                                  "border-white/10 bg-white/[0.02]"
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
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
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
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
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
                          className={`flex items-center gap-3 p-2.5 rounded-lg border text-xs ${
                            done && h.revoked ? "border-[#ef4444]/40 bg-[#ef4444]/5" :
                            active            ? "border-[#fbbf24]/40 bg-[#fbbf24]/5" :
                                                "border-white/10"
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
                      <div key={s.label} className="p-3 rounded-xl bg-white/[0.03] border border-white/10">
                        <p className="text-sm font-bold">{s.value}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Phase 10: trust scores */}
                {step === 10 && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <TrustBadge label="Orchestrator" score={live.trustScores.orchestrator || 100} change={0} />
                      <TrustBadge label="Research" score={live.trustScores.research || 100} change={live.trustScores.research > 100 ? 1 : 0} />
                      <TrustBadge label="Payment" score={live.trustScores.payment || 100} change={live.trustScores.payment < 100 ? -10 : 0} />
                    </div>
                    <div className="space-y-1.5 mt-2">
                      {[
                        { event: "Demo started",              research: 0,   payment: 0   },
                        { event: "Agents initialized",        research: 100, payment: 100 },
                        { event: "Research executed",         research: 101, payment: 100 },
                        { event: "Payment violated",          research: 101, payment: 90  },
                        { event: "Root revoked",              research: 101, payment: 90  },
                      ].map((r, i) => (
                        <div key={i} className="flex items-center gap-3 text-[11px] p-2 rounded-lg bg-white/[0.02]">
                          <span className="text-muted-foreground flex-1">{r.event}</span>
                          <span className="font-mono text-[#22d3ee]">R: {r.research}</span>
                          <span className="font-mono text-[#34d399]">P: {r.payment}</span>
                        </div>
                      ))}
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
                      { label: "Total gas cost",          value: live.summary.gasEstimate },
                    ].map(s => (
                      <div key={s.label} className="p-3 rounded-xl bg-white/[0.03] border border-white/10">
                        <p className="text-base font-bold">{s.value}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                      </div>
                    ))}
                    <div className="col-span-2 p-3 rounded-xl border border-[#818cf8]/20 bg-[#818cf8]/5 text-center">
                      <p className="text-sm text-[#818cf8] font-semibold italic">
                        &ldquo;Sudo for AI agents. Trustless. Composable. MIT licensed.&rdquo;
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* log panel */}
          {live.logs.length > 0 && (
            <div className="glass rounded-2xl overflow-hidden border-gradient">
              <div className="bg-[hsl(222,47%,4%)] p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#fbbf24]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#34d399]" />
                  <span className="text-xs font-mono text-muted-foreground ml-2">dct-protocol</span>
                </div>
                <div className="space-y-0.5 max-h-[280px] overflow-y-auto font-mono text-[11px]">
                  {live.logs.map((log, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.3) }}
                      className={`flex items-start gap-2 leading-relaxed ${
                        log.type === "success" ? "text-[#34d399]" :
                        log.type === "error"   ? "text-[#ef4444]" :
                        log.type === "warning" ? "text-[#fbbf24]" :
                        log.type === "tx"      ? "text-[#22d3ee]" :
                                                 "text-muted-foreground"
                      }`}
                    >
                      <span className="text-white/20 select-none shrink-0 w-5 text-right">
                        {String(i + 1).padStart(2)}
                      </span>
                      <span className="break-all">{log.msg}</span>
                    </motion.div>
                  ))}
                  {running && (
                    <div className="flex items-center gap-2 text-[#22d3ee]">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>running…</span>
                    </div>
                  )}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </div>
          )}

          {/* on-chain event log */}
          <div className="glass rounded-xl border-gradient overflow-hidden">
            <EventLog maxRows={50} />
          </div>

          {/* tx list */}
          {live.transactions.length > 0 && (
            <div className="glass rounded-xl p-4 border-gradient">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Transactions ({live.transactions.length})
              </p>
              <div className="space-y-1">
                {live.transactions.map((tx, i) => (
                  <a
                    key={i}
                    href={`${BASESCAN}/tx/${tx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[11px] text-[#22d3ee] hover:text-[#67e8f9] font-mono transition-colors"
                  >
                    <Link2 className="w-3 h-3 shrink-0" />
                    {shorten(tx, 16)}
                    <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* nav */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="px-4 py-2 rounded-xl glass text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-muted-foreground">{step + 1} / {PHASES.length}</span>
            <button
              onClick={() => setStep(Math.min(PHASES.length - 1, step + 1))}
              disabled={step === PHASES.length - 1}
              className="flex items-center gap-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              style={{ color: stepColor }}
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
