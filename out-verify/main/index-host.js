"use strict";
const pixlfile = require("./chunks/pixlfile-RW5g9hyn.js");
const concepts = require("./chunks/concepts-BqKJKtxp.js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const recipe = require("./chunks/recipe-CiIOoIr9.js");
const source = require("./chunks/source-CdsxFjqD.js");
const exifr = require("exifr");
const promises = require("fs/promises");
const node_sqlite = require("node:sqlite");
const os = require("os");
require("module");
require("./chunks/gradients-BJM4U-Ix.js");
require("timers/promises");
require("child_process");
const isGroup = (r) => r.rules !== void 0;
function cameraName(item2) {
  const { make, model } = item2.camera;
  if (make && model && model.toLowerCase().startsWith(make.toLowerCase())) return model;
  return [make, model].filter(Boolean).join(" ");
}
function itemTexts(item2) {
  return [
    item2.name,
    item2.copyName,
    item2.title,
    item2.caption,
    ...item2.keywords,
    item2.camera.make,
    item2.camera.model,
    item2.camera.lens,
    ...item2.names ?? []
  ].filter((s) => !!s).map((s) => s.toLowerCase());
}
const lower = (v) => (v === null || v === void 0 ? "" : String(v)).toLowerCase();
function textMatch(values, op, value) {
  const want = lower(value);
  const vals = values.map(lower).filter((s) => s !== "");
  switch (op) {
    case "is":
      return vals.some((s) => s === want);
    case "isNot":
      return !vals.some((s) => s === want);
    case "contains":
      return vals.some((s) => s.includes(want));
    case "notContains":
      return !vals.some((s) => s.includes(want));
    case "startsWith":
      return vals.some((s) => s.startsWith(want));
    case "isEmpty":
      return vals.length === 0;
    case "isNotEmpty":
      return vals.length > 0;
    default:
      return false;
  }
}
const near = (a, b) => Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-3);
function numberMatch(n, op, value) {
  if (op === "isEmpty") return n === null;
  if (op === "isNotEmpty") return n !== null;
  if (op === "isNot") return n === null || !near(n, Number(value));
  if (n === null) return false;
  switch (op) {
    case "is":
      return near(n, Number(value));
    case "gte":
      return n >= Number(value) || near(n, Number(value));
    case "lte":
      return n <= Number(value) || near(n, Number(value));
    case "between": {
      if (!Array.isArray(value)) return false;
      const [a, b] = [Number(value[0]), Number(value[1])];
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return (n >= lo || near(n, lo)) && (n <= hi || near(n, hi));
    }
    default:
      return false;
  }
}
function dayStart(v) {
  const s = String(v ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return new Date(s).getTime();
}
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));
function dayEnd(v) {
  const start = dayStart(v);
  if (!isDay(v)) return start;
  const d = new Date(start);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}
function dateMatch(iso, r, now) {
  const t = iso ? new Date(iso).getTime() : NaN;
  const has = Number.isFinite(t);
  if (r.op === "isEmpty") return !has;
  if (r.op === "isNotEmpty") return has;
  if (!has) return false;
  switch (r.op) {
    case "before":
      return t < dayStart(r.value);
    case "after":
      return t >= dayEnd(r.value);
    case "between": {
      if (!Array.isArray(r.value)) return false;
      const a = dayStart(r.value[0]);
      const b = dayStart(r.value[1]);
      const [lo, hi] = a <= b ? [r.value[0], r.value[1]] : [r.value[1], r.value[0]];
      return t >= dayStart(lo) && t < dayEnd(hi);
    }
    case "inLast": {
      const n = Number(r.value);
      if (!Number.isFinite(n)) return false;
      const from = new Date(now);
      const unit = r.unit ?? "days";
      if (unit === "days") from.setDate(from.getDate() - n);
      else if (unit === "weeks") from.setDate(from.getDate() - 7 * n);
      else if (unit === "months") from.setMonth(from.getMonth() - n);
      else from.setFullYear(from.getFullYear() - n);
      return t >= from.getTime() && t <= now.getTime();
    }
    default:
      return false;
  }
}
function keywordMatch(keywords, op, value) {
  const want = lower(value);
  const under = (k) => {
    const s = k.toLowerCase();
    return s === want || s.startsWith(want + "|");
  };
  const levels = keywords.flatMap((k) => k.split("|"));
  switch (op) {
    case "is":
      return keywords.some(under);
    case "isNot":
      return !keywords.some(under);
    case "isEmpty":
      return keywords.length === 0;
    case "isNotEmpty":
      return keywords.length > 0;
    default:
      return textMatch(levels, op, value);
  }
}
function matchRule(item2, r, ctx) {
  const c = item2.camera;
  switch (r.field) {
    case "rating":
      return numberMatch(item2.rating, r.op, r.value);
    case "flag": {
      const want = r.value === null || r.value === "none" ? null : r.value;
      return r.op === "isNot" ? item2.flag !== want : item2.flag === want;
    }
    case "label": {
      if (r.op === "isEmpty") return item2.label === null;
      if (r.op === "isNotEmpty") return item2.label !== null;
      const want = r.value === null || r.value === "none" ? null : r.value;
      return r.op === "isNot" ? item2.label !== want : item2.label === want;
    }
    case "edited":
      return r.op === "isNot" ? item2.edited !== !!r.value : item2.edited === !!r.value;
    case "kind": {
      const raw = r.value === "raw";
      return r.op === "isNot" ? item2.isRaw !== raw : item2.isRaw === raw;
    }
    case "ext":
      return textMatch([item2.ext.replace(/^\./, "")], r.op, lower(r.value).replace(/^\./, ""));
    case "name":
      return textMatch([item2.name, item2.copyName ?? ""], r.op, r.value);
    case "folder":
      return textMatch([item2.folder], r.op, r.value);
    case "title":
      return textMatch([item2.title ?? ""], r.op, r.value);
    case "caption":
      return textMatch([item2.caption ?? ""], r.op, r.value);
    case "keyword":
      return keywordMatch(item2.keywords, r.op, r.value);
    case "text":
      return textMatch(itemTexts(item2), r.op, r.value);
    case "camera": {
      const name = cameraName(item2);
      const values = r.op === "is" || r.op === "isNot" ? [name, c.model ?? ""] : [name];
      return textMatch(values, r.op, r.value);
    }
    case "lens":
      return textMatch([c.lens ?? ""], r.op, r.value);
    case "iso":
      return numberMatch(c.iso, r.op, r.value);
    case "focal":
      return numberMatch(c.focalLength, r.op, r.value);
    case "aperture":
      return numberMatch(c.fNumber, r.op, r.value);
    case "shutter":
      return numberMatch(c.exposureTime, r.op, r.value);
    case "captured":
      return dateMatch(c.capturedAt, r, ctx.now);
    case "collection": {
      const inIt = ctx.members(String(r.value ?? ""))?.has(item2.key) ?? false;
      return r.op === "isNot" ? !inIt : inIt;
    }
    default:
      return false;
  }
}
function matchSmart(item2, g, ctx) {
  if (g.rules.length === 0) return true;
  const one = (r) => isGroup(r) ? matchSmart(item2, r, ctx) : matchRule(item2, r, ctx);
  if (g.match === "all") return g.rules.every(one);
  if (g.match === "any") return g.rules.some(one);
  return !g.rules.some(one);
}
function remapCollections(g, map) {
  return {
    match: g.match,
    rules: g.rules.map(
      (r) => isGroup(r) ? remapCollections(r, map) : r.field === "collection" ? { ...r, value: map(String(r.value ?? "")) } : r
    )
  };
}
function memberResolver(opts) {
  const byId = new Map(opts.collections.map((c) => [c.id, c]));
  const children = /* @__PURE__ */ new Map();
  for (const c of opts.collections) {
    if (c.parent === null) continue;
    const list2 = children.get(c.parent);
    if (list2) list2.push(c.id);
    else children.set(c.parent, [c.id]);
  }
  const done = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const resolve = (id) => {
    const hit = done.get(id);
    if (hit) return hit;
    const c = byId.get(id);
    if (!c || visiting.has(id)) return void 0;
    visiting.add(id);
    let out;
    try {
      if (c.kind === "manual") out = opts.manual(id);
      else if (c.kind === "smart") {
        const rules = c.rules ?? { match: "all", rules: [] };
        const ctx = { now: opts.now, members: resolve };
        out = new Set(opts.items.filter((it) => matchSmart(it, rules, ctx)).map((it) => it.key));
      } else {
        out = /* @__PURE__ */ new Set();
        for (const child of children.get(id) ?? []) for (const k of resolve(child) ?? []) out.add(k);
      }
    } finally {
      visiting.delete(id);
    }
    done.set(id, out);
    return out;
  };
  return resolve;
}
function exifrCanRead(head) {
  const at = (i, ...bytes) => bytes.every((b, k) => head[i + k] === b);
  return at(0, 255, 216) || at(0, 73, 73) || // II: little-endian TIFF, CR2, NEF, ARW, DNG, ORF, RW2
  at(0, 77, 77) || // MM: big-endian TIFF
  at(0, 137, 80, 78, 71) || at(4, 102, 116, 121, 112);
}
async function headOf(path2, bytes) {
  const fh = await promises.open(path2, "r");
  try {
    const size = (await fh.stat()).size;
    const head = Buffer.alloc(Math.min(bytes, size));
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    return { head: head.subarray(0, bytesRead), size };
  } finally {
    await fh.close();
  }
}
const TAGS_HEAD = 1 << 20;
const PARSE = {
  tiff: true,
  exif: true,
  gps: true,
  xmp: false,
  icc: false,
  iptc: false,
  interop: false,
  translateValues: true,
  reviveValues: true
};
async function tagsOf(data) {
  try {
    return await exifr.parse(data, PARSE);
  } catch {
    return void 0;
  }
}
function emptyCamera() {
  return {
    make: null,
    model: null,
    lens: null,
    iso: null,
    exposureTime: null,
    fNumber: null,
    focalLength: null,
    capturedAt: null,
    gps: null
  };
}
async function readCamera(path2) {
  try {
    const { head, size } = await headOf(path2, TAGS_HEAD);
    if (!exifrCanRead(head)) return emptyCamera();
    const t = await tagsOf(head) ?? (size > head.length ? await tagsOf(await promises.readFile(path2)) : void 0);
    if (!t) return emptyCamera();
    const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
    const str = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
    const date = t.DateTimeOriginal ?? t.CreateDate ?? t.ModifyDate;
    return {
      make: str(t.Make),
      model: str(t.Model),
      lens: str(t.LensModel) ?? str(t.Lens),
      iso: num(t.ISO) ?? num(t.ISOSpeedRatings),
      exposureTime: num(t.ExposureTime),
      fNumber: num(t.FNumber),
      focalLength: num(t.FocalLength),
      capturedAt: date instanceof Date ? date.toISOString() : str(date),
      gps: num(t.latitude) !== null && num(t.longitude) !== null ? { lat: t.latitude, lon: t.longitude } : null
    };
  } catch {
    return emptyCamera();
  }
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS folders (path TEXT PRIMARY KEY, opened_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  folder TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime REAL NOT NULL,
  is_raw INTEGER NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  flag TEXT,
  label TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  camera_json TEXT,
  thumb_path TEXT,
  thumb_key TEXT,
  sidecar_mtime REAL
);
CREATE INDEX IF NOT EXISTS photos_folder ON photos(folder);
CREATE TABLE IF NOT EXISTS copies (
  photo_id INTEGER NOT NULL,
  copy_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  flag TEXT,
  label TEXT,
  edited INTEGER NOT NULL DEFAULT 0,
  thumb_path TEXT,
  thumb_key TEXT,
  PRIMARY KEY (photo_id, copy_id)
);
CREATE TABLE IF NOT EXISTS history (
  item_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  label TEXT NOT NULL,
  at TEXT NOT NULL,
  recipe TEXT NOT NULL,
  PRIMARY KEY (item_key, seq)
);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grp TEXT NOT NULL,
  groups TEXT NOT NULL,
  recipe TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS export_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, settings TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plane_blobs (hash TEXT PRIMARY KEY, png BLOB NOT NULL);
`;
const columnsOf = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
function addColumns(db, table, cols) {
  const have = columnsOf(db, table);
  for (const [name, type] of Object.entries(cols)) {
    if (!have.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}
const MIGRATIONS = [
  // 1. History became steps: each row past the base holds the patch it made,
  // and can be hidden. Older rows are converted when their item is read.
  (db) => addColumns(db, "history", { patch: "TEXT", hidden: "INTEGER NOT NULL DEFAULT 0" }),
  // 2. The library: descriptive metadata (mirrored from .xmp sidecars), the
  // camera fields as columns so they can be searched, content and picture
  // hashes for duplicates, stacks (mirrored from the sidecar), keywords and
  // collections; a preset's white balance as the engine's white.
  (db) => {
    addColumns(db, "photos", {
      title: "TEXT",
      caption: "TEXT",
      copyright: "TEXT",
      xmp_mtime: "REAL",
      content_hash: "TEXT",
      hash_key: "TEXT",
      dhash: "TEXT",
      dhash_key: "TEXT",
      captured_at: "TEXT",
      iso: "REAL",
      focal: "REAL",
      fnumber: "REAL",
      exposure: "REAL",
      camera: "TEXT",
      lens: "TEXT",
      stack_id: "TEXT",
      stack_pos: "INTEGER"
    });
    addColumns(db, "presets", { wb_op: "TEXT" });
    db.exec(`
CREATE TABLE IF NOT EXISTS photo_keywords (
  photo_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (photo_id, path)
);
CREATE INDEX IF NOT EXISTS photo_keywords_path ON photo_keywords(path);
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'smart', 'set')),
  parent TEXT,
  rules TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL,
  photo_id INTEGER NOT NULL,
  copy_id TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, photo_id, copy_id)
);
CREATE INDEX IF NOT EXISTS collection_items_photo ON collection_items(photo_id);
CREATE INDEX IF NOT EXISTS photos_captured ON photos(captured_at);
CREATE INDEX IF NOT EXISTS photos_size ON photos(size);
CREATE INDEX IF NOT EXISTS photos_stack ON photos(stack_id);
`);
    const rows = db.prepare("SELECT id, camera_json FROM photos WHERE camera_json IS NOT NULL").all();
    const set = db.prepare(
      "UPDATE photos SET captured_at = ?, iso = ?, focal = ?, fnumber = ?, exposure = ?, camera = ?, lens = ? WHERE id = ?"
    );
    for (const r of rows) {
      let c;
      try {
        c = JSON.parse(r.camera_json);
      } catch {
        continue;
      }
      set.run(...cameraColumns(c), r.id);
    }
  },
  // 3. Whether a photo is HDR, and how (a gain map, PQ, HLG), for the grid's
  // badge: known once the file has been probed.
  (db) => addColumns(db, "photos", { hdr: "TEXT", hdr_key: "TEXT" }),
  // 4. A photo's `.pixl` project, once it has one: where it is, and its
  // modification time as last mirrored (like a sidecar's).
  (db) => addColumns(db, "photos", { project_path: "TEXT", project_mtime: "REAL" }),
  // 5. Every project the index has seen, with the photo it was made from: how
  // a photo that moved away from its project (in a projects folder) finds it.
  (db) => db.exec(`CREATE TABLE IF NOT EXISTS projects (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      origin_path TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS projects_name ON projects(name, size);`),
  // 6. Photos by project: who has a project (linking, a project gone), without a scan.
  (db) => db.exec("CREATE INDEX IF NOT EXISTS photos_project ON photos(project_path)"),
  // 7. A file version that could not be read, and why: not tried again at
  // every launch, only once it changes.
  (db) => addColumns(db, "photos", { failed_key: "TEXT", failed_reason: "TEXT" }),
  // 8. Each item's recipe as its thumbnail knows it ('plain' or a hash), so
  // a folder opened again finds its thumbnails current without reading files.
  (db) => {
    addColumns(db, "photos", { recipe_key: "TEXT" });
    addColumns(db, "copies", { recipe_key: "TEXT" });
  },
  // 9. Painted planes as binary named by their SHA-256 (`planeRef`), not
  // base64 text named by a 32-bit hash and its length; the edit history
  // follows them to their new names.
  (db) => {
    const old = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'planes'").get();
    if (!old) return;
    const names = /* @__PURE__ */ new Map();
    const put = db.prepare("INSERT OR IGNORE INTO plane_blobs(hash, png) VALUES (?, ?)");
    for (const { ref, png } of db.prepare("SELECT ref, png FROM planes").all()) {
      const hash = pixlfile.planeRef(png);
      names.set(ref, hash);
      put.run(hash, Buffer.from(png, "base64"));
    }
    if (names.size > 0) {
      const set = db.prepare(
        "UPDATE history SET recipe = ?, patch = ? WHERE item_key = ? AND seq = ?"
      );
      for (const r of db.prepare(
        `SELECT item_key, seq, recipe, patch FROM history
           WHERE recipe LIKE '%"ref":%' OR patch LIKE '%"ref":%'`
      ).all()) {
        set.run(
          pixlfile.renameRefs(r.recipe, names),
          r.patch && pixlfile.renameRefs(r.patch, names),
          r.item_key,
          r.seq
        );
      }
    }
    db.exec("DROP TABLE planes");
  },
  // 10. When each file arrived on this disk (its birth time, else its
  // modification time), for the library's Date added order. Filled as each
  // folder is scanned again.
  (db) => addColumns(db, "photos", { added: "REAL" }),
  // 11. A saved preset's masks and AI steps as instructions (looks/smart.ts),
  // run again on each photo it is applied to.
  (db) => addColumns(db, "presets", { smart: "TEXT" }),
  // 12. RAWs are read by LibRaw since engine 0.16 (rawler before): one that
  // could not be read is tried again.
  (db) => {
    db.exec("UPDATE photos SET failed_key = NULL, failed_reason = NULL WHERE is_raw = 1");
  },
  // 13. A RAW's camera colour (engine 0.17): 'container' or 'pixl:1', recorded
  // the first time the photo is developed (NULL until then) so it is chosen
  // once and not re-derived from a probe (shared/rawcolour.ts).
  (db) => addColumns(db, "photos", { raw_colour: "TEXT" }),
  // 14. What Gemma named in the photo (shared/naming.ts), as JSON, for the
  // Masks pane's chips and the Library's search; and when it last tried and
  // gave no usable answer (not tried again by itself).
  (db) => addColumns(db, "photos", { names: "TEXT", names_tried: "TEXT" }),
  // 15. Cull signals (shared/cull.ts): exposure, focus in the subject, blur,
  // blink hints and the picture hash, as JSON, and the file version and
  // signal version they were measured for.
  (db) => addColumns(db, "photos", { cull: "TEXT", cull_key: "TEXT" }),
  // 16. The user's "Keep" on a suggested reject (shared/cullsuggest.ts):
  // never suggested again.
  (db) => addColumns(db, "photos", { cull_keep: "INTEGER NOT NULL DEFAULT 0" })
];
function cameraColumns(c) {
  const camera = [c?.make, c?.model].filter((x) => !!x).join(" ") || null;
  return [
    c?.capturedAt ?? null,
    c?.iso ?? null,
    c?.focalLength ?? null,
    c?.fNumber ?? null,
    c?.exposureTime ?? null,
    camera,
    c?.lens ?? null
  ];
}
function migrate(db) {
  let version = db.prepare("PRAGMA user_version").get().user_version;
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      MIGRATIONS[version](db);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    version++;
  }
}
class Store {
  db;
  statements = /* @__PURE__ */ new Map();
  depth = 0;
  hist;
  constructor(db) {
    this.db = db;
    this.hist = new pixlfile.HistoryTable({ prepare: (sql) => this.prepare(sql), tx: (fn) => this.tx(fn) });
  }
  /** A statement, prepared once and reused: preparing costs more than most runs. */
  prepare(sql) {
    let st = this.statements.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.statements.set(sql, st);
    }
    return st;
  }
  /**
   * Run `fn` as one transaction: a folder scan or a batch edit commits once
   * instead of once per row. Nested calls join the outer transaction.
   */
  tx(fn) {
    if (this.depth > 0) {
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
      }
    }
    this.depth = 1;
    this.db.exec("BEGIN");
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
  static open(file) {
    const db = new node_sqlite.DatabaseSync(file);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 3000;");
    db.exec(SCHEMA);
    migrate(db);
    return new Store(db);
  }
  close() {
    this.db.close();
  }
  // ── folders ──
  touchFolder(path2) {
    this.prepare(
      "INSERT INTO folders(path, opened_at) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at"
    ).run(path2, (/* @__PURE__ */ new Date()).toISOString());
  }
  /** Take a folder off the list of folders opened (its photos stay indexed). */
  forgetFolder(path2) {
    this.prepare("DELETE FROM folders WHERE path = ?").run(path2);
  }
  recentFolders(limit = 12) {
    return this.prepare("SELECT path FROM folders ORDER BY opened_at DESC LIMIT ?").all(limit).map((r) => r.path);
  }
  // ── photos ──
  photosIn(folder) {
    return this.prepare("SELECT * FROM photos WHERE folder = ? ORDER BY name").all(
      folder
    );
  }
  photo(id) {
    return this.prepare("SELECT * FROM photos WHERE id = ?").get(id);
  }
  photoByPath(path2) {
    return this.prepare("SELECT * FROM photos WHERE path = ?").get(path2);
  }
  upsertPhoto(p) {
    this.prepare(
      `INSERT INTO photos(path, folder, name, ext, size, mtime, is_raw, added) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime,
           added = COALESCE(photos.added, excluded.added)`
    ).run(p.path, p.folder, p.name, p.ext, p.size, p.mtime, p.isRaw ? 1 : 0, p.added ?? null);
    return this.photoByPath(p.path);
  }
  /**
   * Forget the folder's photos that are no longer on disk, with their
   * copies, keywords and places in collections. Returns how many went.
   */
  removeMissing(folder, present) {
    let removed = 0;
    for (const row of this.photosIn(folder)) {
      if (!present.has(row.path)) {
        this.prepare("DELETE FROM photos WHERE id = ?").run(row.id);
        this.prepare("DELETE FROM copies WHERE photo_id = ?").run(row.id);
        this.prepare("DELETE FROM photo_keywords WHERE photo_id = ?").run(row.id);
        this.prepare("DELETE FROM collection_items WHERE photo_id = ?").run(row.id);
        removed++;
      }
    }
    return removed;
  }
  /** Every photo the index knows, in folder and name order. */
  allPhotos() {
    return this.prepare("SELECT * FROM photos ORDER BY folder, name").all();
  }
  /** These photos, in folder and name order (unknown ids are left out). */
  photosByIds(ids) {
    const rows = this.inChunks(ids, (qs) => `SELECT * FROM photos WHERE id IN (${qs})`);
    return rows.sort(
      (a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name)
    );
  }
  /** Every copy of these photos. */
  copiesOfPhotos(ids) {
    return this.inChunks(
      ids,
      (qs) => `SELECT * FROM copies WHERE photo_id IN (${qs}) ORDER BY name`
    );
  }
  /** A query over a list of ids, a few hundred at a time (SQLite limits the parameters). */
  inChunks(ids, sql) {
    const out = [];
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      out.push(...this.prepare(sql(part.map(() => "?").join(","))).all(...part));
    }
    return out;
  }
  /** Photos of this size or any other that more than one photo has, in scope. */
  photosSharingSize(folder) {
    const where = folder === null ? "" : "WHERE folder = ?";
    const args = folder === null ? [] : [folder];
    return this.prepare(
      `SELECT * FROM photos WHERE size IN (
         SELECT size FROM photos ${where} GROUP BY size HAVING COUNT(*) > 1
       ) ${folder === null ? "" : "AND folder = ?"} ORDER BY folder, name`
    ).all(...args, ...args);
  }
  photosInScope(folder) {
    return folder === null ? this.allPhotos() : this.photosIn(folder);
  }
  setContentHash(id, hash, key) {
    this.prepare("UPDATE photos SET content_hash = ?, hash_key = ? WHERE id = ?").run(hash, key, id);
  }
  setDhash(id, hash, key) {
    this.prepare("UPDATE photos SET dhash = ?, dhash_key = ? WHERE id = ?").run(hash, key, id);
  }
  // ── descriptive metadata (mirrored from the .xmp) ──
  setXmp(id, meta, keywords, mtime) {
    this.prepare(
      "UPDATE photos SET title = ?, caption = ?, copyright = ?, xmp_mtime = ? WHERE id = ?"
    ).run(meta.title, meta.caption, meta.copyright, mtime, id);
    this.prepare("DELETE FROM photo_keywords WHERE photo_id = ?").run(id);
    const ins = this.prepare("INSERT OR IGNORE INTO photo_keywords(photo_id, path) VALUES (?, ?)");
    for (const k of keywords) ins.run(id, k);
  }
  keywordsOf(id) {
    return this.prepare("SELECT path FROM photo_keywords WHERE photo_id = ? ORDER BY path").all(id).map((r) => r.path);
  }
  /** Each photo's keywords, for a listing: one query per few hundred photos. */
  keywordsFor(ids) {
    const out = /* @__PURE__ */ new Map();
    const rows = this.inChunks(
      ids,
      (qs) => `SELECT photo_id, path FROM photo_keywords WHERE photo_id IN (${qs}) ORDER BY path`
    );
    for (const r of rows) {
      const list2 = out.get(r.photo_id);
      if (list2) list2.push(r.path);
      else out.set(r.photo_id, [r.path]);
    }
    return out;
  }
  allKeywords() {
    return this.prepare("SELECT photo_id, path FROM photo_keywords").all();
  }
  /** The photos with this keyword or one under it. */
  photoIdsWithKeyword(path2) {
    return this.prepare(
      "SELECT DISTINCT photo_id FROM photo_keywords WHERE path = ? OR path LIKE ? ESCAPE '\\'"
    ).all(path2, path2.replace(/[\\%_]/g, (c) => "\\" + c) + "|%").map((r) => r.photo_id);
  }
  // ── stacks (mirrored from the sidecar) ──
  setStack(id, stackId, position) {
    this.prepare("UPDATE photos SET stack_id = ?, stack_pos = ? WHERE id = ?").run(
      stackId,
      position,
      id
    );
  }
  stackMembers(stackId) {
    return this.prepare("SELECT * FROM photos WHERE stack_id = ? ORDER BY stack_pos, name").all(
      stackId
    );
  }
  /** How many photos each of these stacks holds. */
  stackSizes(stackIds) {
    const out = /* @__PURE__ */ new Map();
    for (let i = 0; i < stackIds.length; i += 500) {
      const part = stackIds.slice(i, i + 500);
      const rows = this.prepare(
        `SELECT stack_id, COUNT(*) AS n FROM photos WHERE stack_id IN (${part.map(() => "?").join(",")}) GROUP BY stack_id`
      ).all(...part);
      for (const r of rows) out.set(r.stack_id, r.n);
    }
    return out;
  }
  // ── collections ──
  collections() {
    return this.prepare(
      "SELECT * FROM collections ORDER BY sort, name COLLATE NOCASE"
    ).all();
  }
  collection(id) {
    return this.prepare("SELECT * FROM collections WHERE id = ?").get(id);
  }
  saveCollection(c) {
    this.prepare(
      `INSERT INTO collections(id, name, kind, parent, rules, sort, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind,
           parent = excluded.parent, rules = excluded.rules, sort = excluded.sort`
    ).run(c.id, c.name, c.kind, c.parent, c.rules, c.sort, (/* @__PURE__ */ new Date()).toISOString());
  }
  /** Remove a collection and its items; what sat in it (a set's children) moves to the top. */
  removeCollection(id) {
    this.prepare("DELETE FROM collection_items WHERE collection_id = ?").run(id);
    this.prepare("UPDATE collections SET parent = NULL WHERE parent = ?").run(id);
    this.prepare("DELETE FROM collections WHERE id = ?").run(id);
  }
  collectionItems(id) {
    return this.prepare(
      "SELECT photo_id, copy_id FROM collection_items WHERE collection_id = ?"
    ).all(id);
  }
  /** Every manual collection's items, for smart rules that name them. */
  allCollectionItems() {
    return this.prepare("SELECT collection_id, photo_id, copy_id FROM collection_items").all();
  }
  addCollectionItem(id, photoId, copyId) {
    this.prepare(
      "INSERT OR IGNORE INTO collection_items(collection_id, photo_id, copy_id, added_at) VALUES (?, ?, ?, ?)"
    ).run(id, photoId, copyId, (/* @__PURE__ */ new Date()).toISOString());
  }
  removeCollectionItem(id, photoId, copyId) {
    this.prepare(
      "DELETE FROM collection_items WHERE collection_id = ? AND photo_id = ? AND copy_id = ?"
    ).run(id, photoId, copyId);
  }
  /** A deleted copy leaves the collections it was in. */
  removeCopyFromCollections(photoId, copyId) {
    this.prepare("DELETE FROM collection_items WHERE photo_id = ? AND copy_id = ?").run(
      photoId,
      copyId
    );
  }
  hasPhotosIn(folder) {
    return this.prepare("SELECT 1 FROM photos WHERE folder = ? LIMIT 1").get(folder) !== void 0;
  }
  setPhotoMeta(id, meta) {
    this.prepare(
      "UPDATE photos SET rating = ?, flag = ?, label = ?, edited = ?, recipe_key = ? WHERE id = ?"
    ).run(meta.rating, meta.flag, meta.label, meta.edited ? 1 : 0, meta.recipeKey ?? null, id);
  }
  /** Remember a project and the photo it names (see migration 5). */
  registerProject(path2, name, size, originPath) {
    this.prepare(
      `INSERT INTO projects(path, name, size, origin_path) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET name = excluded.name, size = excluded.size, origin_path = excluded.origin_path`
    ).run(path2, name, size, originPath);
  }
  /** Projects made from a photo of this name and size. */
  projectsNamed(name, size) {
    return this.prepare("SELECT path, origin_path FROM projects WHERE name = ? AND size = ?").all(
      name,
      size
    );
  }
  /** The photos a project is tied to. */
  photosWithProject(path2) {
    return this.prepare("SELECT * FROM photos WHERE project_path = ?").all(
      path2
    );
  }
  setProject(id, path2, mtime) {
    this.prepare("UPDATE photos SET project_path = ?, project_mtime = ? WHERE id = ?").run(
      path2,
      mtime,
      id
    );
  }
  /** Every photo using the project at `path`: its mtime is now `mtime` (the index's own commit). */
  projectCommitted(path2, mtime) {
    this.prepare("UPDATE photos SET project_mtime = ? WHERE project_path = ?").run(mtime, path2);
  }
  setSidecarMtime(id, mtime) {
    this.prepare("UPDATE photos SET sidecar_mtime = ? WHERE id = ?").run(mtime, id);
  }
  setCamera(id, camera) {
    this.prepare(
      "UPDATE photos SET camera_json = ?, captured_at = ?, iso = ?, focal = ?, fnumber = ?, exposure = ?, camera = ?, lens = ? WHERE id = ?"
    ).run(JSON.stringify(camera), ...cameraColumns(camera), id);
  }
  /** Every thumbnail file a photo or copy names. */
  thumbPaths() {
    const rows = this.prepare(
      "SELECT thumb_path FROM photos WHERE thumb_path IS NOT NULL UNION SELECT thumb_path FROM copies WHERE thumb_path IS NOT NULL"
    ).all();
    return new Set(rows.map((r) => r.thumb_path));
  }
  /** A file version that could not be read (`key` names it), and why. */
  setFailed(photoId, key, reason) {
    this.prepare("UPDATE photos SET failed_key = ?, failed_reason = ? WHERE id = ?").run(
      key,
      reason,
      photoId
    );
  }
  setNames(photoId, names) {
    this.prepare("UPDATE photos SET names = ?, names_tried = NULL WHERE id = ?").run(names, photoId);
  }
  setNamesTried(photoId, at) {
    this.prepare("UPDATE photos SET names_tried = ? WHERE id = ?").run(at, photoId);
  }
  /** Photos not named yet (nor tried), newest arrivals first, readable ones only. */
  unnamed(limit) {
    return this.prepare(
      `SELECT id FROM photos WHERE names IS NULL AND names_tried IS NULL AND failed_key IS NULL
         ORDER BY COALESCE(added, mtime) DESC LIMIT ?`
    ).all(limit).map((r) => r.id);
  }
  setCullKeep(photoId, keep) {
    this.prepare("UPDATE photos SET cull_keep = ? WHERE id = ?").run(keep ? 1 : 0, photoId);
  }
  /** What suggesting rejects needs of these photos (or of every measured one, `ids` null). */
  cullInputs(ids) {
    const cols = "id, name, rating, flag, cull_keep, mtime, size, cull, cull_key";
    if (ids === null)
      return this.prepare(`SELECT ${cols} FROM photos WHERE cull IS NOT NULL`).all();
    if (ids.length === 0) return [];
    return this.prepare(
      `SELECT ${cols} FROM photos WHERE id IN (${ids.map(() => "?").join(",")})`
    ).all(...ids);
  }
  setCull(photoId, cull, key) {
    this.prepare("UPDATE photos SET cull = ?, cull_key = ? WHERE id = ?").run(cull, key, photoId);
  }
  /** Each readable photo's file version and the key its signals were measured for. */
  cullState() {
    return this.prepare(
      `SELECT id, mtime, size, cull_key, COALESCE(added, mtime) AS added FROM photos
       WHERE failed_key IS NULL ORDER BY COALESCE(added, mtime) DESC`
    ).all();
  }
  /** Signals of these photos, as kept. */
  culls(ids) {
    if (ids.length === 0) return [];
    return this.prepare(
      `SELECT id, mtime, size, cull, cull_key FROM photos WHERE id IN (${ids.map(() => "?").join(",")})`
    ).all(...ids);
  }
  setRawColour(photoId, colour) {
    this.prepare("UPDATE photos SET raw_colour = ? WHERE id = ?").run(colour, photoId);
  }
  setHdr(photoId, kind, key) {
    this.prepare("UPDATE photos SET hdr = ?, hdr_key = ? WHERE id = ?").run(kind, key, photoId);
  }
  setThumb(photoId, copyId, path2, key) {
    if (copyId === null) {
      this.prepare("UPDATE photos SET thumb_path = ?, thumb_key = ? WHERE id = ?").run(
        path2,
        key,
        photoId
      );
    } else {
      this.prepare(
        "UPDATE copies SET thumb_path = ?, thumb_key = ? WHERE photo_id = ? AND copy_id = ?"
      ).run(path2, key, photoId, copyId);
    }
  }
  // ── copies ──
  copiesOf(photoId) {
    return this.prepare("SELECT * FROM copies WHERE photo_id = ? ORDER BY name").all(
      photoId
    );
  }
  /** Every copy of every photo in a folder, in one query. */
  copiesIn(folder) {
    return this.prepare(
      "SELECT c.* FROM copies c JOIN photos p ON p.id = c.photo_id WHERE p.folder = ? ORDER BY c.name"
    ).all(folder);
  }
  replaceCopies(photoId, copies) {
    const existing = new Map(this.copiesOf(photoId).map((c) => [c.copy_id, c]));
    this.prepare("DELETE FROM copies WHERE photo_id = ?").run(photoId);
    const ins = this.prepare(
      "INSERT INTO copies(photo_id, copy_id, name, rating, flag, label, edited, thumb_path, thumb_key, recipe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const c of copies) {
      const old = existing.get(c.id);
      ins.run(
        photoId,
        c.id,
        c.name,
        c.rating,
        c.flag,
        c.label,
        c.edited ? 1 : 0,
        old?.thumb_path ?? null,
        old?.thumb_key ?? null,
        c.recipeKey ?? null
      );
    }
  }
  // ── history (photos without a project; see historytable.ts) ──
  history(itemKey) {
    return this.hist.history(itemKey);
  }
  appendHistory(itemKey, label, recipe2) {
    return this.hist.append(itemKey, label, recipe2);
  }
  amendHistory(itemKey, seq, label, recipe2) {
    return this.hist.amendLast(itemKey, seq, label, recipe2);
  }
  setHistoryHidden(itemKey, seqs, hidden) {
    return this.hist.setHidden(itemKey, seqs, hidden);
  }
  deleteHistory(itemKey, seqs) {
    return this.hist.delete(itemKey, seqs);
  }
  /** An item's history rows as stored, to move them into its project. */
  historyRows(itemKey) {
    return this.hist.rows(itemKey);
  }
  removeHistory(itemKey) {
    this.hist.remove(itemKey);
  }
  // ── painted planes, by reference (see planestore.ts) ──
  /** Keep a plane (a base64 PNG) by its name, its SHA-256 (`planeRef`), as bytes. */
  putPlane(ref, png) {
    this.prepare("INSERT OR IGNORE INTO plane_blobs(hash, png) VALUES (?, ?)").run(
      ref,
      Buffer.from(png, "base64")
    );
    this.planesPut.add(ref);
  }
  /** Planes stored since this index opened: in use now, whatever the history says (see `prunePlanes`). */
  planesPut = /* @__PURE__ */ new Set();
  hasPlane(ref) {
    return this.prepare("SELECT 1 FROM plane_blobs WHERE hash = ?").get(ref) !== void 0;
  }
  plane(ref) {
    const row = this.prepare("SELECT png FROM plane_blobs WHERE hash = ?").get(ref);
    return row && Buffer.from(row.png.buffer, row.png.byteOffset, row.png.byteLength).toString("base64");
  }
  /** Every stored recipe or patch that may name a plane by reference: the edit history's. */
  *historyRecipes() {
    yield* this.hist.json();
  }
  /** Drop the planes not in `keep`. Returns how many went. */
  prunePlanes(keep) {
    const refs = this.prepare("SELECT hash FROM plane_blobs").all().map(
      (r) => r.hash
    );
    let removed = 0;
    this.tx(() => {
      for (const ref of refs) {
        if (keep.has(ref)) continue;
        this.prepare("DELETE FROM plane_blobs WHERE hash = ?").run(ref);
        removed++;
      }
    });
    return removed;
  }
  // ── presets ──
  presets() {
    return this.prepare("SELECT * FROM presets ORDER BY grp, name").all().map((r) => {
      const smart = r.smart ? pixlfile.readSmart(JSON.parse(r.smart)).smart : null;
      return {
        id: r.id,
        name: r.name,
        group: r.grp,
        builtin: false,
        // Saved by an older version: groups it named that are gone go, and the
        // recipe gains what was added since (as a photo's does when read).
        groups: JSON.parse(r.groups).filter((g) => recipe.RECIPE_GROUPS.includes(g)),
        recipe: recipe.normaliseRecipe(JSON.parse(r.recipe), false),
        ...r.wb_op ? { wbOp: JSON.parse(r.wb_op) } : {},
        ...smart ? { smart } : {}
      };
    });
  }
  savePreset(p) {
    this.prepare(
      "INSERT INTO presets(id, name, grp, groups, recipe, wb_op, smart) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, grp = excluded.grp, groups = excluded.groups, recipe = excluded.recipe, wb_op = excluded.wb_op, smart = excluded.smart"
    ).run(
      p.id,
      p.name,
      p.group,
      JSON.stringify(p.groups),
      JSON.stringify(p.recipe),
      p.wbOp ? JSON.stringify(p.wbOp) : null,
      p.smart ? JSON.stringify(p.smart) : null
    );
  }
  removePreset(id) {
    this.prepare("DELETE FROM presets WHERE id = ?").run(id);
  }
  exportPresets() {
    return this.prepare("SELECT * FROM export_presets ORDER BY name").all().map((r) => ({ id: r.id, name: r.name, settings: JSON.parse(r.settings) }));
  }
  saveExportPreset(p) {
    this.prepare(
      "INSERT INTO export_presets(id, name, settings) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, settings = excluded.settings"
    ).run(p.id, p.name, JSON.stringify(p.settings));
  }
  removeExportPreset(id) {
    this.prepare("DELETE FROM export_presets WHERE id = ?").run(id);
  }
  // ── settings ──
  getSetting(key) {
    const row = this.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : void 0;
  }
  setSetting(key, value) {
    this.prepare(
      "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, JSON.stringify(value));
  }
}
const SIDECAR_SUFFIX = ".playroom.json";
function sidecarPath(photoPath) {
  return photoPath + SIDECAR_SUFFIX;
}
function emptySidecar() {
  return {
    app: "pixl-playroom",
    version: 1,
    photo: { rating: 0, flag: null, label: null, recipe: null, snapshots: [] },
    copies: [],
    stack: null,
    rawColour: null,
    names: null
  };
}
function item(v, isRaw) {
  const o = typeof v === "object" && v !== null ? v : {};
  const rating = typeof o.rating === "number" ? Math.max(0, Math.min(5, Math.round(o.rating))) : 0;
  const flag = o.flag === "pick" || o.flag === "reject" ? o.flag : null;
  const label = ["red", "yellow", "green", "blue", "purple"].includes(o.label) ? o.label : null;
  const recipe$1 = o.recipe ? recipe.normaliseRecipe(o.recipe, isRaw) : null;
  const snapshots = Array.isArray(o.snapshots) ? o.snapshots.map((s) => ({ ...s, recipe: recipe.normaliseRecipe(s.recipe, isRaw) })) : [];
  return { rating, flag, label, recipe: recipe$1, snapshots };
}
function stackOf(v) {
  const o = typeof v === "object" && v !== null ? v : {};
  if (typeof o.id !== "string" || !o.id) return null;
  const position = typeof o.position === "number" ? Math.max(0, Math.round(o.position)) : 0;
  return { id: o.id, position };
}
function readSidecar(photoPath, isRaw) {
  const file = sidecarPath(photoPath);
  if (!fs.existsSync(file)) return { sidecar: emptySidecar(), mtime: null };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const copies = Array.isArray(raw.copies) ? raw.copies.map((c) => ({
      ...item(c, isRaw),
      id: String(c.id ?? ""),
      name: String(c.name ?? "Copy")
    })) : [];
    return {
      sidecar: {
        app: "pixl-playroom",
        version: 1,
        photo: item(raw.photo, isRaw),
        copies,
        stack: stackOf(raw.stack),
        rawColour: source.parseRawColour(raw.rawColour),
        names: pixlfile.readNames(raw.names),
        cullKeep: raw.cullKeep === true
      },
      mtime: fs.statSync(file).mtimeMs
    };
  } catch {
    const aside = `${file}.damaged-${Date.now()}`;
    try {
      fs.renameSync(file, aside);
    } catch {
    }
    return { sidecar: emptySidecar(), mtime: null };
  }
}
function saysNothing(s) {
  const p = s.photo;
  return s.copies.length === 0 && s.stack === null && !s.rawColour && !s.names && !s.cullKeep && p.rating === 0 && p.flag === null && p.label === null && p.recipe === null && p.snapshots.length === 0;
}
function writeSidecar(photoPath, sidecar) {
  const file = sidecarPath(photoPath);
  if (saysNothing(sidecar)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return null;
  }
  const tmp = `${file}.tmp-${process.pid}`;
  const { stack, rawColour, names, cullKeep, ...rest } = sidecar;
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        ...rest,
        ...stack ? { stack } : {},
        ...rawColour ? { rawColour } : {},
        ...names ? { names } : {},
        ...cullKeep ? { cullKeep } : {}
      },
      null,
      2
    )
  );
  fs.renameSync(tmp, file);
  return fs.statSync(file).mtimeMs;
}
function itemOf(sidecar, copyId) {
  return copyId === null ? sidecar.photo : sidecar.copies.find((c) => c.id === copyId);
}
const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), "Pixl Projects");
function projectsRoot(loc) {
  return typeof loc === "object" ? loc.folder : DEFAULT_PROJECTS_DIR;
}
function projectsDirFor(root, folder) {
  const tag = crypto.createHash("sha1").update(folder).digest("hex").slice(0, 6);
  return path.join(root, `${path.basename(folder) || "Photos"}-${tag}`);
}
const stemOf = (name) => path.basename(name, path.extname(name));
function projectName(photoName, siblings) {
  const stem = stemOf(photoName).toLowerCase();
  const shared = siblings.some(
    (n) => n !== photoName && stemOf(n).toLowerCase() === stem && !n.toLowerCase().endsWith(pixlfile.PIXL_EXT)
  );
  return (shared ? photoName : stemOf(photoName)) + pixlfile.PIXL_EXT;
}
function writable(dir) {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
function free(dir, name) {
  let path$1 = path.join(dir, name);
  for (let n = 2; fs.existsSync(path$1); n++) path$1 = path.join(dir, `${stemOf(name)} (${n})${pixlfile.PIXL_EXT}`);
  return path$1;
}
function newProjectPath(photoPath, loc, imageNames) {
  const folder = path.dirname(photoPath);
  const name = projectName(path.basename(photoPath), imageNames);
  if (loc === "beside" && writable(folder)) return free(folder, name);
  const dir = projectsDirFor(projectsRoot(loc === "beside" ? "home" : loc), folder);
  fs.mkdirSync(dir, { recursive: true });
  return free(dir, name);
}
function projectFilesIn(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(pixlfile.PIXL_EXT) && !n.startsWith(".")).map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}
function projectDirsFor(folder, roots) {
  return [folder, ...roots.map((r) => projectsDirFor(r, folder))];
}
function locationOf(v) {
  if (v === "home") return "home";
  if (v && typeof v === "object" && typeof v.folder === "string")
    return { folder: v.folder };
  return "beside";
}
function xmpPathFor(photoPath, isRaw) {
  if (!isRaw) return photoPath + ".xmp";
  return path.join(path.dirname(photoPath), path.basename(photoPath, path.extname(photoPath)) + ".xmp");
}
const emptyMeta = () => ({
  title: null,
  caption: null,
  copyright: null,
  keywords: []
});
const metaIsEmpty = (m) => !m.title && !m.caption && !m.copyright && m.keywords.length === 0;
const sameMeta = (a, b) => a.title === b.title && a.caption === b.caption && a.copyright === b.copyright && a.keywords.length === b.keywords.length && a.keywords.every((k, i) => k === b.keywords[i]);
function applyMetaPatch(meta, patch) {
  const field = (v, was) => v === void 0 ? was : v === null || !v.trim() ? null : v.trim();
  let keywords = patch.keywords ? pixlfile.normaliseKeywords(patch.keywords) : [...meta.keywords];
  const remove = pixlfile.normaliseKeywords(patch.removeKeywords ?? []);
  keywords = keywords.filter((k) => !remove.some((r) => pixlfile.isUnder(k, r)));
  keywords = pixlfile.normaliseKeywords([...keywords, ...patch.addKeywords ?? []]);
  return {
    title: field(patch.title, meta.title),
    caption: field(patch.caption, meta.caption),
    copyright: field(patch.copyright, meta.copyright),
    keywords
  };
}
const XMP_TAGS = [
  "XMP-dc:Title",
  "XMP-dc:Description",
  "XMP-dc:Rights",
  "XMP-dc:Subject",
  "XMP-lr:HierarchicalSubject"
];
function metaToTags(meta) {
  const text2 = (s) => s && s.trim() ? s : null;
  const keywords = pixlfile.normaliseKeywords(meta.keywords);
  return {
    "XMP-dc:Title": text2(meta.title),
    "XMP-dc:Description": text2(meta.caption),
    "XMP-dc:Rights": text2(meta.copyright),
    "XMP-dc:Subject": keywords.length > 0 ? pixlfile.flatSubjects(keywords) : null,
    "XMP-lr:HierarchicalSubject": keywords.length > 0 ? keywords : null
  };
}
function list(v) {
  if (v === void 0 || v === null || v === "") return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x));
}
function text(v) {
  if (v === void 0 || v === null) return null;
  const s = Array.isArray(v) ? v.map(String).join(", ") : String(v);
  return s.trim() ? s : null;
}
function tagsToMeta(tags) {
  const hier = pixlfile.normaliseKeywords(list(tags["XMP-lr:HierarchicalSubject"]));
  const levels = new Set(pixlfile.flatSubjects(hier));
  const flat = pixlfile.normaliseKeywords(list(tags["XMP-dc:Subject"]).map((s) => s.replace(/\|/g, " ")));
  return {
    title: text(tags["XMP-dc:Title"]),
    caption: text(tags["XMP-dc:Description"]),
    copyright: text(tags["XMP-dc:Rights"]),
    keywords: pixlfile.normaliseKeywords([...hier, ...flat.filter((s) => !levels.has(s))])
  };
}
function exiftoolXmp() {
  return {
    async read(xmpPath) {
      if (!fs.existsSync(xmpPath)) return null;
      try {
        const tags = await (await pixlfile.exiftool()).readRaw(xmpPath, {
          readArgs: ["-G1", ...XMP_TAGS.map((t) => "-" + t)]
        });
        return tagsToMeta(tags);
      } catch (err) {
        console.warn("cannot read", xmpPath, err.message);
        return null;
      }
    },
    async write(xmpPath, meta) {
      await (await pixlfile.exiftool()).write(xmpPath, metaToTags(meta), {
        writeArgs: ["-overwrite_original"]
      });
    },
    end: pixlfile.endExiftool
  };
}
const CHUNK = 200;
const RESCAN_FRESH_MS = 1e4;
const DEEP_MAX_FOLDERS = 300;
const DEEP_MAX_DEPTH = 8;
const NAME_ORDER = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
const WATCH_SETTLE_MS = 400;
const PASSING_FILE = /(-journal|\.creating-\d+|\.part-\d+)$/;
const PACKAGE_DIR = /\.(app|bundle|photoslibrary|lrdata|lrlibrary|fcpbundle|imovielibrary)$/i;
const GC_DELAY_MS = 1500;
const versionOf = (row) => `${row.path}:${row.mtime}:${row.size}`;
const nextTurn = () => new Promise((r) => setImmediate(r));
const hashKeyOf = (row) => `${row.mtime}-${row.size}`;
function folderMtime(folder) {
  try {
    return fs.statSync(folder).mtimeMs;
  } catch {
    return null;
  }
}
function mapRecipes(s, fn) {
  const item2 = (it) => ({
    ...it,
    recipe: it.recipe && fn(it.recipe),
    snapshots: it.snapshots.map((sn) => ({ ...sn, recipe: fn(sn.recipe) }))
  });
  return { ...s, photo: item2(s.photo), copies: s.copies.map(item2) };
}
function thumbRecipeKey(recipe$1, raw) {
  if (!recipe$1 || !recipe.isEdited(recipe$1, raw)) return "plain";
  return recipe.hash32(JSON.stringify(pixlfile.slim(recipe$1))).toString(16);
}
const knownHash = (row) => row.hash_key === hashKeyOf(row) ? row.content_hash : null;
function isOriginOf(origin, row) {
  const hash = knownHash(row);
  if (origin.sha1 && hash) return origin.sha1 === hash;
  return origin.size === row.size;
}
function isRenamed(origin, row) {
  if (row.ext.toLowerCase() !== origin.ext.toLowerCase()) return false;
  const hash = knownHash(row);
  if (origin.sha1 && hash) return origin.sha1 === hash;
  return origin.size === row.size && origin.mtime === row.mtime;
}
function sha1(path2) {
  return new Promise((resolveHash, reject) => {
    const h = crypto.createHash("sha1");
    fs.createReadStream(path2).on("data", (d) => h.update(d)).on("error", reject).on("end", () => resolveHash(h.digest("hex")));
  });
}
const unique = (xs) => [...new Set(xs)];
class IndexService {
  store;
  cacheRoot;
  emit;
  /** When each folder was last scanned (a listing a moment after needs no walk). */
  scannedAt = /* @__PURE__ */ new Map();
  /** The folder shown, watched (with those below it when `deep`), and since when. */
  watchers = /* @__PURE__ */ new Map();
  watchTimers = /* @__PURE__ */ new Map();
  /** Files whose thumbnail failed, per version, with why (and in the row, for the next launch). */
  failed = /* @__PURE__ */ new Map();
  isFailed(row) {
    const v = versionOf(row);
    return this.failed.has(v) || row.failed_key === v;
  }
  scans = /* @__PURE__ */ new Map();
  filling = /* @__PURE__ */ new Set();
  fillAgain = /* @__PURE__ */ new Set();
  xmp;
  /** `.xmp` reads and writes, one at a time: two edits of one file never interleave. */
  xmpChain = Promise.resolve();
  closed = false;
  /** The `.pixl` projects open now (see pixlfile.ts). */
  projects = new pixlfile.ProjectPool(2e3, (path2) => this.committed(path2));
  /** What each project file names, by its path, while the file is unchanged. */
  origins = /* @__PURE__ */ new Map();
  constructor(opts) {
    fs.mkdirSync(opts.userData, { recursive: true });
    this.store = Store.open(path.join(opts.userData, "playroom.db"));
    this.cacheRoot = path.join(opts.userData, "cache");
    this.emit = opts.emit;
    this.xmp = opts.xmp ?? exiftoolXmp();
  }
  /** Photos open in Develop: their projects stay open between edits (see `holdOpen`). */
  held = /* @__PURE__ */ new Set();
  /**
   * Keep a photo's project open while it is in Develop (`on`), so every edit
   * finds its connection and prepared statements; let it close when it leaves.
   */
  holdOpen(key, on) {
    const { photoId } = pixlfile.parseKey(key);
    if (on) this.held.add(photoId);
    else this.held.delete(photoId);
    const path2 = this.projectOf(this.row(key));
    if (!path2) return;
    this.projects.pin(path2, on);
    if (!on) this.projects.flush(path2);
  }
  /** Commit what every project has gathered (before a quit, or a backup). */
  flushProjects() {
    this.projects.flush();
  }
  /** A project's batch is on disk: its new mtime is the index's own write, not a change to read back. */
  committed(path2) {
    if (this.closed || !fs.existsSync(path2)) return;
    this.store.projectCommitted(path2, fs.statSync(path2).mtimeMs);
  }
  close() {
    this.watchOnly(null);
    this.projects.drop();
    this.closed = true;
    this.store.close();
    void this.xmp.end().catch(() => {
    });
  }
  xmpSerial(fn) {
    const run = this.xmpChain.then(fn, fn);
    this.xmpChain = run.catch(() => void 0);
    return run;
  }
  // ── folders ──
  /**
   * A folder's items as the index has them, at once; the disk is looked at
   * afterwards and a `changed` event follows only if it differs. A folder
   * the index has never seen is scanned first.
   */
  async listFolder(folder, recent = true) {
    if (recent) this.store.touchFolder(folder);
    if (this.store.hasPhotosIn(folder)) {
      const last = this.scannedAt.get(folder);
      if (last && Date.now() - last.at < RESCAN_FRESH_MS && last.dirMtime === folderMtime(folder))
        return this.items(folder);
      const since = this.watchedSince(folder);
      if (last && since !== void 0 && since <= last.at) return this.items(folder);
      setImmediate(() => {
        if (this.closed) return;
        this.rescan(folder).catch((err) => console.warn("scan failed", folder, err));
      });
    } else {
      await this.rescan(folder, false);
    }
    return this.items(folder);
  }
  /**
   * Watch the folder shown (with those below it when `deep`), and no other:
   * a change made outside the app (a file copied in, renamed, deleted, a
   * sidecar edited) is scanned a moment later, and the library hears of it
   * as `changed`. Null stops watching.
   */
  watchOnly(folder, deep = false) {
    for (const [f, w] of this.watchers) {
      if (f === folder && w.deep === deep) continue;
      w.watcher.close();
      this.watchers.delete(f);
    }
    if (!folder || this.closed || this.watchers.has(folder)) return;
    try {
      const watcher = fs.watch(
        folder,
        { recursive: deep, persistent: false },
        (_type, name) => this.changedOnDisk(folder, deep, name === null ? "" : String(name))
      );
      watcher.on("error", () => {
        watcher.close();
        if (this.watchers.get(folder)?.watcher === watcher) this.watchers.delete(folder);
      });
      this.watchers.set(folder, { watcher, since: Date.now(), deep });
    } catch (err) {
      console.warn("cannot watch", folder, err.message);
    }
  }
  /** Since when a watcher has covered `folder`, or undefined when none does. */
  watchedSince(folder) {
    for (const [root, w] of this.watchers) {
      if (root === folder) return w.since;
      if (w.deep && folder.startsWith(root) && /[\\/]/.test(folder[root.length] ?? ""))
        return w.since;
    }
    return void 0;
  }
  /** Something changed under a watched folder: the folder it is in is scanned once it settles. */
  changedOnDisk(root, deep, name) {
    if (this.closed || PASSING_FILE.test(name)) return;
    const dir = deep && name ? path.dirname(path.join(root, name)) : root;
    clearTimeout(this.watchTimers.get(dir));
    const t = setTimeout(() => {
      this.watchTimers.delete(dir);
      if (this.closed) return;
      this.rescan(dir).catch((err) => console.warn("scan failed", dir, err));
    }, WATCH_SETTLE_MS);
    t.unref?.();
    this.watchTimers.set(dir, t);
  }
  /** A folder's subfolders, one level (by name): what the sidebar's tree opens out. */
  subfolders(folder) {
    let entries;
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !PACKAGE_DIR.test(e.name)).map((e) => ({ path: path.join(folder, e.name), name: e.name })).sort((a, b) => NAME_ORDER.compare(a.name, b.name));
  }
  /**
   * A folder's items with its subfolders' (breadth first, within
   * DEEP_MAX_FOLDERS and DEEP_MAX_DEPTH; links to folders are not followed).
   * Only the folder itself joins the recent ones.
   */
  async listFolderDeep(folder) {
    const items = [...await this.listFolder(folder)];
    const queue = this.subfolders(folder).map((f) => ({
      path: f.path,
      depth: 1
    }));
    for (let n = 1; queue.length > 0 && n < DEEP_MAX_FOLDERS; n++) {
      const { path: path2, depth } = queue.shift();
      if (this.closed) break;
      items.push(...await this.listFolder(path2, false));
      if (depth < DEEP_MAX_DEPTH)
        queue.push(...this.subfolders(path2).map((f) => ({ path: f.path, depth: depth + 1 })));
    }
    return items;
  }
  /**
   * Bring a folder's rows in line with the disk. One scan per folder at a
   * time: a call while one runs asks for another pass and shares its
   * promise. `announce` sends `changed` when anything differed.
   */
  rescan(folder, announce = true) {
    const running = this.scans.get(folder);
    if (running) {
      running.again = true;
      running.announce ||= announce;
      return running.done;
    }
    const scan = { again: false, announce, done: Promise.resolve() };
    this.scans.set(folder, scan);
    scan.done = (async () => {
      let changed = 0;
      try {
        do {
          scan.again = false;
          const dirMtime = folderMtime(folder);
          changed += await this.scan(folder);
          this.scannedAt.set(folder, { at: Date.now(), dirMtime });
        } while (scan.again);
      } finally {
        this.scans.delete(folder);
      }
      if (this.closed) return;
      if (changed > 0 && scan.announce) this.emit({ name: "changed", folder });
      this.fillXmp(folder).catch((err) => console.warn("xmp fill failed", folder, err));
      this.fillCameras(folder).catch((err) => console.warn("exif fill failed", folder, err));
    })();
    return scan.done;
  }
  /** One pass over a folder. Returns how many rows it changed. */
  async scan(folder) {
    let names;
    try {
      names = fs.readdirSync(folder);
    } catch (err) {
      console.warn("cannot read folder", folder, err.message);
      return 0;
    }
    const known = new Map(this.store.photosIn(folder).map((r) => [r.path, r]));
    const present = /* @__PURE__ */ new Set();
    let changed = 0;
    for (let i = 0; i < names.length; i += CHUNK) {
      if (i > 0) await nextTurn();
      if (this.closed) return changed;
      const chunk = names.slice(i, i + CHUNK);
      changed += this.store.tx(() => {
        let n = 0;
        for (const name of chunk) {
          if (name.startsWith(".")) continue;
          const ext = path.extname(name).slice(1).toLowerCase();
          if (!source.IMAGE_EXTENSIONS.includes(ext)) continue;
          const path$1 = path.join(folder, name);
          let st;
          try {
            st = fs.statSync(path$1);
          } catch {
            continue;
          }
          if (!st.isFile()) continue;
          present.add(path$1);
          let row = known.get(path$1);
          if (!row || row.size !== st.size || row.mtime !== st.mtimeMs || row.added == null) {
            row = this.store.upsertPhoto({
              path: path$1,
              folder,
              name,
              ext,
              size: st.size,
              mtime: st.mtimeMs,
              isRaw: source.isRawExt(ext),
              // A filesystem that keeps no birth time reports 0.
              added: st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs
            });
            n++;
          }
          if (this.syncTruth(row)) n++;
        }
        return n;
      });
    }
    changed += this.store.tx(() => this.linkProjects(folder, present));
    changed += this.store.tx(() => this.store.removeMissing(folder, present));
    return changed;
  }
  // ── projects ──
  /** Where new projects go (Settings → Projects). */
  location() {
    return locationOf(this.store.getSetting("projects.location"));
  }
  /** The projects folders a folder's projects may be in besides the folder itself. */
  projectRoots() {
    const loc = this.location();
    const roots = [DEFAULT_PROJECTS_DIR];
    if (typeof loc === "object" && !roots.includes(projectsRoot(loc))) roots.push(projectsRoot(loc));
    return roots;
  }
  /** The photo a project file names, read once per version of the file. */
  originOf(path2) {
    const stamp = pixlfile.fileStamp(path2);
    const hit = this.origins.get(path2);
    if (hit && (hit.stamp === stamp || this.projects.leftAs(path2, stamp))) {
      hit.stamp = stamp;
      return hit.origin;
    }
    const origin = this.projects.isOpen(path2) ? this.projects.use(path2, (p) => p.origin()) : pixlfile.PixlFile.peekOrigin(path2);
    this.origins.set(path2, { stamp, origin });
    return origin;
  }
  /** The row's project, when it has one that is still there. */
  projectOf(row) {
    return row.project_path && fs.existsSync(row.project_path) ? row.project_path : null;
  }
  /**
   * Find the folder's projects (beside its photos and in the projects
   * folders) and tie each to its photo by name.
   *
   * - A project whose photo is not in the folder (moved, deleted) stands in
   *   for it: it is listed as the photo, developed from the original it
   *   carries. Its path joins `present`.
   * - A photo with no project here looks for one made from a photo of its
   *   name and size whose original is gone (it moved away from its project).
   * - A photo whose project went has only what a sidecar says again.
   *
   * A photo's project is read into the index when it changed. Returns how
   * many photos changed.
   */
  linkProjects(folder, present) {
    const rows = this.store.photosIn(folder);
    const photos = rows.filter((r) => present.has(r.path));
    const byName = new Map(photos.map((r) => [r.name, r]));
    let n = 0;
    const claimed = /* @__PURE__ */ new Set();
    const taken = /* @__PURE__ */ new Set();
    const link = (row, path2) => {
      claimed.add(row.id);
      taken.add(path2);
      if (row.project_path !== path2) {
        this.store.setProject(row.id, path2, null);
        row.project_path = path2;
        row.project_mtime = null;
      }
      if (this.syncProject(row)) n++;
    };
    const unlink = (row) => {
      this.store.setProject(row.id, null, null);
      row.project_path = null;
      row.sidecar_mtime = -1;
      if (this.syncSidecar(row)) n++;
    };
    const orphans = [];
    for (const dir of projectDirsFor(folder, this.projectRoots())) {
      for (const path2 of projectFilesIn(dir)) {
        const origin = this.originOf(path2);
        if (!origin) continue;
        this.store.registerProject(path2, origin.name, origin.size, origin.path);
        const row = byName.get(origin.name);
        if (!row || !isOriginOf(origin, row)) {
          if (row?.project_path === path2) unlink(row);
          orphans.push({ path: path2, origin });
          continue;
        }
        if (claimed.has(row.id)) continue;
        if (row.project_path && row.project_path !== path2 && fs.existsSync(row.project_path)) continue;
        link(row, path2);
      }
    }
    for (const row of photos) {
      if (claimed.has(row.id) || this.projectOf(row)) continue;
      const found = this.store.projectsNamed(row.name, row.size).find((c) => !taken.has(c.path) && fs.existsSync(c.path) && !fs.existsSync(c.origin_path));
      if (!found) continue;
      this.projects.write(found.path, (p) => {
        const o = p.origin();
        if (o) p.setOrigin({ ...o, path: row.path });
      });
      this.projects.flush(found.path);
      this.store.registerProject(found.path, row.name, row.size, row.path);
      this.origins.delete(found.path);
      link(row, found.path);
    }
    for (const { path: path2, origin } of orphans) {
      if (taken.has(path2)) continue;
      const renamed = photos.find(
        (r) => !claimed.has(r.id) && !this.projectOf(r) && isRenamed(origin, r)
      );
      if (renamed) {
        this.projects.write(
          path2,
          (p) => p.setOrigin({ ...origin, name: renamed.name, path: renamed.path })
        );
        this.projects.flush(path2);
        this.store.registerProject(path2, renamed.name, renamed.size, renamed.path);
        this.origins.delete(path2);
        link(renamed, path2);
        continue;
      }
      const elsewhere = this.store.photosWithProject(path2).some((r) => r.path !== path2 && fs.existsSync(r.path));
      if (elsewhere) continue;
      present.add(path2);
      const row = this.store.upsertPhoto({
        path: path2,
        folder,
        name: origin.name,
        ext: origin.ext,
        size: origin.size,
        mtime: origin.mtime,
        isRaw: origin.isRaw
      });
      link(row, path2);
    }
    for (const row of photos) {
      if (!row.project_path || claimed.has(row.id) || fs.existsSync(row.project_path)) continue;
      this.store.setProject(row.id, null, null);
      row.project_path = null;
      row.sidecar_mtime = -1;
      if (this.syncSidecar(row)) n++;
    }
    return n;
  }
  /** The photo's project read into the index when it changed on disk. Returns whether it had. */
  syncProject(row) {
    const path2 = this.projectOf(row);
    if (!path2) return false;
    const mtime = fs.statSync(path2).mtimeMs;
    if (mtime === row.project_mtime) return false;
    const truth = this.projects.use(path2, (p) => p.read(row.is_raw === 1, false));
    this.mirror(row, truth, mtime, "project");
    return true;
  }
  /** Mirror whichever holds the photo's truth: its project, else its sidecar. */
  syncTruth(row) {
    return this.projectOf(row) ? this.syncProject(row) : this.syncSidecar(row);
  }
  /** The image files in a folder, by name (for a RAW+JPEG pair's project names). */
  imageNames(folder) {
    try {
      return fs.readdirSync(folder).filter(
        (n) => source.IMAGE_EXTENSIONS.includes(path.extname(n).slice(1).toLowerCase())
      );
    } catch {
      return [];
    }
  }
  /**
   * Give a photo its project, holding `truth` (what its sidecar said, with the
   * change that called for a project): its recipes, copies, snapshots, rating
   * and stack, the edit history the index kept for it and its copies, and the
   * painted planes all of those name. Once the project is whole on disk the
   * sidecar and the index's history go: the project is the truth from here.
   */
  createProject(row, truth) {
    const origin = {
      name: row.name,
      ext: row.ext,
      size: row.size,
      mtime: row.mtime,
      path: row.path,
      isRaw: row.is_raw === 1,
      sha1: knownHash(row)
    };
    const keys = [null, ...truth.copies.map((c) => c.id)].map((copyId) => ({
      copyId,
      key: pixlfile.keyOf(row.id, copyId)
    }));
    const fill = (p) => {
      p.write(truth, this.planeOf);
      for (const { copyId, key } of keys) {
        const rows = this.store.historyRows(key);
        if (rows.length === 0) continue;
        p.importHistory(copyId, rows);
        for (const r of rows)
          for (const ref of pixlfile.refsIn(`${r.recipe} ${r.patch ?? ""}`)) {
            const png = this.store.plane(ref);
            if (png !== void 0) p.putPlane(ref, png);
          }
      }
    };
    const names = this.imageNames(row.folder);
    let path2;
    try {
      path2 = newProjectPath(row.path, this.location(), names);
      pixlfile.PixlFile.create(path2, origin, fill).close();
    } catch (err) {
      if (this.location() !== "beside") throw err;
      path2 = newProjectPath(row.path, "home", names);
      pixlfile.PixlFile.create(path2, origin, fill).close();
    }
    for (const { key } of keys) this.store.removeHistory(key);
    const side = sidecarPath(row.path);
    if (fs.existsSync(side)) fs.unlinkSync(side);
    const mtime = fs.statSync(path2).mtimeMs;
    this.store.setProject(row.id, path2, mtime);
    this.store.setSidecarMtime(row.id, null);
    row.project_path = path2;
    row.project_mtime = mtime;
    this.origins.delete(path2);
    this.store.registerProject(path2, row.name, row.size, row.path);
    this.mirror(row, truth, mtime, "project");
    this.emit({ name: "project", key: pixlfile.keyOf(row.id, null) });
    if (this.held.has(row.id)) this.projects.pin(path2, true);
    return path2;
  }
  // ── the original, as the project carries it ──
  /**
   * The photo's row for reading its original. With a project, `seed_path` is
   * where the photo was when the project was made (a grain seed that
   * survives a move), and when the file itself is gone (moved, deleted, or a
   * project standing in for it) `embedded` is the project's own copy, written
   * out to the cache once.
   */
  sourceRow(key) {
    return this.withOriginal(this.row(key));
  }
  withOriginal(row) {
    const project = this.projectOf(row);
    if (!project) return row;
    const out = { ...row };
    const origin = this.originOf(project);
    if (origin) out.seed_path = origin.path;
    if (row.path === project || !fs.existsSync(row.path))
      out.embedded = this.writeOriginal(row, project);
    return out;
  }
  /** The project's original written out to the photo's cache (once), or null when it has none yet. */
  writeOriginal(row, project) {
    return this.projects.use(project, (p) => {
      const o = p.original();
      if (o?.state !== "ready" || !o.blob) return null;
      const info = p.blob(o.blob);
      if (!info) return null;
      const ext = o.kind === "verbatim" ? row.ext : o.kind === "dng" ? "dng" : "jxl";
      const dir = path.join(this.cacheRoot, "photos", String(row.id));
      fs.mkdirSync(dir, { recursive: true });
      const path$1 = path.join(dir, `original-${o.blob.slice(0, 16)}.${ext}`);
      if (!fs.existsSync(path$1) && !p.writeBlobTo(o.blob, path$1)) return null;
      return { path: path$1, codec: info.codec };
    });
  }
  /**
   * What a photo's project carries of its original: nothing yet, being made,
   * or ready (and how). `project` null: the photo has no project.
   */
  originalState(key) {
    const row = this.row(key);
    const project = this.projectOf(row);
    if (!project) return { project: null, state: "none", kind: null, bytes: null };
    return this.projects.use(project, (p) => {
      const o = p.original();
      if (!o) return { project, state: "none", kind: null, bytes: null };
      return {
        project,
        state: o.state,
        kind: o.kind,
        bytes: o.blob ? p.blob(o.blob)?.bytes ?? null : null
      };
    });
  }
  /**
   * Store the original in the photo's project: `file` (made by main, in the
   * cache) holds it as `kind` says. The project keeps it from here; `file` is
   * main's to remove. Written in pieces: every other request (an edit being
   * saved) is answered between them, not after the whole file.
   */
  async putOriginal(key, file, kind, info) {
    const project = this.projectOf(this.row(key));
    if (!project) return;
    const hash = await pixlfile.putBlobFileInPieces((fn) => this.projects.write(project, fn), file, {
      kind: "original",
      codec: info.codec,
      width: info.width,
      height: info.height,
      channels: null,
      depth: null
    });
    if (!fs.existsSync(project)) return;
    const replaced = this.projects.write(project, (p) => {
      const before = p.original();
      p.setOriginal({ kind, blob: hash, state: "ready", note: info.note });
      return before?.blob && before.blob !== hash;
    });
    if (replaced) this.gcLater(project);
    this.noteProjectWrite(key);
  }
  /** Projects whose unused planes and blobs are due to go (see `gcLater`). */
  gcDue = /* @__PURE__ */ new Map();
  /**
   * Clear a project of what nothing names, a moment after the change that
   * left it (not inside that request), and give the space back to the disk a
   * step at a time, answering other requests between the steps.
   */
  gcLater(project) {
    clearTimeout(this.gcDue.get(project));
    const t = setTimeout(() => {
      this.gcDue.delete(project);
      if (this.closed || !fs.existsSync(project)) return;
      this.projects.write(project, (p) => p.gc());
      const step = () => {
        if (this.closed || !fs.existsSync(project)) return;
        if (this.projects.write(project, (p) => p.vacuumStep())) setImmediate(step);
      };
      step();
    }, GC_DELAY_MS);
    t.unref?.();
    this.gcDue.set(project, t);
  }
  // ── blobs: pixel steps' images and masks ──
  /**
   * Keep a file (made by main, in the cache) in the photo's project, by its
   * content: a pixel step's image or mask. The photo gets its project if it
   * has none yet (a pixel step is an edit). Returns the blob's hash.
   */
  async putBlob(key, file, info) {
    const project = this.ensureProject(this.row(key));
    const hash = await pixlfile.putBlobFileInPieces((fn) => this.projects.write(project, fn), file, {
      ...info,
      channels: null,
      depth: null
    });
    this.noteProjectWrite(key);
    return hash;
  }
  /**
   * Write a blob of the photo's project out to the photo's cache (once):
   * `<cache>/photos/<id>/blobs/<hash>.<ext>`. Null when the project has no
   * such blob.
   */
  blobFile(key, hash, ext) {
    const row = this.row(key);
    const project = this.projectOf(row);
    if (!project) return null;
    const dir = path.join(this.cacheRoot, "photos", String(row.id), "blobs");
    const path$1 = path.join(dir, `${hash}.${ext}`);
    if (fs.existsSync(path$1)) return path$1;
    fs.mkdirSync(dir, { recursive: true });
    return this.projects.use(project, (p) => p.writeBlobTo(hash, path$1) ? path$1 : null);
  }
  /** The original could not be embedded: say why, so it is not tried on every open. */
  originalFailed(key, note) {
    const project = this.projectOf(this.row(key));
    if (!project) return;
    this.projects.write(
      project,
      (p) => p.setOriginal({ kind: "verbatim", blob: null, state: "failed", note })
    );
    this.noteProjectWrite(key);
  }
  /** Make sure the photo has a project (made from its sidecar if not). Returns its path. */
  ensureProject(row) {
    return this.projectOf(row) ?? this.createProject(row, this.readSide(row));
  }
  /** Re-read a sidecar into the index when it changed on disk. Returns whether it had. */
  syncSidecar(row) {
    const file = row.path + SIDECAR_SUFFIX;
    const mtime = fs.existsSync(file) ? fs.statSync(file).mtimeMs : null;
    if (mtime === row.sidecar_mtime) return false;
    this.mirror(row, this.readSide(row), mtime);
    return true;
  }
  /** Copy what the sidecar (or project) says into the index, and note the file's mtime. */
  mirror(row, sidecar, mtime, from = "sidecar") {
    this.store.tx(() => this.mirrorRows(row, sidecar, mtime, from));
  }
  mirrorRows(row, sidecar, mtime, from) {
    const raw = row.is_raw === 1;
    const p = sidecar.photo;
    this.store.setPhotoMeta(row.id, {
      rating: p.rating,
      flag: p.flag,
      label: p.label,
      edited: p.recipe !== null && recipe.isEdited(p.recipe, raw),
      recipeKey: thumbRecipeKey(p.recipe, raw)
    });
    this.store.replaceCopies(
      row.id,
      sidecar.copies.map((c) => ({
        id: c.id,
        name: c.name,
        rating: c.rating,
        flag: c.flag,
        label: c.label,
        edited: c.recipe !== null && recipe.isEdited(c.recipe, raw),
        recipeKey: thumbRecipeKey(c.recipe, raw)
      }))
    );
    this.store.setStack(row.id, sidecar.stack?.id ?? null, sidecar.stack?.position ?? null);
    if (sidecar.rawColour) this.store.setRawColour(row.id, sidecar.rawColour);
    if (sidecar.names) this.store.setNames(row.id, JSON.stringify(sidecar.names));
    if (sidecar.cullKeep) this.store.setCullKeep(row.id, true);
    if (from === "project") {
      this.store.setProject(row.id, row.project_path, mtime);
      row.project_mtime = mtime;
    } else this.store.setSidecarMtime(row.id, mtime);
  }
  /** Read exif for the folder's photos that have none yet; `changed` when any were filled. */
  async fillCameras(folder) {
    if (this.filling.has(folder)) {
      this.fillAgain.add(folder);
      return;
    }
    this.filling.add(folder);
    let filled = 0;
    try {
      do {
        this.fillAgain.delete(folder);
        for (const row of this.store.photosIn(folder)) {
          if (row.camera_json) continue;
          const camera = await readCamera(row.path);
          if (this.closed) return;
          if (!this.store.photo(row.id)) continue;
          this.store.setCamera(row.id, camera);
          filled++;
        }
      } while (this.fillAgain.has(folder));
    } finally {
      this.filling.delete(folder);
    }
    if (filled > 0) this.emit({ name: "changed", folder });
  }
  /**
   * Mirror the folder's `.xmp` sidecars that changed on disk (or went) into
   * the index; `changed` and `sources` when any did.
   */
  async fillXmp(folder) {
    const changed = await this.xmpSerial(async () => {
      let n = 0;
      let i = 0;
      for (const row of this.store.photosIn(folder)) {
        if (++i % CHUNK === 0) await nextTurn();
        if (this.closed) return n;
        const file = xmpPathFor(row.path, row.is_raw === 1);
        let mtime = null;
        try {
          mtime = fs.statSync(file).mtimeMs;
        } catch {
        }
        if (mtime === row.xmp_mtime) continue;
        const meta = mtime === null ? emptyMeta() : await this.xmp.read(file) ?? emptyMeta();
        if (this.closed) return n;
        if (!this.store.photo(row.id)) continue;
        this.store.tx(() => this.store.setXmp(row.id, meta, meta.keywords, mtime));
        n++;
      }
      return n;
    });
    if (changed > 0 && !this.closed) {
      this.emit({ name: "changed", folder });
      this.emit({ name: "sources" });
    }
  }
  recentFolders() {
    return this.store.recentFolders().filter((f) => fs.existsSync(f));
  }
  /** Take a folder off the sidebar's list; it comes back when it is opened again. */
  forgetFolder(folder) {
    this.store.forgetFolder(folder);
  }
  /**
   * Files (dropped, or handed over by the OS) as the folder of the first and
   * their items' keys, indexing any folder the index has not seen. A folder
   * given as the first path is that folder, with no keys.
   */
  async resolvePaths(paths) {
    if (paths.length === 0) return { folder: null, keys: [] };
    if (paths.some((p) => p.toLowerCase().endsWith(pixlfile.PIXL_EXT))) return this.resolveProjects(paths);
    const first = path.resolve(paths[0]);
    let isDir = false;
    try {
      isDir = fs.statSync(first).isDirectory();
    } catch {
    }
    const folder = isDir ? first : path.dirname(first);
    await this.listFolder(folder);
    if (isDir) return { folder, keys: [] };
    const keys = [];
    const scanned = /* @__PURE__ */ new Set();
    for (const p of paths.map((x) => path.resolve(x))) {
      let row = this.store.photoByPath(p);
      if (!row && !scanned.has(path.dirname(p))) {
        scanned.add(path.dirname(p));
        await this.rescan(path.dirname(p), false);
        row = this.store.photoByPath(p);
      }
      if (row) keys.push(pixlfile.keyOf(row.id, null));
    }
    return { folder, keys };
  }
  async resolveProjects(paths) {
    const projects = paths.map((p) => path.resolve(p)).filter((p) => p.toLowerCase().endsWith(pixlfile.PIXL_EXT));
    const origin = this.originOf(projects[0]);
    if (!origin) return { folder: null, keys: [] };
    const home = path.dirname(origin.path);
    const folder = fs.existsSync(home) ? home : path.dirname(projects[0]);
    await this.rescan(folder, false);
    const keys = [];
    for (const p of projects) {
      let rows = this.store.photosWithProject(p);
      if (rows.length === 0) {
        const o = this.originOf(p);
        if (o) await this.rescan(fs.existsSync(path.dirname(o.path)) ? path.dirname(o.path) : path.dirname(p), false);
        rows = this.store.photosWithProject(p);
      }
      const row = rows.find((r) => fs.existsSync(r.path)) ?? rows[0];
      if (row) keys.push(pixlfile.keyOf(row.id, null));
    }
    return { folder, keys };
  }
  // ── items ──
  /** Keywords and stack sizes for these rows, in a query or two whatever their number. */
  contextFor(rows, bare = false) {
    const stackIds = unique(rows.map((r) => r.stack_id).filter((s) => !!s));
    return {
      keywords: this.store.keywordsFor(rows.map((r) => r.id)),
      stackSizes: stackIds.length > 0 ? this.store.stackSizes(stackIds) : /* @__PURE__ */ new Map(),
      folderGone: /* @__PURE__ */ new Map(),
      bare
    };
  }
  /**
   * Rows as items: each photo, then its copies. `keep` picks items by key
   * (a collection holds some copies and not their photo).
   */
  itemsOf(rows, keep, bare = false) {
    const ctx = this.contextFor(rows, bare);
    const copies = /* @__PURE__ */ new Map();
    for (const c of this.store.copiesOfPhotos(rows.map((r) => r.id))) {
      const list2 = copies.get(c.photo_id);
      if (list2) list2.push(c);
      else copies.set(c.photo_id, [c]);
    }
    const out = [];
    for (const row of rows) {
      if (!keep || keep(pixlfile.keyOf(row.id, null))) out.push(this.itemFrom(row, void 0, ctx));
      for (const c of copies.get(row.id) ?? []) {
        if (!keep || keep(pixlfile.keyOf(row.id, c.copy_id))) out.push(this.itemFrom(row, c, ctx));
      }
    }
    return out;
  }
  /**
   * A listing that spans folders checks each file, not only its folder: a
   * collection's photo may have been moved or deleted while its folder was
   * not being looked at.
   */
  markMissing(items) {
    const gone = /* @__PURE__ */ new Map();
    for (const it of items) {
      if (it.offline) continue;
      let g = gone.get(it.path);
      if (g === void 0) {
        g = !fs.existsSync(it.path);
        gone.set(it.path, g);
      }
      if (g) it.offline = true;
    }
    return items;
  }
  /** A folder's items: each photo, then its copies. A few queries, whatever the size. */
  items(folder) {
    return this.itemsOf(this.store.photosIn(folder));
  }
  /** Every item in the index, without thumbnails: what smart rules are evaluated over. */
  allItems() {
    return this.itemsOf(this.store.allPhotos(), void 0, true);
  }
  item(key) {
    const { photoId, copyId } = pixlfile.parseKey(key);
    const row = this.store.photo(photoId);
    if (!row) return void 0;
    const ctx = this.contextFor([row]);
    let it;
    if (copyId === null) it = this.itemFrom(row, void 0, ctx);
    else {
      const copy = this.store.copiesOf(row.id).find((c) => c.copy_id === copyId);
      it = copy ? this.itemFrom(row, copy, ctx) : void 0;
    }
    return it && this.markMissing([it])[0];
  }
  itemsFor(keys) {
    return keys.map((k) => this.item(k));
  }
  /** These photos' items and their copies' (what a stack change touched). */
  itemsOfPhotos(ids) {
    return this.itemsOf(this.store.photosByIds([...ids]));
  }
  itemFrom(row, copy, ctx) {
    const thumbPath = copy ? copy.thumb_path : row.thumb_path;
    const thumbKey = copy ? copy.thumb_key : row.thumb_key;
    let folderGone = ctx.folderGone.get(row.folder);
    if (folderGone === void 0) {
      folderGone = !fs.existsSync(row.folder);
      ctx.folderGone.set(row.folder, folderGone);
    }
    return {
      key: pixlfile.keyOf(row.id, copy?.copy_id ?? null),
      photoId: row.id,
      copyId: copy?.copy_id ?? null,
      copyName: copy?.name ?? null,
      path: row.path,
      name: row.name,
      ext: row.ext,
      size: row.size,
      mtime: row.mtime,
      added: row.added ?? row.mtime,
      isRaw: row.is_raw === 1,
      rating: copy ? copy.rating : row.rating,
      flag: (copy ? copy.flag : row.flag) ?? null,
      label: (copy ? copy.label : row.label) ?? null,
      edited: (copy ? copy.edited : row.edited) === 1,
      thumbUrl: thumbPath && !ctx.bare && fs.existsSync(thumbPath) ? pixlfile.cacheUrlIn(this.cacheRoot, thumbPath, thumbKey ?? "") : null,
      unreadable: this.isFailed(row),
      ...row.hdr_key === versionOf(row) ? { hdr: row.hdr || null } : {},
      camera: row.camera_json ? JSON.parse(row.camera_json) : emptyCamera(),
      folder: row.folder,
      title: row.title ?? null,
      caption: row.caption ?? null,
      copyright: row.copyright ?? null,
      keywords: ctx.keywords.get(row.id) ?? [],
      stack: row.stack_id ? {
        id: row.stack_id,
        position: row.stack_pos ?? 0,
        size: ctx.stackSizes.get(row.stack_id) ?? 1
      } : null,
      offline: folderGone,
      project: row.project_path ?? null,
      ...row.names ? { names: pixlfile.searchWords(pixlfile.readNames(row.names)) } : {}
    };
  }
  // ── sources ──
  /** The items of a folder, a collection, a keyword (and every keyword under it) or the duplicates. */
  async listSource(src) {
    if (src.kind !== "folder") this.watchOnly(null);
    switch (src.kind) {
      case "folder":
        this.watchOnly(src.path, !!src.deep);
        return {
          source: src,
          items: await (src.deep ? this.listFolderDeep(src.path) : this.listFolder(src.path))
        };
      case "keyword": {
        const ids = this.store.photoIdsWithKeyword(pixlfile.normaliseKeyword(src.path));
        return { source: src, items: this.markMissing(this.itemsOf(this.store.photosByIds(ids))) };
      }
      case "collection":
        return { source: src, items: this.markMissing(this.collectionListing(src.id)) };
      case "duplicates":
        return this.duplicates(src.folder, src.threshold);
      default:
        throw new Error(`unknown source ${src.kind}`);
    }
  }
  collectionListing(id) {
    const c = this.store.collection(id);
    if (!c) throw new Error(`no collection ${id}`);
    if (c.kind === "manual") {
      const entries = this.store.collectionItems(id);
      const want = new Set(entries.map((e) => pixlfile.keyOf(e.photo_id, e.copy_id || null)));
      const rows = this.store.photosByIds(unique(entries.map((e) => e.photo_id)));
      return this.itemsOf(rows, (k) => want.has(k));
    }
    const members = this.resolver(this.store.collections(), this.allItems())(id) ?? /* @__PURE__ */ new Set();
    const ids = unique([...members].map((k) => pixlfile.parseKey(k).photoId));
    return this.itemsOf(this.store.photosByIds(ids), (k) => members.has(k));
  }
  /** Collection members over `items`: manual from the index, smart by rules, sets as unions. */
  resolver(rows, items) {
    const manual = /* @__PURE__ */ new Map();
    for (const e of this.store.allCollectionItems()) {
      const set = manual.get(e.collection_id) ?? /* @__PURE__ */ new Set();
      set.add(pixlfile.keyOf(e.photo_id, e.copy_id || null));
      manual.set(e.collection_id, set);
    }
    return memberResolver({
      collections: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        parent: r.parent,
        rules: this.rulesOf(r)
      })),
      items,
      manual: (id) => manual.get(id) ?? /* @__PURE__ */ new Set(),
      now: /* @__PURE__ */ new Date()
    });
  }
  rulesOf(r) {
    if (!r.rules) return null;
    try {
      return JSON.parse(r.rules);
    } catch {
      return null;
    }
  }
  // ── keywords and descriptive metadata ──
  /** Every keyword as a tree, each node counting the photos with it or one under it. */
  keywordTree() {
    const perPhoto = /* @__PURE__ */ new Map();
    for (const r of this.store.allKeywords()) {
      const set = perPhoto.get(r.photo_id) ?? /* @__PURE__ */ new Set();
      for (const p of pixlfile.keywordPrefixes(r.path)) set.add(p);
      perPhoto.set(r.photo_id, set);
    }
    const counts = /* @__PURE__ */ new Map();
    for (const set of perPhoto.values())
      for (const p of set) counts.set(p, (counts.get(p) ?? 0) + 1);
    const nodes = /* @__PURE__ */ new Map();
    const roots = [];
    for (const path2 of [...counts.keys()].sort()) {
      const cut = path2.lastIndexOf("|");
      const node = {
        name: path2.slice(cut + 1),
        path: path2,
        count: counts.get(path2) ?? 0,
        children: []
      };
      nodes.set(path2, node);
      const parent = cut >= 0 ? nodes.get(path2.slice(0, cut)) : void 0;
      (parent ? parent.children : roots).push(node);
    }
    const order = (list2) => {
      list2.sort(
        (a, b) => a.name.localeCompare(b.name, void 0, { sensitivity: "base" }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      );
      for (const n of list2) order(n.children);
    };
    order(roots);
    return roots;
  }
  /**
   * Edit title, caption, copyright or keywords. Metadata is the photo's (a
   * copy shows its photo's): each photo's `.xmp` is read, changed, written,
   * and mirrored into the index. Returns the items after.
   */
  async setMetadata(keys, patch) {
    const ids = unique(keys.map((k) => pixlfile.parseKey(k).photoId));
    await this.xmpSerial(async () => {
      for (const id of ids) {
        const row = this.store.photo(id);
        if (!row) continue;
        const file = xmpPathFor(row.path, row.is_raw === 1);
        const exists = fs.existsSync(file);
        const current = exists ? await this.xmp.read(file) ?? this.indexedMeta(row) : emptyMeta();
        const next = applyMetaPatch(current, patch);
        if (this.closed) return;
        let mtime = null;
        if (exists && sameMeta(current, next)) mtime = fs.statSync(file).mtimeMs;
        else if (exists || !metaIsEmpty(next)) {
          await this.xmp.write(file, next);
          mtime = fs.statSync(file).mtimeMs;
        }
        if (this.closed) return;
        this.store.tx(() => this.store.setXmp(id, next, next.keywords, mtime));
      }
    });
    this.emit({ name: "sources" });
    return this.itemsFor(keys);
  }
  /** What the index last read from a photo's `.xmp`. */
  indexedMeta(row) {
    return {
      title: row.title,
      caption: row.caption,
      copyright: row.copyright,
      keywords: this.store.keywordsOf(row.id)
    };
  }
  // ── collections ──
  /** Every collection, with how many items each holds now. */
  collections() {
    const rows = this.store.collections();
    const needItems = rows.some((r) => r.kind !== "manual");
    const members = this.resolver(rows, needItems ? this.allItems() : []);
    return rows.map((r) => ({ ...this.collectionOf(r), count: members(r.id)?.size ?? 0 }));
  }
  collectionOf(r) {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      parent: r.parent,
      rules: r.kind === "smart" ? this.rulesOf(r) ?? { match: "all", rules: [] } : null,
      sort: r.sort
    };
  }
  /**
   * Create (no id) or change a collection. A collection sits at the top or
   * in a set, never inside itself; its kind is fixed once made.
   */
  saveCollection(c) {
    if (!["manual", "smart", "set"].includes(c.kind))
      throw new Error(`bad collection kind ${c.kind}`);
    const name = String(c.name ?? "").trim();
    if (!name) throw new Error(concepts.tk("a collection needs a name"));
    const existing = c.id ? this.store.collection(c.id) : void 0;
    if (existing && existing.kind !== c.kind) throw new Error("a collection cannot change kind");
    const id = existing?.id ?? c.id ?? recipe.newId();
    const parent = c.parent ?? null;
    if (parent !== null) {
      const p = this.store.collection(parent);
      if (!p || p.kind !== "set") throw new Error(concepts.tk("a collection can only sit in a set"));
      for (let at = p; at; ) {
        if (at.id === id) throw new Error(concepts.tk("a set cannot sit inside itself"));
        at = at.parent ? this.store.collection(at.parent) : void 0;
      }
    }
    const rules = c.kind === "smart" ? c.rules ?? { match: "all", rules: [] } : null;
    const row = {
      id,
      name,
      kind: c.kind,
      parent,
      rules: rules ? JSON.stringify(rules) : null,
      sort: Number.isFinite(c.sort) ? c.sort : 0
    };
    this.store.saveCollection(row);
    this.emit({ name: "sources" });
    return this.collectionOf({ ...row, created_at: "" });
  }
  /** Remove a collection (a set's children move to the top; photos are untouched). */
  removeCollection(id) {
    this.store.tx(() => this.store.removeCollection(id));
    this.emit({ name: "sources" });
  }
  /** Add items to, or take them out of, a manual collection. */
  collectionItems(id, keys, action) {
    const c = this.store.collection(id);
    if (!c) throw new Error(`no collection ${id}`);
    if (c.kind !== "manual") throw new Error("only a manual collection holds items");
    this.store.tx(() => {
      for (const key of keys) {
        const { photoId, copyId } = pixlfile.parseKey(key);
        if (action === "remove") this.store.removeCollectionItem(id, photoId, copyId ?? "");
        else if (this.store.photo(photoId)) this.store.addCollectionItem(id, photoId, copyId ?? "");
      }
    });
    this.emit({ name: "sources" });
  }
  /**
   * Collections as a file: their definitions (a set with everything in it)
   * and a manual collection's items by path, so they survive another index.
   */
  exportCollections(ids) {
    const rows = this.store.collections();
    const want = /* @__PURE__ */ new Set();
    const add = (id) => {
      if (want.has(id)) return;
      want.add(id);
      for (const r of rows) if (r.parent === id) add(r.id);
    };
    for (const id of ids) if (rows.some((r) => r.id === id)) add(id);
    return {
      app: "pixl-playroom",
      kind: "collections",
      version: 1,
      collections: rows.filter((r) => want.has(r.id)).map((r) => {
        const c = this.collectionOf(r);
        const out = {
          id: c.id,
          name: c.name,
          kind: c.kind,
          // A parent left out of the file puts this one at the top.
          parent: c.parent !== null && want.has(c.parent) ? c.parent : null,
          rules: c.rules,
          sort: c.sort
        };
        if (r.kind === "manual") {
          const entries = this.store.collectionItems(r.id);
          const paths = new Map(
            this.store.photosByIds(unique(entries.map((e) => e.photo_id))).map((p) => [p.id, p.path])
          );
          out.items = entries.filter((e) => paths.has(e.photo_id)).map((e) => ({ path: paths.get(e.photo_id), copyId: e.copy_id || null }));
        }
        return out;
      })
    };
  }
  /**
   * Collections from a file: an id already taken gets a new one (and what
   * refers to it follows), items are found by path (their folders indexed
   * if new), and what cannot be found is left out. Returns what was added.
   */
  async importCollections(file) {
    const f = file;
    if (!f || f.app !== "pixl-playroom" || f.kind !== "collections" || !Array.isArray(f.collections))
      throw new Error(concepts.tk("not a Pixl Playroom collections file"));
    const defs = f.collections.filter(
      (c) => !!c && typeof c.id === "string" && ["manual", "smart", "set"].includes(c.kind)
    );
    const ids = /* @__PURE__ */ new Map();
    for (const c of defs) {
      ids.set(c.id, this.store.collection(c.id) || ids.has(c.id) ? recipe.newId() : c.id);
    }
    const folders = /* @__PURE__ */ new Set();
    for (const c of defs) {
      for (const it of c.items ?? []) {
        if (typeof it?.path === "string" && !this.store.photoByPath(it.path))
          folders.add(path.dirname(it.path));
      }
    }
    for (const folder of folders) if (fs.existsSync(folder)) await this.rescan(folder, false);
    const byOld = new Map(defs.map((c) => [c.id, c]));
    const depth = (c) => {
      let d = 0;
      for (let at = c; at.parent && byOld.has(at.parent) && d < defs.length; d++) {
        at = byOld.get(at.parent);
      }
      return d;
    };
    const added = [];
    this.store.tx(() => {
      for (const c of [...defs].sort((a, b) => depth(a) - depth(b))) {
        const id = ids.get(c.id);
        const parentId = c.parent ? ids.get(c.parent) ?? c.parent : null;
        const parent = parentId ? this.store.collection(parentId) : void 0;
        const rules = c.kind === "smart" && c.rules ? remapCollections(c.rules, (old) => ids.get(old) ?? old) : null;
        const row = {
          id,
          name: String(c.name ?? "Collection"),
          kind: c.kind,
          parent: parent?.kind === "set" ? parent.id : null,
          rules: rules ? JSON.stringify(rules) : null,
          sort: typeof c.sort === "number" ? c.sort : 0
        };
        this.store.saveCollection(row);
        if (c.kind === "manual") {
          for (const it of c.items ?? []) {
            const photo = typeof it?.path === "string" ? this.store.photoByPath(it.path) : void 0;
            if (!photo) continue;
            const copyId = typeof it.copyId === "string" && it.copyId ? it.copyId : "";
            if (copyId && !this.store.copiesOf(photo.id).some((x) => x.copy_id === copyId)) continue;
            this.store.addCollectionItem(id, photo.id, copyId);
          }
        }
        added.push(this.collectionOf({ ...row, created_at: "" }));
      }
    });
    this.emit({ name: "sources" });
    return added;
  }
  // ── stacks ──
  /** Set or clear a photo's stack in its sidecar (and so the index). */
  setStackOf(row, stack) {
    this.updateRow(row, (s) => {
      s.stack = stack;
    });
  }
  /** A stack's members numbered 0… again in their order; one left alone is no stack. */
  renumber(stackId, touched) {
    const members = this.store.stackMembers(stackId);
    for (const [i, m] of members.entries()) {
      this.setStackOf(m, members.length < 2 ? null : { id: stackId, position: i });
      touched.add(m.id);
    }
  }
  /**
   * Stack photos of one folder (the cover's), the cover on top and the rest
   * in the order given. A photo already in another stack leaves it. Returns
   * the items whose stack changed (copies included).
   */
  stack(keys, coverKey) {
    const cover = this.row(coverKey);
    const ids = unique([cover.id, ...keys.map((k) => pixlfile.parseKey(k).photoId)]);
    const rows = ids.map((id2) => this.store.photo(id2)).filter((r) => !!r && r.folder === cover.folder);
    if (rows.length < 2) return [];
    const id = recipe.newId();
    const touched = /* @__PURE__ */ new Set();
    this.store.tx(() => {
      const left = unique(rows.map((r) => r.stack_id).filter((s) => !!s));
      rows.forEach((r, i) => {
        this.setStackOf(r, { id, position: i });
        touched.add(r.id);
      });
      for (const old of left) this.renumber(old, touched);
    });
    return this.itemsOfPhotos(touched);
  }
  /** Undo the stacks these items are in, whole. Returns the items that changed. */
  unstack(keys) {
    const touched = /* @__PURE__ */ new Set();
    this.store.tx(() => {
      const ids = unique(keys.map((k) => this.store.photo(pixlfile.parseKey(k).photoId)?.stack_id));
      for (const stackId of ids) {
        if (!stackId) continue;
        for (const m of this.store.stackMembers(stackId)) {
          this.setStackOf(m, null);
          touched.add(m.id);
        }
      }
    });
    return this.itemsOfPhotos(touched);
  }
  /** Make this photo its stack's cover; the others keep their order. */
  stackTop(key) {
    const row = this.row(key);
    const stackId = row.stack_id;
    if (!stackId) return [];
    const touched = /* @__PURE__ */ new Set();
    this.store.tx(() => {
      const members = this.store.stackMembers(stackId);
      const order = [row, ...members.filter((m) => m.id !== row.id)];
      order.forEach((m, i) => {
        this.setStackOf(m, { id: stackId, position: i });
        touched.add(m.id);
      });
    });
    return this.itemsOfPhotos(touched);
  }
  /**
   * Stack the folder's unstacked photos taken in bursts: runs with no more
   * than `seconds` between one capture and the next, two or more long, the
   * first as cover. Returns how many stacks were made.
   */
  autoStack(folder, seconds = 3) {
    const timed = this.store.photosIn(folder).filter((r) => !r.stack_id && r.captured_at).map((r) => ({ r, t: new Date(r.captured_at).getTime() })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t || a.r.name.localeCompare(b.r.name));
    const runs = [];
    let run = [];
    let last = -Infinity;
    for (const { r, t } of timed) {
      if (t - last > seconds * 1e3 && run.length > 0) {
        runs.push(run);
        run = [];
      }
      run.push(r);
      last = t;
    }
    if (run.length > 0) runs.push(run);
    const made = runs.filter((g) => g.length >= 2);
    if (made.length === 0) return 0;
    this.store.tx(() => {
      for (const g of made) {
        const id = recipe.newId();
        g.forEach((r, i) => this.setStackOf(r, { id, position: i }));
      }
    });
    this.emit({ name: "changed", folder });
    return made.length;
  }
  // ── duplicates ──
  /**
   * Photos whose picture hash is missing or older than their thumbnail, for
   * the main process to hash (it has the engine). No thumbnail: a null path.
   */
  dhashWork(folder) {
    return this.store.photosInScope(folder).filter((r) => !(r.dhash && r.thumb_key && r.dhash_key === r.thumb_key)).filter((r) => !this.isFailed(r) && fs.existsSync(r.path)).map((r) => ({
      photoId: r.id,
      thumbPath: r.thumb_path && fs.existsSync(r.thumb_path) ? r.thumb_path : null
    }));
  }
  /** A photo's picture hash, of its thumbnail with this stamp. */
  setDhash(photoId, hash, thumbKey) {
    this.store.setDhash(photoId, hash, thumbKey);
  }
  /**
   * Exact duplicates (same size, same SHA-1; hashed only when the size is
   * shared, and kept until the file changes) and then near ones (thumbnail
   * dHashes within `threshold` bits), in `folder` or the whole library. An
   * exact group counts once among the near ones, so identical files never
   * make a near group on their own.
   */
  async duplicates(folder, threshold = 6) {
    const source2 = { kind: "duplicates", folder, threshold };
    const exact = /* @__PURE__ */ new Map();
    for (const row of this.store.photosSharingSize(folder)) {
      let hash = row.hash_key === hashKeyOf(row) ? row.content_hash : null;
      if (!hash) {
        if (!fs.existsSync(row.path)) continue;
        try {
          hash = await sha1(row.path);
        } catch {
          continue;
        }
        if (this.closed) return { source: source2, items: [], groups: [] };
        if (!this.store.photo(row.id)) continue;
        this.store.setContentHash(row.id, hash, hashKeyOf(row));
      }
      const k = `${row.size}:${hash}`;
      const list2 = exact.get(k);
      if (list2) list2.push(row);
      else exact.set(k, [row]);
    }
    const groups = [];
    const standIn = /* @__PURE__ */ new Map();
    for (const rows2 of exact.values()) {
      if (rows2.length < 2) continue;
      groups.push({ kind: "exact", keys: rows2.map((r) => pixlfile.keyOf(r.id, null)) });
      rows2.forEach((r, i) => standIn.set(r.id, i === 0));
    }
    const entries = this.store.photosInScope(folder).filter((r) => r.dhash && r.dhash_key === r.thumb_key && standIn.get(r.id) !== false).map((r) => ({ key: pixlfile.keyOf(r.id, null), hash: r.dhash }));
    for (const g of pixlfile.groupNear(entries, threshold)) {
      groups.push({ kind: "near", keys: g.keys, distance: g.distance });
    }
    const order = unique(groups.flatMap((g) => g.keys));
    const rows = this.store.photosByIds(order.map((k) => pixlfile.parseKey(k).photoId));
    const byKey = new Map(this.itemsOf(rows, (k) => !k.includes(":")).map((it) => [it.key, it]));
    const items = order.map((k) => byKey.get(k)).filter((x) => !!x);
    return { source: source2, items: this.markMissing(items), groups };
  }
  // ── sidecar-backed state ──
  row(key) {
    const row = this.store.photo(pixlfile.parseKey(key).photoId);
    if (!row) throw new Error(`no photo ${key}`);
    return row;
  }
  /**
   * What the photo's truth says: its project's, else its sidecar's. Its
   * recipes name their planes (kept in the store), as every recipe the index
   * hands out or takes in does; only a sidecar file carries them.
   */
  sidecar(row) {
    const project = this.projectOf(row);
    if (!project) return this.readSide(row);
    return this.projects.use(project, (p) => {
      const truth = p.read(row.is_raw === 1, false);
      this.storePlanes(p, JSON.stringify(truth));
      return truth;
    });
  }
  /**
   * The planes a recipe handed out names, from its project into the store,
   * where main asks for them (a photo never opened this session has had
   * none copied over yet).
   */
  storePlanes(p, json) {
    for (const ref of pixlfile.refsIn(json)) {
      if (this.store.hasPlane(ref)) continue;
      const png = p.plane(ref);
      if (png !== void 0) this.store.putPlane(ref, png);
    }
  }
  /** A plane from the store, for a project or sidecar being written. */
  planeOf = (ref) => this.store.plane(ref);
  /** The photo's sidecar file, its planes taken into the store and named. */
  readSide(row) {
    return mapRecipes(
      readSidecar(row.path, row.is_raw === 1).sidecar,
      (r) => pixlfile.slim(r, (ref, png) => this.store.putPlane(ref, png))
    );
  }
  /** A sidecar to write to its file: planes carried, not named (other apps read it alone). */
  fullSide(s) {
    return mapRecipes(s, (r) => recipe.hydrateRecipe(r, this.planeOf));
  }
  recipe(key) {
    const row = this.row(key);
    const it = itemOf(this.sidecar(row), pixlfile.parseKey(key).copyId);
    return it?.recipe ?? recipe.defaultRecipe(row.is_raw === 1);
  }
  /** A key's recipe with its planes by reference: its project's one item, or its sidecar's, slimmed. */
  slimRecipeOf(key) {
    const row = this.row(key);
    const raw = row.is_raw === 1;
    const project = this.projectOf(row);
    const r = project ? this.projects.use(project, (p) => {
      const r2 = p.itemRecipe(pixlfile.itemKeyOf(pixlfile.parseKey(key).copyId), raw);
      if (r2) this.storePlanes(p, JSON.stringify(r2));
      return r2;
    }) : itemOf(this.readSide(row), pixlfile.parseKey(key).copyId)?.recipe ?? null;
    return r ? pixlfile.slim(r) : recipe.defaultRecipe(raw);
  }
  recipes(keys) {
    return keys.map((key) => ({ key, row: this.row(key), recipe: this.recipe(key) }));
  }
  openData(key) {
    const row = this.row(key);
    const item2 = this.item(key);
    if (!item2) throw new Error(`no item ${key}`);
    const project = this.projectOf(row);
    if (project)
      this.projects.use(
        project,
        (p) => this.store.tx(() => {
          for (const { ref, png } of p.planes()) this.store.putPlane(ref, png);
        })
      );
    const it = itemOf(this.sidecar(row), pixlfile.parseKey(key).copyId);
    return {
      row: this.withOriginal(row),
      recipe: it?.recipe ?? recipe.defaultRecipe(row.is_raw === 1),
      item: item2,
      snapshots: it?.snapshots ?? []
    };
  }
  /**
   * Change a photo's truth and keep the index in step: in its project, or in
   * its sidecar. A change that `needsProject` says calls for one (the first
   * real edit) makes the photo's project, so a rating alone never does.
   */
  update(key, change, needsProject) {
    return this.updateRow(this.row(key), change, needsProject);
  }
  updateRow(row, change, needsProject) {
    const raw = row.is_raw === 1;
    const project = this.projectOf(row);
    const colour = raw ? source.parseRawColour(row.raw_colour) : null;
    const names = pixlfile.readNames(row.names);
    const apply = (s) => {
      change(s);
      if (colour && !s.rawColour) s.rawColour = colour;
      if (names && !s.names) s.names = names;
      if (row.cull_keep === 1 && !s.cullKeep) s.cullKeep = true;
    };
    if (project) {
      const truth = this.projects.write(project, (p) => {
        const s = p.read(raw, false);
        apply(s);
        p.write(s, this.planeOf);
        return s;
      });
      this.mirror(row, truth, fs.statSync(project).mtimeMs, "project");
      return truth;
    }
    const sidecar = this.readSide(row);
    apply(sidecar);
    if (needsProject?.(sidecar)) {
      this.createProject(row, sidecar);
      return sidecar;
    }
    const mtime = writeSidecar(row.path, this.fullSide(sidecar));
    this.mirror(row, sidecar, mtime);
    return sidecar;
  }
  saveRecipe(key, recipe$1) {
    const { copyId } = pixlfile.parseKey(key);
    const raw = this.row(key).is_raw === 1;
    this.update(
      key,
      (s) => {
        const it = itemOf(s, copyId);
        if (it) it.recipe = recipe.isEdited(recipe$1, raw) || copyId !== null ? recipe$1 : null;
      },
      (s) => itemOf(s, copyId)?.recipe != null
    );
  }
  /** Several recipes saved in one transaction. Returns the items after. */
  saveRecipes(pairs) {
    this.store.tx(() => {
      for (const { key, recipe: recipe2 } of pairs) this.saveRecipe(key, recipe2);
    });
    return this.itemsFor(pairs.map((p) => p.key));
  }
  /** Every key back to its defaults. Returns the items and the fresh recipes. */
  resetRecipes(keys) {
    const recipes = {};
    this.store.tx(() => {
      for (const key of keys) {
        const fresh = recipe.defaultRecipe(this.row(key).is_raw === 1);
        this.saveRecipe(key, fresh);
        recipes[key] = fresh;
      }
    });
    return { items: this.itemsFor(keys), recipes };
  }
  setMeta(keys, patch) {
    this.store.tx(() => {
      for (const key of keys) {
        const { copyId } = pixlfile.parseKey(key);
        this.update(key, (s) => {
          const it = itemOf(s, copyId);
          if (!it) return;
          if (patch.rating !== void 0) it.rating = Math.max(0, Math.min(5, patch.rating));
          if (patch.flag !== void 0) it.flag = patch.flag;
          if (patch.label !== void 0) it.label = patch.label;
        });
      }
    });
    return this.itemsFor(keys);
  }
  /** A virtual copy of `key` with its saved recipe. Returns the new copy's item. */
  createCopy(key) {
    const { photoId } = pixlfile.parseKey(key);
    const id = recipe.newId();
    const source2 = this.recipe(key);
    this.update(
      key,
      (s) => {
        s.copies.push({
          id,
          name: `Copy ${s.copies.length + 1}`,
          rating: 0,
          flag: null,
          label: null,
          recipe: structuredClone(source2),
          snapshots: []
        });
      },
      () => true
    );
    const item2 = this.item(pixlfile.keyOf(photoId, id));
    if (!item2) throw new Error(`copy of ${key} was not recorded`);
    return item2;
  }
  deleteCopy(key) {
    const { photoId, copyId } = pixlfile.parseKey(key);
    if (copyId === null) return;
    this.update(key, (s) => {
      s.copies = s.copies.filter((c) => c.id !== copyId);
    });
    this.store.removeCopyFromCollections(photoId, copyId);
  }
  saveSnapshots(key, snapshots) {
    const { copyId } = pixlfile.parseKey(key);
    this.update(
      key,
      (s) => {
        const it = itemOf(s, copyId);
        if (it) it.snapshots = snapshots;
      },
      () => snapshots.length > 0
    );
  }
  // ── thumbnails ──
  /** The thumbnail to render for an item, or null when the one it has is current (or it cannot be read). */
  thumbJob(photoId, copyId) {
    const row = this.store.photo(photoId);
    if (!row || this.isFailed(row)) return null;
    const existing = copyId === null ? row : this.store.copiesOf(row.id).find((c) => c.copy_id === copyId);
    if (!existing) return null;
    const key = pixlfile.keyOf(row.id, copyId);
    const raw = row.is_raw === 1;
    const recipeKey = existing.recipe_key ?? thumbRecipeKey(this.slimRecipeOf(key), raw);
    const edited = recipeKey !== "plain";
    const stamp = `${source.versionStamp(row, !raw || edited)}${edited ? `-e${recipe.ENGINE_RENDER_REV}` : ""}-${recipeKey}`;
    const have = existing.thumb_path && fs.existsSync(existing.thumb_path);
    if (existing.thumb_key === stamp && have) return null;
    return { row: this.withOriginal(row), recipe: this.recipe(key), edited, stamp };
  }
  setThumb(photoId, copyId, path2, stamp) {
    const was = copyId === null ? this.store.photo(photoId)?.thumb_path : this.store.copiesOf(photoId).find((c) => c.copy_id === copyId)?.thumb_path;
    this.store.setThumb(photoId, copyId, path2, stamp);
    if (was && was !== path2) fs.rmSync(was, { force: true });
    const row = this.store.photo(photoId);
    const project = row && copyId === null ? this.projectOf(row) : null;
    if (!project || !row) return;
    try {
      const jpeg = fs.readFileSync(path2);
      const size = pixlfile.jpegSize(jpeg);
      this.projects.write(project, (p) => p.setPreview(jpeg, size?.width ?? 0, size?.height ?? 0));
      this.store.setProject(row.id, project, fs.statSync(project).mtimeMs);
    } catch (err) {
      console.warn("project preview not saved", project, err.message);
    }
  }
  /**
   * A RAW's camera colour, recorded: in the index always, and in its project
   * or sidecar when the photo has one already or the person chose it
   * (`explicit`): an untouched RAW gets no sidecar for a default that is
   * worked out the same way again.
   */
  setRawColour(photoId, colour, explicit = false) {
    const c = source.parseRawColour(colour);
    const row = this.store.photo(photoId);
    if (!c || !row) return;
    this.store.setRawColour(photoId, c);
    const kept = !!this.projectOf(row) || fs.existsSync(sidecarPath(row.path));
    if (explicit || kept)
      this.updateRow(row, (s) => {
        s.rawColour = c;
      });
  }
  /**
   * What Gemma named in a photo (shared/naming.ts), or the user's changes to
   * it: in the index always, and in its project or sidecar when it has one
   * (naming makes no sidecar of its own). Returns the photo's items, their
   * search words changed.
   */
  setNames(photoId, json) {
    const row = this.store.photo(photoId);
    if (!row) return [];
    const names = pixlfile.readNames(json);
    const kept = names ? JSON.stringify(names) : null;
    this.store.setNames(photoId, kept);
    const now = { ...row, names: kept };
    if (this.projectOf(row) || fs.existsSync(sidecarPath(row.path)))
      this.updateRow(now, (s) => {
        s.names = names;
      });
    return this.itemsOf([now]);
  }
  /** A photo's names as kept, or null. */
  namesOf(photoId) {
    return this.store.photo(photoId)?.names ?? null;
  }
  /** Naming gave no usable answer: not tried again by itself. */
  namingFailed(photoId) {
    this.store.setNamesTried(photoId, (/* @__PURE__ */ new Date()).toISOString());
  }
  /** Photos whose cull signals are missing or stale (another file version, an older measure), newest first. */
  unmeasured(limit, models) {
    const out = [];
    for (const r of this.store.cullState()) {
      if (r.cull_key === pixlfile.cullKey(r.mtime, r.size, models)) continue;
      out.push(r.id);
      if (out.length >= limit) break;
    }
    return out;
  }
  /** A photo's cull signals measured: kept with the file version they were measured on. */
  setCull(photoId, json, models) {
    const row = this.store.photo(photoId);
    if (row) this.store.setCull(photoId, json, pixlfile.cullKey(row.mtime, row.size, models));
  }
  /** The signals of these photos measured on their current file (whatever the models then), by photo id. */
  cullSignals(photoIds) {
    const out = {};
    for (const c of this.store.culls(photoIds))
      if (c.cull && c.cull_key?.startsWith(`${c.mtime}:${c.size}:v${pixlfile.CULL_VERSION}:`))
        out[c.id] = c.cull;
    return out;
  }
  /**
   * The user's Keep on suggested rejects: in the index always, and in each
   * photo's project or sidecar when it has one.
   */
  setCullKeep(photoIds, keep) {
    for (const id of photoIds) {
      const row = this.store.photo(id);
      if (!row) continue;
      this.store.setCullKeep(id, keep);
      if (this.projectOf(row) || fs.existsSync(sidecarPath(row.path)))
        this.updateRow({ ...row, cull_keep: keep ? 1 : 0 }, (s) => {
          s.cullKeep = keep;
        });
    }
  }
  /**
   * What suggesting needs: these photos (or every measured one, null), with
   * their signals where measured on the current file.
   */
  cullInputs(photoIds) {
    return this.store.cullInputs(photoIds).map((r) => ({
      photoId: r.id,
      name: r.name,
      rating: r.rating,
      flag: r.flag === "pick" || r.flag === "reject" ? r.flag : null,
      keep: r.cull_keep === 1,
      signals: r.cull && r.cull_key?.startsWith(`${r.mtime}:${r.size}:v${pixlfile.CULL_VERSION}:`) ? r.cull : null
    }));
  }
  /** Photos to name next, newest arrivals first. */
  unnamed(limit) {
    return this.store.unnamed(limit);
  }
  /**
   * After a RAW's camera colour changed its as-shot white: the custom
   * absolute white balances of the photo and its copies re-expressed against
   * the new white (`convertAsShot`), so the pictures keep their white, with a
   * line in each one's history. Returns how many were changed.
   */
  carryWhite(photoId, from, to, label) {
    if (!this.store.photo(photoId)) return 0;
    const keys = [
      pixlfile.keyOf(photoId, null),
      ...this.store.copiesOf(photoId).map((c) => pixlfile.keyOf(photoId, c.copy_id))
    ];
    let changed = 0;
    for (const key of keys) {
      const recipe2 = this.recipe(key);
      const wb = pixlfile.convertAsShot(recipe2.wb, from, to);
      if (wb.temperature === recipe2.wb.temperature && wb.tint === recipe2.wb.tint) continue;
      const next = { ...recipe2, wb };
      this.saveRecipe(key, next);
      this.appendHistory(key, label, next);
      changed++;
    }
    return changed;
  }
  /** What kind of HDR a file version is ('' none), from its probe. */
  setHdr(photoId, kind) {
    const row = this.store.photo(photoId);
    if (row) this.store.setHdr(photoId, kind, versionOf(row));
  }
  /** Once per version of the file: one that cannot be read is not tried again until it changes. */
  markFailed(photoId, reason) {
    const row = this.store.photo(photoId);
    if (!row) return;
    this.failed.set(versionOf(row), reason);
    this.store.setFailed(photoId, versionOf(row), reason);
  }
  // ── history ──
  /**
   * Run `fn` on the history that holds `key`'s: its project's (under the
   * item's key there), else the index's.
   */
  inHistory(key, project, index) {
    const path2 = this.projectOf(this.row(key));
    if (!path2) return index();
    const out = this.projects.write(path2, (p) => project(p, pixlfile.itemKeyOf(pixlfile.parseKey(key).copyId)));
    this.noteProjectWrite(key);
    return out;
  }
  /** A project written: its new mtime noted, so the next scan does not read it back. */
  noteProjectWrite(key) {
    const row = this.row(key);
    if (row.project_path && fs.existsSync(row.project_path))
      this.store.setProject(row.id, row.project_path, fs.statSync(row.project_path).mtimeMs);
  }
  history(key) {
    const path2 = this.projectOf(this.row(key));
    if (!path2) return this.store.history(key);
    return this.projects.use(path2, (p) => p.history.history(pixlfile.itemKeyOf(pixlfile.parseKey(key).copyId)));
  }
  /**
   * Record a settled edit. A photo's first real step (past the "Opened"
   * base) makes its project, and the history moves into it.
   */
  appendHistory(key, label, recipe2) {
    const row = this.row(key);
    if (!this.projectOf(row)) {
      this.store.appendHistory(key, label, recipe2);
      const log = this.store.history(key);
      if (log.steps.length === 0) return log;
      this.ensureProject(row);
      return this.history(key);
    }
    this.inHistory(
      key,
      (p, k) => this.appendIn(p, k, label, recipe2),
      () => this.store.appendHistory(key, label, recipe2)
    );
    return this.history(key);
  }
  appendIn(p, itemKey, label, recipe2) {
    const log = p.history.append(itemKey, label, recipe2);
    for (const ref of pixlfile.refsIn(JSON.stringify(recipe2))) {
      if (p.hasPlane(ref)) continue;
      const png = this.store.plane(ref);
      if (png !== void 0) p.putPlane(ref, png);
    }
    return log;
  }
  /**
   * A settled edit: its history step (`step`, planes by reference) and the
   * recipe the photo now has (`recipe`, whole) written together, so a crash
   * never leaves the history ahead of the saved recipe, which the next open
   * would record as where the photo stands. Returns what changed in the
   * history, not all of it.
   */
  commitEdit(key, label, step, recipe2) {
    const row = this.row(key);
    const path2 = this.projectOf(row);
    if (!path2) {
      const change = this.store.appendHistory(key, label, step);
      if (!change.step) return change;
      this.saveRecipe(key, recipe2);
      this.ensureProject(this.row(key));
      return change;
    }
    const log = this.projects.write(
      path2,
      (p) => p.tx(() => {
        this.saveRecipe(key, recipe2);
        return this.appendIn(p, pixlfile.itemKeyOf(pixlfile.parseKey(key).copyId), label, step);
      })
    );
    this.noteProjectWrite(key);
    return log;
  }
  /**
   * A settled change to the newest step (a look's Amount, a look swapped):
   * the step rewritten and the recipe saved together, as `commitEdit` does.
   * Null when the step is no longer the newest shown one; nothing is written.
   */
  amendEdit(key, seq, label, step, recipe2) {
    const amendIn = (p, itemKey) => {
      const change = p.history.amendLast(itemKey, seq, label, step);
      if (!change) return null;
      this.saveRecipe(key, recipe2);
      for (const ref of pixlfile.refsIn(JSON.stringify(step))) {
        if (p.hasPlane(ref)) continue;
        const png = this.store.plane(ref);
        if (png !== void 0) p.putPlane(ref, png);
      }
      return change;
    };
    return this.inHistory(
      key,
      (p, k) => p.tx(() => amendIn(p, k)),
      () => {
        const change = this.store.amendHistory(key, seq, label, step);
        if (change) this.saveRecipe(key, recipe2);
        return change;
      }
    );
  }
  setHistoryHidden(key, seqs, hidden) {
    return this.inHistory(
      key,
      (p, k) => p.history.setHidden(k, seqs, hidden),
      () => this.store.setHistoryHidden(key, seqs, hidden)
    );
  }
  deleteHistory(key, seqs) {
    return this.inHistory(
      key,
      (p, k) => {
        const log = p.history.delete(k, seqs);
        this.gcLater(p.path);
        return log;
      },
      () => this.store.deleteHistory(key, seqs)
    );
  }
  /** Where the photo's project is, if it has one (for Reveal). */
  projectPath(key) {
    return this.projectOf(this.row(key));
  }
  // ── painted planes, by reference (see planestore.ts) ──
  putPlane(ref, png) {
    this.store.putPlane(ref, png);
  }
  plane(ref) {
    return this.store.plane(ref);
  }
  /**
   * Drop the planes nothing refers to. Only the edit history keeps planes
   * by reference (presets and sidecars hold the PNGs), so this is safe
   * before anything else has asked for one: at the first start.
   */
  /**
   * Drop the thumbnails in `dir` no photo or copy names any more (made for a
   * recipe since changed, before a replaced one was deleted with it), an hour
   * old at least so one being written now is not taken. Returns how many went.
   */
  pruneThumbs(dir) {
    const named = this.store.thumbPaths();
    const now = Date.now();
    let n = 0;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return 0;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      if (named.has(file)) continue;
      try {
        if (now - fs.statSync(file).mtimeMs < 60 * 60 * 1e3) continue;
        fs.unlinkSync(file);
        n++;
      } catch {
      }
    }
    return n;
  }
  prunePlanes() {
    const keep = new Set(this.store.planesPut);
    for (const json of this.store.historyRecipes()) {
      for (const m of json.matchAll(/"ref":"([^"]+)"/g)) keep.add(m[1]);
    }
    return this.store.prunePlanes(keep);
  }
  // ── presets and settings ──
  presets() {
    return this.store.presets();
  }
  savePreset(p) {
    this.store.savePreset(p);
  }
  removePreset(id) {
    this.store.removePreset(id);
  }
  exportPresets() {
    return this.store.exportPresets();
  }
  saveExportPreset(p) {
    this.store.saveExportPreset(p);
  }
  removeExportPreset(id) {
    this.store.removeExportPreset(id);
  }
  getSetting(key) {
    return this.store.getSetting(key) ?? null;
  }
  setSetting(key, value) {
    this.store.setSetting(key, value);
  }
}
const PRUNE_AFTER_MS = 5e3;
function send(msg) {
  process.parentPort.postMessage(msg);
}
function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : void 0;
}
const userData = arg("--user-data");
if (!userData) throw new Error("index host: --user-data is required");
pixlfile.setExiftoolPath(arg("--exiftool"));
const service = new IndexService({
  userData,
  emit: (event) => send({ kind: "event", ...event })
});
send({ kind: "hello" });
if (process.argv.includes("--prune")) {
  setTimeout(() => {
    try {
      const removed = service.prunePlanes();
      if (removed > 0) console.log(`pruned ${removed} unused painted planes`);
    } catch (err) {
      console.warn("pruning planes failed", err);
    }
  }, PRUNE_AFTER_MS).unref?.();
}
process.parentPort.on("message", (e) => {
  const msg = e.data;
  if (!msg || msg.kind !== "request") return;
  const { id, method, args } = msg;
  const fn = service[method];
  if (typeof fn !== "function" || method === "constructor") {
    send({
      kind: "response",
      id,
      ok: false,
      error: { message: `unknown index method ${method}`, code: "BadRequest" }
    });
    return;
  }
  let result;
  try {
    result = fn.apply(service, args);
  } catch (err) {
    send({ kind: "response", id, ok: false, error: errorShape(err) });
    return;
  }
  if (method === "close") {
    send({ kind: "response", id, ok: true, result: null });
    setImmediate(() => process.exit(0));
    return;
  }
  if (result instanceof Promise) {
    result.then(
      (value) => send({ kind: "response", id, ok: true, result: value }),
      (err) => send({ kind: "response", id, ok: false, error: errorShape(err) })
    );
  } else {
    send({ kind: "response", id, ok: true, result });
  }
});
function errorShape(err) {
  return {
    message: err instanceof Error ? err.message : String(err),
    code: err?.code === void 0 ? "Error" : String(err.code)
  };
}
