// Observa el notch en marcha: errores dentro de la ventana y su estado interno, cada pocos segundos.
//   node test/watch.js <segundos>
const { connect } = require('./cdp');
(async () => {
  const secs = +process.argv[2] || 60;
  const c = await connect(9229);
  c.on(m => {
    if (m.method === 'Runtime.exceptionThrown') console.log('EXCEPCION:', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.log('console.error:', m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  await c.send('Runtime.enable');
  const end = Date.now() + secs * 1000;
  let lastSeen = '';
  while (Date.now() < end) {
    const st = await c.evaluate('JSON.stringify(window.__notch())');
    if (st !== lastSeen) { console.log(new Date().toISOString().slice(11, 19), st.slice(0, 300)); lastSeen = st; }
    await new Promise(r => setTimeout(r, 2000));
  }
  c.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
