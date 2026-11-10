// Idiomas: locales/<idioma>.json con claves en ingles y {variables}. Lo que falte en un idioma sale en ingles.
// Plurales con Intl.PluralRules: clave_one, clave_few, clave_many, clave_other (lo que pida cada idioma).
const fs = require('fs');
const path = require('path');

const LANGS = ['es', 'en', 'fr', 'de', 'it', 'pt', 'ja', 'zh', 'ko', 'ru'];
const load = l => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${l}.json`), 'utf8')); } catch { return {}; } };
const en = load('en');
let lang = 'en', dict = en;

// 'auto' = el idioma del sistema (app.getLocale(), p. ej. "es-ES" o "zh-CN"); si no lo tenemos, ingles.
const resolve = (pref, locale) => {
  const code = pref && pref !== 'auto' ? pref : String(locale || '').toLowerCase().split(/[-_]/)[0];
  return LANGS.includes(code) ? code : 'en';
};
function setLang(l) { lang = LANGS.includes(l) ? l : 'en'; dict = { ...en, ...load(lang) }; }
const fill = (s, v = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const t = (k, v) => fill(dict[k] ?? k, v);
const tn = (k, n, v) => fill(dict[`${k}_${new Intl.PluralRules(lang).select(n)}`] ?? dict[`${k}_other`] ?? k, { n, ...v });
const names = () => LANGS.map(l => ({ code: l, name: load(l).language_name || l }));

module.exports = { LANGS, resolve, setLang, t, tn, names, current: () => ({ lang, strings: dict }) };

if (require.main === module) {
  const assert = require('assert');
  assert.strictEqual(resolve('auto', 'es-ES'), 'es');
  assert.strictEqual(resolve('auto', 'zh-CN'), 'zh');
  assert.strictEqual(resolve('auto', 'sv-SE'), 'en');
  assert.strictEqual(resolve('ru', 'es-ES'), 'ru');
  setLang('ru');
  assert.strictEqual(tn('session_count', 1), '1 сессия');
  assert.strictEqual(tn('session_count', 3), '3 сессии');
  assert.strictEqual(tn('session_count', 5), '5 сессий');
  setLang('es');
  assert.strictEqual(tn('session_count', 2), '2 sesiones');
  assert.strictEqual(t('use_tool', { tool: 'X' }), 'Usar X');
  assert.strictEqual(t('no_existe'), 'no_existe');
  console.log('i18n.js ok');
}
