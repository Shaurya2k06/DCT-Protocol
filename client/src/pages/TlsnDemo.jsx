import { useState, useCallback, useEffect, useRef } from "react";
import {
  Loader2,
  Shield,
  AlertCircle,
  Copy,
  Check,
  Server,
  Puzzle,
  ExternalLink,
  Radio,
} from "lucide-react";
import Header from "../components/layout/Header";
import { getTlsnConfig, proveTlsn } from "../lib/api.js";
import { buildProvePlugin } from "../lib/tlsn-plugin.js";

/**
 * TLSNotary demo — two proving modes:
 *
 * 1. **Extension** (preferred): Uses the maintained tlsn-extension Chrome extension.
 *    The page sends plugin code via `window.tlsn.execCode()` and the extension runs
 *    a real MPC-TLS proof in-browser with its bundled WASM prover.
 *    Install: https://github.com/tlsnotary/tlsn-extension
 *
 * 2. **Server API** (fallback): Calls `POST /api/tlsn/prove` on the DCT server,
 *    which proxies to `TLSN_PROVER_URL` (e.g. `npm run tlsn-prover`).
 */

const DEFAULT_URL = "https://example.com/";
const DEFAULT_VERIFIER = "http://localhost:7047";

const EXTENSION_URL = "https://github.com/tlsnotary/tlsn-extension";

function useTlsnExtension() {
  const [available, setAvailable] = useState(
    () => typeof window !== "undefined" && typeof window.tlsn?.execCode === "function"
  );
  useEffect(() => {
    if (available) return;
    const onLoaded = () => setAvailable(true);
    window.addEventListener("tlsn_loaded", onLoaded);
    const t = setTimeout(() => {
      if (typeof window.tlsn?.execCode === "function") setAvailable(true);
    }, 2000);
    return () => {
      window.removeEventListener("tlsn_loaded", onLoaded);
      clearTimeout(t);
    };
  }, [available]);
  return available;
}

export default function TlsnDemo() {
  const extensionAvailable = useTlsnExtension();

  const [mode, setMode] = useState("extension");
  const [targetUrl, setTargetUrl] = useState(DEFAULT_URL);
  const [verifierUrl, setVerifierUrl] = useState(DEFAULT_VERIFIER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [config, setConfig] = useState(null);
  const [configErr, setConfigErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [logs, setLogs] = useState([]);
  const requestIdRef = useRef(null);
  const logsEndRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getTlsnConfig()
      .then((c) => { if (!cancelled) setConfig(c); })
      .catch((e) => { if (!cancelled) setConfigErr(e?.message || String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onMsg(ev) {
      if (ev.data?.type === "TLSN_PROVE_PROGRESS") {
        if (requestIdRef.current && ev.data.requestId !== requestIdRef.current) return;
        setProgress({ step: ev.data.step, progress: ev.data.progress, message: ev.data.message });
      }
      if (ev.data?.type === "TLSN_OFFSCREEN_LOG") {
        const ts = new Date().toLocaleTimeString();
        setLogs((prev) => [...prev.slice(-200), { ts, msg: ev.data.message, level: ev.data.level }]);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const proveViaExtension = useCallback(async () => {
    const url = targetUrl.trim();
    if (!url) { setError("Enter a URL."); return; }
    setError(null);
    setResult(null);
    setProgress(null);
    setBusy(true);
    const rid = `dct_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    requestIdRef.current = rid;
    try {
      const code = buildProvePlugin(url, verifierUrl.trim() || DEFAULT_VERIFIER);
      const res = await window.tlsn.execCode(code, { requestId: rid });
      setResult(res);
    } catch (e) {
      console.error("[tlsn-ext] prove failed", e);
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
      requestIdRef.current = null;
    }
  }, [targetUrl, verifierUrl]);

  const proveViaApi = useCallback(async () => {
    const url = targetUrl.trim();
    if (!url) { setError("Enter a URL."); return; }
    setError(null);
    setResult(null);
    setProgress(null);
    setBusy(true);
    try {
      const data = await proveTlsn({ url, method: "GET" });
      setResult(data);
    } catch (e) {
      console.error("[tlsn-api] prove failed", e);
      setError(e?.response?.data?.error || e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [targetUrl]);

  const prove = mode === "extension" ? proveViaExtension : proveViaApi;

  const copyJson = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <Header
        title="TLSNotary"
        subtitle="MPC-TLS proof — via browser extension or server API"
      />

      <div className="nb-card space-y-4">
        {/* Mode picker */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("extension")}
            className={`nb-pill flex items-center gap-1.5 transition-colors ${mode === "extension" ? "bg-nb-accent-2/20 text-nb-accent-2 border-nb-accent-2" : ""}`}
          >
            <Puzzle className="w-3.5 h-3.5" />
            Extension
            {extensionAvailable && <Radio className="w-3 h-3 text-nb-ok" />}
          </button>
          <button
            type="button"
            onClick={() => setMode("api")}
            className={`nb-pill flex items-center gap-1.5 transition-colors ${mode === "api" ? "bg-nb-accent-2/20 text-nb-accent-2 border-nb-accent-2" : ""}`}
          >
            <Server className="w-3.5 h-3.5" />
            Server API
          </button>
        </div>

        {/* Extension panel */}
        {mode === "extension" && (
          <div className="rounded-nb border-2 border-nb-accent-2 bg-nb-accent-2/10 p-4 text-sm text-nb-ink/70 space-y-2">
            <p className="font-display font-bold text-nb-ink">
              {extensionAvailable ? "TLSN Extension detected" : "TLSN Extension not detected"}
            </p>
            {extensionAvailable ? (
              <p className="text-xs leading-relaxed">
                The Chrome extension will open a window, intercept the request, and run an MPC-TLS
                proof via the verifier. Progress appears below.
              </p>
            ) : (
              <div className="text-xs leading-relaxed space-y-1">
                <p>
                  Install the{" "}
                  <a href={EXTENSION_URL} target="_blank" rel="noopener noreferrer" className="text-nb-accent-2 underline">
                    TLSN Extension
                    <ExternalLink className="inline w-3 h-3 ml-0.5 -mt-0.5" />
                  </a>{" "}
                  (or load the unpacked dev build), then reload this page.
                </p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Clone <code className="font-mono text-[10px]">tlsnotary/tlsn-extension</code>, run <code className="font-mono text-[10px]">npm install && npm run dev</code></li>
                  <li>Chrome → <code className="font-mono text-[10px]">chrome://extensions</code> → Load unpacked → <code className="font-mono text-[10px]">packages/extension/build</code></li>
                  <li>Start verifier: <code className="font-mono text-[10px]">cd packages/verifier && cargo run</code> (or <code className="font-mono text-[10px]">docker compose -f docker-compose.tlsn.yml up -d</code>)</li>
                  <li>Reload this page — the extension injects <code className="font-mono text-[10px]">window.tlsn</code></li>
                </ol>
              </div>
            )}

            <label className="block space-y-1 pt-1">
              <span className="text-xs font-display font-semibold text-nb-ink/60">Verifier URL</span>
              <input
                className="nb-input font-mono text-xs"
                value={verifierUrl}
                onChange={(e) => setVerifierUrl(e.target.value)}
                placeholder="ws://localhost:7047"
              />
            </label>
          </div>
        )}

        {/* Server API panel */}
        {mode === "api" && (
          <div className="rounded-nb border-2 border-nb-ink/15 bg-nb-bg p-4 text-sm text-nb-ink/70 space-y-2">
            <p className="font-display font-bold text-nb-ink">Server API</p>
            <p className="text-xs leading-relaxed">
              Calls <code className="font-mono text-[10px]">POST /api/tlsn/prove</code> on your DCT
              server. Requires <code className="font-mono text-[10px]">TLSN_PROVER_URL</code> in{" "}
              <code className="font-mono text-[10px]">server/.env</code> + <code className="font-mono text-[10px]">npm run tlsn-prover</code>.
            </p>
            {configErr && <p className="text-nb-error text-xs font-mono">{configErr}</p>}
            {config && (
              <ul className="font-mono text-[11px] space-y-0.5">
                <li><span className="text-nb-ink/50">enabled:</span> {String(config.enabled)}</li>
                <li><span className="text-nb-ink/50">proverUrl:</span> {config.proverUrl ?? "—"}</li>
                <li><span className="text-nb-ink/50">notaryUrl:</span> {config.notaryUrl ?? "—"}</li>
              </ul>
            )}
          </div>
        )}

        {/* URL + button */}
        <label className="block space-y-1">
          <span className="text-xs font-display font-semibold text-nb-ink/60">URL to prove (HTTPS)</span>
          <input
            className="nb-input font-mono"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
          />
        </label>

        <button
          type="button"
          onClick={prove}
          disabled={busy || (mode === "extension" && !extensionAvailable)}
          className="nb-btn-secondary disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          {busy ? "Proving…" : mode === "extension" ? "Prove via extension" : "Prove via API"}
        </button>

        {/* Progress (extension mode) */}
        {mode === "extension" && progress && busy && (
          <div className="rounded-nb border border-nb-accent-2/30 bg-nb-accent-2/5 p-3 text-xs font-mono space-y-1">
            <div className="flex items-center justify-between text-nb-ink/70">
              <span>{progress.message || progress.step || "…"}</span>
              <span>{Math.round((progress.progress ?? 0) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-nb-ink/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-nb-accent-2 transition-all"
                style={{ width: `${Math.round((progress.progress ?? 0) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex gap-2 rounded-nb border-2 border-nb-error bg-nb-error/10 p-3 text-sm text-nb-error">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-display font-bold text-nb-ok">Result</span>
              <button type="button" onClick={copyJson} className="nb-pill hover:bg-nb-accent/30 transition-colors">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied" : "Copy JSON"}
              </button>
            </div>
            <pre className="max-h-[420px] overflow-auto rounded-nb bg-nb-ink p-4 text-[11px] font-mono leading-relaxed text-white/80 border-2 border-nb-ink">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Extension log console */}
      {mode === "extension" && logs.length > 0 && (
        <div className="nb-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-display font-bold text-nb-ink">Extension logs</span>
            <button type="button" onClick={() => setLogs([])} className="nb-pill text-[10px]">Clear</button>
          </div>
          <div className="max-h-48 overflow-auto rounded-nb bg-nb-ink p-3 text-[10px] font-mono leading-relaxed text-white/70 border-2 border-nb-ink">
            {logs.map((l, i) => (
              <div key={i} className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-400" : ""}>
                <span className="text-white/30">{l.ts}</span>{" "}{l.msg}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
