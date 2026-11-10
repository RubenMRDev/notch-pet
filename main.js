const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, nativeTheme, globalShortcut, Notification, shell, dialog, net } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { apply, view, tally, announce } = require('./state');
const { recover } = require('./recover');
const { petPng } = require('./icon');
const { watchFullscreen } = require('./fullscreen');
const hooks = require('./hooks');
const updater = require('./updater');
const asks = require('./asks');
const { randomUUID } = require('crypto');

const PORT = 47321;
const W = 440, H = 460;              // ventana transparente del notch (la pastilla vive dentro)
const SESSION_ID = /^[0-9a-f-]{36}$/i;
const sessions = new Map();
let win, settingsWin, tray, testMood, displayId, fullscreen = false, stopFullscreen;

// --- Registro de errores (userData/notch-pet.log, se recorta solo) ---
const file = name => path.join(app.getPath('userData'), name);
function log(level, msg, err) {
  try {
    const f = file('notch-pet.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.1');
    fs.appendFileSync(f, `${new Date().toISOString()} [${level}] ${msg}${err ? ` · ${err.stack || err}` : ''}\n`);
  } catch {}
}
process.on('uncaughtException', e => log('error', 'uncaughtException', e));
process.on('unhandledRejection', e => log('error', 'unhandledRejection', e));

// --- Config y estadisticas ---
const DEFAULTS = {
  colors: { pet: '#f0916b', bg: '#0a0a0c', work: '#6aa8ff', wait: '#ffb340', done: '#5fd38d' },
  skin: 'blob', customImage: '', style: 'smooth',
  sound: true, notify: true, dnd: false,
  display: 'primary', hideFullscreen: true, visible: true,
  shortcut: 'CommandOrControl+Alt+N', openWith: 'claude',
  maxSessions: 3, finishAlert: 'multi', firstRunDone: false,
};
const readJson = name => { try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return {}; } };
const writeJson = (name, v) => { try { fs.writeFileSync(file(name), JSON.stringify(v, null, 2)); } catch (e) { log('error', `No se pudo guardar ${name}`, e); } };
let config, stats;
const merge = (base, patch) => ({ ...base, ...patch, colors: { ...base.colors, ...patch.colors } });

// En desarrollo hay que decirle a Windows que arranque electron con esta carpeta.
const loginOpts = () => (app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(app.getAppPath())] });
const fullConfig = () => ({ ...config, shortcutOk, autostart: app.getLoginItemSettings(loginOpts()).openAtLogin });

const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };
// Peticiones abiertas (permiso, pregunta o plan) que esperan tu respuesta desde el notch.
const pending = new Map(); // id -> { id, session_id, tool, input, suggestions, fp, summary, res }
function push() {
  const v = view(sessions);
  for (const s of v.sessions) {
    s.asks = [...pending.values()].filter(p => p.session_id === s.id).map(p => ({ id: p.id, ...p.summary }));
    s.queued = s.queued ? { text: s.queued.text, images: s.queued.images.length } : null;
  }
  send('state', { ...v, ...testMood, stats, max: config.maxSessions });
}
// Cierra una peticion: con decision se la pasa a Claude; sin ella, Claude sigue con su dialogo de siempre.
function settle(p, decision = null) {
  pending.delete(p.id);
  try { if (!p.res.writableEnded) p.res.end(JSON.stringify({ decision })); } catch {}
}
const sendConfig = () => send('config', config);

// Lee las conversaciones de ~/.claude/projects: asi ve tus ultimas sesiones aunque no tengas los hooks.
// Solo pisa una sesion si su fichero es mas nuevo que lo ultimo que avisaron los hooks.
function syncTranscripts() {
  let changed = false;
  for (const r of recover(Math.max(config.maxSessions, 5))) {
    const s = sessions.get(r.id);
    if (s && (s.sending || r.at <= s.at + 1500)) continue;
    const prevStatus = s && view(new Map([[s.id, s]])).sessions[0].status;
    sessions.set(r.id, { ...s, ...r, waitingSince: s?.waitingSince, queued: s?.queued || null });
    maybeAnnounce(prevStatus, sessions.get(r.id));
    flushQueue(sessions.get(r.id));
    changed = true;
  }
  if (changed) push();
}

// --- Aviso de "esta sesion ha terminado" (sobre todo cuando llevas varias a la vez) ---
let peek = null; // { id, h, until }
function maybeAnnounce(prevStatus, s) {
  const others = view(sessions).sessions.filter(x => x.id !== s.id && x.status === 'working').length;
  if (config.dnd || !announce(config.finishAlert, prevStatus, s.status, others)) return;
  peek = { id: s.id, h: 130, until: Date.now() + 7000 };
  push(); // que la tarjeta tenga ya el ultimo mensaje
  send('finished', s.id);
  if (config.sound) send('chime', 'done');
}

// --- Ventana del notch ---
function targetDisplay() {
  if (config.display === 'follow') return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return screen.getAllDisplays().find(d => String(d.id) === String(config.display)) || screen.getPrimaryDisplay();
}
function place() {
  if (!win) return;
  const d = targetDisplay();
  displayId = d.id;
  win.setBounds({ x: Math.round(d.bounds.x + (d.bounds.width - W) / 2), y: d.bounds.y, width: W, height: H });
}
function updateVisibility() {
  if (!win) return;
  const show = config.visible && !(config.hideFullscreen && fullscreen);
  if (show && !win.isVisible()) win.showInactive();
  if (!show && win.isVisible()) win.hide();
}

// Las ventanas solo cargan nuestros ficheros: nada de navegar ni abrir ventanas nuevas.
function lockDown(w) {
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('render-process-gone', (_e, d) => log('error', `La ventana se cerró: ${d.reason}`));
  w.webContents.on('console-message', (_e, level, msg, line, src) => { if (level >= 3) log('error', `${path.basename(src || '')}:${line} ${msg}`); });
}
const webPreferences = extra => ({
  preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, ...extra,
});

function createWindow() {
  win = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, resizable: false, movable: false, show: false,
    skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, title: 'Notch Pet',
    webPreferences: webPreferences({ autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false }),
  });
  lockDown(win);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  place();
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', () => { sendConfig(); push(); updateVisibility(); });
}

function openSettings(page) {
  if (settingsWin) {
    if (typeof page === 'string') settingsWin.loadFile(path.join(__dirname, 'settings.html'), { hash: page });
    return settingsWin.isMinimized() ? settingsWin.restore() : settingsWin.focus();
  }
  settingsWin = new BrowserWindow({
    width: 860, height: 640, minWidth: 720, minHeight: 520, title: 'Notch Pet', backgroundColor: '#0e0e11', show: false,
    icon: nativeImage.createFromBuffer(petPng(64, config.colors.pet)), autoHideMenuBar: true, webPreferences: webPreferences(),
  });
  lockDown(settingsWin);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'), typeof page === 'string' ? { hash: page } : {});
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => (settingsWin = null));
}

// --- Bandeja del sistema ---
function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromBuffer(petPng(32, config.colors.pet)));
    tray.setToolTip('Notch Pet');
    tray.on('click', () => openSettings());
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ajustes', click: () => openSettings() },
    { label: 'Mostrar notch', type: 'checkbox', checked: config.visible, click: m => setConfig({ visible: m.checked }) },
    { label: 'No molestar', type: 'checkbox', checked: config.dnd, click: m => setConfig({ dnd: m.checked }) },
    ...(update.state === 'ready' ? [{ type: 'separator' }, { label: `Reiniciar para actualizar a la ${update.version}`, click: installUpdate }]
      : update.state === 'available' ? [{ type: 'separator' }, { label: `Hay una versión nueva (${update.version})`, click: () => openSettings('general') }] : []),
    { type: 'separator' },
    { label: 'Salir de Notch Pet', click: () => app.quit() },
  ]));
}

// --- Atajo global: deja el notch abierto aunque quites el raton ---
let pinned = false, shortcutOk = true;
function registerShortcut(acc) {
  globalShortcut.unregisterAll();
  if (!acc) return true;
  try {
    return globalShortcut.register(acc, () => { pinned = !pinned; if (pinned) win.showInactive(); setOpen(pinned); });
  } catch { return false; }
}

// --- Aplicar cambios de config (solo claves conocidas) ---
function setConfig(patch) {
  patch = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => k in DEFAULTS || k === 'autostart'));
  if ('autostart' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.autostart, ...loginOpts() });
  const { autostart, ...rest } = patch;
  if ('shortcut' in rest && !registerShortcut(rest.shortcut)) {
    registerShortcut(config.shortcut);
    throw new Error(`No se pudo usar el atajo «${rest.shortcut}». Puede que otra app ya lo tenga.`);
  }
  if ('shortcut' in rest) shortcutOk = true;
  if ('maxSessions' in rest) rest.maxSessions = Math.min(10, Math.max(1, Number(rest.maxSessions) || 3));
  config = merge(config, rest);
  writeJson('config.json', config);
  if ('display' in rest) place();
  if ('maxSessions' in rest) { syncTranscripts(); push(); }
  if ('colors' in rest) tray?.setImage(nativeImage.createFromBuffer(petPng(32, config.colors.pet)));
  updateVisibility();
  buildTray();
  sendConfig();
  return fullConfig();
}

// --- Avisos cuando una sesion pasa a pedir permiso ---
const folder = p => (p || '').split(/[\\/]/).filter(Boolean).pop() || 'sesión';
const nameOf = s => s.title || folder(s.cwd);
function alertWaiting(s) {
  if (config.dnd) return;
  if (config.sound) send('chime');
  if (config.notify && Notification.isSupported()) {
    const n = new Notification({ title: `Claude te necesita · ${nameOf(s)}`, body: s.detail || 'Pide permiso para seguir.', silent: true });
    n.on('click', () => openSession(s));
    n.show();
  }
}

// --- Abrir una sesion ---
// La app de Claude guarda cada sesion de Code en %APPDATA%\Claude\claude-code-sessions\*\*\local_*.json,
// con su id interno (local_...) y el de la conversacion (cliSessionId). Su enlace claude://code/continue pide el interno.
// No es una API oficial: si la app cambia, se cae a abrir la carpeta.
const CCD = path.join(app.getPath('appData'), 'Claude', 'claude-code-sessions');
let appIds = new Map();
function loadAppIds() {
  appIds = new Map();
  try {
    for (const a of fs.readdirSync(CCD)) for (const b of fs.readdirSync(path.join(CCD, a))) {
      for (const f of fs.readdirSync(path.join(CCD, a, b))) {
        if (!/^local_.*\.json$/.test(f)) continue;
        try { const j = JSON.parse(fs.readFileSync(path.join(CCD, a, b, f), 'utf8')); if (j.cliSessionId) appIds.set(j.cliSessionId, j.sessionId); } catch {}
      }
    }
  } catch {}
}
function openInClaude(id) {
  if (!SESSION_ID.test(id || '')) return false;
  if (!appIds.has(id)) loadAppIds();
  const local = appIds.get(id);
  // Si la sesion nunca se abrio en la app (p. ej. es de la terminal), la app la importa con claude://resume.
  shell.openExternal(/^local_[A-Za-z0-9-]{1,64}$/.test(local || '')
    ? `claude://code/continue?session=${local}&source=notch_pet`
    : `claude://resume?session=${id}`).catch(e => log('warn', 'No se pudo abrir la app de Claude', e));
  return true;
}

function openSession(s) {
  if (!s) return;
  if (config.openWith === 'claude' && openInClaude(s.id)) return;
  const cwd = s.cwd;
  // El cwd llega por HTTP local: solo carpetas que existen y sin caracteres que cmd interprete.
  if (!cwd || /["&|<>^%]/.test(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return;
  const fallback = () => shell.openPath(cwd);
  const run = (cmd, args, opts = {}) => {
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
    p.on('error', fallback);
    p.unref();
  };
  if (config.openWith === 'code') run('code', [`"${cwd}"`], { shell: true });
  else if (config.openWith === 'terminal') run('wt.exe', ['-d', cwd]);
  else fallback();
}

// --- Escribir a una sesion: claude -p --resume <id>, en su carpeta. El mensaje va por stdin en formato stream-json,
// que admite texto e imagenes. Si la sesion esta abierta en la app de Claude, alli no se vera hasta que la reabras.
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
function sendToSession({ id, text, images } = {}) {
  return new Promise(resolve => {
    const s = sessions.get(id);
    const fail = error => { if (s) { s.sending = false; push(); } resolve({ ok: false, error }); };
    if (!s || !SESSION_ID.test(id)) return fail('No encuentro esa sesión.');
    text = String(text || '').trim();
    images = Array.isArray(images) ? images : [];
    if (!text && !images.length) return fail('Escribe algo o adjunta una imagen antes de enviar.');
    if (text.length > 4000) return fail('El mensaje es demasiado largo (máximo 4000 caracteres).');
    if (images.length > 4) return fail('Como mucho 4 imágenes por mensaje.');
    for (const im of images) {
      if (!IMAGE_TYPES.includes(im?.media_type) || typeof im.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(im.data)) return fail('Una de las imágenes no es válida (PNG, JPG, GIF o WebP).');
      if (im.data.length * 0.75 > 5 * 1024 * 1024) return fail('Cada imagen puede pesar como mucho 5 MB.');
    }
    if (!s.cwd || !fs.existsSync(s.cwd)) return fail('La carpeta de la sesión ya no existe.');
    // Ocupada: se guarda y sale sola en cuanto termine (flushQueue).
    if (s.sending || s.status === 'working' || s.status === 'waiting') { s.queued = { text, images }; push(); return resolve({ ok: true, queued: true }); }

    const label = text || (images.length === 1 ? '[imagen]' : `[${images.length} imágenes]`);
    Object.assign(s, { sending: true, status: 'working', prompt: label + (text && images.length ? ` · ${images.length} ${images.length === 1 ? 'imagen' : 'imágenes'}` : ''), detail: 'Pensando…', tool: '', at: Date.now() });
    push();
    const content = [
      ...(text ? [{ type: 'text', text }] : [{ type: 'text', text: 'Mira esta imagen.' }]),
      ...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
    ];
    // ponytail: shell porque en Windows claude es un .cmd; los argumentos son fijos y el id ya esta validado.
    const p = spawn('claude', ['-p', '--resume', id, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
      { cwd: s.cwd, shell: true, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => p.kill(), 10 * 60e3);
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', e => { clearTimeout(timer); log('error', 'No se pudo lanzar claude', e); fail('No encuentro el comando claude. ¿Está instalado Claude Code?'); });
    p.on('close', () => {
      clearTimeout(timer);
      // La ultima linea con type "result" trae la respuesta final
      let r = null;
      for (const line of out.split('\n')) { try { const j = JSON.parse(line); if (j.type === 'result') r = j; } catch {} }
      if (!r) {
        log('warn', `claude -p devolvió algo inesperado: ${(err || out).slice(0, 300)}`);
        return fail((err || 'claude no respondió.').trim().slice(0, 300));
      }
      if (r.is_error) {
        // El motivo puede venir en result, en errors o como una linea de texto suelta antes del JSON
        const loose = `${out}\n${err}`.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('{')) || '';
        const why = r.result || (r.errors || []).join(' ') || loose || 'Claude no pudo responder.';
        Object.assign(s, { sending: false, status: 'done', at: Date.now() });
        push();
        if (/authenticat|login|oauth/i.test(why)) return resolve({ ok: false, error: 'Claude Code no tiene la sesión iniciada. Abre una terminal, ejecuta claude y escribe /login.' });
        if (/No conversation found/i.test(why)) return resolve({ ok: false, error: 'Claude Code no encuentra esta conversación en tu equipo.' });
        return resolve({ ok: false, error: why.slice(0, 300) });
      }
      Object.assign(s, { sending: false, status: 'done', detail: r.result || '', at: Date.now() });
      push();
      resolve({ ok: true, denied: (r.permission_denials || []).length });
    });
    p.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
  });
}

// Al terminar una sesion, si le dejaste un mensaje en cola, se envia.
function flushQueue(s) {
  if (!s?.queued || s.sending || s.status === 'working' || s.status === 'waiting') return;
  const q = s.queued;
  s.queued = null;
  sendToSession({ id: s.id, ...q }).then(r => {
    if (r.ok) return;
    log('warn', `Mensaje en cola no enviado: ${r.error}`);
    s.detail = `No se pudo enviar tu mensaje en cola: ${r.error}`; push();
  });
}

// --- Actualizaciones (solo con la app instalada), como en Taskvia: comprobar es automatico (al abrir y cada 4 h);
// la descarga solo cuando la pides en Ajustes, y el instalador se ejecuta en silencio al reiniciar.
// Estados: dev, idle, checking, none, available, downloading, ready, error.
let update = { state: app.isPackaged ? 'idle' : 'dev' };
function setUpdate(u) {
  const was = update.state;
  update = u;
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('update', { ...update, current: app.getVersion() });
  if (was !== u.state && tray) buildTray();
}
async function checkUpdate() {
  if (!app.isPackaged || ['checking', 'downloading', 'ready'].includes(update.state)) return;
  setUpdate({ state: 'checking' });
  const r = await updater.checkUpdate(net, app.getVersion());
  if (r.error) log('warn', `Actualizaciones: ${r.error}`);
  setUpdate(r.error ? { state: 'error', message: r.error } : r.newer ? { state: r.downloaded ? 'ready' : 'available', version: r.version, size: r.size } : { state: 'none' });
}
async function downloadUpdate() {
  if (update.state !== 'available') return;
  const { version, size } = update;
  setUpdate({ state: 'downloading', version, size, percent: 0 });
  const r = await updater.downloadUpdate(net, app.getPath('temp'), app.getVersion(),
    (got, total) => setUpdate({ state: 'downloading', version, size, percent: total ? Math.round(got / total * 100) : 0 }));
  if (!r.ok) log('warn', `Actualizaciones: ${r.error}`);
  setUpdate(r.ok ? { state: 'ready', version } : { state: 'error', message: r.error });
}
function installUpdate() {
  if (update.state !== 'ready') return;
  const r = updater.launchInstaller();
  if (r.ok) app.quit(); else setUpdate({ state: 'error', message: r.error });
}

// --- IPC: solo se atiende a nuestras propias ventanas ---
const trusted = e => (e.senderFrame?.url || '').startsWith('file://');
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (trusted(e)) fn(...a); });
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!trusted(e)) throw new Error('Origen no permitido'); return fn(...a); });

let open = false, openH = 100, typing = false;
function setOpen(o) {
  if (o === open || !win) return;
  open = o;
  if (o) peek = null; // al abrirlo, la tarjeta da paso a la lista con esa sesion desplegada
  win.setIgnoreMouseEvents(!open);
  send('open', open);
}
on('openH', h => (openH = Math.min(H, Math.max(36, Number(h) || 100))));
on('peekH', h => { if (peek) peek.h = Math.min(H, Math.max(36, Number(h) || 130)); });
// Para escribir, el notch tiene que poder coger el foco; al terminar lo suelta y vuelve a no molestar.
on('typing', t => {
  if (!!t === typing) return;
  typing = !!t;
  if (typing) {
    win.setFocusable(true); win.focus();
    setTimeout(() => { if (typing && !win.isFocused()) { win.show(); win.focus(); if (!win.isFocused()) log('warn', 'Windows no dio el foco del teclado al notch'); } }, 150);
  } else { win.blur(); win.setFocusable(false); }
});
on('quit', () => app.quit());
on('open-settings', page => openSettings(page));
on('open-session', id => openSession(sessions.get(id)));
on('open-logs', () => shell.openPath(app.getPath('userData')));
on('test-mood', t => {
  testMood = t; push();
  setTimeout(() => { if (testMood === t) { testMood = null; push(); } }, 5000);
});
on('test-alert', () => {
  send('chime');
  if (Notification.isSupported()) new Notification({ title: 'Claude te necesita · prueba', body: 'Así te avisará cuando una sesión pida permiso.', silent: true }).show();
});

handle('send', sendToSession);
handle('send:cancel', id => { const s = sessions.get(id); if (s) { s.queued = null; push(); } return { ok: true }; });
handle('permission:decide', ({ id, choice } = {}) => {
  const p = pending.get(id);
  if (!p) return { ok: false, error: 'Esta petición ya no está abierta (quizá la respondiste en Claude).' };
  const decision = asks.decide(p, choice);
  if (!decision) return { ok: false, error: 'Contesta todas las preguntas antes de responder.' };
  settle(p, decision);
  const s = sessions.get(p.session_id);
  if (s) Object.assign(s, { status: decision.behavior === 'allow' ? 'working' : s.status, detail: decision.behavior === 'allow' ? 'Pensando…' : 'Denegado', at: Date.now() });
  push();
  return { ok: true };
});
handle('update:status', () => ({ ...update, current: app.getVersion() }));
handle('update:check', () => checkUpdate());
handle('update:download', () => downloadUpdate());
on('update:install', installUpdate);
handle('config:get', () => fullConfig());
handle('config:set', patch => setConfig(patch));
handle('config:reset', () => setConfig({ colors: DEFAULTS.colors }));
handle('app:info', () => ({ version: app.getVersion(), electron: process.versions.electron, data: app.getPath('userData') }));
handle('displays', () => screen.getAllDisplays().map((d, i) => ({
  id: String(d.id), label: `Pantalla ${i + 1} · ${d.size.width}×${d.size.height}${d.id === screen.getPrimaryDisplay().id ? ' (principal)' : ''}`,
})));
handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(settingsWin, { title: 'Imagen de la mascota', properties: ['openFile'],
    filters: [{ name: 'Imágenes', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg', 'svg'] }] });
  if (r.canceled || !r.filePaths[0]) return fullConfig();
  if (fs.statSync(r.filePaths[0]).size > 8 * 1024 * 1024) throw new Error('La imagen pesa más de 8 MB. Elige una más ligera.');
  // Se copia a la carpeta de la app para que no se rompa si mueves el original.
  const dest = file('mascota' + path.extname(r.filePaths[0]).toLowerCase());
  fs.copyFileSync(r.filePaths[0], dest);
  return setConfig({ skin: 'image', customImage: `${dest}?v=${Date.now()}` });
});
handle('hooks:status', () => hooks.status());
handle('hooks:install', () => hooks.install());
handle('hooks:uninstall', () => hooks.uninstall());

// Solo la pastilla captura el raton; el resto de la ventana deja pasar los clics.
// ponytail: sondeo del cursor cada 80 ms; el reenvio de eventos de Electron en Windows no es fiable.
// Mientras esta abierta, toda la ventana captura clics aunque sea transparente.
function watchCursor() {
  if (!win || win.isDestroyed() || !win.isVisible()) return; // al cerrar para actualizar, la ventana ya no existe
  const p = screen.getCursorScreenPoint();
  if (config.display === 'follow' && !open && screen.getDisplayNearestPoint(p).id !== displayId) place();
  const b = win.getBounds();
  if (peek && Date.now() > peek.until && !open) { peek = null; send('peek-end'); }
  const w = open || peek ? 404 : 236, h = open ? openH : peek ? peek.h : 36, rx = p.x - b.x, ry = p.y - b.y;
  const inside = rx >= (W - w) / 2 && rx <= (W + w) / 2 && ry >= 0 && ry <= h;
  setOpen(inside || pinned || typing);
}

// --- Peticiones de permiso: el hook espera aqui (como mucho ~9 min) a que respondas desde el notch ---
function onPermission(req, res) {
  const chunks = []; let size = 0;
  req.on('data', c => { chunks.push(c); size += c.length; if (size > 256 * 1024) req.destroy(); });
  req.on('end', () => {
    let e;
    try { e = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return res.writeHead(400).end(); }
    if (!SESSION_ID.test(e.session_id || '') || !e.tool_name) return res.writeHead(400).end();
    const p = { id: randomUUID(), session_id: e.session_id, tool: e.tool_name, input: e.tool_input || {}, suggestions: e.permission_suggestions || [],
      fp: asks.fingerprint(e.tool_name, e.tool_input), summary: asks.summarize(e.tool_name, e.tool_input, e.permission_suggestions), res };
    pending.set(p.id, p);
    // Si el hook se corta (Claude lo cancela o se acaba el tiempo), la peticion desaparece del notch.
    res.on('close', () => { if (pending.delete(p.id)) push(); });
    const s = sessions.get(e.session_id) || { id: e.session_id, cwd: e.cwd, prompt: '', tool: '' };
    const was = s.status;
    Object.assign(s, { status: 'waiting', detail: p.summary.title, at: Date.now(), waitingSince: was === 'waiting' ? s.waitingSince : Date.now(), cwd: s.cwd || e.cwd });
    sessions.set(s.id, s);
    if (was !== 'waiting') alertWaiting(s);
    push();
    peek = { id: s.id, h: 150, until: Date.now() + 9000 };
    send('asked', s.id);
  });
}

// --- Eventos de los hooks de Claude (solo desde este equipo) ---
function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/permission') return onPermission(req, res);
    if (req.method !== 'POST' || req.url !== '/event') return res.writeHead(404).end();
    // Se juntan los trozos antes de decodificar: una letra con tilde puede llegar partida entre dos.
    const chunks = []; let size = 0;
    req.on('data', c => { chunks.push(c); size += c.length; if (size > 64 * 1024) req.destroy(); });
    req.on('end', () => {
      try {
        const e = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!SESSION_ID.test(e.session_id || '')) return res.writeHead(400).end();
        // Si ya se respondio en la ventana de Claude, la peticion sobra en el notch.
        for (const p of pending.values()) {
          if (p.session_id !== e.session_id) continue;
          if (['Stop', 'UserPromptSubmit', 'SessionEnd'].includes(e.hook_event_name) || (e.hook_event_name === 'PostToolUse' && e.tool_fp === p.fp)) settle(p);
        }
        const prev = apply(sessions, e);
        tally(stats, e, prev);
        writeJson('stats.json', stats);
        const s = sessions.get(e.session_id);
        if (s?.status === 'waiting' && prev?.status !== 'waiting') alertWaiting(s);
        if (s) maybeAnnounce(prev?.status, s);
        if (s) flushQueue(s);
        push();
      } catch (err) { log('warn', 'Evento de hook no válido', err); }
      res.end('ok');
    });
  });
  server.on('error', e => {
    log('error', `No se pudo abrir el puerto ${PORT}`, e);
    tray?.setToolTip(`Notch Pet · no puede recibir avisos de Claude (puerto ${PORT} ocupado)`);
  });
  server.listen(PORT, '127.0.0.1');
}

// Una sola mascota: si la vuelves a lanzar, se abren los ajustes.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => openSettings());
  app.whenReady().then(() => {
    // En desarrollo Windows solo muestra notificaciones si el id es la ruta del ejecutable.
    app.setAppUserModelId(app.isPackaged ? 'com.notchpet.app' : process.execPath);
    nativeTheme.themeSource = 'dark';
    config = merge(DEFAULTS, readJson('config.json'));
    stats = tally(readJson('stats.json'), {}, null);
    startServer();
    syncTranscripts();
    createWindow();
    buildTray();
    shortcutOk = registerShortcut(config.shortcut);
    stopFullscreen = watchFullscreen(v => { fullscreen = v; updateVisibility(); });
    screen.on('display-added', place);
    screen.on('display-removed', place);
    // Primera vez: se abren los ajustes en "Conexión con Claude" para dejarlo listo.
    if (!config.firstRunDone) { setConfig({ firstRunDone: true }); openSettings('claude'); }
    else if (process.argv.includes('--settings')) openSettings();
    setInterval(push, 30e3);
    setInterval(syncTranscripts, 5e3);
    setInterval(watchCursor, 80);
    setTimeout(checkUpdate, 8000); // sin conexion no pasa nada: queda en "error" y se reintenta a las 4 h
    setInterval(checkUpdate, 4 * 3600e3);
    log('info', `Arrancada v${app.getVersion()}`);
  });
}
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopFullscreen?.(); for (const p of pending.values()) settle(p); });
// La ventana de ajustes se puede cerrar sin que se cierre la mascota.
app.on('window-all-closed', () => {});
