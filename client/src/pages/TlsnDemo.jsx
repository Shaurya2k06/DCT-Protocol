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

      <div className="glass rounded-2xl p-6 border border-white/10 space-y-4">
        <div className="rounded-lg border border-[hsl(199,89%,48%)]/30 bg-[hsl(199,89%,48%)]/5 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Zero-config path</p>
          <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
            <li>
              <code className="text-[hsl(187,92%,69%)]">docker compose -f docker-compose.tlsn.yml up -d</code>
            </li>
            <li>
              <code className="text-[hsl(187,92%,69%)]">cd client &amp;&amp; npm run dev</code> — open{" "}
              <code className="text-[hsl(187,92%,69%)]">/</code>
            </li>
            <li>
              Leave defaults (example.com + notary + ws proxy), click <strong className="text-foreground">Run TLSNotary prove</strong>
            </li>
          </ol>
        </div>

        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <Shield className="w-5 h-5 shrink-0 text-[hsl(199,89%,48%)] mt-0.5" />
          <p>
            This uses <strong className="text-foreground">tlsn-js</strong> in the browser. The Node{" "}
            <code className="text-xs bg-white/10 px-1 rounded">demo:onchain</code> script is separate (oracle
            signing unless <code className="text-xs bg-white/10 px-1">TLSN_PROVER_URL</code>).
          </p>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">URL to attest (HTTPS)</span>
          <input
            className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm font-mono"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
          />
          {hostMismatch && (
            <p className="text-[11px] text-[hsl(38,92%,55%)] leading-snug">
              Docker <code className="text-[10px]">wstcp</code> tunnels <strong>example.com</strong> only. For{" "}
              <code className="text-[10px]">{hostnameOf(targetUrl)}</code>, run another wstcp to that host:port
              and set WebSocket proxy below to match.
            </p>
          )}
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Notary URL</span>
          <input
            className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm font-mono"
            value={notaryUrl}
            onChange={(e) => setNotaryUrl(e.target.value)}
            placeholder="http://127.0.0.1:7047"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground flex items-center gap-2">
            <Lock className="w-3 h-3" />
            WebSocket proxy
          </span>
          <input
            className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm font-mono"
            value={wsProxyUrl}
            onChange={(e) => setWsProxyUrl(e.target.value)}
            placeholder="ws://127.0.0.1:55688"
          />
          <p className="text-[11px] text-muted-foreground leading-snug">
            Default <code className="text-[10px] bg-white/5 px-1 rounded">ws://127.0.0.1:55688</code> is the{" "}
            <code className="text-[10px]">wstcp</code> service in <code className="text-[10px]">docker-compose.tlsn.yml</code>.
            Override with <code className="text-[10px]">VITE_TLSN_WEBSOCKET_PROXY</code> if needed.
          </p>
        </label>

        <button
          type="button"
          onClick={prove}
          disabled={busy}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[hsl(199,89%,48%)] to-[hsl(187,92%,39%)] text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          {busy ? "Proving…" : "Run TLSNotary prove"}
        </button>

        {error && (
          <div className="flex gap-2 rounded-lg border border-[hsl(0,72%,51%)]/40 bg-[hsl(0,72%,51%)]/10 p-3 text-sm text-[hsl(0,85%,75%)]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-mono text-xs">{error}</pre>
          </div>
        )}

        {presentation && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[hsl(142,76%,36%)]">PresentationJSON</span>
              <button
                type="button"
                onClick={copyJson}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-[420px] overflow-auto rounded-lg bg-[hsl(222,47%,6%)] p-4 text-[11px] font-mono leading-relaxed border border-white/10">
              {JSON.stringify(presentation, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
