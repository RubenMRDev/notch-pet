// Hook de Claude Code -> notch-pet. Manda lo justo del evento a la app local; si no esta abierta, no pasa nada.
const fs = require('fs');
const http = require('http');

let e = {};
try { e = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}

const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
const body = JSON.stringify({
  session_id: e.session_id,
  hook_event_name: e.hook_event_name,
  cwd: e.cwd,
  tool_name: e.tool_name,
  message: e.message,
  notification_type: e.notification_type,
  prompt: cut(e.prompt, 400),
  last_assistant_message: cut(e.last_assistant_message, 1000),
});

const req = http.request(
  { host: '127.0.0.1', port: 47321, path: '/event', method: 'POST', timeout: 800,
    headers: { 'Content-Type': 'application/json' } },
  res => res.resume().on('end', () => process.exit(0)),
);
req.on('error', () => process.exit(0));
req.on('timeout', () => process.exit(0));
req.end(body);
