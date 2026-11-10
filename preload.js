// Puente entre las ventanas y el proceso principal. Las ventanas no tienen Node:
// solo pueden usar estos canales, y nada mas.
const { contextBridge, ipcRenderer } = require('electron');

const SEND = ['openH', 'peekH', 'quit', 'open-settings', 'open-session', 'typing', 'test-mood', 'test-alert', 'open-logs', 'update:install'];
const INVOKE = ['config:get', 'config:set', 'config:reset', 'displays', 'pick-image', 'hooks:status', 'hooks:install',
  'hooks:uninstall', 'send', 'send:cancel', 'app:info', 'update:status', 'update:check', 'update:download', 'permission:decide'];
const ON = ['state', 'config', 'open', 'chime', 'finished', 'peek-end', 'update', 'asked'];

contextBridge.exposeInMainWorld('api', {
  send: (ch, ...a) => { if (SEND.includes(ch)) ipcRenderer.send(ch, ...a); },
  invoke: (ch, ...a) => (INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error(`Canal no permitido: ${ch}`))),
  on: (ch, cb) => { if (ON.includes(ch)) ipcRenderer.on(ch, (_e, ...a) => cb(...a)); },
});
