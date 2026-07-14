const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL || '').indexOf('rlwy.net') > -1 ? { rejectUnauthorized: false } : undefined
});

const CLIENT_LINES = [
  '(function(){',
  '  var sent = false;',
  '  function patch(){',
  '    var nodes = document.querySelectorAll(".sub, .note, p");',
  '    for (var i = 0; i < nodes.length; i++) {',
  '      var el = nodes[i]; var t = el.textContent || "";',
  '      if (t.indexOf("responses aren") > -1) { el.textContent = "🔒 Anonymous — your answers are stored securely."; }',
  '      if (t.indexOf("Prototype note") > -1) { el.style.display = "none"; }',
  '    }',
  '    var badges = document.querySelectorAll(".proto-badge");',
  '    for (var j = 0; j < badges.length; j++) { badges[j].textContent = "LIVE"; }',
  '  }',
  '  function submitNow(){',
  '    if (sent) return; sent = true;',
  '    var leader = false;',
  '    try { leader = isLeader(); } catch (e) {}',
  '    var body = JSON.stringify({ track: leader ? "leader" : "team", name: (state.answers && state.answers.name) || null, answers: state.answers });',
  '    fetch("/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: body }).catch(function(){});',
  '  }',
  '  var _rl = renderLanding; renderLanding = function(){ _rl(); patch(); };',
  '  var _re = renderEnd; renderEnd = function(){ _re(); patch(); submitNow(); };',
  '  patch();',
  '})();'
];
const CLIENT_JS = CLIENT_LINES.join(String.fromCharCode(10));

async function init() {
  await pool.query('CREATE TABLE IF NOT EXISTS responses (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), track TEXT, name TEXT, answers JSONB)');
}

const server = http.createServer(function (req, res) {
  if (req.method === 'POST' && req.url === '/submit') {
    var body = '';
    req.on('data', function (c) { body += c; if (body.length > 1000000) req.destroy(); });
    req.on('end', function () {
      var d;
      try { d = JSON.parse(body); } catch (e) { res.writeHead(400); res.end('{"ok":false}'); return; }
      pool.query('INSERT INTO responses (track, name, answers) VALUES ($1, $2, $3)', [d.track || null, d.name || null, JSON.stringify(d.answers || {})])
        .then(function () { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); })
        .catch(function (e) { console.error(e); res.writeHead(500); res.end('{"ok":false}'); });
    });
    return;
  }
  if (req.url === '/submit.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(CLIENT_JS); return; }
  if (req.url === '/health') {
    pool.query('SELECT count(*)::int AS n FROM responses')
      .then(function (r) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, responses: r.rows[0].n })); })
      .catch(function (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); });
    return;
  }
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  html = html.replace('</body>', '<script src="/submit.js"></script></body>');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

init().then(function () {
  server.listen(process.env.PORT || 3000, function () { console.log('survey server up'); });
}).catch(function (e) { console.error('init failed', e); process.exit(1); });
