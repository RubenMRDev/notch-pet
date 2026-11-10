// Estado de las sesiones de Claude a partir de los eventos de los hooks.
const KEEP = 20;                  // como mucho se recuerdan las 20 sesiones mas recientes
// ponytail: si cancelas un turno con Esc no llega Stop; tras 10 min sin eventos "trabajando" pasa a "parada".
const STUCK_MS = 10 * 60e3;
const HAPPY_MS = 2 * 60e3;        // tras terminar, la mascota esta contenta 2 min
const BORED_MS = 30 * 60e3;       // 30 min sin nada -> se aburre
const SLEEP_MS = 2 * 3600e3;      // 2 h sin nada -> se duerme
const IMPATIENT_MS = 5 * 60e3;    // 5 min esperando tu permiso -> se impacienta

const NOT_PROMPT = /^\s*<(local-command|command-name|command-message|command-args|task-notification|system-reminder)/;

const isIdleNotice = e =>
  e.notification_type === 'idle_prompt' || /waiting for your input/i.test(text(e.message));

// Lo que llega de los hooks puede no ser texto (bloques, numeros, null): siempre se guarda como texto.
const text = v => (typeof v === 'string' ? v : v == null ? '' : Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : x?.text || '')).join('\n') : String(v?.text ?? v));

// Devuelve como estaba la sesion antes del evento (para avisos y estadisticas).
function apply(sessions, e, now = Date.now()) {
  const id = e.session_id;
  if (!id) return null;
  const old = sessions.get(id);
  const prev = old ? { status: old.status, at: old.at } : null;
  if (e.hook_event_name === 'SessionEnd') { sessions.delete(id); return prev; }

  const s = old || { id, status: 'idle', detail: '', prompt: '', tool: '' };
  s.cwd = text(e.cwd) || s.cwd;
  s.at = now;
  s.interrupted = false;
  switch (e.hook_event_name) {
    // Los avisos internos (tareas en segundo plano, comandos locales) no son peticiones tuyas.
    case 'UserPromptSubmit': s.status = 'working'; if (!NOT_PROMPT.test(text(e.prompt))) s.prompt = text(e.prompt); s.detail = ''; s.tool = ''; break;
    case 'PreToolUse': s.status = 'working'; s.detail = text(e.tool_name); s.tool = text(e.tool_name); break;
    case 'PostToolUse': s.status = 'working'; break;
    case 'Notification':
      if (isIdleNotice(e)) break;
      if (s.status !== 'waiting') s.waitingSince = now;
      s.status = 'waiting'; s.detail = text(e.message);
      break;
    case 'Stop': s.status = 'done'; s.detail = text(e.last_assistant_message); s.tool = ''; break;
  }
  sessions.set(id, s);
  return prev;
}

const toolKind = t =>
  /^(Read|Grep|Glob|LS)$/.test(t) ? 'read'
  : /Edit|Write/.test(t) ? 'edit'
  : /^(Bash|PowerShell)$/.test(t) ? 'term'
  : /^Web/.test(t) ? 'web'
  : '';

function view(sessions, now = Date.now()) {
  for (const s of [...sessions.values()].sort((a, b) => b.at - a.at).slice(KEEP)) sessions.delete(s.id);
  const list = [...sessions.values()]
    .map(s => ({ ...s, status: s.status === 'working' && now - s.at > STUCK_MS ? 'idle' : s.status }))
    .sort((a, b) => b.at - a.at);
  const of = st => list.filter(s => s.status === st);
  const last = list.length ? list[0].at : 0;
  const waiting = of('waiting'), working = of('working');
  const mood = waiting.length ? 'waiting'
    : working.length ? 'working'
    : of('done').some(s => now - s.at < HAPPY_MS) ? 'happy'
    : !list.length || now - last > SLEEP_MS ? 'sleep'
    : now - last > BORED_MS ? 'bored'
    : 'idle';
  return {
    mood,
    impatient: waiting.some(s => now - s.waitingSince > IMPATIENT_MS),
    tool: working.length ? toolKind(working[0].tool) : '',
    sessions: list,
    now,
  };
}

// Contador del dia: sesiones terminadas, herramientas usadas y tiempo trabajando.
function tally(stats, e, prev, now = Date.now()) {
  const day = new Date(now).toLocaleDateString('sv');
  if (stats.day !== day) Object.assign(stats, { day, done: 0, tools: 0, workMs: 0 });
  if (e.hook_event_name === 'Stop') stats.done++;
  if (e.hook_event_name === 'PreToolUse') stats.tools++;
  if (prev?.status === 'working') stats.workMs += Math.min(now - prev.at, 5 * 60e3);
  return stats;
}

// ¿Hay que enseñar que esta sesion acaba de terminar? mode: 'multi' (solo si habia otra trabajando), 'always', 'off'.
const announce = (mode, prevStatus, status, othersWorking) =>
  prevStatus === 'working' && status === 'done' && (mode === 'always' || (mode === 'multi' && othersWorking > 0));

module.exports = { apply, view, tally, toolKind, announce };

if (require.main === module) {
  const assert = require('assert');
  const m = new Map();
  const ev = (name, extra = {}, at = 0) => apply(m, { session_id: 'a', cwd: 'C:/x/proj', hook_event_name: name, ...extra }, at);
  assert.strictEqual(view(m, 0).mood, 'sleep');
  ev('UserPromptSubmit', { prompt: 'hola' });
  assert.strictEqual(view(m, 0).mood, 'working');
  ev('PreToolUse', { tool_name: 'Edit' });
  assert.strictEqual(view(m, 0).tool, 'edit');
  ev('Notification', { message: 'Claude needs your permission to use Bash' });
  assert.strictEqual(view(m, 0).mood, 'waiting');
  assert.strictEqual(view(m, IMPATIENT_MS - 1).impatient, false);
  assert.strictEqual(view(m, IMPATIENT_MS + 1).impatient, true);
  ev('PostToolUse');
  assert.strictEqual(view(m, 0).mood, 'working');
  assert.strictEqual(view(m, STUCK_MS + 1).sessions[0].status, 'idle');
  const prev = ev('Stop');
  assert.strictEqual(prev.status, 'working');
  assert.strictEqual(view(m, 0).mood, 'happy');
  ev('Notification', { message: 'Claude is waiting for your input' });
  assert.strictEqual(view(m, 0).sessions[0].status, 'done');
  assert.strictEqual(view(m, HAPPY_MS + 1).mood, 'idle');
  assert.strictEqual(view(m, BORED_MS + 1).mood, 'bored');
  assert.strictEqual(view(m, SLEEP_MS + 1).mood, 'sleep');
  ev('UserPromptSubmit', { prompt: '<task-notification><task-id>x</task-id>' });
  assert.strictEqual(m.get('a').prompt, 'hola', 'un aviso interno no pisa tu peticion');
  ev('Stop', { last_assistant_message: [{ type: 'text', text: 'en bloques' }] });
  assert.strictEqual(m.get('a').detail, 'en bloques', 'los bloques se guardan como texto');
  ev('PreToolUse', { tool_name: 42 });
  assert.strictEqual(m.get('a').tool, '42');
  ev('SessionEnd');
  assert.strictEqual(view(m, 0).sessions.length, 0);

  assert.deepStrictEqual(['Grep', 'MultiEdit', 'Bash', 'WebFetch', 'Task'].map(toolKind), ['read', 'edit', 'term', 'web', '']);

  const st = {};
  const day = new Date(2026, 10, 9, 12).getTime();
  tally(st, { hook_event_name: 'PreToolUse' }, { status: 'working', at: day - 60e3 }, day);
  tally(st, { hook_event_name: 'Stop' }, { status: 'working', at: day - 3600e3 }, day);
  assert.deepStrictEqual(st, { day: '2026-11-09', done: 1, tools: 1, workMs: 60e3 + 5 * 60e3 });
  tally(st, { hook_event_name: 'Stop' }, null, day + 24 * 3600e3);
  assert.strictEqual(st.done, 1, 'cambia de dia y empieza de cero');
  assert.strictEqual(announce('multi', 'working', 'done', 1), true);
  assert.strictEqual(announce('multi', 'working', 'done', 0), false, 'sola: no molesta');
  assert.strictEqual(announce('always', 'working', 'done', 0), true);
  assert.strictEqual(announce('off', 'working', 'done', 3), false);
  assert.strictEqual(announce('always', 'done', 'done', 1), false, 'solo al cambiar');
  console.log('state.js ok');
}
