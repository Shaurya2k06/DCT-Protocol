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
    bg: "bg-nb-accent-2/10",
    badge: "bg-nb-accent-2",
    icon: "🔗",
    label: "Delegated",
  },
  DelegationRevoked: {
    bg: "bg-nb-error/10",
    badge: "bg-nb-error",
    icon: "🚫",
    label: "Revoked",
  },
  TrustUpdated: {
    bg: "bg-nb-warn/10",
    badge: "bg-nb-warn",
    icon: "⚡",
    label: "Trust",
  },
  ActionValidated: {
    bg: "bg-nb-ok/10",
    badge: "bg-nb-ok",
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
    bg: "bg-nb-bg",
    badge: "bg-nb-ink/60",
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
    <div className={`flex flex-col overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-nb-ink bg-nb-bg px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-display font-bold text-nb-ink">
          <span className="text-base">📡</span> Chain Events
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full border border-nb-ink ${
              connected ? "bg-nb-ok animate-pulse" : "bg-nb-error"
            }`}
          />
          <span className="text-xs font-display font-semibold text-nb-ink/60">
            {connected ? "live" : error ?? "offline"}
          </span>
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto min-h-0 max-h-96 bg-nb-card">
        {empty ? (
          <div className="flex h-24 items-center justify-center text-sm font-display font-semibold text-nb-ink/40">
            {connected ? "Waiting for on-chain events…" : "Connecting to event stream…"}
          </div>
        ) : (
          <ul className="divide-y-2 divide-nb-ink/10">
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
                        className={`px-1.5 py-0.5 rounded-nb text-[10px] font-display font-bold text-white border border-nb-ink ${style.badge}`}
                      >
                        {style.label}
                      </span>
                      <span className="truncate text-nb-ink">{detail}</span>
                    </div>
                    {txHash && (
                      <div className="mt-0.5 flex items-center gap-1">
                        <a
                          href={`https://sepolia.basescan.org/tx/${txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-nb-accent-2 hover:text-nb-accent underline"
                        >
                          {shortHash(txHash)}
                        </a>
                        {ev.blockNumber && (
                          <span className="text-nb-ink/50">
                            block {ev.blockNumber}
                          </span>
                        )}
                        <span className="ml-auto text-nb-ink/50">{ts}</span>
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
