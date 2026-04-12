/**
 * TLSNotary extension plugins — https://tlsnotary.org/docs/extension/plugins/
 *
 * Newer tlsn-extension builds require `export const config` with `requests[]`
 * (see permissionValidator.ts): each prove() must match method, host, pathname,
 * verifierUrl, and proxyUrl (or derived default).
 *
 * Use HTTP(S) verifier origin for `verifierUrl` in prove + config (matches docs);
 * proxy is wss/ws to /proxy?token=<host>.
 */

/**
 * Same derivation as tlsn-extension `deriveProxyUrl` (permissionValidator.ts).
 * @param {string} verifierHttpOrigin  e.g. https://demo.tlsnotary.org or http://127.0.0.1:7047
 * @param {string} targetHostname      e.g. example.com
 */
export function buildVerifierProxyUrl(verifierHttpOrigin, targetHostname) {
  const url = new URL(verifierHttpOrigin);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}/proxy?token=${targetHostname}`;
}

/**
 * @param {string} httpOrigin  Normalized http(s) origin
 * @returns {string}           Rough wss/ws origin for logging only
 */
export function verifierHttpToWsUrl(httpOrigin) {
  const t = (httpOrigin || "").trim().replace(/\/$/, "");
  if (/^wss:\/\//i.test(t)) return t;
  if (/^ws:\/\//i.test(t)) return t;
  if (!/^https?:\/\//i.test(t)) return `ws://${t}`;
  return t.replace(/^http/i, "ws");
}

/**
 * @param {string} url           Target HTTPS URL to prove (GET)
 * @param {string} verifierHttp  Verifier HTTP origin (GET /health); must match UI field
 * @returns {string}             Plugin source for window.tlsn.execCode
 */
export function buildProvePlugin(url, verifierHttp) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const proxyUrl = buildVerifierProxyUrl(verifierHttp, host);

  return `
export const config = {
  name: 'DCT TLSNotary',
  description: 'DCT /tlsn demo — prove GET to the URL you enter',
  requests: [
    {
      method: 'GET',
      host: ${JSON.stringify(host)},
      pathname: '**',
      verifierUrl: ${JSON.stringify(verifierHttp)},
    },
  ],
};

export function main() {
  useEffect(function () {
    prove(
      {
        url: ${JSON.stringify(url)},
        method: 'GET',
        headers: {
          Host: ${JSON.stringify(host)},
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          Connection: 'close',
          'User-Agent': 'Mozilla/5.0 (compatible) DCT-TlsnDemo/1.0',
        },
      },
      {
        verifierUrl: ${JSON.stringify(verifierHttp)},
        proxyUrl: ${JSON.stringify(proxyUrl)},
        maxRecvData: 16384,
        maxSentData: 4096,
        handlers: [
          { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
          { type: 'RECV', part: 'START_LINE', action: 'REVEAL' },
          { type: 'RECV', part: 'HEADERS', action: 'REVEAL', params: { key: 'content-type' } },
          { type: 'RECV', part: 'HEADERS', action: 'REVEAL', params: { key: 'date' } },
          { type: 'RECV', part: 'BODY', action: 'REVEAL' },
        ],
      }
    ).then(function (result) {
      done(result);
    }).catch(function (err) {
      var msg = err && err.message ? String(err.message) : String(err);
      done(JSON.stringify({ error: msg, source: 'DCT-TlsnDemo' }));
    });
  }, []);

  return div(
    { style: { padding: '16px', fontFamily: 'monospace', fontSize: '13px', color: '#e0e0e0', backgroundColor: '#1a1a2e', borderRadius: '8px' } },
    [
      div({ style: { fontWeight: 'bold', marginBottom: '8px', color: '#667eea' } }, ['DCT TLSNotary']),
      div({}, ['MPC proof running. Watch the extension overlay for progress.']),
    ]
  );
}
`;
}
