'use strict';
// Usage (server BAND karke):  node remove-user.js <username>
// Example:                    node remove-user.js employee
// Us user ke leads admin ko chale jaate hain; user, sessions, attendance, leaves, events hat jaate hain.
const fs = require('fs'), path = require('path');
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const un = String(process.argv[2] || '').trim().toLowerCase();
if (!un) { console.log('Use: node remove-user.js <username>'); process.exit(1); }
if (!fs.existsSync(FILE)) { console.log('data file nahi mili: ' + FILE); process.exit(1); }
const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const t = Object.values(d.users).find(u => u.username === un);
if (!t) { console.log('User "' + un + '" nahi mila. Available: ' + Object.values(d.users).map(u => u.username).join(', ')); process.exit(1); }
const admins = Object.values(d.users).filter(u => u.role === 'admin' && u.id !== t.id);
if (!admins.length) { console.log('Kam se kam ek admin rehna chahiye. Is user ko nahi hata sakte.'); process.exit(1); }
fs.copyFileSync(FILE, FILE + '.before-remove.bak');
let moved = 0;
Object.values(d.docs.leads || {}).forEach(l => { if (l.assignedId === t.id) { l.assignedId = admins[0].id; moved++; } });
Object.keys(d.docs.leaves || {}).forEach(k => { if (d.docs.leaves[k].uid === t.id) delete d.docs.leaves[k]; });
Object.keys(d.docs.events || {}).forEach(k => { if (d.docs.events[k].uid === t.id) delete d.docs.events[k]; });
Object.keys(d.sessions || {}).forEach(k => { if (d.sessions[k].uid === t.id) delete d.sessions[k]; });
delete (d.att || {})[t.id];
delete d.users[t.id];
d.rev = (d.rev || 0) + 1;
fs.writeFileSync(FILE, JSON.stringify(d));
console.log('Removed "' + un + '". ' + moved + ' lead(s) admin "' + admins[0].username + '" ko assign hui. Backup: ' + FILE + '.before-remove.bak');
