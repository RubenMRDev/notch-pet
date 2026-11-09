// Al arrancar, recupera las sesiones recientes leyendo el final de sus transcripciones (~/.claude/projects/*/*.jsonl).
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.claude', 'projects');
const TAIL = 256 * 1024;

const textOf = c => (typeof c === 'string' ? c : (c || []).filter(x => x.type === 'text').map(x => x.text).join('\n'));

// Mensajes de "usuario" que no los has escrito tu: comandos locales (/login), avisos de tareas, recordatorios.
const NOT_PROMPT = /^\s*<(local-command|command-name|command-message|command-args|task-notification|system-reminder)/;
const INTERRUPTED = /^\s*\[Request interrupted/;

// De las ultimas lineas de una transcripcion saca titulo, carpeta, estado, ultimo mensaje y ultima peticion.
function parseTail(lines) {
  let cwd, title = '', last, lastText = '', prompt = '', ended = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    let j; try { j = JSON.parse(lines[i]); } catch { continue; }
    cwd ||= j.cwd;
    title ||= j.customTitle || j.aiTitle || '';
    // stop_hook_summary se escribe al terminar un turno: si va despues del ultimo mensaje, el turno acabo.
    if (!last && j.type === 'system' && j.subtype === 'stop_hook_summary') ended = true;
    if (j.isSidechain || j.isMeta || !['user', 'assistant'].includes(j.type)) continue;
    const c = j.message?.content, text = textOf(c);
    const isResult = Array.isArray(c) && c.some(x => x.type === 'tool_result');
    if (j.type === 'user' && !isResult && NOT_PROMPT.test(text)) continue;
    last ||= j;
    if (!lastText && j.type === 'assistant' && text) lastText = text;
    if (!prompt && j.type === 'user' && !isResult && !INTERRUPTED.test(text)) prompt = text;
    if (cwd && title && lastText && prompt) break;
  }
  if (!last) return null;
  const c = last.message?.content;
  const tool = Array.isArray(c) && c.find(x => x.type === 'tool_use');
  const interrupted = last.type === 'user' && INTERRUPTED.test(textOf(c));
  const s = ended || interrupted || (last.type === 'assistant' && !tool)
    ? { status: interrupted ? 'idle' : 'done', detail: interrupted ? 'Interrumpida' : lastText || 'Terminado', tool: '' }
    : { status: 'working', detail: tool ? tool.name : 'Pensando…', tool: tool ? tool.name : '' };
  return { cwd, title, prompt, ...s };
}

function tailLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, len = Math.min(size, TAIL);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    if (len < size) lines.shift(); // la primera puede venir cortada
    return lines.filter(Boolean);
  } finally { fs.closeSync(fd); }
}

// Las `limit` conversaciones con actividad mas reciente, sean de cuando sean.
function recover(limit, dir = DIR) {
  const files = [];
  let projects = [];
  try { projects = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return []; }
  for (const p of projects) {
    const pdir = path.join(dir, p.name);
    for (const f of fs.readdirSync(pdir)) {
      if (!f.endsWith('.jsonl')) continue;
      try { files.push({ file: path.join(pdir, f), id: f.slice(0, -6), at: fs.statSync(path.join(pdir, f)).mtimeMs }); } catch {}
    }
  }
  const out = [];
  for (const { file, id, at } of files.sort((a, b) => b.at - a.at)) {
    if (out.length >= limit) break;
    try {
      const s = parseTail(tailLines(file));
      if (s) out.push({ id, at, ...s, detail: s.detail.slice(0, 1000), prompt: s.prompt.slice(0, 400) });
    } catch {}
  }
  return out;
}

module.exports = { recover, parseTail };

if (require.main === module) {
  const assert = require('assert');
  const L = o => JSON.stringify(o);
  const user = t => L({ type: 'user', cwd: 'C:/p', message: { content: t } });
  const done = parseTail([user('hola'), L({ type: 'assistant', message: { content: [{ type: 'text', text: 'listo' }] } }), L({ type: 'agent-name' })]);
  assert.deepStrictEqual(done, { cwd: 'C:/p', title: '', prompt: 'hola', status: 'done', detail: 'listo', tool: '' });
  const say = t => L({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
  // /login despues de terminar: no es una peticion, sigue terminada
  const login = parseTail([user('hola'), say('listo'), user('<command-name>/login</command-name>'), user('<local-command-stdout>Login successful</local-command-stdout>')]);
  assert.strictEqual(login.status, 'done'); assert.strictEqual(login.prompt, 'hola');
  // aviso de tarea tras stop_hook_summary: terminada, con titulo
  const task = parseTail([L({ type: 'custom-title', customTitle: 'Mascota' }), user('haz x'), say('hecho'),
    L({ type: 'system', subtype: 'stop_hook_summary' }), user('<task-notification>\n<task-id>1</task-id>')]);
  assert.deepStrictEqual([task.status, task.title, task.detail], ['done', 'Mascota', 'hecho']);
  // tool_use pero el turno acabo (stop_hook_summary despues)
  assert.strictEqual(parseTail([user('a'), L({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }), L({ type: 'system', subtype: 'stop_hook_summary' })]).status, 'done');
  // interrumpida con Esc
  assert.strictEqual(parseTail([user('a'), user('[Request interrupted by user]')]).status, 'idle');
  const busy = parseTail([user('haz x'), L({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } })]);
  assert.strictEqual(busy.status, 'working'); assert.strictEqual(busy.tool, 'Bash');
  const res = parseTail([user('pide'), L({ type: 'user', message: { content: [{ type: 'tool_result' }] } })]);
  assert.strictEqual(res.prompt, 'pide'); assert.strictEqual(res.status, 'working');
  assert.strictEqual(parseTail([L({ type: 'summary' })]), null);
  const r = recover(3);
  assert.ok(r.length <= 3 && r.every((s, i) => !i || r[i - 1].at >= s.at), 'las 3 mas recientes, en orden');
  console.log('recover.js ok,', r.map(s => path.basename(s.cwd || '?')).join(', '));
}
