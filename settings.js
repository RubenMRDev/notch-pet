// Ventana de ajustes: navegacion por apartados, vista previa de la mascota y todas las opciones.
(async () => {
  const { api } = window;
  const { PET, ICON, esc, fileUrl, t, tn } = window.NP;
  const locale = await api.invoke('i18n:get').catch(() => null);
  window.NP.setLocale(locale);
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
  const SELECTS = ['finishAlert', 'maxSessions', 'openWith', 'display', 'lang'];
  function apply(c) {
    if (!c) return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(c.colors)) {
      root.style.setProperty(`--${k}`, v);
      const input = $(`c-${k}`); if (input) { input.value = v; input.nextElementSibling.textContent = v.toUpperCase(); }
    }
    const skin = c.skin === 'image' && !c.customImage ? 'blob' : c.skin;
    for (const el of [$('mockShell'), $('brandPet')]) el.dataset.skin = skin;
    root.dataset.style = c.style === 'pixel' ? 'pixel' : 'smooth';
    for (const b of $('styles').children) b.setAttribute('aria-pressed', b.dataset.style === root.dataset.style);
    window.NP.pixelize();
    $('styles').hidden = skin === 'doodle'; // el garabato tiene su propio trazo: suave u 8 bits no le cambian
    for (const img of document.querySelectorAll('.custom')) if (c.customImage) img.src = fileUrl(c.customImage);
    for (const b of $('skins').children) b.setAttribute('aria-checked', b.dataset.skin === skin);
    $('skins').querySelector('[data-skin=image] .tile').innerHTML = c.customImage ? PET : `<span class="add">${ICON.image}</span>`;
    if (c.customImage) for (const img of $('skins').querySelectorAll('[data-skin=image] .custom')) img.src = fileUrl(c.customImage);
    for (const k of SWITCHES) $(k).checked = !!c[k];
    for (const k of SELECTS) $(k).value = String(c[k]);
    renderKeys(c.shortcut);
    if (c.shortcutOk === false) { $('shortcutMsg').className = 'msg err'; $('shortcutMsg').textContent = t('another_app_uses_shortcut', { shortcut: pretty(c.shortcut) }); }
  }

  // ---------- Vista previa ----------
  const LABELS = { sleep: t('zzz'), idle: t('calm'), bored: t('bored'), working: t('working'), waiting: t('needs_you'), impatient: t('waiting_for_minutes', { n: 6 }), happy: t('ready') };
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
  const SKINS = [['blob', t('blob')], ['cat', t('cat')], ['ghost', t('ghost')], ['robot', t('robot')], ['doodle', t('doodle')], ['image', t('image')]];
  $('skins').innerHTML = SKINS.map(([k, name]) =>
    `<button class="skin" role="radio" data-skin="${k}" aria-checked="false"><span class="tile idle">${PET}</span>${esc(name)}</button>`).join('');
  $('skins').addEventListener('click', async e => {
    const b = e.target.closest('.skin'); if (!b) return;
    if (b.dataset.skin === 'image' && (!cfg.customImage || b.getAttribute('aria-checked') === 'true')) {
      $('skinMsg').textContent = '';
      try { cfg = await api.invoke('pick-image'); apply(cfg); } catch (err) { $('skinMsg').className = 'msg err'; $('skinMsg').textContent = clean(err); }
      return;
    }
    save({ skin: b.dataset.skin }, $('skinMsg'));
  });

  $('styles').addEventListener('click', e => { const b = e.target.closest('button'); if (b) save({ style: b.dataset.style }, $('skinMsg')); });

  // ---------- Colores ----------
  const COLORS = [['pet', t('pet'), t('pet_color_description')], ['bg', t('notch_background'), t('notch_background_description')],
    ['work', t('working'), t('working_color_description')], ['wait', t('needs_you'), t('waiting_color_description')],
    ['done', t('finished'), t('finished_color_description')]];
  $('colors').innerHTML = COLORS.map(([k, name, hint]) =>
    `<div class="row"><label for="c-${k}">${esc(name)}<small>${esc(hint)}</small></label><span class="swatch"><input type="color" id="c-${k}" data-key="${k}"><code></code></span></div>`).join('');
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
  const pretty = acc => (acc || '').split('+').map(p => ({ CommandOrControl: 'Ctrl', Super: 'Win', Space: t('space_key') }[p] || p)).join(' + ');
  function renderKeys(acc) {
    if ($('shortcut').classList.contains('recording')) return;
    $('shortcut').innerHTML = acc ? pretty(acc).split(' + ').map(k => `<kbd>${esc(k)}</kbd>`).join('') : esc(t('no_shortcut'));
    $('shortcut').setAttribute('aria-label', t('shortcut_aria', { shortcut: pretty(acc) || t('none') }));
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
  sc.onclick = () => { sc.classList.add('recording'); sc.textContent = t('press_combination'); scMsg.textContent = ''; };
  sc.addEventListener('blur', () => { sc.classList.remove('recording'); renderKeys(cfg.shortcut); });
  sc.addEventListener('keydown', async e => {
    if (!sc.classList.contains('recording')) return;
    e.preventDefault();
    if (e.key === 'Escape') return sc.blur();
    const acc = accel(e);
    if (!acc) return;
    if (acc === 'needmod') { scMsg.className = 'msg err'; scMsg.textContent = t('shortcut_needs_modifier'); return; }
    sc.classList.remove('recording');
    if (await save({ shortcut: acc }, scMsg)) { scMsg.className = 'msg ok'; scMsg.textContent = t('shortcut_saved', { shortcut: pretty(acc) }); }
    sc.blur();
  });

  // ---------- Hooks ----------
  function renderHooks(s) {
    const n = s.installed.length, all = n === s.events.length;
    const state = s.outdated ? ['part', t('old_path')] : all ? ['on', t('connected')] : n ? ['part', t('partial', { n, total: s.events.length })] : ['', t('not_connected')];
    $('badge').className = `badge ${state[0]}`; $('badge').textContent = state[1];
    $('hookPath').textContent = s.file;
    $('events').innerHTML = s.events.map(ev => `<span class="ev ${s.installed.includes(ev) ? 'on' : ''}">${ev}</span>`).join('');
    $('install').textContent = t(s.outdated ? 'update_hooks' : n && !all ? 'complete_hooks' : 'install_hooks');
    $('install').disabled = all && !s.outdated;
    $('uninstall').disabled = !n;
    $('navdot').classList.toggle('on', !all || s.outdated);
  }
  async function hookAction(name, okText) {
    const msg = $('hookMsg');
    try { renderHooks(await api.invoke(`hooks:${name}`)); msg.className = 'msg ok'; msg.textContent = okText; }
    catch (err) { msg.className = 'msg err'; msg.textContent = t('could_not', { error: clean(err) }); }
  }
  $('install').onclick = () => hookAction('install', t('hooks_installed'));
  $('uninstall').onclick = () => hookAction('uninstall', t('hooks_removed'));

  // ---------- Actualizaciones ----------
  const mb = b => (b ? `${Math.round(b / 1048576)} MB` : '');
  function renderUpdate(u) {
    const text = $('updText'), btn = $('updBtn'), bar = $('updBar');
    const show = (action, cls = '') => { btn.hidden = !action; btn.dataset.action = action; btn.textContent = action ? t(action) : ''; btn.className = `btn ${cls}`; btn.disabled = false; };
    bar.hidden = u.state !== 'downloading';
    switch (u.state) {
      case 'dev': text.textContent = t('dev_build_updates'); show(''); break;
      case 'checking': case 'idle': text.textContent = t('checking_new_version'); show(''); break;
      case 'none': text.textContent = t('latest_version', { version: u.current }); show('check_now'); break;
      case 'available': text.textContent = t('new_version', { version: u.version, size: u.size ? ` · ${mb(u.size)}` : '', current: u.current }); show('download'); break;
      case 'downloading': text.textContent = t('downloading', { version: u.version, percent: u.percent || 0 }); bar.style.setProperty('--p', (u.percent || 0) / 100); show(''); break;
      case 'ready': text.textContent = t('update_ready', { version: u.version }); show('restart_and_update', 'update-ready'); break;
      case 'error': text.textContent = t('check_failed', { error: u.message }); show('retry'); break;
    }
    $('version').textContent = t('version_number', { version: u.current });
  }
  $('updBtn').onclick = () => {
    const s = $('updBtn').dataset.action;
    $('updBtn').disabled = true;
    if (s === 'download') api.invoke('update:download');
    else if (s === 'restart_and_update') api.send('update:install');
    else api.invoke('update:check');
  };
  api.on('update', renderUpdate);
  api.invoke('update:status').then(renderUpdate).catch(() => {});

  // ---------- General ----------
  $('openData').onclick = () => api.send('open-logs');
  $('quitApp').onclick = () => api.send('quit');

  // ---------- Arranque ----------
  (async () => {
    try {
      const [displays, info] = await Promise.all([api.invoke('displays'), api.invoke('app:info')]);
      $('lang').innerHTML = `<option value="auto">${esc(t('system_language'))}</option>`
        + (locale?.names || []).map(l => `<option value="${esc(l.code)}">${esc(l.name)}</option>`).join('');
      $('display').innerHTML = `<option value="primary">${esc(t('primary_display'))}</option><option value="follow">${esc(t('mouse_display'))}</option>`
        + displays.map(d => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join('');
      $('version').textContent = t('version_number', { version: info.version });
      $('about').textContent = `Notch Pet ${info.version} · Electron ${info.electron}`;
      $('dataPath').textContent = info.data;
      cfg = await api.invoke('config:get');
      apply(cfg);
    } catch (err) { document.body.insertAdjacentHTML('afterbegin', `<p class="msg err">${esc(t('settings_load_failed', { error: clean(err) }))}</p>`); }
    try { renderHooks(await api.invoke('hooks:status')); }
    catch (err) { $('hookMsg').className = 'msg err'; $('hookMsg').textContent = t('settings_json_read_failed', { error: clean(err) }); }
  })();
})();
