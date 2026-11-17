/**
 * Generates the FileBridge app icons from the brand artwork.
 *
 *   design/logo-source.png                  <- the delivered artwork (black surround)
 *   client/public/icons/icon-192.png
 *   client/public/icons/icon-512.png
 *   client/public/favicon.svg               <- the 64px artwork as a data URI
 *
 * Pure Node, no dependencies: a small PNG decoder (zlib inflate + unfilter),
 * a premultiplied area-average resampler and a PNG encoder.
 *
 *   node tools/gen-icons.mjs
 *
 * Exports draw(size) / encodePNG(w, h, rgba) so make-ico.mjs can reuse them.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'design', 'logo-source.png');

const BLACK = 12; // sum-of-RGB below this counts as the black surround
const RADIUS = 0.19; // corner radius as a fraction of the artwork's side

/* ------------------------------- PNG decode ------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Decode a non-interlaced 8-bit PNG (colour types 0/2/4/6) into RGBA. */
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let width = 0, height = 0, depth = 0, color = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error(`unsupported colour type ${color}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * width * 4, (y + 1) * width * 4);
    const prev = y > 0 ? px.subarray((y - 1) * width * 4, y * width * 4) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }

  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels, d = i * 4;
    if (color === 6) {
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3];
    } else if (color === 2) {
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255;
    } else if (color === 0) {
      out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = 255;
    } else {
      out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = px[s + 1];
    }
  }
  return { width, height, data: out };
}

/* ------------------------------ source square ----------------------------- */

let cached = null;

/** The artwork, cropped to its visible bounds. */
function source() {
  if (cached) return cached;

  const img = decodePNG(fs.readFileSync(SRC));
  const { width, height, data } = img;
  const lum = (x, y) => {
    const i = (y * width + x) * 4;
    return data[i] + data[i + 1] + data[i + 2];
  };

  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (lum(x, y) > BLACK) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error('artwork is entirely black');

  // Crop to a centred square so the icon is never stretched.
  const side = Math.min(right - left + 1, bottom - top + 1);
  const x0 = Math.round((left + right + 1 - side) / 2);
  const y0 = Math.round((top + bottom + 1 - side) / 2);

  const square = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    const s = ((y0 + y) * width + x0) * 4;
    data.copy(square, y * side * 4, s, s + side * 4);
  }

  cached = { width: side, height: side, data: square };
  console.log(
    `source ${width}x${height} -> artwork ${right - left + 1}x${bottom - top + 1}` +
      ` at ${left},${top}, cropped to ${side}x${side} at ${x0},${y0}`,
  );
  return cached;
}

/* ------------------------------- resampling ------------------------------- */

/**
 * Area-average resample straight to the target size.
 *
 * The source is fully opaque, so a plain box filter is exact; the rounded
 * corners come from a coverage mask applied at the *target* resolution,
 * which keeps the edges smooth at every size (including 16px).
 */
export function draw(size) {
  const { width: sw, height: sh, data: src } = source();

  const out = Buffer.alloc(size * size * 4);
  const scaleX = sw / size;
  const scaleY = sh / size;

  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((x + 1) * scaleX)));

      let r = 0, g = 0, b = 0, n = 0;
      for (let py = y0; py < y1; py++) {
        let i = (py * sw + x0) * 4;
        for (let px = x0; px < x1; px++, i += 4) {
          r += src[i]; g += src[i + 1]; b += src[i + 2];
          n++;
        }
      }
      const d = (y * size + x) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      out[d + 3] = 255;
    }
  }

  // Rounded corners: 4x4 supersampled coverage, so the alpha ramps smoothly.
  const radius = size * RADIUS;
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(radius - (x + 0.5), 0, (x + 0.5) - (size - radius));
      const dy = Math.max(radius - (y + 0.5), 0, (y + 0.5) - (size - radius));
      if (dx === 0 && dy === 0) continue; // interior: fully opaque
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const fx = x + (sx + 0.5) / S;
          const fy = y + (sy + 0.5) / S;
          const ddx = Math.max(radius - fx, 0, fx - (size - radius));
          const ddy = Math.max(radius - fy, 0, fy - (size - radius));
          if (ddx * ddx + ddy * ddy <= radius * radius) hits++;
        }
      }
      out[(y * size + x) * 4 + 3] = Math.round(255 * (hits / (S * S)));
    }
  }

  return out;
}

/* -------------------------------- encoder --------------------------------- */

export function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/* ---------------------------------- main ---------------------------------- */

function main() {
  const argOut = process.argv.indexOf('--out');
  const outDir = argOut > -1 ? process.argv[argOut + 1] : path.join(ROOT, 'client', 'public', 'icons');
  fs.mkdirSync(outDir, { recursive: true });

  for (const size of [192, 512]) {
    const png = encodePNG(size, size, draw(size));
    fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
    console.log(`wrote icon-${size}.png (${png.length} bytes)`);
  }

  // favicon.svg: a vector wrapper around the 64px artwork, so every existing
  // <link rel="icon" href="/favicon.svg"> keeps working unchanged.
  const fav = encodePNG(64, 64, draw(64));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">` +
    `<image width="64" height="64" href="data:image/png;base64,${fav.toString('base64')}"/></svg>\n`;
  fs.writeFileSync(path.join(ROOT, 'client', 'public', 'favicon.svg'), svg);
  console.log(`wrote favicon.svg (${svg.length} bytes)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
}