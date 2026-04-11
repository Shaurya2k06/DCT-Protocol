/**
 * Generates a TLSNotary plugin script for the tlsn-extension.
 *
 * The extension runs this inside a sandboxed QuickJS WASM environment.
 * Available env: openWindow, useRequests, useHeaders, useEffect, useState,
 *   setState, prove, done, div, button.
 *
 * See PLUGIN.md in tlsnotary/tlsn-extension for the full API reference.
 *
 * @param {string} url          Target URL to prove (must be HTTPS)
 * @param {string} verifierUrl  Verifier endpoint (e.g. http://localhost:7047)
 * @returns {string}            JavaScript source the extension will execute
 */
export function buildProvePlugin(url, verifierUrl) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const proxyUrl = verifierUrl.replace(/^http/, "ws") + "/proxy?token=" + host;

  return `
// ── DCT TLSNotary prove plugin ────────────────────────────────────────
// Proves a GET request to ${host} using the TLSN extension + verifier.

function proveProgressBar() {
  var progress = useState('_proveProgress', null);
  if (!progress) return [];
  var pct = Math.round(progress.progress * 100) + '%';
  return [
    div({ style: { marginTop: '12px' } }, [
      div({ style: { height: '6px', backgroundColor: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' } }, [
        div({ style: { height: '100%', width: pct, background: 'linear-gradient(90deg, #667eea, #764ba2)', borderRadius: '3px', transition: 'width 0.4s ease' } }, []),
      ]),
      div({ style: { fontSize: '12px', color: '#6b7280', marginTop: '6px', textAlign: 'center' } }, [
        progress.message || progress.step || ''
      ]),
    ]),
  ];
}

function main() {
  var step  = useState('step',  'idle');
  var error = useState('error', '');

  useEffect(function () {
    setState('step', 'opening');
    openWindow(${JSON.stringify(url)}, { width: 900, height: 600, showOverlay: true });
  }, []);

  var reqs = useRequests(function (all) {
    return all.filter(function (r) { return r.url.indexOf(${JSON.stringify(host)}) !== -1; });
  });

  var headers = useHeaders(function (all) {
    return all.filter(function (h) { return h.url.indexOf(${JSON.stringify(host)}) !== -1; });
  });

  useEffect(function () {
    if (step !== 'opening' && step !== 'idle') return;
    if (!reqs || reqs.length === 0) return;
    setState('step', 'proving');

    var target = reqs[0];

    var reqHeaders = {};
    if (headers && headers.length > 0) {
      var h = headers[0];
      if (h.requestHeaders) {
        for (var i = 0; i < h.requestHeaders.length; i++) {
          reqHeaders[h.requestHeaders[i].name] = h.requestHeaders[i].value || '';
        }
      }
    }
    reqHeaders['Host'] = ${JSON.stringify(host)};
    reqHeaders['Accept-Encoding'] = 'identity';
    reqHeaders['Connection'] = 'close';

    prove(
      { url: target.url, method: target.method || 'GET', headers: reqHeaders },
      {
        verifierUrl: ${JSON.stringify(verifierUrl)},
        proxyUrl: ${JSON.stringify(proxyUrl)},
        maxRecvData: 16384,
        maxSentData: 4096,
        handlers: [
          { type: 'SENT',  part: 'START_LINE',  action: 'REVEAL' },
          { type: 'RECV',  part: 'START_LINE',  action: 'REVEAL' },
          { type: 'RECV',  part: 'HEADERS',     action: 'REVEAL', params: { key: 'content-type' } },
          { type: 'RECV',  part: 'HEADERS',     action: 'REVEAL', params: { key: 'date' } },
          { type: 'RECV',  part: 'BODY',        action: 'REVEAL' },
        ],
      }
    ).then(function (result) {
      setState('step', 'done');
      done(JSON.stringify(result));
    }).catch(function (err) {
      setState('step', 'error');
      setState('error', err.message || String(err));
    });
  }, [reqs, step]);

  var msg = 'Waiting…';
  if (step === 'idle')    msg = 'Initializing…';
  if (step === 'opening') msg = 'Opening ' + ${JSON.stringify(host)} + ' — browse normally until a request is captured.';
  if (step === 'proving') msg = 'Running MPC-TLS proof — this can take 30-60 s…';
  if (step === 'done')    msg = 'Proof complete!';
  if (step === 'error')   msg = 'Error: ' + error;

  return div({ style: { padding: '16px', fontFamily: 'monospace', fontSize: '13px', color: '#e0e0e0', backgroundColor: '#1a1a2e', borderRadius: '8px' } }, [
    div({ style: { fontWeight: 'bold', marginBottom: '8px', color: '#667eea' } }, ['DCT — TLSNotary Proof']),
    div({}, [msg]),
    ...proveProgressBar(),
  ]);
}

module.exports = { main: main };
`;
}
