// Graba la escena de demostracion.
//   electron promo/record.js video <carpeta-frames> <segundos>      -> fotogramas JPG a 30 fps (1080x1920)
//   electron promo/record.js shot <nombre> <ancho> <alto> <png>      -> captura PNG al doble de resolucion
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const [mode, ...args] = process.argv.slice(process.argv.findIndex(a => a.endsWith('record.js')) + 1);
const SCENE = path.join(__dirname, 'scene.html');
const FPS = 30;

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  if (mode === 'video') await video(...args);
  else if (mode === 'settings') await settingsShot(...args);
  else await shotOf(...args);
  app.exit(0);
});

async function waitFor(wc, expr, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await wc.executeJavaScript(expr)) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(`Tiempo agotado esperando ${expr}`);
}

async function shotOf(name, w, h, out) {
  const win = new BrowserWindow({ width: +w * 2, height: +h * 2, show: false, webPreferences: { offscreen: true, zoomFactor: 2 } });
  await win.loadFile(SCENE, { query: { shot: name } });
  await waitFor(win.webContents, 'window.SHOT_READY === true');
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('captura', name, '->', out);
}

// Ventana de ajustes real con el puente falso (datos de ejemplo), al doble de resolucion.
async function settingsShot(page, out) {
  const win = new BrowserWindow({ width: 1720, height: 1280, show: false,
    webPreferences: { offscreen: true, zoomFactor: 2, preload: path.join(__dirname, 'fake-preload.js'), contextIsolation: true, sandbox: true } });
  await win.loadFile(path.join(__dirname, '..', 'settings.html'), { hash: page });
  await new Promise(r => setTimeout(r, 1500));
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log('ajustes', page, '->', out);
}

function video(dir, secs) {
  return new Promise(async (resolve, reject) => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const total = Math.round(+secs * FPS);
    const win = new BrowserWindow({ width: 1080, height: 1920, show: false, webPreferences: { offscreen: true, zoomFactor: 2, backgroundThrottling: false } });
    const wc = win.webContents;
    wc.setFrameRate(FPS);
    await win.loadFile(SCENE);
    await waitFor(wc, 'window.SCENE_READY === true');
    await new Promise(r => setTimeout(r, 600));

    // Cada fotograma de salida toma la ultima imagen pintada antes de su instante: el video dura lo que debe aunque se pierda alguno.
    let t0 = null, idx = 0, dropped = 0;
    const frame = i => path.join(dir, `f${String(i).padStart(4, '0')}.jpg`);
    const forcePaint = setInterval(() => wc.invalidate(), 1000 / FPS);
    wc.on('paint', (_e, _d, img) => {
      if (t0 === null || idx >= total) return;
      const elapsed = (performance.now() - t0) / 1000;
      const jpg = img.toJPEG(94);
      const before = idx;
      while (idx < total && idx / FPS <= elapsed) fs.writeFileSync(frame(idx++), jpg);
      dropped += Math.max(0, idx - before - 1);
      if (idx >= total) { clearInterval(forcePaint); console.log(`video: ${total} fotogramas, ${dropped} repetidos`); resolve(); }
    });
    await wc.executeJavaScript('window.start()');
    t0 = performance.now();
    setTimeout(() => reject(new Error('La grabacion no termino')), (+secs + 20) * 1000);
  });
}
