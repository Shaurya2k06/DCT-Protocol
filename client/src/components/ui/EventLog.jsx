/**
 * EventLog — live on-chain event feed via SSE (GET /api/events).
 *
 * Shows DelegationRegistered, DelegationRevoked, TrustUpdated, ActionValidated
 * as they arrive from the server's chain-events subscriber.
 *
 * Usage:
 *   <EventLog maxRows={50} className="..." />
 */

import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

const EVENT_STYLE = {
  DelegationRegistered: {
    bg: "bg-blue-950/60",
    badge: "bg-blue-700",
    icon: "🔗",
    label: "Delegated",
  },
  DelegationRevoked: {
    bg: "bg-red-950/60",
    badge: "bg-red-700",
    icon: "🚫",
    label: "Revoked",
  },
  TrustUpdated: {
    bg: "bg-yellow-950/60",
    badge: "bg-yellow-700",
    icon: "⚡",
    label: "Trust",
  },
  ActionValidated: {
    bg: "bg-green-950/60",
    badge: "bg-green-600",
    icon: "✓",
    label: "Validated",
  },
};

function shortHash(h) {
  if (!h || typeof h !== "string") return "—";
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function formatEvent(ev) {
  const style = EVENT_STYLE[ev.type] || {
    bg: "bg-zinc-800",
    badge: "bg-zinc-600",
    icon: "·",
    label: ev.type,
  };

  let detail = "";
  if (ev.type === "DelegationRegistered") {
    detail = `child ${shortHash(ev.childId)} → agent #${ev.agentId ?? "?"}`;
  } else if (ev.type === "DelegationRevoked") {
    detail = `token ${shortHash(ev.tokenId)} — agent #${ev.agentId ?? "?"}`;
  } else if (ev.type === "TrustUpdated") {
    const dir = ev.wasViolation ? "↓ violation" : "↑ success";
    const score = ev.newScore
      ? ` score=${(Number(ev.newScore) / 1e18).toFixed(4)}`
      : "";
    detail = `agent #${ev.agentId ?? "?"} ${dir}${score}`;
  } else if (ev.type === "ActionValidated") {
    detail = `agent #${ev.agentId ?? "?"} ${ev.passed ? "PASSED ✓" : "FAILED ✗"} — ${shortHash(ev.revocationId)}`;
  }

  return { style, detail };
}

export default function EventLog({ maxRows = 60, className = "" }) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const esRef = useRef(null);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/events`);
    esRef.current = es;

    es.addEventListener("open", () => {
      setConnected(true);
      setError(null);
    });

    es.addEventListener("message", (e) => {
      try {
        const ev = JSON.parse(e.data);
        setEvents((prev) => {
          const next = [ev, ...prev];
          return next.length > maxRows ? next.slice(0, maxRows) : next;
        });
      } catch {
        /* ignore malformed SSE payloads */
      }
    });

    es.addEventListener("error", () => {
      setConnected(false);
      setError("Reconnecting…");
    });

    return () => {
      es.close();
    };
  }, [maxRows]);

  // Auto-scroll is top-prepend so newest is always first — no scroll needed.

  const empty = events.length === 0;

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/50">
        <div className="flex items-center gap-2 text-sm font-mono font-semibold text-zinc-200">
          <span className="text-base">📡</span> Chain Events
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-green-400 animate-pulse" : "bg-red-500"
            }`}
          />
          <span className="text-xs text-zinc-400">
            {connected ? "live" : error ?? "offline"}
          </span>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto min-h-0 max-h-96">
        {empty ? (
          <div className="flex items-center justify-center h-24 text-zinc-600 text-sm font-mono">
            {connected ? "Waiting for on-chain events…" : "Connecting to event stream…"}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/50">
            {events.map((ev, i) => {
              const { style, detail } = formatEvent(ev);
              const txHash = ev.txHash;
              const ts = ev.ts ? new Date(ev.ts).toLocaleTimeString() : "";

              return (
                <li
                  key={i}
                  className={`px-3 py-2 flex items-start gap-2.5 text-xs font-mono ${style.bg} transition-all`}
                >
                  <span className="mt-0.5 text-base leading-none">{style.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${style.badge}`}
                      >
                        {style.label}
                      </span>
                      <span className="text-zinc-300 truncate">{detail}</span>
                    </div>
                    {txHash && (
                      <div className="mt-0.5 flex items-center gap-1">
                        <a
                          href={`https://sepolia.basescan.org/tx/${txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 underline"
                        >
                          {shortHash(txHash)}
                        </a>
                        {ev.blockNumber && (
                          <span className="text-zinc-600">
                            block {ev.blockNumber}
                          </span>
                        )}
                        <span className="ml-auto text-zinc-600">{ts}</span>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
