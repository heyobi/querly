/* Classic worker that hosts DuckDB-Wasm and makes extension loading work offline.
 *
 * DuckDB-Wasm asks the global `runtime.whereToLoad(name)` for the URL of an extension binary and then fetches it with a
 * synchronous XMLHttpRequest. We answer with a file shipped inside the app (public/duckdb/ext/...), so nothing is
 * downloaded. If synchronous XHR to the app's own origin does not work (the probe below says so), the page fetches the
 * binaries itself and hands us blob: URLs instead.
 *
 * Messages with a `__q` field (and a MessagePort for the answer) are ours; everything else goes to DuckDB. */
var DUCKDB_VERSION = 'v1.5.4';
var base = self.location.href.replace(/[^/]*$/, '');
var blobs = {};

self.runtime = {
  whereToLoad: function (name) {
    var n = String(name).split('/').pop().replace('.duckdb_extension.wasm', '');
    return blobs[n] || base + 'duckdb/ext/' + DUCKDB_VERSION + '/wasm_eh/' + n + '.duckdb_extension.wasm';
  },
};

self.addEventListener('message', function (e) {
  var d = e.data;
  if (!d || !d.__q) return;
  e.stopImmediatePropagation();
  // Replies go through the MessagePort sent with the request, never to DuckDB's own message channel.
  var reply = function (m) { (e.ports && e.ports[0] ? e.ports[0] : self).postMessage(m); };
  if (d.__q === 'probe') {
    var ok = false;
    try {
      var x = new XMLHttpRequest();
      x.open('GET', base + 'duckdb/ext/ok.txt', false);
      x.send(null);
      ok = x.status === 200 && x.responseText === 'ok';
    } catch (err) { ok = false; }
    reply({ __q: 'probe', ok: ok, version: DUCKDB_VERSION });
  } else if (d.__q === 'blob') {
    blobs[d.name] = d.url;
    reply({ __q: 'blob', name: d.name });
  }
});

importScripts(base + 'duckdb/duckdb-browser-eh.worker.js');
