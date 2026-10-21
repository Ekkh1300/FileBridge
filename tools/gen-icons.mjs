/**
 * Generates app icons (192/512) as PNGs without any dependency:
 * raw RGBA rasterizer + minimal PNG encoder (zlib via node:zlib).
 *   node tools/gen-icons.mjs
 * draw()/encodePNG() are exported for tools/make-ico.mjs.
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
  // filter 0 rows
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Draw: dark rounded square + cyan→lavender gradient bridge mark (two devices + link). */
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
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fx = x / S, fy = y / S;
      // background rounded square
      const bg = inR(fx, fy, 0, 0, 64, 64, 15);
      if (!bg) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0; continue; }
      px[i] = 0x0a; px[i + 1] = 0x0c; px[i + 2] = 0x11; px[i + 3] = 255;
      const t = (fx + fy) / 128;
      const r = Math.round(44 + (142 - 44) * t);
      const g = Math.round(201 + (151 - 201) * t);
      const b = Math.round(229 + (255 - 229) * t);
      // left device outline 9,20 12x24 r3.5 stroke 3
      const near = (x0, y0, w0, h0, s) => {
        const outer = inR(fx, fy, x0 - s, y0 - s, w0 + 2 * s, h0 + 2 * s, 3.5 + s);
        const inner = inR(fx, fy, x0, y0, w0, h0, 3.5);
        return outer && !inner;
      };
      const stroke3 = (x0, y0, x1, y1, w) => {
        // rounded-cap segment
        const dx = x1 - x0, dy = y1 - y0;
        const len2 = dx * dx + dy * dy || 1;
        let tt = ((fx - x0) * dx + (fy - y0) * dy) / len2;
        tt = Math.max(0, Math.min(1, tt));
        const cx = x0 + tt * dx, cy = y0 + tt * dy;
        const ddx = fx - cx, ddy = fy - cy;
        return ddx * ddx + ddy * ddy <= (w / 2 + 0.35) ** 2;
      };
      const mark =
        near(9, 20, 12, 24, 1.5) ||
        near(43, 20, 12, 24, 1.5) ||
        stroke3(26, 27, 38, 27, 3.5) ||
        stroke3(26, 37, 38, 37, 3.5);
      const white = stroke3(30, 32, 34, 32, 3.5);
      if (white) { px[i] = 233; px[i + 1] = 237; px[i + 2] = 245; px[i + 3] = 255; continue; }
      if (mark) { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; }
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
