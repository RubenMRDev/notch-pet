// Mete o quita los hooks de notch-pet en ~/.claude/settings.json sin tocar los demas hooks.
const fs = require('fs');
const os = require('os');
const path = require('path');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const MARK = '--notch-pet';
// Empaquetada, hook.js vive fuera del .asar (app.asar.unpacked) para que node lo pueda leer.
const HOOK = path.join(__dirname, 'hook.js').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace(/\\/g, '/');
const CMD = `node "${HOOK}" ${MARK}`;
const FILE = path.join(os.homedir(), '.claude', 'settings.json');

const ours = h => (h.command || '').includes(MARK);
const groups = (s, ev) => s.hooks?.[ev] || [];
const installed = s => EVENTS.filter(ev => groups(s, ev).some(g => (g.hooks || []).some(ours)));
// Instalados pero apuntando a otra ruta (por ejemplo, la version de desarrollo).
const outdated = s => EVENTS.some(ev => groups(s, ev).some(g => (g.hooks || []).some(h => ours(h) && h.command !== CMD)));

function uninstall(s) {
  for (const ev of Object.keys(s.hooks || {})) {
    s.hooks[ev] = s.hooks[ev]
      .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours(h)) }))
      .filter(g => g.hooks.length);
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

function install(s) {
  uninstall(s);
  s.hooks ||= {};
  for (const ev of EVENTS) (s.hooks[ev] ||= []).push({ hooks: [{ type: 'command', command: CMD, async: true }] });
  return s;
}

const read = () => (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {});

// Antes de escribir guarda una copia al lado (settings.json.notch-pet.bak).
function write(fn) {
  const before = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '{}';
  const s = fn(JSON.parse(before));
  fs.writeFileSync(FILE + '.notch-pet.bak', before);
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2) + '\n');
  return status();
}

const status = () => { const s = read(); return { file: FILE, events: EVENTS, installed: installed(s), outdated: outdated(s) }; };

module.exports = {
  status,
  install: () => write(install),
  uninstall: () => write(uninstall),
};

if (require.main === module) {
  const assert = require('assert');
  const other = { type: 'command', command: 'node discord/notify.js' };
  const s = { model: 'opus', hooks: { Stop: [{ hooks: [other] }] } };
  install(s);
  assert.deepStrictEqual(installed(s), EVENTS);
  assert.strictEqual(outdated(s), false);
  install(s);
  assert.strictEqual(s.hooks.PreToolUse.length, 1, 'no duplica');
  s.hooks.Stop[1].hooks[0].command = `node "C:/viejo/hook.js" ${MARK}`;
  assert.strictEqual(outdated(s), true);
  install(s);
  assert.strictEqual(outdated(s), false, 'reinstalar arregla la ruta');
  uninstall(s);
  assert.deepStrictEqual(s, { model: 'opus', hooks: { Stop: [{ hooks: [other] }] } }, 'deja lo ajeno intacto');
  assert.deepStrictEqual(uninstall({ model: 'x' }), { model: 'x' });
  console.log('hooks.js ok');
}
