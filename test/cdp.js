// Cliente minimo del protocolo de depuracion de Chromium (sin dependencias: Node 22+ trae WebSocket).
async function connect(port, match = 'index.html') {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const t = targets.find(x => x.type === 'page' && x.url.includes(match));
  if (!t) throw new Error(`No encuentro la ventana ${match}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map(), listeners = [];
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    else for (const l of listeners) l(msg);
  };
  const send = (method, params = {}) => new Promise(res => { const n = ++id; waiting.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  // Raton de verdad para Chromium (eventos de entrada, no clics sinteticos de JS)
  const mouse = async (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  const click = async (x, y) => { await mouse('mouseMoved', x, y); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); };
  const type = async text => send('Input.insertText', { text });
  return { send, evaluate, click, type, on: f => listeners.push(f), close: () => ws.close() };
}
module.exports = { connect };
