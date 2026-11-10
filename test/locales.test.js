// Todos los idiomas tienen las mismas claves y los mismos {placeholders} que en.json.
// Las formas de plural extra (_zero/_two/_few/_many) se permiten si existe su _other.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'locales');
const LANGS = ['es', 'en', 'fr', 'de', 'it', 'pt', 'ja', 'zh', 'ko', 'ru'];
const load = (l) => JSON.parse(fs.readFileSync(path.join(dir, l + '.json'), 'utf8'));
const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
const base = load('en');
const EXTRA = /_(zero|two|few|many)$/;

for (const l of LANGS) {
  const raw = fs.readFileSync(path.join(dir, l + '.json'), 'utf8');
  const d = load(l);
  for (const k of Object.keys(base)) {
    assert.ok(k in d, `${l}: falta ${k}`);
    assert.strictEqual(typeof d[k], 'string', `${l}.${k} no es texto`);
    assert.strictEqual(vars(d[k]), vars(base[k]), `${l}.${k}: placeholders distintos`);
  }
  for (const k of Object.keys(d)) {
    if (k in base) continue;
    assert.ok(EXTRA.test(k) && k.replace(EXTRA, '_other') in base, `${l}: clave de más ${k}`);
    assert.strictEqual(vars(d[k]), vars(base[k.replace(EXTRA, '_other')]), `${l}.${k}: placeholders`);
  }
  for (const k of Object.keys(d)) {
    const n = raw.split(`"${k}":`).length - 1;
    assert.strictEqual(n, 1, `${l}: ${k} aparece ${n} veces`);
  }
}

// Las claves que usa el código existen en en.json.
const src = ['main.js', 'notch.js', 'settings.js', 'asks.js', 'updater.js', 'settings.html', 'index.html']
  .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
const used = new Set();
for (const m of src.matchAll(/\b(?:t|tn|NP\.t|NP\.tn)\(\s*'([a-z0-9_]+)'/g)) used.add(m[1]);
for (const m of src.matchAll(/data-t(?:-html|-aria|-title|-placeholder)?="([a-z0-9_]+)"/g)) used.add(m[1]);
for (const m of src.matchAll(/(?:titleKey|detailKey|key|labelKey):\s*'([a-z0-9_]+)'/g)) used.add(m[1]);
for (const k of used) {
  assert.ok(k in base || (k + '_other') in base, `clave usada en el código y no definida: ${k}`);
}
console.log(`locales ok · ${LANGS.length} idiomas · ${Object.keys(base).length} claves · ${used.size} usadas`);
