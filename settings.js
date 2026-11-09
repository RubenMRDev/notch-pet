// Ventana de ajustes: navegacion por apartados, vista previa de la mascota y todas las opciones.
(() => {
  const { api } = window;
  const { PET, ICON, esc, fileUrl } = window.NP;
  const $ = id => document.getElementById(id);
  const clean = err => String(err?.message || err).replace(/^.*?Error: /, '');
  let cfg = null;

  for (const el of document.querySelectorAll('[data-icon]')) el.outerHTML = ICON[el.dataset.icon] || '';
  $('brandPet').innerHTML = PET;
  $('mockPet').innerHTML = PET;

  // ---------- Navegacion ----------
  const PAGES = ['mascota', 'avisos', 'notch', 'claude', 'general'];
  function show() {
    const page = PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'mascota';
    for (const s of document.querySelectorAll('.page')) s.classList.toggle('on', s.dataset.page === page);
    for (const a of document.querySelectorAll('nav a')) {
      if (a.dataset.page === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
    $('content').scrollTop = 0;
  }
  window.addEventListener('hashchange', show);
  show();

  async function save(patch, msgEl) {
    try { cfg = await api.invoke('config:set', patch); apply(cfg); return true; }
    catch (err) { if (msgEl) { msgEl.className = 'msg err'; msgEl.textContent = clean(err); } apply(cfg); return false; }
  }

  // ---------- Aplicar la config a la pantalla ----------
  const SWITCHES = ['sound', 'notify', 'dnd', 'hideFullscreen', 'autostart'];
  const SELECTS = ['finishAlert', 'maxSessions', 'openWith', 'display'];
  function apply(c) {
    if (!c) return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(c.colors)) {
      root.style.setProperty(`--${k}`, v);
      const input = $(`c-${k}`); if (input) { input.value = v; input.nextElementSibling.textContent = v.toUpperCase(); }
    }
    const skin = c.skin === 'image' && !c.customImage ? 'blob' : c.skin;
    for (const el of [$('mockShell'), $('brandPet')]) el.dataset.skin = skin;
    for (const img of document.querySelectorAll('.custom')) if (c.customImage) img.src = fileUrl(c.customImage);
    for (const b of $('skins').children) b.setAttribute('aria-checked', b.dataset.skin === skin);
    $('skins').querySelector('[data-skin=image] .tile').innerHTML = c.customImage ? PET : `<span class="add">${ICON.image}</span>`;
    if (c.customImage) for (const img of $('skins').querySelectorAll('[data-skin=image] .custom')) img.src = fileUrl(c.customImage);
    for (const k of SWITCHES) $(k).checked = !!c[k];
    for (const k of SELECTS) $(k).value = String(c[k]);
    renderKeys(c.shortcut);
    if (c.shortcutOk === false) { $('shortcutMsg').className = 'msg err'; $('shortcutMsg').textContent = `Otra aplicación ya usa ${pretty(c.shortcut)}. Elige otra combinación.`; }
  }

  // ---------- Vista previa ----------
  const LABELS = { sleep: 'Zzz…', idle: 'Tranquila', bored: 'Me aburro…', working: 'Trabajando', waiting: 'Te necesita', impatient: 'Lleva 6 min esperando', happy: '¡Listo!' };
  const FX = { sleep: 'z', bored: '…', waiting: '!', impatient: '!!' };
  let mood = 'sleep', tool = '';
  function renderMock() {
    const m = $('mock');
    m.className = `mock ${mood === 'impatient' ? 'waiting impatient' : mood}`;
    if (mood === 'working' && tool) m.dataset.tool = tool; else delete m.dataset.tool;
    m.querySelector('.fx').textContent = FX[mood] || '';
    $('mockLabel').textContent = LABELS[mood];
    $('tools').hidden = mood !== 'working';
  }
  function seg(id, attr, set) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      for (const x of $(id).children) x.setAttribute('aria-pressed', x === b);
      set(b.dataset[attr]); renderMock();
    });
  }
  seg('moods', 'mood', v => (mood = v));
  seg('tools', 'tool', v => (tool = v));
  renderMock();
  $('testNotch').onclick = () => api.send('test-mood', { mood: mood === 'impatient' ? 'waiting' : mood, impatient: mood === 'impatient', tool: mood === 'working' ? tool : '' });

  // ---------- Aspectos ----------
  const SKINS = [['blob', 'Gota'], ['cat', 'Gato'], ['ghost', 'Fantasma'], ['robot', 'Robot'], ['image', 'Imagen']];
  $('skins').innerHTML = SKINS.map(([k, name]) =>
    `<button class="skin" role="radio" data-skin="${k}" aria-checked="false"><span class="tile idle">${PET}</span>${name}</button>`).join('');
  $('skins').addEventListener('click', async e => {
    const b = e.target.closest('.skin'); if (!b) return;
    if (b.dataset.skin === 'image' && (!cfg.customImage || b.getAttribute('aria-checked') === 'true')) {
      $('skinMsg').textContent = '';
      try { cfg = await api.invoke('pick-image'); apply(cfg); } catch (err) { $('skinMsg').className = 'msg err'; $('skinMsg').textContent = clean(err); }
      return;
    }
    save({ skin: b.dataset.skin }, $('skinMsg'));
  });

  // ---------- Colores ----------
  const COLORS = [['pet', 'Mascota', 'El color de su cuerpo.'], ['bg', 'Fondo del notch', 'La pastilla de arriba.'],
    ['work', 'Trabajando', 'Indicador de las sesiones en marcha.'], ['wait', 'Te necesita', 'Cuando una sesión pide permiso.'],
    ['done', 'Terminada', 'Cuando una sesión acaba.']];
  $('colors').innerHTML = COLORS.map(([k, name, hint]) =>
    `<div class="row"><label for="c-${k}">${name}<small>${hint}</small></label><span class="swatch"><input type="color" id="c-${k}" data-key="${k}"><code></code></span></div>`).join('');
  let colorTimer;
  $('colors').addEventListener('input', e => {
    const k = e.target.dataset.key; if (!k) return;
    document.documentElement.style.setProperty(`--${k}`, e.target.value);
    e.target.nextElementSibling.textContent = e.target.value.toUpperCase();
    clearTimeout(colorTimer);
    colorTimer = setTimeout(() => save({ colors: { [k]: e.target.value } }), 120);
  });
  $('reset').onclick = async () => { cfg = await api.invoke('config:reset'); apply(cfg); };

  // ---------- Opciones simples ----------
  for (const k of SWITCHES) $(k).onchange = e => save({ [k]: e.target.checked });
  for (const k of SELECTS) $(k).onchange = e => save({ [k]: k === 'maxSessions' ? +e.target.value : e.target.value });
  $('testAlert').onclick = () => api.send('test-alert');

  // ---------- Atajo: se graba pulsando la combinacion ----------
  const pretty = acc => (acc || '').split('+').map(p => ({ CommandOrControl: 'Ctrl', Super: 'Win', Space: 'Espacio' }[p] || p)).join(' + ');
  function renderKeys(acc) {
    if ($('shortcut').classList.contains('recording')) return;
    $('shortcut').innerHTML = acc ? pretty(acc).split(' + ').map(k => `<kbd>${esc(k)}</kbd>`).join('') : 'Sin atajo';
    $('shortcut').setAttribute('aria-label', `Atajo: ${pretty(acc) || 'ninguno'}. Pulsa para cambiarlo.`);
  }
  const CODES = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter',
    Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', BracketLeft: '[', BracketRight: ']', Backquote: '`' };
  function accel(e) {
    if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return null;
    const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5)
      : /^F\d{1,2}$/.test(e.code) ? e.code : CODES[e.code];
    if (!key) return null;
    const mods = [e.ctrlKey && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
    return mods.length || /^F\d+$/.test(key) ? [...mods, key].join('+') : 'needmod';
  }
  const sc = $('shortcut'), scMsg = $('shortcutMsg');
  sc.onclick = () => { sc.classList.add('recording'); sc.textContent = 'Pulsa la combinación… (Esc para cancelar)'; scMsg.textContent = ''; };
  sc.addEventListener('blur', () => { sc.classList.remove('recording'); renderKeys(cfg.shortcut); });
  sc.addEventListener('keydown', async e => {
    if (!sc.classList.contains('recording')) return;
    e.preventDefault();
    if (e.key === 'Escape') return sc.blur();
    const acc = accel(e);
    if (!acc) return;
    if (acc === 'needmod') { scMsg.className = 'msg err'; scMsg.textContent = 'Usa al menos Ctrl, Alt o Win con la tecla.'; return; }
    sc.classList.remove('recording');
    if (await save({ shortcut: acc }, scMsg)) { scMsg.className = 'msg ok'; scMsg.textContent = `Listo: ${pretty(acc)}.`; }
    sc.blur();
  });

  // ---------- Hooks ----------
  function renderHooks(s) {
    const n = s.installed.length, all = n === s.events.length;
    const state = s.outdated ? ['part', 'Ruta antigua'] : all ? ['on', 'Conectada'] : n ? ['part', `Parcial · ${n}/${s.events.length}`] : ['', 'Sin conectar'];
    $('badge').className = `badge ${state[0]}`; $('badge').textContent = state[1];
    $('hookPath').textContent = s.file;
    $('events').innerHTML = s.events.map(ev => `<span class="ev ${s.installed.includes(ev) ? 'on' : ''}">${ev}</span>`).join('');
    $('install').textContent = s.outdated ? 'Actualizar hooks' : n && !all ? 'Completar hooks' : 'Instalar hooks';
    $('install').disabled = all && !s.outdated;
    $('uninstall').disabled = !n;
    $('navdot').classList.toggle('on', !all || s.outdated);
  }
  async function hookAction(name, okText) {
    const msg = $('hookMsg');
    try { renderHooks(await api.invoke(`hooks:${name}`)); msg.className = 'msg ok'; msg.textContent = okText; }
    catch (err) { msg.className = 'msg err'; msg.textContent = `No se pudo: ${clean(err)}`; }
  }
  $('install').onclick = () => hookAction('install', 'Hooks instalados. Las sesiones nuevas ya avisan a la mascota.');
  $('uninstall').onclick = () => hookAction('uninstall', 'Hooks quitados. La mascota seguirá viendo tus sesiones, con algo menos de detalle.');

  // ---------- General ----------
  $('openData').onclick = () => api.send('open-logs');
  $('quitApp').onclick = () => api.send('quit');

  // ---------- Arranque ----------
  (async () => {
    try {
      const [displays, info] = await Promise.all([api.invoke('displays'), api.invoke('app:info')]);
      $('display').innerHTML = '<option value="primary">La principal</option><option value="follow">La que tenga el ratón</option>'
        + displays.map(d => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
      $('version').textContent = `Versión ${info.version}`;
      $('about').textContent = `Notch Pet ${info.version} · Electron ${info.electron}`;
      $('dataPath').textContent = info.data;
      cfg = await api.invoke('config:get');
      apply(cfg);
    } catch (err) { document.body.insertAdjacentHTML('afterbegin', `<p class="msg err">No se pudieron cargar los ajustes: ${esc(clean(err))}</p>`); }
    try { renderHooks(await api.invoke('hooks:status')); }
    catch (err) { $('hookMsg').className = 'msg err'; $('hookMsg').textContent = `No se pudo leer tu settings.json: ${clean(err)}`; }
  })();
})();
