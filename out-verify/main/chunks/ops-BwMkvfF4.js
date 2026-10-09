"use strict";
const fs = require("fs");
const path = require("path");
const worker_threads = require("worker_threads");
const gradients = require("./gradients-D8SBBasL.js");
const recipe = require("./recipe-BOlCEsxK.js");
const zlib = require("zlib");
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 4294967295;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodeGreyPng(data, w, h, level = 6) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    raw.set(data.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
const COLOUR_CHUNKS = /* @__PURE__ */ new Set(["iCCP", "sRGB", "gAMA", "cHRM", "cICP"]);
function colourChunks(png) {
  const out = [];
  let off = 8;
  while (off + 12 <= png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    if (type === "IDAT" || type === "IEND") break;
    if (COLOUR_CHUNKS.has(type)) out.push(Buffer.from(png.subarray(off, off + 12 + len)));
    off += 12 + len;
  }
  return out;
}
function encodePng16(samples, w, h, channels, level = 1, colour = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 16;
  ihdr[9] = channels === 4 ? 6 : 2;
  const stride = w * channels * 2;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    let o = y * (stride + 1) + 1;
    const row = y * w * channels;
    for (let i = 0; i < w * channels; i++, o += 2) raw.writeUInt16BE(samples[row + i], o);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    ...colour,
    chunk("IDAT", zlib.deflateSync(raw, { level })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
const CICP_DISPLAY_P3 = chunk("cICP", Buffer.from([12, 13, 0, 1]));
function encodePng8(rgba, w, h, level = 1, colour = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++)
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    ...colour,
    chunk("IDAT", zlib.deflateSync(raw, { level })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
function grey8(png) {
  const s = pngSamples16(png);
  if (s.channels !== 1) throw new Error(`a grey plane was expected, got ${s.channels} channels`);
  const data = new Uint8Array(s.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(s.data[i] / 257);
  return { width: s.width, height: s.height, data };
}
function pngSamples16(png) {
  const d = decodePng(png);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[d.colorType];
  const n = d.width * d.height * channels;
  const data = new Uint16Array(n);
  if (d.bitDepth === 16) for (let i = 0; i < n; i++) data[i] = d.rows.readUInt16BE(i * 2);
  else for (let i = 0; i < n; i++) data[i] = d.rows[i] * 257;
  return { width: d.width, height: d.height, channels, data };
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function decodePng(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`PNG colour type ${colorType} not supported`);
  const bpp = channels * bitDepth / 8;
  const stride = width * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = inflated[y * (stride + 1)];
    const src = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      const x = src[i];
      out[i] = f === 0 ? x : f === 1 ? x + a & 255 : f === 2 ? x + b & 255 : f === 3 ? x + (a + b >> 1) & 255 : x + paeth(a, b, c) & 255;
    }
  }
  return { width, height, bitDepth, colorType, rows };
}
function pngToFloats(png) {
  const d = decodePng(png);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[d.colorType];
  const n = d.width * d.height * channels;
  const data = new Float32Array(n);
  if (d.bitDepth === 16) for (let i = 0; i < n; i++) data[i] = d.rows.readUInt16BE(i * 2) / 65535;
  else for (let i = 0; i < n; i++) data[i] = d.rows[i] / 255;
  return { width: d.width, height: d.height, channels, data };
}
const KEEP_GRADIENTS = 64;
const PLANE_DEFLATE = 1;
const PRUNE_EVERY = 32;
const PRUNE_MS = 1e4;
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}-${worker_threads.threadId}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function writeGradientPlane(file, c, user) {
  const w = Math.max(1, Math.round(c.width));
  const h = Math.max(1, Math.round(c.height));
  const turned = recipe.orientPlane(user, recipe.applyEdge(gradients.rasteriseGradient(c), w, h, c.edge), w, h);
  writeAtomic(file, encodeGreyPng(turned.data, turned.width, turned.height, PLANE_DEFLATE));
}
function writeBrushPlane(file, png, user, edge, object) {
  const buf = Buffer.from(png, "base64");
  if (user === "Normal" && !edge && !object) return writeAtomic(file, buf);
  const d = decodePng(buf);
  let plane = {
    data: new Uint8Array(d.rows),
    width: d.width,
    height: d.height
  };
  if (object) plane = cutToObject(plane, object);
  const shaped = recipe.applyEdge(plane.data, plane.width, plane.height, edge);
  const turned = recipe.orientPlane(user, shaped, plane.width, plane.height);
  writeAtomic(file, encodeGreyPng(turned.data, turned.width, turned.height, PLANE_DEFLATE));
}
function cutToObject(stroke, object) {
  const { width: W, height: H } = object;
  const { data: s, width: w, height: h } = stroke;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) * h / H - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const o = object.data[y * W + x];
      if (o === 0) continue;
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) * w / W - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const top = s[y0 * w + x0] * (1 - fx) + s[y0 * w + x1] * fx;
      const bottom = s[y1 * w + x0] * (1 - fx) + s[y1 * w + x1] * fx;
      out[y * W + x] = Math.round((top * (1 - fy) + bottom * fy) * o / 255);
    }
  }
  return { data: out, width: W, height: H };
}
const pruned = /* @__PURE__ */ new Map();
function pruneDue(state, now) {
  const s = state ?? { writes: 0, at: now };
  const writes = s.writes + 1;
  const due = writes >= PRUNE_EVERY || now - s.at >= PRUNE_MS;
  return { due, next: due ? { writes: 0, at: now } : { writes, at: s.at } };
}
function pruneGradientsSometimes(dir) {
  const { due, next } = pruneDue(pruned.get(dir), Date.now());
  pruned.set(dir, next);
  if (due) pruneGradients(dir);
}
function pruneGradients(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("grad-") && f.endsWith(".png")).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
    if (files.length <= KEEP_GRADIENTS) return;
    files.sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(KEEP_GRADIENTS)) fs.unlinkSync(path.join(dir, f));
  } catch {
  }
}
function writeWhole(file, data) {
  const tmp = `${file}.part-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function composeMasked(image, mask, out) {
  const imageBytes = fs.readFileSync(image);
  const img = decodePng(imageBytes);
  if (img.bitDepth !== 16 || img.colorType !== 2)
    throw new Error("the step image is not 16-bit RGB");
  const m = decodePng(fs.readFileSync(mask));
  if (m.width !== img.width || m.height !== img.height)
    throw new Error(`the mask is ${m.width}×${m.height}, the image ${img.width}×${img.height}`);
  const grey = m.bitDepth === 8 && m.colorType === 0;
  if (!grey) throw new Error("the mask is not an 8-bit grey plane");
  const n = img.width * img.height;
  const rgba = new Uint16Array(n * 4);
  const rows = img.rows;
  for (let i = 0; i < n; i++) {
    const s = i * 6;
    const d = i * 4;
    rgba[d] = rows[s] << 8 | rows[s + 1];
    rgba[d + 1] = rows[s + 2] << 8 | rows[s + 3];
    rgba[d + 2] = rows[s + 4] << 8 | rows[s + 5];
    rgba[d + 3] = m.rows[i] * 257;
  }
  writeWhole(out, encodePng16(rgba, img.width, img.height, 4, 1, colourChunks(imageBytes)));
}
function writeRamp(file, w, h) {
  const ramp = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      ramp[i] = Math.round(x / Math.max(1, w - 1) * 65535);
      ramp[i + 1] = Math.round(y / Math.max(1, h - 1) * 65535);
    }
  writeWhole(file, encodePng16(ramp, w, h, 3));
}
function rampFraction(v, n) {
  return (v * Math.max(1, n - 1) + 0.5) / n;
}
function unwarpMask(mask, map, w, h, out) {
  const m = decodePng(fs.readFileSync(mask));
  if (m.bitDepth !== 8 || m.colorType !== 0) throw new Error("the mask is not an 8-bit grey plane");
  const mp = pngSamples16(fs.readFileSync(map));
  const mw = mp.width;
  const mh = mp.height;
  const cw = m.width;
  const ch = m.height;
  const acc = new Float32Array(w * h);
  const wsum = new Float32Array(w * h);
  const sx = mw / cw;
  const sy = mh / ch;
  const at = (x, y, c) => mp.data[(y * mw + x) * 3 + c] / 65535;
  for (let cy = 0; cy < ch; cy++) {
    const my = Math.min(mh - 1, Math.max(0, (cy + 0.5) * sy - 0.5));
    const y0 = Math.floor(my);
    const y1 = Math.min(mh - 1, y0 + 1);
    const fy = my - y0;
    for (let cx = 0; cx < cw; cx++) {
      const mx = Math.min(mw - 1, Math.max(0, (cx + 0.5) * sx - 0.5));
      const x0 = Math.floor(mx);
      const x1 = Math.min(mw - 1, x0 + 1);
      const fx = mx - x0;
      const bil = (c) => (at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) + (at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx) * fy;
      const px = rampFraction(bil(0), mw) * w - 0.5;
      const py = rampFraction(bil(1), mh) * h - 0.5;
      const v = m.rows[cy * cw + cx] / 255;
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      const ax = px - ix;
      const ay = py - iy;
      for (const [dx, dy, k] of [
        [0, 0, (1 - ax) * (1 - ay)],
        [1, 0, ax * (1 - ay)],
        [0, 1, (1 - ax) * ay],
        [1, 1, ax * ay]
      ]) {
        const X = ix + dx;
        const Y = iy + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h || k <= 0) continue;
        acc[Y * w + X] += v * k;
        wsum[Y * w + X] += k;
      }
    }
  }
  const plane = new Uint8Array(w * h);
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (wsum[i] > 1e-4) {
      plane[i] = Math.round(Math.min(1, acc[i] / wsum[i]) * 255);
      known[i] = 1;
    }
  }
  for (let pass = 0; pass < 4; pass++) {
    let filled = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i]) continue;
        let s = 0;
        let n = 0;
        for (const j of [
          x > 0 ? i - 1 : -1,
          x < w - 1 ? i + 1 : -1,
          y > 0 ? i - w : -1,
          y < h - 1 ? i + w : -1
        ]) {
          if (j < 0 || known[j] !== 1) continue;
          s += plane[j];
          n++;
        }
        if (n > 0) {
          plane[i] = Math.round(s / n);
          known[i] = 2;
          filled++;
        }
      }
    for (let i = 0; i < w * h; i++) if (known[i] === 2) known[i] = 1;
    if (filled === 0) break;
  }
  writeWhole(out, encodeGreyPng(plane, w, h, 3));
}
function buildPatch(withStroke, without, out, mask) {
  const withBytes = fs.readFileSync(withStroke);
  const a = decodePng(withBytes);
  const b = decodePng(fs.readFileSync(without));
  if (a.width !== b.width || a.height !== b.height)
    throw new Error("the two renders differ in size");
  if (a.bitDepth !== 16 || a.colorType !== 2 || b.bitDepth !== 16 || b.colorType !== 2)
    throw new Error("the renders are not 16-bit RGB");
  const w = a.width;
  const h = a.height;
  const m = mask ? decodePng(fs.readFileSync(mask.path)) : null;
  if (m && (m.bitDepth !== 8 || m.colorType !== 0))
    throw new Error("the mask is not an 8-bit grey plane");
  const alpha = new Uint16Array(w * h);
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 6;
      let differs = false;
      for (let c = 0; c < 6; c++)
        if (a.rows[o + c] !== b.rows[o + c]) {
          differs = true;
          break;
        }
      if (!differs) continue;
      let v = 65535;
      if (m && mask) {
        const mx = mask.at.x + x;
        const my = mask.at.y + y;
        v = mx < m.width && my < m.height ? m.rows[my * m.width + mx] * 257 : 0;
        if (v === 0) continue;
      }
      alpha[i] = v;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  const pw = x1 - x0 + 1;
  const ph = y1 - y0 + 1;
  const rgba = new Uint16Array(pw * ph * 4);
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const i = (y0 + y) * w + (x0 + x);
      const o = i * 6;
      const d = (y * pw + x) * 4;
      rgba[d] = a.rows[o] << 8 | a.rows[o + 1];
      rgba[d + 1] = a.rows[o + 2] << 8 | a.rows[o + 3];
      rgba[d + 2] = a.rows[o + 4] << 8 | a.rows[o + 5];
      rgba[d + 3] = alpha[i];
    }
  writeWhole(out, encodePng16(rgba, pw, ph, 4, 6, colourChunks(withBytes)));
  return { x: x0, y: y0, w: pw, h: ph };
}
const GUARD_LOW = 0.95;
function headroomGuard(rgb, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const m = Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    const k = (1 - m) / (1 - GUARD_LOW);
    out[i] = Math.round(255 * Math.min(1, Math.max(0, k)));
  }
  return out;
}
function writeHeadroomGuard(rgb, w, h, out) {
  fs.writeFileSync(out, encodeGreyPng(headroomGuard(rgb, w, h), w, h, 1));
}
function guardOverlay(src, guard, out, at) {
  const bytes = fs.readFileSync(src);
  const img = decodePng(bytes);
  if (img.bitDepth !== 16 || img.colorType !== 2 && img.colorType !== 6)
    throw new Error("the step overlay is not 16-bit RGB or RGBA");
  const g = decodePng(fs.readFileSync(guard));
  if (g.bitDepth !== 8 || g.colorType !== 0) throw new Error("the guard is not an 8-bit grey plane");
  const ch = img.colorType === 6 ? 4 : 3;
  const n = img.width * img.height;
  const rgba = new Uint16Array(n * 4);
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = y * img.width + x;
      const s = i * ch * 2;
      const d = i * 4;
      for (let c = 0; c < 3; c++) rgba[d + c] = img.rows[s + c * 2] << 8 | img.rows[s + c * 2 + 1];
      const a = ch === 4 ? img.rows[s + 6] << 8 | img.rows[s + 7] : 65535;
      const gx = Math.min(g.width - 1, x + at.x);
      const gy = Math.min(g.height - 1, y + at.y);
      rgba[d + 3] = Math.round(a * g.rows[gy * g.width + gx] / 255);
    }
  writeWhole(out, encodePng16(rgba, img.width, img.height, 4, 1, colourChunks(bytes)));
}
exports.CICP_DISPLAY_P3 = CICP_DISPLAY_P3;
exports.buildPatch = buildPatch;
exports.composeMasked = composeMasked;
exports.encodeGreyPng = encodeGreyPng;
exports.encodePng8 = encodePng8;
exports.grey8 = grey8;
exports.guardOverlay = guardOverlay;
exports.headroomGuard = headroomGuard;
exports.pngSamples16 = pngSamples16;
exports.pngToFloats = pngToFloats;
exports.pruneGradientsSometimes = pruneGradientsSometimes;
exports.rampFraction = rampFraction;
exports.unwarpMask = unwarpMask;
exports.writeBrushPlane = writeBrushPlane;
exports.writeGradientPlane = writeGradientPlane;
exports.writeHeadroomGuard = writeHeadroomGuard;
exports.writeRamp = writeRamp;
