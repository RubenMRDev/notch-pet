// Sustituye al puente de Electron para la escena de demostracion: notch.js cree que habla con la app de verdad.
window.api = {
  handlers: {},
  on(ch, cb) { (this.handlers[ch] ||= []).push(cb); },
  emit(ch, ...a) { for (const cb of this.handlers[ch] || []) cb(...a); },
  send() {},
  invoke: async () => ({ ok: true }),
};
