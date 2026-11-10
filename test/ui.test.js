// Tests de interfaz del notch: abre index.html de verdad (con un puente falso) y lo maneja con eventos de entrada
// reales de Chromium (raton y teclado), comprobando despues lo que se ve.   npm run test:ui
const { app, BrowserWindow } = require('electron');
const assert = require('assert');
const path = require('path');
const locale = lang => ({ lang, strings: require(path.join(__dirname, '..', 'locales', lang + '.json')) });

const wait = ms => new Promise(r => setTimeout(r, ms));
let win, wc;
const errors = [];
const js = expr => wc.executeJavaScript(expr);
const emit = (ch, data) => js(`__test.emit(${JSON.stringify(ch)}, ${JSON.stringify(data ?? null)})`);
const ui = () => js('window.__notch()');
const calls = () => js('__test.calls()');

const NOW = Date.now();
const mk = (n, patch = {}) => ({ id: `id-${n}`, title: `Sesión ${n}`, cwd: `C:/dev/proyecto-${n}`, status: 'done', detail: `Último mensaje de la sesión ${n}`,
  prompt: `Petición ${n}`, tool: '', at: NOW - n * 60e3, ...patch });
const settle = () => wait(780); // pausa que el notch da a las actualizaciones mientras mueves el raton
const state = (sessions, extra = {}) => emit('state', { mood: 'idle', impatient: false, tool: '', sessions, now: Date.now(), stats: { done: 2, tools: 5, workMs: 60e3 }, max: 6, ...extra });

async function center(selector) {
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x + Math.min(b.width / 2, 120), y: b.y + Math.min(b.height / 2, 12) }; })()`);
  if (!r) throw new Error(`No existe ${selector}`);
  return { x: Math.round(r.x), y: Math.round(r.y) };
}
async function mouse(type, { x, y }) { wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 }); await wait(16); }
async function click(selector) { const p = await center(selector); await mouse('mouseMove', p); await mouse('mouseDown', p); await mouse('mouseUp', p); await wait(80); }
async function typeText(text) { wc.insertText(text); await wait(30); }
async function key(keyCode) { wc.sendInputEvent({ type: 'keyDown', keyCode }); wc.sendInputEvent({ type: 'char', keyCode }); wc.sendInputEvent({ type: 'keyUp', keyCode }); await wait(60); }
const expandedId = async () => (await ui()).rows.find(r => r.expanded)?.id || null;
// Comprueba que la fila abierta es la esperada; si no, cuenta el estado interno del notch
async function isOpen(id, msg = 'fila abierta') {
  const u = await ui(), got = u.rows.find(r => r.expanded)?.id || null;
  if (got !== id) throw new Error(`${msg}: esperaba ${id}, hay ${got} · ${JSON.stringify({ openId: u.openId, pressed: u.pressed, typing: u.typing, pending: u.pending, open: u.open })}`);
}

// Tormenta de repintados: el estado cambia cada 30 ms, como cuando varias sesiones trabajan a la vez
function storm(base) {
  let k = 0;
  const t = setInterval(() => { k++; state(base.map((s, i) => (i === k % base.length ? { ...s, status: k % 2 ? 'working' : 'done', tool: 'Bash', detail: `paso ${k}` } : s))).catch(() => {}); }, 30);
  return () => clearInterval(t);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('pinta una fila por sesión', async () => {
  await state([mk(1), mk(2), mk(3), mk(4)]);
  assert.strictEqual((await ui()).rows.length, 4);
});

test('abrir, cambiar y cerrar filas con el ratón', async () => {
  await emit('open', true);
  await wait(350);
  await click('.row[data-id="id-3"]'); await isOpen('id-3');
  await click('.row[data-id="id-1"]'); await isOpen('id-1');
  await click('.row[data-id="id-1"] .name'); await isOpen(null, 'pulsar la abierta la cierra');
});

test('las filas se abren aunque la lista se repinte sin parar', async () => {
  const base = [mk(1), mk(2), mk(3), mk(4)];
  const stop = storm(base);
  try {
    for (const n of [2, 4, 1, 3, 2]) {
      await wait(300);
      await click(`.row[data-id="id-${n}"] .name`);
      await wait(120);
      await isOpen(`id-${n}`, `la fila ${n}`);
    }
  } finally { stop(); }
});

test('el orden no cambia con el notch abierto', async () => {
  const order = (await ui()).rows.map(r => r.id);
  await state([mk(4, { at: Date.now() }), mk(1), mk(2), mk(3)]);
  assert.deepStrictEqual((await ui()).rows.map(r => r.id), order);
});

test('escribir mientras se repinta no pierde el texto ni el foco', async () => {
  await click('.row[data-id="id-2"] .name');
  if (await expandedId() !== 'id-2') await click('.row[data-id="id-2"] .name');
  wc.focus();
  await click('.row[data-id="id-2"] .msg-in');
  const stop = storm([mk(1), mk(2), mk(3), mk(4)]);
  try {
    await typeText('hola');
    await wait(200);
    await typeText(' mundo');
    await wait(200);
  } finally { stop(); }
  await wait(100);
  const r = await js(`({ v: document.querySelector('.row[data-id="id-2"] .msg-in')?.value, focused: document.activeElement?.matches('.row[data-id="id-2"] .msg-in') })`);
  assert.strictEqual(r.v, 'hola mundo');
  assert.strictEqual(r.focused, true, 'la caja perdió el foco');
});

test('con la caja enfocada, otra fila se abre al pulsarla', async () => {
  await click('.row[data-id="id-4"] .name');
  assert.strictEqual(await expandedId(), 'id-4');
});

test('Enter envía el mensaje a la sesión', async () => {
  await js('__test.clear()');
  wc.focus();
  await click('.row[data-id="id-4"] .msg-in');
  await typeText('súbelo');
  await key('Enter');
  await wait(100);
  const sent = (await calls()).find(c => c[0] === 'send');
  assert.ok(sent, 'no se llamó a send');
  assert.strictEqual(sent[1].id, 'id-4'); assert.strictEqual(sent[1].text, 'súbelo');
});

test('con texto seleccionado en una fila, otra fila sigue abriéndose', async () => {
  await js(`(() => { const d = document.querySelector('.row.expanded .detail'); const r = document.createRange(); r.selectNodeContents(d); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await click('.row[data-id="id-1"] .name');
  assert.strictEqual(await expandedId(), 'id-1');
  await js('getSelection().removeAllRanges()');
});

test('un botón del ratón que no se suelta no congela la lista', async () => {
  const p = await center('.row[data-id="id-3"] .name');
  await mouse('mouseMove', p); await mouse('mouseDown', p); // sin soltar
  await wait(1800);
  await state([mk(1), mk(2), mk(3), mk(4), mk(5)]);
  await wait(100);
  assert.strictEqual((await ui()).rows.length, 5, 'la lista no se repintó');
  await mouse('mouseUp', p);
});

test('permiso: Permitir le responde a Claude', async () => {
  await js('__test.clear()');
  await state([mk(1, { status: 'waiting', asks: [{ id: 'k1', kind: 'permission', title: 'Ejecutar un comando', detail: 'npm test', canAlways: true }] }), mk(2), mk(3)]);
  await settle();
  assert.ok(await js(`!!document.querySelector('.askbox[data-ask="k1"]')`));
  await click('.askbox[data-ask="k1"] .abtn.primary');
  const d = (await calls()).find(c => c[0] === 'permission:decide');
  assert.deepStrictEqual(d?.[1], { id: 'k1', choice: { behavior: 'allow', always: false } });
});

test('pregunta: elegir una opción responde', async () => {
  await js('__test.clear()');
  await state([mk(1, { status: 'waiting', asks: [{ id: 'q1', kind: 'question', title: 'Te pregunta', questions: [{ question: '¿Qué base de datos?', multiSelect: false, options: [{ label: 'Postgres' }, { label: 'SQLite' }] }] }] }), mk(2)]);
  await settle();
  await click('.askbox[data-ask="q1"] .opt[data-label="SQLite"]');
  const d = (await calls()).find(c => c[0] === 'permission:decide');
  assert.deepStrictEqual(d?.[1], { id: 'q1', choice: { behavior: 'allow', answers: { '¿Qué base de datos?': 'SQLite' } } });
});

test('mensaje en cola: se ve y se puede cancelar', async () => {
  await js('__test.clear()');
  await state([mk(1, { status: 'working', queued: { text: 'luego esto', images: 0 } }), mk(2)]);
  await settle();
  if (await expandedId() !== 'id-1') await click('.row[data-id="id-1"] .name');
  assert.match(await js(`document.querySelector('.row[data-id="id-1"] .queued')?.textContent || ''`), /luego esto/);
  await click('.row[data-id="id-1"] .unqueue');
  assert.ok((await calls()).some(c => c[0] === 'send:cancel' && c[1] === 'id-1'));
});

test('tarjeta de "ha terminado" y al abrir, esa sesión desplegada', async () => {
  await emit('open', false);
  await state([mk(1), mk(2), mk(3)]);
  await emit('finished', 'id-3');
  assert.ok(await js(`document.getElementById('shell').classList.contains('peek')`));
  await emit('open', true);
  await wait(350);
  assert.strictEqual((await ui()).openId, 'id-3');
});

test('datos raros no rompen la lista (y no se cuela HTML)', async () => {
  const weird = [
    mk(1, { detail: 42 }), mk(2, { detail: { a: 1 } }), mk(3, { detail: null, prompt: 123 }), mk(4, { detail: undefined, title: null, cwd: undefined }),
    mk(5, { detail: '<img src=x onerror="window.__pwned=1">**negrita** `codigo` ```sin cerrar' }), mk(6, { detail: 'x'.repeat(60000), tool: 12 }),
    mk(7, { status: 'waiting', asks: [{ id: 'z1', kind: 'question', title: 't', questions: [{ question: 'q', options: null }] }, { id: 'z2', kind: 'rara' }] }),
    mk(8, { status: 'working', tool: 'mcp__srv__hacer_algo', detail: 'mcp__srv__hacer_algo' }), mk(9, { asks: null, queued: { text: null, images: 2 } }),
  ];
  await state(weird, { max: 10 });
  await settle();
  const ids = (await ui()).rows.map(r => r.id);
  assert.strictEqual(ids.length, weird.length, 'faltan filas');
  for (const id of ids) {
    await wait(300);
    await js(`document.querySelector('.row[data-id="${id}"]').scrollIntoView({ block: 'nearest' })`);
    await click(`.row[data-id="${id}"] .top`);
    assert.strictEqual(await expandedId(), id, `la fila rara ${id} no se abrió`);
  }
  assert.strictEqual(await js('window.__pwned || 0'), 0, 'se ejecutó HTML del mensaje');
});

test('estilo 8 bits: cada aspecto tiene su dibujo en píxeles', async () => {
  for (const skin of ['blob', 'cat', 'ghost', 'robot']) {
    await emit('config', { colors: { pet: '#f0916b', bg: '#0a0a0c', work: '#6aa8ff', wait: '#ffb340', done: '#5fd38d' }, skin, customImage: '', style: 'pixel' });
    assert.ok(await js(`!!document.querySelector('#petslot .pxslot svg.px')`), `sin píxeles en ${skin}`);
    assert.strictEqual(await js(`document.querySelector('#petslot .pxslot').dataset.skin`), skin);
  }
});

test('garabato: se dibuja a mano y cambia de cara con el humor', async () => {
  await emit('config', { colors: { pet: '#f0916b', bg: '#0a0a0c', work: '#6aa8ff', wait: '#ffb340', done: '#5fd38d' }, skin: 'doodle', customImage: '', style: 'pixel' });
  const shown = sel => js(`(() => { const e = document.querySelector('#petslot ${sel}'); return !!e && getComputedStyle(e).display !== 'none'; })()`);
  assert.ok(await shown('.doodleslot svg.dd'), 'no se ve el garabato');
  assert.strictEqual(await shown('.pxslot'), false, 'se ve el 8 bits debajo');
  assert.strictEqual(await js(`document.querySelectorAll('#petslot .dd-f').length`), 3, 'faltan los contornos que tiemblan');
  await state([mk(1)], { mood: 'happy' }); await settle();
  assert.ok(await shown('.dd .f-happy')); assert.strictEqual(await shown('.dd .f-open'), false);
  await state([mk(1, { status: 'waiting' })], { mood: 'waiting' }); await settle();
  assert.ok(await shown('.dd .f-wait'));
  await state([mk(1, { status: 'working', tool: 'Read' })], { mood: 'working', tool: 'read' }); await settle();
  assert.ok(await shown('.dd .a-read'), 'sin gafas al leer');
  await state([mk(1, { status: 'working', tool: 'Bash' })], { mood: 'working', tool: 'term' }); await settle();
  assert.ok(await shown('.dd .a-term'), 'sin terminal');
  assert.strictEqual(await shown('.acc'), false, 'dos terminales: tambien sale la >_ del 8 bits');
});

test('una bifurcación se distingue: «fork» va aparte y no se corta', async () => {
  await state([mk(1, { title: 'Listado de notificaciones móvil con un título muy largo (fork)' }), mk(2, { title: 'Listado de notificaciones móvil con un título muy largo' })]);
  await settle();
  const r = await js("[...document.querySelectorAll('#list .row')].map(r => [r.querySelector('.name').textContent, !!r.querySelector('.tag')])");
  assert.deepStrictEqual(r.map(x => x[1]), [true, false]);
  assert.ok(!r[0][0].includes('(fork)'), 'el título sigue llevando (fork)');
  assert.ok(await js("getComputedStyle(document.querySelector('#list .tag')).display !== 'none' && document.querySelector('#list .tag').getBoundingClientRect().width > 10"), 'la marca no se ve');
});

test('cambia de idioma al momento (y los plurales de cada idioma)', async () => {
  await emit('open', true);
  await emit('i18n', locale('en'));
  await state([mk(1, { status: 'working', tool: 'Read' }), mk(2)], { mood: 'working', stats: { done: 1, tools: 5, workMs: 60e3 } });
  await settle();
  assert.strictEqual(await js("document.getElementById('stats').textContent"), 'Today · 1 finished · 5 tools · 1 min working');
  assert.strictEqual(await js("document.getElementById('title').textContent"), 'Working');
  assert.match(await js("document.querySelector('.row[data-id=\"id-1\"] .detail')?.textContent || ''"), /Reading files/);
  assert.strictEqual(await js("document.getElementById('gear').getAttribute('aria-label')"), 'Settings');
  await emit('i18n', locale('ru'));
  await settle();
  assert.match(await js("document.getElementById('stats').textContent"), /5 инструментов/);
  assert.strictEqual(await js('document.documentElement.lang'), 'ru');
  await emit('i18n', locale('es'));
  await state([]);
  await settle();
  assert.match(await js("document.querySelector('#list .empty')?.textContent || ''"), /Aún no hay sesiones/);
});

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 440, height: 460, show: false,
    webPreferences: { offscreen: true, preload: path.join(__dirname, 'preload-test.js'), contextIsolation: true, sandbox: true } });
  wc = win.webContents;
  wc.on('console-message', (_e, level, msg, line, src) => { if (level >= 3) errors.push(`${path.basename(src || '')}:${line} ${msg}`); });
  await win.loadFile(path.join(__dirname, '..', 'index.html'));
  await emit('i18n', locale('es'));
  await js(`window.addEventListener('error', e => console.error('ERROR', e.message)); window.addEventListener('unhandledrejection', e => console.error('PROMESA', e.reason))`);
  let failed = 0;
  for (const t of tests) {
    const before = errors.length;
    try {
      await t.fn();
      await wait(50);
      if (errors.length > before) throw new Error(`errores en la ventana: ${errors.slice(before).join(' | ')}`);
      console.log(`  ok   ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  MAL  ${t.name}\n       ${String(e.message).split('\n')[0]}`);
    }
  }
  console.log(failed ? `\n${failed} de ${tests.length} tests fallan` : `\nui ok: ${tests.length} tests`);
  app.exit(failed ? 1 : 0);
});
