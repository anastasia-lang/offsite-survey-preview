const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL || '').indexOf('rlwy.net') > -1 ? { rejectUnauthorized: false } : undefined
});

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const ALLOWED_DOMAIN = (process.env.ALLOWED_DOMAIN || 'y.uno').toLowerCase();
const ADMIN_EMAILS = (process.env.DASHBOARD_ADMINS || 'anastasia@y.uno').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean);
const COOKIE_NAME = 'ysurv';
const COOKIE_MAX_AGE = 604800;

function sign(payload) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
}

function makeToken(role) {
  const payload = (role === 'adm' ? 'adm' : 'ok') + '.' + (Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE);
  return payload + '.' + sign(payload);
}

function cookieRole(req) {
  const header = req.headers.cookie || '';
  const parts = header.split(';');
  for (let i = 0; i < parts.length; i++) {
    const kv = parts[i].trim();
    if (kv.indexOf(COOKIE_NAME + '=') === 0) {
      const token = kv.slice(COOKIE_NAME.length + 1);
      const seg = token.split('.');
      if (seg.length !== 3 || (seg[0] !== 'ok' && seg[0] !== 'adm')) return null;
      const payload = seg[0] + '.' + seg[1];
      let expected;
      try { expected = sign(payload); } catch (e) { return null; }
      if (expected.length !== seg[2].length) return null;
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(seg[2]))) return null;
      if (parseInt(seg[1], 10) < Math.floor(Date.now() / 1000)) return null;
      return seg[0];
    }
  }
  return null;
}

function hasValidCookie(req) { return cookieRole(req) !== null; }

function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

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

const LOGIN_LINES = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '<title>The Yuno Offsite — Survey</title>',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">',
  '<style>',
  ':root{--blue:#3E4FE0;--blue-dark:#2F35C8;--ink:#0A0A0F;--muted:#5A5F6E;--paper:#FAFAF7;--card:#FFFFFF;--line:rgba(10,10,15,.12);--radius:16px;}',
  '*{box-sizing:border-box;margin:0;padding:0;}',
  'html,body{height:100%;}',
  'body{font-family:"Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--paper);color:var(--ink);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}',
  '.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:48px 40px;max-width:440px;width:100%;text-align:center;box-shadow:0 8px 40px rgba(10,10,15,.06);}',
  '.kicker{font-family:"Geist Mono",monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--blue);margin-bottom:16px;}',
  'h1{font-size:32px;line-height:1.15;letter-spacing:-.02em;margin-bottom:12px;}',
  '.sub{color:var(--muted);font-size:15px;line-height:1.55;margin-bottom:28px;}',
  '.gwrap{display:flex;justify-content:center;margin-bottom:20px;}',
  '.note{font-size:13px;color:var(--muted);}',
  '.err{color:#C0392B;font-size:14px;margin-top:16px;min-height:18px;}',
  '</style>',
  '</head>',
  '<body>',
  '<div class="card">',
  '<div class="kicker">Yuno Offsite 2026</div>',
  '<h1>The offsite,<br>but better.</h1>',
  '<div class="sub">Sign in with your Yuno Google account to open the survey.</div>',
  '<div class="gwrap">',
  '<div id="g_id_onload" data-client_id="__CLIENT_ID__" data-callback="onCred" data-auto_select="false" data-itp_support="true"></div>',
  '<div class="g_id_signin" data-type="standard" data-shape="pill" data-theme="filled_blue" data-size="large" data-text="continue_with"></div>',
  '</div>',
  '<div class="note">🔒 Only used to check you’re part of Yuno — answers stay anonymous.</div>',
  '<div class="err" id="err"></div>',
  '</div>',
  '<script>',
  'function onCred(resp){',
  '  fetch("/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: resp.credential }) })',
  '    .then(function(r){ return r.json(); })',
  '    .then(function(d){',
  '      if (d.ok) { location.reload(); }',
  '      else { document.getElementById("err").textContent = "Sorry — you need a @y.uno Google account to open this survey."; }',
  '    })',
  '    .catch(function(){ document.getElementById("err").textContent = "Something went wrong. Please try again."; });',
  '}',
  '</script>',
  '<script src="https://accounts.google.com/gsi/client" async defer></script>',
  '</body>',
  '</html>'
];
const LOGIN_HTML = LOGIN_LINES.join(String.fromCharCode(10));

function readBody(req, cb) {
  var body = '';
  req.on('data', function (c) { body += c; if (body.length > 1000000) req.destroy(); });
  req.on('end', function () { cb(body); });
}

async function init() {
  await pool.query('CREATE TABLE IF NOT EXISTS responses (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), track TEXT, name TEXT, answers JSONB)');
}

const server = http.createServer(function (req, res) {
  if (req.method === 'POST' && req.url === '/auth') {
    readBody(req, function (body) {
      var d;
      try { d = JSON.parse(body); } catch (e) { res.writeHead(400); res.end('{"ok":false}'); return; }
      if (!d.credential) { res.writeHead(400); res.end('{"ok":false}'); return; }
      fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(d.credential))
        .then(function (r) { return r.json(); })
        .then(function (info) {
          var email = (info.email || '').toLowerCase();
          var okAud = info.aud === GOOGLE_CLIENT_ID;
          var okIss = info.iss === 'https://accounts.google.com' || info.iss === 'accounts.google.com';
          var okVerified = info.email_verified === 'true' || info.email_verified === true;
          var okDomain = email.length > ALLOWED_DOMAIN.length + 1 && email.slice(-(ALLOWED_DOMAIN.length + 1)) === '@' + ALLOWED_DOMAIN;
          if (okAud && okIss && okVerified && okDomain) {
            var role = ADMIN_EMAILS.indexOf(email) > -1 ? 'adm' : 'ok';
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Set-Cookie': COOKIE_NAME + '=' + makeToken(role) + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + COOKIE_MAX_AGE
            });
            res.end('{"ok":true}');
          } else {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end('{"ok":false}');
          }
        })
        .catch(function () { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); });
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/submit') {
    if (!hasValidCookie(req)) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"auth"}'); return; }
    readBody(req, function (body) {
      var d;
      try { d = JSON.parse(body); } catch (e) { res.writeHead(400); res.end('{"ok":false}'); return; }
      pool.query('INSERT INTO responses (track, name, answers) VALUES ($1, $2, $3)', [d.track || null, d.name || null, JSON.stringify(d.answers || {})])
        .then(function () { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); })
        .catch(function (e) { console.error(e); res.writeHead(500); res.end('{"ok":false}'); });
    });
    return;
  }
  if (req.url === '/submit.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(CLIENT_JS); return; }
  if (req.url === '/results' || req.url === '/results/') {
    var role1 = cookieRole(req);
    if (role1 !== 'adm') {
      res.writeHead(role1 === 'ok' ? 403 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      var page = LOGIN_HTML.replace('__CLIENT_ID__', GOOGLE_CLIENT_ID);
      if (role1 === 'ok') {
        page = page.replace('Sign in with your Yuno Google account to open the survey.', 'This results dashboard is restricted to the organizing team. If you were just added, sign in again below.');
      }
      res.end(page);
      return;
    }
    var dash;
    try { dash = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8'); } catch (e) { res.writeHead(500); res.end('dashboard missing'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(dash);
    return;
  }
  if (req.url === '/results/data.json') {
    if (cookieRole(req) !== 'adm') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); return; }
    pool.query('SELECT id, created_at, track, name, answers FROM responses ORDER BY created_at DESC')
      .then(function (r) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ ok: true, responses: r.rows })); })
      .catch(function (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); });
    return;
  }
  if (req.url === '/results/export.csv') {
    if (cookieRole(req) !== 'adm') { res.writeHead(403); res.end('forbidden'); return; }
    pool.query('SELECT id, created_at, track, name, answers FROM responses ORDER BY created_at')
      .then(function (r) {
        var keys = [];
        r.rows.forEach(function (row) {
          Object.keys(row.answers || {}).forEach(function (k) { if (k !== 'name' && keys.indexOf(k) === -1) keys.push(k); });
        });
        var lines = ['id,created_at,track,name,' + keys.join(',')];
        r.rows.forEach(function (row) {
          var a = row.answers || {};
          lines.push([row.id, row.created_at.toISOString(), row.track || '', row.name || ''].map(csvCell).join(',') + ',' + keys.map(function (k) { return csvCell(a[k]); }).join(','));
        });
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="offsite-survey-responses.csv"' });
        res.end(lines.join(String.fromCharCode(10)));
      })
      .catch(function (e) { res.writeHead(500); res.end('error: ' + e.message); });
    return;
  }
  if (req.url === '/health') {
    pool.query('SELECT count(*)::int AS n FROM responses')
      .then(function (r) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, responses: r.rows[0].n })); })
      .catch(function (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); });
    return;
  }
  if (!hasValidCookie(req)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(LOGIN_HTML.replace('__CLIENT_ID__', GOOGLE_CLIENT_ID));
    return;
  }
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  if (req.url === '/leaders' || req.url === '/leaders/') {
    html = html.replace('<canvas', '<script>window.__LEADER_ONLY = true;</script><canvas');
  }
  html = html.replace('</body>', '<script src="/submit.js"></script></body>');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
});

init().then(function () {
  server.listen(process.env.PORT || 3000, function () { console.log('survey server up'); });
}).catch(function (e) { console.error('init failed', e); process.exit(1); });
