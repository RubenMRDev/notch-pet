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

  let pressed = false, lastHtml = '';
  let last = null, openId = null, full = false, typing = false, pending = null, peekId = null;
  const drafts = new Map(), notes = new Map();
  const picks = new Map(); // askId -> { [indice de pregunta]: Set de opciones | texto propio }
  const askErr = new Map();
  const atts = new Map(); // sesion -> [{ media_type, data, url }] imagenes adjuntas al mensaje

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
    root.dataset.style = c.style === 'pixel' ? 'pixel' : 'smooth';
    window.NP.pixelize();
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
    if (peekId) { const s = sessions.find(x => x.id === peekId); return [s?.asks?.length ? 'Te necesita' : 'Ha terminado', s ? nameOf(s) : '']; }
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
  const BUSY = { working: 'Está trabajando: lo que escribas se enviará cuando termine.', waiting: 'Espera tu permiso: lo que escribas se enviará cuando termine.' };
  const indicator = s => s.status === 'working' ? '<i class="spin"></i>' : s.status === 'waiting' ? '<i class="pdot"></i>'
    : s.status === 'done' ? `<span class="ok">${ICON.check}</span>` : '<i class="ring"></i>';
  // ---------- Lo que te pide la sesion: permiso, pregunta o plan ----------
  const err = a => (askErr.get(a.id) ? `<p class="hint err">${esc(askErr.get(a.id))}</p>` : '');
  function askHtml(a) {
    const sel = picks.get(a.id) || {};
    const head = `<div class="ask-head">${esc(a.title)}</div>`;
    if (a.kind === 'question') {
      const qs = a.questions.map((q, qi) => {
        const chosen = sel[qi];
        const opts = q.options.map(o => {
          const on = chosen instanceof Set ? chosen.has(o.label) : chosen === o.label;
          return `<button class="opt ${on ? 'on' : ''}" data-q="${qi}" data-label="${esc(o.label)}" ${o.description ? `title="${esc(o.description)}"` : ''}>${esc(o.label)}</button>`;
        }).join('');
        const own = typeof chosen === 'string' && !q.options.some(o => o.label === chosen) ? chosen : '';
        return `<div class="q"><p>${esc(q.question)}${q.multiSelect ? ' <span class="hintline">(puedes marcar varias)</span>' : ''}</p>
          <div class="opts">${opts}</div>
          <input class="own" data-q="${qi}" placeholder="Otra respuesta…" value="${esc(own)}" maxlength="500" aria-label="Otra respuesta"></div>`;
      }).join('');
      const single = a.questions.length === 1 && !a.questions[0].multiSelect;
      return `<div class="extra askbox" data-ask="${esc(a.id)}">${head}${qs}
        <div class="ask-actions"><button class="abtn" data-act="deny">Saltar</button>${single ? '' : '<button class="abtn primary" data-act="answer">Responder</button>'}</div>${err(a)}</div>`;
    }
    if (a.kind === 'plan') {
      return `<div class="extra askbox" data-ask="${esc(a.id)}">${head}<div class="plan">${md(a.detail)}</div>
        <div class="ask-actions"><button class="abtn" data-act="deny">Seguir planificando</button><button class="abtn primary" data-act="allow">Aprobar plan</button></div>${err(a)}</div>`;
    }
    return `<div class="extra askbox" data-ask="${esc(a.id)}">${head}${a.detail ? `<pre class="cmd">${esc(a.detail)}</pre>` : ''}
      <div class="ask-actions"><button class="abtn" data-act="deny">Denegar</button>${a.canAlways ? '<button class="abtn" data-act="always">Permitir siempre</button>' : ''}<button class="abtn primary" data-act="allow">Permitir</button></div>${err(a)}</div>`;
  }

  const attsHtml = id => (atts.get(id) || []).map((a, i) =>
    `<span class="att"><img src="${a.url}" alt="Imagen adjunta ${i + 1}"><button class="att-x" data-i="${i}" aria-label="Quitar imagen ${i + 1}">${ICON.close}</button></span>`).join('');

  function rowHtml(s, now) {
    const isOpen = s.id === openId;
    const raw = s.status === 'working' ? (s.tool ? friendly(s.tool) : toolName(s.detail) || 'Pensando…') : (s.detail || s.prompt || '');
    const asks = s.asks || [];
    const busy = s.sending ? 'Enviando…' : BUSY[s.status] || '';
    const queued = s.queued;
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
        ${asks.map(askHtml).join('')}
        ${isOpen && !asks.length ? `
          ${s.prompt && s.status !== 'waiting' ? `<div class="extra ask">› ${esc(s.prompt)}</div>` : ''}
          <div class="extra detail">${md(full ? raw : summary(raw))}</div>
          ${canMore ? `<button class="extra more">${full ? 'Ver resumen' : 'Ver todo'}</button>` : ''}
          <div class="extra compose">
            <div class="atts">${attsHtml(s.id)}</div>
            <div class="field">
              <button class="clip" aria-label="Adjuntar imagen" title="Adjuntar imagen (también puedes pegarla o arrastrarla)">${ICON.image}</button>
              <input type="text" class="msg-in" placeholder="Escríbele a esta sesión…" aria-label="Mensaje para ${esc(nameOf(s))}"
                value="${esc(drafts.get(s.id) || '')}" maxlength="4000">
              <button class="send" aria-label="${busy ? 'Enviar cuando termine' : 'Enviar'}" title="${busy ? 'Enviar cuando termine (Enter)' : 'Enviar (Enter)'}">${ICON.send}</button>
              <input type="file" class="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden>
            </div>
          </div>
          ${queued ? `<div class="extra hint queued">En cola: «${esc(queued.text || 'imagen')}»${queued.images ? ` + ${queued.images} ${queued.images === 1 ? 'imagen' : 'imágenes'}` : ''}. Se enviará cuando termine. <button class="unqueue">Cancelar</button></div>`
            : note ? `<div class="extra hint ${note.err ? 'err' : 'ok'}">${esc(note.text)}</div>` : busy ? `<div class="extra hint">${esc(busy)}</div>` : ''}` : ''}
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
    // Mientras escribes o tienes el botón del ratón pulsado no se repinta: un clic no puede caer en una lista que cambia.
    // Solo cuenta como "escribiendo" si la ventana tiene de verdad el teclado: si Windows no se lo dio, la lista no se congela.
    if ((typing && document.hasFocus()) || pressed) { pending = st; return; }
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
    // Las que te piden algo, siempre arriba: que no se muevan bajo el ratón mientras vas a pulsar.
    const asking = st.sessions.filter(s => s.asks?.length);
    let shown = [...asking, ...st.sessions.filter(s => !s.asks?.length).slice(0, Math.max(0, (st.max || 3) - asking.length))];
    // Con el notch abierto el orden no cambia (si no, la fila que vas a pulsar se mueve); las nuevas van al final.
    if (shell.classList.contains('open')) {
      for (const s of shown) if (!order.includes(s.id)) order.push(s.id);
      const pos = s => (s.asks?.length ? -1 : order.indexOf(s.id));
      shown = shown.slice().sort((a, b) => pos(a) - pos(b));
    }
    const html = shown.length ? shown.map(s => rowHtml(s, st.now)).join('')
      : '<li class="empty"><b>Aún no hay sesiones</b>Abre una sesión de Claude Code y aparecerá aquí.</li>';
    if (html !== lastHtml) { $('list').innerHTML = html; lastHtml = html; }
    const { done = 0, tools = 0, workMs = 0 } = st.stats || {};
    $('stats').textContent = `Hoy · ${done} ${done === 1 ? 'terminada' : 'terminadas'} · ${tools} herramientas · ${dur(workMs)} trabajando`;
    measure();
  }
  api.on('state', render);

  let order = [];
  api.on('open', o => {
    if (!o) order = []; // al cerrarlo se vuelve a ordenar por actividad
    shell.classList.toggle('open', o);
    // Si estaba la tarjeta de "ha terminado", al pasar el raton se abre la lista con esa sesion desplegada.
    if (o && peekId) { openId = peekId; full = false; endPeek(); }
  });

  // ---------- Tarjeta "ha terminado" ----------
  function showPeek() {
    const s = last?.sessions.find(x => x.id === peekId);
    if (!s) return endPeek();
    const a = s.asks?.[0];
    const what = !a ? '' : a.kind === 'question' ? a.questions[0]?.question : (a.detail || '').split('\n')[0];
    if (a) $('peekcard').innerHTML = `<div class="pk ask"><div class="top"><i class="pdot"></i><span class="name">${esc(nameOf(s))}</span></div>
      <p><b>${esc(a.title)}</b>${what ? ` · ${esc(what)}` : ''}</p><small>Pasa el ratón para responder</small></div>`;
    else $('peekcard').innerHTML = `<div class="pk">
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
  // Llega una peticion: aviso con la tarjeta; al pasar el raton, esa sesion sale con sus botones.
  api.on('asked', id => { peekId = id; showPeek(); });
  api.on('peek-end', () => { if (peekId) endPeek(); });

  // ---------- Responder lo que pide la sesion ----------
  const findAsk = id => { for (const x of last?.sessions || []) for (const a of x.asks || []) if (a.id === id) return a; return null; };
  async function decide(askId, choice) {
    askErr.delete(askId);
    const r = await api.invoke('permission:decide', { id: askId, choice });
    if (!r.ok) askErr.set(askId, r.error); else picks.delete(askId);
    if (last) render(last);
  }
  function answers(a) {
    const sel = picks.get(a.id) || {}, out = {};
    a.questions.forEach((q, qi) => {
      const v = sel[qi];
      const text = v instanceof Set ? [...v].join(', ') : v;
      if (text) out[q.question] = text;
    });
    return out;
  }
  function pick(btn) {
    const askId = btn.closest('.askbox').dataset.ask, a = findAsk(askId); if (!a) return;
    const qi = +btn.dataset.q, q = a.questions[qi], label = btn.dataset.label;
    const sel = picks.get(askId) || {};
    if (q.multiSelect) { const set = sel[qi] instanceof Set ? sel[qi] : new Set(); if (set.has(label)) set.delete(label); else set.add(label); sel[qi] = set; }
    else sel[qi] = label;
    picks.set(askId, sel);
    // Una sola pregunta de una sola opcion: elegir ya es responder.
    if (a.questions.length === 1 && !q.multiSelect) return decide(askId, { behavior: 'allow', answers: answers(a) });
    render(last);
  }
  function act(btn) {
    const askId = btn.closest('.askbox').dataset.ask, a = findAsk(askId); if (!a) return;
    const kind = btn.dataset.act;
    if (kind === 'deny') return decide(askId, { behavior: 'deny' });
    if (kind === 'answer') return decide(askId, { behavior: 'allow', answers: answers(a) });
    decide(askId, { behavior: 'allow', always: kind === 'always' });
  }

  // ---------- Escribir a una sesion ----------
  async function send(row) {
    const id = row.dataset.id, input = row.querySelector('.msg-in'), text = input.value.trim();
    const images = (atts.get(id) || []).map(({ media_type, data }) => ({ media_type, data }));
    if (!text && !images.length) return input.focus();
    drafts.delete(id); notes.delete(id); atts.delete(id);
    stopTyping();
    const r = await api.invoke('send', { id, text, images });
    notes.set(id, r.queued ? null : r.ok
      ? { text: r.denied ? `Hecho. ${r.denied} ${r.denied === 1 ? 'acción necesitaba' : 'acciones necesitaban'} tu permiso y no se hizo.` : 'Hecho. La respuesta está arriba.' }
      : { text: r.error, err: true });
    if (!notes.get(id)) notes.delete(id);
    if (last) render(last);
  }
  function stopTyping() {
    if (!typing) return;
    typing = false;
    api.send('typing', false);
    if (pending) { const p = pending; pending = null; render(p); }
  }
  const list = $('list');
  // Boton del raton pulsado dentro de la lista: se congela el repintado hasta soltarlo.
  let pressTimer;
  const release = () => { clearTimeout(pressTimer); setTimeout(() => { pressed = false; if (pending && !(typing && document.hasFocus())) { const p = pending; pending = null; render(p); } }, 0); };
  list.addEventListener('pointerdown', () => { pressed = true; clearTimeout(pressTimer); pressTimer = setTimeout(release, 1500); });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  // Si la ventana pierde el teclado, se deja de "escribir" (y la lista vuelve a repintarse).
  window.addEventListener('blur', () => { if (typing) { document.activeElement?.blur(); stopTyping(); } });
  const TYPED = '.msg-in, .own';
  list.addEventListener('focusin', e => { if (e.target.matches(TYPED)) { typing = true; api.send('typing', true); } });
  list.addEventListener('focusout', e => { if (e.target.matches(TYPED)) setTimeout(stopTyping, 0); });
  list.addEventListener('input', e => {
    if (e.target.matches('.own')) {
      const askId = e.target.closest('.askbox').dataset.ask, sel = picks.get(askId) || {};
      if (e.target.value.trim()) sel[+e.target.dataset.q] = e.target.value; else delete sel[+e.target.dataset.q];
      picks.set(askId, sel);
      for (const b of e.target.closest('.q').querySelectorAll('.opt')) b.classList.remove('on');
      return;
    }
    const row = e.target.closest('.row'); if (row && e.target.matches('.msg-in')) drafts.set(row.dataset.id, e.target.value);
  });
  list.addEventListener('keydown', e => {
    if (e.target.matches('.own')) {
      if (e.key === 'Escape') return e.target.blur();
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const a = findAsk(e.target.closest('.askbox').dataset.ask);
      e.target.blur();
      if (a) decide(a.id, { behavior: 'allow', answers: answers(a) });
      return;
    }
    if (!e.target.matches('.msg-in')) return;
    if (e.key === 'Enter') { e.preventDefault(); send(e.target.closest('.row')); }
    if (e.key === 'Escape') e.target.blur();
  });
  // La caja necesita que la ventana acepte el foco: se lo pedimos al tocarla.
  list.addEventListener('mousedown', e => { if (e.target.matches('.msg-in:not(:disabled), .own')) api.send('typing', true); });
  list.addEventListener('click', e => {
    const unq = e.target.closest('.unqueue');
    if (unq) { api.invoke('send:cancel', unq.closest('.row').dataset.id).then(() => last && render(last)); return; }
    const go = e.target.closest('.go');
    if (go) return api.send('open-session', go.dataset.id);
    if (e.target.closest('.send')) return send(e.target.closest('.row'));
    const clip = e.target.closest('.clip');
    if (clip) { api.send('typing', true); return clip.closest('.field').querySelector('.file').click(); }
    const x = e.target.closest('.att-x');
    if (x) {
      const row = x.closest('.row'), l = atts.get(row.dataset.id) || [];
      l.splice(+x.dataset.i, 1);
      row.querySelector('.atts').innerHTML = attsHtml(row.dataset.id);
      return measure();
    }
    const opt = e.target.closest('.opt'); if (opt) return pick(opt);
    const ab = e.target.closest('.abtn'); if (ab) return act(ab);
    if (e.target.closest('.askbox')) return;
    if (e.target.closest('.compose, .hint')) return;
    if (e.target.closest('.more')) { full = !full; return render(last); }
    if (e.target.closest('.detail, .ask') && getSelection().toString()) return; // dejar copiar texto
    const row = e.target.closest('.row'); if (!row) return;
    openId = openId === row.dataset.id ? null : row.dataset.id;
    full = false;
    render(last);
  });

  // ---------- Imagenes adjuntas ----------
  const OK_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  function addFiles(row, files) {
    const id = row.dataset.id, list = atts.get(id) || [];
    for (const f of files) {
      if (list.length >= 4) { notes.set(id, { text: 'Como mucho 4 imágenes por mensaje.', err: true }); break; }
      if (!OK_TYPES.includes(f.type)) { notes.set(id, { text: 'Solo imágenes PNG, JPG, GIF o WebP.', err: true }); continue; }
      if (f.size > 5 * 1024 * 1024) { notes.set(id, { text: `«${f.name || 'La imagen'}» pesa más de 5 MB.`, err: true }); continue; }
      const reader = new FileReader();
      const entry = { media_type: f.type, data: '', url: '' };
      list.push(entry);
      reader.onload = () => {
        entry.url = reader.result;
        entry.data = String(reader.result).split(',')[1] || '';
        const strip = row.querySelector('.atts'); if (strip) strip.innerHTML = attsHtml(id);
        measure();
      };
      reader.readAsDataURL(f);
    }
    atts.set(id, list);
  }
  list.addEventListener('paste', e => {
    const row = e.target.closest('.row'); if (!row || !e.target.matches('.msg-in')) return;
    const files = [...e.clipboardData.items].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); addFiles(row, files); }
  });
  list.addEventListener('dragover', e => { if (e.target.closest('.compose')) { e.preventDefault(); e.target.closest('.compose').classList.add('drop'); } });
  list.addEventListener('dragleave', e => e.target.closest('.compose')?.classList.remove('drop'));
  list.addEventListener('drop', e => {
    const box = e.target.closest('.compose'); if (!box) return;
    e.preventDefault(); box.classList.remove('drop');
    addFiles(box.closest('.row'), [...e.dataTransfer.files]);
  });
  list.addEventListener('change', e => {
    if (!e.target.matches('.file')) return;
    addFiles(e.target.closest('.row'), [...e.target.files]);
    e.target.value = '';
    e.target.closest('.row').querySelector('.msg-in')?.focus();
  });
  // Si cierras el selector sin elegir, el notch suelta el foco.
  list.addEventListener('cancel', e => { if (e.target.matches('.file') && !typing) api.send('typing', false); }, true);

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
