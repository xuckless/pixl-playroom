"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const promises = require("fs/promises");
const module$1 = require("module");
const path = require("path");
const recipe = require("./recipe-CiIOoIr9.js");
const concepts = require("./concepts-BqKJKtxp.js");
const gradients = require("./gradients-BJM4U-Ix.js");
const crypto = require("crypto");
const fs = require("fs");
const promises$1 = require("timers/promises");
const node_sqlite = require("node:sqlite");
const source = require("./source-CdsxFjqD.js");
let shared;
let explicitPath;
function setExiftoolPath(path2) {
  explicitPath = path2;
}
function vendoredExiftoolPath() {
  if (typeof __filename !== "string") return void 0;
  try {
    const here = module$1.createRequire(__filename);
    const req = module$1.createRequire(here.resolve("exiftool-vendored"));
    const pkg = process.platform === "win32" ? "exiftool-vendored.exe" : "exiftool-vendored.pl";
    const path$1 = req(pkg);
    return path$1.split(path.sep).map((p) => p === "app.asar" ? "app.asar.unpacked" : p).join(path.sep);
  } catch {
    return void 0;
  }
}
let starting;
function exiftool() {
  if (shared) return Promise.resolve(shared);
  starting ??= import("exiftool-vendored").then(({ ExifTool: Tool }) => {
    const path2 = explicitPath ?? vendoredExiftoolPath();
    shared = new Tool({
      maxProcs: 2,
      // A slow network drive should not look like a hung perl.
      taskTimeoutMillis: 3e4,
      ...path2 ? { exiftoolPath: path2 } : {}
    });
    return shared;
  });
  return starting;
}
async function endExiftool() {
  const et = shared ?? await starting?.catch(() => void 0);
  shared = void 0;
  starting = void 0;
  await et?.end();
}
const EXIF_HEADER = Buffer.from("Exif\0\0", "latin1");
const TIFF_II = Buffer.from("II*\0", "latin1");
const TIFF_MM = Buffer.from("MM\0*", "latin1");
function repairJpegExif(jpeg) {
  const same2 = { data: jpeg, changed: false, dropped: false };
  if (jpeg.length < 4 || jpeg[0] !== 255 || jpeg[1] !== 216) return same2;
  const parts = [jpeg.subarray(0, 2)];
  let changed = false;
  let dropped = false;
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 255) {
    const marker = jpeg[i + 1];
    if (marker === 218) break;
    const len = jpeg.readUInt16BE(i + 2);
    const end = i + 2 + len;
    if (len < 2 || end > jpeg.length) return same2;
    const body = jpeg.subarray(i + 4, end);
    if (marker === 225 && body.subarray(0, 6).equals(EXIF_HEADER)) {
      let tiff = body.subarray(6);
      while (tiff.subarray(0, 6).equals(EXIF_HEADER)) tiff = tiff.subarray(6);
      const head = tiff.subarray(0, 4);
      if (!head.equals(TIFF_II) && !head.equals(TIFF_MM)) {
        changed = dropped = true;
      } else if (tiff.length !== body.length - 6) {
        const seg = Buffer.alloc(4);
        seg[0] = 255;
        seg[1] = 225;
        seg.writeUInt16BE(2 + 6 + tiff.length, 2);
        parts.push(seg, EXIF_HEADER, tiff);
        changed = true;
      } else parts.push(jpeg.subarray(i, end));
    } else parts.push(jpeg.subarray(i, end));
    i = end;
  }
  if (!changed) return same2;
  parts.push(jpeg.subarray(i));
  return { data: Buffer.concat(parts), changed, dropped };
}
const isJpeg = (file) => /\.jpe?g$/i.test(file);
async function embedMetadata(file, tags, opts) {
  if (isJpeg(file)) {
    const fixed = repairJpegExif(await promises.readFile(file));
    if (fixed.changed) {
      const tmp = `${file}.exif-${process.pid}`;
      await promises.writeFile(tmp, fixed.data);
      await promises.rename(tmp, file);
    }
    if (fixed.dropped && opts.source) {
      await (await exiftool()).write(
        file,
        {},
        {
          writeArgs: [
            "-overwrite_original",
            "-m",
            "-TagsFromFile",
            opts.source,
            "-exif:all",
            "--Orientation",
            "--ThumbnailImage",
            "--PreviewImage",
            "--ExifImageWidth",
            "--ExifImageHeight"
          ]
        }
      );
    }
  }
  const args = ["-overwrite_original"];
  if (opts.removeLocation) args.push("-gps:all=", "-xmp-exif:gps*=");
  if (Object.keys(tags).length === 0 && !opts.removeLocation) return;
  await (await exiftool()).write(file, tags, { writeArgs: ["-m", ...args] });
}
function dhashFromGrey(data, width = 9, height = 8) {
  if (data.length < width * height) throw new Error("dhash: too few pixels");
  let hex = "";
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x;
      nibble = nibble << 1 | (data[i] > data[i + 1] ? 1 : 0);
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  if (bits > 0) hex += (nibble << 4 - bits).toString(16);
  return hex;
}
function popcount32(v) {
  v = v - (v >>> 1 & 1431655765);
  v = (v & 858993459) + (v >>> 2 & 858993459);
  return (v + (v >>> 4) & 252645135) * 16843009 >>> 24;
}
const halves = (h) => [
  parseInt(h.slice(0, 8), 16) >>> 0,
  parseInt(h.slice(8, 16), 16) >>> 0
];
function hamming(a, b) {
  const [a0, a1] = halves(a);
  const [b0, b1] = halves(b);
  return popcount32((a0 ^ b0) >>> 0) + popcount32((a1 ^ b1) >>> 0);
}
function groupNear(entries, threshold) {
  const n = entries.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (i, j) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  const firstOf = /* @__PURE__ */ new Map();
  const reps = [];
  for (let i = 0; i < n; i++) {
    const hash = entries[i].hash.toLowerCase();
    const seen = firstOf.get(hash);
    if (seen === void 0) {
      firstOf.set(hash, i);
      reps.push(i);
    } else join(seen, i);
  }
  if (threshold > 0) {
    const h = entries.map((e) => halves(e.hash));
    const bits = entries.map((e) => BigInt(`0x${e.hash.padEnd(16, "0").slice(0, 16)}`));
    const blocks = Math.min(64, threshold + 1);
    for (let b = 0; b < blocks; b++) {
      const from = Math.round(b * 64 / blocks);
      const to = Math.round((b + 1) * 64 / blocks);
      const mask = (1n << BigInt(to - from)) - 1n;
      const shift = BigInt(64 - to);
      const buckets = /* @__PURE__ */ new Map();
      for (const i of reps) {
        const v = bits[i] >> shift & mask;
        const list = buckets.get(v);
        if (list) list.push(i);
        else buckets.set(v, [i]);
      }
      for (const list of buckets.values()) {
        for (let x = 0; x < list.length; x++) {
          const i = list[x];
          const [i0, i1] = h[i];
          for (let y = x + 1; y < list.length; y++) {
            const j = list[y];
            if (find(i) === find(j)) continue;
            const d = popcount32((i0 ^ h[j][0]) >>> 0) + popcount32((i1 ^ h[j][1]) >>> 0);
            if (d <= threshold) join(i, j);
          }
        }
      }
    }
  }
  const byRoot = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = byRoot.get(r);
    if (list) list.push(i);
    else byRoot.set(r, [i]);
  }
  const out = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const distinct = [...new Set(members.map((i) => entries[i].hash.toLowerCase()))];
    let distance = 0;
    for (let a = 0; a < distinct.length; a++) {
      for (let b = a + 1; b < distinct.length; b++) {
        distance = Math.max(distance, hamming(distinct[a], distinct[b]));
      }
    }
    out.push({ keys: members.map((i) => entries[i].key), distance });
  }
  return out;
}
const NAME_PROMPT = [
  "List everything in this photo worth masking for an editor, one target per entry (up to 8), the most important first.",
  `Mark the photo's main subject with "subject": true, whatever it is (a person, a group, a building, a boat, an animal); exactly one target is the subject.`,
  "For each target choose a finder: a named plane (sky, vegetation, water, hair, face_skin, body_skin, clothes, subject); face_part with the part name as the prompt; text with a short noun phrase as the prompt; or box with [x, y, width, height] as fractions of the photo.",
  'Give a prompt only for text and face_part (null otherwise) and a box only when you can place it (null otherwise). "intent" says in a few words why an editor would mask it.',
  '"describe" is one sentence on what the photo shows. "edits" stays empty: nothing is edited here.',
  "Answer with the JSON only."
].join("\n");
const NAME_MAX_TOKENS = 3e3;
function namingSystem(system, workersText) {
  return `${system.split("\n")[0]}

${workersText.split("\nWorkers")[0]}`;
}
const MAX_THINGS = 12;
const MAX_LABEL = 40;
const FINDER_WORDS = /* @__PURE__ */ new Set([
  "subject",
  "main subject",
  "face skin",
  "body skin",
  "face part",
  "text",
  "box",
  "global",
  "background"
]);
function cleanLabel(label) {
  const s = label.toLowerCase().replace(/[_]+/g, " ").replace(/[^\p{L}\p{N}' &/-]+/gu, " ").replace(/\s+/g, " ").trim().replace(/^(the|a|an) /, "").slice(0, MAX_LABEL).trim();
  if (!s || FINDER_WORDS.has(s)) return null;
  return s;
}
function namesFromPlan(plan, problems, by, at) {
  const flagged = /* @__PURE__ */ new Set();
  for (const p of problems) {
    const m = /^\/targets\/(\d+)/.exec(p.path);
    if (m) flagged.add(Number(m[1]));
  }
  const things = [];
  const seen = /* @__PURE__ */ new Set();
  const targets = Array.isArray(plan.targets) ? plan.targets : [];
  targets.forEach((t, i) => {
    if (flagged.has(i) || !t || typeof t.label !== "string") return;
    const label = cleanLabel(t.label);
    if (!label || seen.has(label)) return;
    seen.add(label);
    things.push({
      label,
      intent: typeof t.intent === "string" ? t.intent.trim().slice(0, 160) : "",
      subject: t.subject === true
    });
  });
  let starred = false;
  for (const t of things) {
    if (t.subject && starred) t.subject = false;
    if (t.subject) starred = true;
  }
  return {
    v: 1,
    by,
    at,
    describe: typeof plan.describe === "string" ? plan.describe.trim().slice(0, 300) : "",
    things: things.slice(0, MAX_THINGS)
  };
}
function readNames(v) {
  let o = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const r = o;
  if (r.v !== 1 || !Array.isArray(r.things)) return null;
  const things = [];
  for (const t of r.things) {
    const label = t && typeof t.label === "string" ? cleanLabel(t.label) : null;
    if (!label || things.some((x) => x.label === label)) continue;
    things.push({
      label,
      intent: typeof t.intent === "string" ? t.intent.slice(0, 160) : "",
      subject: t.subject === true,
      ...t.user === true ? { user: true } : {}
    });
  }
  return {
    v: 1,
    by: typeof r.by === "string" ? r.by : "",
    at: typeof r.at === "string" ? r.at : "",
    describe: typeof r.describe === "string" ? r.describe.slice(0, 300) : "",
    things: things.slice(0, MAX_THINGS),
    ...r.edited === true ? { edited: true } : {}
  };
}
const words = (s) => s.split(/[\s/&,-]+/).filter(Boolean);
const any = (label, set) => set.has(label) || words(label).some((w) => set.has(w));
const SKY = /* @__PURE__ */ new Set(["sky", "skies", "clouds", "cloud", "sunset sky", "overcast"]);
const VEGETATION = /* @__PURE__ */ new Set([
  "vegetation",
  "tree",
  "trees",
  "grass",
  "plants",
  "plant",
  "foliage",
  "forest",
  "bushes",
  "bush",
  "shrubs",
  "leaves",
  "greenery",
  "hedge",
  "lawn",
  "treeline"
]);
const WATER = /* @__PURE__ */ new Set([
  "water",
  "lake",
  "sea",
  "ocean",
  "river",
  "creek",
  "pond",
  "waves",
  "stream",
  "waterfall",
  "bay",
  "harbour",
  "harbor"
]);
const PERSON = /* @__PURE__ */ new Set([
  "person",
  "man",
  "woman",
  "boy",
  "girl",
  "child",
  "kid",
  "baby",
  "people",
  "men",
  "women",
  "guy",
  "lady",
  "bride",
  "groom"
]);
const WHICH = /* @__PURE__ */ new Set([
  "left",
  "right",
  "middle",
  "center",
  "centre",
  "front",
  "back",
  "behind",
  "second",
  "third",
  "first",
  "other",
  "background",
  "foreground"
]);
function routeName(t, people = 1) {
  const l = t.label;
  const w = words(l);
  const has = (...xs) => xs.some((x) => w.includes(x) || l === x);
  if (has("hair", "hairstyle")) return { kind: "part", part: "hair" };
  if (has("eyes", "eye")) return { kind: "face", part: "eyes" };
  if (has("lips", "lip", "mouth")) return { kind: "face", part: "lips" };
  if (has("brows", "eyebrows", "eyebrow", "brow")) return { kind: "face", part: "brows" };
  if (has("teeth", "smile")) return { kind: "face", part: "teeth" };
  if (has("face", "faces") || l === "face skin") return { kind: "part", part: "face" };
  if (has("skin", "arms", "legs", "hands")) return { kind: "part", part: "skin" };
  if (has("clothes", "clothing", "outfit")) return { kind: "part", part: "clothes" };
  if (any(l, SKY)) return { kind: "scene", target: "sky" };
  if (any(l, WATER)) return { kind: "scene", target: "water" };
  if (any(l, VEGETATION)) return { kind: "scene", target: "vegetation" };
  const person = any(l, PERSON);
  if (person && (people > 1 || w.some((x) => WHICH.has(x)))) return { kind: "person" };
  return { kind: "phrase", text: l };
}
const ALIASES = [
  [/* @__PURE__ */ new Set(["ocean", "sea", "seaside", "beach", "waves"]), ["sea", "ocean"]],
  [/* @__PURE__ */ new Set(["man", "woman", "boy", "girl", "child", "kid", "baby", "guy", "lady"]), ["person"]],
  [/* @__PURE__ */ new Set(["men", "women", "people", "crowd", "group"]), ["people", "person"]],
  [/* @__PURE__ */ new Set(["dog", "cat", "bird", "horse", "cow", "crow", "duck", "sheep"]), ["animal"]],
  [/* @__PURE__ */ new Set(["car", "truck", "bus", "van", "bicycle", "bike", "motorcycle"]), ["vehicle"]],
  [/* @__PURE__ */ new Set(["house", "houses", "building", "buildings", "tower", "church"]), ["building"]],
  [/* @__PURE__ */ new Set(["mountain", "mountains", "hills", "hill"]), ["mountain"]],
  [/* @__PURE__ */ new Set(["forest", "woods", "foliage", "treeline", "tree", "trees"]), ["tree", "trees"]]
];
function otherNumber(w) {
  if (w.length < 3 || !new RegExp("^\\p{L}+$", "u").test(w)) return null;
  if (w.endsWith("ss")) return null;
  return w.endsWith("s") ? w.slice(0, -1) : `${w}s`;
}
function searchWords(n) {
  if (!n) return [];
  const out = /* @__PURE__ */ new Set();
  for (const t of n.things) {
    out.add(t.label);
    for (const w of words(t.label)) {
      const o = otherNumber(w);
      if (o) out.add(o);
    }
    const r = routeName({ label: t.label });
    if (r.kind === "scene") out.add(r.target);
    for (const [set, extra] of ALIASES) if (any(t.label, set)) extra.forEach((x) => out.add(x));
  }
  if (n.describe) out.add(n.describe.toLowerCase());
  return [...out];
}
const CULL_VERSION = 1;
const CULL_EDGE = 2048;
const FOCUS_BINS = 8;
const SAME_PHOTO_BITS = 10;
const CULL_PERCENTILES = [1, 5, 50, 95, 99];
const CLIP_LOW = 1 / 255;
const CLIP_HIGH = 254 / 255;
function focusOf(r) {
  if (!r) return null;
  return {
    laplacian: r.laplacian_variance,
    energy: r.gradient_energy,
    coherence: r.coherence,
    angle: r.gradient_angle_deg
  };
}
function exposureOf(s) {
  const at = (p) => {
    const hit = s.luma_percentiles.find((x) => Math.abs(x.percentile - p) < 1e-6);
    return hit ? hit.value / (s.range_max || 1) : NaN;
  };
  const worst = (xs) => xs.reduce((m, x) => Math.max(m, x), 0);
  return {
    mean: s.luma_mean / (s.range_max || 1),
    p1: at(1),
    p5: at(5),
    p50: at(50),
    p95: at(95),
    p99: at(99),
    clipLow: worst(s.clipped_low),
    clipHigh: worst(s.clipped_high)
  };
}
function blinkOf(blendshapes) {
  const score = (name) => blendshapes?.find((b) => b.name === name)?.score ?? null;
  return { blinkLeft: score("eyeBlinkLeft"), blinkRight: score("eyeBlinkRight") };
}
function phashDistance(a, b) {
  if (!a || !b || !/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return null;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
function phashGroups(photos, bits = SAME_PHOTO_BITS) {
  const n = photos.length;
  const parent = photos.map((_, i) => i);
  const find = (i) => parent[i] === i ? i : parent[i] = find(parent[i]);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = phashDistance(photos[i].phash, photos[j].phash);
      if (d !== null && d <= bits) parent[find(j)] = find(i);
    }
  const groups = /* @__PURE__ */ new Map();
  photos.forEach((p, i) => {
    if (!p.phash) return;
    const r = find(i);
    groups.set(r, [...groups.get(r) ?? [], p]);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}
function cullKey(mtime, size, models) {
  return `${mtime}:${size}:v${CULL_VERSION}:${models.subject ? "s" : ""}${models.faces ? "f" : ""}`;
}
function readCull(v) {
  if (!v) return null;
  try {
    const o = JSON.parse(v);
    return o && o.v === CULL_VERSION && o.exposure && o.focus ? o : null;
  } catch {
    return null;
  }
}
const SPOT_LABEL = {
  heal: concepts.tk("Heal"),
  clone: concepts.tk("Clone"),
  fill: concepts.tk("Fill"),
  remove: concepts.tk("Remove"),
  redeye: concepts.tk("Red eye"),
  peteye: concepts.tk("Pet eye")
};
const clamp$3 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round5 = (v) => Math.round(v * 1e5) / 1e5;
function featherOf(s) {
  return { radius: round5(clamp$3(s.feather, 0, 100) / 100 * 0.5 * s.radius), edge: "Zero" };
}
function spotShape(points, radius) {
  const r = round5(clamp$3(radius, 1e-4, 0.5));
  if (points.length <= 1) {
    const c = points[0] ?? { x: 0.5, y: 0.5 };
    return { Circle: { centre: { x: round5(c.x), y: round5(c.y) }, radius: r } };
  }
  return {
    Stroke: {
      points: points.slice(0, 4096).map((p) => ({ x: round5(p.x), y: round5(p.y) })),
      radius: r
    }
  };
}
function reach(points, radius, feather, w, h) {
  const short = Math.min(w, h);
  const rx = (radius + 3 * feather) * short / w;
  const ry = (radius + 3 * feather) * short / h;
  return {
    minX: Math.min(...points.map((p) => p.x)) - rx,
    maxX: Math.max(...points.map((p) => p.x)) + rx,
    minY: Math.min(...points.map((p) => p.y)) - ry,
    maxY: Math.max(...points.map((p) => p.y)) + ry
  };
}
const SMALLEST_RENDER = 1280;
function fitOffset(offset, points, radius, feather, w, h) {
  const r = reach(points, radius, feather, w, h);
  const k = Math.min(1, SMALLEST_RENDER / Math.max(w, h));
  const ring = { x: 2 / (w * k), y: 2 / (h * k) };
  const lo = { x: -(r.minX - ring.x), y: -(r.minY - ring.y) };
  const hi = { x: 1 - (r.maxX + ring.x), y: 1 - (r.maxY + ring.y) };
  if (lo.x > hi.x || lo.y > hi.y) return null;
  return { x: clamp$3(offset.x, lo.x, hi.x), y: clamp$3(offset.y, lo.y, hi.y) };
}
function turnVector(o, dx, dy) {
  const q = recipe.transformPoint(o, { x: 0.5 + dx, y: 0.5 + dy });
  return { x: q.x - 0.5, y: q.y - 0.5 };
}
function eyeEllipse(s, o) {
  const c = recipe.transformPoint(o, s.points[0] ?? { x: 0.5, y: 0.5 });
  const th = s.rotate * Math.PI / 180;
  const d = turnVector(o, Math.cos(th), Math.sin(th));
  const deg = Math.atan2(d.y, d.x) * 180 / Math.PI;
  return {
    centre: { x: round5(c.x), y: round5(c.y) },
    radius_x: round5(clamp$3(s.radius, 1e-4, 0.5)),
    radius_y: round5(clamp$3(s.radiusY || s.radius, 1e-4, 0.5)),
    rotate_degrees: round5((deg + 540) % 360 - 180)
  };
}
const RETOUCH_SPACE = {
  Encoded: {
    space: "DisplayP3",
    intent: "RelativeColorimetric",
    black_point_compensation: false
  }
};
function compileRetouch(spots, user, w, h, inpainter = null) {
  const swap = recipe.transformPoint(user, { x: 1, y: 0.5 }).y !== 0.5;
  const fw = swap ? h : w;
  const fh = swap ? w : h;
  const steps = [];
  for (const s of spots) {
    if (!s.enabled || s.points.length === 0) continue;
    const points = s.points.map((p) => recipe.transformPoint(user, p));
    const feather = featherOf(s);
    const opacity = clamp$3(s.opacity / 100, 0, 1);
    const shape = spotShape(points, s.radius);
    switch (s.kind) {
      case "heal":
      case "clone": {
        if (!s.source) continue;
        const src = recipe.transformPoint(user, s.source);
        const want = { x: src.x - points[0].x, y: src.y - points[0].y };
        const off = fitOffset(want, points, s.radius, feather.radius, fw, fh);
        if (!off) continue;
        const spot = {
          shape,
          source_offset: { x: round5(off.x), y: round5(off.y) },
          feather,
          opacity
        };
        steps.push(s.kind === "heal" ? { Heal: spot } : { Clone: spot });
        break;
      }
      case "fill":
        steps.push({
          Fill: {
            shape,
            feather,
            opacity,
            patch: 7,
            iterations: 20,
            // Reproducible: the same spot fills the same way every render.
            seed: parseInt(s.id.replace(/[^0-9a-f]/gi, "").slice(0, 8) || "1", 16)
          }
        });
        break;
      case "remove":
        if (!inpainter) continue;
        steps.push({
          Remove: { shape, feather, opacity, context: REMOVE_CONTEXT, model: inpainter }
        });
        break;
      case "redeye":
        steps.push({
          RedEye: {
            pupils: [eyeEllipse(s, user)],
            feather,
            desaturate: clamp$3(s.desaturate / 100, 0, 1),
            darken: clamp$3(s.darken / 100, 0, 1)
          }
        });
        break;
      case "peteye":
        steps.push({
          PetEye: {
            pupils: [eyeEllipse(s, user)],
            feather,
            amount: clamp$3(s.amount / 100, 0, 1),
            pupil_level: clamp$3(s.pupilLevel / 100, 0, 1),
            catchlights: []
          }
        });
        break;
    }
  }
  return steps.length > 0 ? { space: RETOUCH_SPACE, steps } : null;
}
function newSpot(id, kind, points, radius, feather, opacity) {
  return {
    id,
    kind,
    enabled: true,
    points,
    radius,
    radiusY: radius,
    rotate: 0,
    source: null,
    feather,
    opacity,
    desaturate: 100,
    darken: 30,
    amount: 100,
    pupilLevel: 10
  };
}
const REMOVE_CONTEXT = 0.75;
function strokeOver(mask) {
  const { data, width: w, height: h } = mask;
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[y * w + x] >= 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const r = Math.max(2, Math.max(x1 - x0 + 1, y1 - y0 + 1) / 24);
  let step = r * 1.2;
  step = Math.max(step, (y1 - y0 + 1) / 2e3);
  const points = [];
  let flip = false;
  for (let yc = y0; yc <= y1 + step / 2; yc += step) {
    const lo = Math.max(0, Math.floor(yc - step / 2));
    const hi = Math.min(h - 1, Math.ceil(yc + step / 2));
    let a = w;
    let b = -1;
    for (let y2 = lo; y2 <= hi; y2++)
      for (let x = x0; x <= x1; x++)
        if (data[y2 * w + x] >= 128) {
          if (x < a) a = x;
          if (x > b) b = x;
        }
    if (b < 0) continue;
    const y = Math.min(h - 1, yc);
    const row = [
      { x: (a + 0.5) / w, y: (y + 0.5) / h },
      { x: (b + 0.5) / w, y: (y + 0.5) / h }
    ];
    points.push(...flip ? row.reverse() : row);
    flip = !flip;
  }
  if (points.length === 1) points.push({ ...points[0] });
  return { points, radius: r / Math.min(w, h) };
}
function removeSpot(points, radius, feather) {
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return newSpot(id, "remove", points, radius, feather, 100);
}
function nextMaskName(names) {
  let top = 0;
  for (const n of names) {
    const m = /^Mask (\d+)$/.exec(n);
    if (m) top = Math.max(top, Number(m[1]));
  }
  return `Mask ${Math.max(top, names.length) + 1}`;
}
function effectiveMode(index, mode) {
  return index === 0 ? "Add" : mode;
}
const EDGE_RADIUS_MIN = 0.05;
const EDGE_RADIUS_MAX = 5;
const MODEL_EDGE_RADIUS = 0.1;
const REFINE_EPSILON = 1e-3;
const MODEL_REFINE = { on: true, radius: MODEL_EDGE_RADIUS };
function modelRefine() {
  return { ...MODEL_REFINE };
}
function hardenPlane(grey, at, times) {
  const mid = at * 255;
  for (let i = 0; i < grey.length; i++)
    grey[i] = Math.max(0, Math.min(255, Math.round((grey[i] - mid) * times + 127.5)));
}
function snapsToObject(c) {
  return c.kind === "brush" && !c.source && c.refine?.on === true;
}
const clamp$2 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round6 = (v) => Math.round(v * 1e6) / 1e6;
function refinable(c) {
  return c.kind === "brush" || c.kind === "polygon";
}
function refining(c) {
  return refinable(c) && c.refine?.on === true;
}
function engineRefine(c) {
  if (!refining(c) || !c.refine) return null;
  const radius = clamp$2(c.refine.radius, EDGE_RADIUS_MIN, EDGE_RADIUS_MAX) / 100;
  const shift = c.kind === "brush" ? clamp$2(c.edge?.shift ?? 0, -100, 100) : 0;
  const contract = -shift / 100 * recipe.EDGE_SHIFT_SPAN;
  return { radius: round6(radius), epsilon: REFINE_EPSILON, contract: round6(contract) || 0 };
}
function planeEdge(c) {
  if (!c.edge || c.kind !== "brush" || !refining(c)) return c.edge;
  const e = { ...c.edge, shift: 0 };
  return recipe.isPlainEdge(e) ? void 0 : e;
}
const KELVIN_MIN = 1667;
const KELVIN_MAX = 25e3;
const TINT_MAX_DUV = 0.1;
const TINT_UNITS_PER_DUV = 3e3;
const REFERENCE_KELVIN = 6504;
function planckianXy(t) {
  const x = t <= 4e3 ? -266123900 / t ** 3 - 234358.9 / t ** 2 + 877.6956 / t + 0.17991 : -3025846900 / t ** 3 + 21070379e-1 / t ** 2 + 222.6347 / t + 0.24039;
  const y = t <= 2222 ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683 : t <= 4e3 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867 : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}
function daylightXy(t) {
  const x = t <= 7e3 ? 0.244063 + 99.11 / t + 2967800 / t ** 2 - 4607e6 / t ** 3 : 0.23704 + 247.48 / t + 1901800 / t ** 2 - 20064e5 / t ** 3;
  const y = -3 * x * x + 2.87 * x - 0.275;
  return [x, y];
}
function xyToUv([x, y]) {
  const d = -2 * x + 12 * y + 3;
  return [4 * x / d, 6 * y / d];
}
function uvToXy([u, v]) {
  const d = 2 * u - 8 * v + 4;
  return [3 * u / d, 2 * v / d];
}
function locusUv(t) {
  if (t >= 4e3) return xyToUv(daylightXy(t));
  const joinD = xyToUv(daylightXy(4e3));
  const joinP = xyToUv(planckianXy(4e3));
  const p = xyToUv(planckianXy(t));
  return [p[0] + joinD[0] - joinP[0], p[1] + joinD[1] - joinP[1]];
}
function locusNormal(t) {
  const a = locusUv(Math.max(t - 1, KELVIN_MIN));
  const b = locusUv(Math.min(t + 1, KELVIN_MAX));
  const tangent = [b[0] - a[0], b[1] - a[1]];
  let n = [-tangent[1], tangent[0]];
  const len = Math.hypot(n[0], n[1]);
  if (len > 0) n = [n[0] / len, n[1] / len];
  if (n[1] < 0) n = [-n[0], -n[1]];
  return n;
}
function whiteXy(kelvin, tint) {
  const uv = locusUv(kelvin);
  const n = locusNormal(kelvin);
  return uvToXy([uv[0] + tint * n[0], uv[1] + tint * n[1]]);
}
function whiteXyz(kelvin, tint) {
  return xyToXyz(whiteXy(kelvin, tint));
}
function xyToXyz([x, y]) {
  return [x / y, 1, (1 - x - y) / y];
}
function xyzToXy([X, Y, Z]) {
  const s = X + Y + Z;
  return s > 0 ? [X / s, Y / s] : [0.3127, 0.329];
}
function temperatureTintOf(xy) {
  const uv = xyToUv(xy);
  const along = (t) => {
    const p2 = locusUv(t);
    const a = locusUv(Math.max(t - 1, KELVIN_MIN));
    const b = locusUv(Math.min(t + 1, KELVIN_MAX));
    return (uv[0] - p2[0]) * (b[0] - a[0]) + (uv[1] - p2[1]) * (b[1] - a[1]);
  };
  let lo = 1e6 / KELVIN_MAX;
  let hi = 1e6 / KELVIN_MIN;
  const fLo = along(1e6 / lo);
  const fHi = along(1e6 / hi);
  let kelvin;
  let clamped = false;
  if (Math.sign(fLo) === Math.sign(fHi)) {
    kelvin = Math.abs(fLo) < Math.abs(fHi) ? KELVIN_MAX : KELVIN_MIN;
    clamped = true;
  } else {
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const f = along(1e6 / mid);
      if (Math.sign(f) === Math.sign(fLo)) lo = mid;
      else hi = mid;
    }
    kelvin = 1e6 / ((lo + hi) / 2);
  }
  const p = locusUv(kelvin);
  const n = locusNormal(kelvin);
  let tint = (uv[0] - p[0]) * n[0] + (uv[1] - p[1]) * n[1];
  if (Math.abs(tint) > TINT_MAX_DUV) {
    tint = Math.sign(tint) * TINT_MAX_DUV;
    clamped = true;
  }
  return { kelvin, tint, clamped };
}
function mul(a, b) {
  const r = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
}
function apply(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ];
}
function invert(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / det;
  return [
    [A * k, -(b * i - c * h) * k, (b * f - c * e) * k],
    [B * k, (a * i - c * g) * k, -(a * f - c * d) * k],
    [C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
  ];
}
const BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296]
];
function bradford(from, to) {
  const s = apply(BRADFORD, from);
  const d = apply(BRADFORD, to);
  const scale = [
    [d[0] / s[0], 0, 0],
    [0, d[1] / s[1], 0],
    [0, 0, d[2] / s[2]]
  ];
  return mul(invert(BRADFORD), mul(scale, BRADFORD));
}
function rgbToXyz(p, white = [0.3127, 0.329]) {
  const cols = p.map(xyToXyz);
  const m = [
    [cols[0][0], cols[1][0], cols[2][0]],
    [cols[0][1], cols[1][1], cols[2][1]],
    [cols[0][2], cols[1][2], cols[2][2]]
  ];
  const s = apply(invert(m), xyToXyz(white));
  return [
    [m[0][0] * s[0], m[0][1] * s[1], m[0][2] * s[2]],
    [m[1][0] * s[0], m[1][1] * s[1], m[1][2] * s[2]],
    [m[2][0] * s[0], m[2][1] * s[1], m[2][2] * s[2]]
  ];
}
const REC709_PRIMARIES = [
  [0.64, 0.33],
  [0.3, 0.6],
  [0.15, 0.06]
];
const REC2020_PRIMARIES = [
  [0.708, 0.292],
  [0.17, 0.797],
  [0.131, 0.046]
];
const REC2020_TO_XYZ = rgbToXyz(REC2020_PRIMARIES);
const SRGB_TO_XYZ = rgbToXyz(REC709_PRIMARIES);
const XYZ_TO_REC2020 = invert(REC2020_TO_XYZ);
mul(XYZ_TO_REC2020, SRGB_TO_XYZ);
function opFromAbsolute(userKelvin, userTintDuv, asShot) {
  const shot = whiteXyz(asShot.temperature_kelvin, asShot.tint);
  const ref = whiteXyz(REFERENCE_KELVIN, 0);
  const user = whiteXyz(userKelvin, userTintDuv);
  const seen = apply(bradford(shot, ref), user);
  return temperatureTintOf(xyzToXy(seen));
}
function absoluteFromOp(op, asShot) {
  const shot = whiteXyz(asShot.temperature_kelvin, asShot.tint);
  const ref = whiteXyz(REFERENCE_KELVIN, 0);
  const seen = whiteXyz(op.kelvin, op.tint);
  const user = apply(bradford(ref, shot), seen);
  return temperatureTintOf(xyzToXy(user));
}
const MIRED_PER_UNIT = (1e6 / REFERENCE_KELVIN - 1e6 / KELVIN_MAX) / 100;
function opFromRelative(temperature, tint) {
  const mired = 1e6 / REFERENCE_KELVIN - temperature * MIRED_PER_UNIT;
  let kelvin = 1e6 / mired;
  let clamped = false;
  if (kelvin > KELVIN_MAX || mired <= 0) {
    kelvin = KELVIN_MAX;
    clamped = true;
  }
  if (kelvin < KELVIN_MIN) {
    kelvin = KELVIN_MIN;
    clamped = true;
  }
  return { kelvin, tint: tint / TINT_UNITS_PER_DUV, clamped };
}
function relativeFromOp(op) {
  const mired = 1e6 / op.kelvin;
  return {
    temperature: (1e6 / REFERENCE_KELVIN - mired) / MIRED_PER_UNIT,
    tint: op.tint * TINT_UNITS_PER_DUV
  };
}
function opNeutralising(linearRec2020) {
  const [r, g, b] = linearRec2020;
  if (!(r > 0 && g > 0 && b > 0)) return null;
  return temperatureTintOf(xyzToXy(apply(REC2020_TO_XYZ, linearRec2020)));
}
const LOOK_SPACE = {
  Encoded: { space: "DisplayP3", intent: "RelativeColorimetric", black_point_compensation: false }
};
const MID_GREY_ENCODED = 0.4613;
const DENOISE_REACH = 0.03;
const RAW_SCENE_STOPS = 2;
const SMOOTHING_RADIUS = 0.02;
function smoothingOf(value, ctx) {
  if (ctx.smoothing === false || !(value > 0)) return null;
  return { radius: SMOOTHING_RADIUS, strength: round4(clamp$1(value / 100, 0, 1)) };
}
const LEFT_OUT = {
  sharpen: concepts.tk("Sharpening shows at 100% only: at this zoom its radius is under half a pixel.")
};
const IDENTITY_PRIMARY = {
  exposure: 0,
  lift: { r: 0, g: 0, b: 0 },
  gamma: { r: 1, g: 1, b: 1 },
  gain: { r: 1, g: 1, b: 1 },
  contrast: 1,
  contrast_pivot: MID_GREY_ENCODED,
  saturation: 1,
  hue_shift: 0
};
const clamp$1 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round4 = (v) => Math.round(v * 1e4) / 1e4;
function primary(p) {
  return { ...IDENTITY_PRIMARY, ...p };
}
function curve(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const out = [];
  for (const p of sorted) {
    const x = round4(clamp$1(p.x, 0, 1));
    if (out.length > 0 && x <= out[out.length - 1].x) continue;
    out.push({ x, y: round4(clamp$1(p.y, 0, 1)) });
  }
  return { points: out };
}
const HDR_ENCODED_TOP = 5.3;
function tonal(points, hdr) {
  const c = curve(points);
  const last = c.points[c.points.length - 1];
  if (!hdr || !last) return c;
  return {
    points: [
      ...c.points,
      { x: round4(last.x + 0.5), y: round4(last.y + 0.5) },
      { x: HDR_ENCODED_TOP, y: round4(last.y + HDR_ENCODED_TOP - last.x) }
    ]
  };
}
function isIdentityCurve(points) {
  return points.every((p) => Math.abs(p.x - p.y) < 1e-6);
}
function curvesOp(c) {
  return {
    Curves: {
      master: null,
      red: null,
      green: null,
      blue: null,
      luma_vs_saturation: null,
      hue_vs_saturation: null,
      hue_vs_hue: null,
      refine_saturation: null,
      ...c
    }
  };
}
function parametricCurve(tc) {
  const amounts = [tc.shadows, tc.darks, tc.lights, tc.highlights];
  if (amounts.every((a) => a === 0)) return null;
  const [s1, s2, s3] = tc.splits.map((s) => clamp$1(s, 5, 95) / 100);
  const edges = [0, s1, s2, s3, 1];
  const bump = (x, a, b) => {
    const w = (b - a) * 0.5;
    if (x <= a - w || x >= b + w) return 0;
    if (x < a) return 0.5 - 0.5 * Math.cos(Math.PI * (x - (a - w)) / w);
    if (x > b) return 0.5 + 0.5 * Math.cos(Math.PI * (x - b) / w);
    return 1;
  };
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const x = i / 16;
    let y = x;
    for (let r = 0; r < 4; r++) y += amounts[r] / 100 * 0.25 * bump(x, edges[r], edges[r + 1]);
    if (i === 0) y = 0;
    if (i === 16) y = 1;
    pts.push({ x, y: clamp$1(y, 0, 1) });
  }
  return pts;
}
const STANDARD_CURVE = [
  { x: 0, y: 0 },
  { x: 0.1, y: 0.075 },
  { x: 0.3, y: 0.275 },
  { x: 0.5, y: 0.515 },
  { x: 0.75, y: 0.795 },
  { x: 0.92, y: 0.945 },
  { x: 1, y: 1 }
];
const STANDARD_SATURATION = 1.12;
const VIVID_CURVE = [
  { x: 0, y: 0 },
  { x: 0.1, y: 0.06 },
  { x: 0.3, y: 0.255 },
  { x: 0.5, y: 0.53 },
  { x: 0.75, y: 0.82 },
  { x: 0.92, y: 0.96 },
  { x: 1, y: 1 }
];
const shoulders = /* @__PURE__ */ new Map();
function shoulderCube(exposure, size = 1024) {
  const key = `${exposure}:${size}`;
  let cube = shoulders.get(key);
  if (cube === void 0) {
    cube = buildShoulder(exposure, size);
    if (shoulders.size >= 64) {
      const old = shoulders.keys().next().value;
      cubeNames.delete(shoulders.get(old));
      shoulders.delete(old);
    }
    shoulders.set(key, cube);
    cubeNames.set(cube, `shoulder:${key}`);
  }
  return cube;
}
const cubeNames = /* @__PURE__ */ new Map();
function gradeKey(value) {
  return JSON.stringify(
    value,
    (k, v) => k === "Cube" && typeof v === "string" ? cubeNames.get(v) ?? v : v
  );
}
function buildShoulder(exposure, size) {
  const top = 2 ** exposure;
  const knee = 0.75;
  const a = (top - knee) / (1 - knee);
  const lines = [
    'TITLE "Playroom highlight shoulder"',
    `LUT_1D_SIZE ${size}`,
    `DOMAIN_MIN 0 0 0`,
    `DOMAIN_MAX ${top} ${top} ${top}`
  ];
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1) * top;
    let y;
    if (x <= knee) y = x;
    else {
      const t = (x - knee) / (top - knee);
      y = knee + (1 - knee) * (a * t / (1 + (a - 1) * t));
    }
    const v = y.toFixed(6);
    lines.push(`${v} ${v} ${v}`);
  }
  return lines.join("\n") + "\n";
}
function baseWhite(r, ctx) {
  if (r.wb.mode === "as-shot") return null;
  const op = ctx.isRaw && ctx.asShot ? opFromAbsolute(r.wb.temperature, r.wb.tint / 3e3, ctx.asShot) : opFromRelative(r.wb.temperature, r.wb.tint);
  if (Math.abs(op.kelvin - 6504) < 0.5 && Math.abs(op.tint) < 1e-6) return null;
  return op;
}
function absoluteWb(ctx) {
  return ctx.isRaw && ctx.asShot !== null;
}
const MIXER_ROW_MAX = 16;
function calibrationMatrix(c) {
  const v = (x) => clamp$1(x, -100, 100);
  const shifts = [
    [v(c.redHue), v(c.redSaturation)],
    [v(c.greenHue), v(c.greenSaturation)],
    [v(c.blueHue), v(c.blueSaturation)]
  ];
  if (shifts.every(([h, s]) => h === 0 && s === 0)) return null;
  const u = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const cols = shifts.map(([hue, sat], i) => {
    const p = [0, 0, 0];
    p[i] = 1;
    const m = (p[0] + p[1] + p[2]) / 3;
    const c0 = p.map((v2) => v2 - m);
    const th = hue / 100 * 20 * Math.PI / 180;
    const cross = [
      u[1] * c0[2] - u[2] * c0[1],
      u[2] * c0[0] - u[0] * c0[2],
      u[0] * c0[1] - u[1] * c0[0]
    ];
    const k = 1 + sat / 100 * 0.6;
    return c0.map((v2, j) => m + k * (v2 * Math.cos(th) + cross[j] * Math.sin(th)));
  });
  const M = [0, 1, 2].map((r) => [cols[0][r], cols[1][r], cols[2][r]]);
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (col) => {
    const A = M.map((row2) => [...row2]);
    for (let r = 0; r < 3; r++) A[r][col] = 1;
    const d = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    return d / det;
  };
  const w = [solve(0), solve(1), solve(2)];
  const row = (r) => ({
    r: round4(M[r][0] * w[0]),
    g: round4(M[r][1] * w[1]),
    b: round4(M[r][2] * w[2])
  });
  const rows = [row(0), row(1), row(2)];
  if (rows.some((x) => Math.max(Math.abs(x.r), Math.abs(x.g), Math.abs(x.b)) > MIXER_ROW_MAX))
    return null;
  return rows;
}
function autoCrop(degrees, w, h) {
  const th = Math.abs(degrees) * Math.PI / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const k = Math.min(w / (w * c + h * s), h / (w * s + h * c));
  const shrink = k * 0.999;
  return { x: (1 - shrink) / 2, y: (1 - shrink) / 2, width: shrink, height: shrink };
}
function cropFits(crop, degrees, w, h, transform = null) {
  return recipe.cropFitsWarp(crop, degrees, transform, w, h);
}
function framingWarps(f) {
  return (f?.rotate_degrees ?? 0) !== 0 || !!f?.transform;
}
function framingTransparent(f) {
  return f?.outside === "Transparent";
}
function orientedFrame(r, frameWidth, frameHeight) {
  const user = recipe.userOrientation(r.geometry.quarterTurns, r.geometry.flipHorizontal);
  const swap = recipe.swapsAxes(user);
  return { user, width: swap ? frameHeight : frameWidth, height: swap ? frameWidth : frameHeight };
}
const MIN_FIT = 0.05;
function fitCrop(crop, degrees, w, h, transform = null) {
  const fits = (c) => cropFits(c, degrees, w, h, transform);
  const c0 = {
    x: Math.min(1, Math.max(0, crop.x + crop.width / 2)),
    y: Math.min(1, Math.max(0, crop.y + crop.height / 2))
  };
  const at = (c, k2) => {
    const cw = Math.min(crop.width * k2, 1);
    const ch = Math.min(crop.height * k2, 1);
    const x = Math.min(Math.max(0, c.x - cw / 2), 1 - cw);
    const y = Math.min(Math.max(0, c.y - ch / 2), 1 - ch);
    return { x, y, width: cw, height: ch };
  };
  if (fits(at(c0, 1))) return at(c0, 1);
  const kMin = Math.min(1, Math.max(MIN_FIT / crop.width, MIN_FIT / crop.height));
  const largest = (c) => {
    let lo2 = kMin;
    let hi2 = 1;
    for (let i = 0; i < 30; i++) {
      const k2 = (lo2 + hi2) / 2;
      if (fits(at(c, k2))) lo2 = k2;
      else hi2 = k2;
    }
    return Math.max(kMin, lo2 * 0.999);
  };
  if (fits(at(c0, kMin))) return at(c0, largest(c0));
  const mid = { x: 0.5, y: 0.5 };
  if (!fits(at(mid, kMin))) return at(mid, kMin);
  const k = fits(at(mid, 1)) ? 1 : largest(mid);
  const along = (t) => ({
    x: c0.x + (mid.x - c0.x) * t,
    y: c0.y + (mid.y - c0.y) * t
  });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    if (fits(at(along(t), k))) hi = t;
    else lo = t;
  }
  return at(along(hi), k);
}
function aspectCrop(aspect, degrees, w, h, transform = null) {
  const frameAspect = w / h;
  const base = aspect > frameAspect ? { width: 1, height: frameAspect / aspect } : { width: aspect / frameAspect, height: 1 };
  return fitCrop(
    { x: (1 - base.width) / 2, y: (1 - base.height) / 2, ...base },
    degrees,
    w,
    h,
    transform
  );
}
function effectiveCrop(r, w, h) {
  const { straighten, crop, aspect } = r.geometry;
  const t = recipe.uprightTransform(r.geometry.upright, w, h);
  const c = crop ? fitCrop(crop, straighten, w, h, t) : aspect !== null && aspect > 0 ? aspectCrop(aspect, straighten, w, h, t) : t ? fitCrop({ x: 0, y: 0, width: 1, height: 1 }, straighten, w, h, t) : straighten !== 0 ? autoCrop(straighten, w, h) : null;
  return c && isWhole(c) ? null : c;
}
function isWhole(c) {
  const e = 1e-5;
  return c.x <= e && c.y <= e && c.width >= 1 - e && c.height >= 1 - e;
}
function within45(half, rotation, w, h) {
  let r = rotation - 180 * Math.round(rotation / 180);
  if (Math.abs(r) <= 45) return { half, rotation: r };
  r -= 90 * Math.sign(r);
  return { half: { x: half.y * h / w, y: half.x * w / h }, rotation: r };
}
function vignettePlacement(crop, degrees, w, h, transform = null) {
  if (transform) {
    const flat = vignettePlacement(crop, degrees, w, h);
    const back = (x, y) => recipe.canvasToFrame(transform, w, h, { x, y }) ?? { x, y };
    const c0 = crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const mid = (fx, fy) => {
      const qx2 = (c0.x + fx * c0.width) * w - w / 2;
      const qy2 = (c0.y + fy * c0.height) * h - h / 2;
      const th2 = degrees * Math.PI / 180;
      return back(
        (Math.cos(th2) * qx2 + Math.sin(th2) * qy2 + w / 2) / w,
        (-Math.sin(th2) * qx2 + Math.cos(th2) * qy2 + h / 2) / h
      );
    };
    const centre = back(flat.centre.x, flat.centre.y);
    const dist = (a, b) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
    const hx = (dist(mid(1, 0.5), centre) + dist(mid(0, 0.5), centre)) / 2 / w;
    const hy = (dist(mid(0.5, 1), centre) + dist(mid(0.5, 0), centre)) / 2 / h;
    return { centre, half: { x: hx, y: hy }, rotation: flat.rotation - transform.rotate };
  }
  const c = crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const qx = (c.x + c.width / 2) * w - w / 2;
  const qy = (c.y + c.height / 2) * h - h / 2;
  const th = degrees * Math.PI / 180;
  const px = Math.cos(th) * qx + Math.sin(th) * qy;
  const py = -Math.sin(th) * qx + Math.cos(th) * qy;
  return {
    centre: { x: (px + w / 2) / w, y: (py + h / 2) / h },
    half: { x: c.width / 2, y: c.height / 2 },
    rotation: -degrees
  };
}
function smoothnessRadius(smoothness, k) {
  const short = Math.min(k.width, k.height) * k.scale;
  const r = Math.round(clamp$1(smoothness, 0, 100) / 100 * 0.01 * short);
  return Math.max(0, Math.min(r, Math.floor(short / 2) - 1));
}
function smoothnessFeather(smoothness) {
  return clamp$1(smoothness, 0, 100) / 100 * 0.01;
}
function withLutDomains(v) {
  if (Array.isArray(v)) return v.map(withLutDomains);
  if (!v || typeof v !== "object") return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === "Lut" && x && typeof x === "object" && !Array.isArray(x)) {
      out[k] = { out_of_domain: "Clamp", ...x };
    } else if (k === "Denoise" && x && typeof x === "object" && !Array.isArray(x)) {
      out[k] = { reach: DENOISE_REACH, ...x };
    } else out[k] = withLutDomains(x);
  }
  return out;
}
function layerWhite(wb) {
  if (wb.mode === "as-shot" || wb.temperature === 0 && wb.tint === 0) return null;
  return opFromRelative(wb.temperature, wb.tint);
}
function scaleSettings(s, amount) {
  const k = clamp$1(amount, 0, 200) / 100;
  if (k === 1) return s;
  const m = (v) => v * k;
  const curve2 = (c) => c.map((p) => ({ x: p.x, y: p.x + (p.y - p.x) * k }));
  const wheel = (w) => ({
    hue: w.hue,
    saturation: m(w.saturation),
    luminance: m(w.luminance)
  });
  const tc = s.toneCurve;
  const cg = s.colorGrade;
  return {
    wb: { ...s.wb, temperature: m(s.wb.temperature), tint: m(s.wb.tint) },
    basic: Object.fromEntries(
      Object.entries(s.basic).map(([key, v]) => [key, m(v)])
    ),
    // Smoothing is how, not how much: Amount leaves it as set.
    presence: Object.fromEntries(
      Object.entries(s.presence).map(([key, v]) => [key, key === "smoothing" ? v : m(v)])
    ),
    toneCurve: {
      ...tc,
      highlights: m(tc.highlights),
      lights: m(tc.lights),
      darks: m(tc.darks),
      shadows: m(tc.shadows),
      master: curve2(tc.master),
      red: curve2(tc.red),
      green: curve2(tc.green),
      blue: curve2(tc.blue)
    },
    hsl: Object.fromEntries(
      Object.entries(s.hsl).map(([b, v]) => [
        b,
        { hue: m(v.hue), saturation: m(v.saturation), luminance: m(v.luminance) }
      ])
    ),
    pointColors: s.pointColors.map((p) => ({
      ...p,
      shiftHue: m(p.shiftHue),
      shiftSat: m(p.shiftSat),
      shiftLum: m(p.shiftLum)
    })),
    colorGrade: {
      ...cg,
      shadows: wheel(cg.shadows),
      midtones: wheel(cg.midtones),
      highlights: wheel(cg.highlights),
      global: wheel(cg.global),
      add: { ...cg.add, amount: m(cg.add.amount) }
    },
    detail: {
      ...s.detail,
      sharpenAmount: m(s.detail.sharpenAmount),
      noiseLuminance: m(s.detail.noiseLuminance),
      noiseColor: m(s.detail.noiseColor)
    },
    effects: {
      ...s.effects,
      vignetteAmount: m(s.effects.vignetteAmount),
      grainAmount: m(s.effects.grainAmount),
      wash: { ...s.effects.wash, amount: m(s.effects.wash.amount) }
    },
    calibration: Object.fromEntries(
      Object.entries(s.calibration).map(([key, v]) => [key, m(v)])
    )
  };
}
function maskComponent(c, user, brushPaths, frame) {
  const smooth = c.kind === "range" ? smoothnessFeather(c.smoothness ?? 0) : 0;
  const base = {
    mode: c.mode,
    opacity: clamp$1(c.opacity / 100, 0, 1),
    invert: c.invert,
    feather: {
      radius: round4(clamp$1(c.feather / 100 * 0.1 + smooth, 0, 0.5)),
      edge: "Zero"
    },
    refine: engineRefine(c)
  };
  switch (c.kind) {
    case "linear":
    case "radial":
    case "bidirectional": {
      if (gradients.rasterGradient(c)) {
        const path2 = brushPaths[c.id];
        if (!path2) return null;
        return { ...base, shape: { Raster: { source: { Png: path2 }, resampler: "Bilinear" } } };
      }
      const shape = gradients.gradientShape(c, user);
      return shape ? { ...base, shape } : null;
    }
    case "brush": {
      const path2 = brushPaths[c.id];
      if (!path2) return null;
      return { ...base, shape: { Raster: { source: { Png: path2 }, resampler: "Bilinear" } } };
    }
    case "polygon": {
      if (c.points.length < 3) return null;
      const by = (c.edge?.shift ?? 0) / 100 * recipe.EDGE_SHIFT_SPAN - (c.edge?.inside ? base.feather.radius : 0);
      const contour = (ring) => ({
        points: recipe.offsetPolygon(
          ring.map((p) => recipe.transformPoint(user, p)),
          by,
          frame.width,
          frame.height
        ).map((q) => ({ x: round4(clamp$1(q.x, 0, 1)), y: round4(clamp$1(q.y, 0, 1)) }))
      });
      const rings = (c.rings ?? []).filter((r) => r.length >= 3);
      return {
        ...base,
        shape: {
          Polygon: {
            contours: [contour(c.points), ...rings.map(contour)],
            fill_rule: rings.length ? "EvenOdd" : "NonZero"
          }
        }
      };
    }
    case "range": {
      if (!c.hue && !c.saturation && !c.luma) return null;
      return {
        ...base,
        shape: {
          Range: {
            hue: c.hue,
            saturation: c.saturation,
            luma: c.luma,
            blur_radius: 0,
            invert: false
          }
        }
      };
    }
    case "depth": {
      const path2 = brushPaths[c.id];
      if (!path2) return null;
      const [a, b] = c.near <= c.far ? [c.near, c.far] : [c.far, c.near];
      return {
        ...base,
        shape: {
          DepthRange: {
            depth: { Raster: { Png: path2 } },
            quantity: "Disparity",
            near: round4(1 - a / 100),
            far: round4(1 - b / 100),
            softness: round4(clamp$1(c.softness / 100, 0, 1) * DEPTH_SOFTNESS_MAX),
            // Depth edges aren't the picture's: bilinear, never guided (engine 0.18).
            resampler: "Bilinear"
          }
        }
      };
    }
    default:
      return null;
  }
}
const DEPTH_SOFTNESS_MAX = 0.25;
function layerMask(l, user, brushPaths, frame = { width: 1, height: 1 }) {
  const drawn = l.components.map((c, i) => maskComponent({ ...c, mode: effectiveMode(i, c.mode) }, user, brushPaths, frame)).filter((c) => c !== null);
  const first = drawn.findIndex((c) => c.mode === "Add");
  if (first < 0) return null;
  const components = drawn.slice(first);
  const reads = components.some((c) => "Range" in c.shape || c.refine !== null);
  return { components, invert: l.invert, space: reads ? LOOK_SPACE : null };
}
const BOUNDED_BLENDS = ["Screen", "Overlay", "SoftLight", "HardLight"];
const HDR_BLEND_SPACE = {
  Encoded: { space: "Rec2100Pq", intent: "RelativeColorimetric", black_point_compensation: false }
};
function blendFor(mode, hdr) {
  if (mode === "Normal") return { mode, space: "LinearWorking" };
  if (hdr && BOUNDED_BLENDS.includes(mode)) return { mode, space: HDR_BLEND_SPACE };
  return { mode, space: LOOK_SPACE };
}
function stage(space, ops) {
  return ops.length > 0 ? [{ space, ops }] : [];
}
const P3_FLOOR = "LUT_1D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 64 64 64\n0 0 0\n64 64 64\n";
function isP3Floor(op) {
  return "Lut" in op && "Cube" in op.Lut.lut && op.Lut.lut.Cube === P3_FLOOR;
}
const floorOp = () => ({
  Lut: { lut: { Cube: P3_FLOOR }, amount: 1, out_of_domain: "Clamp" }
});
function smoothed(op) {
  const v = Object.values(op)[0];
  return !!v && typeof v === "object" && v.smoothing != null;
}
function withFloors(ops) {
  const out = [];
  for (const op of ops) {
    const o = "Masked" in op ? { Masked: { ...op.Masked, ops: withFloors(op.Masked.ops) } } : op;
    const last = out[out.length - 1];
    if (smoothed(o) && !(last && isP3Floor(last))) out.push(floorOp());
    out.push(o);
  }
  return out;
}
function lookStage(ops) {
  if (ops.length === 0) return [];
  return stage(LOOK_SPACE, withFloors([floorOp(), ...ops]));
}
function sharpenOp(amount, radius, detail, masking, scale, notes) {
  if (amount <= 0) return null;
  const px = radius * scale;
  if (px < 0.5) {
    notes.push(LEFT_OUT.sharpen);
    return null;
  }
  return {
    Sharpen: {
      amount: round4(clamp$1(amount / 50, 0, 3)),
      radius: round4(clamp$1(px, 0.5, 3)),
      detail: clamp$1(detail / 100, 0, 1),
      masking: clamp$1(masking / 100, 0, 1)
    }
  };
}
function hslOp(hsl, bwMix, smoothing) {
  if (bwMix) {
    if (recipe.HSL_BANDS.every((b) => bwMix[b] === 0)) return null;
    const bands2 = Object.fromEntries(
      recipe.HSL_BANDS.map((b) => [b, { hue: 0, saturation: 0, luminance: round4(bwMix[b] * 6e-3) }])
    );
    return { HslBands: { ...bands2, smoothing } };
  }
  if (recipe.HSL_BANDS.every((b) => hsl[b].hue === 0 && hsl[b].saturation === 0 && hsl[b].luminance === 0))
    return null;
  const bands = Object.fromEntries(
    recipe.HSL_BANDS.map((b) => [
      b,
      {
        hue: round4(clamp$1(hsl[b].hue * 0.3, -180, 180)),
        saturation: round4(clamp$1(hsl[b].saturation / 100, -1, 1)),
        luminance: round4(clamp$1(hsl[b].luminance * 6e-3, -1, 1))
      }
    ])
  );
  return { HslBands: { ...bands, smoothing } };
}
const POINT_COLOR_SMOOTHNESS = 15;
function pointColorOps(points, keyScale = { width: 1, height: 1, scale: 0 }, smoothing = null) {
  const ops = [];
  const blur = smoothnessRadius(POINT_COLOR_SMOOTHNESS, keyScale);
  for (const p of points) {
    if (p.shiftHue === 0 && p.shiftSat === 0 && p.shiftLum === 0) continue;
    const range = clamp$1(p.range, 0, 100);
    const key = {
      hue: p.saturation < 0.08 ? null : {
        centre: round4((p.hue % 360 + 360) % 360),
        width: round4(10 + range * 0.3),
        softness: round4(8 + range * 0.16)
      },
      saturation: {
        centre: round4(clamp$1(p.saturation, 0, 1)),
        width: round4(0.3 + range / 250),
        softness: 0.15
      },
      luma: {
        centre: round4(clamp$1(p.luminance, 0, 1)),
        width: round4(0.3 + range / 250),
        softness: 0.12
      },
      blur_radius: blur,
      invert: false
    };
    const correction = primary({
      hue_shift: round4(clamp$1(p.shiftHue, -100, 100) * 0.3),
      saturation: round4(Math.max(0, 1 + clamp$1(p.shiftSat, -100, 100) / 100)),
      exposure: round4(clamp$1(p.shiftLum, -100, 100) / 100 * 0.6)
    });
    ops.push({ Qualifier: { key, correction, smoothing } });
  }
  return ops;
}
function colorGradeOp(cg, smoothing) {
  const wheels = [cg.shadows, cg.midtones, cg.highlights, cg.global];
  if (wheels.every((w) => w.saturation === 0 && w.luminance === 0)) return null;
  const wheel = (w) => ({
    hue: (w.hue % 360 + 360) % 360,
    saturation: clamp$1(w.saturation / 100, 0, 1),
    luminance: clamp$1(w.luminance / 100, -1, 1)
  });
  return {
    ColorGrade: {
      shadows: wheel(cg.shadows),
      midtones: wheel(cg.midtones),
      highlights: wheel(cg.highlights),
      global: wheel(cg.global),
      blending: clamp$1(cg.blending / 100, 0, 1),
      balance: clamp$1(cg.balance / 100, -1, 1),
      smoothing
    }
  };
}
function settingsStages(r, base, geometry, ctx, crop, oriented, notes, finish) {
  const linear = [];
  const look = [];
  const hdr = ctx.hdr === true;
  const smoothing = smoothingOf(r.presence.smoothing, ctx);
  const d = r.detail;
  const denoise = !(base && ctx.aiDenoised) && (d.noiseLuminance > 0 || d.noiseColor > 0) ? {
    Denoise: {
      luminance: clamp$1(d.noiseLuminance / 100, 0, 1),
      luminance_detail: clamp$1(d.noiseLuminanceDetail / 100, 0, 1),
      color: clamp$1(d.noiseColor / 100, 0, 1),
      color_detail: clamp$1(d.noiseColorDetail / 100, 0, 1),
      reach: DENOISE_REACH
    }
  } : null;
  if (denoise && base && ctx.isRaw) linear.push(denoise);
  const wb = base ? baseWhite(r, ctx) : layerWhite(r.wb);
  if (wb)
    linear.push({ WhiteBalance: { temperature_kelvin: round4(wb.kelvin), tint: round4(wb.tint) } });
  const mix = calibrationMatrix(r.calibration);
  if (mix) linear.push({ ChannelMixer: { red: mix[0], green: mix[1], blue: mix[2] } });
  if (r.basic.exposure !== 0)
    linear.push({ Primary: primary({ exposure: round4(r.basic.exposure), contrast_pivot: 0.18 }) });
  const room = base && ctx.isRaw ? RAW_SCENE_STOPS : 0;
  if (base && !ctx.hdr && (r.basic.exposure > 0 || room > 0)) {
    const stops = round4(Math.max(0, r.basic.exposure) + room);
    linear.push({
      Lut: { lut: { Cube: shoulderCube(stops) }, amount: 1, out_of_domain: "Clamp" }
    });
  }
  const light = recipe.addColorOp(r.colorGrade.add, "light");
  if (light) linear.push(light);
  if (denoise && !(base && ctx.isRaw)) look.push(denoise);
  const defringe = base ? recipe.defringeOp(base.lens) : null;
  if (defringe) look.push(defringe);
  if (r.presence.dehaze !== 0) {
    look.push({
      Dehaze: { amount: clamp$1(r.presence.dehaze / 100, -1, 1), radius: 0.01, smoothing }
    });
  }
  switch (base?.profile.kind ?? "neutral") {
    case "standard":
      look.push(curvesOp({ master: tonal(VIVID_CURVE, hdr) }));
      look.push({ Vibrance: { amount: 0.15, skin_protection: 0.7, smoothing } });
      look.push({ Primary: primary({ saturation: STANDARD_SATURATION }) });
      break;
    case "vivid":
      look.push(curvesOp({ master: tonal(VIVID_CURVE, hdr) }));
      look.push({ Vibrance: { amount: 0.15, skin_protection: 0.7, smoothing } });
      break;
    case "monochrome":
      look.push(curvesOp({ master: tonal(STANDARD_CURVE, hdr) }));
      break;
    case "lut":
      if (base?.profile.kind !== "lut") break;
      if (base.profileAmount > 0) {
        look.push({
          Lut: {
            lut: { Path: base.profile.path },
            amount: clamp$1(base.profileAmount / 100, 0, 1),
            out_of_domain: hdr ? "ScaleHeadroom" : "Clamp"
          }
        });
      }
      break;
  }
  const b = r.basic;
  if (b.highlights || b.shadows || b.whites || b.blacks) {
    look.push({
      Tone: {
        highlights: clamp$1(b.highlights / 100, -1, 1),
        shadows: clamp$1(b.shadows / 100, -1, 1),
        whites: clamp$1(b.whites / 100, -1, 1),
        blacks: clamp$1(b.blacks / 100, -1, 1),
        smoothing
      }
    });
  }
  if (b.contrast !== 0) {
    look.push({
      Primary: primary({ contrast: round4(Math.max(0, 1 + b.contrast / 100 * 0.6)) })
    });
  }
  const p = r.presence;
  if (p.texture !== 0) {
    look.push({
      LocalContrast: {
        amount: clamp$1(p.texture / 100 * 0.8, -1, 1),
        radius: 15e-4,
        midtones: 0.2
      }
    });
  }
  if (p.clarity !== 0) {
    look.push({
      LocalContrast: { amount: clamp$1(p.clarity / 100, -1, 1), radius: 0.012, midtones: 0.8 }
    });
  }
  const para = parametricCurve(r.toneCurve);
  if (para) look.push(curvesOp({ master: tonal(para, hdr) }));
  const tc = r.toneCurve;
  const pc = {};
  if (!isIdentityCurve(tc.master)) pc.master = tonal(tc.master, hdr);
  if (!isIdentityCurve(tc.red)) pc.red = tonal(tc.red, hdr);
  if (!isIdentityCurve(tc.green)) pc.green = tonal(tc.green, hdr);
  if (!isIdentityCurve(tc.blue)) pc.blue = tonal(tc.blue, hdr);
  if (pc.master && tc.refineSaturation < 100)
    pc.refine_saturation = round4(clamp$1(tc.refineSaturation / 100, 0, 1));
  if (Object.keys(pc).length > 0) look.push(curvesOp(pc));
  const bw = !!base && (base.treatment === "bw" || base.profile.kind === "monochrome");
  const tail = bw && finish ? finish : look;
  const hsl = hslOp(r.hsl, bw ? base.bwMix : null, null);
  if (hsl) tail.push(hsl);
  if (!bw) {
    const keyScale = { width: oriented.width, height: oriented.height, scale: ctx.scale };
    tail.push(...pointColorOps(r.pointColors, keyScale, smoothing));
  }
  if (!bw && p.vibrance !== 0) {
    tail.push({
      Vibrance: { amount: clamp$1(p.vibrance / 100, -1, 1), skin_protection: 0.6, smoothing }
    });
  }
  if (bw) tail.push({ Primary: primary({ saturation: 0 }) });
  else if (p.saturation !== 0)
    tail.push({ Primary: primary({ saturation: round4(Math.max(0, 1 + p.saturation / 100)) }) });
  if (!bw && p.hue)
    tail.push({ Primary: primary({ hue_shift: round4(clamp$1(p.hue, -100, 100) * 0.6) }) });
  const cg = colorGradeOp(r.colorGrade, smoothing);
  if (cg) tail.push(cg);
  if (r.calibration.shadowsTint !== 0) {
    const a = round4(r.calibration.shadowsTint / 100 * 0.02);
    tail.push({ Primary: primary({ lift: { r: a / 2, g: -a, b: a / 2 } }) });
  }
  const sharpen = sharpenOp(
    d.sharpenAmount,
    d.sharpenRadius,
    d.sharpenDetail,
    d.sharpenMasking,
    ctx.scale,
    notes
  );
  if (sharpen) tail.push(sharpen);
  const e = r.effects;
  if (e.vignetteAmount !== 0) {
    const v = vignettePlacement(
      crop,
      geometry.straighten,
      oriented.width,
      oriented.height,
      recipe.uprightTransform(geometry.upright, oriented.width, oriented.height)
    );
    const turned = within45(v.half, v.rotation, oriented.width, oriented.height);
    tail.push({
      Vignette: {
        amount: clamp$1(e.vignetteAmount / 100, -1, 1),
        midpoint: clamp$1(e.vignetteMidpoint / 100, 0, 1),
        roundness: clamp$1(e.vignetteRoundness / 100, -1, 1),
        feather: clamp$1(e.vignetteFeather / 100, 0, 1),
        style: vignetteStyle(e, ctx.hdr === true, notes),
        centre: { x: round4(v.centre.x), y: round4(v.centre.y) },
        half_size: {
          x: round4(Math.max(turned.half.x, 1e-4)),
          y: round4(Math.max(turned.half.y, 1e-4))
        },
        rotation_degrees: clamp$1(turned.rotation, -45, 45)
      }
    });
  }
  const wash = recipe.addColorOp(e.wash, "wash");
  if (wash) tail.push(wash);
  if (e.grainAmount > 0) {
    tail.push({
      Grain: {
        amount: clamp$1(e.grainAmount / 100, 0, 1),
        size: round4(4e-4 + clamp$1(e.grainSize, 0, 100) / 100 * 4e-3),
        roughness: clamp$1(e.grainRoughness / 100, 0, 1),
        seed: ctx.seed
      }
    });
  }
  return [...stage("LinearWorking", linear), ...lookStage(look)];
}
function vignetteStyle(e, hdr, notes) {
  const exposure = { Exposure: { highlights: clamp$1(e.vignetteHighlights / 100, 0, 1) } };
  if (e.vignetteStyle !== "paint") return exposure;
  if (hdr) {
    notes.push(concepts.tk("Paint overlay needs an SDR picture; this HDR photo keeps highlight priority"));
    return exposure;
  }
  return "PaintOverlay";
}
function compile(r, ctx) {
  const notes = [];
  const oriented = orientedFrame(r, ctx.frameWidth, ctx.frameHeight);
  const crop = effectiveCrop(r, oriented.width, oriented.height);
  const layers = [];
  const layerIndex = {};
  const bw = r.treatment === "bw" || r.profile.kind === "monochrome";
  const masked = r.layers.some(
    (l) => layerMask(l, oriented.user, ctx.brushPaths, oriented) !== null
  );
  const finish = bw && masked ? [] : void 0;
  const base = settingsStages(r, r, r.geometry, ctx, crop, oriented, notes, finish);
  if (base.length > 0) {
    layers.push({
      name: "base",
      enabled: true,
      opacity: 1,
      mask: null,
      blend: { mode: "Normal", space: "LinearWorking" },
      stages: base
    });
  }
  for (const l of r.layers) {
    const mask = layerMask(l, oriented.user, ctx.brushPaths, oriented);
    if (!mask) continue;
    let stages = settingsStages(
      scaleSettings(l.settings, l.amount ?? 100),
      null,
      r.geometry,
      ctx,
      crop,
      oriented,
      notes
    );
    if (stages.length === 0)
      stages = [{ space: "LinearWorking", ops: [{ Primary: primary({ contrast_pivot: 0.18 }) }] }];
    layerIndex[l.id] = layers.length;
    layers.push({
      name: l.name,
      enabled: l.enabled,
      opacity: clamp$1(l.opacity / 100, 0, 1),
      mask,
      blend: blendFor(l.blend, ctx.hdr === true),
      stages
    });
  }
  if (finish && finish.length > 0) {
    layers.push({
      name: "black & white",
      enabled: true,
      opacity: 1,
      mask: null,
      blend: { mode: "Normal", space: "LinearWorking" },
      stages: lookStage(finish)
    });
  }
  for (const c of r.custom) {
    if (!c.layer || typeof c.layer !== "object") continue;
    layers.push({
      ...withLutDomains(c.layer),
      enabled: c.enabled && c.layer.enabled !== false
    });
  }
  const orientation = recipe.compose(ctx.sourceOrientation, oriented.user);
  const straighten = ctx.applyCrop ? round4(r.geometry.straighten) : 0;
  const shownCrop = ctx.applyCrop ? crop : null;
  const transform = ctx.showTransform === false ? null : recipe.uprightTransform(r.geometry.upright, oriented.width, oriented.height);
  const outside = transform && !ctx.applyCrop ? "Transparent" : straighten !== 0 || transform ? "Crop" : null;
  const framing = orientation === "Normal" && straighten === 0 && !shownCrop && !transform ? null : {
    orientation,
    rotate_degrees: round4(straighten),
    rotate_resampler: "Lanczos3",
    ...transform ? { transform } : {},
    // A rotation or warp leaves corners with no picture. The crop
    // already keeps clear of them; `Crop` only shrinks it should
    // rounding reach one, where `Refuse` would fail the render.
    ...outside ? { outside } : {},
    crop: shownCrop ? {
      x: round4(shownCrop.x),
      y: round4(shownCrop.y),
      width: round4(Math.min(shownCrop.width, 1 - round4(shownCrop.x))),
      height: round4(Math.min(shownCrop.height, 1 - round4(shownCrop.y)))
    } : null
  };
  return {
    grade: layers.length > 0 ? { layers } : null,
    framing,
    lens: recipe.lensCorrection(r.lens),
    retouch: compileRetouch(r.retouch, oriented.user, ctx.frameWidth, ctx.frameHeight),
    layerIndex,
    notes,
    orientedWidth: oriented.width,
    orientedHeight: oriented.height,
    crop
  };
}
function wbFromOp(op, to) {
  if (absoluteWb(to) && to.asShot) {
    const abs = absoluteFromOp(op, to.asShot);
    return {
      mode: "custom",
      temperature: Math.round(abs.kelvin),
      tint: Math.round(abs.tint * TINT_UNITS_PER_DUV),
      preset: null
    };
  }
  const rel = relativeFromOp(op);
  return {
    mode: "custom",
    temperature: Math.round(rel.temperature),
    tint: Math.round(rel.tint),
    preset: null
  };
}
function opOf(wb, ctx) {
  const op = baseWhite({ wb }, ctx);
  return op ? { kelvin: op.kelvin, tint: op.tint } : { kelvin: 6504, tint: 0 };
}
function convertWb(wb, from, to) {
  if (absoluteWb(from) === absoluteWb(to)) return wb;
  return wbFromOp(opOf(wb, from), to);
}
function convertAsShot(wb, from, to) {
  if (wb.mode !== "custom") return wb;
  if (absoluteWb(from) !== absoluteWb(to)) return convertWb(wb, from, to);
  if (!absoluteWb(to)) return wb;
  return { ...wbFromOp(opOf(wb, from), to), preset: wb.preset };
}
function wbFromSaved(wb, saved, to) {
  if (saved.absolute === absoluteWb(to)) return wb;
  return { ...wbFromOp(saved, to), preset: wb.preset };
}
function normaliseKeyword(path2) {
  return path2.split("|").map((s) => s.trim()).filter((s) => s !== "").join("|");
}
function normaliseKeywords(paths) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const p of paths) {
    const k = normaliseKeyword(p);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
function keywordPrefixes(path2) {
  const levels = path2.split("|");
  return levels.map((_, i) => levels.slice(0, i + 1).join("|"));
}
const isUnder = (path2, under) => path2 === under || path2.startsWith(under + "|");
function flatSubjects(paths) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const p of paths) {
    for (const name of p.split("|")) {
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}
function planeRef(png) {
  return crypto.createHash("sha256").update(Buffer.from(png, "base64")).digest("hex");
}
function slim(r, known) {
  return recipe.slimRecipe(r, planeRef, known);
}
function pngSize(bytes) {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}
function renameRefs(json, names) {
  if (names.size === 0 || !json.includes('"ref":"')) return json;
  return json.replace(/"ref":"([^"]+)"/g, (whole, ref) => {
    const to = names.get(ref);
    return to ? `"ref":"${to}"` : whole;
  });
}
const SCHEME = "pixl";
function cacheUrlIn(root, file, version) {
  const rel = path.relative(root, file).split(path.sep).map(encodeURIComponent).join("/");
  return `${SCHEME}://c/${rel}?v=${encodeURIComponent(String(version))}`;
}
const isObj$1 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function isEntityList(path2) {
  if (path2.length === 1)
    return path2[0] === "layers" || path2[0] === "custom" || path2[0] === "pointColors" || path2[0] === "retouch" || path2[0] === "pixels";
  if (path2[0] !== "layers" || typeof path2[1] === "string") return false;
  return path2.length === 3 && path2[2] === "components" || path2.length === 4 && path2[2] === "settings" && path2[3] === "pointColors";
}
const idsOf = (list) => list.map((x) => isObj$1(x) && typeof x.id === "string" ? x.id : "");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function diffInto(a, b, path2, out) {
  if (isEntityList(path2) && Array.isArray(a) && Array.isArray(b)) {
    const beforeIds = idsOf(a);
    const before = new Map(a.map((x, i) => [beforeIds[i], x]));
    const afterIds = idsOf(b);
    for (const id of before.keys()) {
      if (!afterIds.includes(id)) out.push({ path: [...path2, { id }], del: true });
    }
    b.forEach((x, i) => {
      const id = afterIds[i];
      if (before.has(id)) diffInto(before.get(id), x, [...path2, { id }], out);
      else out.push({ path: [...path2, { id }], value: structuredClone(x) });
    });
    const kept = beforeIds.filter((id) => afterIds.includes(id));
    const expected = [...kept, ...afterIds.filter((id) => !before.has(id))];
    if (!same(expected, afterIds)) out.push({ path: path2, order: afterIds });
    return;
  }
  if (isObj$1(a) && isObj$1(b)) {
    for (const k of Object.keys(a)) if (!(k in b)) out.push({ path: [...path2, k], del: true });
    for (const k of Object.keys(b)) {
      if (!(k in a)) out.push({ path: [...path2, k], value: structuredClone(b[k]) });
      else diffInto(a[k], b[k], [...path2, k], out);
    }
    return;
  }
  if (!same(a, b)) out.push({ path: path2, value: structuredClone(b) });
}
function diffRecipe(a, b) {
  const out = [];
  diffInto(a, b, [], out);
  return out;
}
function child(node, seg) {
  if (typeof seg === "string") return isObj$1(node) ? node[seg] : void 0;
  return Array.isArray(node) ? node.find((x) => isObj$1(x) && x.id === seg.id) : void 0;
}
function applyOp(root, op) {
  if ("order" in op) {
    const list = op.path.reduce(child, root);
    if (!Array.isArray(list)) return;
    const rank = new Map(op.order.map((id, i) => [id, i]));
    const ranked = list.filter((x) => rank.has(idsOf([x])[0]));
    ranked.sort((x, y) => rank.get(idsOf([x])[0]) - rank.get(idsOf([y])[0]));
    const rest = list.filter((x) => !rank.has(idsOf([x])[0]));
    list.splice(0, list.length, ...ranked, ...rest);
    return;
  }
  if (op.path.length === 0) return;
  const parent = op.path.slice(0, -1).reduce(child, root);
  const last = op.path[op.path.length - 1];
  if (typeof last === "string") {
    if (!isObj$1(parent)) return;
    if ("del" in op) delete parent[last];
    else parent[last] = structuredClone(op.value);
    return;
  }
  if (!Array.isArray(parent)) return;
  const at = parent.findIndex((x) => isObj$1(x) && x.id === last.id);
  if ("del" in op) {
    if (at >= 0) parent.splice(at, 1);
  } else if (at >= 0) parent[at] = structuredClone(op.value);
  else parent.push(structuredClone(op.value));
}
function replay(base, steps) {
  const out = structuredClone(base);
  for (const s of steps) if (!s.hidden) for (const op of s.patch) applyOp(out, op);
  return out;
}
const HISTORY_LIMIT = 200;
const KEYFRAME_EVERY = 25;
const HISTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS history (
  item_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  label TEXT NOT NULL,
  at TEXT NOT NULL,
  recipe TEXT NOT NULL,
  patch TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_key, seq)
);
`;
class HistoryTable {
  db;
  constructor(db) {
    this.db = db;
  }
  rows(itemKey) {
    return this.db.prepare(
      "SELECT seq, label, at, recipe, patch, hidden FROM history WHERE item_key = ? ORDER BY seq"
    ).all(itemKey);
  }
  /** Every item that has a history here. */
  keys() {
    return this.db.prepare("SELECT DISTINCT item_key FROM history").all().map((r) => r.item_key);
  }
  /** Put rows taken from another table under `itemKey` (after any already there are gone). */
  insertRows(itemKey, rows) {
    const st = this.db.prepare(
      "INSERT OR REPLACE INTO history(item_key, seq, label, at, recipe, patch, hidden) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    this.db.tx(() => {
      for (const r of rows) st.run(itemKey, r.seq, r.label, r.at, r.recipe, r.patch, r.hidden);
    });
  }
  /** Forget an item's history. */
  remove(itemKey) {
    this.db.prepare("DELETE FROM history WHERE item_key = ?").run(itemKey);
  }
  /**
   * An item's history as its base and steps. Rows written before history
   * became steps hold whole recipes; they are turned into patches here, once.
   */
  history(itemKey) {
    const rows = this.rows(itemKey);
    if (rows.length === 0) return { base: null, steps: [] };
    if (rows.slice(1).some((r) => r.patch === null)) return this.db.tx(() => this.convert(itemKey));
    return this.logOf(rows);
  }
  /** Rows from before history became steps, turned into patches (once), and the log. */
  convert(itemKey) {
    const rows = this.rows(itemKey);
    const [first, ...rest] = rows;
    if (!first) return { base: null, steps: [] };
    const update = this.db.prepare(
      "UPDATE history SET patch = ?, recipe = '' WHERE item_key = ? AND seq = ?"
    );
    let prev = JSON.parse(first.recipe);
    for (const r of rest) {
      if (r.patch !== null) continue;
      const cur = JSON.parse(r.recipe);
      r.patch = JSON.stringify(diffRecipe(prev, cur));
      update.run(r.patch, itemKey, r.seq);
      prev = cur;
    }
    return this.logOf(rows);
  }
  /** The log, and its head: the latest keyframe with the steps after it replayed. */
  logOf(rows) {
    const [first, ...rest] = rows;
    const base = {
      seq: first.seq,
      label: first.label,
      at: first.at,
      recipe: JSON.parse(first.recipe)
    };
    const steps = rest.map((r) => ({
      seq: r.seq,
      label: r.label,
      at: r.at,
      patch: JSON.parse(r.patch ?? "[]"),
      hidden: r.hidden !== 0
    }));
    const k = rest.findLastIndex((r) => r.patch !== null && r.recipe !== "");
    const head = k < 0 ? replay(base.recipe, steps) : replay(JSON.parse(rest[k].recipe), steps.slice(k + 1));
    return { base, steps, head };
  }
  /** The base row, as stored. */
  baseRow(itemKey) {
    return this.db.prepare(
      "SELECT seq, label, at, recipe, patch, hidden FROM history WHERE item_key = ? ORDER BY seq LIMIT 1"
    ).get(itemKey);
  }
  /** Steps from before history became steps (whole recipes), turned into patches. */
  ensureSteps(itemKey) {
    const old = this.db.prepare("SELECT COUNT(*) AS n FROM history WHERE item_key = ? AND patch IS NULL").get(itemKey);
    if (old.n > 1) this.convert(itemKey);
  }
  /**
   * The recipe the history describes (null without a base): the latest
   * keyframe and the steps after it, else the base and every step. With
   * `rebuild` (inside a write), keyframes missing along the way are written.
   */
  head(itemKey, rebuild = false) {
    const base = this.baseRow(itemKey);
    if (!base) return null;
    const key = this.db.prepare(
      `SELECT seq, recipe FROM history WHERE item_key = ? AND patch IS NOT NULL AND recipe <> ''
         ORDER BY seq DESC LIMIT 1`
    ).get(itemKey);
    const from = key ?? { seq: base.seq, recipe: base.recipe };
    const rows = this.db.prepare("SELECT seq, patch, hidden FROM history WHERE item_key = ? AND seq > ? ORDER BY seq").all(itemKey, from.seq);
    let recipe2 = JSON.parse(from.recipe);
    if (rows.length === 0) return recipe2;
    const mark = rebuild ? this.db.prepare("UPDATE history SET recipe = ? WHERE item_key = ? AND seq = ?") : null;
    let since = key ? 0 : this.stepsBefore(itemKey, from.seq);
    const pending = [];
    for (const r of rows) {
      pending.push({
        seq: r.seq,
        label: "",
        at: "",
        patch: JSON.parse(r.patch ?? "[]"),
        hidden: r.hidden !== 0
      });
      if (mark && ++since >= KEYFRAME_EVERY) {
        recipe2 = replay(recipe2, pending);
        pending.length = 0;
        since = 0;
        mark.run(JSON.stringify(recipe2), itemKey, r.seq);
      }
    }
    return pending.length > 0 ? replay(recipe2, pending) : recipe2;
  }
  /** How many steps there are up to `seq` (0 from the base). */
  stepsBefore(itemKey, seq) {
    return this.db.prepare(
      "SELECT COUNT(*) AS n FROM history WHERE item_key = ? AND seq <= ? AND patch IS NOT NULL"
    ).get(itemKey, seq).n;
  }
  /**
   * Record a settled edit: the first becomes the base, every later one a
   * step holding what changed against the history's current recipe. An edit
   * that changed nothing records nothing. Returns what changed, not the
   * whole history (`appendToLog` lays it on one): the step, and when the
   * oldest steps folded into the base, the new base and the folded steps.
   */
  append(itemKey, label, recipe2) {
    return this.db.tx(() => {
      this.ensureSteps(itemKey);
      const at = (/* @__PURE__ */ new Date()).toISOString();
      const insert = this.db.prepare(
        "INSERT INTO history(item_key, seq, label, at, recipe, patch, hidden) VALUES (?, ?, ?, ?, ?, ?, 0)"
      );
      const head = this.head(itemKey, true);
      if (!head) {
        const json2 = JSON.stringify(recipe2);
        insert.run(itemKey, 1, label, at, json2, null);
        const base = { seq: 1, label, at, recipe: JSON.parse(json2) };
        return { base, step: null, folded: [] };
      }
      const patch = diffRecipe(head, recipe2);
      if (patch.length === 0) return { base: null, step: null, folded: [] };
      const last = this.db.prepare("SELECT MAX(seq) AS seq FROM history WHERE item_key = ?").get(itemKey);
      const seq = last.seq + 1;
      const json = JSON.stringify(patch);
      const step = { seq, label, at, patch: JSON.parse(json), hidden: false };
      const keyed = this.db.prepare(
        `SELECT COUNT(*) AS n FROM history WHERE item_key = ? AND patch IS NOT NULL AND seq > COALESCE(
             (SELECT MAX(seq) FROM history WHERE item_key = ? AND patch IS NOT NULL AND recipe <> ''), 0)`
      ).get(itemKey, itemKey);
      const keyframe = keyed.n + 1 >= KEYFRAME_EVERY ? JSON.stringify(replay(head, [step])) : "";
      insert.run(itemKey, seq, label, at, keyframe, json);
      return { ...this.fold(itemKey), step };
    });
  }
  /**
   * Rewrite the newest step, `seq`, so the history ends at `recipe`: a
   * look's Amount and a look swapped for another stay the one step they
   * were. Refused (null) unless `seq` is still the newest step and shown;
   * the caller records a new step instead. A step left changing nothing is
   * deleted (`step` null).
   */
  amendLast(itemKey, seq, label, recipe2) {
    return this.db.tx(() => {
      this.ensureSteps(itemKey);
      const last = this.db.prepare(
        "SELECT seq, recipe, patch, hidden FROM history WHERE item_key = ? ORDER BY seq DESC LIMIT 1"
      ).get(itemKey);
      if (!last || last.seq !== seq || last.patch === null || last.hidden !== 0) return null;
      this.db.prepare("DELETE FROM history WHERE item_key = ? AND seq = ?").run(itemKey, seq);
      const head = this.head(itemKey);
      if (!head) return null;
      const patch = diffRecipe(head, recipe2);
      if (patch.length === 0) return { seq, step: null };
      const at = (/* @__PURE__ */ new Date()).toISOString();
      const json = JSON.stringify(patch);
      const step = { seq, label, at, patch: JSON.parse(json), hidden: false };
      const keyframe = last.recipe !== "" ? JSON.stringify(replay(head, [step])) : "";
      this.db.prepare(
        "INSERT INTO history(item_key, seq, label, at, recipe, patch, hidden) VALUES (?, ?, ?, ?, ?, ?, 0)"
      ).run(itemKey, seq, label, at, keyframe, json);
      return { seq, step };
    });
  }
  /** Past the limit, the oldest steps fold into the base (a hidden one is dropped). */
  fold(itemKey) {
    const count = this.db.prepare("SELECT COUNT(*) AS n FROM history WHERE item_key = ?").get(itemKey);
    const excess = count.n - HISTORY_LIMIT;
    const first = this.baseRow(itemKey);
    if (!first || excess <= 0) return { base: null, folded: [] };
    const old = this.db.prepare(
      "SELECT seq, patch, hidden FROM history WHERE item_key = ? AND seq > ? ORDER BY seq LIMIT ?"
    ).all(itemKey, first.seq, excess);
    const recipe2 = replay(
      JSON.parse(first.recipe),
      old.map((r) => ({
        seq: r.seq,
        label: "",
        at: "",
        patch: JSON.parse(r.patch ?? "[]"),
        hidden: r.hidden !== 0
      }))
    );
    const json = JSON.stringify(recipe2);
    this.db.prepare("UPDATE history SET recipe = ? WHERE item_key = ? AND seq = ?").run(json, itemKey, first.seq);
    this.db.prepare("DELETE FROM history WHERE item_key = ? AND seq > ? AND seq <= ?").run(itemKey, first.seq, old[old.length - 1].seq);
    return {
      base: {
        seq: first.seq,
        label: first.label,
        at: first.at,
        recipe: JSON.parse(json)
      },
      folded: old.map((r) => r.seq)
    };
  }
  /** Keyframes from `seq` on no longer describe the history (a step at `seq` changed). */
  dropKeyframes(itemKey, seq) {
    this.db.prepare(
      "UPDATE history SET recipe = '' WHERE item_key = ? AND seq >= ? AND patch IS NOT NULL AND recipe <> ''"
    ).run(itemKey, seq);
  }
  /** The history and the recipe it now describes, its keyframes rebuilt first. */
  logAndHead(itemKey) {
    this.head(itemKey, true);
    return this.history(itemKey);
  }
  /** Hide or show steps (never the base). */
  setHidden(itemKey, seqs, hidden) {
    return this.db.tx(() => {
      this.ensureSteps(itemKey);
      const st = this.db.prepare(
        "UPDATE history SET hidden = ? WHERE item_key = ? AND seq = ? AND patch IS NOT NULL"
      );
      for (const seq of seqs) st.run(hidden ? 1 : 0, itemKey, seq);
      if (seqs.length > 0) this.dropKeyframes(itemKey, Math.min(...seqs));
      return this.logAndHead(itemKey);
    });
  }
  /** Delete steps (never the base). */
  delete(itemKey, seqs) {
    return this.db.tx(() => {
      this.ensureSteps(itemKey);
      const st = this.db.prepare(
        "DELETE FROM history WHERE item_key = ? AND seq = ? AND patch IS NOT NULL"
      );
      for (const seq of seqs) st.run(itemKey, seq);
      if (seqs.length > 0) this.dropKeyframes(itemKey, Math.min(...seqs));
      return this.logAndHead(itemKey);
    });
  }
  /** Every stored recipe and patch, as JSON: what may name a plane by reference. */
  *json() {
    const rows = this.db.prepare(
      `SELECT recipe || ' ' || COALESCE(patch, '') AS json FROM history
         WHERE recipe LIKE '%"ref":%' OR patch LIKE '%"ref":%'`
    ).iterate();
    for (const r of rows) yield r.json;
  }
}
const SKY_BY_CLICK = false;
const SCENE_TARGETS = ["sky", "vegetation", "water"];
const PART_TARGETS = ["face", "hair", "skin", "clothes"];
const PHRASE_MODELS = ["sam3", "efficientsam3-ev-m"];
const OFFERED_PHRASE_MODEL = PHRASE_MODELS[1];
const SCENE_MODEL = "dinov2-s-ade";
const PARTS_MODEL = "selfie-multiclass";
const isSceneTarget = (t) => SCENE_TARGETS.includes(t);
const isPartTarget = (t) => PART_TARGETS.includes(t);
function segmentModel(target, fine = false) {
  if (target === "depth") return DEPTH_MODEL;
  if (recipe.isFacePart(target)) return recipe.FACE_LANDMARKER;
  if (target === "phrase") return OFFERED_PHRASE_MODEL;
  if (isSceneTarget(target)) return SCENE_MODEL;
  if (isPartTarget(target)) return PARTS_MODEL;
  return fine ? FINE_SUBJECT_MODEL : "u2netp";
}
const FINE_SUBJECT_MODEL = "birefnet-lite";
const DEPTH_MODEL = "depth-anything-v2-small";
const SEGMENT_LABEL = {
  subject: concepts.tk("Subject"),
  sky: concepts.tk("Sky"),
  vegetation: concepts.tk("Vegetation"),
  water: concepts.tk("Water"),
  background: concepts.tk("Background"),
  depth: concepts.tk("Depth range"),
  face: concepts.tk("Face"),
  hair: concepts.tk("Hair"),
  skin: concepts.tk("Skin"),
  clothes: concepts.tk("Clothes"),
  ...recipe.FACE_PART_LABEL,
  phrase: concepts.tk("Find by name")
};
function overallProgress(stages, stage2, p) {
  const total = stages.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return 0;
  let done = 0;
  for (const s of stages) {
    if (s.id === stage2) return Math.min(1, (done + s.weight * Math.min(1, Math.max(0, p))) / total);
    done += s.weight;
  }
  return Math.min(1, done / total);
}
function estimate(elapsedMs, expectedMs) {
  if (expectedMs <= 0) return 0;
  const t = Math.max(0, elapsedMs) / expectedMs;
  return 0.95 * (1 - Math.exp(-2.2 * t));
}
function toStart(jobs, busy, laneOf) {
  const taken = new Set(busy);
  const out = [];
  for (const j of runOrder(jobs)) {
    if (j.phase !== "queued") continue;
    const lane = laneOf(j);
    if (taken.has(lane)) continue;
    taken.add(lane);
    out.push(j);
  }
  return out;
}
function runOrder(jobs) {
  const live = jobs.filter((j) => j.phase === "running" || j.phase === "queued");
  return live.sort((a, b) => a.phase !== b.phase ? a.phase === "running" ? -1 : 1 : a.at - b.at);
}
const BIPOLAR = [-100, 100];
const UNIT = [0, 100];
const HUE = [0, 360];
const LOOK_RANGES = [
  ["basic.*", BIPOLAR],
  ["presence.*", BIPOLAR],
  ["toneCurve.highlights", BIPOLAR],
  ["toneCurve.lights", BIPOLAR],
  ["toneCurve.darks", BIPOLAR],
  ["toneCurve.shadows", BIPOLAR],
  ["toneCurve.refineSaturation", UNIT],
  ["hsl.*.*", BIPOLAR],
  ["bwMix.*", BIPOLAR],
  ["colorGrade.*.hue", HUE],
  ["colorGrade.*.saturation", UNIT],
  ["colorGrade.*.luminance", BIPOLAR],
  ["colorGrade.add.amount", UNIT],
  ["colorGrade.blending", UNIT],
  ["colorGrade.balance", BIPOLAR],
  ["effects.vignetteAmount", BIPOLAR],
  ["effects.vignetteRoundness", BIPOLAR],
  ["effects.vignetteMidpoint", UNIT],
  ["effects.vignetteFeather", UNIT],
  ["effects.vignetteHighlights", UNIT],
  ["effects.wash.hue", HUE],
  ["effects.wash.saturation", UNIT],
  ["effects.wash.amount", UNIT],
  ["effects.grainAmount", UNIT],
  ["effects.grainSize", UNIT],
  ["effects.grainRoughness", UNIT],
  ["calibration.*", BIPOLAR]
];
function matches(pattern, path2) {
  const parts = pattern.split(".");
  return parts.length === path2.length && parts.every((p, i) => p === "*" || p === path2[i]);
}
function rangeOf(path2) {
  for (const [pattern, range] of LOOK_RANGES) if (matches(pattern, path2)) return range;
  return null;
}
const PERSON_PARTS = [
  "skin",
  "face",
  "hair",
  "eyes",
  "brows",
  "lips",
  "teeth",
  "clothes",
  "body"
];
function smartReadiness(b) {
  if (b.off) {
    const r = smartReadiness({ ...b, off: false });
    for (const k of Object.keys(r)) if (!IMMEDIATE_KEYS.has(k)) r[k] = "off";
    return r;
  }
  const model = (installed) => !b.models ? "needs-engine" : installed ? "ready" : "needs-model";
  const sam = !(b.models && b.engine.sam2) ? "needs-engine" : b.samModel ? "ready" : "needs-model";
  return {
    range: "ready",
    linear: "ready",
    bidirectional: "ready",
    radial: "ready",
    subject: model(b.subjectModel),
    background: model(b.subjectModel),
    // The scene model finds it (engine 0.19); before, the user clicked the sky for SAM 2.1.
    sky: b.engine.sky ? model(b.sceneModel === true) : "needs-engine",
    vegetation: b.engine.sky ? model(b.sceneModel === true) : "needs-engine",
    water: b.engine.sky ? model(b.sceneModel === true) : "needs-engine",
    person: b.engine.people ? model(b.partsModel === true) : "needs-engine",
    personDetail: b.engine.faces ? model(b.faceModels === true) : "needs-engine",
    body: "needs-engine",
    // By its name: the detector and SAM 2.1 (still to come), or a phrase model.
    object: b.engine.detector ? sam : b.engine.phrase ? model(b.phraseModel === true) : "needs-engine",
    pick: sam,
    drunet: model(b.drunetModel),
    nafnet: b.engine.nafnet ? model(b.nafnetModel === true) : "needs-engine",
    deblur: b.enhance ? "ready" : "needs-engine"
  };
}
const IMMEDIATE_KEYS = /* @__PURE__ */ new Set(["range", "linear", "bidirectional", "radial"]);
function whyNot(r) {
  if (r === "off") return concepts.t("AI models are off: turn them on in Settings → AI models");
  return r === "needs-model" ? concepts.t("needs a model: download it in Settings → AI models") : concepts.t("needs the next engine update");
}
const IMMEDIATE = /* @__PURE__ */ new Set(["range", "linear", "bidirectional", "radial"]);
function partNeed(tg, r) {
  if (tg.kind === "object") {
    if (r.object === "ready") return { key: "object", ready: true };
    return { key: "pick", ready: r.pick === "ready" };
  }
  if (tg.kind === "person" && tg.part === "body") return { key: "body", ready: false };
  if (tg.kind === "person" && !MODEL_PARTS.includes(tg.part))
    return { key: "personDetail", ready: r.personDetail === "ready" };
  return { key: tg.kind, ready: r[tg.kind] === "ready" };
}
const MODEL_PARTS = ["face", "hair", "skin", "clothes"];
function denoiseModel(m, r) {
  if (m === "nafnet") return r.nafnet === "ready" ? "nafnet" : null;
  if (m === "drunet") return r.drunet === "ready" ? "drunet" : null;
  return r.nafnet === "ready" ? "nafnet" : r.drunet === "ready" ? "drunet" : null;
}
const SMART_RATES = {
  /** Per run, whatever the photo's size (the models work on a proxy). */
  segmentMs: 1500,
  personMs: 2500,
  detectMs: 900,
  sam2Ms: 1200,
  /** Per megapixel of the full-resolution step. */
  drunetMsPerMp: 9e3,
  nafnetMsPerMp: 1200,
  deblurMsPerMp: 6e3
};
const ADJUST_ROOTS = ["basic", "presence", "toneCurve", "hsl", "colorGrade"];
const ADJUST_EXTRA = {
  "basic.exposure": [-5, 5],
  "wb.temperature": [-100, 100],
  "wb.tint": [-100, 100]
};
function adjustRange(path2) {
  if (ADJUST_EXTRA[path2]) return ADJUST_EXTRA[path2];
  const parts = path2.split(".");
  if (!ADJUST_ROOTS.includes(parts[0])) return null;
  return rangeOf(parts);
}
function applyAdjust(settings, adjust) {
  for (const [path2, value] of Object.entries(adjust)) {
    const range = adjustRange(path2);
    if (!range || !Number.isFinite(value)) continue;
    const keys = path2.split(".");
    let node = settings;
    for (const k of keys.slice(0, -1)) {
      const next = node[k];
      if (typeof next !== "object" || next === null) {
        node = {};
        break;
      }
      node = next;
    }
    const last = keys[keys.length - 1];
    if (typeof node[last] !== "number") continue;
    node[last] = Math.min(range[1], Math.max(range[0], value));
    if (keys[0] === "wb") settings.wb.mode = "custom";
  }
}
function componentOf(part, feather, plane) {
  const base = {
    id: recipe.newId(),
    mode: part.mode,
    opacity: 100,
    invert: part.invert ?? false,
    feather
  };
  const tg = part.target;
  if (tg.kind === "range")
    return {
      ...base,
      kind: "range",
      hue: tg.hue ?? null,
      saturation: tg.saturation ?? null,
      luma: tg.luma ?? null,
      smoothness: tg.smoothness ?? 0
    };
  if (tg.kind === "linear")
    return { ...base, kind: "linear", start: { ...tg.start }, end: { ...tg.end }, ...plane };
  if (tg.kind === "bidirectional")
    return {
      ...base,
      kind: "bidirectional",
      start: { ...tg.start },
      end: { ...tg.end },
      centre: tg.centre ?? 0.5,
      ...plane
    };
  if (tg.kind === "radial")
    return {
      ...base,
      kind: "radial",
      centre: { ...tg.centre },
      radiusX: tg.radiusX,
      radiusY: tg.radiusY,
      angle: tg.angle ?? 0,
      softness: tg.softness ?? 50,
      ...plane
    };
  throw new Error(`not a component: ${tg.kind}`);
}
const DENOISE_NAME = { drunet: "DRUNet", nafnet: "NAFNet" };
function planSmart(smart, ready, photo) {
  const rates = { ...SMART_RATES, ...photo.rates };
  const mp = photo.frameWidth * photo.frameHeight / 1e6;
  const plane = gradients.gradientPlaneSize(photo.frameWidth, photo.frameHeight);
  const plan = {
    layers: [],
    ops: [],
    picks: 0,
    skipped: [],
    complete: true,
    etaMs: 0,
    summary: []
  };
  const made = /* @__PURE__ */ new Map();
  for (const m of smart.masks) {
    const missing = m.parts.map((p) => partNeed(p.target, ready)).filter((n) => !n.ready).map((n) => whyNot(ready[n.key]));
    if (missing.length > 0) {
      plan.skipped.push({ name: concepts.t(m.name), why: missing[0] });
      if (m.required) plan.complete = false;
      continue;
    }
    const layer = recipe.newLocalLayer(concepts.t(m.name));
    applyAdjust(layer.settings, m.adjust);
    layer.amount = Math.min(200, Math.max(0, m.amount ?? 100));
    const feather = m.feather ?? 5;
    made.set(m.id, layer.id);
    plan.summary.push(concepts.t("{{name}} mask", { name: concepts.t(m.name) }));
    if (m.parts.every((p) => IMMEDIATE.has(p.target.kind))) {
      layer.components = m.parts.map((p) => componentOf(p, feather, plane));
      plan.layers.push(layer);
      continue;
    }
    layer.enabled = false;
    plan.layers.push(layer);
    for (const p of m.parts) {
      const tg = p.target;
      const at = { layerId: layer.id, mask: m.id, mode: p.mode, invert: p.invert ?? false };
      if (IMMEDIATE.has(tg.kind)) {
        plan.ops.push({
          kind: "component",
          layerId: layer.id,
          mask: m.id,
          component: componentOf(p, feather, plane)
        });
      } else if (tg.kind === "sky" && SKY_BY_CLICK) ;
      else if (tg.kind === "subject" || tg.kind === "background" || tg.kind === "sky" || tg.kind === "vegetation" || tg.kind === "water") {
        plan.ops.push({ kind: "segment", ...at, target: tg.kind });
        plan.etaMs += rates.segmentMs;
      } else if (tg.kind === "person") {
        plan.ops.push({ kind: "person", ...at, part: tg.part });
        plan.etaMs += rates.personMs;
      } else if (tg.kind === "object") {
        const detect = ready.object === "ready";
        plan.ops.push({ kind: "object", ...at, label: tg.label, detect });
        plan.etaMs += (detect ? rates.detectMs : 0) + rates.sam2Ms;
        if (!detect) plan.picks++;
      }
    }
    plan.ops.push({ kind: "enable", layerId: layer.id, mask: m.id });
  }
  for (const s of smart.steps) {
    const name = s.kind === "denoise" ? concepts.t("AI denoise") : concepts.t("AI deblur");
    let layerId = null;
    if (s.scope !== void 0) {
      const id = made.get(s.scope);
      if (!id) {
        plan.skipped.push({ name, why: concepts.t("its mask could not be made") });
        continue;
      }
      layerId = id;
    }
    const strength = Math.min(100, Math.max(1, s.strength));
    if (s.kind === "denoise") {
      const model = denoiseModel(s.model, ready);
      if (!model) {
        const want = s.model === "nafnet" ? ready.nafnet : ready.drunet;
        plan.skipped.push({ name, why: whyNot(want) });
        continue;
      }
      plan.ops.push({ kind: "denoise", model, strength, layerId });
      plan.etaMs += mp * (model === "nafnet" ? rates.nafnetMsPerMp : rates.drunetMsPerMp);
      plan.summary.push(concepts.t("AI denoise ({{model}})", { model: DENOISE_NAME[model] }));
    } else {
      if (ready.deblur !== "ready") {
        plan.skipped.push({ name, why: whyNot(ready.deblur) });
        continue;
      }
      plan.ops.push({ kind: "deblur", strength, layerId });
      plan.etaMs += mp * rates.deblurMsPerMp;
      plan.summary.push(concepts.t("AI deblur (NAFNet)"));
    }
  }
  plan.etaMs = Math.round(plan.etaMs);
  return plan;
}
const NO_MODELS = smartReadiness({
  models: false,
  subjectModel: false,
  drunetModel: false,
  enhance: false,
  engine: { sky: false, people: false, sam2: false, detector: false, nafnet: false }
});
function immediateLayers(smart, photo) {
  return planSmart(smart, NO_MODELS, photo).layers.filter((l) => l.enabled);
}
function previewLayers(lookId, layers) {
  return layers.map((l, i) => ({
    ...l,
    id: `${lookId}:${i}`,
    components: l.components.map((c, j) => ({ ...c, id: `${lookId}:${i}:${j}` }))
  }));
}
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const MODES = ["Add", "Subtract", "Intersect"];
const MAX_MASKS = 8;
const MAX_PARTS = 6;
const MAX_STEPS = 4;
function band(v, hue) {
  if (!isObj(v) || !num(v.centre) || !num(v.width) || !num(v.softness)) return void 0;
  const top = hue ? 360 : 1;
  return {
    centre: clamp(v.centre, 0, top),
    width: clamp(v.width, 0, top),
    softness: clamp(v.softness, 0, top)
  };
}
const point = (v) => isObj(v) && num(v.x) && num(v.y) ? { x: clamp(v.x, -1, 2), y: clamp(v.y, -1, 2) } : void 0;
function targetOf(v) {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case "range": {
      const tg = { kind: "range" };
      const h = band(v.hue, true);
      const s = band(v.saturation, false);
      const l = band(v.luma, false);
      if (h) tg.hue = h;
      if (s) tg.saturation = s;
      if (l) tg.luma = l;
      if (!h && !s && !l) return null;
      if (num(v.smoothness)) tg.smoothness = clamp(v.smoothness, 0, 100);
      return tg;
    }
    case "linear": {
      const start = point(v.start);
      const end = point(v.end);
      return start && end ? { kind: "linear", start, end } : null;
    }
    case "bidirectional": {
      const start = point(v.start);
      const end = point(v.end);
      if (!start || !end) return null;
      return {
        kind: "bidirectional",
        start,
        end,
        ...num(v.centre) ? { centre: clamp(v.centre, 0.02, 0.98) } : {}
      };
    }
    case "radial": {
      const centre = point(v.centre);
      if (!centre || !num(v.radiusX) || !num(v.radiusY)) return null;
      return {
        kind: "radial",
        centre,
        radiusX: clamp(v.radiusX, 1e-3, 4),
        radiusY: clamp(v.radiusY, 1e-3, 4),
        angle: num(v.angle) ? v.angle % 360 : 0,
        softness: num(v.softness) ? clamp(v.softness, 0, 100) : 50
      };
    }
    case "subject":
    case "background":
    case "sky":
    case "vegetation":
    case "water":
      return { kind: v.kind };
    case "person":
      return PERSON_PARTS.includes(v.part) ? { kind: "person", part: v.part } : null;
    case "object": {
      const label = typeof v.label === "string" ? v.label.trim().toLowerCase().slice(0, 40) : "";
      return label ? { kind: "object", label } : null;
    }
    default:
      return null;
  }
}
function readSmart(raw) {
  const dropped = [];
  if (!isObj(raw)) return { smart: null, dropped };
  const masks = [];
  const rawMasks = Array.isArray(raw.masks) ? raw.masks.slice(0, MAX_MASKS) : [];
  for (const [i, m] of rawMasks.entries()) {
    if (!isObj(m)) {
      dropped.push(`masks.${i}`);
      continue;
    }
    const id = typeof m.id === "string" && m.id ? m.id.slice(0, 40) : `m${i}`;
    const name = typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 40) : "Mask";
    const parts = [];
    const rawParts = Array.isArray(m.parts) ? m.parts.slice(0, MAX_PARTS) : [];
    for (const [j, p] of rawParts.entries()) {
      const target = isObj(p) ? targetOf(p.target) : null;
      if (!target || !isObj(p)) {
        dropped.push(`masks.${i}.parts.${j}`);
        continue;
      }
      const mode = parts.length === 0 ? "Add" : MODES.includes(p.mode) ? p.mode : "Add";
      parts.push({ target, mode, ...p.invert === true ? { invert: true } : {} });
    }
    if (parts.length === 0 || masks.some((x) => x.id === id)) {
      dropped.push(`masks.${i}`);
      continue;
    }
    const adjust = {};
    if (isObj(m.adjust))
      for (const [path2, v] of Object.entries(m.adjust)) {
        const range = adjustRange(path2);
        if (!range || !num(v)) {
          dropped.push(`masks.${i}.adjust.${path2}`);
          continue;
        }
        adjust[path2] = clamp(v, range[0], range[1]);
      }
    const out = { id, name, parts, adjust };
    if (num(m.feather)) out.feather = clamp(m.feather, 0, 100);
    if (num(m.amount)) out.amount = clamp(m.amount, 0, 200);
    if (m.required === true) out.required = true;
    masks.push(out);
  }
  const steps = [];
  const rawSteps = Array.isArray(raw.steps) ? raw.steps.slice(0, MAX_STEPS) : [];
  for (const [i, s] of rawSteps.entries()) {
    if (!isObj(s) || !num(s.strength)) {
      dropped.push(`steps.${i}`);
      continue;
    }
    const scope = typeof s.scope === "string" ? s.scope : void 0;
    if (scope !== void 0 && !masks.some((m) => m.id === scope)) {
      dropped.push(`steps.${i}`);
      continue;
    }
    const strength = clamp(s.strength, 1, 100);
    const scoped = scope !== void 0 ? { scope } : {};
    if (s.kind === "denoise") {
      const model = ["auto", "drunet", "nafnet"].find((x) => x === s.model) ?? "auto";
      steps.push({ kind: "denoise", model, strength, ...scoped });
    } else if (s.kind === "deblur") steps.push({ kind: "deblur", strength, ...scoped });
    else dropped.push(`steps.${i}`);
  }
  if (masks.length === 0 && steps.length === 0) return { smart: null, dropped };
  return { smart: { masks, steps }, dropped };
}
function parseKey(key) {
  const [id, copy] = key.split(":");
  return { photoId: Number(id), copyId: copy ?? null };
}
function keyOf(photoId, copyId) {
  return copyId === null ? String(photoId) : `${photoId}:${copyId}`;
}
const PIXL_EXT = ".pixl";
const PIXL_APPLICATION_ID = 1346984012;
const PIXL_FORMAT_VERSION = 2;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS origin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime REAL NOT NULL,
  path TEXT NOT NULL,
  is_raw INTEGER NOT NULL,
  sha1 TEXT
);
CREATE TABLE IF NOT EXISTS items (
  item_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  flag TEXT,
  label TEXT,
  recipe TEXT,
  snapshots TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
${HISTORY_SCHEMA}
CREATE TABLE IF NOT EXISTS preview (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  jpeg BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS original (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  kind TEXT NOT NULL,
  blob TEXT,
  state TEXT NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  codec TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  channels INTEGER,
  depth INTEGER,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blob_chunks (
  hash TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (hash, idx)
);
`;
function syncDir(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
  } finally {
    if (fd !== void 0) fs.closeSync(fd);
  }
}
const BLOB_CHUNK = 4 * 1024 * 1024;
function sha256File(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    for (let n = fs.readSync(fd, buf, 0, buf.length, null); n > 0; n = fs.readSync(fd, buf, 0, buf.length, null))
      h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}
async function sha256FileAsync(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024 }))
    h.update(chunk);
  return h.digest("hex");
}
const writing = /* @__PURE__ */ new Set();
async function putBlobFileInPieces(onProject, file, info) {
  const hash = await sha256FileAsync(file);
  if (onProject((p) => p.blob(hash)) || writing.has(hash)) return hash;
  writing.add(hash);
  const fd = await promises.open(file, "r");
  try {
    const { size } = await fd.stat();
    onProject((p) => p.prepare("DELETE FROM blob_chunks WHERE hash = ?").run(hash));
    const buf = Buffer.alloc(Math.min(BLOB_CHUNK, Math.max(1, size)));
    for (let idx = 0, at = 0; at < size || idx === 0; idx++) {
      const { bytesRead } = await fd.read(buf, 0, buf.length, at);
      onProject(
        (p) => p.prepare("INSERT INTO blob_chunks(hash, idx, data) VALUES (?, ?, ?)").run(hash, idx, buf.subarray(0, bytesRead))
      );
      at += bytesRead;
      if (bytesRead === 0) break;
      await promises$1.setImmediate();
    }
    onProject(
      (p) => p.prepare(
        `INSERT OR IGNORE INTO blobs(hash, kind, codec, width, height, channels, depth, bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        hash,
        info.kind,
        info.codec,
        info.width,
        info.height,
        info.channels,
        info.depth,
        size,
        (/* @__PURE__ */ new Date()).toISOString()
      )
    );
  } finally {
    await fd.close();
    writing.delete(hash);
  }
  return hash;
}
function blobsIn(json) {
  return [...json.matchAll(/"(?:blob|alpha)":"([0-9a-f]{64})"/g)].map((m) => m[1]);
}
const PHOTO = "";
const itemKeyOf = (copyId) => copyId ?? PHOTO;
function refsIn(json) {
  return [...json.matchAll(/"ref":"([^"]+)"/g)].map((m) => m[1]);
}
class NotAProject extends Error {
  constructor(path2) {
    super(concepts.t("{{path}} is not a Pixl project", { path: path2 }));
    this.name = "NotAProject";
  }
}
class PixlFile {
  path;
  history;
  db;
  statements = /* @__PURE__ */ new Map();
  depth = 0;
  closed = false;
  /** A batch is open: writes wait for `commitBatch` (see ProjectPool.write). */
  batch = false;
  constructor(path2, db) {
    this.path = path2;
    this.db = db;
    db.exec(
      "PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA fullfsync = ON; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;"
    );
    this.history = new HistoryTable({
      prepare: (sql) => this.prepare(sql),
      tx: (fn) => this.tx(fn)
    });
  }
  /**
   * A new project at `path` for `origin`. It is built under a temporary name
   * and renamed into place, so `path` either does not exist or is a whole
   * project. Fails if `path` exists.
   */
  static create(path$1, origin, fill) {
    if (fs.existsSync(path$1)) throw new Error(concepts.t("{{path}} already exists", { path: path$1 }));
    const tmp = `${path$1}.creating-${process.pid}`;
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    const db = new node_sqlite.DatabaseSync(tmp);
    db.exec(
      `PRAGMA page_size = 16384; PRAGMA auto_vacuum = INCREMENTAL;
       PRAGMA application_id = ${PIXL_APPLICATION_ID}; PRAGMA user_version = ${PIXL_FORMAT_VERSION};`
    );
    db.exec(SCHEMA);
    const file = new PixlFile(tmp, db);
    try {
      file.tx(() => {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        file.setMeta("format", "pixl-project");
        file.setMeta("format_version", String(PIXL_FORMAT_VERSION));
        file.setMeta("created_at", now);
        file.setMeta("created_by", "Pixl Playroom");
        file.setOrigin(origin);
        file.prepare("INSERT INTO items(item_id, name, sort, updated_at) VALUES (?, ?, 0, ?)").run(PHOTO, origin.name, now);
        fill?.(file);
      });
    } catch (err) {
      file.close();
      fs.unlinkSync(tmp);
      throw err;
    }
    file.close();
    fs.renameSync(tmp, path$1);
    syncDir(path.dirname(path$1));
    return PixlFile.open(path$1);
  }
  /** Open an existing project; refuses a file that is not one, or is from a newer format. */
  static open(path2) {
    const db = new node_sqlite.DatabaseSync(path2);
    try {
      const id = db.prepare("PRAGMA application_id").get().application_id;
      if (id !== PIXL_APPLICATION_ID) throw new NotAProject(path2);
      const v = db.prepare("PRAGMA user_version").get().user_version;
      if (v > PIXL_FORMAT_VERSION)
        throw new Error(
          concepts.t("{{path}} was made by a newer Pixl Playroom (format {{format}})", { path: path2, format: v })
        );
      db.exec(SCHEMA);
      const file = new PixlFile(path2, db);
      if (v < PIXL_FORMAT_VERSION) file.upgrade(v);
      return file;
    } catch (err) {
      db.close();
      throw err;
    }
  }
  /**
   * A file from an older version brought up to this one, in one transaction.
   * 1 → 2: each plane in `planes` becomes a blob named by its SHA-256, and
   * every recipe, snapshot and history row naming it by its old name names
   * it by the new one.
   */
  upgrade(from) {
    this.tx(() => {
      const hasPlanes = this.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'planes'"
      ).get() !== void 0;
      if (from < 2 && hasPlanes) {
        const names = /* @__PURE__ */ new Map();
        for (const { ref, png } of this.prepare("SELECT ref, png FROM planes").all()) {
          const hash = planeRef(png);
          names.set(ref, hash);
          this.putPlane(hash, png);
        }
        if (names.size > 0) {
          const items = this.prepare("SELECT item_id, recipe, snapshots FROM items").all();
          const setItem = this.prepare(
            "UPDATE items SET recipe = ?, snapshots = ? WHERE item_id = ?"
          );
          for (const it of items) {
            const recipe2 = it.recipe && renameRefs(it.recipe, names);
            const snapshots = renameRefs(it.snapshots, names);
            if (recipe2 !== it.recipe || snapshots !== it.snapshots)
              setItem.run(recipe2, snapshots, it.item_id);
          }
          const rows = this.prepare("SELECT item_key, seq, recipe, patch FROM history").all();
          const setRow = this.prepare(
            "UPDATE history SET recipe = ?, patch = ? WHERE item_key = ? AND seq = ?"
          );
          for (const r of rows) {
            const recipe2 = renameRefs(r.recipe, names);
            const patch = r.patch && renameRefs(r.patch, names);
            if (recipe2 !== r.recipe || patch !== r.patch)
              setRow.run(recipe2, patch, r.item_key, r.seq);
          }
        }
        this.db.exec("DROP TABLE planes");
      }
      this.setMeta("format_version", String(PIXL_FORMAT_VERSION));
      this.db.exec(`PRAGMA user_version = ${PIXL_FORMAT_VERSION}`);
    });
  }
  /** The photo a project names, read without keeping it open; null for a file that is not one. */
  static peekOrigin(path2) {
    try {
      const f = PixlFile.open(path2);
      try {
        return f.origin();
      } finally {
        f.close();
      }
    } catch {
      return null;
    }
  }
  close() {
    this.statements.clear();
    if (this.closed) return;
    this.commitBatch();
    this.closed = true;
    this.db.close();
  }
  /**
   * Give up to `pages` free pages back to the disk (16 KiB each). Returns
   * whether more are left: a large blob's pages go back over several steps,
   * not in one long write.
   */
  vacuumStep(pages = 256) {
    this.db.exec(`PRAGMA incremental_vacuum(${pages})`);
    const { freelist_count } = this.prepare("PRAGMA freelist_count").get();
    return freelist_count > 0;
  }
  /** Whether writes are being gathered into one transaction. */
  get batching() {
    return this.batch;
  }
  /**
   * Gather the writes that follow into one transaction, until `commitBatch`:
   * a commit (and its fsyncs) for many edits. Each `tx` inside it is a
   * savepoint, so one that fails still undoes only itself.
   */
  beginBatch() {
    if (this.batch || this.depth > 0 || this.closed) return;
    this.db.exec("BEGIN IMMEDIATE");
    this.batch = true;
  }
  /** Commit the batch (nothing when none is open). A failed commit rolls it back and throws. */
  commitBatch() {
    if (!this.batch) return;
    this.batch = false;
    try {
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw err;
    }
  }
  prepare(sql) {
    let st = this.statements.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.statements.set(sql, st);
    }
    return st;
  }
  tx(fn) {
    if (this.depth > 0 || this.batch) {
      const sp = `tx${this.depth}`;
      this.depth++;
      this.db.exec(`SAVEPOINT ${sp}`);
      try {
        const out = fn();
        this.db.exec(`RELEASE ${sp}`);
        return out;
      } catch (err) {
        this.db.exec(`ROLLBACK TO ${sp}`);
        this.db.exec(`RELEASE ${sp}`);
        throw err;
      } finally {
        this.depth--;
      }
    }
    this.depth = 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    } finally {
      this.depth = 0;
    }
  }
  // ── meta and origin ──
  meta(key) {
    const row = this.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row?.value;
  }
  setMeta(key, value) {
    if (value === null) this.prepare("DELETE FROM meta WHERE key = ?").run(key);
    else
      this.prepare(
        "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(key, value);
  }
  origin() {
    const r = this.prepare("SELECT * FROM origin WHERE id = 1").get();
    if (!r) return null;
    return {
      name: r.name,
      ext: r.ext,
      size: r.size,
      mtime: r.mtime,
      path: r.path,
      isRaw: r.is_raw === 1,
      sha1: r.sha1
    };
  }
  setOrigin(o) {
    this.prepare(
      `INSERT INTO origin(id, name, ext, size, mtime, path, is_raw, sha1) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, ext = excluded.ext, size = excluded.size,
         mtime = excluded.mtime, path = excluded.path, is_raw = excluded.is_raw, sha1 = excluded.sha1`
    ).run(o.name, o.ext, o.size, o.mtime, o.path, o.isRaw ? 1 : 0, o.sha1);
  }
  // ── what a sidecar holds ──
  /**
   * The project's items as a sidecar holds them: recipes with their planes
   * filled in, or (`hydrate` false, to change and write back) by reference.
   */
  /** One item's recipe (null when it has none), planes by reference unless `hydrate`. */
  itemRecipe(itemId, isRaw, hydrate = false) {
    const row = this.prepare("SELECT recipe FROM items WHERE item_id = ?").get(itemId);
    if (!row?.recipe) return null;
    const r = JSON.parse(row.recipe);
    return recipe.normaliseRecipe(hydrate ? recipe.hydrateRecipe(r, (ref) => this.plane(ref)) : r, isRaw);
  }
  read(isRaw, hydrate = true) {
    const rows = this.prepare("SELECT * FROM items ORDER BY sort, item_id").all();
    const plane = (ref) => this.plane(ref);
    const recipeOf = (json) => {
      const r = JSON.parse(json);
      return recipe.normaliseRecipe(hydrate ? recipe.hydrateRecipe(r, plane) : r, isRaw);
    };
    const itemOf = (r) => ({
      rating: r.rating,
      flag: r.flag ?? null,
      label: r.label ?? null,
      recipe: r.recipe ? recipeOf(r.recipe) : null,
      snapshots: JSON.parse(r.snapshots).map((s) => ({
        ...s,
        recipe: recipeOf(JSON.stringify(s.recipe))
      }))
    });
    const photo = rows.find((r) => r.item_id === PHOTO);
    const stack = this.meta("stack");
    return {
      app: "pixl-playroom",
      version: 1,
      photo: photo ? itemOf(photo) : { rating: 0, flag: null, label: null, recipe: null, snapshots: [] },
      copies: rows.filter((r) => r.item_id !== PHOTO).map((r) => ({ ...itemOf(r), id: r.item_id, name: r.name })),
      stack: stack ? JSON.parse(stack) : null,
      rawColour: source.parseRawColour(this.meta("rawColour")),
      names: readNames(this.meta("names")),
      cullKeep: this.meta("cullKeep") === "1"
    };
  }
  /**
   * Write what a sidecar holds: every item (copies gone from it are removed),
   * the stack. Recipes may carry their planes or name them; a named plane the
   * project lacks is taken from `planeOf` (the index's store).
   */
  write(s, planeOf) {
    this.tx(() => {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const slim2 = (r) => recipe.slimRecipe(r, planeRef, (ref, png) => {
        if (!this.hasPlane(ref)) this.putPlane(ref, png);
      });
      const existing = new Map(
        this.prepare(
          "SELECT item_id, name, sort, rating, flag, label, recipe, snapshots FROM items"
        ).all().map((r) => [r.item_id, r])
      );
      const put = this.prepare(
        `INSERT INTO items(item_id, name, sort, rating, flag, label, recipe, snapshots, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET name = excluded.name, sort = excluded.sort,
           rating = excluded.rating, flag = excluded.flag, label = excluded.label,
           recipe = excluded.recipe, snapshots = excluded.snapshots, updated_at = excluded.updated_at`
      );
      const row = (id, name, sort, it) => {
        const recipe2 = it.recipe ? JSON.stringify(slim2(it.recipe)) : null;
        const snapshots = JSON.stringify(
          it.snapshots.map((sn) => ({ ...sn, recipe: slim2(sn.recipe) }))
        );
        const was = existing.get(id);
        if (was && was.name === name && was.sort === sort && was.rating === it.rating && was.flag === (it.flag ?? null) && was.label === (it.label ?? null) && was.recipe === recipe2 && was.snapshots === snapshots)
          return;
        put.run(id, name, sort, it.rating, it.flag, it.label, recipe2, snapshots, now);
        for (const ref of refsIn(`${recipe2 ?? ""} ${snapshots}`)) {
          if (this.hasPlane(ref)) continue;
          const png = planeOf?.(ref);
          if (png !== void 0) this.putPlane(ref, png);
        }
      };
      row(PHOTO, this.origin()?.name ?? "", 0, s.photo);
      s.copies.forEach((c, i) => row(c.id, c.name, i + 1, c));
      const keep = /* @__PURE__ */ new Set([PHOTO, ...s.copies.map((c) => c.id)]);
      for (const item_id of existing.keys()) {
        if (keep.has(item_id)) continue;
        this.prepare("DELETE FROM items WHERE item_id = ?").run(item_id);
        this.history.remove(item_id);
      }
      this.setMeta("stack", s.stack ? JSON.stringify(s.stack) : null);
      this.setMeta("rawColour", s.rawColour ?? null);
      this.setMeta("names", s.names ? JSON.stringify(s.names) : null);
      this.setMeta("cullKeep", s.cullKeep ? "1" : null);
    });
  }
  // ── history, planes, preview ──
  /** History rows moved in from elsewhere (the index, before the photo had a project). */
  importHistory(copyId, rows) {
    this.history.remove(itemKeyOf(copyId));
    this.history.insertRows(itemKeyOf(copyId), rows);
  }
  /** Keep a painted plane (a base64 PNG) as a blob named `ref`, its SHA-256 (`planeRef`). */
  putPlane(ref, png) {
    if (this.hasPlane(ref)) return;
    const bytes = Buffer.from(png, "base64");
    const size = pngSize(bytes);
    this.putBlobBytes(ref, bytes, {
      kind: "plane",
      codec: "png",
      width: size?.width ?? null,
      height: size?.height ?? null,
      channels: 1,
      depth: 8
    });
  }
  hasPlane(ref) {
    return this.prepare("SELECT 1 FROM blobs WHERE hash = ?").get(ref) !== void 0;
  }
  /** A plane as a base64 PNG, or undefined when the project has none by that name. */
  plane(ref) {
    const info = this.blob(ref);
    if (info?.kind !== "plane") return void 0;
    return this.blobBytes(ref).toString("base64");
  }
  *planes() {
    for (const { hash } of this.prepare("SELECT hash FROM blobs WHERE kind = 'plane'").all())
      yield { ref: hash, png: this.blobBytes(hash).toString("base64") };
  }
  /** A blob's bytes, whole (for small ones: planes). */
  blobBytes(hash) {
    const parts = this.prepare("SELECT data FROM blob_chunks WHERE hash = ? ORDER BY idx").all(hash).map((r) => r.data);
    return Buffer.concat(parts);
  }
  /** Store bytes already in memory as the blob `hash`, in chunks. */
  putBlobBytes(hash, bytes, info) {
    this.tx(() => {
      const put = this.prepare("INSERT INTO blob_chunks(hash, idx, data) VALUES (?, ?, ?)");
      for (let idx = 0, at = 0; at < bytes.length || idx === 0; idx++, at += BLOB_CHUNK)
        put.run(hash, idx, bytes.subarray(at, Math.min(bytes.length, at + BLOB_CHUNK)));
      this.prepare(
        `INSERT INTO blobs(hash, kind, codec, width, height, channels, depth, bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        hash,
        info.kind,
        info.codec,
        info.width,
        info.height,
        info.channels,
        info.depth,
        bytes.length,
        (/* @__PURE__ */ new Date()).toISOString()
      );
    });
  }
  // ── blobs: large binaries, by content (the original; later, pixel results) ──
  blob(hash) {
    const r = this.prepare("SELECT * FROM blobs WHERE hash = ?").get(hash);
    return r ? {
      hash: r.hash,
      kind: r.kind,
      codec: r.codec,
      width: r.width,
      height: r.height,
      channels: r.channels,
      depth: r.depth,
      bytes: r.bytes
    } : null;
  }
  /**
   * Store a file as a blob, by its SHA-256, in chunks of `BLOB_CHUNK` (one is
   * never read whole into memory, and a sync service diffs pages, not the
   * project). A blob already there is not stored again. Returns its hash.
   */
  putBlobFile(file, info) {
    const hash = sha256File(file);
    if (this.blob(hash)) return hash;
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    try {
      this.tx(() => {
        const put = this.prepare("INSERT INTO blob_chunks(hash, idx, data) VALUES (?, ?, ?)");
        const buf = Buffer.alloc(Math.min(BLOB_CHUNK, Math.max(1, size)));
        for (let idx = 0, at = 0; at < size; idx++) {
          const n = fs.readSync(fd, buf, 0, buf.length, at);
          put.run(hash, idx, buf.subarray(0, n));
          at += n;
        }
        this.prepare(
          `INSERT INTO blobs(hash, kind, codec, width, height, channels, depth, bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          hash,
          info.kind,
          info.codec,
          info.width,
          info.height,
          info.channels,
          info.depth,
          size,
          (/* @__PURE__ */ new Date()).toISOString()
        );
      });
    } finally {
      fs.closeSync(fd);
    }
    return hash;
  }
  /** Write a blob out to `file` (whole, or not at all). False when there is no such blob. */
  writeBlobTo(hash, file) {
    if (!this.blob(hash)) return false;
    const tmp = `${file}.part-${process.pid}`;
    const fd = fs.openSync(tmp, "w");
    try {
      for (const { data } of this.prepare(
        "SELECT data FROM blob_chunks WHERE hash = ? ORDER BY idx"
      ).iterate(hash))
        fs.writeSync(fd, data);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    return true;
  }
  removeBlob(hash) {
    this.tx(() => {
      this.prepare("DELETE FROM blob_chunks WHERE hash = ?").run(hash);
      this.prepare("DELETE FROM blobs WHERE hash = ?").run(hash);
    });
  }
  // ── the original, embedded ──
  /** The embedded original, if the project carries one (or is making it). */
  original() {
    const r = this.prepare("SELECT kind, blob, state, note FROM original WHERE id = 1").get();
    return r ? {
      kind: r.kind,
      blob: r.blob,
      state: r.state,
      note: r.note
    } : null;
  }
  setOriginal(o) {
    this.prepare(
      `INSERT INTO original(id, kind, blob, state, note) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, blob = excluded.blob,
         state = excluded.state, note = excluded.note`
    ).run(o.kind, o.blob, o.state, o.note);
  }
  setPreview(jpeg, width, height) {
    this.prepare(
      `INSERT INTO preview(id, width, height, jpeg, updated_at) VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET width = excluded.width, height = excluded.height,
         jpeg = excluded.jpeg, updated_at = excluded.updated_at`
    ).run(width, height, jpeg, (/* @__PURE__ */ new Date()).toISOString());
  }
  /**
   * Drop what nothing refers to: planes no recipe, snapshot or history step
   * names, and other blobs nothing names. The freed pages go back to the disk
   * with `vacuumStep`, a little at a time. Returns how many planes went.
   */
  gc() {
    const keep = /* @__PURE__ */ new Set();
    for (const r of this.prepare("SELECT recipe, snapshots FROM items").all()) {
      for (const ref of refsIn(`${r.recipe ?? ""} ${r.snapshots}`)) keep.add(ref);
    }
    for (const json of this.history.json()) for (const ref of refsIn(json)) keep.add(ref);
    const named = /* @__PURE__ */ new Set();
    const o = this.original();
    if (o?.blob) named.add(o.blob);
    for (const json of this.history.json()) for (const h of blobsIn(json)) named.add(h);
    for (const r of this.prepare("SELECT recipe, snapshots FROM items").all())
      for (const h of blobsIn(`${r.recipe ?? ""} ${r.snapshots}`)) named.add(h);
    const fresh = new Date(Date.now() - 36e5).toISOString();
    let removed = 0;
    this.tx(() => {
      for (const b of this.prepare("SELECT hash, kind, created_at FROM blobs").all()) {
        if (b.kind === "plane") {
          if (keep.has(b.hash)) continue;
          removed++;
        } else if (named.has(b.hash) || b.created_at >= fresh) continue;
        this.removeBlob(b.hash);
      }
    });
    for (const { hash } of this.prepare(
      "SELECT DISTINCT hash FROM blob_chunks WHERE hash NOT IN (SELECT hash FROM blobs)"
    ).all()) {
      if (writing.has(hash)) continue;
      this.prepare("DELETE FROM blob_chunks WHERE hash = ?").run(hash);
    }
    return removed;
  }
}
function fileStamp(path2) {
  try {
    const st = fs.statSync(path2);
    return `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}
const BATCH_MS = 250;
class ProjectPool {
  open = /* @__PURE__ */ new Map();
  idleMs;
  batchMs;
  /** Told after a batch is committed (the file's mtime has moved on). */
  onCommit;
  /** The stamp each project was left at by this pool's own last use (kept after it closes). */
  own = /* @__PURE__ */ new Map();
  /** Projects kept open while idle (the photo open in Develop): its statements stay prepared. */
  pinned = /* @__PURE__ */ new Set();
  constructor(idleMs = 2e3, onCommit = () => {
  }, batchMs = BATCH_MS) {
    this.idleMs = idleMs;
    this.onCommit = onCommit;
    this.batchMs = batchMs;
  }
  /** Run `fn` on the project at `path`, to read it (or to write at once). */
  use(path2, fn) {
    let e = this.open.get(path2);
    if (e && !e.file.batching && e.stamp !== fileStamp(path2)) {
      this.drop(path2);
      e = void 0;
    }
    if (!e) {
      e = { file: PixlFile.open(path2), stamp: null, timer: null, commit: null };
      this.open.set(path2, e);
    }
    if (e.timer) clearTimeout(e.timer);
    try {
      return fn(e.file);
    } finally {
      e.stamp = fileStamp(path2);
      this.own.set(path2, e.stamp);
      e.timer = this.pinned.has(path2) ? null : this.idleTimer(path2);
    }
  }
  /** Run `fn`, which writes, on the project: its writes join the batch committed within BATCH_MS. */
  write(path2, fn) {
    return this.use(path2, (p) => {
      if (!p.batching) {
        p.beginBatch();
        const e = this.open.get(path2);
        e.commit = setTimeout(() => this.commit(path2), this.batchMs);
        e.commit.unref?.();
      }
      return fn(p);
    });
  }
  /** Whether the pool has the project open. */
  isOpen(path2) {
    return this.open.has(path2);
  }
  /** Commit a project's batch now (one project, or all). */
  flush(path2) {
    for (const p of [...this.open.keys()]) if (path2 === void 0 || p === path2) this.commit(p);
  }
  commit(path2) {
    const e = this.open.get(path2);
    if (!e) return;
    if (e.commit) clearTimeout(e.commit);
    e.commit = null;
    if (!e.file.batching) return;
    try {
      e.file.commitBatch();
    } catch (err) {
      console.warn("project batch not committed", path2, err.message);
    }
    e.stamp = fileStamp(path2);
    this.own.set(path2, e.stamp);
    this.onCommit(path2);
  }
  idleTimer(path2) {
    const timer = setTimeout(() => this.drop(path2), this.idleMs);
    timer.unref?.();
    return timer;
  }
  /** Keep a project open while idle (`on`), or let it close after its idle time again. */
  pin(path2, on) {
    const e = this.open.get(path2);
    if (on) {
      this.pinned.add(path2);
      if (e?.timer) clearTimeout(e.timer);
      if (e) e.timer = null;
    } else if (this.pinned.delete(path2) && e && !e.timer) {
      e.timer = this.idleTimer(path2);
    }
  }
  /** Whether a project's file is as this pool last left it (its own writes, not another's). */
  leftAs(path2, stamp) {
    return this.own.has(path2) && this.own.get(path2) === stamp;
  }
  /** Close one project (before it is moved or replaced), or all. */
  drop(path2) {
    for (const [p, e] of [...this.open]) {
      if (path2 !== void 0 && p !== path2) continue;
      this.commit(p);
      if (e.timer) clearTimeout(e.timer);
      e.file.close();
      this.open.delete(p);
    }
  }
}
function jpegSize(b) {
  if (b[0] !== 255 || b[1] !== 216) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 255) return null;
    const marker = b[i + 1];
    const len = b[i + 2] << 8 | b[i + 3];
    if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204)
      return { height: b[i + 5] << 8 | b[i + 6], width: b[i + 7] << 8 | b[i + 8] };
    i += 2 + len;
  }
  return null;
}
exports.CLIP_HIGH = CLIP_HIGH;
exports.CLIP_LOW = CLIP_LOW;
exports.CULL_EDGE = CULL_EDGE;
exports.CULL_PERCENTILES = CULL_PERCENTILES;
exports.CULL_VERSION = CULL_VERSION;
exports.FOCUS_BINS = FOCUS_BINS;
exports.HistoryTable = HistoryTable;
exports.KELVIN_MAX = KELVIN_MAX;
exports.KELVIN_MIN = KELVIN_MIN;
exports.NAME_MAX_TOKENS = NAME_MAX_TOKENS;
exports.NAME_PROMPT = NAME_PROMPT;
exports.OFFERED_PHRASE_MODEL = OFFERED_PHRASE_MODEL;
exports.PARTS_MODEL = PARTS_MODEL;
exports.PHRASE_MODELS = PHRASE_MODELS;
exports.PIXL_EXT = PIXL_EXT;
exports.PixlFile = PixlFile;
exports.ProjectPool = ProjectPool;
exports.SCENE_MODEL = SCENE_MODEL;
exports.SCHEME = SCHEME;
exports.SEGMENT_LABEL = SEGMENT_LABEL;
exports.SKY_BY_CLICK = SKY_BY_CLICK;
exports.SMART_RATES = SMART_RATES;
exports.SPOT_LABEL = SPOT_LABEL;
exports.TINT_UNITS_PER_DUV = TINT_UNITS_PER_DUV;
exports.absoluteFromOp = absoluteFromOp;
exports.blinkOf = blinkOf;
exports.cacheUrlIn = cacheUrlIn;
exports.compile = compile;
exports.compileRetouch = compileRetouch;
exports.convertAsShot = convertAsShot;
exports.convertWb = convertWb;
exports.cullKey = cullKey;
exports.dhashFromGrey = dhashFromGrey;
exports.embedMetadata = embedMetadata;
exports.endExiftool = endExiftool;
exports.estimate = estimate;
exports.exiftool = exiftool;
exports.exposureOf = exposureOf;
exports.featherOf = featherOf;
exports.fileStamp = fileStamp;
exports.fitCrop = fitCrop;
exports.flatSubjects = flatSubjects;
exports.focusOf = focusOf;
exports.framingTransparent = framingTransparent;
exports.framingWarps = framingWarps;
exports.gradeKey = gradeKey;
exports.groupNear = groupNear;
exports.hardenPlane = hardenPlane;
exports.immediateLayers = immediateLayers;
exports.isPartTarget = isPartTarget;
exports.isSceneTarget = isSceneTarget;
exports.isUnder = isUnder;
exports.itemKeyOf = itemKeyOf;
exports.jpegSize = jpegSize;
exports.keyOf = keyOf;
exports.keywordPrefixes = keywordPrefixes;
exports.modelRefine = modelRefine;
exports.namesFromPlan = namesFromPlan;
exports.namingSystem = namingSystem;
exports.nextMaskName = nextMaskName;
exports.normaliseKeyword = normaliseKeyword;
exports.normaliseKeywords = normaliseKeywords;
exports.opNeutralising = opNeutralising;
exports.orientedFrame = orientedFrame;
exports.overallProgress = overallProgress;
exports.parseKey = parseKey;
exports.phashDistance = phashDistance;
exports.phashGroups = phashGroups;
exports.planeEdge = planeEdge;
exports.planeRef = planeRef;
exports.previewLayers = previewLayers;
exports.putBlobFileInPieces = putBlobFileInPieces;
exports.readCull = readCull;
exports.readNames = readNames;
exports.readSmart = readSmart;
exports.refsIn = refsIn;
exports.relativeFromOp = relativeFromOp;
exports.removeSpot = removeSpot;
exports.renameRefs = renameRefs;
exports.searchWords = searchWords;
exports.segmentModel = segmentModel;
exports.setExiftoolPath = setExiftoolPath;
exports.sha256File = sha256File;
exports.slim = slim;
exports.smartReadiness = smartReadiness;
exports.snapsToObject = snapsToObject;
exports.spotShape = spotShape;
exports.strokeOver = strokeOver;
exports.toStart = toStart;
exports.vendoredExiftoolPath = vendoredExiftoolPath;
exports.wbFromSaved = wbFromSaved;
