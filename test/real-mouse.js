// Test con el raton DE VERDAD (Windows): la app de desarrollo tiene que estar abierta con --remote-debugging-port=9229.
// Pregunta al notch donde esta cada fila, mueve el cursor del sistema hasta ella, hace clic y comprueba que se abre.
//   node test/real-mouse.js [vueltas]
const { connect } = require('./cdp');
const { execFileSync } = require('child_process');

const PS = `
Add-Type 'using System.Runtime.InteropServices; public class RM { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p); [DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e); public struct P { public int X, Y; } }'
function glide($x, $y) { $p = New-Object RM+P; [RM]::GetCursorPos([ref]$p) | Out-Null; foreach ($k in 1..14) { [RM]::SetCursorPos([int]($p.X + ($x - $p.X) * $k / 14), [int]($p.Y + ($y - $p.Y) * $k / 14)) | Out-Null; Start-Sleep -Milliseconds 22 } }
`;
const ps = cmd => execFileSync('powershell.exe', ['-NoProfile', '-Command', PS + cmd], { windowsHide: true });
const moveTo = (x, y) => ps(`glide ${x} ${y}`);
const click = (x, y) => ps(`glide ${x} ${y}; Start-Sleep -Milliseconds 180; [RM]::mouse_event(2,0,0,0,0); Start-Sleep -Milliseconds 70; [RM]::mouse_event(4,0,0,0,0)`);
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const rounds = +process.argv[2] || 2;
  const c = await connect(9229);
  const errors = [];
  c.on(m => { if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ')); });
  await c.send('Runtime.enable');
  const where = () => c.evaluate(`(() => {
    const dpr = devicePixelRatio, ox = window.screenX, oy = window.screenY;
    return [...document.querySelectorAll('#list .row')].map(r => { const b = r.querySelector('.top').getBoundingClientRect();
      return { id: r.dataset.id, name: r.querySelector('.name')?.textContent, x: Math.round((ox + b.x + 40) * dpr), y: Math.round((oy + b.y + b.height / 2) * dpr), visible: b.bottom < document.getElementById('list').getBoundingClientRect().bottom - 4 }; });
  })()`);
  const state = () => c.evaluate('window.__notch()');

  // Abrir el notch como una persona: desde abajo hacia el borde superior
  const top = await c.evaluate(`({ x: Math.round((window.screenX + innerWidth / 2) * devicePixelRatio), y: Math.round((window.screenY + 14) * devicePixelRatio) })`);
  moveTo(top.x, top.y + 400); moveTo(top.x, top.y); await wait(600);
  if (!(await state()).open) throw new Error('El notch no se abrió al pasar el ratón');

  let ok = 0, bad = 0;
  for (let r = 0; r < rounds; r++) {
    const rows = (await where()).filter(x => x.visible);
    for (const row of rows) {
      const fresh = (await where()).find(x => x.id === row.id);
      if (!fresh?.visible) continue;
      const before = (await state()).openId;
      click(fresh.x, fresh.y);
      await wait(450);
      const st = await state();
      const expected = before === row.id ? null : row.id; // pulsar la que ya esta abierta la cierra
      const shown = st.rows.find(x => x.expanded)?.id || null;
      if (st.openId === expected && shown === expected) { ok++; console.log(`  ok   ${expected ? 'abre' : 'cierra'} «${row.name}»`); }
      else { bad++; console.log(`  MAL  «${row.name}»: esperaba ${expected}, openId ${st.openId}, se ve ${shown}, abierto ${st.open}`); }
    }
  }
  moveTo(top.x, top.y + 700);
  if (errors.length) { console.log('errores en la ventana:', errors); bad++; }
  console.log(bad ? `\n${bad} fallos de ${ok + bad}` : `\nraton real ok: ${ok} clics`);
  c.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
