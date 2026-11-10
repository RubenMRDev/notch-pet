// Puente falso para capturar la ventana de ajustes con datos de ejemplo (sin tocar la config real).
const { contextBridge } = require('electron');

const config = {
  colors: { pet: '#f0916b', bg: '#0a0a0c', work: '#6aa8ff', wait: '#ffb340', done: '#5fd38d' },
  skin: 'blob', customImage: '', sound: true, notify: true, dnd: false, display: 'primary', hideFullscreen: true, visible: true,
  style: new URLSearchParams(location.search).get('style') === 'pixel' ? 'pixel' : 'smooth',
  shortcut: 'CommandOrControl+Alt+N', openWith: 'claude', maxSessions: 3, finishAlert: 'multi', shortcutOk: true, autostart: true,
};
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
const DATA = {
  'config:get': config,
  'displays': [{ id: '1', label: 'Pantalla 1 · 2560×1440 (principal)' }],
  'app:info': { version: '1.0.0', electron: '33.4.11', data: 'C:\\Users\\tu-usuario\\AppData\\Roaming\\Notch Pet' },
  'hooks:status': { file: 'C:\\Users\\tu-usuario\\.claude\\settings.json', events: EVENTS, installed: EVENTS, outdated: false },
};
contextBridge.exposeInMainWorld('api', {
  send() {}, on() {},
  invoke: async ch => DATA[ch] ?? config,
});
