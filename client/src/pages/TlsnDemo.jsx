import { useState, useCallback, useMemo } from "react";
import { Loader2, Shield, Lock, AlertCircle, Copy, Check } from "lucide-react";
import Header from "../components/layout/Header";
// Real ESM exports come from vite tlsn-js-umd-shim (see vite.config.js).
import initTlsn, { Prover } from "tlsn-js";

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

/** tlsn-wasm needs SharedArrayBuffer → page must be cross-origin isolated (Vite COOP+COEP). */
function tlsnEnvironmentError() {
  if (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated) {
    return (
      "TLSNotary WASM needs a cross-origin isolated page (SharedArrayBuffer). " +
      "Run `npm run dev` from client/ and reload; Vite must send COOP+COEP headers (see vite.config.js). " +
      "Do not open the app as a file:// URL. Restart the dev server after config changes."
    );
  }
  if (typeof SharedArrayBuffer === "undefined") {
    return "SharedArrayBuffer is unavailable in this browser/context — TLSNotary cannot run.";
  }
  return null;
}

/**
 * tlsn-wasm sets a global tracing subscriber once; calling initTlsn() again panics
 * ("global default trace dispatcher has already been set"). Must survive React remounts
 * (e.g. navigate away from /tlsn and back), so keep the promise at module scope — not useRef.
 */
let tlsnInitPromise = null;

/** Rayon thread count — use 1 first: fewer nested workers = fewer failure modes under Vite. */
const TLSN_INIT_OPTS = {
  loggingLevel: "Debug",
  hardwareConcurrency: 1,
};

const INIT_TLSN_TIMEOUT_MS = 120 * 1000;

async function assertTlsnRootAssetsOk() {
  /* Hashed Webpack chunks + ESM worker deps (tlsn_wasm.js loads tlsn_wasm_bg.wasm + snippets). */
  const files = [
    "96d038089797746d7695.wasm",
    "a6de6b189c13ad309102.js",
    "tlsn_wasm.js",
    "tlsn_wasm_bg.wasm",
  ];
  for (const f of files) {
    const r = await fetch(`/${f}`, { method: "HEAD", cache: "no-store" });
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    /* Reject SPA fallback: text/html matches ct.includes("text") — that hid broken dev serving. */
    const okWasm =
      f.endsWith(".wasm") &&
      r.ok &&
      !ct.includes("html") &&
      (ct.includes("wasm") || ct.includes("octet-stream"));
    const okJs =
      f.endsWith(".js") &&
      r.ok &&
      !ct.includes("html") &&
      (ct.includes("javascript") || ct.includes("ecmascript") || ct.includes("module"));
    if (!r.ok || (!okWasm && !okJs)) {
      console.error("[tlsn-demo] root asset check failed", { f, status: r.status, ct });
      throw new Error(
        `TLSN asset missing or wrong Content-Type: /${f} (got ${r.status}, ${ct || "no ct"}). ` +
          "Dev: tlsn middleware must run before Vite’s SPA fallback (see vite.config.js tlsn-root-assets)."
      );
    }
    if (import.meta.env.DEV) console.info("[tlsn-demo] HEAD ok", f, ct);
  }
}

function ensureTlsnInit() {
  if (!tlsnInitPromise) {
    if (import.meta.env.DEV) {
      console.info("[tlsn-demo] first initTlsn()", TLSN_INIT_OPTS);
    }
    const run = (async () => {
      await assertTlsnRootAssetsOk();
      await initTlsn(TLSN_INIT_OPTS);
      if (import.meta.env.DEV) console.info("[tlsn-demo] initTlsn() resolved");
    })();
    tlsnInitPromise = withTimeout(
      run,
      INIT_TLSN_TIMEOUT_MS,
      "initTlsn",
      "WASM/worker chain must load (GET /tlsn_wasm.js, /tlsn_wasm_bg.wasm, hashed chunks — not SPA HTML). See vite tlsn-root-assets. Notary/wstcp are only for Prove."
    ).catch((err) => {
      console.error("[tlsn-demo] initTlsn() failed", err);
      tlsnInitPromise = null;
      throw err;
    });
  } else if (import.meta.env.DEV) {
    console.info("[tlsn-demo] reusing existing initTlsn() promise");
  }
  return tlsnInitPromise;
}

function logProveError(prefix, e) {
  const msg = e?.message ?? String(e);
  console.error(`[tlsn-demo] ${prefix}`, msg, e);
  if (e?.stack) console.error("[tlsn-demo] stack", e.stack);
}

/** Notarize can hang if notary/wstcp/network stall — surface that after 5 minutes. */
const NOTARIZE_TIMEOUT_MS = 5 * 60 * 1000;

function withTimeout(promise, ms, label, hint) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = window.setTimeout(() => {
      const err = new Error(
        `${label} timed out after ${ms / 1000}s — ${hint}`
      );
      console.error("[tlsn-demo]", err.message);
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(t));
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
      const m = "WebSocket proxy URL is empty. Restore default ws://127.0.0.1:55688 after docker compose up.";
      console.warn("[tlsn-demo]", m);
      setError(m);
      return;
    }

    const t0 = performance.now();
    if (import.meta.env.DEV) {
      console.info("[tlsn-demo] prove start", {
        url: targetUrl.trim(),
        notaryUrl: notaryUrl.trim(),
        websocketProxyUrl: ws.replace(/\/$/, ""),
        crossOriginIsolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : "n/a",
      });
    }

    setBusy(true);
    try {
      const envErr = tlsnEnvironmentError();
      if (envErr) {
        console.warn("[tlsn-demo] environment check failed", envErr);
        setError(envErr);
        return;
      }

      if (typeof initTlsn !== "function" || typeof Prover?.notarize !== "function") {
        const m =
          "tlsn-js did not load (missing default init or Prover). Try reinstalling dependencies; the package is a browser Webpack bundle.";
        console.error("[tlsn-demo]", m, { initTlsn: typeof initTlsn, Prover: typeof Prover });
        setError(m);
        return;
      }

      if (import.meta.env.DEV) console.info("[tlsn-demo] await ensureTlsnInit() …");
      await ensureTlsnInit();
      if (import.meta.env.DEV) console.info(`[tlsn-demo] ensureTlsnInit done in ${(performance.now() - t0).toFixed(0)}ms`);

      if (import.meta.env.DEV) console.info("[tlsn-demo] Prover.notarize() … (can take minutes: notary + TLS)");
      const n0 = performance.now();
      const result = await withTimeout(
        Prover.notarize({
          url: targetUrl.trim(),
          notaryUrl: notaryUrl.trim(),
          websocketProxyUrl: ws.replace(/\/$/, ""),
          method: "GET",
          maxSentData: 4096,
          maxRecvData: 65536,
        }),
        NOTARIZE_TIMEOUT_MS,
        "Prover.notarize",
        "check notary :7047, wstcp :55688, and DevTools Network"
      );

      if (import.meta.env.DEV) {
        console.info(`[tlsn-demo] Prover.notarize ok in ${(performance.now() - n0).toFixed(0)}ms`, {
          version: result?.version,
          dataLen: result?.data?.length,
        });
      }
      setPresentation(result);
    } catch (e) {
      logProveError("prove failed", e);
      const display =
        e?.message ||
        (typeof e === "object" && e !== null && "toString" in e ? e.toString() : String(e));
      setError(display);
    } finally {
      setBusy(false);
      if (import.meta.env.DEV) {
        console.info(`[tlsn-demo] prove finished (busy cleared) total ${(performance.now() - t0).toFixed(0)}ms`);
      }
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
              <code className="text-nb-accent-2 font-mono">/tlsn</code>
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
        <p className="rounded-nb border-2 border-dashed border-nb-ink/25 bg-nb-bg px-3 py-2 text-[11px] leading-relaxed text-nb-ink/65">
          <strong className="text-nb-ink">What to enter:</strong> With{" "}
          <code className="font-mono text-[10px]">docker compose -f docker-compose.tlsn.yml up -d</code>, the bundled{" "}
          <strong className="text-nb-ink">wstcp</strong> connects the browser to{" "}
          <strong className="text-nb-ink">example.com:443</strong> only. So the URL to attest should stay{" "}
          <code className="font-mono text-[10px]">https://example.com/</code> (or another path on that host). To prove a{" "}
          <em>different</em> site, run another wstcp aimed at that host:port and point the WebSocket proxy at it — the
          default <code className="font-mono text-[10px]">example.com</code> setup is intentional, not arbitrary. Notary:{" "}
          <code className="font-mono text-[10px]">http://127.0.0.1:7047</code>, proxy:{" "}
          <code className="font-mono text-[10px]">ws://127.0.0.1:55688</code>.
        </p>

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
        <div className="mt-4 p-3 rounded-nb border-2 border-nb-ink/20 bg-nb-card text-[11px] text-nb-ink/70 leading-relaxed space-y-1">
          <p className="font-display font-semibold text-nb-ink text-xs">DCT trust scoring</p>
          <p>
            Validated actions feed the same three-signal model as{" "}
            <code className="text-[10px] font-mono text-nb-accent-2">pythonNodes/trustScores.py</code>{" "}
            (scope adherence + task completion + time-weighted outcome). The API exposes live composites via{" "}
            <code className="text-[10px] font-mono">GET /api/trust/:agentId</code> (demo) or{" "}
            <code className="text-[10px] font-mono">GET /api/agents/:tokenId/trust</code>.
          </p>
        </div>

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
