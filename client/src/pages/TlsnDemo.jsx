import { useState, useCallback, useMemo } from "react";
import { Loader2, Shield, Lock, AlertCircle, Copy, Check } from "lucide-react";
import Header from "../components/layout/Header";

/**
 * Browser TLSNotary — tlsn-js + WASM. Matches docker-compose.tlsn.yml defaults:
 *   notary http://127.0.0.1:7047  |  wstcp ws://127.0.0.1:55688 → example.com:443
 */

const DEFAULT_URL = "https://example.com/";

const DEFAULT_NOTARY =
  import.meta.env.VITE_TLSN_NOTARY_URL || "http://127.0.0.1:7047";

/** Pairs with `wstcp` service in docker-compose.tlsn.yml (example.com:443). */
const DEFAULT_WS_PROXY =
  import.meta.env.VITE_TLSN_WEBSOCKET_PROXY || "ws://127.0.0.1:55688";

function hostnameOf(urlStr) {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return "";
  }
}

export default function TlsnDemo() {
  const [targetUrl, setTargetUrl] = useState(DEFAULT_URL);
  const [notaryUrl, setNotaryUrl] = useState(DEFAULT_NOTARY);
  const [wsProxyUrl, setWsProxyUrl] = useState(DEFAULT_WS_PROXY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [presentation, setPresentation] = useState(null);
  const [copied, setCopied] = useState(false);

  const hostMismatch = useMemo(() => {
    const h = hostnameOf(targetUrl.trim());
    return h && h !== "example.com";
  }, [targetUrl]);

  const prove = useCallback(async () => {
    setError(null);
    setPresentation(null);
    const ws = wsProxyUrl.trim();
    if (!ws) {
      setError("WebSocket proxy URL is empty. Restore default ws://127.0.0.1:55688 after docker compose up.");
      return;
    }

    setBusy(true);
    try {
      const mod = await import("tlsn-js");
      await mod.default();
      const { Prover } = mod;

      const result = await Prover.notarize({
        url: targetUrl.trim(),
        notaryUrl: notaryUrl.trim(),
        websocketProxyUrl: ws.replace(/\/$/, ""),
        method: "GET",
        maxSentData: 4096,
        maxRecvData: 65536,
      });

      setPresentation(result);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [targetUrl, notaryUrl, wsProxyUrl]);

  const copyJson = () => {
    if (!presentation) return;
    navigator.clipboard.writeText(JSON.stringify(presentation, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <Header
        title="TLSNotary (browser)"
        subtitle="Defaults match docker compose: notary :7047 + wstcp :55688 → example.com"
      />

      <div className="nb-card space-y-4">
        {/* Instructions */}
        <div className="rounded-nb border-2 border-nb-accent-2 bg-nb-accent-2/10 p-4 text-sm text-nb-ink/70">
          <p className="font-display font-bold text-nb-ink mb-1">Zero-config path</p>
          <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
            <li>
              <code className="text-nb-accent-2 font-mono">docker compose -f docker-compose.tlsn.yml up -d</code>
            </li>
            <li>
              <code className="text-nb-accent-2 font-mono">cd client &amp;&amp; npm run dev</code> — open{" "}
              <code className="text-nb-accent-2 font-mono">/</code>
            </li>
            <li>
              Leave defaults (example.com + notary + ws proxy), click <strong className="text-nb-ink">Run TLSNotary prove</strong>
            </li>
          </ol>
        </div>

        {/* Info note */}
        <div className="flex items-start gap-3 text-sm text-nb-ink/60">
          <Shield className="w-5 h-5 shrink-0 text-nb-accent-2 mt-0.5" />
          <p>
            This uses <strong className="text-nb-ink">tlsn-js</strong> in the browser. The Node{" "}
            <code className="text-xs bg-nb-bg border border-nb-ink/20 px-1 rounded font-mono">demo:onchain</code> script is separate (oracle
            signing unless <code className="text-xs bg-nb-bg border border-nb-ink/20 px-1 font-mono">TLSN_PROVER_URL</code>).
          </p>
        </div>

        {/* Form fields */}
        <label className="block space-y-1">
          <span className="text-xs font-display font-semibold text-nb-ink/60">URL to attest (HTTPS)</span>
          <input
            className="nb-input font-mono"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
          />
          {hostMismatch && (
            <p className="text-[11px] text-nb-warn leading-snug font-display font-semibold">
              Docker <code className="text-[10px] font-mono">wstcp</code> tunnels <strong>example.com</strong> only. For{" "}
              <code className="text-[10px] font-mono">{hostnameOf(targetUrl)}</code>, run another wstcp to that host:port
              and set WebSocket proxy below to match.
            </p>
          )}
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-display font-semibold text-nb-ink/60">Notary URL</span>
          <input
            className="nb-input font-mono"
            value={notaryUrl}
            onChange={(e) => setNotaryUrl(e.target.value)}
            placeholder="http://127.0.0.1:7047"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-display font-semibold text-nb-ink/60 flex items-center gap-2">
            <Lock className="w-3 h-3" />
            WebSocket proxy
          </span>
          <input
            className="nb-input font-mono"
            value={wsProxyUrl}
            onChange={(e) => setWsProxyUrl(e.target.value)}
            placeholder="ws://127.0.0.1:55688"
          />
          <p className="text-[11px] text-nb-ink/50 leading-snug">
            Default <code className="text-[10px] font-mono bg-nb-bg border border-nb-ink/20 px-1 rounded">ws://127.0.0.1:55688</code> is the{" "}
            <code className="text-[10px] font-mono">wstcp</code> service in <code className="text-[10px] font-mono">docker-compose.tlsn.yml</code>.
            Override with <code className="text-[10px] font-mono">VITE_TLSN_WEBSOCKET_PROXY</code> if needed.
          </p>
        </label>

        {/* Run button */}
        <button
          type="button"
          onClick={prove}
          disabled={busy}
          className="nb-btn-secondary disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          {busy ? "Proving…" : "Run TLSNotary prove"}
        </button>

        {/* Error */}
        {error && (
          <div className="flex gap-2 rounded-nb border-2 border-nb-error bg-nb-error/10 p-3 text-sm text-nb-error">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
          </div>
        )}

        {/* Result */}
        {presentation && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-display font-bold text-nb-ok">PresentationJSON</span>
              <button
                type="button"
                onClick={copyJson}
                className="nb-pill hover:bg-nb-accent/30 transition-colors"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-[420px] overflow-auto rounded-nb bg-nb-ink p-4 text-[11px] font-mono leading-relaxed text-white/80 border-2 border-nb-ink">
              {JSON.stringify(presentation, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
