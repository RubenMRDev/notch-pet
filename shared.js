// Piezas compartidas por el notch y los ajustes: la mascota, los iconos y el escapado de texto.
(() => {
  const PET = '<div class="pet" aria-hidden="true"><div class="body"><div class="eye l"></div><div class="eye r"></div>'
    + '<div class="mouth"></div><div class="cheek l"></div><div class="cheek r"></div></div>'
    + '<img class="custom" alt=""><div class="acc"></div><div class="fx"></div></div>';

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

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fileUrl = p => 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/%3F/gi, '?');

  window.NP = { PET, ICON, esc, fileUrl };
})();
