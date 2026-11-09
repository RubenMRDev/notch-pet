// El notch: barra con la mascota, lista de sesiones, tarjeta de "ha terminado" y caja para escribir a una sesion.
(() => {
  const { api } = window;
  const { PET, ICON, esc, fileUrl } = window.NP;
  const $ = id => document.getElementById(id);
  const shell = $('shell');

  $('petslot').innerHTML = PET;
  $('gear').innerHTML = ICON.sliders;
  $('quit').innerHTML = ICON.close;
  $('gear').onclick = () => api.send('open-settings');
  $('quit').onclick = () => api.send('quit');
  const pet = document.querySelector('#petslot .pet');

  let last = null, openId = null, full = false, typing = false, pending = null, peekId = null;
  const drafts = new Map(), notes = new Map();

  // ---------- Utilidades de texto ----------
  const folder = p => (p || '').split(/[\\/]/).filter(Boolean).pop() || 'sesión';
  const nameOf = s => s.title || folder(s.cwd);
  const mins = ms => Math.max(0, Math.round(ms / 60e3));
  const ago = (now, t) => { const m = mins(now - t); return m < 1 ? 'ahora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };
  const dur = ms => { const m = mins(ms); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const count = (list, st) => list.filter(s => s.status === st).length;
  // Nombre de herramienta -> lo que esta haciendo, en cristiano. Solo para nombres exactos de herramienta.
  const TOOL = [[/^(Read|LS|NotebookRead)$/, 'Leyendo archivos'], [/^(Grep|Glob)$/, 'Buscando en el código'],
    [/^(Edit|MultiEdit|Write|NotebookEdit)$/, 'Editando archivos'], [/^(Bash|PowerShell)$/, 'Ejecutando comandos'],
    [/^(WebFetch|WebSearch)$/, 'Buscando en la web'], [/^(Task|Agent)$/, 'Lanzando un agente'], [/^TodoWrite$/, 'Organizando tareas']];
  const toolName = t => (t || '').replace(/^mcp__.+?__/, '');
  const friendly = t => (TOOL.find(([re]) => re.test(toolName(t))) || [])[1] || toolName(t);
  // Primer parrafo del ultimo mensaje (los bloques de codigo se quedan en [código]).
  const summary = t => {
    const p = (t || '').replace(/```[\s\S]*?```/g, '[código]').split(/\n\s*\n/).find(x => x.trim()) || '';
    return p.length > 240 ? p.slice(0, 239) + '…' : p.trim();
  };
  const plain = t => summary(t).replace(/[*_`#>]/g, '');
  // Markdown basico -> HTML. Primero se escapa todo: el texto de Claude nunca se interpreta como HTML.
  // ponytail: cubre lo que usa Claude (codigo, negrita, cursiva, titulos, listas, enlaces); sin tablas.
  function md(t) {
    const blocks = [];
    let h = esc(t).replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(code.replace(/\n$/, '')) - 1}\u0000`);
    h = h
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|\s)_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '<span class="lnk">$1</span>')
      .replace(/^#{1,6}\s+(.+)$/gm, '<strong class="h">$1</strong>')
      .replace(/^(\s*)[-*]\s+/gm, '$1• ')
      .replace(/^&gt;\s?/gm, '│ ')
      .replace(/\*\*|`/g, '');
    return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre>${blocks[i]}</pre>`);
  }

  // ---------- Config ----------
  api.on('config', c => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(c.colors)) root.style.setProperty(`--${k}`, v);
    root.dataset.skin = c.skin === 'image' && !c.customImage ? 'blob' : c.skin;
    if (c.customImage) pet.querySelector('.custom').src = fileUrl(c.customImage);
  });

  // ---------- Sonidos (sintetizados, sin ficheros) ----------
  function tones(notes, gain = .16) {
    const ctx = new AudioContext();
    for (const [f, t] of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + t + .012);
      g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + t + .38);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .42);
    }
    setTimeout(() => ctx.close(), 1200);
  }
  api.on('chime', kind => tones(kind === 'done' ? [[784, 0], [1046, .1], [1318, .2]] : [[880, 0], [1320, .12]]));

  // ---------- Barra ----------
  function header(st) {
    const { mood, sessions, impatient, now } = st;
    const first = status => sessions.find(s => s.status === status);
    if (peekId) { const s = sessions.find(x => x.id === peekId); return ['Ha terminado', s ? nameOf(s) : '']; }
    if (mood === 'waiting') { const s = first('waiting'); return [impatient ? `Lleva ${mins(now - s.waitingSince)} min esperando` : 'Te necesita', nameOf(s)]; }
    if (mood === 'working') { const n = count(sessions, 'working'); return ['Trabajando', n > 1 ? `${n} sesiones` : nameOf(first('working'))]; }
    if (mood === 'happy') { const s = first('done'); return ['¡Listo!', s ? nameOf(s) : '']; }
    if (mood === 'idle') return ['Tranquila', ''];
    if (mood === 'bored') return ['Me aburro…', ''];
    return ['Zzz…', ''];
  }
  function counters(sessions) {
    const w = count(sessions, 'working'), q = count(sessions, 'waiting');
    return (q ? `<span class="cnt" title="${q} esperando tu permiso"><i class="pdot"></i>${q}</span>` : '')
      + (w ? `<span class="cnt" title="${w} trabajando"><i class="spin"></i>${w}</span>` : '');
  }

  // ---------- Filas ----------
  const BUSY = { working: 'Está trabajando. Podrás escribirle cuando termine.', waiting: 'Espera tu permiso en su ventana de Claude.' };
  const indicator = s => s.status === 'working' ? '<i class="spin"></i>' : s.status === 'waiting' ? '<i class="pdot"></i>'
    : s.status === 'done' ? `<span class="ok">${ICON.check}</span>` : '<i class="ring"></i>';
  function rowHtml(s, now) {
    const isOpen = s.id === openId;
    const raw = s.status === 'working' ? (s.tool ? friendly(s.tool) : toolName(s.detail) || 'Pensando…') : (s.detail || s.prompt || '');
    const busy = BUSY[s.status] || (s.sending && 'Enviando…');
    const note = notes.get(s.id);
    const canMore = isOpen && summary(raw) !== raw.trim();
    return `
      <li class="row ${s.status} ${isOpen ? 'expanded' : ''}" data-id="${esc(s.id)}">
        <span class="st" title="${esc({ working: 'Trabajando', waiting: 'Te necesita', done: 'Terminada', idle: 'En pausa' }[s.status] || '')}">${indicator(s)}</span>
        <div class="main">
          <div class="top"><span class="name">${esc(nameOf(s))}</span>${s.title ? `<span class="where">${esc(folder(s.cwd))}</span>` : ''}</div>
          ${isOpen ? '' : `<div class="detail">${esc(plain(raw))}</div>`}
        </div>
        <span class="ago">${ago(now, s.at)}</span>
        <button class="go" data-id="${esc(s.id)}" title="Abrir sesión" aria-label="Abrir ${esc(nameOf(s))}">${ICON.open}</button>
        ${isOpen ? `
          ${s.prompt && s.status !== 'waiting' ? `<div class="extra ask">› ${esc(s.prompt)}</div>` : ''}
          <div class="extra detail">${md(full ? raw : summary(raw))}</div>
          ${canMore ? `<button class="extra more">${full ? 'Ver resumen' : 'Ver todo'}</button>` : ''}
          <div class="extra compose">
            <input type="text" placeholder="Escríbele a esta sesión…" aria-label="Mensaje para ${esc(nameOf(s))}"
              value="${esc(drafts.get(s.id) || '')}" ${busy ? 'disabled' : ''} maxlength="4000">
            <button class="send" aria-label="Enviar" title="Enviar (Enter)" ${busy ? 'disabled' : ''}>${ICON.send}</button>
          </div>
          ${busy ? `<div class="extra hint">${esc(busy)}</div>` : note ? `<div class="extra hint ${note.err ? 'err' : 'ok'}">${esc(note.text)}</div>` : ''}` : ''}
      </li>`;
  }

  // Alto del notch abierto = barra + panel. La ventana mide 460: lo que no quepa, hace scroll en la lista.
  function measure() {
    requestAnimationFrame(() => {
      const h = Math.min(36 + document.querySelector('.panel').scrollHeight, 460);
      $('notch').style.setProperty('--open-h', `${h}px`);
      api.send('openH', h);
    });
  }

  function render(st) {
    last = st;
    // Mientras escribes no se repinta la lista (perderias el foco); se aplica al terminar.
    if (typing) { pending = st; return; }
    const body = document.body;
    body.className = st.mood + (st.impatient ? ' impatient' : '');
    if (st.tool) body.dataset.tool = st.tool; else delete body.dataset.tool;
    if (!pet.classList.contains('poke') && !pet.classList.contains('dizzy')) {
      pet.querySelector('.fx').textContent = st.impatient ? '!!' : { sleep: 'z', bored: '…', waiting: '!' }[st.mood] || '';
    }
    const [title, sub] = header(st);
    $('title').textContent = title;
    $('sub').textContent = sub;
    $('counters').innerHTML = counters(st.sessions);
    // Engorda un poco con cada sesion terminada hoy.
    body.style.setProperty('--fat', 1 + Math.min(st.stats.done || 0, 12) * .02);
    const shown = st.sessions.slice(0, st.max || 3);
    $('list').innerHTML = shown.length ? shown.map(s => rowHtml(s, st.now)).join('')
      : '<li class="empty"><b>Aún no hay sesiones</b>Abre una sesión de Claude Code y aparecerá aquí.</li>';
    const { done = 0, tools = 0, workMs = 0 } = st.stats || {};
    $('stats').textContent = `Hoy · ${done} ${done === 1 ? 'terminada' : 'terminadas'} · ${tools} herramientas · ${dur(workMs)} trabajando`;
    measure();
  }
  api.on('state', render);

  api.on('open', o => {
    shell.classList.toggle('open', o);
    // Si estaba la tarjeta de "ha terminado", al pasar el raton se abre la lista con esa sesion desplegada.
    if (o && peekId) { openId = peekId; full = false; endPeek(); }
  });

  // ---------- Tarjeta "ha terminado" ----------
  function showPeek() {
    const s = last?.sessions.find(x => x.id === peekId);
    if (!s) return endPeek();
    $('peekcard').innerHTML = `<div class="pk">
      <div class="top"><span class="ok">${ICON.check}</span><span class="name">${esc(nameOf(s))}</span>${s.title ? `<span class="where">${esc(folder(s.cwd))}</span>` : ''}</div>
      <p>${esc(plain(s.detail))}</p><small>Pasa el ratón para verla y contestarle</small></div>`;
    shell.classList.add('peek');
    if (last) render(last);
    requestAnimationFrame(() => {
      const h = Math.min(36 + $('peekcard').offsetHeight, 220);
      $('notch').style.setProperty('--peek-h', `${h}px`);
      api.send('peekH', h);
    });
  }
  function endPeek() { peekId = null; shell.classList.remove('peek'); if (last) render(last); }
  api.on('finished', id => { peekId = id; showPeek(); });
  api.on('peek-end', () => { if (peekId) endPeek(); });

  // ---------- Escribir a una sesion ----------
  async function send(row) {
    const id = row.dataset.id, input = row.querySelector('input'), text = input.value.trim();
    if (!text) return input.focus();
    drafts.delete(id); notes.delete(id);
    stopTyping();
    const r = await api.invoke('send', { id, text });
    notes.set(id, r.ok
      ? { text: r.denied ? `Hecho. ${r.denied} ${r.denied === 1 ? 'acción necesitaba' : 'acciones necesitaban'} tu permiso y no se hizo.` : 'Hecho. La respuesta está arriba.' }
      : { text: r.error, err: true });
    if (last) render(last);
  }
  function stopTyping() {
    if (!typing) return;
    typing = false;
    api.send('typing', false);
    if (pending) { const p = pending; pending = null; render(p); }
  }
  const list = $('list');
  list.addEventListener('focusin', e => { if (e.target.matches('.compose input')) { typing = true; api.send('typing', true); } });
  list.addEventListener('focusout', e => { if (e.target.matches('.compose input')) setTimeout(stopTyping, 0); });
  list.addEventListener('input', e => { const row = e.target.closest('.row'); if (row) drafts.set(row.dataset.id, e.target.value); });
  list.addEventListener('keydown', e => {
    if (!e.target.matches('.compose input')) return;
    if (e.key === 'Enter') { e.preventDefault(); send(e.target.closest('.row')); }
    if (e.key === 'Escape') e.target.blur();
  });
  // La caja necesita que la ventana acepte el foco: se lo pedimos al tocarla.
  list.addEventListener('mousedown', e => { if (e.target.matches('.compose input:not(:disabled)')) api.send('typing', true); });
  list.addEventListener('click', e => {
    const go = e.target.closest('.go');
    if (go) return api.send('open-session', go.dataset.id);
    if (e.target.closest('.send')) return send(e.target.closest('.row'));
    if (e.target.closest('.compose, .hint')) return;
    if (e.target.closest('.more')) { full = !full; return render(last); }
    if (e.target.closest('.detail, .ask') && getSelection().toString()) return; // dejar copiar texto
    const row = e.target.closest('.row'); if (!row) return;
    openId = openId === row.dataset.id ? null : row.dataset.id;
    full = false;
    render(last);
  });

  // ---------- Cosquillas: salta; si le das muchas veces seguidas, se marea ----------
  let clicks = [], tickle;
  pet.addEventListener('click', () => {
    const now = Date.now();
    clicks = clicks.filter(t => now - t < 1500).concat(now);
    const fx = pet.querySelector('.fx');
    clearTimeout(tickle);
    if (clicks.length >= 5) {
      pet.classList.remove('poke'); pet.classList.add('dizzy'); fx.textContent = '@';
      tickle = setTimeout(() => { pet.classList.remove('dizzy'); clicks = []; if (last) render(last); }, 2200);
      return;
    }
    if (pet.classList.contains('dizzy')) return;
    pet.classList.remove('poke'); void pet.offsetWidth; pet.classList.add('poke');
    fx.textContent = ['♥', '!', '♪', '?'][clicks.length % 4];
    tones([[520 + clicks.length * 120, 0]], .07);
    tickle = setTimeout(() => { pet.classList.remove('poke'); if (last) render(last); }, 600);
  });
})();
