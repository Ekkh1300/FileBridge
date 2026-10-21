/**
 * Builds build/FileBridge.ico from the shared rasterizer in gen-icons.mjs.
 * Windows ICO container with PNG-compressed entries (16…256 px). No deps.
 *   node tools/make-ico.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draw, encodePNG } from './gen-icons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(__dirname, '..', 'build', 'FileBridge.ico');
fs.mkdirSync(path.dirname(outFile), { recursive: true });

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const pngs = SIZES.map((s) => ({ size: s, blob: encodePNG(s, s, draw(s)) }));

// ICONDIR header: reserved(2)=0, type(2)=1(icon), count(2)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 1);
header.writeUInt16LE(pngs.length, 2);

// directory entries (16 bytes each), then image blobs
const dirSize = 6 + 16 * pngs.length;
const entries = [];
let offset = dirSize;
for (const { size, blob } of pngs) {
  const e = Buffer.alloc(16);
  e[0] = size === 256 ? 0 : size; // width (0 means 256)
  e[1] = size === 256 ? 0 : size; // height
  e[2] = 0;                       // colors in palette
  e[3] = 0;                       // reserved
  e.writeUInt16LE(1, 4);          // color planes
  e.writeUInt16LE(32, 6);         // bits per pixel
  e.writeUInt32LE(blob.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += blob.length;
  entries.push(e);
}

const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.blob)]);
fs.writeFileSync(outFile, ico);
console.log(`wrote ${outFile} (${ico.length} bytes, ${pngs.length} sizes: ${SIZES.join('/')})`);
