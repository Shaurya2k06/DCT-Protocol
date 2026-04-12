import { useState, useCallback, useEffect, useRef } from "react";
import {
  Loader2,
  Shield,
  AlertCircle,
  Copy,
  Check,
  Server,
  Puzzle,
  Radio,
  Activity,
} from "lucide-react";
import Header from "../components/layout/Header";
import { getTlsnConfig, proveTlsn } from "../lib/api.js";
import { buildProvePlugin, verifierHttpToWsUrl } from "../lib/tlsn-plugin.js";

const DEFAULT_URL = "https://example.com/";
/** Public verifier — works with the Chrome Web Store extension without cloning tlsn-extension. Override in client/.env: VITE_TLSN_VERIFIER_URL=http://127.0.0.1:7047 */
const DEFAULT_VERIFIER =
  import.meta.env.VITE_TLSN_VERIFIER_URL?.trim() || "https://demo.tlsnotary.org";

/** Extension MPC proofs can run a long time; still cap so the UI never spins forever */
const EXTENSION_PROVE_TIMEOUT_MS = 15 * 60 * 1000;

function tlsnPresent() {
  return typeof window !== "undefined" && typeof window.tlsn?.execCode === "function";
}

function normalizeVerifierHttp(input) {
  const t = (input || "").trim() || DEFAULT_VERIFIER;
  if (/^wss:\/\//i.test(t)) return `https://${t.slice(6)}`;
  if (/^ws:\/\//i.test(t)) return `http://${t.slice(5)}`;
  if (!/^https?:\/\//i.test(t)) return `http://${t}`;
  return t;
}

function useTlsnExtension() {
  const [available, setAvailable] = useState(tlsnPresent);
  useEffect(() => {
    if (available) return;
    const onLoaded = () => setAvailable(true);
    window.addEventListener("tlsn_loaded", onLoaded);
    const poll = setInterval(() => {
      if (tlsnPresent()) {
        setAvailable(true);
        clearInterval(poll);
      }
    }, 400);
    const t = setTimeout(() => clearInterval(poll), 15_000);
    return () => {
      window.removeEventListener("tlsn_loaded", onLoaded);
      clearInterval(poll);
      clearTimeout(t);
    };
  }, [available]);
  return available;
}

export default function TlsnDemo() {
  const extensionAvailable = useTlsnExtension();
  const [mode, setMode] = useState(() => (tlsnPresent() ? "extension" : "api"));
  const [targetUrl, setTargetUrl] = useState(DEFAULT_URL);
  const [verifierUrl, setVerifierUrl] = useState(DEFAULT_VERIFIER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [config, setConfig] = useState(null);
  const [configErr, setConfigErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [trace, setTrace] = useState([]);
  const requestIdRef = useRef(null);
  const traceEndRef = useRef(null);

  const pushTrace = useCallback((source, phase, message, extra) => {
    setTrace((prev) => [
      ...prev.slice(-120),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        t: new Date().toLocaleTimeString(),
        source,
        phase,
        message,
        ...extra,
      },
    ]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getTlsnConfig()
      .then((c) => { if (!cancelled) setConfig(c); })
      .catch((e) => { if (!cancelled) setConfigErr(e?.message || String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function onMsg(ev) {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.type === "TLSN_PROVE_PROGRESS") {
        if (requestIdRef.current && ev.data.requestId !== requestIdRef.current) return;
        const { step, progress: p, message } = ev.data;
        setProgress({ step, progress: p, message });
        pushTrace("extension", step || "PROGRESS", message || step || "", { pct: p });
      }
      if (ev.data?.type === "TLSN_OFFSCREEN_LOG") {
        pushTrace("wasm", "LOG", ev.data.message, { level: ev.data.level });
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [pushTrace]);

  useEffect(() => {
    traceEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trace, busy]);

  const proveViaExtension = useCallback(async () => {
    const url = targetUrl.trim();
    if (!url) { setError("Enter a URL."); return; }
    setError(null);
    setResult(null);
    setProgress(null);
    setTrace([]);
    setBusy(true);
    const rid = `dct_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    requestIdRef.current = rid;
    const v = normalizeVerifierHttp(verifierUrl);
    pushTrace("page", "START", rid);
    pushTrace("page", "TARGET", url);
    pushTrace("page", "VERIFIER_HTTP", v);
    pushTrace("page", "VERIFIER_WS", verifierHttpToWsUrl(v));
    try {
      const code = buildProvePlugin(url, v);
      const execPromise = window.tlsn.execCode(code, { requestId: rid });
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              "Extension prove timed out. Check Verifier URL (default: https://demo.tlsnotary.org — try curl its /health). " +
                "For a local verifier, clone tlsnotary/tlsn-extension and run packages/verifier with cargo, " +
                "or set VITE_TLSN_VERIFIER_URL in client/.env and restart Vite."
            )
          );
        }, EXTENSION_PROVE_TIMEOUT_MS);
      });
      const res = await Promise.race([execPromise, timeoutPromise]);
      let parsed = res;
      if (typeof res === "string") {
        try { parsed = JSON.parse(res); } catch { parsed = { raw: res }; }
      }
      if (parsed && typeof parsed === "object" && parsed.error != null && parsed.results == null) {
        throw new Error(String(parsed.error));
      }
      setResult(parsed);
      pushTrace("page", "DONE", "ok");
    } catch (e) {
      console.error("[tlsn-ext] prove failed", e);
      const msg = e?.message || String(e);
      setError(msg);
      pushTrace("page", "ERROR", msg, { level: "error" });
    } finally {
      setBusy(false);
      requestIdRef.current = null;
    }
  }, [targetUrl, verifierUrl, pushTrace]);

  const proveViaApi = useCallback(async () => {
    const url = targetUrl.trim();
    if (!url) { setError("Enter a URL."); return; }
    setError(null);
    setResult(null);
    setProgress(null);
    setTrace([]);
    setBusy(true);
    const t0 = performance.now();
    pushTrace("api", "REQUEST", url);
    try {
      const data = await proveTlsn({ url, method: "GET" });
      const ms = Math.round(performance.now() - t0);
      setResult(data);
      pushTrace("api", "DONE", `${ms}ms`);
      if (data?.proof?.sessionHash) pushTrace("api", "SESSION", String(data.proof.sessionHash).slice(0, 32) + "…");
      if (data?.proofHash) pushTrace("api", "HASH", String(data.proofHash).slice(0, 20) + "…");
    } catch (e) {
      console.error("[tlsn-api] prove failed", e);
      const msg = e?.response?.data?.error || e?.message || String(e);
      setError(msg);
      pushTrace("api", "ERROR", msg, { level: "error" });
    } finally {
      setBusy(false);
    }
  }, [targetUrl, pushTrace]);

  const prove = mode === "extension" ? proveViaExtension : proveViaApi;

  const copyJson = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <Header title="TLSNotary" subtitle="" />

      <div className="nb-card space-y-4">
        <div className="flex flex-wrap gap-2">
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

        {mode === "extension" && (
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className="text-xs font-display font-semibold text-nb-ink/60">Verifier</span>
              <input
                className="nb-input font-mono text-xs"
                value={verifierUrl}
                onChange={(e) => setVerifierUrl(e.target.value)}
                placeholder={DEFAULT_VERIFIER}
              />
            </label>
            <p className="text-[11px] text-nb-ink/55 leading-snug">
              Enter the verifier HTTP origin (health{" "}
              <code className="text-nb-accent-2/90">GET /health</code>); the plugin converts it to{" "}
              <code className="text-nb-accent-2/90">wss://…</code> for{" "}
              <code className="text-nb-accent-2/90">prove()</code> per{" "}
              <a
                href="https://tlsnotary.org/docs/extension/plugins/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-nb-accent-2 hover:underline"
              >
                Plugin System
              </a>
              . Default public verifier: <code className="text-nb-accent-2/90">https://demo.tlsnotary.org</code>. Local:{" "}
              <code className="text-nb-accent-2/90">http://127.0.0.1:7047</code>. Or use Server API mode.
            </p>
          </div>
        )}

        {mode === "api" && config && (
          <ul className="font-mono text-[11px] space-y-0.5 text-nb-ink/70">
            <li>enabled: {String(config.enabled)}</li>
            <li>proverUrl: {config.proverUrl ?? "—"}</li>
            <li>notaryUrl: {config.notaryUrl ?? "—"}</li>
          </ul>
        )}
        {mode === "api" && configErr && (
          <p className="text-nb-error text-xs font-mono">{configErr}</p>
        )}

        <label className="block space-y-1">
          <span className="text-xs font-display font-semibold text-nb-ink/60">URL</span>
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
          {busy ? "…" : "Prove"}
        </button>

        {error && (
          <div className="flex gap-2 rounded-nb border-2 border-nb-error bg-nb-error/10 p-3 text-sm text-nb-error">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
          </div>
        )}
      </div>

      <div className="nb-card space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-nb-accent-2" />
          <span className="text-sm font-display font-bold text-nb-ink">Trace</span>
        </div>
        <div className="max-h-72 overflow-auto rounded-nb border-2 border-nb-ink/15 bg-nb-ink p-3 font-mono text-[10px] leading-relaxed">
          {trace.length === 0 && !busy && (
            <span className="text-white/35">—</span>
          )}
          {trace.map((row) => (
            <div key={row.id} className="border-b border-white/5 py-1.5 last:border-0">
              <span className="text-white/35">{row.t}</span>{" "}
              <span className="text-nb-accent-2/90">[{row.source}]</span>{" "}
              <span className="text-white/70 font-semibold">{row.phase}</span>
              {row.pct != null && <span className="text-white/45"> {Math.round(Number(row.pct) * 100)}%</span>}
              <div className="text-white/55 mt-0.5 whitespace-pre-wrap break-all">{row.message}</div>
            </div>
          ))}
          {busy && mode === "extension" && progress && (
            <div className="mt-2 pt-2 border-t border-white/10">
              <div className="flex justify-between text-white/60 mb-1">
                <span>{progress.message || progress.step}</span>
                <span>{Math.round((progress.progress ?? 0) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-nb-accent-2 transition-all"
                  style={{ width: `${Math.round((progress.progress ?? 0) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <div ref={traceEndRef} />
        </div>
      </div>

      {result && (
        <div className="nb-card space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-display font-bold text-nb-ok">Result</span>
            <button type="button" onClick={copyJson} className="nb-pill hover:bg-nb-accent/30 transition-colors">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="max-h-[420px] overflow-auto rounded-nb bg-nb-ink p-4 text-[11px] font-mono leading-relaxed text-white/80 border-2 border-nb-ink">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
