// Piezas compartidas por el notch y los ajustes: la mascota, los iconos y el escapado de texto.
(() => {
  const PET = '<div class="pet" aria-hidden="true"><div class="body"><div class="eye l"></div><div class="eye r"></div>'
    + '<div class="mouth"></div><div class="cheek l"></div><div class="cheek r"></div></div>'
    + '<div class="pxslot"></div><img class="custom" alt=""><div class="acc"></div><div class="fx"></div></div>';

  // ---------- Mascotas en 8 bits ----------
  // Rejilla de 15x15. La forma de cada aspecto se rasteriza y de ella salen solos el contorno, la luz y la sombra;
  // las caras y los accesorios van en capas que se ven u ocultan segun el humor (pet.css).
  const N = 15;
  const SKIN = {
    blob: { eye: 8, light: [4.5, 6.5] },
    cat: { eye: 8, light: [4.5, 6.5] },
    ghost: { eye: 7, light: [4.5, 5] },
    robot: { eye: 7, light: [3.5, 5.5] },
  };
  function shape(skin) {
    const S = new Set(), add = (x, y) => S.add(`${x},${y}`);
    const ellipse = (cx, cy, rx, ry) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1) add(x, y); };
    if (skin === 'robot') {
      for (let y = 4; y <= 13; y++) for (let x = 1; x <= 13; x++) if (!((y === 4 || y === 13) && (x === 1 || x === 13))) add(x, y);
    } else if (skin === 'ghost') {
      ellipse(7.5, 8, 6.6, 6.4);
      for (let y = 8; y <= 13; y++) for (let x = 1; x <= 13; x++) add(x, y);
      for (const x of [1, 2, 3, 6, 7, 8, 11, 12, 13]) add(x, 14);
    } else {
      ellipse(7.5, 9.2, 7.3, 6);
      // orejas de 4 pixeles de base: asi tienen relleno y no solo contorno
      if (skin === 'cat') for (let y = 0; y <= 3; y++) for (let i = 0; i <= y; i++) { add(1 + i, y + 1); add(13 - i, y + 1); }
    }
    return S;
  }
  // Rectangulos de una fila: une los pixeles seguidos del mismo color (menos nodos en el SVG).
  const rects = (cells, cls) => {
    let out = '';
    for (let y = 0; y < N; y++) {
      let x = 0;
      while (x < N) {
        const c = cells[y][x];
        if (!c) { x++; continue; }
        let w = 1; while (x + w < N && cells[y][x + w] === c) w++;
        out += `<rect x="${x}" y="${y}" width="${w}" height="1" class="${cls || c}"/>`;
        x += w;
      }
    }
    return out;
  };
  const r = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${c}"/>`;

  function pixelPet(skin) {
    const S = shape(skin), has = (x, y) => S.has(`${x},${y}`), [lx, ly] = SKIN[skin].light;
    let maxY = 0; for (const k of S) maxY = Math.max(maxY, +k.split(',')[1]);
    const cells = Array.from({ length: N }, () => Array(N).fill(''));
    for (const k of S) {
      const [x, y] = k.split(',').map(Number);
      const edge = !has(x - 1, y) || !has(x + 1, y) || !has(x, y - 1) || !has(x, y + 1);
      cells[y][x] = edge ? 'o' : Math.hypot(x + .5 - lx, y + .5 - ly) < 2.1 ? 'h' : (y >= maxY - 1 || (x >= 11 && y >= maxY - 3)) ? 's' : 'b';
    }
    let body = rects(cells);
    const y0 = SKIN[skin].eye, eye = skin === 'robot' ? 'e' : 'k', my = y0 + 3;
    if (skin === 'robot') body += r(3, y0 - 1, 9, 4, 'v') + r(7, 2, 1, 2, 'o') + `<rect x="7" y="1" width="1" height="1" class="e beacon"/>`;
    // Caras: ojos abiertos, cerrados, de susto y contentos; bocas y mofletes
    const shine = skin === 'robot' ? '' : r(5, y0, 1, 1, 'w') + r(10, y0, 1, 1, 'w');
    const faces =
      `<g class="f-open">${r(4, y0, 2, 2, eye)}${r(9, y0, 2, 2, eye)}${shine}</g>`
      + `<g class="f-closed">${r(4, y0 + 1, 2, 1, eye)}${r(9, y0 + 1, 2, 1, eye)}</g>`
      + `<g class="f-wait">${r(4, y0 - 1, 2, 3, eye)}${r(9, y0 - 1, 2, 3, eye)}${skin === 'robot' ? '' : r(5, y0 - 1, 1, 1, 'w') + r(10, y0 - 1, 1, 1, 'w')}</g>`
      + `<g class="f-happy">${r(3, y0 + 1, 1, 1, eye)}${r(4, y0, 1, 1, eye)}${r(5, y0 + 1, 1, 1, eye)}${r(9, y0 + 1, 1, 1, eye)}${r(10, y0, 1, 1, eye)}${r(11, y0 + 1, 1, 1, eye)}</g>`;
    const mouths = skin === 'robot' ? '' :
      `<g class="m-smile">${r(6, my, 1, 1, 'k')}${r(7, my + 1, 1, 1, 'k')}${r(8, my, 1, 1, 'k')}</g>`
      + `<g class="m-dot">${r(7, my + 1, 1, 1, 'k')}</g>`
      + `<g class="m-flat">${r(6, my + 1, 3, 1, 'k')}</g>`
      + `<g class="m-o">${r(7, my, 1, 2, 'k')}</g>`
      + `<g class="m-open">${r(6, my, 3, 1, 'k')}${r(6, my + 1, 1, 1, 'k')}${r(7, my + 1, 1, 1, 'r')}${r(8, my + 1, 1, 1, 'k')}</g>`;
    const cheeks = skin === 'robot' ? '' : skin === 'cat'
      ? `<g class="ck">${r(0, y0 + 2, 2, 1, 'k')}${r(13, y0 + 2, 2, 1, 'k')}</g>`
      : `<g class="ck">${r(2, y0 + 2, 2, 1, 'r')}${r(11, y0 + 2, 2, 1, 'r')}</g>`;
    // Accesorios segun la herramienta: gafas, lapiz, terminal y globo
    const g = skin === 'robot' ? 'e' : 'k'; // gafas: en el robot, del color de sus ojos (sobre el visor negro no se verian)
    const acc =
      `<g class="a-read">${r(3, y0 - 1, 4, 1, g)}${r(3, y0 + 2, 4, 1, g)}${r(3, y0, 1, 2, g)}${r(6, y0, 1, 2, g)}`
      + `${r(8, y0 - 1, 4, 1, g)}${r(8, y0 + 2, 4, 1, g)}${r(8, y0, 1, 2, g)}${r(11, y0, 1, 2, g)}${r(7, y0, 1, 1, g)}</g>`
      + `<g class="a-edit">${r(14, 2, 1, 1, 'y')}${r(13, 3, 1, 1, 'y')}${r(12, 4, 1, 1, 'y')}${r(11, 5, 1, 1, 'p')}${r(10, 6, 1, 1, 'k')}</g>`
      + `<g class="a-term">${r(10, 10, 5, 4, 'k')}${r(11, 11, 1, 1, 'g')}${r(12, 12, 1, 1, 'g')}${r(11, 13, 1, 1, 'g')}${r(13, 13, 1, 1, 'g')}</g>`
      + `<g class="a-web">${r(12, 10, 2, 1, 'e')}${r(11, 11, 1, 2, 'e')}${r(14, 11, 1, 2, 'e')}${r(12, 13, 2, 1, 'e')}${r(12, 11, 2, 2, 'k')}${r(11, 11, 4, 1, 'e')}</g>`;
    return `<svg class="px" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges" aria-hidden="true">`
      + `<g class="px-body">${body}${cheeks}${faces}${mouths}</g>${acc}</svg>`;
  }
  const PIXEL = Object.fromEntries(Object.keys(SKIN).map(k => [k, pixelPet(k)]));
  // Pone a cada mascota el dibujo en pixeles de su aspecto (el data-skin mas cercano).
  function pixelize(root = document) {
    for (const pet of root.querySelectorAll('.pet')) {
      const skin = pet.closest('[data-skin]')?.dataset.skin || 'blob', slot = pet.querySelector('.pxslot');
      if (!slot || slot.dataset.skin === skin) continue;
      slot.innerHTML = PIXEL[skin] || '';
      slot.dataset.skin = skin;
    }
  }

  // Iconos dibujados a mano en una rejilla de 24, trazo 1.8, mismo estilo en toda la app.
  const svg = d => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {
    sliders: svg('<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>'),
    close: svg('<path d="M7 7l10 10M17 7 7 17"/>'),
    open: svg('<path d="M8 16 16 8M9.5 8H16v6.5"/>'),
    send: svg('<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>'),
    check: svg('<path d="m6.5 12.5 3.5 3.5 7.5-8"/>'),
    pet: svg('<path d="M4.5 15.5c0-4.4 3.4-8 7.5-8s7.5 3.6 7.5 8c0 2-1.6 3-3.4 3H7.9c-1.8 0-3.4-1-3.4-3Z"/><path d="M9.5 13v.5M14.5 13v.5"/>'),
    bell: svg('<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5l1.5-1.5ZM10 20.5h4"/>'),
    notch: svg('<path d="M3 5h18M7.5 5v1.5A3.5 3.5 0 0 0 11 10h2a3.5 3.5 0 0 0 3.5-3.5V5"/><rect x="3" y="5" width="18" height="14" rx="2.5"/>'),
    plug: svg('<path d="M9 4v4M15 4v4M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v4"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>'),
    folder: svg('<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9Z"/>'),
    play: svg('<path d="M8 6.5v11l9-5.5-9-5.5Z"/>'),
    image: svg('<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9.5" cy="10" r="1.5"/><path d="m5 17 4.5-4.5 3 3 2-2L19 17"/>'),
    reset: svg('<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.5V8h3.5"/>'),
  };


  // ---------- Idioma ----------
  // El diccionario llega del proceso principal ({ lang, strings }). Los textos fijos del HTML llevan
  // data-t (texto), data-t-html (texto con <code>, de nuestros propios ficheros), data-t-aria, data-t-title y data-t-placeholder.
  let L = { lang: 'en', strings: {} };
  const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const t = (k, v) => fill(L.strings[k] ?? k, v);
  const tn = (k, n, v) => fill(L.strings[`${k}_${new Intl.PluralRules(L.lang).select(n)}`] ?? L.strings[`${k}_other`] ?? k, { n, ...v });
  const ATTRS = [['t-aria', 'aria-label'], ['t-title', 'title'], ['t-placeholder', 'placeholder']];
  function translateDom(root = document) {
    for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
    for (const el of root.querySelectorAll('[data-t-html]')) el.innerHTML = t(el.dataset.tHtml);
    for (const [d, attr] of ATTRS) for (const el of root.querySelectorAll(`[data-${d}]`)) el.setAttribute(attr, t(el.getAttribute(`data-${d}`)));
  }
  function setLocale(l) {
    if (!l || typeof l.strings !== 'object') return;
    L = { lang: l.lang || 'en', strings: l.strings };
    document.documentElement.lang = L.lang;
    translateDom();
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fileUrl = p => 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/%3F/gi, '?');

  window.NP = { PET, ICON, esc, fileUrl, pixelize, t, tn, setLocale, translateDom };
})();
