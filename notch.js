// El notch: barra con la mascota, lista de sesiones, tarjeta de "ha terminado" y caja para escribir a una sesion.
(() => {
  const { api } = window;
  const { PET, ICON, esc, fileUrl, t, tn } = window.NP;
  const $ = id => document.getElementById(id);
  const shell = $('shell');

  $('petslot').innerHTML = PET;
  $('gear').innerHTML = ICON.sliders;
  $('quit').innerHTML = ICON.close;
  $('gear').onclick = () => api.send('open-settings');
  $('quit').onclick = () => api.send('quit');
  const pet = document.querySelector('#petslot .pet');
  // Un fallo al tratar un mensaje de la app no puede dejar el notch congelado: se apunta en el registro y sigue.
  const on = (ch, fn) => api.on(ch, (...a) => { try { fn(...a); } catch (e) { console.error(`notch[${ch}]: ${e?.stack || e}`); } });
  window.addEventListener('error', e => console.error(`notch: ${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', e => console.error(`notch: promesa ${e.reason?.stack || e.reason}`));
  // Cualquier dato de una sesion se trata como texto, venga como venga (numero, bloques, objeto, vacio).
  const str = v => (typeof v === 'string' ? v : v == null ? '' : Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : x?.text || '')).join('\n') : typeof v === 'object' ? (v.text ?? '') + '' : String(v));

  let pressed = false, lastHtml = '', lastMove = 0, moveTimer;
  let last = null, openId = null, full = false, typing = false, pending = null, peekId = null;
  const drafts = new Map(), notes = new Map();
  const picks = new Map(); // askId -> { [indice de pregunta]: Set de opciones | texto propio }
  const askErr = new Map();
  const atts = new Map(); // sesion -> [{ media_type, data, url }] imagenes adjuntas al mensaje

  // ---------- Utilidades de texto ----------
  const folder = p => (p || '').split(/[\\/]/).filter(Boolean).pop() || t('session');
  const nameOf = s => str(s?.title) || folder(str(s?.cwd));
  // La app de Claude titula las bifurcaciones «Titulo (fork)»: la marca va aparte para que los puntos suspensivos no se la coman.
  const FORK = /\s*\(fork\)$/i;
  const nameHtml = s => `<span class="name">${esc(nameOf(s).replace(FORK, ''))}</span>${FORK.test(nameOf(s)) ? '<span class="tag">fork</span>' : ''}`;
  const mins = ms => Math.max(0, Math.round(ms / 60e3));
  const ago = (now, at) => { const m = mins(now - at); return m < 1 ? t('now') : m < 60 ? t('minutes_short', { n: m }) : m < 1440 ? t('hours_short', { n: Math.round(m / 60) }) : t('days_short', { n: Math.round(m / 1440) }); };
  const dur = ms => { const m = mins(ms); return m < 60 ? t('minutes_short', { n: m }) : t('hours_minutes_short', { h: Math.floor(m / 60), m: m % 60 }); };
  const count = (list, st) => list.filter(s => s.status === st).length;
  // Nombre de herramienta -> lo que esta haciendo, en cristiano. Solo para nombres exactos de herramienta.
  const TOOL = [[/^(Read|LS|NotebookRead)$/, 'reading_files'], [/^(Grep|Glob)$/, 'searching_code'],
    [/^(Edit|MultiEdit|Write|NotebookEdit)$/, 'editing_files'], [/^(Bash|PowerShell)$/, 'running_commands'],
    [/^(WebFetch|WebSearch)$/, 'searching_web'], [/^(Task|Agent)$/, 'launching_agent'], [/^TodoWrite$/, 'organizing_tasks']];
  const toolName = t => str(t).replace(/^mcp__.+?__/, '');
  const friendly = tool => { const k = (TOOL.find(([re]) => re.test(toolName(tool))) || [])[1]; return k ? t(k) : toolName(tool); };
  // Primer parrafo del ultimo mensaje (los bloques de codigo se quedan en [código]).
  const summary = x => {
    const p = str(x).replace(/```[\s\S]*?```/g, t('code_block')).split(/\n\s*\n/).find(x => x.trim()) || '';
    return p.length > 240 ? p.slice(0, 239) + '…' : p.trim();
  };
  const plain = x => summary(x).replace(/[*_`#>]/g, '');
  // Markdown basico -> HTML. Primero se escapa todo: el texto de Claude nunca se interpreta como HTML.
  // ponytail: cubre lo que usa Claude (codigo, negrita, cursiva, titulos, listas, enlaces); sin tablas.
  function md(t) {
    const blocks = [];
    let h = esc(str(t)).replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => `\u0000${blocks.push(code.replace(/\n$/, '')) - 1}\u0000`);
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

  // ---------- Idioma: al cambiarlo se repinta todo ----------
  on('i18n', l => { window.NP.setLocale(l); lastHtml = ''; if (last) render(last); });

  // ---------- Config ----------
  on('config', c => {
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
  on('chime', kind => tones(kind === 'done' ? [[784, 0], [1046, .1], [1318, .2]] : [[880, 0], [1320, .12]]));

  // ---------- Barra ----------
  function header(st) {
    const { mood, sessions, impatient, now } = st;
    const first = status => sessions.find(s => s.status === status);
    if (peekId) { const s = sessions.find(x => x.id === peekId); return [s?.asks?.length ? t('needs_you') : t('has_finished'), s ? nameOf(s) : '']; }
    if (mood === 'waiting') { const s = first('waiting'); return [impatient ? t('waiting_for_minutes', { n: mins(now - s.waitingSince) }) : t('needs_you'), nameOf(s)]; }
    if (mood === 'working') { const n = count(sessions, 'working'); return [t('working'), n > 1 ? tn('session_count', n) : nameOf(first('working'))]; }
    if (mood === 'happy') { const s = first('done'); return [t('ready'), s ? nameOf(s) : '']; }
    if (mood === 'idle') return [t('calm'), ''];
    if (mood === 'bored') return [t('bored'), ''];
    return [t('zzz'), ''];
  }
  function counters(sessions) {
    const w = count(sessions, 'working'), q = count(sessions, 'waiting');
    return (q ? `<span class="cnt" title="${esc(t('waiting_permission_count', { n: q }))}"><i class="pdot"></i>${q}</span>` : '')
      + (w ? `<span class="cnt" title="${esc(t('working_count', { n: w }))}"><i class="spin"></i>${w}</span>` : '');
  }

  // ---------- Filas ----------
  const BUSY = { working: 'busy_working_queue', waiting: 'busy_waiting_queue' };
  const indicator = s => s.status === 'working' ? '<i class="spin"></i>' : s.status === 'waiting' ? '<i class="pdot"></i>'
    : s.status === 'done' ? `<span class="ok">${ICON.check}</span>` : '<i class="ring"></i>';
  // ---------- Lo que te pide la sesion: permiso, pregunta o plan ----------
  const err = a => (askErr.get(a.id) ? `<p class="hint err">${esc(askErr.get(a.id))}</p>` : '');
  function askHtml(a) {
    const sel = picks.get(a.id) || {};
    const head = `<div class="ask-head">${esc(a.title)}</div>`;
    if (a.kind === 'question') {
      const qs = (a.questions || []).map((q, qi) => {
        const chosen = sel[qi];
        const opts = (q.options || []).map(o => {
          const on = chosen instanceof Set ? chosen.has(o.label) : chosen === o.label;
          return `<button class="opt ${on ? 'on' : ''}" data-q="${qi}" data-label="${esc(o.label)}" ${o.description ? `title="${esc(o.description)}"` : ''}>${esc(o.label)}</button>`;
        }).join('');
        const own = typeof chosen === 'string' && !(q.options || []).some(o => o.label === chosen) ? chosen : '';
        return `<div class="q"><p>${esc(q.question)}${q.multiSelect ? ` <span class="hintline">${esc(t('can_select_multiple'))}</span>` : ''}</p>
          <div class="opts">${opts}</div>
          <input class="own" data-q="${qi}" placeholder="${esc(t('other_answer'))}" value="${esc(own)}" maxlength="500" aria-label="${esc(t('other_answer'))}"></div>`;
      }).join('');
      const single = (a.questions || []).length === 1 && !a.questions[0].multiSelect;
      return `<div class="extra askbox" data-ask="${esc(a.id)}">${head}${qs}
        <div class="ask-actions"><button class="abtn" data-act="deny">${esc(t('skip'))}</button>${single ? '' : `<button class="abtn primary" data-act="answer">${esc(t('answer'))}</button>`}</div>${err(a)}</div>`;
    }
    if (a.kind === 'plan') {
      return `<div class="extra askbox" data-ask="${esc(a.id)}">${head}<div class="plan">${md(a.detail)}</div>
        <div class="ask-actions"><button class="abtn" data-act="deny">${esc(t('keep_planning'))}</button><button class="abtn primary" data-act="allow">${esc(t('approve_plan'))}</button></div>${err(a)}</div>`;
    }
    return `<div class="extra askbox" data-ask="${esc(a.id)}">${head}${a.detail ? `<pre class="cmd">${esc(a.detail)}</pre>` : ''}
      <div class="ask-actions"><button class="abtn" data-act="deny">${esc(t('deny'))}</button>${a.canAlways ? `<button class="abtn" data-act="always">${esc(t('always_allow'))}</button>` : ''}<button class="abtn primary" data-act="allow">${esc(t('allow'))}</button></div>${err(a)}</div>`;
  }

  const attsHtml = id => (atts.get(id) || []).map((a, i) =>
    `<span class="att"><img src="${a.url}" alt="${esc(t('attached_image', { n: i + 1 }))}"><button class="att-x" data-i="${i}" aria-label="${esc(t('remove_image', { n: i + 1 }))}">${ICON.close}</button></span>`).join('');

  function safeRow(s, now) {
    try { return rowHtml(s, now); } catch (e) {
      console.error(`notch: no se pudo pintar la sesión ${s?.id}: ${e?.stack || e}`);
      return `<li class="row ${esc(str(s?.status))}" data-id="${esc(str(s?.id))}"><span class="st"><i class="ring"></i></span>
        <div class="main"><div class="top"><span class="name">${esc(nameOf(s) || t('session'))}</span></div><div class="detail">${esc(t('session_not_displayed'))}</div></div>
        <span class="ago"></span><button class="go" data-id="${esc(str(s?.id))}" aria-label="${esc(t('open_session'))}">${ICON.open}</button></li>`;
    }
  }
  function rowHtml(s, now) {
    const isOpen = s.id === openId;
    const raw = s.status === 'working' ? (s.tool ? friendly(s.tool) : toolName(s.detail) || t('thinking'))
      : str(s.detail) || (s.interrupted ? t('interrupted') : s.status === 'done' ? t('done') : str(s.prompt));
    const asks = s.asks || [];
    const busy = s.sending ? t('sending') : BUSY[s.status] ? t(BUSY[s.status]) : '';
    const queued = s.queued;
    const note = notes.get(s.id);
    const canMore = isOpen && summary(raw) !== raw.trim();
    return `
      <li class="row ${s.status} ${isOpen ? 'expanded' : ''}" data-id="${esc(s.id)}">
        <span class="st" title="${esc({ working: t('working'), waiting: t('needs_you'), done: t('finished'), idle: t('paused') }[s.status] || '')}">${indicator(s)}</span>
        <div class="main">
          <div class="top">${nameHtml(s)}${s.title ? `<span class="where">${esc(folder(s.cwd))}</span>` : ''}</div>
          ${isOpen ? '' : `<div class="detail">${esc(plain(raw))}</div>`}
        </div>
        <span class="ago">${ago(now, s.at)}</span>
        <button class="go" data-id="${esc(s.id)}" title="${esc(t('open_session'))}" aria-label="${esc(t('open_named', { name: nameOf(s) }))}">${ICON.open}</button>
        ${asks.map(askHtml).join('')}
        ${isOpen && !asks.length ? `
          ${s.prompt && s.status !== 'waiting' ? `<div class="extra ask">› ${esc(s.prompt)}</div>` : ''}
          <div class="extra detail">${md(full ? raw : summary(raw))}</div>
          ${canMore ? `<button class="extra more">${esc(full ? t('show_summary') : t('show_all'))}</button>` : ''}
          <div class="extra compose">
            <div class="atts">${attsHtml(s.id)}</div>
            <div class="field">
              <button class="clip" aria-label="${esc(t('attach_image'))}" title="${esc(t('attach_image_tip'))}">${ICON.image}</button>
              <input type="text" class="msg-in" placeholder="${esc(t('message_placeholder'))}" aria-label="${esc(t('message_for', { name: nameOf(s) }))}"
                value="${esc(drafts.get(s.id) || '')}" maxlength="4000">
              <button class="send" aria-label="${esc(busy ? t('send_when_done') : t('send'))}" title="${esc(busy ? t('send_when_done_enter') : t('send_enter'))}">${ICON.send}</button>
              <input type="file" class="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden>
            </div>
          </div>
          ${queued ? `<div class="extra hint queued">${esc(t('queued_message', { text: queued.text || t('image'), images: queued.images ? tn('plus_images', queued.images) : '' }))} <button class="unqueue">${esc(t('cancel'))}</button></div>`
            : note ? `<div class="extra hint ${note.err ? 'err' : 'ok'}">${esc(note.text)}</div>` : busy ? `<div class="extra hint">${esc(busy)}</div>` : ''}` : ''}
      </li>`;
  }

  // Caja de texto con el foco antes de repintar, para devolverla tal cual despues.
  function focusState() {
    const a = document.activeElement;
    if (!a || !a.matches?.('.msg-in, .own')) return null;
    return { row: a.closest('.row')?.dataset.id, ask: a.closest('.askbox')?.dataset.ask, q: a.dataset.q,
      own: a.matches('.own'), value: a.value, start: a.selectionStart, end: a.selectionEnd };
  }
  function restoreFocus(k) {
    if (!k) return;
    const list = $('list');
    const el = k.own ? list.querySelector(`.askbox[data-ask="${CSS.escape(k.ask || '')}"] .own[data-q="${k.q}"]`)
      : list.querySelector(`.row[data-id="${CSS.escape(k.row || '')}"] .msg-in`);
    if (!el) return;
    el.value = k.value;
    el.focus({ preventScroll: true });
    try { el.setSelectionRange(k.start, k.end); } catch {}
  }

  // Alto del notch abierto = barra + panel. La ventana mide 460: lo que no quepa, hace scroll en la lista.
  function measure() {
    requestAnimationFrame(() => {
      const h = Math.min(36 + document.querySelector('.panel').scrollHeight, 460);
      $('notch').style.setProperty('--open-h', `${h}px`);
      api.send('openH', h);
    });
  }

  // force: lo pide el usuario (un clic, enviar, responder). Las actualizaciones que llegan solas no son force.
  function render(st, force = true) {
    last = st;
    // Mientras escribes no se repinta la lista (perderias el foco); se aplica al terminar.
    // Mientras escribes o tienes el botón del ratón pulsado no se repinta: un clic no puede caer en una lista que cambia.
    // Solo cuenta como "escribiendo" si la ventana tiene de verdad el teclado: si Windows no se lo dio, la lista no se congela.
    // Solo se espera mientras tienes el boton del raton pulsado (como mucho 1,5 s): un clic no cae en una lista que cambia.
    // Escribiendo NO se congela: se repinta y se te devuelve la caja con su texto, el cursor y el foco.
    if (pressed) { pending = st; return; }
    // Mientras mueves el raton por la lista, lo que llega solo espera (hasta 0,7 s sin moverlo): las filas no saltan
    // justo cuando vas a pulsar. Tus clics se aplican al momento.
    if (!force && shell.classList.contains('open') && Date.now() - lastMove < 700) {
      pending = st;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => { if (pending) { const p = pending; pending = null; render(p, false); } }, 720 - (Date.now() - lastMove));
      return;
    }
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
    const html = shown.length ? shown.map(s => safeRow(s, st.now)).join('')
      : `<li class="empty"><b>${esc(t('no_sessions_yet'))}</b>${esc(t('open_session_hint'))}</li>`;
    if (html !== lastHtml) {
      const keep = focusState();
      $('list').innerHTML = html;
      lastHtml = html;
      restoreFocus(keep);
    }
    const { done = 0, tools = 0, workMs = 0 } = st.stats || {};
    $('stats').textContent = [t('today'), tn('finished_count', done), tn('tool_count', tools), t('working_time', { time: dur(workMs) })].join(' · ');
    measure();
  }
  on('state', st => render(st, false));
  setInterval(() => {
    if (!last || pressed) return;
    const shownOpen = document.querySelector('#list .row.expanded')?.dataset.id || null;
    const exists = openId && document.querySelector(`#list .row[data-id="${CSS.escape(openId)}"]`);
    if (exists && shownOpen !== openId) { console.error(`notch: lista desincronizada (abierta ${openId}, se ve ${shownOpen}); se repinta`); lastHtml = ''; render(last); }
  }, 2000);
  // Diagnostico: estado interno del notch (lo usan los tests)
  window.__notch = () => ({ pressed, typing, pending: !!pending, openId, peekId, open: shell.classList.contains('open'), rows: [...document.querySelectorAll('#list .row')].map(r => ({ id: r.dataset.id, expanded: r.classList.contains('expanded') })) });

  let order = [];
  on('open', o => {
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
    if (a) $('peekcard').innerHTML = `<div class="pk ask"><div class="top"><i class="pdot"></i>${nameHtml(s)}</div>
      <p><b>${esc(a.title)}</b>${what ? ` · ${esc(what)}` : ''}</p><small>${esc(t('hover_to_answer'))}</small></div>`;
    else $('peekcard').innerHTML = `<div class="pk">
      <div class="top"><span class="ok">${ICON.check}</span>${nameHtml(s)}${s.title ? `<span class="where">${esc(folder(s.cwd))}</span>` : ''}</div>
      <p>${esc(plain(s.detail))}</p><small>${esc(t('hover_to_view_reply'))}</small></div>`;
    shell.classList.add('peek');
    if (last) render(last);
    requestAnimationFrame(() => {
      const h = Math.min(36 + $('peekcard').offsetHeight, 220);
      $('notch').style.setProperty('--peek-h', `${h}px`);
      api.send('peekH', h);
    });
  }
  function endPeek() { peekId = null; shell.classList.remove('peek'); if (last) render(last); }
  on('finished', id => { peekId = id; showPeek(); });
  // Llega una peticion: aviso con la tarjeta; al pasar el raton, esa sesion sale con sus botones.
  on('asked', id => { peekId = id; showPeek(); });
  on('peek-end', () => { if (peekId) endPeek(); });

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
      ? { text: r.denied ? tn('done_with_denials', r.denied) : t('done_reply_above') }
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
  const release = () => { clearTimeout(pressTimer); setTimeout(() => { pressed = false; if (pending) { const p = pending; pending = null; render(p); } }, 0); };
  list.addEventListener('pointerdown', () => { pressed = true; clearTimeout(pressTimer); pressTimer = setTimeout(release, 1500); });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  // Si la ventana pierde el teclado, se deja de "escribir" (y la lista vuelve a repintarse).
  window.addEventListener('blur', () => { if (typing) { document.activeElement?.blur(); stopTyping(); } });
  list.addEventListener('pointermove', () => { lastMove = Date.now(); });
  const TYPED = '.msg-in, .own';
  list.addEventListener('focusin', e => { if (e.target.matches(TYPED)) { typing = true; api.send('typing', true); } });
  // Al repintar se cambia la caja por otra igual: solo se suelta el teclado si ya no queda ninguna con el foco.
  list.addEventListener('focusout', e => { if (e.target.matches(TYPED)) setTimeout(() => { if (!document.activeElement?.matches?.(TYPED)) stopTyping(); }, 0); });
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
    // Si estas seleccionando texto de esta misma fila, el clic es para copiar, no para abrirla.
    const sel = getSelection(), box = e.target.closest('.detail, .ask');
    if (box && sel.toString() && box.contains(sel.anchorNode)) return;
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
      if (list.length >= 4) { notes.set(id, { text: t('max_images', { n: 4 }), err: true }); break; }
      if (!OK_TYPES.includes(f.type)) { notes.set(id, { text: t('image_types_only'), err: true }); continue; }
      if (f.size > 5 * 1024 * 1024) { notes.set(id, { text: t('image_too_big', { name: f.name || t('image') }), err: true }); continue; }
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
