// Actualizaciones desde las releases de GitHub, igual que Taskvia y Moorage: latest.yml (de electron-builder) dice cual
// es la ultima version y la huella SHA-512 de su instalador. Comprobar es una peticion pequena; la descarga (~80 MB)
// solo empieza cuando la pides en Ajustes, nunca sola. Se comprueba la huella y, al reiniciar, el instalador se
// ejecuta en silencio (/S) y vuelve a abrir Notch Pet.
const { createHash } = require('crypto');
const { createWriteStream, promises: fs } = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'https://github.com/RubenMRDev/notch-pet/releases';

// latest.yml: solo los campos de primer nivel que hacen falta
function parseLatestYml(text) {
  const field = name => text.match(new RegExp(`^${name}:\\s*['"]?([^'"\\r\\n]+)['"]?\\s*$`, 'm'))?.[1]?.trim();
  const version = field('version'), file = field('path'), sha512 = field('sha512');
  if (!version || !file || !sha512 || !/^[\w.-]+\.exe$/.test(file)) return null;
  return { version, path: file, sha512, size: Number(text.match(/^\s+size:\s*(\d+)/m)?.[1]) || undefined };
}
const parts = v => (String(v).match(/\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
function isNewer(latest, current) {
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

let latest = null, downloaded = null;

// { newer, version, size, downloaded } o { error }
async function checkUpdate(net, current) {
  try {
    const res = await net.fetch(`${REPO}/latest/download/latest.yml`, { cache: 'no-store' });
    if (res.status === 404) return { error: 'Aún no hay versiones publicadas con actualización automática' };
    if (!res.ok) return { error: `GitHub respondió ${res.status}` };
    latest = parseLatestYml(await res.text());
    if (!latest) return { error: 'La información de la última versión no es válida' };
    return { newer: isNewer(latest.version, current), version: latest.version, size: latest.size, downloaded: downloaded?.version === latest.version };
  } catch (e) {
    return { error: `Sin conexión (${e.message})` };
  }
}

// Descarga el instalador de la ultima version y comprueba su huella; onProgress(recibido, total)
async function downloadUpdate(net, tempDir, current, onProgress) {
  if (!latest) { const r = await checkUpdate(net, current); if (r.error) return { ok: false, error: r.error }; }
  const target = latest;
  if (downloaded?.version === target.version) return { ok: true };
  const dir = path.join(tempDir, 'notch-pet-update');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, target.path);
  try {
    const res = await net.fetch(`${REPO}/download/v${target.version}/${encodeURIComponent(target.path)}`);
    if (!res.ok || !res.body) return { ok: false, error: `No se pudo descargar (${res.status})` };
    const total = Number(res.headers.get('content-length')) || target.size || 0;
    const hash = createHash('sha512'), out = createWriteStream(file), reader = res.body.getReader();
    let received = 0, lastReport = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(value)) await new Promise(r => out.once('drain', r));
      if (Date.now() - lastReport > 250) { lastReport = Date.now(); onProgress(received, total); }
    }
    await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
    onProgress(received, total);
    // La huella tiene que coincidir con la publicada: si no, el archivo no se usa
    if (hash.digest('base64') !== target.sha512) {
      await fs.rm(dir, { recursive: true, force: true });
      return { ok: false, error: 'El archivo descargado no coincide con el publicado (se ha descartado)' };
    }
    downloaded = { version: target.version, file };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `La descarga falló (${e.message})` };
  }
}

// Lanza el instalador en silencio; el cierra lo que quede de Notch Pet, instala y la vuelve a abrir
function launchInstaller() {
  if (!downloaded) return { ok: false, error: 'No hay ninguna actualización descargada' };
  try {
    const child = spawn(downloaded.file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return { ok: true };
  } catch (e) {
    downloaded = null;
    return { ok: false, error: `No se pudo abrir el instalador (${e.message}). Vuelve a descargarlo.` };
  }
}

module.exports = { checkUpdate, downloadUpdate, launchInstaller, parseLatestYml, isNewer };

if (require.main === module) {
  const assert = require('assert');
  const yml = `version: 1.1.0\nfiles:\n  - url: NotchPet-Setup-1.1.0.exe\n    sha512: abc==\n    size: 81678782\npath: NotchPet-Setup-1.1.0.exe\nsha512: abc==\nreleaseDate: '2026-11-10T10:00:00.000Z'\n`;
  assert.deepStrictEqual(parseLatestYml(yml), { version: '1.1.0', path: 'NotchPet-Setup-1.1.0.exe', sha512: 'abc==', size: 81678782 });
  assert.strictEqual(parseLatestYml(yml.replace(/\.exe/g, '.bat')), null, 'solo instaladores .exe');
  assert.strictEqual(isNewer('1.1.0', '1.0.0'), true);
  assert.strictEqual(isNewer('1.0.0', '1.0.0'), false);
  assert.strictEqual(isNewer('1.0.9', '1.0.10'), false);
  assert.strictEqual(isNewer('2.0', '1.9.9'), true);
  console.log('updater.js ok');
}
