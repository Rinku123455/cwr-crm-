'use strict';
// CWR CRM backend – zero dependencies. Run:  node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 3000;

const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const DIR = path.dirname(DATA);
const PHOTOS = path.join(DIR, 'photos'), BACKUPS = path.join(DIR, 'backups');
fs.mkdirSync(PHOTOS, { recursive: true }); fs.mkdirSync(BACKUPS, { recursive: true });
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

let data = { rev: 1, users: {}, sessions: {}, docs: { leads: {}, events: {}, projects: {}, leaves: {} }, att: {} };
if (fs.existsSync(DATA)) {
  try { data = Object.assign(data, JSON.parse(fs.readFileSync(DATA, 'utf8'))); }
  catch (e) { console.error('Cannot read ' + DATA + ' – fix or move it.'); process.exit(1); }
}
let st = null;
const flush = () => { const t = DATA + '.tmp'; fs.writeFileSync(t, JSON.stringify(data)); fs.renameSync(t, DATA); };
const persist = () => { clearTimeout(st); st = setTimeout(flush, 300); };
const touch = () => { data.rev++; persist(); };

// daily backup (keeps last 14) + expired-session cleanup
function backup() {
  try {
    flush();
    const f = path.join(BACKUPS, 'data-' + IST().date + '.json');
    fs.copyFileSync(DATA, f);
    fs.readdirSync(BACKUPS).filter(x => /^data-.*\.json$/.test(x)).sort().slice(0, -14).forEach(x => fs.unlinkSync(path.join(BACKUPS, x)));
  } catch (e) { console.error('Backup failed', e.message); }
}
function purgeSessions() { const n = Date.now(); Object.keys(data.sessions).forEach(k => { if (data.sessions[k].exp < n) delete data.sessions[k]; }); }
setInterval(() => { purgeSessions(); backup(); }, 6 * 3600 * 1000).unref();

['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => { try { flush(); } catch (e) {} process.exit(0); }));

/* ---------- helpers ---------- */
const rid = n => crypto.randomBytes(n).toString('hex');
const hash = (pw, salt = rid(16)) => salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
const verify = (pw, h) => { const [s, x] = String(h).split(':'); const a = Buffer.from(x, 'hex'), b = crypto.scryptSync(pw, s, 64); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const digits = p => String(p || '').replace(/\D/g, '').slice(-10);
const IST = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

// Remove leftover demo/test employee from older versions (leads go to the first admin)
(function () {
  const t = data.users['u_demoemployee'];
  if (!t || t.username !== 'employee') return;
  const adm = Object.values(data.users).find(u => u.role === 'admin');
  if (!adm) return;
  Object.values(data.docs.leads).forEach(l => { if (l.assignedId === t.id) l.assignedId = adm.id; });
  Object.keys(data.docs.events).forEach(k => { if (data.docs.events[k].uid === t.id) delete data.docs.events[k]; });
  Object.keys(data.docs.leaves).forEach(k => { if (data.docs.leaves[k].uid === t.id) delete data.docs.leaves[k]; });
  Object.keys(data.sessions).forEach(k => { if (data.sessions[k].uid === t.id) delete data.sessions[k]; });
  delete data.att[t.id]; delete data.users[t.id]; data.rev++; flush();
  console.log('Old demo employee removed.');
})();

class HttpErr extends Error { constructor(c, m) { super(m); this.c = c; } }
const fail = (c, m) => { throw new HttpErr(c, m); };
const pub = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, title: u.title || '', phone: u.phone || '' });

purgeSessions();
if (!Object.keys(data.users).length) {
  const un = (process.env.ADMIN_USER || 'admin').toLowerCase(), pw = process.env.ADMIN_PASS || 'admin123';
  const id = 'u_' + rid(6);
  data.users[id] = { id, username: un, name: 'Admin', role: 'admin', title: 'Admin', phone: '', pass: hash(pw), defaultPass: !process.env.ADMIN_PASS };
  ['Clove County', 'Experion Satori', 'Sobha Project', 'Ivory County', 'M3M Jacob & Co', 'Eldeco 7Peaks', 'Eldeco Woww', 'Nimbus Arishta']
    .forEach((n, i) => { data.docs.projects['P' + i] = { name: n }; });
  persist();
  console.log(`First run: admin user "${un}" created` + (process.env.ADMIN_PASS ? '.' : ` with password "${pw}" – change it after login!`));
}

flush(); backup();

/* ---------- http plumbing ---------- */
const send = (res, code, obj, extra = {}) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extra)); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  let b = '', n = 0;
  req.on('data', c => { n += c.length; if (n > 400000) { no(new HttpErr(413, 'Payload too large')); req.destroy(); } else b += c; });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(new HttpErr(400, 'Bad JSON')); } });
});
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')).filter(x => x[0]));
function portalCookie(req) {
  return String(req.headers['x-cwr-portal'] || '').toLowerCase() === 'employee'
    ? 'cwr_employee_sid'
    : 'cwr_admin_sid';
}
function authUser(req) {
  const jar = cookies(req), t = jar[portalCookie(req)], s = t && data.sessions[t];
  if (!s) return null;
  if (s.exp < Date.now()) { delete data.sessions[t]; return null; }
  return data.users[s.uid] || null;
}
const tries = {};
const clientIp = req => TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
const blocked = k => { const t = tries[k]; if (!t) return false; if (Date.now() - t.t > 60000) { delete tries[k]; return false; } return t.n >= 8; };
const failed = k => { const t = tries[k] || (tries[k] = { n: 0, t: Date.now() }); t.n++; };

/* ---------- document rules ---------- */
const COLS = ['leads', 'events', 'projects', 'leaves'];
const isMine = (u, lead) => !!lead && lead.assignedId === u.id;
function visible(u, c, d) {
  if (u.role === 'admin') return true;
  if (c === 'leads') return d.assignedId === u.id;
  if (c === 'events') return d.uid === u.id || isMine(u, data.docs.leads[d.leadId]);
  if (c === 'projects') return true;
  if (c === 'leaves') return d.uid === u.id;
  return false;
}
function checkPhone(id, b) {
  const ph = digits(b.phone);
  if (ph.length !== 10) fail(400, 'Enter a valid 10-digit mobile number');
  if (Object.entries(data.docs.leads).some(([k, l]) => k !== id && digits(l.phone) === ph)) fail(409, 'A lead with this number already exists');
}
function docSet(u, c, id, b, patch) {
  const docs = data.docs[c], old = docs[id], admin = u.role === 'admin';
  if (patch && !old) fail(404, 'Not found');
  if (old && !visible(u, c, old)) fail(403, 'Not allowed');
  b = Object.assign({}, b);
  if (!admin) {
    delete b.createdBy;
    if (c === 'projects') fail(403, 'Admin only');
    if (c === 'leaves') { if (old) fail(403, 'Admin only'); b.uid = u.id; b.status = 'Pending'; }
    if (c === 'leads') { b.assignedId = u.id; if (patch) delete b.assignedId; }
    if (c === 'events') { if (patch) { delete b.uid; } else b.uid = u.id; if (!patch || b.leadId) if (!isMine(u, data.docs.leads[b.leadId || old.leadId])) fail(403, 'Not your lead'); }
  } else if (c === 'leads' && !patch && !b.assignedId) b.assignedId = u.id;
  const out = patch ? Object.assign({}, old, b) : b;
  if (c === 'leads' && (!patch || 'phone' in b)) checkPhone(id, out);
  if (JSON.stringify(out).length > 60000) fail(413, 'Too large');
  docs[id] = out; touch();
}

/* ---------- attendance (server clock, IST) ---------- */
const eff = r => r.override || r.status;
const dayOf = (uid, d) => (data.att[uid] || {})[d];
const putDay = (uid, d, v) => { (data.att[uid] || (data.att[uid] = {}))[d] = v; touch(); };
const okPhoto = p => typeof p === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p) && p.length < 80000;
const savePhoto = (uid, d, k, p) => { const fn = uid + '_' + d + '_' + k + '.jpg'; fs.writeFileSync(path.join(PHOTOS, fn), Buffer.from(p.split(',')[1], 'base64')); return fn; };
const rowOut = (uid, r) => ({ uid, date: r.date, status: r.status, override: r.override || '', inTime: r.inTime || '', outTime: r.outTime || '', inPhoto: !!r.inPhoto, outPhoto: !!r.outPhoto });
const listAtt = uid => Object.values(data.att[uid] || {}).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 31).map(r => rowOut(uid, r));

/* ---------- API ---------- */
async function api(req, res, url) {
  const p = url.pathname, m = req.method, q = url.searchParams;
  if (p === '/api/health' && m === 'GET') return send(res, 200, {ok:true, service:'CWR CRM', version:'1.2-selfie', employeePortal:'/employee.html'});
    if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req), un = String(b.username || '').trim().toLowerCase(), key = clientIp(req) + '|' + un;
    if (blocked(key)) fail(429, 'Too many attempts – wait a minute');
    const u = Object.values(data.users).find(x => x.username === un);
    if (!u || !verify(String(b.password || ''), u.pass)) { failed(key); fail(401, 'Wrong username or password'); }
    delete tries[key];
    const t = rid(32); data.sessions[t] = { uid: u.id, exp: Date.now() + 30 * 864e5 }; persist();
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, Object.assign(pub(u), { defaultPass: !!u.defaultPass }), { 'Set-Cookie': `${portalCookie(req)}=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 86400}${secure}` });
  }
  const u = authUser(req);
  if (!u) fail(401, 'Login required');
  const admin = u.role === 'admin';

  if (p === '/api/logout' && m === 'POST') {
    const ck = portalCookie(req), sid = cookies(req)[ck];
    if (sid) delete data.sessions[sid];
    persist();
    return send(res, 200, { ok: 1 }, { 'Set-Cookie': `${ck}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }
  if (p === '/api/me') return send(res, 200, Object.assign(pub(u), { defaultPass: !!u.defaultPass }));
  if (p === '/api/rev') return send(res, 200, { rev: data.rev });
  if (p === '/api/password' && m === 'POST') {
    const b = await readBody(req);
    if (!verify(String(b.old || ''), u.pass)) fail(403, 'Current password is wrong');
    if (String(b.new || '').length < 6) fail(400, 'New password must be at least 6 characters');
    u.pass = hash(b.new); delete u.defaultPass; touch(); return send(res, 200, { ok: 1 });
  }

  /* users */
  if (p === '/api/users' && m === 'GET') return send(res, 200, Object.values(data.users).map(pub));
  if (p === '/api/users' && m === 'POST') {
    if (!admin) fail(403, 'Admin only');
    const b = await readBody(req), un = String(b.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(un)) fail(400, 'Username: 3-30 letters/numbers');
    if (!b.name || String(b.password || '').length < 6) fail(400, 'Name and a 6+ character password are required');
    if (Object.values(data.users).some(x => x.username === un)) fail(409, 'Username already exists');
    const id = 'u_' + rid(6);
    data.users[id] = { id, username: un, name: String(b.name).slice(0, 60), role: b.role === 'admin' ? 'admin' : 'employee', title: String(b.title || '').slice(0, 40), phone: String(b.phone || '').slice(0, 20), pass: hash(b.password), defaultPass: true };
    touch(); return send(res, 200, pub(data.users[id]));
  }
  let mm = p.match(/^\/api\/users\/(u_[A-Za-z0-9]+)$/);
  if (mm) {
    if (!admin) fail(403, 'Admin only');
    const t = data.users[mm[1]]; if (!t) fail(404, 'Not found');
    if (m === 'PATCH') {
      const b = await readBody(req);
      if (b.name) t.name = String(b.name).slice(0, 60);
      if ('title' in b) t.title = String(b.title).slice(0, 40);
      if ('phone' in b) t.phone = String(b.phone).slice(0, 20);
      if (b.role) {
        const r = b.role === 'admin' ? 'admin' : 'employee';
        if (t.role === 'admin' && r !== 'admin' && Object.values(data.users).filter(x => x.role === 'admin').length < 2) fail(400, 'Keep at least one admin');
        t.role = r;
      }
      if (b.password) { if (String(b.password).length < 6) fail(400, 'Password must be 6+ characters'); t.pass = hash(b.password); delete t.defaultPass; Object.keys(data.sessions).forEach(k => { if (data.sessions[k].uid === t.id) delete data.sessions[k]; }); }
      touch(); return send(res, 200, pub(t));
    }
    if (m === 'DELETE') {
      if (t.id === u.id) fail(400, 'You cannot remove yourself');
      Object.values(data.docs.leads).forEach(l => { if (l.assignedId === t.id) l.assignedId = u.id; });
      Object.keys(data.sessions).forEach(k => { if (data.sessions[k].uid === t.id) delete data.sessions[k]; });
      Object.keys(data.docs.events).forEach(k => { if (data.docs.events[k].uid === t.id) delete data.docs.events[k]; });
      Object.keys(data.docs.leaves).forEach(k => { if (data.docs.leaves[k].uid === t.id) delete data.docs.leaves[k]; });
      delete data.att[t.id];
      delete data.users[t.id];
      touch(); return send(res, 200, { ok: 1 });
    }
  }

  /* generic documents */
  if (p === '/api/col' && m === 'GET') {
    const c = q.get('c'); if (!COLS.includes(c)) fail(400, 'Unknown collection');
    return send(res, 200, Object.entries(data.docs[c]).filter(([, d]) => visible(u, c, d)).map(([id, d]) => ({ id, data: d })));
  }
  if (p === '/api/doc') {
    const c = q.get('c'), id = q.get('id');
    if (!COLS.includes(c) || !/^[A-Za-z0-9_-]{1,80}$/.test(id || '')) fail(400, 'Bad path');
    if (m === 'PUT' || m === 'PATCH') { const b = await readBody(req); if (typeof b !== 'object' || Array.isArray(b)) fail(400, 'Bad body'); docSet(u, c, id, b, m === 'PATCH'); return send(res, 200, { ok: 1 }); }
    if (m === 'DELETE') {
      const old = data.docs[c][id];
      if (old) {
        if (!visible(u, c, old) || (!admin && (c === 'projects' || c === 'leaves'))) fail(403, 'Not allowed');
        delete data.docs[c][id];
        if (c === 'leads') Object.keys(data.docs.events).forEach(k => { if (data.docs.events[k].leadId === id) delete data.docs.events[k]; });
        touch();
      }
      return send(res, 200, { ok: 1 });
    }
  }

  /* attendance */
  if (p === '/api/attendance' && m === 'GET') {
    if (q.get('all')) { if (!admin) fail(403, 'Admin only'); return send(res, 200, Object.keys(data.users).flatMap(listAtt)); }
    const uid = q.get('uid') || u.id; if (uid !== u.id && !admin) fail(403, 'Not allowed');
    return send(res, 200, listAtt(uid));
  }
  if (p === '/api/photo' && m === 'GET') {
    const uid = q.get('uid'), d = q.get('date'), k = q.get('k') === 'out' ? 'outPhoto' : 'inPhoto';
    if (uid !== u.id && !admin) fail(403, 'Not allowed');
    const r = dayOf(uid, d); if (!r || !r[k]) fail(404, 'No photo');
    let buf;
    if (String(r[k]).startsWith('data:')) buf = Buffer.from(r[k].split(',')[1], 'base64');
    else { try { buf = fs.readFileSync(path.join(PHOTOS, path.basename(r[k]))); } catch (e) { fail(404, 'No photo'); } }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' });
    return res.end(buf);
  }
  if (p === '/api/attendance/checkin' && m === 'POST') {
    const b = await readBody(req), n = IST();
    if (!okPhoto(b.photo)) fail(400, 'A live selfie is required');
    if (dayOf(u.id, n.date)) fail(409, 'Already marked today');
    const status = n.time > '11:00' ? 'Half Day' : n.time > '10:30' ? 'Late' : 'Present';
    putDay(u.id, n.date, { date: n.date, status, inTime: n.time, inPhoto: savePhoto(u.id, n.date, 'in', b.photo), outTime: '', outPhoto: '' });
    return send(res, 200, { status, time: n.time });
  }
  if (p === '/api/attendance/checkout' && m === 'POST') {
    const b = await readBody(req), n = IST(), r = dayOf(u.id, n.date);
    if (!okPhoto(b.photo)) fail(400, 'A live selfie is required');
    if (!r || ['Leave', 'Absent'].includes(eff(r)) || !r.inTime) fail(409, 'Check in first');
    if (r.outTime) fail(409, 'Already checked out');
    r.outTime = n.time; r.outPhoto = savePhoto(u.id, n.date, 'out', b.photo); touch();
    return send(res, 200, { time: n.time });
  }
  if (p === '/api/attendance/leave' && m === 'POST') {
    const n = IST(); if (dayOf(u.id, n.date)) fail(409, 'Already marked today');
    putDay(u.id, n.date, { date: n.date, status: 'Leave', inTime: '', inPhoto: '', outTime: '', outPhoto: '' });
    return send(res, 200, { ok: 1 });
  }
  if (p === '/api/attendance/mark' && m === 'POST') {
    if (!admin) fail(403, 'Admin only');
    const b = await readBody(req), n = IST();
    if (!data.users[b.uid] || !['Present', 'Late', 'Half Day', 'Leave', 'Absent'].includes(b.status)) fail(400, 'Bad request');
    const needsPhoto = ['Present', 'Late', 'Half Day'].includes(b.status);
    const r = dayOf(b.uid, n.date);
    if (needsPhoto && !(r && r.inPhoto) && !okPhoto(b.photo)) fail(400, 'A live selfie is required to mark attendance');
    if (r) {
      if (needsPhoto && !r.inPhoto) { r.inPhoto = savePhoto(b.uid, n.date, 'in', b.photo); r.inTime = r.inTime || n.time; }
      r.override = b.status; r.overrideBy = u.id; touch();
    } else if (needsPhoto) {
      putDay(b.uid, n.date, { date: n.date, status: b.status, inTime: n.time, inPhoto: savePhoto(b.uid, n.date, 'in', b.photo), outTime: '', outPhoto: '', overrideBy: u.id });
    } else putDay(b.uid, n.date, { date: n.date, status: b.status, inTime: '', inPhoto: '', outTime: '', outPhoto: '', overrideBy: u.id });
    return send(res, 200, { ok: 1 });
  }
  mm = p.match(/^\/api\/attendance\/(u_[A-Za-z0-9]+)\/(\d{4}-\d{2}-\d{2})$/);
  if (mm && m === 'PATCH') {
    if (!admin) fail(403, 'Admin only');
    const b = await readBody(req), r = dayOf(mm[1], mm[2]);
    if (!r || !['Present', 'Late', 'Half Day', 'Leave', 'Absent'].includes(b.override)) fail(400, 'Bad request');
    if (['Present', 'Late', 'Half Day'].includes(b.override) && !r.inPhoto) fail(400, 'Is din ki selfie nahi hai - Present/Late/Half Day nahi kar sakte');
    r.override = b.override; r.overrideBy = u.id; touch(); return send(res, 200, { ok: 1 });
  }
  fail(404, 'Not found');
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  console.log(new Date().toISOString(), req.method, url.pathname);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self)');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/employee': ['employee.html', 'text/html; charset=utf-8'], '/employee.html': ['employee.html', 'text/html; charset=utf-8'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/employee.webmanifest': ['employee.webmanifest', 'application/manifest+json'], '/sw.js': ['sw.js', 'text/javascript'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'] };
    const f = FILES[url.pathname];
    if (f) {
      res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, f[0])));
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    if (e instanceof HttpErr) return send(res, e.c, { error: e.message });
    console.error(e); send(res, 500, { error: 'Server error' });
  }
}).listen(PORT, () => console.log('CWR CRM running on http://localhost:' + PORT));
