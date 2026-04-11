import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TLSN_BUILD = path.resolve(__dirname, 'node_modules/tlsn-js/build')

/**
 * Build a fully self-contained worker blob.
 *
 * Handles three message types:
 *   1. tlsn_initialize        – runs wasm.initialize() in worker context (Atomics.wait allowed!)
 *   2. web_spawn_start_spawner – rayon spawner, creates thread-pool workers
 *   3. web_spawn_start_worker  – rayon thread worker
 *
 * __SPAWN_URL = import.meta.url (the blob's own URL) so every sub-worker is the same
 * self-contained blob – no server requests from inside workers except the single
 * fetch("/tlsn_wasm_bg.wasm") that each __wbg_init() does.
 */
function buildWorkerBlob() {
  let wasmGlue = readFileSync(path.join(TLSN_BUILD, 'tlsn_wasm.js'), 'utf8')

  // 1. Remove static import — startSpawnerWorker is defined inline below.
  wasmGlue = wasmGlue.replace(
    /^import\{startSpawnerWorker\}from"[^"]+";/m,
    ''
  )
  // 2. Make the WASM binary URL absolute so it works from any blob: origin.
  wasmGlue = wasmGlue.replace(
    'new URL("tlsn_wasm_bg.wasm",import.meta.url)',
    'new URL("/tlsn_wasm_bg.wasm",self.location.origin+"/")'
  )
  // 3. Strip ESM re-exports at end (functions remain as local declarations).
  wasmGlue = wasmGlue.replace(/export\{[^}]+\};?\s*export\s+default\s+\w+;?\s*$/, '')

  return `"use strict";

// Capture this blob's own URL so every sub-worker is the same self-contained blob.
const __SPAWN_URL = import.meta.url;

// Patch Worker INSIDE every nested worker (init → spawner → rayon threads). The main
// thread patch in lib.js does not apply here — without this, wasm-bindgen may call
// new Worker("http://host/a6de…js") and Vite/transformMiddleware can hang the pool.
(function () {
  var _W = globalThis.Worker;
  if (typeof _W !== "function") return;
  function isSpawnUrl(s) {
    return s.indexOf("a6de6b189c13ad309102") !== -1 || s.indexOf("/spawn.js") !== -1;
  }
  globalThis.Worker = function (url, opts) {
    if (isSpawnUrl(String(url))) url = new URL(__SPAWN_URL);
    return new _W(url, opts);
  };
  try {
    globalThis.Worker.prototype = _W.prototype;
    Object.setPrototypeOf(globalThis.Worker, _W);
  } catch (_) {}
})();

// ── startSpawnerWorker ────────────────────────────────────────────────────
// Called by the inlined WASM glue when it needs to spawn a rayon worker.
async function startSpawnerWorker(mod, mem, spawner) {
  const worker = new Worker(new URL(__SPAWN_URL), { name: "web-spawn-spawner", type: "module" });
  worker.postMessage({ type: "web_spawn_start_spawner", data: [mod, mem, spawner.intoRaw()] });
  await new Promise((resolve) => {
    worker.addEventListener("message", function onMsg(ev) {
      if (ev.data === "web_spawn_spawner_ready") {
        worker.removeEventListener("message", onMsg);
        resolve();
      }
    });
  });
}

// ── Inlined tlsn_wasm.js glue (import removed, WASM URL made absolute) ───
${wasmGlue}

// ── Message dispatch ──────────────────────────────────────────────────────
function _on(type, fn) {
  self.addEventListener("message", async (ev) => {
    if (ev.data && ev.data.type === type) await fn(ev.data.data);
  });
}

// Initialise the WASM thread pool entirely within this worker so that
// memory.atomic.wait32 (Atomics.wait at the WASM level) is allowed.
// The main thread cannot call wasm.initialize() directly because Chrome
// forbids Atomics.wait on the main thread.
_on("tlsn_initialize", async function ([sharedMem, config, threads, wasmModule]) {
  try {
    if (!sharedMem) throw new Error("missing shared WebAssembly.Memory (postMessage clone failed — need crossOriginIsolated + shared memory)");
    // Prefer instantiating from the Module the main thread already compiled so we
    // never depend on fetch("/tlsn_wasm_bg.wasm") from this worker (COEP / stall).
    if (wasmModule) await __wbg_init({ module_or_path: wasmModule, memory: sharedMem });
    else await __wbg_init({ memory: sharedMem });
    await Promise.resolve(initialize(config, threads));
    postMessage("tlsn_init_done");
  } catch (e) {
    postMessage({
      type: "tlsn_init_error",
      message: String(e && e.message ? e.message : e),
      stack: String(e && e.stack ? e.stack : ""),
    });
  } finally {
    setTimeout(function () {
      try {
        self.close();
      } catch (_) {}
    }, 0);
  }
});

_on("web_spawn_start_spawner", async function ([mod, mem, spawnerPtr]) {
  await __wbg_init({ memory: mem });
  const spawner = web_spawn_recover_spawner(spawnerPtr);
  postMessage("web_spawn_spawner_ready");
  // Pass our own blob URL so every thread-pool worker is also self-contained.
  await spawner.run(__SPAWN_URL);
  self.close();
});

_on("web_spawn_start_worker", async function ([mod, mem, workerPtr]) {
  await __wbg_init({ memory: mem });
  web_spawn_start_worker(workerPtr);
  self.close();
});

// Handshake: synchronous ping so it runs before any other microtasks reorder delivery.
try {
  postMessage({ type: "tlsn_ping" });
} catch (e) {}
`
}

/**
 * tlsn-js ships a Webpack UMD bundle (lib.js).
 *
 * Two patches applied to the transformed source:
 *
 * 1. Worker constructor is replaced so that the spawner worker URL
 *    (a6de…js / /spawn.js) creates workers from a pre-built blob instead
 *    of fetching from Vite's server (which would be intercepted by
 *    transformMiddleware and fail).
 *
 * 2. `yield(0,t.initialize)(...)` in initTlsn is replaced with
 *    `yield __tlsnInitInWorker(...)` which runs wasm.initialize() inside
 *    the blob worker where memory.atomic.wait32 is allowed.
 */
function tlsnJsUmdShim() {
  const marker = '/*__tlsn_js_umd_shim__*/'
  let workerBlobCode = ''
  try {
    workerBlobCode = buildWorkerBlob()
  } catch (e) {
    console.error('[tlsn-js-umd-shim] failed to build worker blob:', e)
  }

  return {
    name: 'tlsn-js-umd-shim',
    enforce: 'pre',
    transform(code, id) {
      const n = id.replace(/\\/g, '/')
      if (!/tlsn-js\/build\/lib\.js/.test(n)) return null
      if (code.includes(marker)) return null

      // Fix Webpack public path so WASM chunk URLs are root-absolute.
      let webpackBody = code.replace(/n\.p\s*=\s*""/g, 'n.p="/"')

      // Move wasm.initialize() off the main thread — see __tlsnInitInWorker below.
      const INIT_NEEDLE =
        'yield(0,t.initialize)({level:n,crate_filters:void 0,span_events:void 0},r)'
      const INIT_REPLACE =
        'yield __tlsnInitInWorker({level:n,crate_filters:void 0,span_events:void 0},r,i.memory,t.default.__wbindgen_wasm_module)'

      if (webpackBody.includes(INIT_NEEDLE)) {
        webpackBody = webpackBody.replace(INIT_NEEDLE, INIT_REPLACE)
      } else {
        console.warn('[tlsn-js-umd-shim] WARNING: could not find yield(0,t.initialize) — Atomics.wait on main thread will still occur')
      }

      const workerPatch = `
(function () {
  /* Capture native Worker before SES / extensions replace globalThis.Worker */
  var _W = globalThis.Worker;
  if (typeof _W !== 'function') {
    console.error('[tlsn-js] globalThis.Worker is not a function — disable lockdown extensions for this page');
  }
  var _SRC = ${JSON.stringify(workerBlobCode)};
  var _url = null;
  function getBlobUrl() {
    if (!_url) _url = URL.createObjectURL(new Blob([_SRC], { type: 'text/javascript' }));
    return _url;
  }
  function isSpawnUrl(s) {
    return s.includes('a6de6b189c13ad309102') || /\\/spawn\\.js(\\?|$)/.test(s);
  }

  // Intercept spawner-worker creation → use self-contained blob instead.
  globalThis.Worker = function (url, opts) {
    if (isSpawnUrl(String(url))) url = getBlobUrl();
    return new _W(url, opts);
  };
  try {
    globalThis.Worker.prototype = _W.prototype;
    Object.setPrototypeOf(globalThis.Worker, _W);
  } catch (e) {
    console.warn('[tlsn-js] Worker prototype patch skipped (SES/lockdown may break spawner URLs)', e);
  }

  function compileWasmFallback() {
    var origin = typeof location !== 'undefined' && location.origin ? location.origin : '';
    return fetch(origin + '/tlsn_wasm_bg.wasm', { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('tlsn_wasm_bg.wasm HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        return WebAssembly.compile(buf);
      });
  }

  // Run wasm.initialize() inside a blob worker where Atomics.wait is allowed.
  globalThis.__tlsnInitInWorker = function (config, threads, sharedMem, wasmModule) {
    var modResolved = wasmModule != null ? Promise.resolve(wasmModule) : compileWasmFallback();
    return modResolved.then(function (mod) {
      return new Promise(function (resolve, reject) {
        var worker = new _W(getBlobUrl(), { type: 'module', name: 'tlsn-init-master' });
        var settled = false;
        var tmr = setTimeout(function () {
          if (!settled) {
            settled = true;
            try { worker.terminate(); } catch (_) {}
            reject(new Error('tlsn init worker timed out after 90s (no tlsn_init_done). If you see SES/lockdown in the console, try a clean profile or disable wallet extensions.)'));
          }
        }, 90000);
        function done() {
          if (settled) return;
          settled = true;
          clearTimeout(tmr);
          try { worker.terminate(); } catch (_) {}
        }
        worker.addEventListener('message', function (ev) {
          var d = ev.data;
          if (d && d.type === 'tlsn_ping') {
            try {
              worker.postMessage({ type: 'tlsn_initialize', data: [sharedMem, config, threads, mod] });
            } catch (e) {
              done();
              reject(e);
            }
            return;
          }
          if (d === 'tlsn_init_done') {
            done();
            resolve();
          } else if (d && d.type === 'tlsn_init_error') {
            done();
            reject(new Error(d.message || 'tlsn initialize failed in worker'));
          }
        });
        worker.addEventListener('error', function (ev) {
          done();
          reject(new Error(ev.message || 'tlsn-init worker error'));
        });
        worker.addEventListener('messageerror', function () {
          done();
          reject(new Error('tlsn-init worker messageerror (could not pass WebAssembly.Memory — crossOriginIsolated?)'));
        });
      });
    });
  };
})();
`

      const tail = `
${marker}
const __tlsn = module.exports;
export default __tlsn.default ?? __tlsn;
export const Prover = __tlsn.Prover;
export const Verifier = __tlsn.Verifier;
export const Presentation = __tlsn.Presentation;
export const Attestation = __tlsn.Attestation;
export const Secrets = __tlsn.Secrets;
export const NotaryServer = __tlsn.NotaryServer;
export const Transcript = __tlsn.Transcript;
export const mapStringToRange = __tlsn.mapStringToRange;
export const subtractRanges = __tlsn.subtractRanges;
`
      return {
        code:
          `${marker}var module={exports:{}};var exports=module.exports;\n` +
          workerPatch +
          webpackBody +
          tail,
        map: null,
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tlsnJsUmdShim(), react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'tlsn-js': path.resolve(__dirname, 'node_modules/tlsn-js/build/lib.js'),
    },
  },
  assetsInclude: ['**/*.wasm'],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  optimizeDeps: {
    exclude: ['tlsn-js'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
})
