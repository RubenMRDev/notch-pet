// Dibuja la cara de la mascota en PNG (bandeja del sistema y icono del .exe) sin librerias.
const zlib = require('zlib');

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

// Color de un punto (u, v) del icono, en [0,1]: cuerpo con luz arriba a la izquierda, ojos y brillo de los ojos.
function shade(u, v, [r, g, b]) {
  const inside = (cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
  if (inside(.38, .47, .028, .036) || inside(.66, .47, .028, .036)) return [255, 255, 255, 255];
  if (inside(.36, .52, .06, .095) || inside(.64, .52, .06, .095)) return [27, 18, 20, 255];
  if (!inside(.5, .57, .47, .4)) return [0, 0, 0, 0];
  const light = Math.max(0, 1 - Math.hypot(u - .34, v - .36) / .42) * .32;   // brillo
  const dark = Math.max(0, (v - .62) / .35) * .2;                            // sombra abajo
  const mix = c => Math.round(Math.min(255, c + (255 - c) * light - c * dark));
  return [mix(r), mix(g), mix(b), 255];
}

// ponytail: suavizado por supermuestreo 4x4; de sobra para iconos de 16 a 256 px.
function petPng(size, hex = '#f0916b') {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const S = 4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtro "none"
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const p = shade((x + (sx + .5) / S) / size, (y + (sy + .5) / S) / size, rgb);
        acc[0] += p[0] * p[3]; acc[1] += p[1] * p[3]; acc[2] += p[2] * p[3]; acc[3] += p[3];
      }
      const a = acc[3] / (S * S);
      const px = a ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3], a].map(Math.round) : [0, 0, 0, 0];
      raw.set(px, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { petPng };

if (require.main === module) {
  const fs = require('fs');
  const png = petPng(256);
  require('assert').strictEqual(png.subarray(1, 4).toString(), 'PNG');
  fs.mkdirSync(__dirname + '/build', { recursive: true });
  fs.writeFileSync(__dirname + '/build/icon.png', png);
  console.log('build/icon.png ok');
}
