// Avisa cuando la ventana de delante ocupa todo su monitor (juegos, videos, presentaciones).
// ponytail: un PowerShell vivo que mira cada segundo; un modulo nativo si hiciera falta mas precision.
const { spawn } = require('child_process');

const PS = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public class FS {
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rr, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public R m; public R w; public int f; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, int f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MI i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static int Check() {
    IntPtr h = GetForegroundWindow(); if (h == IntPtr.Zero) return 0;
    var sb = new StringBuilder(64); GetClassName(h, sb, 64); var c = sb.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return 0;
    R r; GetWindowRect(h, out r); var mi = new MI(); mi.cb = Marshal.SizeOf(mi);
    GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);
    return (r.L <= mi.m.L && r.T <= mi.m.T && r.Rr >= mi.m.Rr && r.B >= mi.m.B) ? 1 : 0;
  }
}
'@
$last = -1
while ($true) { $v = [FS]::Check(); if ($v -ne $last) { [Console]::Out.WriteLine($v); $last = $v }; Start-Sleep -Milliseconds 1000 }
`;

function watchFullscreen(onChange) {
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS, 'utf16le').toString('base64')],
    { windowsHide: true });
  p.stdout.on('data', d => { const v = d.toString().trim().split(/\s+/).pop(); if (v) onChange(v === '1'); });
  p.on('error', () => {});
  return () => p.kill();
}

module.exports = { watchFullscreen };
