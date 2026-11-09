// Hook de Claude Code -> notch-pet. Manda lo justo del evento a la app local; si no esta abierta, no pasa nada.
// En PermissionRequest ademas espera a que respondas desde el notch y le pasa tu decision a Claude.
const fs = require('fs');
const http = require('http');
const { createHash } = require('crypto');

// Misma huella que asks.js: sirve para saber que una peticion ya se respondio en la ventana de Claude.
const fingerprint = (tool, input) => { const { answers, ...rest } = input || {}; return createHash('md5').update(`${tool}|${JSON.stringify(rest)}`).digest('hex'); };

let e = {};
try { e = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}

const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
const post = (path, body, timeout, done) => {
  const req = http.request({ host: '127.0.0.1', port: 47321, path, method: 'POST', timeout, headers: { 'Content-Type': 'application/json' } }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
  });
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.end(JSON.stringify(body));
};

if (e.hook_event_name === 'PermissionRequest') {
  // Espera como mucho 9,5 min (el hook tiene 10). Sin respuesta, Claude sigue con su dialogo de siempre.
  post('/permission', {
    session_id: e.session_id, cwd: e.cwd, tool_name: e.tool_name, tool_input: e.tool_input,
    permission_suggestions: e.permission_suggestions,
  }, 570e3, text => {
    try {
      const { decision } = JSON.parse(text);
      if (decision) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }));
    } catch {}
    process.exit(0);
  });
} else {
  post('/event', {
    session_id: e.session_id,
    hook_event_name: e.hook_event_name,
    cwd: e.cwd,
    tool_name: e.tool_name,
    tool_fp: e.hook_event_name === 'PostToolUse' ? fingerprint(e.tool_name, e.tool_input) : undefined,
    message: e.message,
    notification_type: e.notification_type,
    prompt: cut(e.prompt, 400),
    last_assistant_message: cut(e.last_assistant_message, 1000),
  }, 800, () => process.exit(0));
}
