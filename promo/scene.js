// Guion del anuncio (17 s) y estados fijos para las capturas. Todo con sesiones de ejemplo inventadas.
(() => {
  const { api } = window;
  const { PET } = window.NP;
  const $ = id => document.getElementById(id);
  const world = $('world');
  const params = new URLSearchParams(location.search);
  const shot = params.get('shot');
  world.classList.add(shot ? 'shot' : 'video');
  if (shot) world.classList.add(shot);

  // ---------- Datos de ejemplo ----------
  const T0 = Date.now();
  const COLORS = { pet: '#f0916b', bg: '#0a0a0c', work: '#6aa8ff', wait: '#ffb340', done: '#5fd38d' };
  const STYLE = params.get('style') === 'pixel' ? 'pixel' : 'smooth';
  api.emit('config', { colors: COLORS, skin: 'blob', customImage: '', style: STYLE });
  const ago = m => Date.now() - m * 60e3;
  const S = {
    checkout: { id: 'a1', title: 'Rediseño del checkout', cwd: 'C:/dev/tienda-web', status: 'working', tool: 'Edit', prompt: 'Rediseña el checkout y añade validación', detail: 'Edit' },
    pagos: { id: 'a2', title: 'Pagos', cwd: 'C:/dev/pagos-api', status: 'working', tool: 'Bash', prompt: 'Pasa los tests de la API de pagos', detail: 'Bash' },
    postgres: { id: 'a3', title: 'Migrar a Postgres', cwd: 'C:/dev/backend', status: 'done', tool: '', prompt: 'Migra la base de datos a Postgres',
      detail: 'Migración lista: **12 tablas** movidas, índices recreados y los tests en verde.' },
  };
  const DONE_MSG = 'He terminado el **checkout**: diseño nuevo, validación del formulario y `3` tests nuevos.\n\nSi te parece bien, lo subo a producción.';
  const stats = { done: 4, tools: 87, workMs: 52 * 60e3 };
  function state(mood, list, extra = {}) {
    api.emit('state', { mood, impatient: false, tool: '', sessions: list.map(s => ({ at: Date.now(), ...s })), now: Date.now(), stats, max: 3, ...extra });
  }
  const at = (s, min, patch = {}) => ({ ...s, at: ago(min), ...patch });

  // ---------- Titulares ----------
  let current = null;
  function headline(a, b) {
    if (current) { const old = current; old.classList.remove('in'); old.classList.add('leave'); setTimeout(() => old.remove(), 600); }
    if (!a) { current = null; return; }
    const h = document.createElement('h2');
    h.className = 'headline';
    let i = 0;
    const words = s => s.replace(/<em>(.*?)<\/em>|(\S+)/g, (_, em, w) => em
      ? `<em>${em.split(' ').map(x => `<span class="w" style="--i:${i++}">${x}</span>`).join(' ')}</em>`
      : `<span class="w" style="--i:${i++}">${w}</span>`);
    h.innerHTML = `${words(a)}<br>${words(b)}`;
    $('copy').appendChild(h);
    requestAnimationFrame(() => requestAnimationFrame(() => h.classList.add('in')));
    current = h;
  }

  // ---------- Galeria de mascotas ----------
  $('skinsScene').innerHTML = [['blob', 'Gota'], ['cat', 'Gato'], ['ghost', 'Fantasma'], ['robot', 'Robot']]
    .map(([k, n], i) => `<div class="skintile happy" data-skin="${k}" style="--i:${i}">${PET}<span>${n}</span></div>`).join('');
  $('endPet').innerHTML = PET;
  window.NP.pixelize();

  const notchStage = $('notchStage');
  const open = o => api.emit('open', o);
  function typeInto(text, ms) {
    const input = document.querySelector('.compose input');
    if (!input) return;
    [...text].forEach((_, k) => setTimeout(() => { input.value = text.slice(0, k + 1); }, (k * ms) / text.length));
  }

  // ---------- Capturas fijas ----------
  if (shot) {
    const list = [at(S.checkout, 0), at(S.pagos, 1), at(S.postgres, 12)];
    if (shot === 'hero') {
      state('working', list, { tool: 'edit' });
      open(true);
      setTimeout(() => document.querySelector('.row[data-id=a3]')?.click(), 300);
    }
    if (shot === 'working') state('working', list, { tool: 'edit' });
    if (shot === 'waiting') state('waiting', [at(S.pagos, 0, { status: 'waiting', waitingSince: Date.now(), detail: 'Claude necesita tu permiso para usar Bash' }), at(S.checkout, 1), at(S.postgres, 12)]);
    if (shot === 'peek') {
      state('working', [at(S.checkout, 0, { status: 'done', detail: DONE_MSG, tool: '' }), at(S.pagos, 1), at(S.postgres, 12)]);
      api.emit('finished', 'a1');
    }
    if (shot === 'pets') $('skinsScene').classList.add('in');
    setTimeout(() => (window.SHOT_READY = true), 1600);
    return;
  }

  // ---------- Anuncio: 17 segundos ----------
  state('sleep', []);
  const cue = (s, fn) => setTimeout(fn, s * 1000);
  window.start = () => {
    cue(0.25, () => notchStage.classList.add('in'));
    cue(0.7, () => headline('Tu Claude,', 'siempre <em>a la vista.</em>'));
    cue(1.7, () => state('idle', [at(S.postgres, 20)]));
    cue(2.5, () => state('working', [at(S.checkout, 0), at(S.pagos, 0), at(S.postgres, 21)], { tool: 'edit' }));
    cue(3.0, () => headline('Mira qué hacen', 'tus sesiones <em>sin abrir nada.</em>'));
    cue(3.6, () => open(true));
    cue(5.9, () => open(false));
    cue(6.3, () => state('waiting', [at(S.pagos, 0, { status: 'waiting', waitingSince: Date.now(), detail: 'Claude necesita tu permiso para usar Bash' }), at(S.checkout, 0), at(S.postgres, 25)]));
    cue(6.5, () => headline('Te avisa cuando', '<em>te necesita.</em>'));
    cue(8.7, () => state('working', [at(S.pagos, 0), at(S.checkout, 0), at(S.postgres, 25)], { tool: 'term' }));
    cue(9.2, () => {
      state('working', [at(S.checkout, 0, { status: 'done', detail: DONE_MSG, tool: '' }), at(S.pagos, 0)], { tool: 'term', max: 1 });
      api.emit('finished', 'a1');
    });
    cue(9.5, () => headline('Y te cuenta cuándo', '<em>ha terminado.</em>'));
    cue(11.3, () => open(true));
    cue(11.6, () => headline('Contéstale desde', '<em>el propio notch.</em>'));
    cue(12.0, () => typeInto('Perfecto, súbelo a producción', 1100));
    cue(13.4, () => { open(false); state('happy', [at(S.checkout, 0, { status: 'done', detail: DONE_MSG, prompt: 'Perfecto, súbelo a producción' }), at(S.pagos, 0), at(S.postgres, 26)]); });
    cue(13.6, () => { $('skinsScene').classList.add('in'); headline('Y elige', 'tu <em>mascota.</em>'); });
    cue(15.2, () => { $('skinsScene').classList.replace('in', 'leave'); notchStage.classList.replace('in', 'out'); headline(null); });
    cue(15.5, () => $('endCard').classList.add('in'));
  };
  document.fonts.ready.then(() => (window.SCENE_READY = true));
})();
