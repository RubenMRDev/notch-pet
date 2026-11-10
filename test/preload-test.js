// Puente falso para los tests de interfaz: el notch cree que habla con la app, y el test controla lo que recibe.
const { contextBridge } = require('electron');

const handlers = {}, calls = [];
const replies = { send: { ok: true }, 'permission:decide': { ok: true }, 'send:cancel': { ok: true } };
contextBridge.exposeInMainWorld('api', {
  on: (ch, cb) => { (handlers[ch] ||= []).push(cb); },
  send: (ch, ...a) => { calls.push([ch, ...a]); },
  invoke: (ch, ...a) => { calls.push([ch, ...a]); return Promise.resolve(replies[ch] ?? {}); },
});
contextBridge.exposeInMainWorld('__test', {
  // Igual que en la app: cada canal llama a sus manejadores; si uno falla, el error se guarda y los demas siguen.
  emit: (ch, data) => { for (const cb of handlers[ch] || []) cb(data); },
  calls: () => JSON.parse(JSON.stringify(calls)),
  clear: () => { calls.length = 0; },
});
