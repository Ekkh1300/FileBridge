/**
 * Adds an icon to a Windows executable by appending a new PE section that
 * holds the RT_ICON / RT_GROUP_ICON resources — together with the manifest and
 * version info that already lived in the original resource section, because
 * the resource data directory can only point at one place.
 *
 * Why not BeginUpdateResource? Because pkg appends its payload as an overlay
 * after the PE image, and the Win32 resource API rewrites the file without the
 * overlay — the resulting exe starts and dies at once with
 * "Pkg: Error reading from file.".
 *
 * Appending a section keeps every existing byte in place: headers grow by one
 * section entry (there is room before the first section) and the overlay just
 * moves down with the new data appended at the end.
 *
 *   node tools/add-icon-section.mjs <in.exe> <out.exe> <icon.ico>
 */
import fs from 'node:fs';

const FILE_ALIGNMENT = 512;
const SECTION_ALIGNMENT = 4096;

const IMAGE_SCN_CNT_INITIALIZED_DATA = 0x00000040;
const IMAGE_SCN_MEM_READ = 0x40000000;

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

const align = (n, a) => Math.ceil(n / a) * a;
const highBit = (n) => (0x80000000 + n) >>> 0;

/* --------------------------------- PE read -------------------------------- */

function parsePE(buf) {
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOff) !== 0x00004550) throw new Error('not a PE file');
  const coff = peOff + 4;
  const numSections = buf.readUInt16LE(coff + 2);
  const sizeOptional = buf.readUInt16LE(coff + 16);
  const opt = coff + 20;
  const magic = buf.readUInt16LE(opt);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error(`unsupported optional header magic 0x${magic.toString(16)}`);
  const dd = opt + (magic === 0x20b ? 112 : 96);
  return {
    peOff,
    numSections,
    sectionTable: opt + sizeOptional,
    sizeOfImage: buf.readUInt32LE(opt + 56),
    sizeOfHeaders: buf.readUInt32LE(opt + 60),
    sectionAlignment: buf.readUInt32LE(opt + 32),
    fileAlignment: buf.readUInt32LE(opt + 36),
    resources: { rva: buf.readUInt32LE(dd + 16), size: buf.readUInt32LE(dd + 20) },
    opt,
    dd,
  };
}

function sectionAt(pe, buf, rva) {
  for (let i = 0; i < pe.numSections; i++) {
    const o = pe.sectionTable + i * 40;
    const vaddr = buf.readUInt32LE(o + 12);
    const vsize = buf.readUInt32LE(o + 8);
    const rawsize = buf.readUInt32LE(o + 16);
    if (vaddr <= rva && rva < vaddr + Math.max(vsize, rawsize)) {
      return { header: o, vaddr, rawptr: buf.readUInt32LE(o + 20) };
    }
  }
  return null;
}

/* -------------------------------- .ico read ------------------------------- */

function readIco(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) throw new Error('not an .ico file');
  const count = b.readUInt16LE(4);
  const images = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const size = b.readUInt32LE(o + 8);
    const offset = b.readUInt32LE(o + 12);
    images.push({
      widthByte: b[o],
      heightByte: b[o + 1],
      colors: b[o + 2],
      reserved: b[o + 3],
      planes: b.readUInt16LE(o + 4),
      bpp: b.readUInt16LE(o + 6),
      data: b.subarray(offset, offset + size),
    });
  }
  return images;
}

/* ------------------------- existing resources read ------------------------ */

/** Flattens the resource tree of `buf` into leaves: { type, id, lang, data }. */
function readResources(buf, pe) {
  const sec = sectionAt(pe, buf, pe.resources.rva);
  if (!sec) return [];
  const base = sec.rawptr;
  const leaves = [];

  const dirName = (off) => {
    const len = buf.readUInt16LE(off);
    return buf.toString('utf16le', off + 2, off + 2 + len * 2);
  };

  const walk = (dirOff, path) => {
    const named = buf.readUInt16LE(dirOff + 12);
    const ids = buf.readUInt16LE(dirOff + 14);
    for (let i = 0; i < named + ids; i++) {
      const e = dirOff + 16 + i * 8;
      const nameField = buf.readUInt32LE(e);
      const offField = buf.readUInt32LE(e + 4);
      const key = nameField & 0x80000000 ? dirName(base + (nameField & 0x7fffffff)) : nameField;
      if (offField & 0x80000000) {
        walk(base + (offField & 0x7fffffff), [...path, key]);
      } else {
        const de = base + offField;
        const rva = buf.readUInt32LE(de);
        const size = buf.readUInt32LE(de + 4);
        const off = sec.rawptr + (rva - sec.vaddr);
        leaves.push({ type: path[0], id: path[1], lang: path[2], data: buf.subarray(off, off + size) });
      }
    }
  };

  walk(base, []);
  return leaves;
}

/* ---------------------------- resource section build ---------------------- */

/**
 * Serialises leaves (type/id/lang -> bytes) into a resource-only section.
 * `rva` is the address the section will be mapped at, so the data entries can
 * be filled in directly.
 */
function buildResourceSection(leaves, rva) {
  const byType = new Map();
  for (const leaf of leaves) {
    if (!byType.has(leaf.type)) byType.set(leaf.type, new Map());
    const items = byType.get(leaf.type);
    if (!items.has(leaf.id)) items.set(leaf.id, new Map());
    items.get(leaf.id).set(leaf.lang, leaf.data);
  }

  const types = [...byType.keys()].sort((a, b) => (typeof a === 'string' ? 1 : 0) - (typeof b === 'string' ? 1 : 0) || Number(a) - Number(b));
  const itemsOf = (t) =>
    [...byType.get(t).keys()].sort((a, b) => (typeof a === 'string' ? 1 : 0) - (typeof b === 'string' ? 1 : 0) || Number(a) - Number(b));

  let off = 16 + 8 * types.length; // root directory header + one entry per type
  const typeDirOff = new Map();
  for (const t of types) {
    typeDirOff.set(t, off);
    off += 16 + 8 * itemsOf(t).length;
  }
  const itemDirOff = new Map();
  for (const t of types) {
    for (const id of itemsOf(t)) {
      itemDirOff.set(`${t}/${id}`, off);
      off += 16 + 8 * byType.get(t).get(id).size;
    }
  }
  const dataEntryOff = new Map();
  for (const t of types) {
    for (const id of itemsOf(t)) {
      for (const lang of byType.get(t).get(id).keys()) {
        dataEntryOff.set(`${t}/${id}/${lang}`, off);
        off += 16;
      }
    }
  }
  const blobOff = new Map();
  for (const t of types) {
    for (const id of itemsOf(t)) {
      for (const [lang, data] of byType.get(t).get(id)) {
        blobOff.set(`${t}/${id}/${lang}`, off);
        off += align(data.length, 4);
      }
    }
  }

  const buf = Buffer.alloc(off);

  // root
  buf.writeUInt16LE(0, 0);
  buf.writeUInt32LE(0, 4);
  buf.writeUInt16LE(0, 8);
  buf.writeUInt16LE(0, 10);
  buf.writeUInt16LE(0, 12);
  buf.writeUInt16LE(types.length, 14);
  types.forEach((t, i) => {
    const e = 16 + i * 8;
    if (typeof t === 'string') throw new Error('named resource types are not supported');
    buf.writeUInt32LE(t, e);
    buf.writeUInt32LE(highBit(typeDirOff.get(t)), e + 4);
  });

  types.forEach((t) => {
    const items = itemsOf(t);
    const p = typeDirOff.get(t);
    buf.writeUInt16LE(0, p + 12);
    buf.writeUInt16LE(items.length, p + 14);
    items.forEach((id, i) => {
      const e = p + 16 + i * 8;
      if (typeof id === 'string') throw new Error('named resource items are not supported');
      buf.writeUInt32LE(id, e);
      buf.writeUInt32LE(highBit(itemDirOff.get(`${t}/${id}`)), e + 4);
    });
  });

  for (const t of types) {
    for (const id of itemsOf(t)) {
      const langs = [...byType.get(t).get(id).keys()];
      const p = itemDirOff.get(`${t}/${id}`);
      buf.writeUInt16LE(0, p + 12);
      buf.writeUInt16LE(langs.length, p + 14);
      langs.forEach((lang, i) => {
        const e = p + 16 + i * 8;
        buf.writeUInt32LE(lang, e);
        buf.writeUInt32LE(dataEntryOff.get(`${t}/${id}/${lang}`), e + 4);
      });
    }
  }

  for (const t of types) {
    for (const id of itemsOf(t)) {
      for (const [lang, data] of byType.get(t).get(id)) {
        const p = dataEntryOff.get(`${t}/${id}/${lang}`);
        const at = blobOff.get(`${t}/${id}/${lang}`);
        buf.writeUInt32LE(rva + at, p);
        buf.writeUInt32LE(data.length, p + 4);
        buf.writeUInt32LE(0, p + 8);
        buf.writeUInt32LE(0, p + 12);
        data.copy(buf, at);
      }
    }
  }

  return buf;
}

/* ---------------------------------- main ---------------------------------- */

function main() {
  const [inFile, outFile, icoFile] = process.argv.slice(2);
  if (!inFile || !outFile || !icoFile) {
    console.error('usage: node tools/add-icon-section.mjs <in.exe> <out.exe> <icon.ico>');
    process.exit(2);
  }

  const src = fs.readFileSync(inFile);
  const pe = parsePE(src);
  const images = readIco(icoFile);

  // keep everything the original .rsrc provides (manifest, version info) and
  // swap the icon images for ours.
  const kept = readResources(src, pe).filter((l) => l.type !== RT_ICON && l.type !== RT_GROUP_ICON);
  const leaves = [...kept];
  images.forEach((img, i) => leaves.push({ type: RT_ICON, id: 101 + i, lang: 1033, data: img.data }));

  const group = Buffer.alloc(6 + 14 * images.length);
  group.writeUInt16LE(0, 0);
  group.writeUInt16LE(1, 2);
  group.writeUInt16LE(images.length, 4);
  images.forEach((img, i) => {
    const q = 6 + i * 14;
    group.writeUInt8(img.widthByte, q);
    group.writeUInt8(img.heightByte, q + 1);
    group.writeUInt8(img.colors, q + 2);
    group.writeUInt8(img.reserved, q + 3);
    group.writeUInt16LE(img.planes, q + 4);
    group.writeUInt16LE(img.bpp, q + 6);
    group.writeUInt32LE(img.data.length, q + 8);
    group.writeUInt16LE(101 + i, q + 12);
  });
  leaves.push({ type: RT_GROUP_ICON, id: 1, lang: 1033, data: group });

  const fileAlignment = pe.fileAlignment || FILE_ALIGNMENT;
  const sectionAlignment = pe.sectionAlignment || SECTION_ALIGNMENT;
  const resAddr = align(pe.sizeOfImage, sectionAlignment);
  const resRaw = align(src.length, fileAlignment);

  const res = buildResourceSection(leaves, resAddr);
  const resRawSize = align(res.length, fileAlignment);
  const out = Buffer.alloc(resRaw + resRawSize);
  src.copy(out, 0);
  res.copy(out, resRaw);

  // one more section header, written into the slack before the first section
  const headerOff = pe.sectionTable + pe.numSections * 40;
  if (headerOff + 40 > pe.sizeOfHeaders) throw new Error('no room for another section header');
  out.fill(0, headerOff, headerOff + 40);
  out.write(process.env.FB_SECNAME || '.icons', headerOff, 'latin1');
  out.writeUInt32LE(res.length, headerOff + 8);
  out.writeUInt32LE(resAddr, headerOff + 12);
  out.writeUInt32LE(resRawSize, headerOff + 16);
  out.writeUInt32LE(resRaw, headerOff + 20);
  out.writeUInt32LE(0, headerOff + 24);
  out.writeUInt32LE(0, headerOff + 28);
  out.writeUInt16LE(0, headerOff + 32);
  out.writeUInt16LE(0, headerOff + 34);
  out.writeUInt32LE(IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ, headerOff + 36);

  out.writeUInt16LE(pe.numSections + 1, pe.peOff + 6);
  out.writeUInt32LE(align(resAddr + res.length, sectionAlignment), pe.opt + 56);
  if (!process.env.FB_KEEP_RSRC) {
    out.writeUInt32LE(resAddr, pe.dd + 16);
    out.writeUInt32LE(res.length, pe.dd + 20);
  }

  fs.writeFileSync(outFile, out);

  console.log(
    `icon section: ${images.length} icons + ${kept.length} kept leaves, ${(res.length / 1024).toFixed(1)} KB, ` +
      `RVA 0x${resAddr.toString(16)}, raw ${resRaw}`,
  );
  console.log(`exe: ${(src.length / 1024 / 1024).toFixed(2)} -> ${(out.length / 1024 / 1024).toFixed(2)} MB`);
}

main();
