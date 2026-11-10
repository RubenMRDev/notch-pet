// Capturas de la pestaña Ayuda: abre el notch de verdad (con el puente falso de los tests), le pasa sesiones de
// ejemplo y lo fotografía en cada idioma. Salen en help/<idioma>/<nombre>.png.   npm run help-shots
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LANGS = ['es', 'en', 'fr', 'de', 'it', 'pt', 'ja', 'zh', 'ko', 'ru'];
const wait = ms => new Promise(r => setTimeout(r, ms));
let wc;
const js = expr => wc.executeJavaScript(expr);
const emit = (ch, data) => js(`__test.emit(${JSON.stringify(ch)}, ${JSON.stringify(data ?? null)})`);

// Nombres de carpeta en vez de titulos: asi las capturas valen igual en todos los idiomas.
function sessions(now, strings, ask) {
  return [
    { id: 'a', title: '', cwd: 'C:/dev/landing-page', status: 'working', tool: 'Read', detail: 'Read', prompt: 'npm run build', at: now - 20e3 },
    { id: 'b', title: '', cwd: 'C:/dev/api-server', status: ask ? 'waiting' : 'done', detail: '✓ 24/24', prompt: 'npm test', at: now - 3 * 60e3,
      asks: ask ? [{ id: 'k', kind: 'permission', title: strings.run_command, detail: 'npm install', canAlways: true }] : [] },
    { id: 'c', title: '', cwd: 'C:/dev/mobile-app', status: 'idle', detail: '', prompt: 'git status', at: now - 50 * 60e3 },
  ];
}
const state = (strings, { ask = false, mood = 'working' } = {}) => {
  const now = Date.now();
  return emit('state', { mood, impatient: false, tool: mood === 'working' ? 'read' : '', sessions: sessions(now, strings, ask), now,
    stats: { done: 3, tools: 42, workMs: 47 * 60e3 }, max: 3 });
};

async function shot(file) {
  const r = await js(`(() => { const rs = [...document.querySelectorAll('#notch, .ear')].map(e => e.getBoundingClientRect());
    const x = Math.min(...rs.map(r => r.left)), y = Math.min(...rs.map(r => r.top));
    return { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(Math.max(...rs.map(r => r.right)) - x), height: Math.ceil(Math.max(...rs.map(r => r.bottom)) - y) }; })()`);
  fs.writeFileSync(file, (await wc.capturePage(r)).toPNG());
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 440, height: 460, show: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, preload: path.join(__dirname, 'preload-test.js'), contextIsolation: true, sandbox: true } });
  wc = win.webContents;
  await win.loadFile(path.join(ROOT, 'index.html'));
  await emit('config', { colors: { pet: '#f0916b', bg: '#0a0a0c', work: '#6aa8ff', wait: '#ffb340', done: '#5fd38d' }, skin: 'blob', customImage: '', style: 'smooth' });
  for (const lang of LANGS) {
    const strings = JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', `${lang}.json`), 'utf8'));
    const out = path.join(ROOT, 'help', lang);
    fs.mkdirSync(out, { recursive: true });
    await emit('i18n', { lang, strings });
    // Cerrado, tal como se ve arriba de la pantalla: para moverlo
    await emit('open', false); await state(strings); await wait(500); await shot(path.join(out, 'move.png'));
    // Abierto con la lista
    await emit('open', true); await state(strings); await wait(600); await shot(path.join(out, 'open.png'));
    // Pidiendo permiso
    await state(strings, { ask: true, mood: 'waiting' }); await wait(500); await shot(path.join(out, 'ask.png'));
    // Una sesion desplegada, con la caja para escribirle
    await state(strings, { mood: 'happy' }); await wait(300);
    await js(`document.querySelector('.row[data-id="b"] .name').click()`); await wait(500); await shot(path.join(out, 'write.png'));
    await js(`document.querySelector('.row[data-id="b"] .name').click()`); await wait(200);
    // La tarjeta de "ha terminado"
    await emit('open', false); await wait(400); await emit('finished', 'b'); await wait(600); await shot(path.join(out, 'finish.png'));
    await emit('peek-end'); await wait(200);
    console.log(`  ${lang}: 5 capturas`);
  }
  app.exit(0);
});
