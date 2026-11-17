/**
 * Generates app icons (192/512) as PNGs without any dependency:
 * raw RGBA rasterizer + minimal PNG encoder (zlib via node:zlib).
 *
 *   node tools/gen-icons.mjs
 *
 * draw()/encodePNG() are exported for tools/make-ico.mjs.
 *
 * Design: the EK monogram from the provided brand image — dark rounded
 * square with a diagonal cyan→blue→violet gradient sweep, and the
 * letters E + K drawn as crisp geometric strokes (white, neon glow).
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'client', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

export function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Deterministic PRNG (mulberry32) — the glow dust must look the same on every machine. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw: dark rounded square + diagonal gradient + glowing "EK" monogram. */
export function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = size / 64; // scale from 64×64 reference
  const inR = (x, y, rx, ry, rw, rh, rad) => {
    if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false;
    const cx = Math.max(rx + rad, Math.min(x, rx + rw - rad));
    const cy = Math.max(ry + rad, Math.min(y, ry + rh - rad));
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= rad * rad;
  };

  // seeded glow dust, in 64×64 reference space
  const rnd = mulberry32(0x45_4B); // "EK"
  const dust = Array.from({ length: 120 }, () => ({
    x: rnd() * 64, y: rnd() * 64,
    r: 0.25 + rnd() * 1.1, a: 0.15 + rnd() * 0.55,
  }));

  // letter geometry (reference space 64×64)
  const seg = (x0, y0, x1, y1, w) => {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    return (fx, fy) => {
      let t = ((fx - x0) * dx + (fy - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = x0 + t * dx, cy = y0 + t * dy;
      const ddx = fx - cx, ddy = fy - cy;
      return ddx * ddx + ddy * ddy <= (w / 2) ** 2;
    };
  };
  const E_STROKE = 5.0;
  const E = [
    seg(12, 18, 12, 46, E_STROKE),   // spine
    seg(12, 18, 29, 18, E_STROKE),   // top
    seg(12, 32, 26, 32, E_STROKE),   // mid
    seg(12, 46, 29, 46, E_STROKE),   // bottom
  ];
  const K_STROKE = 5.0;
  const K = [
    seg(40, 18, 40, 46, K_STROKE),      // spine
    seg(40, 32, 55, 18, K_STROKE),      // upper arm
    seg(40, 32, 55, 46, K_STROKE),      // lower leg
  ];

  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fx = x / S, fy = y / S;

      // background rounded square
      const bg = inR(fx, fy, 0, 0, 64, 64, 12);
      if (!bg) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0; continue; }

      // diagonal gradient (top-left indigo → cyan → bottom-right violet), close to the brand image
      const t = Math.max(0, Math.min(1, (fx + fy) / 110));
      let r, g, b;
      if (t < 0.5) {
        const u = t / 0.5;
        r = Math.round(59 + (14 - 59) * u);
        g = Math.round(82 + (165 - 82) * u);
        b = Math.round(190 + (233 - 190) * u);
      } else {
        const u = (t - 0.5) / 0.5;
        r = Math.round(14 + (76 - 14) * u);
        g = Math.round(165 + (29 - 165) * u);
        b = Math.round(233 + (200 - 233) * u);
      }
      // subtle per-pixel noise so the gradient doesn't band
      const n = (hash(x, y) - 0.5) * 10;
      px[i] = Math.max(0, Math.min(255, r + n));
      px[i + 1] = Math.max(0, Math.min(255, g + n));
      px[i + 2] = Math.max(0, Math.min(255, b + n));
      px[i + 3] = 255;

      // glow dust specks
      for (const d of dust) {
        const dx = fx - d.x, dy = fy - d.y;
        const rr = d.r * d.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr) {
          const a = (1 - d2 / rr) * d.a;
          px[i] = Math.min(255, px[i] + (200 - px[i]) * a * 0.6);
          px[i + 1] = Math.min(255, px[i + 1] + (225 - px[i + 1]) * a * 0.6);
          px[i + 2] = Math.min(255, px[i + 2] + (255 - px[i + 2]) * a * 0.6);
        }
      }

      // letters: soft neon glow pass, then crisp white core
      let eHit = false, kHit = false;
      for (const s of E) if (s(fx, fy)) { eHit = true; break; }
      for (const s of K) if (s(fx, fy)) { kHit = true; break; }
      const hit = eHit || kHit;
      if (!hit) {
        // glow halo around strokes (distance-based approximation: sample neighbors)
        const halo = (s) => !s(fx, fy) && (s(fx + 2.2, fy) || s(fx - 2.2, fy) || s(fx, fy + 2.2) || s(fx, fy - 2.2));
        let glow = 0;
        for (const s of E) if (halo(s)) { glow = 1; break; }
        if (!glow) for (const s of K) if (halo(s)) { glow = 1; break; }
        if (glow) {
          px[i] = Math.min(255, px[i] * 0.45 + 120);
          px[i + 1] = Math.min(255, px[i + 1] * 0.45 + 190);
          px[i + 2] = Math.min(255, px[i + 2] * 0.45 + 255);
        }
      } else {
        // white core with a slight cyan tint at the very center of thick strokes
        px[i] = 235; px[i + 1] = 244; px[i + 2] = 255; px[i + 3] = 255;
      }
    }
  }
  return px;
}

main();
function main() {
  for (const size of [192, 512]) {
    const png = encodePNG(size, size, draw(size));
    fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
    console.log(`wrote icon-${size}.png (${png.length} bytes)`);
  }
}