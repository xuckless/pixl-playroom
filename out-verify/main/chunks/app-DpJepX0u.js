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
var __toESM = (mod, isNodeMode, target2) => (target2 = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target2, "default", { value: mod, enumerable: true }) : target2,
  mod
));
const electron = require("electron");
const log = require("electron-log/main");
const promises = require("fs/promises");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const os = require("os");
const fs = require("fs");
const concepts = require("./concepts-BlHF9Hl2.js");
const index$1 = require("../index.js");
const pixlfile = require("./pixlfile-CLk-_7wd.js");
const child_process = require("child_process");
const crypto = require("crypto");
const net = require("net");
const util = require("util");
const auto = require("@xuckless/pixl-auto");
const localServer = require("@xuckless/pixl-auto/brain/local-server");
const ops = require("./ops-BwMkvfF4.js");
const promises$1 = require("stream/promises");
const recipe = require("./recipe-BOlCEsxK.js");
const source$1 = require("./source-YZyIdPnn.js");
const url = require("url");
const stream = require("stream");
const pixlModels = require("@xuckless/pixl-models");
const gradients = require("./gradients-D8SBBasL.js");
const node_worker_threads = require("node:worker_threads");
const module$1 = require("module");
const node_crypto = require("node:crypto");
const node_http = require("node:http");
const node_child_process = require("node:child_process");
const promises$2 = require("node:fs/promises");
const node_os = require("node:os");
const node_util = require("node:util");
const i18next = require("i18next");
require("timers/promises");
require("node:sqlite");
require("worker_threads");
require("zlib");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const auto__namespace = /* @__PURE__ */ _interopNamespaceDefault(auto);
const pixlModels__namespace = /* @__PURE__ */ _interopNamespaceDefault(pixlModels);
const MAIN_DIR = path.basename(__dirname) === "chunks" ? path.dirname(__dirname) : __dirname;
const icon = path.join(__dirname, "../../../resources/icon.png");
const dockIcon = path.join(__dirname, "../../../resources/icon-dock.png");
const CRASH_ENDPOINT = "https://pixlfoundation.com/api/crash";
const PROBLEM_ENDPOINT = "https://pixlfoundation.com/api/report";
const MAX_REPORTS_PER_RUN = 10;
const MAX_TEXT = 8e3;
function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function scrub(text, homes2, max2 = MAX_TEXT) {
  let out = text;
  for (const home of homes2.filter((h) => h.length > 1)) {
    const variants = /* @__PURE__ */ new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")]);
    for (const v of variants) out = out.replace(new RegExp(escape(v), "gi"), "~");
  }
  out = out.replace(/file:\/\/\/?[^\s)'"]*[\\/]([^\\/\s)'"]+)/g, "file://…/$1");
  return out.length > max2 ? `${out.slice(0, max2)}…` : out;
}
function errorPayload(p, homes2) {
  return {
    ...p,
    message: scrub(p.message, homes2),
    ...p.stack ? { stack: scrub(p.stack, homes2) } : {},
    at: p.at ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
const MAX_PROBLEM_TEXT = 5e3;
const MAX_PROBLEM_LOG = 2e5;
function problemPayload(input, about, log2, homes2, at = (/* @__PURE__ */ new Date()).toISOString()) {
  const message = input.message.trim().slice(0, MAX_PROBLEM_TEXT);
  const email = input.email?.trim();
  let tail;
  if (input.includeLog && log2) {
    const cut = log2.length > MAX_PROBLEM_LOG ? log2.slice(-MAX_PROBLEM_LOG) : log2;
    const start = log2.length > MAX_PROBLEM_LOG ? cut.indexOf("\n") + 1 : 0;
    tail = scrub(cut.slice(start), homes2, MAX_PROBLEM_LOG);
  }
  return {
    app: "playroom",
    message,
    ...email ? { email } : {},
    ...tail ? { log: tail } : {},
    ...about,
    at
  };
}
const DEFAULTS = { updateChannel: "latest", crashReports: "unset" };
function readSettings() {
  try {
    const raw2 = JSON.parse(fs.readFileSync(index$1.paths.settings(), "utf8"));
    return {
      updateChannel: raw2.updateChannel === "beta" ? "beta" : "latest",
      crashReports: raw2.crashReports === "on" || raw2.crashReports === "off" ? raw2.crashReports : "unset",
      ...typeof raw2.notesSeen === "string" && raw2.notesSeen ? { notesSeen: raw2.notesSeen } : {},
      ...concepts.isLanguageSetting(raw2.language) ? { language: raw2.language } : {}
    };
  } catch {
    return { ...DEFAULTS };
  }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(index$1.paths.settings(), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}
const hidden$2 = process.env["PLAYROOM_HIDDEN"] === "1";
let consent = "unset";
let sent = 0;
const BENIGN = /* @__PURE__ */ new Set(["clean-exit", "killed"]);
function homes() {
  return [.../* @__PURE__ */ new Set([os.homedir(), electron.app.getPath("home")])];
}
function send(p) {
  if (consent !== "on" || hidden$2 || sent >= MAX_REPORTS_PER_RUN) return;
  sent++;
  const body = errorPayload(
    { ...p, version: electron.app.getVersion(), platform: process.platform, arch: process.arch },
    homes()
  );
  fetch(CRASH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5e3)
  }).catch((err) => log.warn("crash report not sent", err));
}
function crashConsent() {
  return hidden$2 ? "off" : consent;
}
function setCrashConsent(next) {
  if (next !== "on" && next !== "off") return consent;
  consent = writeSettings({ crashReports: next }).crashReports;
  electron.crashReporter.setUploadToServer(consent === "on" && !hidden$2);
  log.info(`crash reports ${consent}`);
  return consent;
}
async function logTail() {
  const path2 = log.transports.file.getFile()?.path;
  if (!path2) return null;
  try {
    const f = await promises.open(path2, "r");
    try {
      const { size } = await f.stat();
      const length = Math.min(size, Math.round(MAX_PROBLEM_LOG * 1.1));
      const buf = Buffer.alloc(length);
      await f.read(buf, 0, length, size - length);
      return buf.toString("utf8");
    } finally {
      await f.close();
    }
  } catch (err) {
    log.warn("problem report: the log could not be read", err);
    return null;
  }
}
async function sendProblemReport(input, engineVersion) {
  if (!input.message?.trim()) throw new Error(concepts.t("Describe the problem first."));
  const body = problemPayload(
    input,
    {
      version: electron.app.getVersion(),
      ...engineVersion ? { engine: engineVersion } : {},
      platform: process.platform,
      arch: process.arch,
      os: os.release()
    },
    input.includeLog ? await logTail() : null,
    homes()
  );
  let res;
  try {
    res = await fetch(PROBLEM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2e4)
    });
  } catch (err) {
    log.warn("problem report not sent", err);
    throw new Error(concepts.t("Couldn't send the report. Check your connection and try again."));
  }
  if (res.status === 429) throw new Error(concepts.t("Too many reports just now. Try again in a minute."));
  const answer2 = await res.json().catch(() => null);
  if (!res.ok || !answer2?.reference) {
    throw new Error(
      concepts.t("The report server answered {{status}}. Try again later.", { status: res.status })
    );
  }
  log.info(`problem report sent: ${answer2.reference}`);
  return answer2.reference;
}
function reportRendererError(e) {
  log.error(`renderer ${e.kind}: ${e.message}${e.stack ? `
${e.stack}` : ""}`);
  send({
    kind: e.kind === "rejection" ? "renderer-rejection" : "renderer",
    message: String(e.message),
    stack: e.stack
  });
}
function startCrashReporting() {
  consent = readSettings().crashReports;
  electron.crashReporter.start({
    submitURL: CRASH_ENDPOINT,
    uploadToServer: consent === "on" && !hidden$2,
    compress: true,
    globalExtra: { _productName: "Pixl Playroom", _version: electron.app.getVersion() }
  });
  process.on("uncaughtException", (err) => {
    log.error("uncaught exception in main", err);
    send({ kind: "main", message: err.message, stack: err.stack });
    if (!hidden$2)
      electron.dialog.showErrorBox(
        concepts.t("A JavaScript error occurred in the main process"),
        err.stack ?? err.message
      );
  });
  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.error("unhandled rejection in main", err);
    send({ kind: "rejection", message: err.message, stack: err.stack });
  });
  electron.app.on("render-process-gone", (_e, _wc, d) => {
    if (BENIGN.has(d.reason)) return;
    log.error(`renderer gone: ${d.reason} (${d.exitCode})`);
    send({
      kind: "process-gone",
      message: `renderer ${d.reason}`,
      process: { type: "renderer", reason: d.reason, exitCode: d.exitCode }
    });
  });
  electron.app.on("child-process-gone", (_e, d) => {
    if (BENIGN.has(d.reason)) return;
    log.error(`${d.type} process gone: ${d.reason} (${d.exitCode})${d.name ? ` ${d.name}` : ""}`);
    send({
      kind: "process-gone",
      message: `${d.type} ${d.reason}`,
      process: { type: d.type, reason: d.reason, exitCode: d.exitCode, name: d.name }
    });
  });
}
const HIDDEN_REST_MS = 6e4;
const INACTIVE_REST_MS = 12e4;
function restDelay(state2) {
  if (!state2.visible) return HIDDEN_REST_MS;
  if (!state2.focused) return INACTIVE_REST_MS;
  return null;
}
function engineTempPid(name) {
  const m = /^\..+\.pixl-(\d+)-\d+\.tmp$/.exec(name);
  return m ? Number(m[1]) : null;
}
const RECHECK_MS = 15e3;
const ASSUME_FOCUSED = process.env.PLAYROOM_ASSUME_FOCUSED === "1";
function windowState() {
  const wins = electron.BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
  const visible2 = wins.some((w) => w.isVisible() && !w.isMinimized());
  return {
    visible: visible2,
    focused: ASSUME_FOCUSED ? visible2 : electron.BrowserWindow.getFocusedWindow() !== null
  };
}
function watchRest(engines, wake, rest) {
  let timer2;
  let recheck;
  let resting = false;
  let deadline = 0;
  const letGo = () => {
    const gone = engines.filter((e) => !e.busy?.() && e.engine.sleep());
    if (gone.length > 0) log.info(`rest: ${gone.length} engine host(s) let go`);
  };
  const update2 = () => {
    const delay = restDelay(windowState());
    if (delay === null) {
      clearTimeout(timer2);
      timer2 = void 0;
      clearInterval(recheck);
      recheck = void 0;
      if (resting) {
        resting = false;
        log.info("rest: back in use");
        wake();
      }
      return;
    }
    if (resting) return;
    const at = Date.now() + delay;
    if (timer2 && at >= deadline) return;
    clearTimeout(timer2);
    deadline = at;
    timer2 = setTimeout(() => {
      timer2 = void 0;
      if (restDelay(windowState()) === null) return;
      resting = true;
      rest?.();
      letGo();
      recheck = setInterval(letGo, RECHECK_MS);
    }, delay);
  };
  const soon2 = () => void setTimeout(update2, 0);
  const watch = (w) => {
    for (const ev of ["hide", "show", "minimize", "restore", "closed"])
      w.on(ev, soon2);
  };
  electron.BrowserWindow.getAllWindows().forEach(watch);
  electron.app.on("browser-window-created", (_, w) => watch(w));
  electron.app.on("browser-window-focus", soon2);
  electron.app.on("browser-window-blur", soon2);
  soon2();
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
async function sweepEngineTemps(root) {
  let names;
  try {
    names = await promises.readdir(root, { recursive: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const rel of names) {
    const pid = engineTempPid(path.basename(rel));
    if (pid === null || alive(pid)) continue;
    await promises.rm(path.join(root, rel), { force: true }).then(
      () => n++,
      () => void 0
    );
  }
  return n;
}
function gemmaInBuild(packaged) {
  return !packaged;
}
const HEAVY_BARS = {
  // Gemma names a photo in 11–17 s on an M2 Pro's GPU and 26–32 s on its CPU
  // (2026-10-08); a minute a photo is past what background naming can keep.
  gemma: {
    meanMs: 45e3,
    slowdown: 1.35,
    memoryShare: 0.6,
    minTotalMb: 8192,
    unit: concepts.tk("photo named")
  },
  // SAM 3: 17.7 s an embedding on the M2 Pro's CPU, 5.1 GB at its peak.
  sam3: { meanMs: 4e4, slowdown: 1.35, memoryShare: 0.6, minTotalMb: 8192, unit: concepts.tk("photo read") }
};
const secs = (ms) => `${(ms / 1e3).toFixed(1)} s`;
const gb = (mb) => `${(mb / 1024).toFixed(1)} GB`;
function judgeSustained(model, runs, peakMb, totalMb) {
  const bar = HEAVY_BARS[model];
  const fails = [];
  if (runs.length < 2) return { passed: false, reasons: [concepts.t("The benchmark did not finish")] };
  const mean = runs.reduce((s, r) => s + r.ms, 0) / runs.length;
  const first = runs[1]?.ms ?? runs[0].ms;
  const last2 = runs[runs.length - 1].ms;
  const slowdown = last2 / Math.max(1, first);
  if (totalMb < bar.minTotalMb)
    fails.push(
      concepts.t("This computer has {{memory}} of memory; it needs {{needed}} or more", {
        memory: gb(totalMb),
        needed: gb(bar.minTotalMb)
      })
    );
  if (peakMb > bar.memoryShare * totalMb)
    fails.push(
      concepts.t("It used {{peak}}, more than {{share}} % of this computer’s {{memory}}", {
        peak: gb(peakMb),
        share: Math.round(bar.memoryShare * 100),
        memory: gb(totalMb)
      })
    );
  if (mean > bar.meanMs)
    fails.push(
      concepts.t("Each {{unit}} took {{mean}} on average; it has to be under {{bar}}", {
        unit: concepts.t(bar.unit),
        mean: secs(mean),
        bar: secs(bar.meanMs)
      })
    );
  if (slowdown > bar.slowdown)
    fails.push(
      concepts.t("It slowed down by {{share}} % as it kept working (too hot, or too little room)", {
        share: Math.round((slowdown - 1) * 100)
      })
    );
  if (fails.length) return { passed: false, reasons: fails };
  return {
    passed: true,
    reasons: [
      concepts.t("{{mean}} a {{unit}}, {{pace}}, {{peak}} of {{memory}}", {
        mean: secs(mean),
        unit: concepts.t(bar.unit),
        pace: slowdown <= 1.05 ? concepts.t("steady") : concepts.t("{{share}} % slower by the end", { share: Math.round((slowdown - 1) * 100) }),
        peak: gb(peakMb),
        memory: gb(totalMb)
      })
    ]
  };
}
function machineKey(cpu, totalMb) {
  return `${cpu.trim()} · ${Math.round(totalMb / 1024)} GB`;
}
function benchmarkHolds(b, machine) {
  return !!b && b.passed && b.machine === machine;
}
function readSwitches(v) {
  const o = v && typeof v === "object" ? v : {};
  const heavy = o.heavy && typeof o.heavy === "object" ? o.heavy : {};
  const one = (k) => {
    const h = heavy[k] && typeof heavy[k] === "object" ? heavy[k] : {};
    const b = h.benchmark;
    const valid = !!b && typeof b === "object" && b.model === k && Array.isArray(b.runs) && typeof b.passed === "boolean";
    return { on: h.on === true && valid && b.passed, benchmark: valid ? b : null };
  };
  return { enabled: o.enabled !== false, heavy: { gemma: one("gemma"), sam3: one("sam3") } };
}
function heavyAllowed(s, model, machine) {
  return s.enabled && s.heavy[model].on && benchmarkHolds(s.heavy[model].benchmark, machine);
}
async function sha256$2(file) {
  const h = crypto.createHash("sha256");
  await promises$1.pipeline(fs.createReadStream(file), h);
  return h.digest("hex");
}
async function carryOver(modelsRoot, m) {
  const base = path.join(modelsRoot, m.id);
  const dest = path.join(base, m.version);
  for (const name of await promises.readdir(base).catch(() => [])) {
    const dir = path.join(base, name);
    if (name === m.version || !(await promises.stat(dir).catch(() => null))?.isDirectory()) continue;
    let same = true;
    for (const f of m.files) {
      const s = await promises.stat(path.join(dir, f.name)).catch(() => null);
      if (!s || s.size !== f.bytes || await sha256$2(path.join(dir, f.name)) !== f.sha256) {
        same = false;
        break;
      }
    }
    if (!same) continue;
    await promises.rm(dest, { recursive: true, force: true });
    await promises.rename(dir, dest);
    return true;
  }
  return false;
}
const BRAINS_DIR = "brains";
function keptBesides(onDemand, held2) {
  return /* @__PURE__ */ new Set([...onDemand, ...held2, BRAINS_DIR]);
}
async function retiredModelDirs(modelsRoot, shipped, keep) {
  const out = [];
  for (const d of await promises.readdir(modelsRoot, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || d.name.startsWith(".") || keep.has(d.name)) continue;
    const version = shipped.get(d.name);
    if (!version) {
      out.push(d.name);
      continue;
    }
    for (const v of await promises.readdir(path.join(modelsRoot, d.name), { withFileTypes: true }).catch(
      () => []
    ))
      if (v.isDirectory() && v.name !== version) out.push(`${d.name}/${v.name}`);
  }
  return out;
}
const run$1 = util.promisify(child_process.execFile);
const BRAIN_ID = "gemma-4-e2b-it";
class NamingAnswerError extends Error {
}
const RUNTIME_ID = "llama-server";
const IDLE_MS$1 = 5 * 6e4;
const BENCH_RUNS = 5;
const PINS = auto__namespace.pins;
function platformKey() {
  if (!gemmaInBuild(electron.app.isPackaged)) return null;
  if (process.platform === "darwin") return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  if (process.platform === "win32" && process.arch === "x64") return "win32-x64-vulkan";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  return null;
}
function gpuLayers(key) {
  return key === "darwin-arm64" || key.endsWith("vulkan") ? 99 : 0;
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => a && typeof a === "object" ? resolve(a.port) : reject(new Error("no port")));
    });
  });
}
async function rssMb(pid) {
  try {
    if (process.platform === "win32") {
      const { stdout: stdout2 } = await run$1("powershell", [
        "-NoProfile",
        "-Command",
        `(Get-Process -Id ${pid}).WorkingSet64`
      ]);
      return Math.round(parseInt(stdout2, 10) / 1048576);
    }
    const { stdout } = await run$1("ps", ["-o", "rss=", "-p", String(pid)]);
    return Math.round(parseInt(stdout, 10) / 1024);
  } catch {
    return null;
  }
}
function benchPicture() {
  const w = 768;
  const h = 512;
  const px2 = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r, g, b;
      if (y < h * 0.62) {
        const t = y / (h * 0.62);
        r = 90 + 80 * t;
        g = 150 + 60 * t;
        b = 230 - 20 * t;
      } else {
        r = 60;
        g = 140 - (y - h * 0.62) * 0.2;
        b = 50;
      }
      if ((x - 620) ** 2 + (y - 90) ** 2 < 40 ** 2) [r, g, b] = [250, 220, 90];
      if (x > 250 && x < 430 && y > 250 && y < 360) [r, g, b] = [200, 180, 150];
      if (y > 170 && y <= 250 && Math.abs(x - 340) < (y - 170) * 1.2) [r, g, b] = [180, 40, 35];
      if (x > 320 && x < 360 && y > 300 && y < 360) [r, g, b] = [90, 60, 40];
      px2[i] = r;
      px2[i + 1] = g;
      px2[i + 2] = b;
      px2[i + 3] = 255;
    }
  return ops.encodePng8(px2, w, h, 6);
}
class BrainStore {
  constructor(models2, switches) {
    this.models = models2;
    this.switches = switches;
    switches.onChange((s) => {
      if (!s.enabled || !s.heavy.gemma.on) void this.stop();
    });
  }
  models;
  switches;
  brain = PINS.brains.find((b) => b.id === BRAIN_ID);
  runtime = PINS.runtimes.find((r) => r.id === RUNTIME_ID);
  key = platformKey();
  download_ = null;
  failed = null;
  server = null;
  starting = null;
  brainObj = null;
  idle;
  benching = false;
  /** Naming calls in flight. */
  busy = 0;
  dir() {
    return path.join(index$1.paths.models(), BRAINS_DIR, BRAIN_ID, this.brain.source.commit.slice(0, 12));
  }
  runtimeDir() {
    return path.join(index$1.paths.models(), BRAINS_DIR, RUNTIME_ID, this.runtime.source.tag);
  }
  files() {
    if (!this.key) return [];
    const archive = this.runtime.platforms[this.key];
    return [
      {
        pin: this.brain.files.model,
        url: auto__namespace.brainUrl(BRAIN_ID, "model"),
        dest: path.join(this.dir(), this.brain.files.model.name)
      },
      {
        pin: this.brain.files.mmproj,
        url: auto__namespace.brainUrl(BRAIN_ID, "mmproj"),
        dest: path.join(this.dir(), this.brain.files.mmproj.name)
      },
      {
        pin: archive,
        url: auto__namespace.runtimeUrl(RUNTIME_ID, this.key),
        dest: path.join(this.runtimeDir(), archive.name)
      }
    ];
  }
  /** The server's binary, once the archive is unpacked. */
  async binary() {
    if (!this.key) return null;
    const name = this.runtime.binary[process.platform];
    const walk = async (d, depth) => {
      for (const e of await promises.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.isFile() && e.name === name) return path.join(d, e.name);
        if (e.isDirectory() && depth < 3) {
          const found = await walk(path.join(d, e.name), depth + 1);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(this.runtimeDir(), 0);
  }
  async installed() {
    for (const f of this.files()) {
      const s = await promises.stat(f.dest).catch(() => null);
      if (!s || s.size !== f.pin.bytes) return false;
    }
    return this.files().length > 0 && await this.binary() !== null;
  }
  async status() {
    const s = await this.switches.get();
    const total = this.files().reduce((n, f) => n + f.pin.bytes, 0);
    return {
      id: BRAIN_ID,
      supported: this.key !== null,
      bytes: total,
      licence: `${this.brain.licence} (model) · ${this.runtime.licence} (llama.cpp)`,
      installed: await this.installed(),
      progress: this.download_ ? this.download_.done / Math.max(1, this.download_.total) : null,
      error: this.failed,
      running: this.server !== null,
      benchmarking: this.benching,
      on: s.heavy.gemma.on,
      benchmark: s.heavy.gemma.benchmark,
      machine: this.switches.machine
    };
  }
  emit() {
    void this.status().then((st) => {
      for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(index$1.IPC.brain.event, st);
    });
  }
  async download() {
    if (this.download_ || !this.key || await this.installed()) return;
    const abort = new AbortController();
    const files = this.files();
    const state2 = { abort, done: 0, total: files.reduce((n, f) => n + f.pin.bytes, 0) };
    this.download_ = state2;
    this.failed = null;
    this.emit();
    let last2 = 0;
    try {
      for (const f of files) {
        await promises.mkdir(path.join(f.dest, ".."), { recursive: true });
        const have = await promises.stat(f.dest).catch(() => null);
        if (have?.size === f.pin.bytes) {
          state2.done += f.pin.bytes;
          continue;
        }
        await this.models.fetchFile(f.url, f.dest, f.pin, abort.signal, (n) => {
          state2.done += n;
          if (Date.now() - last2 > 250) {
            last2 = Date.now();
            this.emit();
          }
        });
      }
      const archive = files[2].dest;
      await run$1("tar", ["-xf", archive, "-C", this.runtimeDir()]);
      if (!await this.binary()) throw new Error("the llama.cpp archive held no server");
      log.info("brain installed", BRAIN_ID, this.runtime.source.tag);
    } catch (err) {
      if (!abort.signal.aborted) {
        this.failed = err.message;
        log.warn("brain download failed", this.failed);
      }
    } finally {
      this.download_ = null;
      this.emit();
    }
  }
  cancel() {
    this.download_?.abort.abort();
  }
  async remove() {
    this.cancel();
    await this.stop();
    await this.switches.setHeavy("gemma", false).catch(() => void 0);
    await promises.rm(path.join(index$1.paths.models(), BRAINS_DIR), { recursive: true, force: true });
    this.emit();
  }
  /**
   * The assistant, its server started if it isn't (Gemma on, AI on). `bench`
   * starts it for the benchmark, before it may be on.
   */
  async open(bench = false) {
    if (!this.key) throw new Error("Gemma isn’t part of this version of Playroom");
    if (!bench && !await this.switches.allowed("gemma"))
      throw new Error("Gemma is off: turn it on in Settings → AI models");
    if (!await this.switches.enabled()) throw new Error("AI models are off in Settings");
    this.touch();
    if (this.brainObj && this.server) return this.brainObj;
    this.starting ??= this.launch().finally(() => this.starting = null);
    return this.starting;
  }
  async launch() {
    const binary = await this.binary();
    if (!binary || !await this.installed()) throw new Error("Gemma is not downloaded yet");
    const api_key = crypto.randomBytes(32).toString("hex");
    const port = await freePort();
    const t0 = Date.now();
    this.server = await auto__namespace.startLocalServer({
      binary,
      model: path.join(this.dir(), this.brain.files.model.name),
      mmproj: path.join(this.dir(), this.brain.files.mmproj.name),
      host: "127.0.0.1",
      port,
      threads: Math.max(2, Math.min(8, os.cpus().length - 2)),
      context: 8192,
      gpu_layers: gpuLayers(this.key),
      ready_timeout_ms: 18e4,
      log: null,
      api_key
    });
    log.info("brain started", BRAIN_ID, `${Date.now() - t0} ms`, `port ${port}`);
    this.brainObj = new auto__namespace.LocalServerBrain({
      url: this.server.url,
      brain: BRAIN_ID,
      seed: 1,
      // Gemma pretty-prints its JSON: under 3000 a plan is cut off (the guide).
      max_tokens: { plan: 3e3, rephrase: 40, describe: 300 },
      timeout_ms: 18e4,
      workers: auto__namespace.workersForPrompt(),
      api_key
    });
    const inner = this.brainObj;
    inner._system = pixlfile.namingSystem(localServer.SYSTEM, auto__namespace.workersForPrompt());
    this.emit();
    return this.brainObj;
  }
  /** Something asked of it: its idle time starts again. */
  touch() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.stop(), IDLE_MS$1);
    this.idle.unref();
  }
  /**
   * The server killed now, synchronously: Playroom quitting can't wait for
   * a polite close, and a server left behind would hold its gigabytes.
   */
  killNow() {
    clearTimeout(this.idle);
    const s = this.server;
    this.server = null;
    this.brainObj = null;
    if (s) {
      try {
        process.kill(s.pid);
      } catch {
      }
    }
  }
  async stop() {
    clearTimeout(this.idle);
    const s = this.server;
    this.server = null;
    this.brainObj = null;
    if (s) {
      await s.close().catch(() => void 0);
      log.info("brain stopped");
      this.emit();
    }
  }
  /** Naming only: the plan's schema with no edits (the guide §1a). */
  namingSchema() {
    const schema = auto__namespace.planSchema({ auto: true });
    schema.properties.edits = { ...schema.properties.edits, maxItems: 0 };
    return schema;
  }
  /** One naming call on an open brain: Gemma's answer, as names (flagged targets dropped). */
  async ask(brain, image, mime) {
    const inner = brain;
    const choice = await inner._chat("plan", {
      messages: inner._messages(pixlfile.NAME_PROMPT, image, mime),
      response_format: {
        type: "json_schema",
        json_schema: { name: "plan", schema: this.namingSchema(), strict: true }
      },
      max_tokens: pixlfile.NAME_MAX_TOKENS
    });
    let plan;
    try {
      plan = JSON.parse(choice.message.content);
    } catch {
      throw new NamingAnswerError("Gemma’s answer was not JSON");
    }
    const problems = auto__namespace.checkPlan(plan);
    return pixlfile.namesFromPlan(plan, problems, BRAIN_ID, (/* @__PURE__ */ new Date()).toISOString());
  }
  /** What is in this picture, named by Gemma (on, AI on): its server started if it isn't. */
  async name(image, mime) {
    const brain = await this.open();
    this.busy++;
    try {
      return await this.ask(brain, image, mime);
    } finally {
      this.busy--;
      this.touch();
    }
  }
  /** Naming now (Playroom's rest leaves the server up until it is done). */
  isBusy() {
    return this.busy > 0 || this.benching;
  }
  /**
   * The sustained-load benchmark: the server started (its load timed), then
   * the same naming run five times back to back, the server's memory
   * sampled each second. Judged by shared/heavy.ts and kept; the server
   * stops after unless Gemma was already on and running.
   */
  async benchmark(progress) {
    if (this.benching) throw new Error("The benchmark is already running");
    if (!await this.installed()) throw new Error("Download Gemma first");
    this.benching = true;
    this.emit();
    const wasRunning = this.server !== null;
    let peak = 0;
    let sampler;
    const runs = [];
    let readyMs = 0;
    try {
      progress(0, "Starting Gemma");
      const t0 = Date.now();
      const brain = await this.open(true);
      readyMs = Date.now() - t0;
      const sample = async () => {
        const m = this.server ? await rssMb(this.server.pid) : null;
        if (m && m > peak) peak = m;
      };
      await sample();
      sampler = setInterval(() => void sample(), 1e3);
      const image = benchPicture();
      for (let i = 0; i < BENCH_RUNS; i++) {
        progress((i + 0.5) / BENCH_RUNS, `Run ${i + 1} of ${BENCH_RUNS}`);
        const t = Date.now();
        await this.ask(brain, image, "image/png");
        runs.push({ ms: Date.now() - t });
        this.touch();
      }
      await sample();
    } catch (err) {
      log.warn("brain benchmark stopped", err.message);
      runs.length = Math.min(runs.length, 1);
    } finally {
      clearInterval(sampler);
      this.benching = false;
      if (!wasRunning) await this.stop();
    }
    const totalMb = Math.round(os.totalmem() / 1048576);
    const judged = judgeSustained("gemma", runs, peak, totalMb);
    const b = {
      model: "gemma",
      at: (/* @__PURE__ */ new Date()).toISOString(),
      machine: this.switches.machine,
      readyMs,
      runs,
      peakMb: peak,
      totalMb,
      ...judged
    };
    log.info("brain benchmark", JSON.stringify(b));
    await this.switches.recordBenchmark(b);
    progress(1, b.passed ? "Passed" : "Did not pass");
    this.emit();
    return b;
  }
}
function idleOnPower(idleSeconds) {
  return !electron.powerMonitor.isOnBatteryPower() && electron.powerMonitor.getSystemIdleTime() >= idleSeconds;
}
const IDLE_S$1 = Number(process.env.PLAYROOM_NAMING_IDLE_S ?? 60);
const CHECK_MS$1 = Number(process.env.PLAYROOM_NAMING_CHECK_MS ?? 3e4);
const BATCH$1 = 25;
class Namer {
  constructor(index2, library, brain, switches) {
    this.index = index2;
    this.library = library;
    this.brain = brain;
    this.switches = switches;
  }
  index;
  library;
  brain;
  switches;
  timer;
  running = false;
  now = /* @__PURE__ */ new Map();
  start() {
    this.timer = setInterval(() => void this.tick(), CHECK_MS$1);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
  }
  /** May it name in the background now? */
  async mayRun() {
    return idleOnPower(IDLE_S$1) && this.switches.allowed("gemma");
  }
  async tick() {
    if (this.running || !await this.mayRun()) return;
    this.running = true;
    let named2 = 0;
    try {
      const ids = await this.index.unnamed(BATCH$1);
      for (const id of ids) {
        if (!await this.mayRun()) break;
        if (this.now.has(id)) continue;
        try {
          await this.nameOne(id);
          named2++;
        } catch (err) {
          log.warn("naming stopped", err.message);
          break;
        }
      }
    } finally {
      this.running = false;
      if (named2 > 0) {
        log.info(`naming: ${named2} photo(s) named`);
        await this.brain.stop();
      }
    }
  }
  /** Name one photo and keep it; a usable-less answer is kept as tried. */
  async nameOne(photoId) {
    const image = await this.library.namingPicture(photoId);
    try {
      const t = Date.now();
      const names = await this.brain.name(image, "image/jpeg");
      log.info("named", photoId, `${Date.now() - t} ms`, names.things.length);
      const had = pixlfile.readNames(await this.index.namesOf(photoId));
      if (had?.edited) return had;
      await this.publish(photoId, await this.index.setNames(photoId, JSON.stringify(names)), names);
      return names;
    } catch (err) {
      if (!(err instanceof NamingAnswerError)) throw err;
      log.info("naming: no usable answer", photoId, err.message);
      await this.index.namingFailed(photoId);
      return null;
    }
  }
  /** The open photo, named now (from its Masks pane): shared with one in flight. */
  nameNow(photoId) {
    let p = this.now.get(photoId);
    if (!p) {
      p = this.nameOne(photoId).finally(() => this.now.delete(photoId));
      this.now.set(photoId, p);
    }
    return p;
  }
  /** The user's own changes to a photo's names (a chip taken off, one typed). */
  async edit(photoId, names) {
    const items = await this.index.setNames(photoId, names ? JSON.stringify(names) : null);
    await this.publish(photoId, items, names);
  }
  async publish(photoId, items, names) {
    for (const w of electron.BrowserWindow.getAllWindows()) {
      w.webContents.send(index$1.IPC.names.event, { photoId, names });
      w.webContents.send(index$1.IPC.library.names, {
        photoId,
        words: items[0]?.names ?? []
      });
    }
  }
}
const DEFAULT_THRESHOLDS = {
  burstSoft: 0.35,
  subjectSoft: 0.2,
  motionCoherence: 0.6,
  burstMotion: 0.6,
  darkMedian: 0.05,
  darkCrushed: 0.3,
  brightBlown: 0.25,
  blink: 0.6,
  duplicateBits: 4
};
const THRESHOLD_BOUNDS = {
  burstSoft: [0.15, 0.7],
  subjectSoft: [0.08, 0.5],
  darkMedian: [0.02, 0.15],
  brightBlown: [0.08, 0.5],
  blink: [0.4, 0.9]
};
const MIN_SAMPLES = 5;
function decided(i) {
  return i.rating > 0 || i.flag !== null || i.keep;
}
function focusScore(s) {
  return (s.focus.subject ?? s.focus.whole).laplacian;
}
const pct$1 = (x) => `${Math.round(x * 100)}%`;
function suggestRejects(inputs, th = DEFAULT_THRESHOLDS) {
  const out = /* @__PURE__ */ new Map();
  const add = (id, r) => {
    const list = out.get(id) ?? [];
    if (!list.some((x) => x.kind === r.kind)) list.push(r);
    out.set(id, list);
  };
  const measured = inputs.filter((i) => i.signals);
  const groups = pixlfile.phashGroups(measured.map((i) => ({ ...i, phash: i.signals.phash })));
  for (const g of groups) {
    const chosen = (i) => Number(i.rating > 0 || i.flag === "pick");
    const best = [...g].sort(
      (a, b) => chosen(b) - chosen(a) || focusScore(b.signals) - focusScore(a.signals)
    )[0];
    const top = Math.max(...g.map((i) => focusScore(i.signals)));
    for (const i of g) {
      if (i === best || decided(i)) continue;
      const s = i.signals;
      const share = top > 0 ? focusScore(s) / top : 1;
      if (share < th.burstSoft)
        add(i.photoId, {
          kind: "soft",
          text: s.focus.subject ? concepts.t("Subject soft · focus {{share}} of the burst’s best", { share: pct$1(share) }) : concepts.t("Soft · focus {{share}} of the burst’s best", { share: pct$1(share) })
        });
      else if (s.focus.whole.coherence >= th.motionCoherence && share < th.burstMotion)
        add(i.photoId, {
          kind: "motion",
          text: concepts.t("Motion blur · focus {{share}} of the burst’s best", { share: pct$1(share) })
        });
      const d = pixlfile.phashDistance(s.phash, best.signals.phash);
      if (d !== null && d <= th.duplicateBits && share >= 0.9)
        add(i.photoId, { kind: "duplicate", text: concepts.t("Duplicate of {{name}}", { name: best.name }) });
    }
  }
  for (const i of measured) {
    if (decided(i)) continue;
    const s = i.signals;
    const sub = s.focus.subject;
    if (sub && s.focus.whole.laplacian > 0 && sub.laplacian / s.focus.whole.laplacian < th.subjectSoft)
      add(i.photoId, { kind: "soft", text: concepts.t("Subject soft · the background is sharper") });
    const e = s.exposure;
    if (e.p50 < th.darkMedian || e.clipLow > th.darkCrushed)
      add(i.photoId, { kind: "dark", text: concepts.t("Too dark · {{share}} crushed", { share: pct$1(e.clipLow) }) });
    else if (e.clipHigh > th.brightBlown)
      add(i.photoId, { kind: "bright", text: concepts.t("Too bright · {{share}} blown", { share: pct$1(e.clipHigh) }) });
    for (const f of s.faces ?? []) {
      const closed = Math.min(f.blinkLeft ?? 0, f.blinkRight ?? 0);
      if (closed >= th.blink) {
        add(i.photoId, { kind: "eyes", text: concepts.t("Eyes closed? ({{score}})", { score: closed.toFixed(2) }) });
        break;
      }
    }
  }
  return out;
}
function fitThreshold(kept, rejected, rejectBelow, bounds) {
  if (kept.length < MIN_SAMPLES || rejected.length < MIN_SAMPLES) return null;
  const values = [.../* @__PURE__ */ new Set([...kept, ...rejected])].sort((a, b) => a - b);
  let best = null;
  for (let k = 0; k + 1 < values.length; k++) {
    const cut = (values[k] + values[k + 1]) / 2;
    const isReject = (v) => rejectBelow ? v < cut : v > cut;
    const tpr = rejected.filter(isReject).length / rejected.length;
    const tnr = kept.filter((v) => !isReject(v)).length / kept.length;
    const score = (tpr + tnr) / 2;
    if (!best || score > best.score) best = { cut, score };
  }
  if (!best || best.score <= 0.5) return null;
  return Math.min(bounds[1], Math.max(bounds[0], best.cut));
}
function samplesOf(inputs) {
  const measured = inputs.filter((i) => i.signals);
  const share = /* @__PURE__ */ new Map();
  for (const g of pixlfile.phashGroups(measured.map((i) => ({ ...i, phash: i.signals.phash })))) {
    const top = Math.max(...g.map((i) => focusScore(i.signals)));
    for (const i of g) share.set(i.photoId, top > 0 ? focusScore(i.signals) / top : 1);
  }
  return measured.filter((i) => decided(i)).map((i) => ({
    rejected: i.flag === "reject",
    signals: i.signals,
    burstShare: share.get(i.photoId) ?? null
  }));
}
function learnThresholds(samples, base = DEFAULT_THRESHOLDS) {
  const side = (f) => {
    const kept = [];
    const rejected = [];
    for (const s of samples) {
      const v = f(s);
      if (v === null || !Number.isFinite(v)) continue;
      (s.rejected ? rejected : kept).push(v);
    }
    return { kept, rejected };
  };
  const fit = (key, f, rejectBelow) => {
    const { kept, rejected } = side(f);
    return fitThreshold(kept, rejected, rejectBelow, THRESHOLD_BOUNDS[key]) ?? base[key];
  };
  return {
    ...base,
    burstSoft: fit("burstSoft", (s) => s.burstShare, true),
    subjectSoft: fit(
      "subjectSoft",
      (s) => s.signals.focus.subject && s.signals.focus.whole.laplacian > 0 ? s.signals.focus.subject.laplacian / s.signals.focus.whole.laplacian : null,
      true
    ),
    darkMedian: fit("darkMedian", (s) => s.signals.exposure.p50, true),
    brightBlown: fit("brightBlown", (s) => s.signals.exposure.clipHigh, false),
    blink: fit(
      "blink",
      (s) => s.signals.faces && s.signals.faces.length ? Math.max(...s.signals.faces.map((f) => Math.min(f.blinkLeft ?? 0, f.blinkRight ?? 0))) : null,
      false
    )
  };
}
const SUBJECT_MODEL = "u2netp";
const NOTHING_SALIENT$1 = 0.2;
const MIN_SUBJECT_SHARE = 0.01;
const SUBJECT_UPSAMPLE = { Guided: { radius: 4e-3, epsilon: 1e-3 } };
const IDLE_S = Number(process.env.PLAYROOM_CULL_IDLE_S ?? 60);
const CHECK_MS = Number(process.env.PLAYROOM_CULL_CHECK_MS ?? 3e4);
const BATCH = 50;
async function started(engine2) {
  if (engine2.getStatus().status === "starting") {
    engine2.start();
    await engine2.whenStarted();
  }
}
class CullMeasurer {
  constructor(index2, library, bgEngine2, aiEngine2, models2, switches) {
    this.index = index2;
    this.library = library;
    this.bgEngine = bgEngine2;
    this.aiEngine = aiEngine2;
    this.models = models2;
    this.switches = switches;
  }
  index;
  library;
  bgEngine;
  aiEngine;
  models;
  switches;
  timer;
  running = false;
  /** Photos that failed this session: not tried again until Playroom starts again. */
  failed = /* @__PURE__ */ new Set();
  start() {
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
  }
  async tick() {
    if (this.running || !idleOnPower(IDLE_S)) return;
    this.running = true;
    let done = 0;
    try {
      const models2 = await this.available();
      const ids = (await this.index.unmeasured(BATCH, models2)).filter((id) => !this.failed.has(id));
      let n = 0;
      if (ids.length) this.progress(0, ids.length);
      for (const id of ids) {
        if (!idleOnPower(IDLE_S) || this.measuring) break;
        try {
          await this.measureAndKeep(id);
          done++;
        } catch (err) {
          this.failed.add(id);
          log.info("cull signals not measured", id, err.message);
        }
        this.progress(++n, ids.length);
      }
      if (ids.length && n < ids.length) this.progress(ids.length, ids.length);
    } finally {
      this.running = false;
      if (done > 0) {
        log.info(`cull signals: ${done} photo(s) measured`);
        this.changed();
      }
    }
  }
  /** How far measuring is, for the indicator atop the window (done = total: finished). */
  progress(done, total) {
    for (const w of electron.BrowserWindow.getAllWindows())
      w.webContents.send(index$1.IPC.cull.progress, { done, total });
  }
  /** Signals or decisions changed: thresholds learnt again, the Library asks again. */
  changed() {
    this.learnt = null;
    for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(index$1.IPC.cull.event, null);
  }
  learnt = null;
  /** The thresholds learnt from the user's keeps and rejects (kept a few minutes). */
  async thresholds() {
    if (this.learnt && Date.now() - this.learnt.at < 5 * 6e4) return this.learnt.t;
    const t = learnThresholds(samplesOf(this.inputsOf(await this.index.cullInputs(null))));
    this.learnt = { at: Date.now(), t };
    return t;
  }
  inputsOf(rows) {
    return rows.map((r) => ({ ...r, signals: pixlfile.readCull(r.signals) }));
  }
  /**
   * The suggested rejects among these items (a photo's own item; its copies
   * are the user's own), with their reasons, by key. Bursts are found among
   * the photos asked about: the folder or collection shown.
   */
  async suggestions(keys) {
    const ids = [
      ...new Set(
        keys.map((k) => pixlfile.parseKey(k)).filter((k) => k.copyId === null).map((k) => k.photoId)
      )
    ];
    const found = suggestRejects(
      this.inputsOf(await this.index.cullInputs(ids)),
      await this.thresholds()
    );
    const out = {};
    for (const [id, reasons] of found) out[pixlfile.keyOf(id, null)] = reasons;
    return out;
  }
  /** The user's Keep (or its undoing) on suggested rejects. */
  async keep(keys, keep) {
    await this.index.setCullKeep([...new Set(keys.map((k) => pixlfile.parseKey(k).photoId))], keep);
    this.changed();
  }
  measuring = null;
  /** Measuring under way (asked for, or an idle batch): the rest keeps the engines until it ends. */
  get busy() {
    return this.measuring !== null || this.running;
  }
  /**
   * Measure now the photos among these not measured yet (the Library's
   * Suggested rejects asked): one at a time, the newest call taking over.
   * Returns how many were measured.
   */
  async measureNow(keys) {
    this.measuring?.abort();
    const abort = new AbortController();
    this.measuring = abort;
    const ids = new Set(keys.map((k) => pixlfile.parseKey(k).photoId));
    const models2 = await this.available();
    const todo = (await this.index.unmeasured(1e5, models2)).filter((id) => ids.has(id));
    let done = 0;
    const send2 = () => this.progress(done, todo.length);
    send2();
    for (const id of todo) {
      if (abort.signal.aborted) break;
      if (this.failed.has(id)) {
        done++;
        continue;
      }
      try {
        await this.measureAndKeep(id);
      } catch (err) {
        this.failed.add(id);
        log.info("cull signals not measured", id, err.message);
      }
      done++;
      if (done % 10 === 0) this.changed();
      send2();
    }
    if (this.measuring === abort) {
      this.measuring = null;
      if (done < todo.length) this.progress(todo.length, todo.length);
    }
    if (done > 0) this.changed();
    return done;
  }
  /** The models a measurement may use now: AI on and their files here. */
  async available() {
    if (!await this.switches.enabled()) return { subject: false, faces: false };
    return {
      subject: await this.models.installed(SUBJECT_MODEL),
      faces: await this.models.installed(recipe.FACE_DETECTOR) && await this.models.installed(recipe.FACE_LANDMARKER)
    };
  }
  /** Measure one photo and keep its signals, with the models it could use. */
  async measureAndKeep(photoId) {
    const models2 = await this.available();
    const s = await this.measure(photoId, models2);
    await this.index.setCull(photoId, JSON.stringify(s), models2);
    return s;
  }
  /** One photo's signals. */
  async measure(photoId, models2) {
    const t0 = Date.now();
    const dir = index$1.paths.cacheRoot();
    const picture = path.join(dir, `cull-${process.pid}-${photoId}.jpg`);
    const plane = path.join(dir, `cull-${process.pid}-${photoId}-subject.png`);
    try {
      await started(this.bgEngine);
      await this.library.writeUnedited(photoId, pixlfile.CULL_EDGE, picture);
      const subject = models2.subject ? await this.subject(picture, plane) : null;
      const faces = models2.faces ? await this.faces(picture) : null;
      const regions = [{ Box: { x: 0, y: 0, width: 1, height: 1 } }];
      if (subject && subject.share >= MIN_SUBJECT_SHARE)
        regions.push({ Mask: { source: { Png: plane }, resampler: "Bilinear" } });
      const stats = await this.bgEngine.analyze({
        phash: true,
        focus: { regions, orientation_bins: pixlfile.FOCUS_BINS },
        source: { Path: picture },
        input: "Jpeg",
        raw: null,
        domain: "Encoded",
        bins: 256,
        percentiles: pixlfile.CULL_PERCENTILES,
        clip_low: pixlfile.CLIP_LOW,
        clip_high: pixlfile.CLIP_HIGH,
        hue_bins: 12,
        stride: 1,
        transparent: "Include",
        threads: source$1.BACKGROUND_THREADS,
        weights: null,
        noise: false,
        orientation: "Normal",
        lens: null,
        limits: source$1.READ_LIMITS,
        hdr: null,
        gain_map: null
      });
      const whole = pixlfile.focusOf(stats.focus?.regions[0]);
      if (!whole) throw new Error("the engine measured no focus");
      return {
        v: pixlfile.CULL_VERSION,
        at: (/* @__PURE__ */ new Date()).toISOString(),
        exposure: pixlfile.exposureOf(stats),
        focus: {
          whole,
          subject: regions.length > 1 ? pixlfile.focusOf(stats.focus?.regions[1]) : null,
          subjectShare: subject ? subject.share : null
        },
        faces,
        phash: stats.phash ?? null,
        ms: Date.now() - t0
      };
    } finally {
      await promises.rm(picture, { force: true });
      await promises.rm(plane, { force: true });
    }
  }
  /** U²-Netp's subject plane written to `out`, and its share of the frame; null without the model or a subject. */
  async subject(picture, out) {
    try {
      await started(this.aiEngine);
      const model = await this.models.ref(SUBJECT_MODEL, "Cpu");
      const r = await this.aiEngine.segment({
        source: { Path: picture },
        input: "Jpeg",
        raw: null,
        gain_map: null,
        orientation: "Normal",
        lens: null,
        segmenter: { Classes: model },
        upsample: SUBJECT_UPSAMPLE,
        png: { compression: "Fast", filter: "Sub" },
        threads: source$1.BACKGROUND_THREADS,
        limits: source$1.READ_LIMITS,
        plane_longest: null
      });
      const p = r.planes[0];
      if (!p || p.raw_max < NOTHING_SALIENT$1) return null;
      const png2 = Buffer.from(p.png);
      const g = ops.grey8(png2);
      let sum = 0;
      for (let i = 0; i < g.data.length; i++) sum += g.data[i];
      await promises.writeFile(out, png2);
      return { share: sum / (255 * Math.max(1, g.data.length)) };
    } catch (err) {
      log.info("cull: no subject plane", err.message);
      return null;
    }
  }
  /** Each face's place and blink hint; null when the faces couldn't be read. */
  async faces(picture) {
    try {
      await started(this.aiEngine);
      const r = await this.aiEngine.faces({
        source: { Path: picture },
        input: "Jpeg",
        raw: null,
        gain_map: null,
        orientation: "Normal",
        lens: null,
        region: null,
        detector: await this.models.ref(recipe.FACE_DETECTOR, "Cpu"),
        landmarks: await this.models.ref(recipe.FACE_LANDMARKER, "Cpu"),
        threads: source$1.BACKGROUND_THREADS,
        limits: source$1.READ_LIMITS
      });
      const W = r.frame_width || 1;
      const H = r.frame_height || 1;
      return r.faces.map((f) => ({
        bounds: [f.bounds[0] / W, f.bounds[1] / H, f.bounds[2] / W, f.bounds[3] / H],
        ...pixlfile.blinkOf(f.blendshapes)
      }));
    } catch (err) {
      log.info("cull: no faces read", err.message);
      return null;
    }
  }
}
const OP_LABEL = {
  Primary: concepts.tk("Exposure, Contrast or Saturation"),
  Tone: concepts.tk("Highlights, Shadows, Whites or Blacks"),
  ChannelMixer: concepts.tk("Calibration"),
  WhiteBalance: concepts.tk("White balance"),
  Dehaze: concepts.tk("Dehaze"),
  HslBands: concepts.tk("Color mixer"),
  Qualifier: concepts.tk("Point color"),
  ColorGrade: concepts.tk("Color grading"),
  Curves: concepts.tk("Tone curve"),
  ParametricCurve: concepts.tk("Tone curve"),
  Lut: concepts.tk("Profile"),
  Denoise: concepts.tk("Noise reduction"),
  Sharpen: concepts.tk("Sharpening"),
  Vibrance: concepts.tk("Vibrance"),
  LocalContrast: concepts.tk("Texture or Clarity"),
  Vignette: concepts.tk("Vignette"),
  Grain: concepts.tk("Grain"),
  AddColor: concepts.tk("Add color"),
  Defringe: concepts.tk("Defringe")
};
const PATH = /^(sdr\.)?grade\.layers\[(\d+)\](?:\.stages\[(\d+)\]\.ops\[(\d+)\](?:\.ops\[(\d+)\])?)?/;
function invariantDetail(detail) {
  const d = detail?.["Invariant"];
  return {
    stage: d && typeof d["stage"] === "string" ? d["stage"] : concepts.t("a stage"),
    text: d && typeof d["detail"] === "string" ? d["detail"] : ""
  };
}
function invariantPlace(text, grade, sdrGrade, layerIndex) {
  const at = PATH.exec(text);
  if (!at) return null;
  const sdr = at[1] !== void 0;
  const g = sdr ? sdrGrade : grade;
  const index2 = Number(at[2]);
  const layer = g?.layers[index2];
  if (!layer) return null;
  let id = null;
  if (!sdr) {
    if (index2 === 0 && layer.name === "base") id = "base";
    else id = Object.keys(layerIndex).find((k) => layerIndex[k] === index2) ?? null;
  }
  let op;
  if (at[3] !== void 0) {
    op = layer.stages[Number(at[3])]?.ops[Number(at[4])];
    if (op && at[5] !== void 0 && "Masked" in op) op = op.Masked.ops[Number(at[5])];
  }
  return { layer: id, layerName: layer.name, op: op ? source$1.opKind(op) : null, sdr };
}
function describeInvariant(place, stage) {
  if (!place)
    return concepts.t("The picture could not be rendered after {{stage}}. Undo the last change.", { stage });
  const where = place.layer === "base" ? concepts.t("the photo’s settings") : concepts.t("“{{name}}”", { name: place.layerName ?? concepts.t("a layer") });
  const label2 = place.op ? OP_LABEL[place.op] : void 0;
  const what = place.op ? label2 ? concepts.t(label2) : place.op : concepts.t("The layer’s blend");
  return concepts.t("{{what}} in {{where}} made pixels that are not numbers. Lower it, or undo.", {
    what,
    where
  });
}
class EngineError extends Error {
  code;
  detail;
  /** For `Invariant`, once named against the request (`nameInvariant`): the layer and op. */
  invariant;
  constructor(shape) {
    super(shape.message);
    this.name = "EngineError";
    this.code = shape.code;
    this.detail = shape.detail;
  }
  /** A stop the caller asked for, not a failure: nothing to report. */
  get cancelled() {
    return this.code === "Cancelled";
  }
  /** The request field the engine named, for `InvalidRequest`. */
  get field() {
    const d = this.detail?.["InvalidRequest"];
    return d && typeof d["field"] === "string" ? d["field"] : void 0;
  }
  /**
   * For `Invariant` (engine 0.18, HR-0.18-9): name the adjustment against the
   * request that was sent, in the message and in `invariant`. The caller keeps
   * the edit and never renders again without the op.
   */
  nameInvariant(grade, sdrGrade, layerIndex) {
    if (this.code !== "Invariant") return this;
    const { stage, text } = invariantDetail(this.detail);
    this.invariant = invariantPlace(text, grade, sdrGrade, layerIndex);
    this.message = describeInvariant(this.invariant, stage);
    return this;
  }
  /** What to tell the user: the engine's words, or plainer ones where it has them. */
  get userMessage() {
    return source$1.unsupportedRaw(this.detail) ?? source$1.describeEngineError(this.code, this.detail) ?? this.message;
  }
}
function isCancelled(err) {
  return err instanceof EngineError && err.cancelled;
}
const MAX_RESTARTS$1 = 5;
const HOLD_MAX_MS = 1500;
const DRAIN_MAX_MS = 250;
function lowerPriority(pid) {
  if (pid === void 0) return;
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
  }
}
class EngineClient {
  constructor(name, libuvThreads, background = false) {
    this.name = name;
    this.libuvThreads = libuvThreads;
    this.background = background;
  }
  name;
  libuvThreads;
  background;
  child;
  nextId = 1;
  inflight = /* @__PURE__ */ new Map();
  /**
   * Calls the host is working on, whether or not their callers still wait
   * (a cancelled one runs on to its next stage boundary): what `quiet` and
   * `drained` watch.
   */
  running = /* @__PURE__ */ new Set();
  /** The cancelled ones among them. */
  draining = /* @__PURE__ */ new Set();
  settleWaiters = [];
  /** An engine whose work this one's new calls wait behind (see `holdFor`). */
  yieldTo;
  /** The window preview frames go to (see `sendPreviewsTo`). */
  previewsTo;
  status = { status: "starting", restarts: 0 };
  stopped = false;
  readyWaiters = [];
  spawned = false;
  /**
   * How many hosts this client has started: what a host holds (SAM's
   * sessions and embeddings) is gone when this moves on.
   */
  generationCount = 0;
  spawnListeners = /* @__PURE__ */ new Set();
  get generation() {
    return this.generationCount;
  }
  /** Hear each new host (after a crash, a restart or a sleep). */
  onSpawn(listener) {
    this.spawnListeners.add(listener);
    return () => this.spawnListeners.delete(listener);
  }
  /**
   * Let the host go while nothing runs, to give back what it holds (SAM's
   * models are hundreds of megabytes); the next call starts a new one.
   * Not a crash: nothing is counted, and no call fails.
   */
  sleep() {
    const child = this.child;
    if (!child || this.running.size > 0 || this.inflight.size > 0) return false;
    this.child = void 0;
    this.spawned = false;
    this.status = { ...this.status, status: "resting", reason: void 0 };
    child.kill();
    return true;
  }
  start() {
    this.stopped = false;
    this.spawned = true;
    this.spawn();
  }
  /** Start it if it never was (one held back from the launch's path). */
  ensureStarted() {
    if (!this.spawned && !this.stopped) this.start();
  }
  stop() {
    this.stopped = true;
    this.child?.kill();
    this.child = void 0;
  }
  /**
   * Kill the host mid-call (a cancelled job): what it was doing fails as
   * Cancelled, and a fresh host starts. Not a crash: it does not count
   * towards giving up.
   */
  restart() {
    const child = this.child;
    if (!child) return;
    this.child = void 0;
    for (const [id, p] of this.inflight) {
      this.inflight.delete(id);
      p.reject(new EngineError({ message: `${p.method}: cancelled`, code: "Cancelled" }));
    }
    child.kill();
    this.ended();
    if (!this.stopped) this.spawn();
  }
  /**
   * Hold this engine's new calls while `other` (the interactive engine) has
   * work in flight, for at most HOLD_MAX_MS each: thumbnails and exports
   * start between renders, not on top of them. What is already running here
   * goes on.
   */
  holdFor(other) {
    this.yieldTo = other;
  }
  /**
   * Send preview frames (`convert` with `frame`) straight from the host to
   * this window, over a channel of their own: the pixels never pass through
   * main. Called again when the window loads anew (its old port is gone).
   */
  sendPreviewsTo(wc) {
    this.previewsTo = wc;
    this.connectPreviews();
  }
  connectPreviews() {
    const child = this.child;
    const wc = this.previewsTo;
    if (!child || !wc || wc.isDestroyed()) return;
    const { port1, port2 } = new electron.MessageChannelMain();
    child.postMessage({ kind: "port" }, [port1]);
    wc.postMessage(index$1.IPC.develop.previewPort, null, [port2]);
  }
  /** Resolves when no call is running here, or after `maxMs`. */
  quiet(maxMs) {
    return this.until(() => this.running.size === 0, maxMs);
  }
  /** Resolves when no cancelled call is still running here, or after `maxMs`. */
  drained(maxMs) {
    return this.until(() => this.draining.size === 0, maxMs);
  }
  until(done, maxMs) {
    if (done()) return Promise.resolve();
    return new Promise((resolve) => {
      let over = false;
      const finish = () => {
        over = true;
        clearTimeout(timer2);
        resolve();
      };
      const timer2 = setTimeout(finish, maxMs);
      const check = () => {
        if (over) return;
        if (done()) finish();
        else this.settleWaiters.push(check);
      };
      this.settleWaiters.push(check);
    });
  }
  /** A call the host was working on has ended (answered, or the host gone). */
  ended(id) {
    if (id === void 0) {
      this.running.clear();
      this.draining.clear();
    } else {
      this.running.delete(id);
      this.draining.delete(id);
    }
    for (const w of this.settleWaiters.splice(0)) w();
  }
  getStatus() {
    return this.status;
  }
  /** Resolves once the host has said hello (ready or not). */
  whenStarted() {
    if (this.status.status !== "starting") return Promise.resolve();
    return new Promise((r) => this.readyWaiters.push(r));
  }
  probe(path2) {
    return this.call("probe", [path2]);
  }
  convert(request, opts = {}) {
    return this.call("convert", [request], opts.signal, opts.frame);
  }
  analyze(request, opts = {}) {
    return this.call("analyze", [request], opts.signal);
  }
  /** What a lens correction does to a `width × height` frame, without pixels. */
  lensFrame(lens, width, height) {
    return this.call("lensFrame", [lens, width, height, 2]);
  }
  /** The rectangle a framing keeps of a `width × height` frame (after `Outside::Crop`). */
  framingCrop(framing, width, height) {
    return this.call("framingCrop", [framing, width, height]);
  }
  /** Measure a photo's lines and suggest an Upright (see `upright.rs`). */
  suggestUpright(request) {
    return this.call("suggestUpright", [request]);
  }
  /** The Upright that makes guide lines vertical or horizontal (Guided). */
  uprightFromLines(lines, width, height, focal) {
    return this.call("uprightFromLines", [lines, width, height, focal]);
  }
  /**
   * Run a segmentation model on a photo (`segment`); each plane's PNG is a
   * Buffer. A signal stops the model mid-run (0.16).
   */
  segment(request, opts = {}) {
    return this.call("segment", [request], opts.signal);
  }
  /**
   * Faces and their parts (engine 0.19, `faces`): YuNet's boxes, and with a
   * landmarker each face's outlines as polygons (fractions of the frame).
   */
  faces(request, opts = {}) {
    return this.call("faces", [request], opts.signal);
  }
  /** Time models on providers (`benchmark`). */
  benchmark(request, opts = {}) {
    return this.call("benchmark", [request], opts.signal);
  }
  /**
   * One of SAM 2.1's calls (`SamOp`): its sessions, embeddings and logits
   * stay in the host, named by id. A signal stops the model mid-run.
   */
  sam(call, opts = {}) {
    const run2 = () => this.post("sam", (id, cancellable) => ({ kind: "sam", id, call, cancellable }), opts.signal);
    return run2();
  }
  /** Where a heal or clone should copy from (see `retouch/suggest.rs`). */
  suggestHealSource(request) {
    return this.call("suggestHealSource", [request]);
  }
  /** Measure a photo's lateral chromatic aberration (see `lateral_ca.rs`). */
  suggestLateralCa(request) {
    return this.call("suggestLateralCa", [request]);
  }
  /** The white that makes a linear sample neutral, as the `WhiteBalance` op names it. */
  whiteBalanceFromPixel(rgb2, space) {
    return this.call("whiteBalanceFromPixel", [rgb2, space]);
  }
  spawn() {
    this.generationCount++;
    for (const l of this.spawnListeners) l(this.generationCount);
    const entry = path.join(MAIN_DIR, "engine-host.js");
    const child = electron.utilityProcess.fork(entry, [], {
      serviceName: `pixl-engine-${this.name}`,
      stdio: "pipe",
      env: { ...process.env, UV_THREADPOOL_SIZE: String(this.libuvThreads) }
    });
    this.child = child;
    this.status = { ...this.status, status: "starting", reason: void 0 };
    if (this.background) child.once("spawn", () => lowerPriority(child.pid));
    child.once("spawn", () => this.connectPreviews());
    child.stdout?.on(
      "data",
      (d) => log.info(`[engine:${this.name}]`, d.toString().trimEnd())
    );
    child.stderr?.on(
      "data",
      (d) => log.warn(`[engine:${this.name}]`, d.toString().trimEnd())
    );
    child.on("message", (msg) => this.onMessage(msg));
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = void 0;
      const reason = `engine host ${this.name} exited with code ${code}`;
      log.error(reason);
      for (const [id, p] of this.inflight) {
        this.inflight.delete(id);
        p.reject(new EngineError({ message: `${p.method}: ${reason}`, code: "EngineCrashed" }));
      }
      this.ended();
      if (this.stopped) return;
      const restarts = this.status.restarts + 1;
      if (restarts > MAX_RESTARTS$1) {
        this.status = { status: "crashed", restarts, reason: `${reason}; gave up restarting` };
        return;
      }
      this.status = { status: "crashed", restarts, reason };
      setTimeout(
        () => {
          if (!this.stopped && !this.child) this.spawn();
        },
        Math.min(500 * restarts, 5e3)
      );
    });
  }
  onMessage(msg) {
    if (msg.kind === "hello") {
      this.status = msg.status === "ready" ? {
        status: "ready",
        version: msg.version,
        enhance: msg.enhance,
        runtime: msg.runtime,
        prompt: msg.prompt,
        restarts: this.status.restarts
      } : {
        status: "unavailable",
        reason: msg.reason,
        code: msg.code,
        restarts: this.status.restarts
      };
      log.info(`engine ${this.name}`, this.status);
      for (const w of this.readyWaiters.splice(0)) w();
      return;
    }
    if (msg.kind === "response") {
      this.ended(msg.id);
      const p = this.inflight.get(msg.id);
      if (!p) return;
      this.inflight.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new EngineError(msg.error ?? { message: "unknown error", code: "Unknown" }));
    }
  }
  /**
   * One call to the host. With a signal, aborting it tells the host to stop
   * and settles the call at once as `Cancelled`; the engine lets go of the
   * work at its next stage boundary, and its late answer is dropped. Before
   * it starts, a call waits (briefly) behind the interactive engine's work
   * (`holdFor`), and a cancellable one behind cancelled calls still letting
   * go: two renders never fight over the cores.
   */
  call(method, args, signal, frame) {
    const hold = this.yieldTo && this.yieldTo.running.size > 0;
    const drain = signal !== void 0 && this.draining.size > 0;
    const message = (id, cancellable) => ({
      kind: "request",
      id,
      method,
      args,
      cancellable,
      ...frame ? { frame } : {}
    });
    if (!hold && !drain) return this.post(method, message, signal);
    return (async () => {
      if (hold) await this.yieldTo.quiet(HOLD_MAX_MS);
      if (drain) await this.drained(DRAIN_MAX_MS);
      return this.post(method, message, signal);
    })();
  }
  post(method, message, signal) {
    const cancelled2 = () => new EngineError({ message: `${method}: cancelled`, code: "Cancelled" });
    if (signal?.aborted) return Promise.reject(cancelled2());
    if (!this.spawned && !this.stopped) {
      this.start();
      return this.whenStarted().then(() => this.post(method, message, signal));
    }
    const child = this.child;
    if (!child) {
      return Promise.reject(
        new EngineError({
          message: this.status.reason ?? "engine host is not running",
          code: "EngineUnavailable"
        })
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!this.inflight.delete(id)) return;
        this.child?.postMessage({ kind: "cancel", id });
        if (this.running.has(id)) this.draining.add(id);
        reject(cancelled2());
      };
      const done = (settle) => (v) => {
        signal?.removeEventListener("abort", onAbort);
        settle(v);
      };
      this.inflight.set(id, { resolve: done(resolve), reject: done(reject), method });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.running.add(id);
      child.postMessage(message(id, signal !== void 0));
    });
  }
}
const DEFAULT_ENHANCE = {
  jpeg: "off",
  smoothing: 50,
  guidedChroma: false,
  jpegStrength: 100,
  deblur: false,
  deblurStrength: 100,
  upscale: "x2",
  upscaleSource: "clean"
};
const ENHANCE_MODEL = {
  fbcnn: "fbcnn-color-blind",
  deblur: "nafnet-gopro-w32",
  // Every upscaler is ×4; a ×2 request brings it down by half (main/enhance.ts).
  clean: "span-x4-ch48",
  damaged: "realesr-general-x4v3",
  texture: "realesr-general-wdn-x4v3"
};
const SOURCE_LABEL = {
  clean: concepts.tk("clean"),
  damaged: concepts.tk("damaged"),
  texture: concepts.tk("keep texture")
};
function planSteps(s, isJpeg) {
  const steps = [];
  if (isJpeg && s.jpeg === "reconstruct")
    steps.push({ kind: "reconstruct", model: null, label: concepts.t("JPEG rebuild") });
  if (isJpeg && s.jpeg === "fbcnn")
    steps.push({ kind: "fbcnn", model: ENHANCE_MODEL.fbcnn, label: concepts.t("JPEG restore") });
  if (s.deblur) steps.push({ kind: "deblur", model: ENHANCE_MODEL.deblur, label: concepts.t("Deblur") });
  if (s.upscale !== "off") {
    const scale = s.upscale === "x2" ? 2 : 4;
    steps.push({
      kind: s.upscaleSource,
      model: ENHANCE_MODEL[s.upscaleSource],
      label: concepts.t("Super Resolution ×{{scale}} ({{source}})", {
        scale,
        source: concepts.t(SOURCE_LABEL[s.upscaleSource])
      }),
      scale
    });
  }
  return steps;
}
function scaleOf(s) {
  return s.upscale === "off" ? 1 : s.upscale === "x2" ? 2 : 4;
}
function enhanceRefusal(s, src) {
  if (src.isHdr) return concepts.t("Enhance needs an SDR photo; this one is HDR");
  if (planSteps(s, src.isJpeg).length === 0)
    return s.jpeg !== "off" && !src.isJpeg ? concepts.t("JPEG restore is for JPEG files; choose another step") : concepts.t("Choose at least one step");
  return null;
}
function reconstructParams(smoothing) {
  const t2 = Math.max(0, Math.min(100, smoothing));
  return {
    iterations: 40,
    second_order: 0.5,
    // Two decades each way: 50 000 (close to the plain float decode) to 5.
    fidelity: Math.round(500 * 10 ** ((50 - t2) / 25) * 100) / 100
  };
}
const FIRST_GUESS_MS_PER_MP$1 = {
  reconstruct: 1e3,
  fbcnn: 5e4,
  deblur: 17e3,
  // The upscalers run at the input's size whatever the scale: SPAN in about
  // half general-x4v3's time (engine 0.18's roster).
  clean: 6500,
  damaged: 13e3,
  texture: 13e3
};
function estimateMs(steps, w, h, rates) {
  const mp = w * h / 1e6;
  return steps.reduce((t2, p) => t2 + mp * (rates[p.kind] ?? FIRST_GUESS_MS_PER_MP$1[p.kind]), 0);
}
function learnRates(steps, rates, measuredMs, expectedMs) {
  if (!(expectedMs > 0) || !(measuredMs > 0)) return rates;
  const k = measuredMs / expectedMs;
  const next = { ...rates };
  for (const p of steps) {
    const r = rates[p.kind] ?? FIRST_GUESS_MS_PER_MP$1[p.kind];
    next[p.kind] = Math.round(r * (0.4 + 0.6 * k));
  }
  return next;
}
function chainSubject(steps) {
  return steps.map((p) => p.scale ? `×${p.scale}` : p.label).join(" + ");
}
function jpegRestoreRefusal(s, isJpeg, stepsBefore) {
  const restores = planSteps(s, isJpeg).some((p) => p.kind === "reconstruct" || p.kind === "fbcnn");
  return restores && stepsBefore > 0 ? concepts.t("JPEG restore reads the file itself, so it must come first: undo the other pixel steps, or leave it off") : null;
}
const TYPICAL_MP = 24;
const TILE_MP = 256 * 256 / 1e6;
function referenceOf(measured) {
  const tile = /(\d+(?:\.\d+)?)\s*ms per 256² tile/.exec(measured ?? "");
  const frame = /(\d+(?:\.\d+)?)\s*ms per frame/.exec(measured ?? "");
  return { tileMs: tile ? Number(tile[1]) : null, frameMs: frame ? Number(frame[1]) : null };
}
const unitMs = (r) => r.tileMs ?? r.frameMs;
function testFactor(testMs, reference) {
  const ref = unitMs(reference);
  return testMs !== null && testMs > 0 && ref ? testMs / ref : null;
}
function modelSpeed(opts) {
  const { reference: r, learnedMsPerMp, guessMsPerMp, factor } = opts;
  if (learnedMsPerMp && learnedMsPerMp > 0)
    return { msPerPhoto: learnedMsPerMp * TYPICAL_MP, basis: "runs" };
  const k = factor ?? 1;
  const basis = factor !== null ? "test" : "typical";
  if (r.frameMs !== null) return { msPerPhoto: r.frameMs * k, basis };
  if (r.tileMs !== null) return { msPerPhoto: r.tileMs / TILE_MP * TYPICAL_MP * k, basis };
  if (guessMsPerMp && guessMsPerMp > 0) return { msPerPhoto: guessMsPerMp * TYPICAL_MP * k, basis };
  return null;
}
const DENOISE_RATE_KEY = "ai.denoise.msPerMp";
const ENHANCE_RATE_KEY = "ai.enhance.rates.2";
const STATIC_TILE = {
  "nafnet-sidd-w32": { size: 512, overlap: 32 },
  "nafnet-gopro-w32": { size: 512, overlap: 32 },
  // A tile starts on the filter's period (the roster's `Fixed`): 2 × 2 Bayer, 6 × 6 X-Trans.
  "demosaicnet-bayer": { size: 512, overlap: 32 },
  "demosaicnet-xtrans": { size: 516, overlap: 36 },
  // A multiple of its 32 (the roster's Dynamic tiling): 0.56 s for a 24 MP mosaic, 3.3 s on the CPU.
  pmrid: { size: 512, overlap: 32 }
};
const TILE_DIMS = /* @__PURE__ */ new Set(["height", "width"]);
function staticPlan(id, dims, provider) {
  const tile = STATIC_TILE[id];
  if (!tile || typeof provider !== "object" || !("CoreMl" in provider)) return null;
  if (dims.length === 0 || dims.some((d) => !TILE_DIMS.has(d))) return null;
  return {
    // The GPU: the Neural Engine alone measured 3–5× slower on NAFNet.
    provider: {
      CoreMl: {
        ...provider.CoreMl,
        units: "CpuAndGpu",
        format: "MlProgram",
        static_shapes: true
      }
    },
    dimensions: dims.map((name) => ({ name, value: tile.size })),
    tiling: { Fixed: { width: tile.size, height: tile.size, overlap: tile.overlap } }
  };
}
const OFFERED_ON_DEMAND = ["birefnet-lite", "sam3", "efficientsam3-ev-m"];
function held(id) {
  return id === "nafnet-sidd-w32" && !recipe.NAFNET_DENOISE || id === "sam3" && true;
}
const BASE$1 = (process.env.PLAYROOM_MODELS_URL ?? "https://models.pixlfoundation.com").replace(
  /\/+$/,
  ""
);
const MODELS_BASE = BASE$1;
const IDLE_SESSION = {
  dimensions: [],
  intra_op_spinning: false
};
const PROVIDER_KEY = "ai.provider";
const MEASURED_KEY = "ai.providerTimes";
const DECLINED_KEY = "ai.declined";
const SPEED_CACHE_MS = 5e3;
function modelName(e) {
  return e.title.split(":")[0].trim();
}
class ModelMissing extends Error {
  constructor(entry) {
    super(concepts.t("{{model}} is not downloaded yet: Settings → AI models", { model: modelName(entry) }));
    this.entry = entry;
  }
  entry;
  code = "ModelNotInstalled";
}
class ModelStore {
  constructor(settings2, engineStatus) {
    this.settings = settings2;
    this.engineStatus = engineStatus;
  }
  settings;
  engineStatus;
  downloads = /* @__PURE__ */ new Map();
  failed = /* @__PURE__ */ new Map();
  installedCache = /* @__PURE__ */ new Map();
  /**
   * Every model the app can use: the roster's shipped ones, and the
   * on-demand ones Playroom offers (engine 0.18: downloads, never packages).
   */
  roster() {
    const offered = pixlModels__namespace.onDemand().filter((m) => OFFERED_ON_DEMAND.includes(m.id));
    return [
      ...pixlModels__namespace.manifest().filter((m) => m.ship && !held(m.id)),
      ...offered.filter((m) => !held(m.id))
    ];
  }
  /** An on-demand model: its licence texts and NOTICE are kept beside its files. */
  onDemand(id) {
    return pixlModels__namespace.onDemand().find((m) => m.id === id && OFFERED_ON_DEMAND.includes(m.id));
  }
  entry(id) {
    const e = this.roster().find((m) => m.id === id);
    if (!e) throw new Error(`no model "${id}"`);
    return e;
  }
  /** Where a model's files live on this machine. */
  dir(id) {
    const e = this.entry(id);
    return path.join(index$1.paths.models(), e.id, e.version);
  }
  /** Every file of the model is here at its roster size (checked once per run, then on changes). */
  async installed(id) {
    const cached = this.installedCache.get(id);
    if (cached !== void 0) return cached;
    const e = this.roster().find((m) => m.id === id);
    if (!e) return false;
    let ok = true;
    for (const f of e.files) {
      const s = await promises.stat(path.join(this.dir(id), f.name)).catch(() => null);
      if (!s || s.size !== f.bytes) ok = false;
    }
    if (!ok && await carryOver(index$1.paths.models(), e).catch(() => false)) {
      ok = true;
      log.info("model carried over from an earlier version", id, e.version);
    }
    this.installedCache.set(id, ok);
    return ok;
  }
  async list() {
    const speeds = await this.speeds();
    return Promise.all(
      this.roster().map(async (e) => {
        const d = this.downloads.get(e.id);
        return {
          speed: speeds.get(e.id) ?? null,
          id: e.id,
          title: e.title,
          role: e.role,
          bytes: e.files.reduce((s, f) => s + f.bytes, 0),
          licence: e.licence.spdx,
          holder: e.licence.holder,
          caveat: e.caveat,
          installed: await this.installed(e.id),
          progress: d ? d.done / Math.max(1, d.total) : null,
          error: this.failed.get(e.id)
        };
      })
    );
  }
  speedCache = null;
  /**
   * How long each model takes here, for one photo: from earlier runs, else
   * its reference time scaled by the speed test, else the reference alone.
   * Read again at most every few seconds (a download's progress lists the
   * models many times a second).
   */
  async speeds() {
    if (this.speedCache && Date.now() - this.speedCache.at < SPEED_CACHE_MS)
      return this.speedCache.speeds;
    const read2 = async (key) => {
      const v = await this.settings.getSetting(key).catch(() => null);
      return v && typeof v === "object" ? v : {};
    };
    const [denoise2, enhance, info2] = await Promise.all([
      read2(DENOISE_RATE_KEY),
      read2(ENHANCE_RATE_KEY),
      this.providerInfo()
    ]);
    const m = info2.measured;
    const tested = m?.model ? this.roster().find((e) => e.id === m.model) : void 0;
    const testMs = m ? info2.choice === "cpu" ? m.cpuMs : m.acceleratedMs ?? m.cpuMs : null;
    const factor = tested ? testFactor(testMs, referenceOf(tested.measured)) : null;
    const kindOf = new Map(
      Object.entries(ENHANCE_MODEL).map(([k, id]) => [id, k])
    );
    const speeds = /* @__PURE__ */ new Map();
    for (const e of this.roster()) {
      const kind = kindOf.get(e.id);
      speeds.set(
        e.id,
        modelSpeed({
          reference: referenceOf(e.measured),
          learnedMsPerMp: denoise2[e.id] ?? (kind ? enhance[kind] : null),
          guessMsPerMp: kind ? FIRST_GUESS_MS_PER_MP$1[kind] : null,
          factor
        })
      );
    }
    this.speedCache = { at: Date.now(), speeds };
    return speeds;
  }
  emit() {
    void this.list().then((models2) => {
      for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(index$1.IPC.models.event, models2);
    });
  }
  /**
   * Retired models, and versions a model has moved on from, off the user's
   * disk (engine 0.18 retired Real-ESRGAN ×2 and LaMa; U²-Net and FBCNN at a
   * quality went with 0.17): quietly, once the app is up. A shipped model's
   * older version is carried over first (`installed`) when its files are the
   * same, so nothing is downloaded again. On-demand models are kept.
   * Returns what went, as `id` or `id/version`.
   */
  async prune(root = index$1.paths.models()) {
    const roster = this.roster();
    for (const e of roster) await this.installed(e.id).catch(() => false);
    const gone = await retiredModelDirs(
      root,
      new Map(roster.map((e) => [e.id, e.version])),
      keptBesides(
        pixlModels__namespace.onDemand().map((e) => e.id),
        pixlModels__namespace.manifest().filter((m) => m.ship && held(m.id)).map((m) => m.id)
      )
    );
    for (const p of gone) await promises.rm(path.join(root, p), { recursive: true, force: true });
    if (gone.length > 0) {
      this.installedCache.clear();
      log.info("models retired from disk", ...gone);
      this.emit();
    }
    return gone;
  }
  /** Download a model's files, resuming what an earlier try left, and check each. */
  async download(id) {
    if (!this.roster().some((m) => m.id === id)) return;
    if (this.downloads.has(id) || await this.installed(id)) return;
    void this.decline(id, false).catch(() => void 0);
    const e = this.entry(id);
    const dir = this.dir(id);
    await promises.mkdir(dir, { recursive: true });
    const abort = new AbortController();
    const state2 = { abort, done: 0, total: e.files.reduce((s, f) => s + f.bytes, 0) };
    this.downloads.set(id, state2);
    this.failed.delete(id);
    this.emit();
    let last2 = 0;
    const tick = () => {
      const now = Date.now();
      if (now - last2 > 200) {
        last2 = now;
        this.emit();
      }
    };
    try {
      for (const f of e.files) {
        const dest = path.join(dir, f.name);
        const have = await promises.stat(dest).catch(() => null);
        if (have?.size === f.bytes && await sha256$1(dest) === f.sha256) {
          state2.done += f.bytes;
          continue;
        }
        const before2 = state2.done;
        const onBytes = (n) => {
          state2.done += n;
          tick();
        };
        const hosted = f.hosted;
        const mirror = hosted ?? `${BASE$1}/${e.id}/${e.version}/${f.name}`;
        try {
          await this.fetchFile(mirror, dest, f, abort.signal, onBytes);
        } catch (err) {
          if (abort.signal.aborted) throw err;
          const upstream = f.url;
          if (!upstream) throw new Error(explain(err, mirror, f.name, true));
          log.info("model mirror unavailable, using upstream", f.name, explain(err, mirror, f.name));
          state2.done = before2;
          try {
            await this.fetchFile(upstream, dest, f, abort.signal, onBytes);
          } catch (err2) {
            if (abort.signal.aborted) throw err2;
            throw new Error(explain(err2, upstream, f.name));
          }
        }
      }
      const od = this.onDemand(id);
      if (od) {
        for (const text of od.licence_texts)
          await promises.writeFile(path.join(dir, text.name), await promises.readFile(text.path, "utf8"));
        await promises.writeFile(path.join(dir, "NOTICE.md"), od.notice);
      }
      this.installedCache.set(id, true);
      log.info("model installed", id);
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err.message;
        this.failed.set(id, message);
        log.warn("model download failed", id, message);
      }
    } finally {
      this.downloads.delete(id);
      this.emit();
    }
  }
  cancel(id) {
    this.downloads.get(id)?.abort.abort();
  }
  /**
   * Models fetched without being asked (DemosaicNet for RAWs, once the app
   * is up after an install or update): each unless it is here, or the user
   * removed it (then it waits to be downloaded by hand).
   */
  async autoFetch(ids) {
    const declined = await this.declined();
    for (const id of ids)
      if (!declined.includes(id) && this.roster().some((m) => m.id === id)) await this.download(id);
  }
  async declined() {
    const v = await this.settings.getSetting(DECLINED_KEY).catch(() => null);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  }
  async decline(id, on) {
    const was = await this.declined();
    if (was.includes(id) === on) return;
    await this.settings.setSetting(DECLINED_KEY, on ? [...was, id] : was.filter((x) => x !== id));
  }
  async remove(id) {
    void this.decline(id, true).catch(() => void 0);
    this.cancel(id);
    await promises.rm(path.join(index$1.paths.models(), id), { recursive: true, force: true });
    this.installedCache.set(id, false);
    this.failed.delete(id);
    this.emit();
  }
  /**
   * One file: into `<dest>.part` (appending to what an earlier try left),
   * then checked against the roster and moved into place.
   */
  /** Shared with the brain store (ai/brain.ts): its pinned files come the same way. */
  async fetchFile(url$1, dest, f, signal, onBytes) {
    const part2 = `${dest}.part`;
    let from = (await promises.stat(part2).catch(() => null))?.size ?? 0;
    if (from > f.bytes) {
      await promises.rm(part2, { force: true });
      from = 0;
    }
    onBytes(from);
    const counter = new stream.Transform({
      transform(chunk, _enc, done) {
        onBytes(chunk.length);
        done(null, chunk);
      }
    });
    if (from === f.bytes) ;
    else if (url$1.startsWith("file:")) {
      await promises$1.pipeline(
        fs.createReadStream(url.fileURLToPath(url$1), { start: from }),
        counter,
        fs.createWriteStream(part2, { flags: from ? "a" : "w" }),
        { signal }
      );
    } else {
      const res = await fetch(url$1, {
        headers: from ? { Range: `bytes=${from}-` } : {},
        signal
      });
      if (res.status === 416 && from > 0) {
        await res.body?.cancel();
        await promises.rm(part2, { force: true });
        onBytes(-from);
        return this.fetchFile(url$1, dest, f, signal, onBytes);
      }
      if (!res.ok || !res.body) throw new Error(`${f.name}: HTTP ${res.status}`);
      const append = from > 0 && res.status === 206;
      if (from > 0 && !append) onBytes(-from);
      await promises$1.pipeline(
        stream.Readable.fromWeb(res.body),
        counter,
        fs.createWriteStream(part2, { flags: append ? "a" : "w" }),
        { signal }
      );
    }
    const got = await sha256$1(part2);
    if (got !== f.sha256) {
      await promises.rm(part2, { force: true });
      throw new Error(concepts.t("{{file}} arrived damaged (checksum mismatch); try again", { file: f.name }));
    }
    await promises.rename(part2, dest);
  }
  // ── Running a model ────────────────────────────────────────────────────────
  /** The accelerator the bundled runtime offers, if any. */
  accelerated() {
    const providers = this.engineStatus().runtime?.providers ?? [];
    if (providers.includes("coreml"))
      return {
        CoreMl: {
          units: "All",
          format: "MlProgram",
          static_shapes: false,
          low_precision_gpu: false
        }
      };
    if (providers.includes("directml")) return { DirectMl: { device: 0 } };
    return null;
  }
  /** The provider models run on: the accelerator, unless the performance test chose the CPU. */
  async provider() {
    const choice = await this.settings.getSetting(PROVIDER_KEY).catch(() => null);
    return choice === "cpu" ? "Cpu" : this.accelerated() ?? "Cpu";
  }
  async setProvider(choice) {
    await this.settings.setSetting(PROVIDER_KEY, choice);
  }
  /** The provider choice, the accelerator on offer and the last test's numbers. */
  async providerInfo() {
    const choice = await this.settings.getSetting(PROVIDER_KEY).catch(() => null);
    const measured = await this.settings.getSetting(MEASURED_KEY).catch(() => null);
    const providers = this.engineStatus().runtime?.providers ?? [];
    return {
      choice: choice === "cpu" ? "cpu" : "accelerated",
      accelerator: providers.find((p) => p !== "cpu") ?? null,
      ...measured && typeof measured === "object" ? { measured } : {}
    };
  }
  /**
   * Time the smallest downloaded model on the CPU and on the accelerator
   * (the engine's `benchmark`), and keep the faster: an accelerator that
   * will not load the model, or is slower, gives way to the CPU.
   */
  async benchmark(engine2) {
    const order = ["u2netp", "span-x4-ch48", "realesr-general-x4v3"];
    let id = null;
    for (const m of order) if (await this.installed(m)) id = id ?? m;
    if (!id) throw new Error(concepts.t("Download a model first: U²-Netp is the smallest"));
    if (engine2.getStatus().status === "starting") {
      engine2.start();
      await engine2.whenStarted();
    }
    const base = await this.ref(id, "Cpu");
    const size = this.entry(id).kind === "segmenter" ? 320 : 256;
    const feed = { Image: { input: base.input, width: size, height: size, conditioning: [] } };
    const accel = this.accelerated();
    const cases = [{ name: "cpu", model: base.model, feed }];
    if (accel) cases.push({ name: "accelerated", model: { ...base.model, provider: accel }, feed });
    const r = await engine2.benchmark({
      cases,
      repeats: 3,
      budgets: { max_load_ms: 12e4, max_run_ms: 12e4, max_memory_mb: 16384 }
    });
    const ms = (name) => {
      const c = r.cases.find((x) => x.name === name);
      return c && !c.error && typeof c.median_run_ms === "number" ? c.median_run_ms : null;
    };
    const measured = { cpuMs: ms("cpu"), acceleratedMs: ms("accelerated"), model: id };
    this.speedCache = null;
    const choice = measured.acceleratedMs !== null && (measured.cpuMs === null || measured.acceleratedMs <= measured.cpuMs) ? "accelerated" : "cpu";
    await this.setProvider(choice);
    await this.settings.setSetting(MEASURED_KEY, measured);
    log.info("model providers timed", id, measured, choice);
    return this.providerInfo();
  }
  /** What `ref()` needs from the host besides the model's own numbers. */
  async host(provider, extra = {}, dimensions = []) {
    const runtime = this.engineStatus().runtime;
    if (!runtime) throw new Error(concepts.t("this build of the engine ships no ONNX Runtime"));
    const session2 = {
      threads: source$1.heavyThreads(),
      optimisation: "All",
      deterministic: false,
      ...IDLE_SESSION,
      dimensions
    };
    return {
      runtime_library: runtime.library,
      provider: provider ?? await this.provider(),
      session: session2,
      ...extra
    };
  }
  /**
   * A model's engine request type, its files and the host's values filled
   * in. On CoreML, a model Playroom runs with static shapes (modelshape.ts)
   * gets its H × W fixed to its tile and the GPU; elsewhere it runs as it is.
   */
  async ref(id, provider, extra = {}) {
    const e = this.entry(id);
    if (!await this.installed(id)) throw new ModelMissing(e);
    const chosen = provider ?? await this.provider();
    const plan = staticPlan(id, e.files[0]?.dimensions ?? [], chosen);
    const host = await this.host(plan?.provider ?? chosen, extra, plan?.dimensions);
    const ref = pixlModels__namespace.ref(id, host, { dir: this.dir(id) });
    return plan ? { ...ref, tiling: plan.tiling } : ref;
  }
  /** Models the accelerator would not load this session: they run on the CPU. */
  cpuOnly = /* @__PURE__ */ new Set();
  /**
   * Run `make` with each of `ids` on the chosen provider, moving a model to
   * the CPU when the accelerator cannot load it (FBCNN under CoreML: ONNX
   * Runtime refuses it; a static-shaped model CoreML refuses) — the one the error names, or all of
   * them when it names none (a provider that cannot be registered). Never
   * silently: each move is logged, and the model stays on the CPU for the
   * session. `make` is told which models to put on the CPU.
   */
  async withCpuFallback(ids, make, signal) {
    const onCpu = new Set(
      await this.provider() === "Cpu" ? ids : ids.filter((id) => this.cpuOnly.has(id))
    );
    for (; ; ) {
      try {
        return await make(onCpu);
      } catch (err) {
        const message = String(err?.message);
        if (signal.aborted || !/load-model|provider/i.test(message)) throw err;
        const left = ids.filter((id) => !onCpu.has(id));
        if (left.length === 0) throw err;
        const named2 = left.filter((id) => message.includes(`${id}/`));
        const moved = named2.length > 0 ? named2 : left;
        log.warn("models would not run on the accelerator; using the CPU", moved, message);
        for (const id of moved) {
          onCpu.add(id);
          this.cpuOnly.add(id);
        }
      }
    }
  }
  /** The licence texts shipped with the roster (for the notices). */
  licencesDir() {
    return path.join(pixlModels__namespace.dir, "licences");
  }
}
function explain(err, url2, file, only = false) {
  const e = err;
  const host = (() => {
    try {
      return new URL(url2).host || concepts.t("the model folder");
    } catch {
      return url2;
    }
  })();
  const code = e.cause?.code ?? e.code;
  let why;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") why = concepts.t("{{host}} could not be found", { host });
  else if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT")
    why = concepts.t("{{host}} did not answer", { host });
  else if (code === "ENOENT") why = concepts.t("{{file}} is not in {{folder}}", { file, folder: url2.replace(/[^/]*$/, "") });
  else if (/HTTP 40[34]/.test(e.message)) why = concepts.t("{{host}} does not have {{file}} yet", { host, file });
  else why = e.message;
  return only ? concepts.t("{{reason}} — this model is only on Playroom's model server", { reason: why }) : why;
}
async function sha256$1(file) {
  const h = crypto.createHash("sha256");
  await promises$1.pipeline(fs.createReadStream(file), h);
  return h.digest("hex");
}
const SAM_GRID = 1024;
const GUIDED_MIN_GRID = 128;
function guidedKeeps(size, frameLong) {
  if (!size) return false;
  const grid = SAM_GRID / frameLong;
  return size.width * grid >= GUIDED_MIN_GRID && size.height * grid >= GUIDED_MIN_GRID;
}
const TRACE_REGION = process.env.PLAYROOM_TRACE_REGION === "1";
function slim(_k, v) {
  if (v && typeof v === "object" && ArrayBuffer.isView(v)) return `<${v.byteLength} bytes>`;
  return v;
}
function traceRegion(event) {
  if (!TRACE_REGION) return;
  const line = JSON.stringify({ at: (/* @__PURE__ */ new Date()).toISOString(), ...event }, slim);
  void import("electron").then(({ app }) => promises.appendFile(path.join(app.getPath("userData"), "region-trace.jsonl"), `${line}
`)).catch(() => void 0);
}
const DEMOSAIC_MODEL = {
  Bayer: "demosaicnet-bayer",
  XTrans: "demosaicnet-xtrans"
};
const RAW_DENOISER = "pmrid";
const PLAIN_DEVELOP = { pmrid: false };
function askOf(recipe2) {
  return { pmrid: recipe2.detail.rawDenoise === true };
}
let models = null;
function setRawModels(m) {
  models = m;
}
function demosaicFor(cfa, model) {
  if (!cfa) return "classic";
  if (model) return "model";
  return cfa === "Bayer" ? "ahd" : "classic";
}
function developTag(kind, pmrid) {
  return `${kind === "model" ? "dn" : kind === "ahd" ? "ahd" : "ppg"}${pmrid ? "-pm" : ""}`;
}
async function scenePlan(cfa, ask = PLAIN_DEVELOP) {
  const m = models;
  const runs = !!m && await m.canRun().catch(() => false);
  const id = cfa ? DEMOSAIC_MODEL[cfa] : null;
  const model = runs && id !== null && await m.installed(id);
  if (runs && cfa === "XTrans" && !model) m.fetch(id);
  const pmrid = runs && ask.pmrid && cfa === "Bayer" && await m.installed(RAW_DENOISER);
  const demosaic = demosaicFor(cfa, model);
  return { cfa: cfa ?? null, demosaic, pmrid, tag: developTag(demosaic, pmrid) };
}
async function fill(plan, onCpu) {
  const ref = (id) => models.ref(id, onCpu.has(id) ? "Cpu" : void 0);
  const demosaic = plan.demosaic === "model" ? { Model: await ref(DEMOSAIC_MODEL[plan.cfa]) } : plan.demosaic === "ahd" ? "Ahd" : "Classic";
  const mosaic_denoise = plan.pmrid ? { model: await ref(RAW_DENOISER), noise: "Measured" } : null;
  traceRegion({
    step: "scene",
    tag: plan.tag,
    demosaic: plan.demosaic === "model" ? DEMOSAIC_MODEL[plan.cfa] : plan.demosaic,
    pmrid: plan.pmrid,
    // The store's default is the accelerator (CoreML on a Mac); a model it refused runs on the CPU.
    provider: Object.fromEntries(
      [
        ...plan.demosaic === "model" ? [DEMOSAIC_MODEL[plan.cfa]] : [],
        ...plan.pmrid ? [RAW_DENOISER] : []
      ].map((id) => [id, onCpu.has(id) ? "Cpu" : "default"])
    )
  });
  return { demosaic, mosaic_denoise };
}
const NEVER = new AbortController().signal;
const MODEL_TROUBLE = /raw\.(demosaic|mosaic_denoise)|model|onnx|session|provider|coreml/i;
async function withScene(plan, run2, signal = NEVER) {
  const ids = [
    ...plan.demosaic === "model" ? [DEMOSAIC_MODEL[plan.cfa]] : [],
    ...plan.pmrid ? [RAW_DENOISER] : []
  ];
  const plain = { demosaic: "Classic", mosaic_denoise: null };
  if (plan.demosaic === "classic" && ids.length === 0)
    return { value: await run2(plain), classic: false };
  try {
    const value = ids.length === 0 ? await run2(await fill(plan, /* @__PURE__ */ new Set())) : await models.withCpuFallback(ids, async (onCpu) => run2(await fill(plan, onCpu)), signal);
    return { value, classic: false };
  } catch (err) {
    if (signal.aborted || !MODEL_TROUBLE.test(String(err?.message))) throw err;
    log.warn("RAW develop with", plan.tag, "refused; developing classic", err.message);
    traceRegion({ step: "refused", tag: plan.tag, message: err.message });
    return { value: await run2(plain), classic: true };
  }
}
function exists(path2) {
  return promises.access(path2).then(
    () => true,
    () => false
  );
}
async function sameFile(a, b) {
  if (a === b) return true;
  try {
    const [x, y] = await Promise.all([promises.stat(a, { bigint: true }), promises.stat(b, { bigint: true })]);
    return x.ino !== 0n && x.dev === y.dev && x.ino === y.ino;
  } catch {
    return false;
  }
}
const PROXY_EDGE = 2560;
const MID_EDGE = 1920;
const DRAFT_EDGE = 1280;
function depthOf(from) {
  return from.float ? "F32" : "Sixteen";
}
const building$1 = /* @__PURE__ */ new Map();
const stamp$1 = source$1.versionStamp;
function ensureProxies(engine2, photo, info2, threads = source$1.interactiveThreads()) {
  const key = `${photo.id}:${stamp$1(photo)}`;
  let p = building$1.get(key);
  if (!p) {
    p = build$1(engine2, photo, info2, threads).finally(() => building$1.delete(key));
    building$1.set(key, p);
  }
  return p;
}
const thumbing = /* @__PURE__ */ new Map();
async function ensureThumbSource(engine2, photo, info2, threads) {
  const s = stamp$1(photo);
  const dir = index$1.paths.photoCachePath(photo.id);
  if (info2.input !== "Raw" || info2.is_hdr || await exists(path.join(dir, `proxies-${s}.json`)))
    return ensureProxies(engine2, photo, info2, threads);
  const cell = source$1.cellFactor(photo);
  const long = Math.max(info2.width, info2.height);
  const factor = source$1.binFactor(long, cell, DRAFT_EDGE);
  if (factor <= cell) return ensureProxies(engine2, photo, info2, threads);
  const key = `${photo.id}:${s}`;
  let p = thumbing.get(key);
  if (!p) {
    p = (async () => {
      const path$1 = path.join(dir, `thumbsrc-${s}.tiff`);
      const meta = `${path$1}.json`;
      if (await exists(path$1) && await exists(meta))
        return JSON.parse(await promises.readFile(meta, "utf8"));
      await promises.mkdir(dir, { recursive: true });
      const raw2 = source$1.rawBinnedMaster(source$1.colourOf(photo), factor);
      const orientation = source$1.sourceOrientation(info2, raw2);
      const report = await engine2.convert({
        ...source$1.blankRequest(photo.path, path$1, info2.input, info2),
        raw: raw2,
        pixel: { depth: "F32", channels: 3 },
        encode: { Tiff: { compression: "None" } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: "Preserve",
        framing: orientation === "Normal" ? null : { orientation, rotate_degrees: 0, rotate_resampler: "Lanczos3", crop: null },
        threads
      });
      const file = {
        path: path$1,
        input: "Tiff",
        width: report.width,
        height: report.height,
        float: true
      };
      const out = {
        proxy: file,
        draft: file,
        // The bins' frame times their width: the full develop's, to a pixel or two.
        frameWidth: report.frame_width * factor,
        frameHeight: report.frame_height * factor
      };
      await promises.writeFile(meta, JSON.stringify(out));
      return out;
    })().finally(() => thumbing.delete(key));
    thumbing.set(key, p);
  }
  return p;
}
async function build$1(engine2, photo, info2, threads) {
  const dir = index$1.paths.photoCache(photo.id);
  const s = stamp$1(photo);
  const meta = path.join(dir, `proxies-${s}.json`);
  if (await exists(meta)) {
    const known = JSON.parse(await promises.readFile(meta, "utf8"));
    if (await exists(known.proxy.path) && await exists(known.draft.path) && Number.isFinite(known.frameWidth) && Number.isFinite(known.frameHeight)) {
      if (known.mid || Math.max(known.proxy.width, known.proxy.height) <= MID_EDGE) return known;
      const mid2 = await shrink(engine2, known.proxy, path.join(dir, `mid-${s}`), MID_EDGE, threads);
      const out2 = { ...known, mid: mid2 };
      await promises.writeFile(meta, JSON.stringify(out2));
      return out2;
    }
  }
  for (const f of await promises.readdir(dir)) {
    if (f.startsWith("proxies-") || f.startsWith("proxy-") || f.startsWith("draft-") || f.startsWith("mid-") || f.startsWith("master-") || f.startsWith("thumbsrc-") || f.startsWith("lens-")) {
      try {
        await promises.unlink(path.join(dir, f));
      } catch {
      }
    }
  }
  const hdr = info2.is_hdr;
  const ext = hdr ? "png" : "tiff";
  const input = hdr ? "Png" : "Tiff";
  const encode = hdr ? { Png: { compression: "Fast", filter: "Sub" } } : { Tiff: { compression: "None" } };
  const colour = source$1.colourOf(photo);
  const raw2 = info2.input === "Raw" ? source$1.rawMaster(colour) : null;
  const float = raw2 !== null;
  const orientation = source$1.sourceOrientation(info2, raw2);
  const proxyPath = path.join(dir, `proxy-${s}.${ext}`);
  const long = Math.max(info2.width, info2.height);
  const develop2 = (mode, across) => {
    const factor = Math.min(1, PROXY_EDGE / across);
    return engine2.convert({
      ...source$1.blankRequest(photo.path, proxyPath, info2.input, info2),
      raw: mode,
      resize: factor < 1 ? { Scale: { factor } } : "None",
      resampler: "Lanczos3",
      // Averaging in linear light keeps a downscale's tones honest; an HDR
      // signal is resized as it is (its float path would need HDR numbers).
      linear_resample: !hdr && factor < 1,
      pixel: { depth: float ? "F32" : "Sixteen", channels: 3 },
      encode,
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: "Preserve",
      framing: orientation === "Normal" ? null : { orientation, rotate_degrees: 0, rotate_resampler: "Lanczos3", crop: null },
      threads
    });
  };
  const cell = raw2 ? source$1.cellFactor(photo) : 1;
  let byCell = raw2 !== null && source$1.proxyByCell(long, cell, PROXY_EDGE);
  let report = byCell ? await develop2(source$1.rawProxyMaster(colour), long / cell).catch(() => null) : await develop2(raw2, long);
  if (byCell && (!report || Math.round(long / Math.max(report.frame_width, report.frame_height)) !== cell)) {
    byCell = false;
    report = await develop2(raw2, long);
  }
  if (!report) throw new Error("the proxy was not made");
  const proxy = {
    path: proxyPath,
    input,
    width: report.width,
    height: report.height,
    ...float ? { float } : {}
  };
  const scaleUp = byCell ? cell : 1;
  const draftPath = path.join(dir, `draft-${s}.${ext}`);
  const dFactor = Math.min(1, DRAFT_EDGE / Math.max(proxy.width, proxy.height));
  const draftReport = await engine2.convert({
    ...source$1.blankRequest(proxyPath, draftPath, input),
    resize: dFactor < 1 ? { Scale: { factor: dFactor } } : "None",
    pixel: { depth: depthOf(proxy), channels: null },
    encode,
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: "Preserve",
    threads
  });
  const draft = {
    path: draftPath,
    input,
    width: draftReport.width,
    height: draftReport.height,
    ...float ? { float } : {}
  };
  const mid = Math.max(proxy.width, proxy.height) > MID_EDGE ? await shrink(engine2, proxy, path.join(dir, `mid-${s}`), MID_EDGE, threads) : void 0;
  const out = {
    proxy,
    ...mid ? { mid } : {},
    draft,
    // The develop's frame (its cells' times their width when it was a half
    // size one): what masks and every normalised size are fractions of.
    frameWidth: report.frame_width * scaleUp,
    frameHeight: report.frame_height * scaleUp
  };
  await promises.writeFile(meta, JSON.stringify(out));
  return out;
}
async function shrink(engine2, from, stem, edge, threads, factor = Math.min(1, edge / Math.max(from.width, from.height))) {
  const png2 = from.input === "Png";
  const path2 = `${stem}.${png2 ? "png" : "tiff"}`;
  const report = await engine2.convert({
    ...source$1.blankRequest(from.path, path2, from.input),
    resize: factor < 1 ? { Scale: { factor } } : "None",
    pixel: { depth: depthOf(from), channels: null },
    encode: png2 ? { Png: { compression: "Fast", filter: "Sub" } } : { Tiff: { compression: "None" } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: "Preserve",
    threads
  });
  return {
    path: path2,
    input: from.input,
    width: report.width,
    height: report.height,
    ...from.float ? { float: true } : {}
  };
}
const lensing = /* @__PURE__ */ new Map();
function ensureLensedProxies(engine2, photo, px2, lens, retouch, key, hdr) {
  const id = `${photo.id}:${stamp$1(photo)}:${key}`;
  let p = lensing.get(id);
  if (!p) {
    p = bakeLens(engine2, photo, px2, lens, retouch, key, hdr).finally(() => lensing.delete(id));
    lensing.set(id, p);
  }
  return p;
}
async function bakeLens(engine2, photo, px2, lens, retouch, key, hdr) {
  const dir = index$1.paths.photoCache(photo.id);
  const prefix = `lens-${stamp$1(photo)}-${key}`;
  const meta = path.join(dir, `${prefix}.json`);
  if (await exists(meta)) {
    const known = JSON.parse(await promises.readFile(meta, "utf8"));
    if (await exists(known.proxy.path) && await exists(known.draft.path)) return known;
  }
  const ext = px2.proxy.input === "Png" ? "png" : "tiff";
  const encode = px2.proxy.input === "Png" ? { Png: { compression: "Fast", filter: "Sub" } } : { Tiff: { compression: "None" } };
  const proxyPath = path.join(dir, `${prefix}-proxy.${ext}`);
  const report = await engine2.convert({
    ...source$1.blankRequest(px2.proxy.path, proxyPath, px2.proxy.input),
    pixel: { depth: depthOf(px2.proxy), channels: 3 },
    encode,
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: "Preserve",
    lens,
    // Placed on the base frame, which is what the proxy is.
    retouch,
    // A PQ/HLG proxy is corrected in the HDR working space it is graded in.
    hdr,
    // Baked behind the editing: its share of the cores, not all of them.
    threads: source$1.BACKGROUND_THREADS
  });
  const proxy = {
    path: proxyPath,
    input: px2.proxy.input,
    width: report.width,
    height: report.height,
    ...px2.proxy.float ? { float: true } : {}
  };
  const draftPath = path.join(dir, `${prefix}-draft.${ext}`);
  const dFactor = Math.min(1, px2.draft.width / px2.proxy.width);
  const draftReport = await engine2.convert({
    ...source$1.blankRequest(proxyPath, draftPath, px2.proxy.input),
    resize: dFactor < 1 ? { Scale: { factor: dFactor } } : "None",
    pixel: { depth: depthOf(proxy), channels: null },
    encode,
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: "Preserve",
    threads: source$1.BACKGROUND_THREADS
  });
  const k = report.width / px2.proxy.width;
  const mid = px2.mid ? await shrink(
    engine2,
    proxy,
    path.join(dir, `${prefix}-mid`),
    MID_EDGE,
    source$1.BACKGROUND_THREADS,
    px2.mid.width / px2.proxy.width
  ) : void 0;
  const out = {
    proxy,
    ...mid ? { mid } : {},
    draft: {
      path: draftPath,
      input: px2.proxy.input,
      width: draftReport.width,
      height: draftReport.height
    },
    frameWidth: Math.round(px2.frameWidth * k),
    frameHeight: Math.round(px2.frameHeight * k)
  };
  await promises.writeFile(meta, JSON.stringify(out));
  return out;
}
async function pruneLensed(photo, itemKey, keepKey, alsoKeep) {
  const dir = index$1.paths.photoCache(photo.id);
  const file = path.join(dir, "keep-lensed.json");
  let kept = {};
  try {
    const parsed = JSON.parse(await promises.readFile(file, "utf8"));
    if (parsed && typeof parsed === "object") kept = parsed;
  } catch {
  }
  if (keepKey) kept[itemKey] = keepKey;
  else delete kept[itemKey];
  await promises.writeFile(file, JSON.stringify(kept)).catch(() => void 0);
  const keep = [...Object.values(kept), ...alsoKeep ? [alsoKeep] : []].map(
    (k) => `lens-${stamp$1(photo)}-${k}`
  );
  for (const f of await promises.readdir(dir).catch(() => [])) {
    const isKept = (k) => f.startsWith(`${k}.`) || f.startsWith(`${k}-`);
    if (f.startsWith("lens-") && !keep.some(isKept)) await promises.unlink(path.join(dir, f)).catch(() => {
    });
  }
}
const mastering = /* @__PURE__ */ new Map();
async function masterCached(photo, info2, ask = PLAIN_DEVELOP) {
  const plan = await scenePlan(info2.raw_cfa, ask);
  const path$1 = path.join(index$1.paths.photoCachePath(photo.id), `master-${stamp$1(photo)}-${plan.tag}.tiff`);
  return await exists(path$1) && await exists(`${path$1}.json`);
}
function ensureQuickMaster(engine2, photo) {
  const s = stamp$1(photo);
  const key = `${photo.id}:${s}:quick`;
  let p = mastering.get(key);
  if (!p) {
    p = (async () => {
      const dir = index$1.paths.photoCache(photo.id);
      const path$1 = path.join(dir, `master-${s}-ppg.tiff`);
      const meta = `${path$1}.json`;
      if (await exists(path$1) && await exists(meta))
        return JSON.parse(await promises.readFile(meta, "utf8"));
      const t0 = Date.now();
      const report = await engine2.convert({
        ...source$1.blankRequest(photo.path, path$1, "Raw"),
        raw: source$1.rawMaster(source$1.colourOf(photo), { demosaic: "Classic", mosaic_denoise: null }),
        pixel: { depth: "F32", channels: 3 },
        encode: { Tiff: { compression: "None" } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: "Preserve"
      });
      traceRegion({
        step: "quick master",
        photoId: photo.id,
        ms: Date.now() - t0,
        width: report.width,
        height: report.height
      });
      const out = {
        path: path$1,
        input: "Tiff",
        width: report.width,
        height: report.height,
        float: true
      };
      await promises.writeFile(meta, JSON.stringify(out));
      return out;
    })().finally(() => mastering.delete(key));
    mastering.set(key, p);
  }
  return p;
}
async function ensureMaster(engine2, photo, info2, ask = PLAIN_DEVELOP) {
  const plan = await scenePlan(info2.raw_cfa, ask);
  const s = stamp$1(photo);
  const key = `${photo.id}:${s}:${plan.tag}`;
  let p = mastering.get(key);
  if (!p) {
    p = (async () => {
      const dir = index$1.paths.photoCache(photo.id);
      const name = `master-${s}-${plan.tag}`;
      const path$1 = path.join(dir, `${name}.tiff`);
      const meta = `${path$1}.json`;
      if (await exists(path$1) && await exists(meta)) {
        const kept = JSON.parse(await promises.readFile(meta, "utf8"));
        traceRegion({
          step: "master",
          photoId: photo.id,
          tag: plan.tag,
          cached: true,
          path: path$1,
          width: kept.width,
          height: kept.height
        });
        return kept;
      }
      const t0 = Date.now();
      let request = null;
      const { value: report, classic } = await withScene(plan, (scene) => {
        const req = {
          ...source$1.blankRequest(photo.path, path$1, "Raw"),
          raw: source$1.rawMaster(source$1.colourOf(photo), scene),
          pixel: { depth: "F32", channels: 3 },
          encode: { Tiff: { compression: "None" } },
          metadata: { exif: false, icc: true, xmp: false, iptc: false },
          color: "Preserve"
        };
        request = req;
        return engine2.convert(req);
      });
      log.info("RAW master developed", plan.tag, classic ? "(classic)" : "", Date.now() - t0, "ms");
      traceRegion({
        step: "master",
        photoId: photo.id,
        tag: plan.tag,
        cached: false,
        classic,
        // Not kept when classic stood in: the next 1:1 develops it again.
        keptForNextTime: !classic,
        ms: Date.now() - t0,
        request,
        report: {
          width: report.width,
          height: report.height,
          input_bytes: report.input_bytes,
          output_bytes: report.output_bytes,
          decode_ms: report.decode_ms,
          color_ms: report.color_ms,
          encode_ms: report.encode_ms,
          raw: report.raw
        }
      });
      const out = {
        path: path$1,
        input: "Tiff",
        width: report.width,
        height: report.height,
        float: true
      };
      if (!classic) await promises.writeFile(meta, JSON.stringify(out));
      const same = `master-${s}-${plan.tag.replace(/-pm$/, "")}`;
      for (const f of await promises.readdir(dir).catch(() => []))
        if (f.startsWith("master-") && !f.startsWith(`${same}.`) && !f.startsWith(`${same}-pm.`))
          await promises.unlink(path.join(dir, f)).catch(() => void 0);
      return out;
    })().finally(() => mastering.delete(key));
    mastering.set(key, p);
  }
  return p;
}
const SAM_MODEL = "sam2-1-hiera-tiny";
const ENCODER = "sam-encoder";
const DECODER = "sam-decoder";
const FRAME_SIZE = Infinity;
const PREVIEW_MAX = 1024;
const KEEP_EMBEDDINGS = 3;
const IDLE_MS = 3 * 6e4;
const ACTIVATION = "None";
function guided(frameWidth, frameHeight) {
  const shorter = SAM_GRID * Math.min(frameWidth, frameHeight) / Math.max(frameWidth, frameHeight);
  return { Guided: { radius: Math.max(4e-3, 0.6 / shorter), epsilon: 1e-3 } };
}
const RESAMPLED = { Resample: { kernel: "Bilinear" } };
const SIZE_PROBE = 256;
function largest(planes) {
  let best = null;
  for (const p of planes)
    if (p.bounds && (!best || p.bounds.width * p.bounds.height > best.width * best.height))
      best = p.bounds;
  return best;
}
const isStale = (err) => err instanceof EngineError && err.code === "Stale";
let nextId$1 = 1;
class SelectService {
  constructor(engine2, proxyEngine, library, planes, models2, sessions2) {
    this.engine = engine2;
    this.proxyEngine = proxyEngine;
    this.library = library;
    this.planes = planes;
    this.models = models2;
    this.sessions = sessions2;
    engine2.onSpawn(() => {
      this.loadedFor = -1;
      this.embeddings.clear();
    });
  }
  engine;
  proxyEngine;
  library;
  planes;
  models;
  sessions;
  loadedFor = -1;
  loading = null;
  embeddings = /* @__PURE__ */ new Map();
  selections = /* @__PURE__ */ new Map();
  refs = null;
  idle = null;
  /** One-shot jobs running (smart looks, a photo not open): the host stays awake for them. */
  busy = 0;
  /** Whether SAM's model is on this machine. */
  installed() {
    return this.models.installed(SAM_MODEL);
  }
  // ── Models and embeddings ────────────────────────────────────────────────
  async sessionsReady() {
    if (this.loadedFor === this.engine.generation && this.engine.getStatus().status === "ready")
      return;
    this.loading ??= (async () => {
      const ref = await this.models.ref(SAM_MODEL, "Cpu");
      const threads = Math.max(2, source$1.interactiveThreads());
      ref.encoder.model = {
        ...ref.encoder.model,
        session: { threads, optimisation: "All", deterministic: false, ...IDLE_SESSION }
      };
      ref.decoder.model = {
        ...ref.decoder.model,
        session: { threads: 2, optimisation: "All", deterministic: false, ...IDLE_SESSION }
      };
      await this.engine.sam({ op: "load", session: ENCODER, ref: ref.encoder.model });
      await this.engine.sam({ op: "load", session: DECODER, ref: ref.decoder.model });
      this.refs = ref;
      this.loadedFor = this.engine.generation;
    })().finally(() => this.loading = null);
    return this.loading;
  }
  /** The lens correction a photo's masks are placed after: the one given, else its recipe's. */
  async lensFor(key, lens) {
    if (lens !== void 0) return lens;
    const recipe$1 = this.sessions()?.liveRecipe(key) ?? await this.library.recipe(key);
    return recipe.lensCorrection(recipe$1.lens);
  }
  async embKeyOf(key, lens) {
    const row = await this.library.photoRow(key);
    const l = JSON.stringify(await this.lensFor(key, lens));
    return `${key}|${source$1.versionStamp(row)}|${recipe.hash32(l).toString(16)}`;
  }
  /** The photo's embedding, made if it is not held (the encoder, about a second). */
  async embedding(key, signal, lens) {
    await this.sessionsReady();
    const embKey = await this.embKeyOf(key, lens);
    const had = this.embeddings.get(embKey);
    if (had && had.generation === this.engine.generation) {
      this.embeddings.delete(embKey);
      this.embeddings.set(embKey, had);
      await had.ready;
      return { embKey, e: had };
    }
    const id = `emb-${nextId$1++}`;
    const e = {
      id,
      generation: this.engine.generation,
      ready: (async () => {
        const row = await this.library.photoRow(key);
        const info2 = await this.library.probe(row);
        const px2 = await ensureProxies(this.proxyEngine, row, info2);
        const request = {
          source: { Path: px2.proxy.path },
          input: px2.proxy.input,
          raw: null,
          gain_map: null,
          // The proxy is the base frame, upright: what masks are placed on.
          orientation: "Normal",
          lens: await this.lensFor(key, lens),
          encoder: this.refs.encoder,
          // Kept for the committed plane's guided upsample (about 10 MB more).
          guide: true,
          limits: source$1.READ_LIMITS,
          threads: Math.max(2, source$1.interactiveThreads())
        };
        const t0 = Date.now();
        const r = await this.engine.sam(
          { op: "embed", id, session: ENCODER, request },
          { signal }
        );
        log.info("sam embedding", key, `${Date.now() - t0} ms`, r.provenance.frame_width);
        return { frameWidth: r.provenance.frame_width, frameHeight: r.provenance.frame_height };
      })()
    };
    this.embeddings.set(embKey, e);
    while (this.embeddings.size > KEEP_EMBEDDINGS) {
      const oldest = this.embeddings.keys().next().value;
      this.embeddings.delete(oldest);
    }
    try {
      await e.ready;
    } catch (err) {
      if (this.embeddings.get(embKey) === e) this.embeddings.delete(embKey);
      throw err;
    }
    return { embKey, e };
  }
  async decodeOn(lane, embKey, prompt, opts) {
    const e = this.embeddings.get(embKey);
    if (!e) throw Object.assign(new EngineError({ message: "embedding gone", code: "Stale" }));
    const { frameWidth, frameHeight } = await e.ready;
    const long = Math.max(frameWidth, frameHeight);
    const decode2 = async (upsample2, longest, keep) => {
      const request = {
        decoder: this.refs.decoder,
        prompt: recipe.enginePrompt(prompt, opts.count),
        candidates: opts.all || opts.pick ? "All" : "HighestPredictedIou",
        activation: ACTIVATION,
        upsample: upsample2 === "guided" ? guided(frameWidth, frameHeight) : RESAMPLED,
        bounds_at: 0.5,
        png: { compression: "Fast", filter: "NoFilter" },
        threads: 2,
        plane_longest: longest < long ? longest : null
      };
      return await this.engine.sam(
        {
          op: "decode",
          embedding: e.id,
          session: DECODER,
          lane,
          request,
          maskInput: opts.maskInput,
          keep,
          ...opts.pick ? { pick: opts.pick } : {}
        },
        { signal: opts.signal }
      );
    };
    let upsample = opts.upsample;
    if (upsample === "guided") {
      const size = prompt.rect ? { width: prompt.rect.width * frameWidth, height: prompt.rect.height * frameHeight } : largest((await decode2("resampled", SIZE_PROBE, false)).planes);
      if (!guidedKeeps(size, long)) upsample = "resampled";
    }
    return decode2(upsample, opts.longest, opts.keep);
  }
  /**
   * Make a prompt's mask on `lane`, its steps in order (each feeding the
   * next), the last at `longest` with `upsample`.
   */
  async replay(lane, embKey, prompt, upsample, longest, signal, pick) {
    const steps = recipe.promptSteps(prompt);
    let out = null;
    for (let i = 0; i < steps.length; i++) {
      const last2 = i === steps.length - 1;
      out = await this.decodeOn(lane, embKey, prompt, {
        count: steps[i],
        maskInput: i > 0,
        keep: true,
        // The steps before the last are only the next one's input.
        upsample: last2 ? upsample : "resampled",
        longest: last2 ? longest : 256,
        signal,
        ...pick ? { pick } : {}
      });
    }
    return out;
  }
  // ── Selections: the Objects and Sky tools ────────────────────────────────
  /** Start selecting on a photo: its embedding made (or found), ready for prompts. */
  async open(key) {
    this.awake();
    const { embKey } = await this.embedding(key);
    const id = `sel-${nextId$1++}`;
    this.selections.set(id, { id, key, embKey, prompt: null, probe: null, last: null });
    return { selId: id };
  }
  /**
   * A prompt's mask. A probe stops the probe before it (a hover moved on)
   * and changes nothing kept; `replace` starts the selection again from this
   * prompt; `part` adds clicks (Shift: a part, Alt: not a part) to what is
   * selected, refining it. Null for a probe a later one replaced.
   */
  async decode(selId, req) {
    const sel = this.selections.get(selId);
    if (!sel) throw new Error("this selection is closed");
    this.awake();
    const t0 = Date.now();
    if (req.mode === "probe") {
      sel.probe?.abort();
      const abort = new AbortController();
      sel.probe = abort;
      try {
        const r2 = await this.withCatchUp(
          sel,
          () => this.decodeOn(`${sel.id}-probe`, sel.embKey, req.prompt, {
            maskInput: false,
            keep: false,
            upsample: "resampled",
            longest: Math.min(PREVIEW_MAX, Math.max(64, Math.round(req.longest ?? PREVIEW_MAX))),
            signal: abort.signal
          })
        );
        return planeOf(req.seq, r2, Date.now() - t0);
      } catch (err) {
        if (abort.signal.aborted || err instanceof EngineError && err.cancelled) return null;
        throw err;
      } finally {
        if (sel.probe === abort) sel.probe = null;
      }
    }
    if (req.mode === "replace") sel.size = req.size;
    const pick = sel.size;
    const prev = sel.prompt;
    const next = req.mode === "replace" || !prev ? { rect: req.prompt.rect, points: [...req.prompt.points] } : recipe.addPart(prev, req.prompt);
    sel.probe?.abort();
    const r = await this.withCatchUp(sel, async () => {
      if (req.mode === "part" && prev) {
        return this.decodeOn(sel.id, sel.embKey, next, {
          maskInput: true,
          keep: true,
          upsample: "guided",
          longest: FRAME_SIZE,
          ...pick ? { pick } : {}
        });
      }
      return this.decodeOn(sel.id, sel.embKey, next, {
        maskInput: false,
        keep: true,
        upsample: "guided",
        longest: FRAME_SIZE,
        ...pick ? { pick } : {}
      });
    });
    sel.prompt = next;
    sel.last = planeOf(req.seq, r, Date.now() - t0);
    return sel.last;
  }
  /**
   * A host that is new (it crashed, or slept) holds no embedding or lane:
   * make the embedding again, bring the selection's lane back to where it
   * was, and try once more.
   */
  async withCatchUp(sel, run2) {
    try {
      return await run2();
    } catch (err) {
      if (!isStale(err)) throw err;
      log.info("select: the host is new; catching up", sel.id);
      this.loadedFor = -1;
      this.embeddings.clear();
      const { embKey } = await this.embedding(sel.key);
      sel.embKey = embKey;
      if (sel.prompt)
        await this.replay(sel.id, embKey, sel.prompt, "resampled", 256, void 0, sel.size);
      return run2();
    }
  }
  /** The selection as a mask: its last answer, at the frame's size, in the plane store. */
  async commit(selId, source2) {
    const sel = this.selections.get(selId);
    if (!sel?.last || !sel.prompt) throw new Error("nothing is selected yet");
    return this.keep(sel.last.png, sel.prompt, source2);
  }
  keep(png16, prompt, source2) {
    const d = ops.grey8(Buffer.from(png16));
    const png2 = ops.encodeGreyPng(d.data, d.width, d.height).toString("base64");
    const ref = pixlfile.planeRef(png2);
    this.planes.put(ref, png2);
    return {
      ref,
      width: d.width,
      height: d.height,
      source: {
        kind: "prompt",
        ...source2.label ? { label: source2.label } : {},
        prompt: { ...prompt, parts: recipe.promptSteps(prompt) },
        via: source2.via,
        ...source2.concept ? { concept: source2.concept } : {}
      }
    };
  }
  close(selId) {
    const sel = this.selections.get(selId);
    if (!sel) return;
    sel.probe?.abort();
    this.selections.delete(selId);
    void this.engine.sam({ op: "release", lanes: [sel.id, `${sel.id}-probe`] }).catch(() => void 0);
    this.awake();
  }
  // ── One prompt, start to end (smart looks, a photo not open) ─────────────
  /** A prompt's mask on a photo, as a job runs it: made, kept in the plane store. */
  async oneShot(key, prompt, source2, signal, onStage) {
    this.busy++;
    const lane = `once-${nextId$1++}`;
    try {
      onStage?.("embed");
      const { embKey } = await this.embedding(key, signal);
      onStage?.("decode");
      const r = await this.replay(lane, embKey, prompt, "guided", FRAME_SIZE, signal);
      const plane = r.planes[0];
      if (!plane) throw new Error("the model found nothing there");
      return this.keep(plane.png, prompt, source2);
    } finally {
      this.busy--;
      void this.engine.sam({ op: "release", lanes: [lane] }).catch(() => void 0);
      this.awake();
    }
  }
  // ── Snap to edges on a brush ─────────────────────────────────────────────
  /**
   * What a stroke's snap depends on besides the stroke: the photo's pixels
   * and the lens correction its masks are placed after. Cheap (no model),
   * so a plane already made for it is found without SAM.
   */
  async snapKey(key, lens) {
    return recipe.hash32(await this.embKeyOf(key, lens)).toString(16);
  }
  /**
   * The object a brush stroke was painted on, as an 8-bit plane at the
   * frame's size: SAM asked with clicks over the stroke's core, and of its
   * answers the smallest that holds (nearly) all of that core. Null when SAM
   * is not on this machine or the stroke has no core.
   */
  async objectUnder(key, lens, stroke, signal) {
    const prompt = recipe.strokePrompt(stroke.data, stroke.width, stroke.height);
    if (!prompt || !await this.installed()) return null;
    this.busy++;
    const lane = `snap-${nextId$1++}`;
    try {
      const { embKey } = await this.embedding(key, signal, lens);
      const r = await this.decodeOn(lane, embKey, prompt, {
        maskInput: false,
        keep: false,
        upsample: "guided",
        longest: FRAME_SIZE,
        signal,
        all: true
      });
      const answers = r.planes.map((p) => ops.grey8(Buffer.from(p.png)));
      if (answers.length === 0) return null;
      const held2 = answers.map((a) => coreHeld(stroke, a));
      return answers[recipe.strokeObject(
        held2,
        r.planes.map((p) => p.coverage)
      )];
    } finally {
      this.busy--;
      void this.engine.sam({ op: "release", lanes: [lane] }).catch(() => void 0);
      this.awake();
    }
  }
  // ── Sleep ────────────────────────────────────────────────────────────────
  /** Something happened: sleep only after IDLE_MS of nothing. */
  awake() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.selections.size > 0 || this.busy > 0) return this.awake();
      if (this.engine.sleep()) log.info("select: idle, the host sleeps");
    }, IDLE_MS);
  }
}
function coreHeld(stroke, object2) {
  let max2 = 0;
  for (const v of stroke.data) if (v > max2) max2 = v;
  const at = max2 * 0.9;
  let core = 0;
  let inside = 0;
  const step = Math.max(1, Math.round(Math.max(stroke.width, stroke.height) / 256));
  for (let y = step >> 1; y < stroke.height; y += step) {
    const oy = Math.min(object2.height - 1, Math.floor((y + 0.5) / stroke.height * object2.height));
    for (let x = step >> 1; x < stroke.width; x += step) {
      if (stroke.data[y * stroke.width + x] < at) continue;
      core++;
      const ox = Math.min(object2.width - 1, Math.floor((x + 0.5) / stroke.width * object2.width));
      if (object2.data[oy * object2.width + ox] >= 128) inside++;
    }
  }
  return core ? inside / core : 0;
}
function planeOf(seq, r, ms) {
  const p = r.planes[0];
  return {
    seq,
    png: p?.png ?? new Uint8Array(),
    width: r.plane_width,
    height: r.plane_height,
    iou: p?.predicted_iou ?? 0,
    coverage: p?.coverage ?? 0,
    ms
  };
}
function createPixels(options) {
  return new node_worker_threads.Worker(new URL("./pixels.worker-G0bru_ZB.js", require("url").pathToFileURL(__filename).href), options);
}
class Pool {
  threads;
  turn = 0;
  nextId = 0;
  waiting = /* @__PURE__ */ new Map();
  constructor(size) {
    this.threads = new Array(size).fill(null);
  }
  thread(i) {
    const live = this.threads[i];
    if (live) return live;
    const w = createPixels({});
    w.on("message", (r) => {
      const job = this.waiting.get(r.id);
      if (!job) return;
      this.waiting.delete(r.id);
      if (r.error !== void 0) job.reject(new Error(r.error));
      else job.resolve(r.value);
    });
    const fail = (err) => {
      log.warn("pixels worker stopped", err.message);
      this.threads[i] = null;
      for (const [id, job] of this.waiting)
        if (job.thread === i) {
          this.waiting.delete(id);
          job.reject(err);
        }
    };
    w.on("error", fail);
    w.on("exit", (code) => code !== 0 && fail(new Error(`exit ${code}`)));
    w.unref();
    this.threads[i] = w;
    return w;
  }
  /** Post a job; `transfer` hands buffers over instead of copying them (they are gone here after). */
  run(job, transfer = []) {
    const i = this.turn;
    this.turn = (this.turn + 1) % this.threads.length;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, thread: i });
      this.thread(i).postMessage({ ...job, id }, transfer);
    });
  }
  close() {
    for (const w of this.threads) void w?.terminate();
    this.threads.fill(null);
  }
}
const pixels = new Pool(Math.min(2, Math.max(1, os.availableParallelism() - 1)));
const writing = /* @__PURE__ */ new Map();
let snapper = null;
function setBrushSnapper(s) {
  snapper = s;
}
const snapping = /* @__PURE__ */ new Map();
function snapped(snapFile, plainFile, photoKey, lens, job) {
  const running = snapping.get(snapFile);
  if (running) return running;
  const p = (async () => {
    if (await exists(snapFile)) return snapFile;
    const object2 = await snapper?.object(photoKey, lens, ops.grey8(Buffer.from(job.png, "base64"))).catch((err) => {
      log.warn("brush snap: no object", err);
      return null;
    });
    if (!object2) {
      await ensure(plainFile, job);
      return plainFile;
    }
    await ensure(snapFile, { ...job, file: snapFile, object: object2 });
    return snapFile;
  })().finally(() => snapping.delete(snapFile));
  snapping.set(snapFile, p);
  return p;
}
function ensure(file, job) {
  const running = writing.get(file);
  if (running) return running;
  const p = exists(file).then((there) => there ? void 0 : pixels.run(job).then(() => void 0)).catch(() => {
    if (job.op === "gradient") {
      ops.writeGradientPlane(file, job.c, job.user);
      ops.pruneGradientsSometimes(job.dir);
    } else ops.writeBrushPlane(file, job.png, job.user, job.edge, job.object);
  }).finally(() => writing.delete(file));
  writing.set(file, p);
  return p;
}
async function brushPlanes(photoId, recipe$1, user) {
  const out = {};
  const dir = index$1.paths.photoCache(photoId);
  const work = [];
  const photoKey = String(photoId);
  const lens = recipe.lensCorrection(recipe$1.lens);
  let snapKey = null;
  const snapKeyOf = () => snapKey ??= snapper ? snapper.key(photoKey, lens).catch(() => null) : Promise.resolve(null);
  for (const layer of recipe$1.layers) {
    for (const c of layer.components) {
      if (c.kind === "linear" || c.kind === "radial" || c.kind === "bidirectional") {
        if (!gradients.rasterGradient(c)) continue;
        const file2 = path.join(dir, `grad-${gradients.gradientKey(c)}${recipe.edgeKey(c.edge)}-${user}.png`);
        work.push(ensure(file2, { op: "gradient", file: file2, dir, c, user }));
        out[c.id] = file2;
        continue;
      }
      if (c.kind === "depth") {
        if (!c.png) continue;
        const file2 = path.join(dir, `depth-${c.ref ?? pixlfile.planeRef(c.png)}-${user}.png`);
        work.push(ensure(file2, { op: "brush", file: file2, png: c.png, user }));
        out[c.id] = file2;
        continue;
      }
      if (c.kind !== "brush" || !c.png) continue;
      const edge = pixlfile.planeEdge(c);
      const name = `brush-${c.ref ?? pixlfile.planeRef(c.png)}${recipe.edgeKey(edge)}`;
      const file = path.join(dir, `${name}-${user}.png`);
      const job = { op: "brush", file, png: c.png, user, ...edge ? { edge } : {} };
      if (pixlfile.snapsToObject(c) && snapper) {
        const id = c.id;
        work.push(
          snapKeyOf().then(async (k) => {
            out[id] = k ? await snapped(path.join(dir, `${name}-on${k}-${user}.png`), file, photoKey, lens, job) : file;
            if (!k) await ensure(file, job);
          })
        );
        continue;
      }
      work.push(ensure(file, job));
      out[c.id] = file;
    }
  }
  await Promise.all(work);
  return out;
}
let Cancelled$1 = class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
};
const KEEP_FINISHED_MS = 3e4;
const SEND_MS = 80;
let nextId = 1;
class AiJobs {
  constructor(runners, names, onResult) {
    this.runners = runners;
    this.names = names;
    this.onResult = onResult;
  }
  runners;
  names;
  onResult;
  jobs = /* @__PURE__ */ new Map();
  /** The job running in each lane. */
  running = /* @__PURE__ */ new Map();
  ended = /* @__PURE__ */ new Set();
  send(e) {
    for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(index$1.IPC.ai.event, e);
  }
  /** The killswitch (Settings → AI models): false refuses every job. */
  gate = null;
  async start(req) {
    if (this.gate && !await this.gate())
      throw new Error(concepts.t("AI models are off: turn them on in Settings → AI models"));
    const runner = this.runners[req.task];
    if (!runner) throw new Error(concepts.t("{{task}} is not available in this build", { task: req.task }));
    const jobId = `ai-${nextId++}`;
    const stages = runner.stages(req);
    const { title, subject } = runner.title(req);
    const event = {
      jobId,
      task: req.task,
      key: req.key,
      name: await this.names(req.key).catch(() => req.key),
      title,
      subject,
      stages,
      stage: stages[0]?.id ?? "",
      progress: 0,
      phase: "queued",
      ...req.group ? { group: req.group } : {}
    };
    this.jobs.set(jobId, { event, req, control: new AbortController(), at: Date.now() });
    this.send(event);
    this.pump();
    return jobId;
  }
  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (job.event.phase === "queued") {
      this.finish(job, { phase: "cancelled", message: concepts.t("Cancelled") });
      return;
    }
    if (job.event.phase === "running") job.control.abort();
  }
  /** Hear every job that ends (done, failed or cancelled), after its result is applied. */
  onEnded(listener) {
    this.ended.add(listener);
    return () => this.ended.delete(listener);
  }
  /** Whether a job is queued or running. */
  get busy() {
    return [...this.jobs.values()].some(
      (j) => j.event.phase === "queued" || j.event.phase === "running"
    );
  }
  list() {
    return [...this.jobs.values()].map((j) => j.event);
  }
  finish(job, patch) {
    job.event = { ...job.event, ...patch };
    this.send(job.event);
    for (const l of this.ended) l(job.event);
    setTimeout(() => this.jobs.delete(job.event.jobId), KEEP_FINISHED_MS);
  }
  laneOf(req) {
    return this.runners[req.task]?.lane ?? "model";
  }
  pump() {
    const ready2 = pixlfile.toStart(
      [...this.jobs.values()].map((j) => ({ ...j, phase: j.event.phase })),
      new Set(this.running.keys()),
      (j) => this.laneOf(j.req)
    );
    for (const next of ready2) {
      const lane = this.laneOf(next.req);
      const job = this.jobs.get(next.event.jobId);
      this.running.set(lane, job.event.jobId);
      void this.run(job).finally(() => {
        this.running.delete(lane);
        this.pump();
      });
    }
  }
  async run(job) {
    const runner = this.runners[job.req.task];
    const stages = job.event.stages;
    let stage = job.event.stage;
    let stageP = 0;
    let lastSent = 0;
    const update2 = (patch, force = false) => {
      job.event = { ...job.event, ...patch };
      const now = Date.now();
      if (force || now - lastSent >= SEND_MS) {
        lastSent = now;
        this.send(job.event);
      }
    };
    update2({ phase: "running" }, true);
    let committed = false;
    const ctx = {
      jobId: job.event.jobId,
      key: job.event.key,
      signal: job.control.signal,
      stage: (id, p = 0, message) => {
        stage = id;
        stageP = p;
        update2(
          { stage, progress: pixlfile.overallProgress(stages, stage, stageP), estimated: false, message },
          true
        );
      },
      progress: (p, estimated = false) => {
        stageP = p;
        update2({ progress: pixlfile.overallProgress(stages, stage, stageP), estimated });
      },
      commit: () => {
        if (job.control.signal.aborted) throw new Cancelled$1();
        committed = true;
      }
    };
    try {
      const result = await runner.run(ctx, job.req);
      if (job.control.signal.aborted && !committed) throw new Cancelled$1();
      job.event = { ...job.event, result, progress: 1, stage: stages.at(-1)?.id ?? stage };
      await this.onResult(job.event);
      this.finish(job, { phase: "done" });
    } catch (err) {
      if (!committed && (job.control.signal.aborted || err instanceof Cancelled$1)) {
        this.finish(job, { phase: "cancelled", message: concepts.t("Cancelled") });
        return;
      }
      log.warn(`ai ${job.req.task} failed`, err);
      this.finish(job, { phase: "error", message: err.message });
    }
  }
}
const EMBED_MS = 1500;
class PromptRunner {
  constructor(select, models2) {
    this.select = select;
    this.models = models2;
  }
  select;
  models;
  task = "prompt";
  lane = "select";
  stages() {
    return [
      { id: "model", label: concepts.t("Model"), weight: 0.1 },
      { id: "analyse", label: concepts.t("Analyse"), weight: 0.75 },
      { id: "refine", label: concepts.t("Refine"), weight: 0.15 }
    ];
  }
  title(req) {
    return { title: concepts.t("Selecting"), subject: req.label ? concepts.t(req.label) : concepts.t("Object") };
  }
  async run(ctx, req) {
    ctx.stage("model", 0, concepts.t("Loading the model"));
    if (!await this.models.installed(SAM_MODEL))
      throw new ModelMissing(this.models.entry(SAM_MODEL));
    let tick = null;
    try {
      const made = await this.select.oneShot(
        req.key,
        req.prompt,
        { label: req.label, via: req.via },
        ctx.signal,
        (stage) => {
          if (tick) clearInterval(tick);
          if (stage === "embed") {
            ctx.stage(
              "analyse",
              0,
              concepts.t("Finding the {{subject}}", { subject: (req.label ? concepts.t(req.label) : concepts.t("object")).toLowerCase() })
            );
            const t0 = Date.now();
            tick = setInterval(() => ctx.progress(pixlfile.estimate(Date.now() - t0, EMBED_MS), true), 200);
          } else ctx.stage("refine", 0, concepts.t("Refining the edges"));
        }
      );
      return {
        kind: "mask",
        ref: made.ref,
        width: made.width,
        height: made.height,
        label: req.label ? concepts.t(req.label) : concepts.t("Object"),
        source: made.source,
        ...req.into ? { into: { ...req.into } } : {}
      };
    } catch (err) {
      if (ctx.signal.aborted || isCancelled(err)) throw new Cancelled$1();
      throw err;
    } finally {
      if (tick) clearInterval(tick);
    }
  }
}
function appPage(pageFile, devUrl) {
  const dev = devUrl ? new URL(devUrl).origin : void 0;
  const file = new URL(pageFile);
  return (url2) => {
    if (!url2) return false;
    let u;
    try {
      u = new URL(url2);
    } catch {
      return false;
    }
    if (dev) return u.origin === dev;
    return u.protocol === "file:" && u.host === file.host && u.pathname === file.pathname;
  };
}
const EXTERNAL_HOSTS = ["pixlfoundation.com", "lemonsqueezy.com"];
function externalAllowed(url2) {
  let u;
  try {
    u = new URL(url2);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return EXTERNAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
async function applyMaskResult(e, deps) {
  const r = e.result;
  if (r?.kind !== "mask") return;
  if (r.polygon) return applyFacePart(e, r, r.polygon, deps);
  const png2 = await deps.planes.get(r.ref);
  if (png2 === void 0) throw new Error("the mask went missing before it could be added");
  const live = deps.sessions.liveRecipe(e.key);
  const recipe$1 = structuredClone(live ?? await deps.library.recipe(e.key));
  const depth = r.depth ? {
    id: recipe.newId(),
    kind: "depth",
    mode: "Add",
    opacity: 100,
    invert: false,
    feather: 0,
    width: r.width,
    height: r.height,
    png: png2,
    // The nearest third, softly: a start the user moves with a click or the sliders.
    near: 0,
    far: 33,
    softness: 10
  } : null;
  const brush = {
    id: recipe.newId(),
    name: r.label,
    kind: "brush",
    mode: "Add",
    opacity: 100,
    invert: false,
    feather: 0,
    width: r.width,
    height: r.height,
    png: png2,
    // A model's plane is snapped to the picture's edges at whatever resolution
    // the engine renders: a soft saliency map further than SAM's crisp one
    // (shared/refine.ts).
    // (Not BiRefNet's fine matte: snapping would cut the hair it keeps.)
    ...r.source?.kind === "segment" && r.source.fine ? {} : { refine: pixlfile.modelRefine() },
    ...r.source ? { source: r.source } : {}
  };
  const comp = depth ?? brush;
  const into = r.into && recipe$1.layers.find((l) => l.id === r.into.layerId);
  if (into) into.components.push({ ...comp, mode: into.components.length ? r.into.mode : "Add" });
  else {
    const layer = recipe.newLocalLayer(pixlfile.nextMaskName(recipe$1.layers.map((l) => l.name)));
    layer.name = r.label;
    layer.components = [comp];
    recipe$1.layers.push(layer);
    r.into = { layerId: layer.id, mode: "Add" };
  }
  await keepRecipe(e.key, recipe$1, live !== void 0, deps);
}
async function applyFacePart(e, r, found, deps) {
  const live = deps.sessions.liveRecipe(e.key);
  const recipe$1 = structuredClone(live ?? await deps.library.recipe(e.key));
  const [first, ...rings] = recipe.shownRings(found);
  const comp = {
    id: recipe.newId(),
    name: r.label,
    kind: "polygon",
    mode: "Add",
    opacity: 100,
    invert: false,
    feather: 3,
    edge: { shift: 0, harden: 0, inside: false },
    points: first,
    ...rings.length ? { rings } : {},
    found
  };
  const into = r.into && recipe$1.layers.find((l) => l.id === r.into.layerId);
  if (into) into.components.push({ ...comp, mode: into.components.length ? r.into.mode : "Add" });
  else {
    const layer = recipe.newLocalLayer(pixlfile.nextMaskName(recipe$1.layers.map((l) => l.name)));
    layer.name = r.label;
    layer.components = [comp];
    recipe$1.layers.push(layer);
    r.into = { layerId: layer.id, mode: "Add" };
  }
  await keepRecipe(e.key, recipe$1, live !== void 0, deps);
}
async function keepRecipe(key, recipe2, open, deps) {
  if (open) {
    deps.sessions.update(key, recipe2, false);
    await deps.sessions.flush(key);
  } else {
    await deps.library.saveRecipe(key, recipe2);
    const { photoId, copyId } = pixlfile.parseKey(key);
    deps.library.queueThumb(photoId, copyId, true);
  }
}
async function editPhotoRecipe(key, change, deps) {
  const live = deps.sessions.liveRecipe(key);
  const recipe2 = structuredClone(live ?? await deps.library.recipe(key));
  change(recipe2);
  await keepRecipe(key, recipe2, live !== void 0, deps);
}
const PART_MARGIN = 24;
function personBox(planes, w, h) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (planes.some((p) => p.data[i] >= 128)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
function squareAround(b, w, h) {
  const side = Math.round(Math.min(w, h, Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) * 1.15));
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return {
    x: Math.round(Math.max(0, Math.min(w - side, cx - side / 2))),
    y: Math.round(Math.max(0, Math.min(h - side, cy - side / 2))),
    side
  };
}
function pasted(p, sq, w, h) {
  const out = new Uint8Array(w * h);
  const sx = p.width / sq.side;
  const sy = p.height / sq.side;
  for (let y = 0; y < sq.side && sq.y + y < h; y++) {
    const py = Math.min(p.height - 1, Math.floor(y * sy));
    for (let x = 0; x < sq.side && sq.x + x < w; x++)
      out[(sq.y + y) * w + sq.x + x] = p.data[py * p.width + Math.min(p.width - 1, Math.floor(x * sx))];
  }
  return out;
}
function partPlane(planes, wanted, n) {
  const mine = planes.filter((p) => wanted.includes(p.name));
  const others = planes.filter((p) => !wanted.includes(p.name));
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const p of mine) v += p.data[i];
    v = Math.min(255, v);
    let o = 0;
    for (const p of others) if (p.data[i] > o) o = p.data[i];
    const t = Math.min(1, Math.max(0, (v - o + PART_MARGIN) / (2 * PART_MARGIN)));
    out[i] = Math.round(v * t);
  }
  return out;
}
const KEY = "ai.switches";
class AiSwitchStore {
  constructor(settings2) {
    this.settings = settings2;
  }
  settings;
  cached = null;
  listeners = /* @__PURE__ */ new Set();
  /** This computer, as a benchmark names it. */
  machine = machineKey(os.cpus()[0]?.model ?? "unknown", os.totalmem() / 1048576);
  async get() {
    if (this.cached) return this.cached;
    const v = await this.settings.getSetting(KEY).catch(() => null);
    this.cached = readSwitches(v);
    return this.cached;
  }
  /** AI models may run (the killswitch is not thrown). */
  async enabled() {
    return (await this.get()).enabled;
  }
  /** A heavy model may run now. */
  async allowed(model) {
    return heavyAllowed(await this.get(), model, this.machine);
  }
  async setEnabled(on) {
    return this.save({ ...await this.get(), enabled: on });
  }
  /** Turn a heavy model on (only with a passing benchmark from this computer) or off. */
  async setHeavy(model, on) {
    const s = await this.get();
    const h = s.heavy[model];
    if (on && !benchmarkHolds(h.benchmark, this.machine))
      throw new Error("Run the benchmark first: it has to pass on this computer");
    return this.save({ ...s, heavy: { ...s.heavy, [model]: { ...h, on } } });
  }
  /** A benchmark's result kept; one that failed turns the model off. */
  async recordBenchmark(b) {
    const s = await this.get();
    const h = s.heavy[b.model];
    return this.save({
      ...s,
      heavy: { ...s.heavy, [b.model]: { on: b.passed ? h.on : false, benchmark: b } }
    });
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  async save(s) {
    this.cached = s;
    await this.settings.setSetting(KEY, s);
    for (const l of this.listeners) l(s);
    for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(index$1.IPC.ai.switchesEvent, s);
    return s;
  }
}
const UPSAMPLE = { Guided: { radius: 4e-3, epsilon: 1e-3 } };
const DEPTH_UPSAMPLE = { Resample: { kernel: "Bilinear" } };
const HARDEN = 4;
const HARDEN_AT = 0.6;
const SCENE_UPSAMPLE = { Guided: { radius: 0.02, epsilon: 1e-3 } };
const NOTHING_FOUND = 2e-3;
const PART_PLANES = {
  face: ["face_skin"],
  hair: ["hair"],
  skin: ["face_skin", "body_skin"],
  clothes: ["clothes"]
};
const SUBJECT_MODELS = ["u2netp"];
const NOTHING_SALIENT = 0.2;
class SegmentRunner {
  constructor(library, planes, engine2, models2, sessions2) {
    this.library = library;
    this.planes = planes;
    this.engine = engine2;
    this.models = models2;
    this.sessions = sessions2;
  }
  library;
  planes;
  engine;
  models;
  sessions;
  task = "segment";
  stages() {
    return [
      { id: "model", label: concepts.t("Model"), weight: 0.15 },
      { id: "analyse", label: concepts.t("Analyse"), weight: 0.6 },
      { id: "refine", label: concepts.t("Refine"), weight: 0.25 }
    ];
  }
  title(req) {
    return { title: concepts.t("Segmenting"), subject: concepts.t(pixlfile.SEGMENT_LABEL[req.target]) };
  }
  /** The subject model to use: the best one downloaded, or null. */
  async model() {
    for (const id of SUBJECT_MODELS) if (await this.models.installed(id)) return id;
    return null;
  }
  async run(ctx, req) {
    ctx.stage("model", 0, concepts.t("Loading the model"));
    if (recipe.isFacePart(req.target)) return this.faceParts(ctx, req, req.target);
    if (req.target === "phrase") return this.phrase(ctx, req);
    const depth = req.target === "depth";
    const scene = pixlfile.isSceneTarget(req.target);
    const named2 = depth || scene || pixlfile.isPartTarget(req.target) || req.fine ? pixlfile.segmentModel(req.target, req.fine) : null;
    const id = named2 ? await this.models.installed(named2) ? named2 : null : await this.model();
    if (!id) throw new ModelMissing(this.models.entry(named2 ?? "u2netp"));
    const row = await this.library.photoRow(req.key);
    const info2 = await this.library.probe(row);
    if (this.engine.getStatus().status === "starting") {
      this.engine.start();
      await this.engine.whenStarted();
    }
    const px2 = await ensureProxies(this.engine, row, info2, source$1.BACKGROUND_THREADS);
    const recipe$1 = this.sessions()?.liveRecipe(req.key) ?? await this.library.recipe(req.key);
    const segmenter = await this.models.ref(id, "Cpu");
    if (ctx.signal.aborted) throw new Cancelled$1();
    ctx.stage(
      "analyse",
      0,
      concepts.t("Finding the {{subject}}", { subject: concepts.t(pixlfile.SEGMENT_LABEL[req.target]).toLowerCase() })
    );
    const t0 = Date.now();
    const expected = req.fine ? 1e4 : 2500;
    const tick = setInterval(() => ctx.progress(pixlfile.estimate(Date.now() - t0, expected), true), 200);
    let report;
    const lens = recipe.lensCorrection(recipe$1.lens);
    if (pixlfile.isPartTarget(req.target)) {
      try {
        return await this.part(ctx, req, req.target, row.id, px2.proxy, lens, segmenter);
      } finally {
        clearInterval(tick);
      }
    }
    const request = (model) => ({
      source: { Path: px2.proxy.path },
      input: px2.proxy.input,
      raw: null,
      gain_map: null,
      // The proxy is the base frame, upright: what masks are placed on.
      orientation: "Normal",
      lens,
      segmenter: { Classes: model },
      // A depth map's edges aren't the picture's: bilinear (engine 0.18).
      upsample: depth ? DEPTH_UPSAMPLE : scene ? SCENE_UPSAMPLE : UPSAMPLE,
      png: { compression: "Fast", filter: "Sub" },
      threads: source$1.BACKGROUND_THREADS,
      limits: source$1.READ_LIMITS,
      // At the proxy's own size: the edge is followed there, not stretched later.
      plane_longest: null
    });
    try {
      report = await this.engine.segment(request(segmenter), { signal: ctx.signal });
    } catch (err) {
      if (ctx.signal.aborted) throw new Cancelled$1();
      throw err;
    } finally {
      clearInterval(tick);
    }
    const plane = scene ? report.planes.find((p) => p.name === req.target) : report.planes[0];
    if (!plane) throw new Error("the model returned no plane");
    if (scene) {
      const label2 = concepts.t(pixlfile.SEGMENT_LABEL[req.target]);
      if (plane.coverage < NOTHING_FOUND)
        throw new Error(concepts.t("No {{label}} found in this photo", { label: label2.toLowerCase() }));
      const d2 = ops.grey8(Buffer.from(plane.png));
      const png22 = ops.encodeGreyPng(d2.data, d2.width, d2.height).toString("base64");
      const ref2 = pixlfile.planeRef(png22);
      this.planes.put(ref2, png22);
      return {
        kind: "mask",
        ref: ref2,
        width: d2.width,
        height: d2.height,
        label: label2,
        source: { kind: "segment", target: req.target },
        ...req.into ? { into: { ...req.into } } : {}
      };
    }
    if (req.target === "depth") {
      const d2 = ops.grey8(Buffer.from(plane.png));
      const png22 = ops.encodeGreyPng(d2.data, d2.width, d2.height).toString("base64");
      const ref2 = pixlfile.planeRef(png22);
      this.planes.put(ref2, png22);
      return {
        kind: "mask",
        ref: ref2,
        width: d2.width,
        height: d2.height,
        label: concepts.t(pixlfile.SEGMENT_LABEL.depth),
        depth: true,
        ...req.into ? { into: { ...req.into } } : {}
      };
    }
    if (plane.raw_max < NOTHING_SALIENT)
      throw new Error(concepts.t("No clear subject in this photo: try a brush or a range mask"));
    ctx.stage("refine", 0, concepts.t("Refining the edges"));
    const d = ops.grey8(Buffer.from(plane.png));
    const grey = d.data;
    if (req.target === "background") for (let i = 0; i < grey.length; i++) grey[i] = 255 - grey[i];
    if (!req.fine) pixlfile.hardenPlane(grey, HARDEN_AT, HARDEN);
    ctx.progress(0.8);
    const png2 = ops.encodeGreyPng(grey, d.width, d.height).toString("base64");
    const ref = pixlfile.planeRef(png2);
    this.planes.put(ref, png2);
    return {
      kind: "mask",
      ref,
      width: d.width,
      height: d.height,
      label: req.fine ? concepts.t("{{label}} (fine)", { label: concepts.t(pixlfile.SEGMENT_LABEL[req.target]) }) : concepts.t(pixlfile.SEGMENT_LABEL[req.target]),
      source: {
        kind: "segment",
        target: req.target,
        ...req.fine ? { fine: true } : {}
      },
      // Into the mask it was asked for (Add to the selected mask, a smart look's), else a new one.
      ...req.into ? { into: { ...req.into } } : {}
    };
  }
  /**
   * Anything named by a phrase (engine 0.19's `segmentConcept`): SAM 3, or
   * EfficientSAM3 when only it is here. Every instance it finds goes into
   * the one mask. The plane is brought up bilinear: SAM 3's guided upsample
   * lost small objects whose edge the luminance doesn't carry (the roster's
   * measurement); the render's snap firms the edge instead.
   */
  async phrase(ctx, req) {
    const text = (req.phrase ?? "").trim().slice(0, 80);
    if (!text) throw new Error(concepts.t("Type what to find: “red car”, “the dog”"));
    let id = null;
    for (const m of pixlfile.PHRASE_MODELS) {
      if (id || m === "sam3" && true) continue;
      if (await this.models.installed(m)) id = m;
    }
    if (!id) throw new ModelMissing(this.models.entry(pixlfile.OFFERED_PHRASE_MODEL));
    const row = await this.library.photoRow(req.key);
    const info2 = await this.library.probe(row);
    if (this.engine.getStatus().status === "starting") {
      this.engine.start();
      await this.engine.whenStarted();
    }
    const px2 = await ensureProxies(this.engine, row, info2, source$1.BACKGROUND_THREADS);
    const recipe$1 = this.sessions()?.liveRecipe(req.key) ?? await this.library.recipe(req.key);
    const ref = await this.models.ref(id, "Cpu");
    if (ctx.signal.aborted) throw new Cancelled$1();
    const lens = recipe.lensCorrection(recipe$1.lens);
    ctx.stage("analyse", 0, concepts.t("Finding “{{text}}”", { text }));
    const expected = id === "sam3" ? 1e4 : 2e3;
    const t0 = Date.now();
    const tick = setInterval(() => ctx.progress(pixlfile.estimate(Date.now() - t0, expected), true), 200);
    let r;
    try {
      r = await this.engine.sam(
        {
          op: "concept",
          // The same frame (photo, proxy, lens) and model: its embedding is reused.
          key: `${row.id}:${px2.proxy.path}:${JSON.stringify(lens)}:${id}`,
          embed: {
            source: { Path: px2.proxy.path },
            input: px2.proxy.input,
            raw: null,
            gain_map: null,
            orientation: "Normal",
            lens,
            encoder: ref.encoder,
            guide: false,
            limits: source$1.READ_LIMITS,
            threads: source$1.BACKGROUND_THREADS
          },
          request: {
            text_encoder: ref.text_encoder,
            decoder: ref.decoder,
            prompt: { text, exemplars: [] },
            min_score: ref.segment.min_score,
            max_instances: ref.segment.max_instances,
            activation: ref.segment.activation,
            upsample: DEPTH_UPSAMPLE,
            bounds_at: null,
            png: { compression: "Fast", filter: "Sub" },
            threads: source$1.BACKGROUND_THREADS
          }
        },
        { signal: ctx.signal }
      );
    } catch (err) {
      if (ctx.signal.aborted) throw new Cancelled$1();
      throw err;
    } finally {
      clearInterval(tick);
    }
    log.info(
      "phrase",
      id,
      JSON.stringify(text),
      `${r.instances.length} found`,
      r.reused ? "embedding reused" : `embedding ${r.embedMs} ms`,
      `phrase ${r.conceptMs} ms`
    );
    if (r.instances.length === 0)
      throw new Error(
        concepts.t("Nothing found for “{{text}}”: try other words, or Objects to draw a box", { text })
      );
    ctx.stage("refine", 0, concepts.t("Joining what was found"));
    let plane = null;
    for (const i of r.instances) {
      const g = ops.grey8(Buffer.from(i.png));
      if (!plane) plane = g;
      else
        for (let k = 0; k < plane.data.length; k++)
          if (g.data[k] > plane.data[k]) plane.data[k] = g.data[k];
    }
    const png2 = ops.encodeGreyPng(plane.data, plane.width, plane.height).toString("base64");
    const pref = pixlfile.planeRef(png2);
    this.planes.put(pref, png2);
    return {
      kind: "mask",
      ref: pref,
      width: plane.width,
      height: plane.height,
      label: text.charAt(0).toUpperCase() + text.slice(1),
      source: { kind: "phrase", text },
      ...req.into ? { into: { ...req.into } } : {}
    };
  }
  /**
   * A face part (engine 0.19's `faces`): every face's outline of it, as a
   * lasso. YuNet sees the frame fitted into 640² (reliable down to 1/8 of
   * its long side), so the four overlapping quarters are looked at too, for
   * a group's smaller faces; a face found twice is kept once.
   */
  async faceParts(ctx, req, part2) {
    for (const id of [recipe.FACE_DETECTOR, recipe.FACE_LANDMARKER])
      if (!await this.models.installed(id)) throw new ModelMissing(this.models.entry(id));
    const row = await this.library.photoRow(req.key);
    const info2 = await this.library.probe(row);
    if (this.engine.getStatus().status === "starting") {
      this.engine.start();
      await this.engine.whenStarted();
    }
    const px2 = await ensureProxies(this.engine, row, info2, source$1.BACKGROUND_THREADS);
    const recipe$1 = this.sessions()?.liveRecipe(req.key) ?? await this.library.recipe(req.key);
    const detector = await this.models.ref(recipe.FACE_DETECTOR, "Cpu");
    const landmarks = await this.models.ref(recipe.FACE_LANDMARKER, "Cpu");
    if (ctx.signal.aborted) throw new Cancelled$1();
    const label2 = concepts.t(pixlfile.SEGMENT_LABEL[part2]);
    ctx.stage("analyse", 0, concepts.t("Finding faces"));
    const W = px2.proxy.width;
    const H = px2.proxy.height;
    const look2 = async (region) => {
      try {
        const r = await this.engine.faces(
          {
            source: { Path: px2.proxy.path },
            input: px2.proxy.input,
            raw: null,
            gain_map: null,
            // The proxy is the base frame, upright, after the lens: what masks are placed on.
            orientation: "Normal",
            lens: recipe.lensCorrection(recipe$1.lens),
            region: region ? { ...region, margin: 0 } : null,
            detector,
            landmarks,
            threads: source$1.BACKGROUND_THREADS,
            limits: source$1.READ_LIMITS
          },
          { signal: ctx.signal }
        );
        return r.faces;
      } catch (err) {
        if (ctx.signal.aborted) throw new Cancelled$1();
        throw err;
      }
    };
    const whole = await look2(null);
    ctx.progress(0.4);
    const tiles = [];
    for (const tile of recipe.faceTiles(W, H)) tiles.push({ tile, faces: await look2(tile) });
    const faces = recipe.mergeFaces(whole, tiles, W, H);
    const outlines = recipe.leftToRight(
      faces.filter((f) => f.outlines).map((f) => ({
        bounds: [f.bounds[0] / W, f.bounds[1] / H, f.bounds[2] / W, f.bounds[3] / H],
        rings: recipe.partRings(f.outlines, part2)
      })).filter((f) => f.rings.length > 0)
    );
    if (outlines.length === 0) throw new Error(concepts.t("No face found in this photo for {{label}}", { label: label2 }));
    ctx.progress(0.9);
    return {
      kind: "mask",
      ref: "",
      width: W,
      height: H,
      label: label2,
      polygon: { part: part2, faces: outlines, face: null },
      ...req.into ? { into: { ...req.into } } : {}
    };
  }
  /**
   * A person's part: Selfie Multiclass on the photo, to find where the
   * person is, then on a square around them, its planes laid back where the
   * square came from. The part is kept where it beats the person's other
   * parts (a dark jumper read as some hair stays clothes) and hardened a
   * little: the model's edges are soft.
   */
  async part(ctx, req, target2, photoId, proxy, lens, segmenter) {
    const run2 = async (path2, input, withLens) => {
      try {
        const r = await this.engine.segment(
          {
            source: { Path: path2 },
            input,
            raw: null,
            gain_map: null,
            orientation: "Normal",
            lens: withLens,
            segmenter: { Classes: segmenter },
            upsample: UPSAMPLE,
            png: { compression: "Fast", filter: "Sub" },
            threads: source$1.BACKGROUND_THREADS,
            limits: source$1.READ_LIMITS,
            plane_longest: null
          },
          { signal: ctx.signal }
        );
        return r.planes.map((p) => ({ name: p.name, ...ops.grey8(Buffer.from(p.png)) }));
      } catch (err) {
        if (ctx.signal.aborted) throw new Cancelled$1();
        throw err;
      }
    };
    const label2 = concepts.t(pixlfile.SEGMENT_LABEL[target2]);
    const whole = await run2(proxy.path, proxy.input, lens);
    const { width: W, height: H } = whole[0];
    const box = personBox(whole, W, H);
    if (!box) throw new Error(concepts.t("No person found in this photo for {{label}}: try a brush", { label: label2 }));
    const sq = squareAround(box, W, H);
    let planes = whole;
    if (sq.side < 0.9 * Math.min(W, H)) {
      const cropPath = path.join(index$1.paths.photoCache(photoId), `parts-${process.pid}-${Date.now()}.tiff`);
      try {
        await this.engine.convert({
          ...source$1.blankRequest(proxy.path, cropPath, proxy.input),
          lens,
          pixel: { depth: proxy.float ? "F32" : "Sixteen", channels: 3 },
          encode: { Tiff: { compression: "None" } },
          metadata: { exif: false, icc: true, xmp: false, iptc: false },
          color: "Preserve",
          framing: {
            orientation: "Normal",
            rotate_degrees: 0,
            rotate_resampler: "Lanczos3",
            crop: { x: sq.x / W, y: sq.y / H, width: sq.side / W, height: sq.side / H }
          },
          threads: source$1.BACKGROUND_THREADS
        });
        const near = await run2(cropPath, "Tiff", null);
        planes = near.map((p) => ({ ...p, data: pasted(p, sq, W, H), width: W, height: H }));
      } finally {
        await promises.unlink(cropPath).catch(() => void 0);
      }
    }
    ctx.stage("refine", 0, concepts.t("Refining the edges"));
    const grey = partPlane(planes, PART_PLANES[target2], W * H);
    let any2 = false;
    for (let i = 0; i < grey.length && !any2; i++) any2 = grey[i] >= 128;
    if (!any2)
      throw new Error(concepts.t("No {{label}} found in this photo", { label: label2.toLowerCase() }));
    pixlfile.hardenPlane(grey, 0.5, 3);
    ctx.progress(0.8);
    const png2 = ops.encodeGreyPng(grey, W, H).toString("base64");
    const ref = pixlfile.planeRef(png2);
    this.planes.put(ref, png2);
    return {
      kind: "mask",
      ref,
      width: W,
      height: H,
      label: label2,
      source: { kind: "person", part: target2 },
      ...req.into ? { into: { ...req.into } } : {}
    };
  }
}
const making$1 = /* @__PURE__ */ new Map();
function ensureBase(engine2, row, info2, ask) {
  if (info2.input === "Raw") return ensureMaster(engine2, row, info2, ask);
  const stamp2 = source$1.versionStamp(row);
  const key = `${row.id}:${stamp2}`;
  let p = making$1.get(key);
  if (!p) {
    p = (async () => {
      const dir = index$1.paths.photoCache(row.id);
      const path$1 = path.join(dir, `base-${stamp2}.tiff`);
      const meta = `${path$1}.json`;
      if (await exists(path$1) && await exists(meta))
        return JSON.parse(await promises.readFile(meta, "utf8"));
      await promises.mkdir(dir, { recursive: true });
      const orientation = source$1.sourceOrientation(info2, null);
      const r = await engine2.convert({
        ...source$1.blankRequest(row.path, path$1, info2.input, info2),
        pixel: { depth: "Sixteen", channels: 3 },
        encode: { Tiff: { compression: "None" } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: "Preserve",
        framing: orientation === "Normal" ? null : { orientation, rotate_degrees: 0, rotate_resampler: "Lanczos3", crop: null },
        threads: source$1.BACKGROUND_THREADS
      });
      const out = { path: path$1, input: "Tiff", width: r.width, height: r.height };
      await promises.writeFile(meta, JSON.stringify(out));
      return out;
    })().finally(() => making$1.delete(key));
    making$1.set(key, p);
  }
  return p;
}
function pixelDeps(engine2, index2, row) {
  const key = pixlfile.keyOf(row.id, null);
  return {
    engine: engine2,
    cacheDir: index$1.paths.photoCache(row.id),
    blobFile: (hash, ext) => index2.blobFile(key, hash, ext),
    work: (job, transfer) => pixels.run(job, transfer)
  };
}
const TIFF$2 = { Tiff: { compression: "None" } };
const PNG = { Png: { compression: "Fast", filter: "Sub" } };
const ICC_ONLY$2 = { exif: false, icc: true, xmp: false, iptc: false };
function workingKey(version, steps) {
  return recipe.hash32(JSON.stringify([version, recipe.stackSignature(steps)])).toString(16);
}
const dirOf = (deps, key) => path.join(deps.cacheDir, `work-${key}`);
async function atomically(out, build2) {
  const tmp = out.replace(
    /(\.[a-z]+)$/,
    `.${process.pid}-${Math.random().toString(36).slice(2)}.part$1`
  );
  try {
    const r = await build2(tmp);
    await promises.rename(tmp, out);
    return r;
  } finally {
    await promises.rm(tmp, { force: true }).catch(() => void 0);
  }
}
const making = /* @__PURE__ */ new Map();
async function makeOnce(out, build2, byEngine = false) {
  if (await exists(out)) return;
  let p = making.get(out);
  if (!p) {
    p = (byEngine ? build2(out) : atomically(out, build2)).then(() => void 0).finally(() => making.delete(out));
    making.set(out, p);
  }
  await p;
}
async function stepImage(deps, step) {
  const out = path.join(deps.cacheDir, "blobs", `${step.blob}.png`);
  if (await exists(out)) return out;
  const jxl = await deps.blobFile(step.blob, "jxl");
  if (!jxl) throw new Error(`${step.label}: its image is missing from the project`);
  await promises.mkdir(path.join(deps.cacheDir, "blobs"), { recursive: true });
  await makeOnce(
    out,
    (tmp) => deps.engine.convert({
      ...source$1.blankRequest(jxl, tmp, "Jxl"),
      pixel: { depth: "Sixteen", channels: 3 },
      encode: PNG,
      metadata: ICC_ONLY$2,
      color: "Preserve",
      threads: source$1.BACKGROUND_THREADS
    }),
    true
  );
  return out;
}
async function overlaySource(deps, step) {
  const image = await stepImage(deps, step);
  if (!step.alpha) return image;
  const out = path.join(
    deps.cacheDir,
    "blobs",
    `${step.blob.slice(0, 24)}-${step.alpha.slice(0, 24)}.png`
  );
  if (await exists(out)) return out;
  const mask2 = await deps.blobFile(step.alpha, "png");
  if (!mask2) throw new Error(`${step.label}: its mask is missing from the project`);
  await deps.work({ op: "compose", image, mask: mask2, out });
  return out;
}
async function sized(deps, src, step, w, h) {
  if (w === step.width && h === step.height) return src;
  const out = src.replace(/\.png$/, `-${w}x${h}.png`);
  await makeOnce(
    out,
    (tmp) => deps.engine.convert({
      ...source$1.blankRequest(src, tmp, "Png"),
      resize: { Exact: { width: w, height: h } },
      resampler: "Lanczos3",
      // Downscaled in linear light, as the proxies are; alpha (a mask) kept.
      linear_resample: true,
      pixel: { depth: "Sixteen", channels: step.alpha ? 4 : 3 },
      encode: PNG,
      metadata: ICC_ONLY$2,
      color: "Preserve",
      threads: source$1.BACKGROUND_THREADS
    }),
    true
  );
  return out;
}
async function patchOverlay(deps, step, w, h) {
  const r = step.rect;
  const kx = w / step.width;
  const ky = h / step.height;
  const x0 = Math.max(0, Math.round(r.x * kx));
  const y0 = Math.max(0, Math.round(r.y * ky));
  const x1 = Math.min(w, x0 + Math.max(1, Math.round(r.w * kx)));
  const y1 = Math.min(h, y0 + Math.max(1, Math.round(r.h * ky)));
  const pw = x1 - x0;
  const ph2 = y1 - y0;
  if (pw < 1 || ph2 < 1) return null;
  const src = await deps.blobFile(step.blob, "png");
  if (!src) throw new Error(`${step.label}: its pixels are missing from the project`);
  let path2 = src;
  if (pw !== r.w || ph2 !== r.h) {
    path2 = src.replace(/\.png$/, `-${pw}x${ph2}.png`);
    await makeOnce(
      path2,
      (tmp) => deps.engine.convert({
        ...source$1.blankRequest(src, tmp, "Png"),
        resize: { Exact: { width: pw, height: ph2 } },
        resampler: "Lanczos3",
        pixel: { depth: "Sixteen", channels: 4 },
        encode: PNG,
        metadata: ICC_ONLY$2,
        color: "Preserve"
      }),
      true
    );
  }
  return {
    source: { Png: path2 },
    rect: { x: x0 / w, y: y0 / h, width: pw / w },
    opacity: Math.min(1, step.opacity / 100),
    blend: { mode: "Normal", space: "LinearWorking" },
    resampler: "Lanczos3"
  };
}
function guards(step) {
  return step.kind === "denoise" || step.kind === "enhance";
}
async function guardOf(deps, from) {
  if (!from.float) return null;
  const at = await promises.stat(from.path);
  const out = path.join(
    deps.cacheDir,
    "blobs",
    `guard-${recipe.hash32(`${from.path}:${at.size}:${at.mtimeMs}`).toString(36)}.png`
  );
  await promises.mkdir(path.join(deps.cacheDir, "blobs"), { recursive: true });
  await makeOnce(
    out,
    async (tmp) => {
      const r = await deps.engine.convert({
        ...source$1.blankRequest(from.path, "", from.input),
        sink: "Bytes",
        pixel: { depth: "F32", channels: 3 },
        encode: { Pixels: { sample: "F32" } },
        metadata: ICC_ONLY$2,
        color: "Preserve",
        threads: source$1.BACKGROUND_THREADS
      });
      const b = r.output;
      const own = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength && b.byteOffset % 4 === 0;
      const buf = own ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      const rgb2 = new Float32Array(buf);
      try {
        await deps.work({ op: "headroom", rgb: rgb2, w: r.width, h: r.height, out: tmp }, [buf]);
      } catch (err) {
        if (buf.byteLength === 0) throw err;
        await promises.writeFile(
          tmp,
          ops.encodeGreyPng(ops.headroomGuard(rgb2, r.width, r.height), r.width, r.height, 1)
        );
      }
    },
    true
  );
  return out;
}
async function modelInput(engine2, cacheDir, from, threads = source$1.BACKGROUND_THREADS) {
  if (!from.float) return from;
  const at = await promises.stat(from.path);
  const out = path.join(
    cacheDir,
    "blobs",
    `bounded-${recipe.hash32(`${from.path}:${at.size}:${at.mtimeMs}`).toString(36)}.tiff`
  );
  await promises.mkdir(path.join(cacheDir, "blobs"), { recursive: true });
  await makeOnce(
    out,
    (to) => engine2.convert({
      ...source$1.blankRequest(from.path, to, from.input),
      pixel: { depth: "Sixteen", channels: 3 },
      encode: { Tiff: { compression: "None" } },
      metadata: ICC_ONLY$2,
      color: "Preserve",
      threads
    }),
    true
  );
  return { path: out, input: "Tiff", width: from.width, height: from.height };
}
async function guarded(deps, src, guard, at) {
  const g = guard.match(/guard-([0-9a-z]+)\.png$/)?.[1] ?? "g";
  const out = src.replace(/\.png$/, `-g${g}-${at.x}-${at.y}.png`);
  await makeOnce(out, (tmp) => deps.work({ op: "guard", src, guard, out: tmp, at }));
  return out;
}
async function overlaysOf(deps, steps, w, h, guard = null) {
  const out = [];
  for (const s of steps) {
    if (s.opacity <= 0) continue;
    if (s.rect) {
      const o = await patchOverlay(deps, s, w, h);
      if (o) out.push(o);
      continue;
    }
    const src = await sized(deps, await overlaySource(deps, s), s, w, h);
    out.push({
      source: { Png: guard && guards(s) ? await guarded(deps, src, guard, { x: 0, y: 0 }) : src },
      rect: { x: 0, y: 0, width: 1 },
      opacity: Math.min(1, s.opacity / 100),
      // In linear light, as light mixes; a step at 100% replaces exactly.
      blend: { mode: "Normal", space: "LinearWorking" },
      resampler: "Lanczos3"
    });
  }
  return out;
}
async function layOn(deps, from, out, steps) {
  const guard = steps.some(guards) ? await guardOf(deps, from) : null;
  const overlays = await overlaysOf(deps, steps, from.width, from.height, guard);
  const r = await deps.engine.convert({
    ...source$1.blankRequest(from.path, out, from.input),
    pixel: { depth: from.float ? "F32" : "Sixteen", channels: 3 },
    encode: TIFF$2,
    metadata: ICC_ONLY$2,
    color: "Preserve",
    // Every step at 0%: nothing to lay on (the engine refuses an empty list).
    overlays: overlays.length > 0 ? overlays : null,
    threads: source$1.BACKGROUND_THREADS
  });
  return {
    path: out,
    input: "Tiff",
    width: r.width,
    height: r.height,
    ...from.float ? { float: true } : {}
  };
}
function frameOf(steps, width, height) {
  const last2 = steps.findLast((s) => s.params.resizes === true && s.opacity > 0);
  return last2 ? { width: last2.width, height: last2.height } : { width, height };
}
async function resized(deps, from, out, w, h) {
  await deps.engine.convert({
    ...source$1.blankRequest(from.path, out, from.input),
    resize: { Exact: { width: w, height: h } },
    resampler: "Lanczos3",
    pixel: { depth: from.float ? "F32" : "Sixteen", channels: 3 },
    encode: TIFF$2,
    metadata: ICC_ONLY$2,
    color: "Preserve",
    threads: source$1.BACKGROUND_THREADS
  });
  return { path: out, input: "Tiff", width: w, height: h, ...from.float ? { float: true } : {} };
}
const buildingProxies = /* @__PURE__ */ new Map();
const buildingMaster = /* @__PURE__ */ new Map();
function once(map2, flight, build2) {
  let p = map2.get(flight);
  if (!p) {
    p = build2().finally(() => map2.delete(flight));
    map2.set(flight, p);
  }
  return p;
}
function ensureWorking(deps, version, plain, steps, base) {
  const key = workingKey(version, steps);
  const flight = `${deps.cacheDir}:${key}`;
  const proxies = once(buildingProxies, flight, () => makeProxies(deps, version, key, plain, steps));
  if (!base) return proxies;
  return once(
    buildingMaster,
    flight,
    () => proxies.then((set) => makeMaster(deps, version, key, steps, base, set))
  );
}
function previousSet(deps, version, steps) {
  return steps.length > 1 && !steps[steps.length - 1].params.resizes ? findSet(deps, workingKey(version, steps.slice(0, -1))) : Promise.resolve(null);
}
async function makeProxies(deps, version, key, plain, steps) {
  if (steps.length === 0) return { key, px: plain, master: null };
  const made = await findSet(deps, key);
  if (made) return made;
  const dir = dirOf(deps, key);
  await promises.mkdir(dir, { recursive: true });
  const frame = frameOf(steps, plain.frameWidth, plain.frameHeight);
  const prev = await previousSet(deps, version, steps);
  const last2 = steps[steps.length - 1];
  let set;
  if (prev) {
    const [proxy, draft] = await Promise.all([
      layOn(deps, prev.px.proxy, path.join(dir, "proxy.tiff"), [last2]),
      layOn(deps, prev.px.draft, path.join(dir, "draft.tiff"), [last2])
    ]);
    set = { key, px: { ...prev.px, proxy, draft }, master: null };
  } else {
    const [proxy, draft] = await Promise.all([
      layOn(deps, plain.proxy, path.join(dir, "proxy.tiff"), steps),
      layOn(deps, plain.draft, path.join(dir, "draft.tiff"), steps)
    ]);
    set = {
      key,
      px: { proxy, draft, frameWidth: frame.width, frameHeight: frame.height },
      master: null
    };
  }
  await writeSet(deps, set);
  await prune(deps, key, plain.proxy.float === true);
  return set;
}
async function makeMaster(deps, version, key, steps, base, set) {
  if (steps.length === 0) return { ...set, master: await base() };
  const from = await base();
  if (set.master && set.masterOf === from.path) {
    traceRegion({ step: "working master", reused: true, steps: steps.length });
    return set;
  }
  const t0 = Date.now();
  const dir = dirOf(deps, key);
  await promises.mkdir(dir, { recursive: true });
  const prev = await previousSet(deps, version, steps);
  const last2 = steps[steps.length - 1];
  let master;
  if (prev?.master && prev.masterOf === from.path) {
    master = await layOn(deps, prev.master, path.join(dir, "master.tiff"), [last2]);
  } else {
    const frame = frameOf(steps, from.width, from.height);
    const start = from.width === frame.width && from.height === frame.height ? from : await resized(deps, from, path.join(dir, "base.tiff"), frame.width, frame.height);
    master = await layOn(deps, start, path.join(dir, "master.tiff"), steps);
  }
  const next = { ...set, master, masterOf: from.path };
  await writeSet(deps, next);
  traceRegion({ step: "working master", reused: false, steps: steps.length, ms: Date.now() - t0 });
  return next;
}
async function writeSet(deps, set) {
  await atomically(
    path.join(dirOf(deps, set.key), "set.json"),
    (tmp) => promises.writeFile(tmp, JSON.stringify(set))
  );
}
async function findSet(deps, key) {
  const meta = path.join(dirOf(deps, key), "set.json");
  if (!await exists(meta)) return null;
  const set = JSON.parse(await promises.readFile(meta, "utf8"));
  return await filesThere(set) ? set : null;
}
async function filesThere(set) {
  for (const f of [set.px.proxy.path, set.px.draft.path, ...set.master ? [set.master.path] : []])
    if (!await exists(f)) return false;
  return true;
}
const KEEP = 4;
const KEEP_FLOAT = 2;
async function prune(deps, keepKey, float = false) {
  const others = (await promises.readdir(deps.cacheDir).catch(() => [])).filter(
    (d) => d.startsWith("work-") && d !== `work-${keepKey}`
  );
  const dated = await Promise.all(
    others.map(async (d) => ({
      d,
      t: (await promises.stat(path.join(deps.cacheDir, d)).catch(() => null))?.mtimeMs ?? 0
    }))
  );
  dated.sort((a, b) => b.t - a.t);
  for (const { d } of dated.slice(float ? KEEP_FLOAT : KEEP))
    await promises.rm(path.join(deps.cacheDir, d), { recursive: true, force: true });
}
const MAP_EDGE = 1024;
function moves(lens) {
  return !!lens?.distortion;
}
async function lensMap(deps, lens, width, height) {
  const geometry = {
    distortion: lens.distortion,
    lateral_ca: null,
    vignetting: null,
    outside: lens.outside ?? "Crop",
    resampler: "Bilinear"
  };
  const dir = path.join(deps.cacheDir, "lensmaps");
  const key = recipe.hash32(JSON.stringify([geometry, width, height])).toString(16);
  const out = path.join(dir, `map-${key}.png`);
  if (await exists(out)) return out;
  await promises.mkdir(dir, { recursive: true });
  const k = Math.min(1, MAP_EDGE / Math.max(width, height));
  const w = Math.max(2, Math.round(width * k));
  const h = Math.max(2, Math.round(height * k));
  const ramp = path.join(dir, `ramp-${w}x${h}.png`);
  await makeOnce(ramp, (tmp) => deps.work({ op: "ramp", file: tmp, w, h }));
  await makeOnce(
    out,
    (tmp) => deps.engine.convert({
      ...source$1.blankRequest(ramp, tmp, "Png"),
      pixel: { depth: "Sixteen", channels: 3 },
      encode: { Png: { compression: "Fast", filter: "Sub" } },
      // Numbers, not colours: nothing may touch them.
      metadata: { exif: false, icc: false, xmp: false, iptc: false },
      color: "Preserve",
      lens: geometry
    }),
    true
  );
  return out;
}
function onSourceFrame(recipe$1) {
  return {
    ...recipe$1,
    geometry: {
      ...recipe$1.geometry,
      quarterTurns: 0,
      flipHorizontal: false,
      straighten: 0,
      crop: null,
      aspect: null,
      upright: recipe.defaultUpright()
    }
  };
}
async function freezeMask(deps, ctx, recipe$1, layerId) {
  const r = onSourceFrame(recipe$1);
  const { master } = ctx;
  const { user } = pixlfile.orientedFrame(r, master.width, master.height);
  const compiled = pixlfile.compile(r, {
    isRaw: ctx.isRaw,
    asShot: ctx.asShot,
    sourceOrientation: "Normal",
    frameWidth: master.width,
    frameHeight: master.height,
    scale: 1,
    seed: ctx.seed,
    brushPaths: await brushPlanes(ctx.photoId, r, user),
    applyCrop: false
  });
  const index2 = compiled.layerIndex[layerId];
  if (index2 === void 0 || !compiled.grade) return null;
  const stamp2 = recipe.newId();
  const drawn = path.join(deps.cacheDir, `freeze-${stamp2}.png`);
  await deps.engine.convert({
    ...source$1.blankRequest(master.path, drawn, master.input),
    pixel: { depth: "Eight", channels: 1 },
    encode: { Png: { compression: "Fast", filter: "Sub" } },
    metadata: source$1.STRIP_ALL,
    color: "Preserve",
    grade: compiled.grade,
    framing: null,
    lens: compiled.lens,
    // Spots move pixels too, but not where they are: the mask is unaffected.
    retouch: null,
    inspect: { LayerMask: { layer: index2 } },
    threads: source$1.BACKGROUND_THREADS
  });
  if (!moves(compiled.lens)) return drawn;
  const map2 = await lensMap(deps, compiled.lens, master.width, master.height);
  const out = path.join(deps.cacheDir, `freeze-${stamp2}-source.png`);
  await deps.work({ op: "unwarp", mask: drawn, map: map2, w: master.width, h: master.height, out });
  return out;
}
async function addPixelStep(library, sessions2, key, step, basedOn) {
  const live = sessions2?.liveRecipe(key);
  if (live && sessions2) {
    sessions2.update(key, { ...live, pixels: recipe.placeStep(live.pixels, step, basedOn) }, false);
    await sessions2.flush(key);
    await sessions2.workingReady(key);
    return;
  }
  const saved = await library.recipe(key);
  await library.saveRecipe(key, { ...saved, pixels: recipe.placeStep(saved.pixels, step, basedOn) });
}
async function replacePixelStep(library, sessions2, key, step) {
  const live = sessions2?.liveRecipe(key);
  if (live && sessions2) {
    sessions2.update(key, { ...live, pixels: recipe.replaceStep(live.pixels, step) }, false);
    await sessions2.flush(key);
    await sessions2.workingReady(key);
    return;
  }
  const saved = await library.recipe(key);
  await library.saveRecipe(key, { ...saved, pixels: recipe.replaceStep(saved.pixels, step) });
}
async function storesLossless(isRaw, setting2) {
  return isRaw || await setting2().catch(() => null) === true;
}
const DENOISE_SHORT = {
  "nafnet-sidd-w32": "NAFNet",
  "drunet-color": "DRUNet"
};
const LOSSLESS_KEY = "pixels.lossless";
async function enhancer(models2, model, cpu) {
  if (!await models2.installed(model)) throw new ModelMissing(models2.entry(model));
  const ref = await models2.ref(model, cpu ? "Cpu" : void 0, {
    // DRUNet is told the noise: the engine measures it on each tile's input,
    // luma σ scaled to the per-channel σ the model wants.
    noise: { MeasuredNoise: { gain: 1.33 } }
  });
  return { ...ref, strength: 1 };
}
const TIFF$1 = { Tiff: { compression: "None" } };
const ICC_ONLY$1 = { exif: false, icc: true, xmp: false, iptc: false };
async function denoise$1(engine2, models2, model, from, out, signal, threads) {
  const input = await modelInput(engine2, path.dirname(out), from, threads);
  const r = await models2.withCpuFallback(
    [model],
    async (onCpu) => engine2.convert(
      {
        ...source$1.blankRequest(input.path, out, input.input),
        enhance: [{ Model: await enhancer(models2, model, onCpu.has(model)) }],
        pixel: { depth: "Sixteen", channels: 3 },
        encode: TIFF$1,
        metadata: ICC_ONLY$1,
        color: "Preserve",
        threads
      },
      { signal }
    ),
    signal
  );
  return { path: out, input: "Tiff", width: r.width, height: r.height };
}
async function legacyMaster(dir, version, model, strength, frame) {
  const key = recipe.hash32(JSON.stringify([version, model, Math.round(strength)])).toString(16);
  const meta = path.join(dir, `denoise-${key}`, "set.json");
  try {
    const set = JSON.parse(await promises.readFile(meta, "utf8"));
    const m = set.master;
    if (!m || m.width !== frame.width || m.height !== frame.height) return null;
    return await exists(m.path) ? m.path : null;
  } catch {
    return null;
  }
}
const RATE_KEY$1 = DENOISE_RATE_KEY;
const FIRST_GUESS_MS_PER_MP = {
  // CoreML with static shapes: 15.2 s at 24 MP on an M2 Pro (engine 0.19); the M1 is unmeasured.
  "nafnet-sidd-w32": 1200,
  "drunet-color": 9e3
};
class DenoiseRunner {
  constructor(library, engine2, models2, settings2, sessions2) {
    this.library = library;
    this.engine = engine2;
    this.models = models2;
    this.settings = settings2;
    this.sessions = sessions2;
  }
  library;
  engine;
  models;
  settings;
  sessions;
  task = "denoise";
  stages() {
    return [
      { id: "model", label: concepts.t("Model"), weight: 0.05 },
      { id: "preview", label: concepts.t("Preview"), weight: 0.15 },
      { id: "full", label: concepts.t("Full resolution"), weight: 0.7 },
      { id: "save", label: concepts.t("Save"), weight: 0.1 }
    ];
  }
  title(req) {
    return {
      title: req.redo ? concepts.t("Remaking a denoise on the new RAW develop") : concepts.t("Denoising"),
      subject: DENOISE_SHORT[recipe.aiDenoiseModel(req.model)]
    };
  }
  async run(ctx, asked) {
    const req = { ...asked, model: recipe.aiDenoiseModel(asked.model) };
    const sessions2 = this.sessions();
    const row = await this.library.photoRow(req.key);
    const info2 = await this.library.probe(row);
    const recipe$1 = sessions2?.liveRecipe(req.key) ?? await this.library.recipe(req.key);
    const old = req.redo ? recipe$1.pixels.find((p) => p.id === req.redo && p.kind === "denoise") : void 0;
    if (req.redo && !old) throw new Error(concepts.t("the step is gone"));
    const before2 = old ? recipe$1.pixels.slice(0, recipe$1.pixels.indexOf(old)) : recipe$1.pixels;
    const layer = req.layerId && !old ? recipe$1.layers.find((l) => l.id === req.layerId) : void 0;
    if (req.layerId && !old && !layer) throw new Error(concepts.t("the mask is gone"));
    ctx.stage("model", 0, concepts.t("Loading {{model}}", { model: modelName(this.models.entry(req.model)) }));
    const refused = recipe.pixelStepRefusal(info2);
    if (refused) throw new Error(refused);
    if (!await this.models.installed(req.model))
      throw new ModelMissing(this.models.entry(req.model));
    if (this.engine.getStatus().status === "starting") {
      this.engine.start();
      await this.engine.whenStarted();
    }
    const guard = (p) => p.catch((err) => {
      if (ctx.signal.aborted) throw new Cancelled$1();
      throw err;
    });
    const tick = (expected) => {
      const t0 = Date.now();
      const timer2 = setInterval(() => ctx.progress(pixlfile.estimate(Date.now() - t0, expected), true), 250);
      return () => clearInterval(timer2);
    };
    const deps = pixelDeps(this.engine, this.library.index, row);
    const plain = await ensureProxies(this.engine, row, info2, source$1.BACKGROUND_THREADS);
    const working2 = await guard(
      ensureWorking(
        deps,
        source$1.versionStamp(row),
        plain,
        before2,
        () => ensureBase(this.engine, row, info2, askOf(recipe$1))
      )
    );
    const master = working2.master;
    const dir = index$1.paths.photoCache(row.id);
    const stamp2 = Date.now().toString(36);
    const rate2 = await this.rate(req.model);
    const files = [];
    try {
      if (!layer && !old && sessions2) {
        ctx.stage("preview", 0, concepts.t("Denoising a preview"));
        const draft = working2.px.draft;
        const stop = tick(Math.max(1500, draft.width * draft.height / 1e6 * rate2));
        try {
          const out = path.join(dir, `denoise-preview-${stamp2}.tiff`);
          files.push(out);
          const preview2 = await guard(
            denoise$1(this.engine, this.models, req.model, draft, out, ctx.signal, source$1.BACKGROUND_THREADS)
          );
          sessions2.pixelPreview(req.key, preview2);
        } finally {
          stop();
        }
      }
      ctx.stage("full", 0, concepts.t("Denoising at full resolution"));
      const mp = master.width * master.height / 1e6;
      const kept = req.legacy && recipe$1.pixels.length === 0 ? await legacyMaster(dir, source$1.versionStamp(row), asked.model, req.strength, master) ?? (req.model === "nafnet-sidd-w32" ? await legacyMaster(dir, source$1.versionStamp(row), recipe.RETIRED_DENOISE, req.strength, master) : null) : null;
      const result = kept ?? path.join(dir, `denoise-${stamp2}.tiff`);
      if (!kept) {
        files.push(result);
        const stop = tick(Math.max(3e3, mp * rate2));
        const t0 = Date.now();
        try {
          await guard(
            denoise$1(this.engine, this.models, req.model, master, result, ctx.signal, source$1.heavyThreads())
          );
        } finally {
          stop();
        }
        void this.remember(
          req.model,
          Math.round(0.6 * ((Date.now() - t0) / Math.max(0.1, mp)) + 0.4 * rate2)
        );
      }
      ctx.stage("save", 0, concepts.t("Keeping it in the project"));
      const lossless = await storesLossless(
        row.is_raw === 1,
        () => this.settings.getSetting(LOSSLESS_KEY)
      );
      const jxl = path.join(dir, `denoise-${stamp2}.jxl`);
      files.push(jxl);
      await this.engine.convert(
        {
          ...source$1.blankRequest(result, jxl, "Tiff"),
          pixel: { depth: "Sixteen", channels: 3 },
          encode: lossless ? { JxlLossless: { effort: 3, threads: source$1.heavyThreads() } } : { JxlLossy: { distance: 0.1, effort: 5, threads: source$1.heavyThreads() } },
          metadata: ICC_ONLY$1,
          color: "Preserve"
        },
        { signal: ctx.signal }
      );
      const key = pixlfile.keyOf(row.id, null);
      const blob = await this.library.index.putBlob(key, jxl, {
        kind: "pixels",
        codec: lossless ? "jxl-lossless" : "jxl",
        width: master.width,
        height: master.height
      });
      ctx.progress(0.5);
      let alpha = old?.alpha ?? null;
      if (layer) {
        const plane = await freezeMask(
          deps,
          {
            photoId: row.id,
            isRaw: row.is_raw === 1,
            asShot: info2.as_shot_white,
            seed: source$1.seedOf(row),
            master
          },
          recipe$1,
          layer.id
        );
        if (!plane) throw new Error(concepts.t("{{name}} selects nothing", { name: layer.name }));
        files.push(plane);
        alpha = await this.library.index.putBlob(key, plane, {
          kind: "mask",
          codec: "png",
          width: master.width,
          height: master.height
        });
      }
      const name = DENOISE_SHORT[req.model];
      const develop2 = row.is_raw === 1 ? { develop: source$1.developMark(source$1.colourOf(row)) } : {};
      if (old) {
        const again = {
          ...old,
          blob,
          width: master.width,
          height: master.height,
          params: { ...old.params, model: req.model, lossless, ...develop2 }
        };
        ctx.commit();
        await replacePixelStep(this.library, sessions2, req.key, again);
        const { photoId: photoId2, copyId: copyId2 } = pixlfile.parseKey(req.key);
        this.library.queueThumb(photoId2, copyId2, true);
        return { kind: "step", label: again.label };
      }
      const step = {
        id: recipe.newId(),
        kind: "denoise",
        label: layer ? concepts.t("AI Denoise · {{model}} in {{mask}}", { model: name, mask: layer.name }) : concepts.t("AI Denoise · {{model}}", { model: name }),
        blob,
        alpha,
        scope: layer?.name ?? null,
        // The old setting's result has its strength in it already.
        opacity: kept ? 100 : Math.max(1, Math.min(100, Math.round(req.strength))),
        width: master.width,
        height: master.height,
        rect: null,
        params: { model: req.model, lossless, ...develop2 }
      };
      ctx.commit();
      await addPixelStep(
        this.library,
        this.sessions(),
        req.key,
        step,
        recipe$1.pixels.map((s) => s.id)
      );
      const { photoId, copyId } = pixlfile.parseKey(req.key);
      this.library.queueThumb(photoId, copyId, true);
      return { kind: "step", label: step.label };
    } finally {
      await sessions2?.clearPreview(req.key).catch(() => void 0);
      for (const f of files) await promises.rm(f, { force: true }).catch(() => void 0);
    }
  }
  async rate(model) {
    const all2 = await this.settings.getSetting(RATE_KEY$1).catch(() => null);
    const r = all2 && typeof all2 === "object" ? all2[model] : void 0;
    return typeof r === "number" && r > 0 ? r : FIRST_GUESS_MS_PER_MP[model] ?? 6e3;
  }
  async remember(model, msPerMp) {
    const all2 = await this.settings.getSetting(RATE_KEY$1).catch(() => null);
    const next = { ...all2 && typeof all2 === "object" ? all2 : {}, [model]: msPerMp };
    await this.settings.setSetting(RATE_KEY$1, next).catch(() => void 0);
  }
}
const REFERENCE_WHITE = 203;
const MIN_HEADROOM = 1.05;
const num = (v, def, lo, hi) => typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
function normaliseDisplaySetting(v) {
  const o = v && typeof v === "object" ? v : {};
  const whiteNits = num(o.whiteNits, REFERENCE_WHITE, 80, 500);
  return {
    mode: o.mode === "stated" ? "stated" : "auto",
    whiteNits,
    peakNits: num(o.peakNits, 1e3, 100, 1e4)
  };
}
function resolveDisplay(setting2, screen) {
  if (setting2.mode === "stated") {
    const headroom = setting2.peakNits / setting2.whiteNits;
    return {
      hdr: headroom >= MIN_HEADROOM,
      whiteNits: setting2.whiteNits,
      peakNits: setting2.peakNits,
      headroom: round$1(headroom),
      potential: null,
      source: "stated"
    };
  }
  if (screen && Number.isFinite(screen.current) && screen.current > 0) {
    const headroom = round$1(Math.max(1, screen.current));
    return {
      hdr: headroom >= MIN_HEADROOM,
      whiteNits: REFERENCE_WHITE,
      peakNits: round$1(REFERENCE_WHITE * headroom),
      headroom,
      potential: Number.isFinite(screen.potential) ? round$1(screen.potential) : null,
      source: "screen"
    };
  }
  return {
    hdr: false,
    whiteNits: REFERENCE_WHITE,
    peakNits: REFERENCE_WHITE,
    headroom: 1,
    potential: null,
    source: "none"
  };
}
const round$1 = (v) => Math.round(v * 100) / 100;
function displayChanged(a, b) {
  return !a || a.hdr !== b.hdr || a.source !== b.source || Math.abs(a.headroom - b.headroom) >= 0.05 || a.whiteNits !== b.whiteNits;
}
const DISPLAY_SETTING_KEY = "display.hdr";
let reader;
function nativeReader() {
  if (reader !== void 0) return reader;
  reader = null;
  if (process.platform !== "darwin") return reader;
  const files = electron.app.isPackaged ? [path.join(process.resourcesPath, "native", "display.node")] : [
    path.join(electron.app.getAppPath(), "build", "native", "display.node"),
    path.join(__dirname, "..", "..", "build", "native", "display.node"),
    path.join(process.cwd(), "build", "native", "display.node")
  ];
  for (const file of files) {
    try {
      reader = module$1.createRequire(__filename)(file);
      return reader;
    } catch {
    }
  }
  log.warn("display reader not loaded (stated values only)", files.join(", "));
  return reader;
}
let setting = normaliseDisplaySetting(null);
let last = null;
let win = null;
function read() {
  const r = nativeReader();
  let measured = null;
  if (r && win && !win.isDestroyed()) {
    try {
      const id = electron.screen.getDisplayMatching(win.getBounds()).id;
      measured = r.headroom(id);
    } catch (err) {
      log.warn("display headroom not read", err.message);
    }
  }
  return resolveDisplay(setting, measured);
}
function publish() {
  const next = read();
  if (!displayChanged(last, next)) return;
  last = next;
  for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(index$1.IPC.app.displayHdrChanged, next);
}
function displayHdr() {
  return last ??= read();
}
function setDisplaySetting(v) {
  setting = normaliseDisplaySetting(v);
  last = null;
  publish();
  return displayHdr();
}
function watchDisplayHdr(w, stored) {
  win = w;
  setting = normaliseDisplaySetting(stored);
  const again = () => publish();
  w.on("moved", again);
  electron.screen.on("display-metrics-changed", again);
  electron.screen.on("display-added", again);
  electron.screen.on("display-removed", again);
  if (process.platform === "darwin" && nativeReader()) {
    const t = setInterval(again, 2e3);
    t.unref();
    w.on("closed", () => clearInterval(t));
  }
  publish();
}
const INPAINTER_MODEL = "migan-512";
let source = null;
function setInpainter(f) {
  source = f;
}
async function inpainterRef() {
  return source ? source() : null;
}
const TIFF = { Tiff: { compression: "None" } };
const ICC_ONLY = { exif: false, icc: true, xmp: false, iptc: false };
function enhanceAvailability(status) {
  if (status.enhance !== true)
    return { available: false, reason: concepts.t("this build of the engine runs no models") };
  if (!status.runtime)
    return { available: false, reason: concepts.t("this build of the engine ships no ONNX Runtime") };
  return { available: true };
}
const RATE_KEY = ENHANCE_RATE_KEY;
async function enhanceRates(settings2) {
  const r = await settings2.getSetting(RATE_KEY).catch(() => null);
  return r && typeof r === "object" ? r : {};
}
async function chainOf(models2, steps, s, info2, onCpu) {
  const out = [];
  for (const p of steps) {
    if (p.kind === "reconstruct") {
      const sub = info2.jpeg?.subsampling;
      out.push({
        JpegReconstruct: {
          ...reconstructParams(s.smoothing),
          // Required exactly when the file subsamples chroma.
          chroma: sub === "Half" || sub === "Quarter" ? s.guidedChroma ? { LumaGuided: { radius: 2, epsilon: 1e-3 } } : "Triangle" : null
        }
      });
      continue;
    }
    const id = p.model;
    if (!await models2.installed(id)) throw new ModelMissing(models2.entry(id));
    const provider = onCpu.has(id) ? "Cpu" : void 0;
    if (p.scale) {
      out.push({ Upscale: await models2.ref(id, provider) });
      continue;
    }
    const ref = await models2.ref(id, provider, {});
    const strength = p.kind === "deblur" ? s.deblurStrength : s.jpegStrength;
    out.push({ Model: { ...ref, strength: Math.min(1, Math.max(0.01, strength / 100)) } });
  }
  return out;
}
class EnhanceRunner {
  constructor(library, engine2, status, models2, settings2, sessions2) {
    this.library = library;
    this.engine = engine2;
    this.status = status;
    this.models = models2;
    this.settings = settings2;
    this.sessions = sessions2;
  }
  library;
  engine;
  status;
  models;
  settings;
  sessions;
  task = "enhance";
  stages() {
    return [
      { id: "model", label: concepts.t("Model"), weight: 0.06 },
      { id: "enhance", label: concepts.t("Enhance"), weight: 0.88 },
      { id: "save", label: concepts.t("Save"), weight: 0.06 }
    ];
  }
  title(req) {
    return { title: concepts.t("Enhancing"), subject: chainSubject(planSteps(req.settings, true)) };
  }
  async run(ctx, req) {
    const { key, settings: settings2 } = req;
    ctx.stage("model", 0, concepts.t("Checking the models"));
    const avail = enhanceAvailability(this.status());
    if (!avail.available) throw new Error(avail.reason ?? concepts.t("unavailable"));
    const sessions2 = this.sessions();
    const row = await this.library.photoRow(key);
    const info2 = await this.library.probe(row);
    const recipe$1 = sessions2?.liveRecipe(key) ?? await this.library.recipe(key);
    const isJpeg = info2.input === "Jpeg";
    const refused = enhanceRefusal(settings2, { isJpeg, isHdr: info2.is_hdr }) ?? jpegRestoreRefusal(settings2, isJpeg, recipe$1.pixels.length);
    if (refused) throw new Error(`${row.name}: ${refused}`);
    const steps = planSteps(settings2, isJpeg);
    const ids = steps.flatMap((p) => p.model ? [p.model] : []);
    for (const id of ids)
      if (!await this.models.installed(id)) throw new ModelMissing(this.models.entry(id));
    const k = scaleOf(settings2);
    const layer = req.layerId && k === 1 ? recipe$1.layers.find((l) => l.id === req.layerId) : void 0;
    if (req.layerId && k === 1 && !layer) throw new Error(concepts.t("the mask is gone"));
    if (this.engine.getStatus().status === "starting") {
      this.engine.start();
      await this.engine.whenStarted();
    }
    if (ctx.signal.aborted) throw new Cancelled$1();
    const deps = pixelDeps(this.engine, this.library.index, row);
    const restoresJpeg = steps.some((p) => p.kind === "reconstruct" || p.kind.startsWith("fbcnn"));
    const plain = await ensureProxies(this.engine, row, info2, source$1.BACKGROUND_THREADS);
    const working2 = await ensureWorking(
      deps,
      source$1.versionStamp(row),
      plain,
      recipe$1.pixels,
      () => ensureBase(this.engine, row, info2, askOf(recipe$1))
    );
    const master = working2.master;
    const dir = index$1.paths.photoCache(row.id);
    const stamp2 = Date.now().toString(36);
    const out = path.join(dir, `enhance-${stamp2}.tiff`);
    const files = [out];
    const convert = async (onCpu) => {
      const chain = await chainOf(this.models, steps, settings2, info2, onCpu);
      const common = {
        enhance: chain,
        pixel: { depth: "Sixteen", channels: 3 },
        encode: TIFF,
        metadata: ICC_ONLY,
        color: "Preserve",
        threads: source$1.heavyThreads(),
        // ×2 is the ×4 model brought down by half on the enlarged frame
        // (engine 0.18 retired its own ×2 model).
        ...k === 2 ? {
          resize: { Scale: { factor: 0.5 } },
          resampler: "Lanczos3",
          linear_resample: true
        } : {}
      };
      if (restoresJpeg) {
        const orientation = source$1.sourceOrientation(info2, null);
        return this.engine.convert(
          {
            ...source$1.blankRequest(row.path, out, info2.input, info2),
            ...common,
            framing: source$1.uprightFraming(orientation, info2)
          },
          { signal: ctx.signal }
        );
      }
      const input = await modelInput(this.engine, dir, master, source$1.heavyThreads());
      return this.engine.convert(
        { ...source$1.blankRequest(input.path, out, input.input), ...common },
        { signal: ctx.signal }
      );
    };
    const rates = await enhanceRates(this.settings);
    const expected = Math.max(1e3, estimateMs(steps, master.width, master.height, rates));
    const t0 = Date.now();
    ctx.stage("enhance", 0, `${chainSubject(steps)} · ${row.name}`);
    const tick = setInterval(() => ctx.progress(pixlfile.estimate(Date.now() - t0, expected), true), 250);
    try {
      let report;
      try {
        report = await this.models.withCpuFallback(ids, convert, ctx.signal);
      } catch (err) {
        if (ctx.signal.aborted) throw new Cancelled$1();
        throw err;
      } finally {
        clearInterval(tick);
      }
      if (ctx.signal.aborted) throw new Cancelled$1();
      void this.settings.setSetting(RATE_KEY, learnRates(steps, rates, Date.now() - t0, expected)).catch(() => {
      });
      ctx.stage("save", 0.1, concepts.t("Keeping it in the project"));
      const lossless = await storesLossless(
        row.is_raw === 1,
        () => this.settings.getSetting(LOSSLESS_KEY)
      );
      const jxl = path.join(dir, `enhance-${stamp2}.jxl`);
      files.push(jxl);
      await this.engine.convert(
        {
          ...source$1.blankRequest(out, jxl, "Tiff"),
          pixel: { depth: "Sixteen", channels: 3 },
          encode: lossless ? { JxlLossless: { effort: 3, threads: source$1.heavyThreads() } } : { JxlLossy: { distance: 0.1, effort: 5, threads: source$1.heavyThreads() } },
          metadata: ICC_ONLY,
          color: "Preserve"
        },
        { signal: ctx.signal }
      );
      const photoKey = pixlfile.keyOf(row.id, null);
      const blob = await this.library.index.putBlob(photoKey, jxl, {
        kind: "pixels",
        codec: lossless ? "jxl-lossless" : "jxl",
        width: report.width,
        height: report.height
      });
      let alpha = null;
      if (layer) {
        ctx.progress(0.6);
        const plane = await freezeMask(
          deps,
          {
            photoId: row.id,
            isRaw: row.is_raw === 1,
            asShot: info2.as_shot_white,
            seed: source$1.seedOf(row),
            master
          },
          recipe$1,
          layer.id
        );
        if (!plane) throw new Error(concepts.t("{{name}} selects nothing", { name: layer.name }));
        files.push(plane);
        alpha = await this.library.index.putBlob(photoKey, plane, {
          kind: "mask",
          codec: "png",
          width: master.width,
          height: master.height
        });
      }
      const subject = chainSubject(steps);
      const step = {
        id: recipe.newId(),
        kind: "enhance",
        label: layer ? concepts.t("Enhance · {{subject}} in {{mask}}", { subject, mask: layer.name }) : concepts.t("Enhance · {{subject}}", { subject }),
        blob,
        alpha,
        scope: layer?.name ?? null,
        opacity: 100,
        width: report.width,
        height: report.height,
        rect: null,
        params: {
          chain: subject,
          scale: k,
          resizes: k > 1,
          lossless,
          // Everything it was run with, so a later develop can make it again.
          settings: JSON.stringify(settings2),
          ...row.is_raw === 1 ? { develop: source$1.developMark(source$1.colourOf(row)) } : {}
        }
      };
      ctx.commit();
      await addPixelStep(
        this.library,
        sessions2,
        key,
        step,
        recipe$1.pixels.map((s) => s.id)
      );
      const { photoId, copyId } = pixlfile.parseKey(key);
      this.library.queueThumb(photoId, copyId, true);
      return { kind: "step", label: step.label };
    } catch (err) {
      if (!(err instanceof Cancelled$1)) log.warn("enhance failed", row.name, err);
      throw err;
    } finally {
      for (const f of files) await promises.rm(f, { force: true }).catch(() => void 0);
    }
  }
}
const clamp$1 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function placeMark(s, W, H, pw, ph2) {
  const short = Math.min(W, H);
  const aspect = ph2 / pw;
  let w = Math.max(1, Math.round(clamp$1(s.size, 1, 100) / 100 * short));
  w = Math.min(w, W - 2, Math.floor((H - 2) / aspect));
  w = Math.max(1, w);
  const h = Math.max(1, Math.round(w * ph2 / pw));
  const inset = Math.max(1, Math.round(clamp$1(s.inset, 0, 50) / 100 * short));
  const col = s.anchor.endsWith("l") ? 0 : s.anchor.endsWith("r") ? 2 : 1;
  const row = s.anchor.startsWith("t") ? 0 : s.anchor.startsWith("b") ? 2 : 1;
  const at = (n, total, size) => n === 0 ? inset : n === 2 ? total - inset - size : Math.round((total - size) / 2);
  return {
    x: clamp$1(at(col, W, w), 1, Math.max(1, W - w - 1)),
    y: clamp$1(at(row, H, h), 1, Math.max(1, H - h - 1)),
    width: w,
    height: h
  };
}
function blendSpace(hdr) {
  return {
    Encoded: {
      space: hdr ? "Rec2100Pq" : "Srgb",
      intent: "RelativeColorimetric",
      black_point_compensation: false
    }
  };
}
function watermarkOverlay(s, path2, W, H, pw, ph2, hdr) {
  const m = placeMark(s, W, H, pw, ph2);
  const blend = { mode: s.blend, space: blendSpace(hdr) };
  return {
    source: { Png: path2 },
    rect: { x: m.x / W, y: m.y / H, width: m.width / W },
    opacity: clamp$1(s.opacity / 100, 0, 1),
    blend,
    resampler: "Lanczos3"
  };
}
function pngSize(head) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (head.length < 24 || sig.some((b, i) => head[i] !== b)) return null;
  const u32 = (o) => (head[o] << 24 | head[o + 1] << 16 | head[o + 2] << 8 | head[o + 3]) >>> 0;
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
const FORMAT_EXT = {
  jpeg: "jpg",
  png: "png",
  tiff: "tif",
  webp: "webp",
  avif: "avif",
  jxl: "jxl"
};
function supportsGainMap(format) {
  return format === "jpeg" || format === "avif";
}
const PQ = { m1: 0.1593017578125, m2: 78.84375, c1: 0.8359375, c2: 18.8515625, c3: 18.6875 };
function pq(nits) {
  const y = Math.max(0, nits) / 1e4;
  const p = y ** PQ.m1;
  return ((PQ.c1 + PQ.c2 * p) / (1 + PQ.c3 * p)) ** PQ.m2;
}
function pqNits(e) {
  const p = Math.max(0, e) ** (1 / PQ.m2);
  return 1e4 * (Math.max(0, p - PQ.c1) / (PQ.c2 - PQ.c3 * p)) ** (1 / PQ.m1);
}
function rolloffKneeMax(peak, sourceMax) {
  const range = pq(sourceMax);
  const maxLum = pq(peak) / range;
  return pqNits(Math.max(0, 1.5 * maxLum - 0.5) * range);
}
const ROLLOFF_REACH = 4;
function hdrLimit(s, peak) {
  if (s.hdr.limit !== "rolloff") return "Clip";
  const sourceMax = Math.min(1e4, peak * ROLLOFF_REACH);
  if (!(sourceMax > peak)) return "Clip";
  const max2 = rolloffKneeMax(peak, sourceMax);
  const knee = Math.floor(max2 * Math.min(1, Math.max(0.1, s.hdr.knee / 100)));
  return knee > 0 ? { Rolloff: { knee_nits: knee, source_max_nits: Math.round(sourceMax) } } : "Clip";
}
const CEILING_MIN = 203;
const CEILING_MAX = 1e4;
function masterPolicy(s, src) {
  if (!s.hdr.pixl) return null;
  if (!src.isHdr && !src.hasGainMap) return null;
  if (src.hasGainMap && src.editsBase) return null;
  let headroom;
  if (s.hdr.mode === "gainmap" && supportsGainMap(s.format)) headroom = true;
  else if (s.hdr.mode === "keep" && (s.format === "jxl" || s.format === "png")) headroom = true;
  else if (s.hdr.mode === "sdr" && s.colorSpace === "DisplayP3") headroom = false;
  else return null;
  const ceiling = s.hdr.ceiling === null ? "Peak" : { Nits: Math.min(CEILING_MAX, Math.max(CEILING_MIN, Math.round(s.hdr.ceiling))) };
  return {
    headroom,
    // The 99.9th percentile of the render; a region would state it (not used by an export).
    peak: "Measured",
    ceiling: headroom ? ceiling : null,
    reach: "Measured",
    // PIXL's look acts on a RAW developed in Scene; an HDR source here is never one.
    look: "Colorimetric",
    // 0.17's bytes: a float sink gets linear PixlRGB, and no SDR companion.
    float: "LinearPixlRgb",
    companion: null
  };
}
function sdrRendition(s, peak) {
  return {
    to: s.colorSpace,
    operator: s.hdr.operator,
    mode: "PerChannel",
    source_peak_nits: peak,
    target_peak_nits: s.hdr.targetPeak,
    gamut: s.hdr.gamut,
    intent: s.intent,
    black_point_compensation: s.blackPointCompensation,
    grade: null
  };
}
function gainMapEncode(s, peak) {
  const stops = Math.max(0.5, Math.log2(peak / s.hdr.targetPeak));
  return {
    scale: 2,
    channels: 1,
    quality: Math.round(Math.min(100, Math.max(1, s.hdr.gainMapQuality))),
    gamma: 1,
    offset_sdr: 1 / 64,
    offset_hdr: 1 / 64,
    gain_min_log2: -0.5,
    gain_max_log2: Math.round(stops * 1e3) / 1e3,
    hdr_capacity_min: 0,
    hdr_capacity_max: Math.round(stops * 1e3) / 1e3
  };
}
function withGainMap(encode, map2) {
  if (typeof encode !== "object") return encode;
  if ("Jpeg" in encode) return { Jpeg: { ...encode.Jpeg, gain_map: map2 } };
  if ("Avif" in encode) return { Avif: { ...encode.Avif, gain_map: map2 } };
  return encode;
}
function supportsHdr(format) {
  return format === "avif" || format === "jxl" || format === "png";
}
function heifMatrix(s, hdrOut) {
  if (s.lossless) return "Identity";
  if (hdrOut || s.colorSpace === "Rec2020") return "Bt2020Ncl";
  return "Bt601";
}
function buildEncode(s, threads, hdrOut = false) {
  const deep = s.bitDepth > 8 || hdrOut;
  const heifBits = hdrOut ? Math.max(10, s.bitDepth) : s.bitDepth;
  switch (s.format) {
    case "jpeg":
      return {
        encode: { Jpeg: { quality: s.quality, subsampling: s.jpegSubsampling, optimize: true } },
        depth: "Eight"
      };
    case "png":
      return {
        encode: { Png: { compression: s.pngCompression, filter: "Adaptive" } },
        depth: deep ? "Sixteen" : "Eight"
      };
    case "tiff":
      return {
        encode: { Tiff: { compression: s.tiffCompression } },
        depth: deep ? "Sixteen" : "Eight"
      };
    case "webp":
      return {
        encode: { WebP: { quality: s.quality, lossless: s.webpLossless, method: s.webpMethod } },
        depth: "Eight"
      };
    case "avif":
      return {
        encode: {
          Avif: {
            quality: s.quality,
            lossless: s.lossless,
            bit_depth: heifBits,
            chroma: s.lossless ? "Full" : s.chroma,
            // The aom plug-in never took 10 (engine 0.17 refuses it).
            speed: Math.min(9, Math.max(0, s.avifSpeed)),
            matrix: heifMatrix(s, hdrOut),
            // From 2 up the file is byte-identical at any count; 1 is another encode.
            threads: Math.min(64, Math.max(2, threads)),
            // 0.16.0's tuning, which libheif chose unasked; `Iq` needs aom 3.12.
            tune: "Ssim",
            tiling: "Single"
          }
        },
        depth: deep ? "Sixteen" : "Eight"
      };
    case "jxl":
      return {
        encode: s.jxlLossless ? { JxlLossless: { effort: s.jxlEffort, threads } } : { JxlLossy: { distance: s.jxlDistance, effort: s.jxlEffort, threads } },
        depth: deep ? "Sixteen" : "Eight"
      };
  }
}
const PREVIEW_EDGE = 1600;
function previewSettings(s) {
  const format = s.format === "jxl" || s.format === "tiff" ? "png" : s.format;
  const hdr = s.hdr.mode === "keep" || s.hdr.mode === "expand" ? { ...s.hdr, mode: "sdr" } : s.hdr;
  return {
    ...s,
    format,
    bitDepth: 8,
    hdr,
    metaMode: "all",
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    removeLocation: false,
    copyright: ""
  };
}
function previewResize(s, w, h, edge = PREVIEW_EDGE) {
  const full = buildResize(s, w, h);
  const out = full === "None" ? { w, h } : "Exact" in full ? { w: full.Exact.width, h: full.Exact.height } : { w, h };
  const long = Math.max(out.w, out.h);
  if (long <= edge) return full;
  const k = edge / long;
  return {
    Exact: { width: Math.max(1, Math.round(out.w * k)), height: Math.max(1, Math.round(out.h * k)) }
  };
}
function buildResize(s, w, h) {
  const { mode, value, valueH, enlarge } = s.resize;
  if (mode === "none" || !(value > 0) || mode === "box" && !(valueH > 0)) return "None";
  let k;
  switch (mode) {
    case "box":
      k = Math.min(value / w, valueH / h);
      break;
    case "long":
      k = value / Math.max(w, h);
      break;
    case "short":
      k = value / Math.min(w, h);
      break;
    case "width":
      k = value / w;
      break;
    case "height":
      k = value / h;
      break;
    case "megapixels":
      k = Math.sqrt(value * 1e6 / (w * h));
      break;
    case "percent":
      k = value / 100;
      break;
  }
  if (!enlarge && k >= 1) return "None";
  return {
    Exact: { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
  };
}
function displayPeak(nits) {
  return Number.isFinite(nits) ? Math.min(1e4, Math.max(100, nits)) : 1e3;
}
function buildColor(s, sourceIsHdr, statedPeak = null) {
  const to = s.colorSpace;
  if (sourceIsHdr) {
    if (s.hdr.mode === "keep") return "Preserve";
    return {
      ToneMap: {
        to,
        operator: s.hdr.operator,
        mode: "PerChannel",
        source_peak: s.hdr.sourcePeak !== null ? { Nits: s.hdr.sourcePeak } : statedPeak !== null ? "FromFile" : { Nits: 1e3 },
        target_peak_nits: s.hdr.targetPeak,
        gamut: s.hdr.gamut,
        intent: s.intent,
        black_point_compensation: s.blackPointCompensation
      }
    };
  }
  if (s.hdr.mode === "expand" && supportsHdr(s.format)) {
    return {
      Expand: {
        to: s.hdr.to,
        operator: { Linear: { sdr_white_nits: s.hdr.sdrWhite } },
        peak_nits: displayPeak(s.hdr.peak),
        limit: hdrLimit(s, displayPeak(s.hdr.peak))
      }
    };
  }
  return {
    ConvertTo: { to, intent: s.intent, black_point_compensation: s.blackPointCompensation }
  };
}
const OUTPUT_RADIUS = {
  screen: 0.6,
  glossy: 1,
  matte: 1.3
};
const OUTPUT_AMOUNT = {
  low: 0.45,
  standard: 0.75,
  high: 1.1
};
function outputSharpen(s) {
  const o = s.outputSharpen;
  if (!o?.enabled || s.hdr.mode === "keep" || s.hdr.mode === "expand") return null;
  const matte = o.media === "matte";
  return {
    amount: Math.round(OUTPUT_AMOUNT[o.amount] * (matte ? 1.2 : 1) * 1e4) / 1e4,
    radius: OUTPUT_RADIUS[o.media],
    detail: matte ? 0.4 : 0.3,
    masking: 0
  };
}
function outputSharpenRequest(s, sharpen) {
  return {
    space: {
      Encoded: {
        space: s.colorSpace,
        intent: s.intent,
        black_point_compensation: s.blackPointCompensation
      }
    },
    sharpen
  };
}
function expandTemplate(template, t) {
  const out = template.replaceAll("{name}", t.name).replaceAll("{ext}", t.ext).replaceAll("{seq}", String(t.seq).padStart(4, "0")).replaceAll("{date}", t.date).replaceAll("{rating}", String(t.rating)).replaceAll("{copy}", t.copy);
  return out.replace(/[\\/:*?"<>|]/g, "_").trim() || t.name;
}
function metadataPlan(s, meta) {
  const all2 = s.metaMode !== "copyrightOnly";
  const policy2 = all2 ? { ...s.metadata } : { exif: false, icc: s.metadata.icc, xmp: false, iptc: false };
  const into = all2 ? s.metadata : { exif: true, xmp: true, iptc: true };
  const text = (v) => v?.trim() || null;
  const copyright = text(meta?.copyright) ?? text(s.copyright);
  const title = all2 ? text(meta?.title) : null;
  const caption = all2 ? text(meta?.caption) : null;
  const keywords = all2 ? meta?.keywords ?? [] : [];
  const tags = {};
  if (into.exif) {
    if (copyright) tags["EXIF:Copyright"] = copyright;
    if (caption) tags["EXIF:ImageDescription"] = caption;
  }
  if (into.xmp) {
    if (copyright) tags["XMP-dc:Rights"] = copyright;
    if (title) tags["XMP-dc:Title"] = title;
    if (caption) tags["XMP-dc:Description"] = caption;
    if (keywords.length > 0) {
      tags["XMP-dc:Subject"] = pixlfile.flatSubjects(keywords);
      tags["XMP-lr:HierarchicalSubject"] = keywords;
    }
  }
  if (into.iptc) {
    const before2 = Object.keys(tags).length;
    if (copyright) tags["IPTC:CopyrightNotice"] = copyright;
    if (title) tags["IPTC:ObjectName"] = title;
    if (caption) tags["IPTC:Caption-Abstract"] = caption;
    if (keywords.length > 0) tags["IPTC:Keywords"] = pixlfile.flatSubjects(keywords);
    if (Object.keys(tags).length > before2) tags["IPTC:CodedCharacterSet"] = "UTF8";
  }
  return {
    policy: policy2,
    tags,
    // GPS lives in EXIF and XMP: with neither kept there is none to remove.
    removeLocation: s.removeLocation && (policy2.exif || policy2.xmp)
  };
}
const FORMAT_NAME = {
  jpeg: "JPEG",
  png: "PNG",
  tiff: "TIFF",
  webp: "WebP",
  avif: "AVIF",
  jxl: "JPEG XL"
};
function receiptNotes(asked, written, masterNotes) {
  const out = [];
  for (const k of ["exif", "icc", "xmp", "iptc"])
    if (asked[k] && !written[k])
      out.push(
        concepts.t("{{name}} was not written (the original has none, or the format has no place for it)", {
          name: k.toUpperCase()
        })
      );
  out.push(...masterNotes);
  return out;
}
function registerSchemePrivileges() {
  electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: pixlfile.SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ]);
}
function registerProtocol() {
  electron.protocol.handle(pixlfile.SCHEME, (request) => {
    const url$1 = new URL(request.url);
    const rel = decodeURIComponent(url$1.pathname.replace(/^\/+/, ""));
    const root = index$1.paths.cacheRoot();
    const file = path.resolve(root, rel);
    if (url$1.hostname !== "c" || !(file === root || file.startsWith(root + path.sep))) {
      return new Response("not found", { status: 404 });
    }
    return electron.net.fetch(url.pathToFileURL(file).toString()).then((res) => {
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Cache-Control", "no-store");
      return new Response(res.body, { status: res.status, headers });
    });
  });
}
function cacheUrl(file, version) {
  return pixlfile.cacheUrlIn(index$1.paths.cacheRoot(), file, version);
}
const GAIN_MAP_WHITE_NITS = 203;
const FALLBACK_HEADROOM = 3;
function appliedHeadroom(info2) {
  const h = info2.gain_map?.alternate_headroom_stops;
  return h !== null && h !== void 0 && h > 0 ? Math.min(h, 5.6) : FALLBACK_HEADROOM;
}
function appliedPeak(info2) {
  return Math.min(1e4, Math.round(GAIN_MAP_WHITE_NITS * 2 ** appliedHeadroom(info2)));
}
function editsHdr(recipe2, info2) {
  return recipe2.gainMap === "hdr" && !!info2.gain_map;
}
const stamp = source$1.versionStamp;
const building = /* @__PURE__ */ new Map();
function ensureHdrSource(engine2, photo, info2) {
  const key = `${photo.id}:${stamp(photo)}`;
  let p = building.get(key);
  if (!p) {
    p = build(engine2, photo, info2).finally(() => building.delete(key));
    building.set(key, p);
  }
  return p;
}
const png = { Png: { compression: "Fast", filter: "Sub" } };
const keepProfile = { exif: false, icc: true, xmp: false, iptc: false };
async function build(engine2, photo, info2) {
  const root = index$1.paths.photoCache(photo.id);
  const name = `hdr-${stamp(photo)}`;
  const dir = path.join(root, name);
  const meta = path.join(dir, "set.json");
  if (await exists(meta)) {
    const known = JSON.parse(await promises.readFile(meta, "utf8"));
    const files = [known.master.path, known.px.proxy.path, known.px.draft.path];
    if ((await Promise.all(files.map(exists))).every(Boolean)) return known;
  }
  for (const d of await promises.readdir(root).catch(() => []))
    if (d.startsWith("hdr-") && d !== name)
      await promises.rm(path.join(root, d), { recursive: true, force: true });
  await promises.mkdir(dir, { recursive: true });
  const peak = appliedPeak(info2);
  const hdr = {
    reference_white_nits: GAIN_MAP_WHITE_NITS,
    peak_nits: peak,
    limit: "Clip"
  };
  const apply = {
    Apply: { headroom_stops: appliedHeadroom(info2), signal: "Rec2100Pq" }
  };
  const orientation = source$1.sourceOrientation(info2, null);
  const masterPath = path.join(dir, "master.png");
  const m = await engine2.convert({
    ...source$1.blankRequest(photo.path, masterPath, info2.input),
    gain_map: apply,
    hdr,
    pixel: { depth: "Sixteen", channels: 3 },
    encode: png,
    metadata: keepProfile,
    // Preserve writes the applied rendition as the signal it was read as.
    color: "Preserve",
    framing: orientation === "Normal" ? null : { orientation, rotate_degrees: 0, rotate_resampler: "Lanczos3", crop: null },
    threads: source$1.heavyThreads()
  });
  const master = { path: masterPath, input: "Png", width: m.width, height: m.height };
  const smaller = async (from, edge, file) => {
    const k = Math.min(1, edge / Math.max(from.width, from.height));
    const path$1 = path.join(dir, file);
    const r = await engine2.convert({
      ...source$1.blankRequest(from.path, path$1, "Png"),
      resize: k < 1 ? { Scale: { factor: k } } : "None",
      pixel: { depth: "Sixteen", channels: 3 },
      encode: png,
      metadata: keepProfile,
      color: "Preserve",
      threads: source$1.heavyThreads()
    });
    return { path: path$1, input: "Png", width: r.width, height: r.height };
  };
  const proxy = await smaller(master, PROXY_EDGE, "proxy.png");
  const draft = await smaller(proxy, DRAFT_EDGE, "draft.png");
  const probed = await engine2.probe(masterPath);
  const set = {
    master,
    px: { proxy, draft, frameWidth: master.width, frameHeight: master.height },
    // The master is a PQ file like any other. Its peak — what the grade has
    // room for and what the display tone map starts from — is what the
    // pixels reach, and at least the file's stated capacity up to BT.2100's
    // nominal 1000 cd/m²: a synthetic map claiming 10 000 would otherwise
    // squash the preview.
    info: {
      ...probed,
      is_hdr: true,
      peak_nits: Math.round(Math.max(probed.peak_nits ?? 0, Math.min(peak, 1e3))),
      gain_map: null
    }
  };
  await promises.writeFile(meta, JSON.stringify(set));
  return set;
}
const MAX_BYTES = 25 * 1024 * 1024;
async function readWatermark(path2) {
  const st = await promises.stat(path2).catch(() => null);
  if (!st) throw new Error(concepts.t("the watermark is not at {{path}}", { path: path2 }));
  if (st.size > MAX_BYTES) throw new Error(concepts.t("the watermark is over 25 MB: use a smaller PNG"));
  const bytes = await promises.readFile(path2);
  const size = pngSize(bytes);
  if (!size) throw new Error(concepts.t("the watermark must be a PNG"));
  return { path: path2, ...size, url: `data:image/png;base64,${bytes.toString("base64")}` };
}
async function watermarkSize(path2) {
  const head = Buffer.alloc(24);
  const f = await promises.open(path2, "r").catch(() => null);
  if (!f) throw new Error(concepts.t("the watermark is not at {{path}}", { path: path2 }));
  try {
    await f.read(head, 0, 24, 0);
  } finally {
    await f.close();
  }
  const size = pngSize(head);
  if (!size) throw new Error(concepts.t("the watermark must be a PNG"));
  return size;
}
const PROBE_LIMIT = 100;
const MIN_FREE = 50 * 1024 * 1024;
async function nearestExisting(dir) {
  let d = dir;
  while (!await exists(d)) {
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return d;
}
async function freeBytes(dir) {
  try {
    const st = await promises.statfs(dir);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}
function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
class Exporter {
  constructor(library, sessions2, engine2) {
    this.library = library;
    this.sessions = sessions2;
    this.engine = engine2;
  }
  library;
  sessions;
  engine;
  jobs = /* @__PURE__ */ new Map();
  /** Whether an export is running. */
  get busy() {
    return this.jobs.size > 0;
  }
  send(p) {
    for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(index$1.IPC.export.progress, p);
  }
  cancel(id) {
    this.jobs.get(id)?.abort.abort();
  }
  start(keys, settings2) {
    const job = { id: Math.random().toString(36).slice(2), abort: new AbortController() };
    this.jobs.set(job.id, job);
    void this.run(job, keys, settings2).finally(() => this.jobs.delete(job.id));
    return job.id;
  }
  async run(job, keys, s) {
    const progress = {
      jobId: job.id,
      done: 0,
      total: keys.length,
      current: null,
      errors: [],
      finished: false,
      outputs: []
    };
    const { signal } = job.abort;
    for (const [i, key] of keys.entries()) {
      if (signal.aborted) break;
      const item = await this.library.item(key);
      progress.current = item?.name ?? key;
      this.send(progress);
      const name = item?.name ?? key;
      try {
        const out = await this.one(
          key,
          s,
          i + 1,
          signal,
          (message) => progress.errors.push({ name, message, warning: true })
        );
        if (out) progress.outputs.push(out);
      } catch (err) {
        if (isCancelled(err)) break;
        log.warn("export failed", key, err);
        progress.errors.push({ name, message: err.message });
      }
      progress.done = i + 1;
      this.send(progress);
    }
    progress.finished = true;
    progress.current = null;
    this.send(progress);
    if (s.reveal && progress.outputs.length > 0) electron.shell.showItemInFolder(progress.outputs[0]);
  }
  /**
   * The photo at full size with its pixel steps laid on (an AI denoise), made
   * from what its project keeps (never by running a model); null when it has
   * none.
   */
  async stepsMaster(row, info2, recipe2) {
    if (recipe2.pixels.length === 0) return null;
    const plain = await ensureProxies(this.engine, row, info2, source$1.BACKGROUND_THREADS);
    const set = await ensureWorking(
      pixelDeps(this.engine, this.library.index, row),
      source$1.versionStamp(row),
      plain,
      recipe2.pixels,
      () => ensureBase(this.engine, row, info2, askOf(recipe2))
    );
    return set.master;
  }
  /**
   * Export one item. Returns the written path, or null when skipped. What
   * goes wrong after the file is written (its metadata) is a `warn`.
   */
  async one(key, s, seq, signal, warn) {
    return (await this.render(key, s, seq, signal, warn))?.out ?? null;
  }
  /**
   * The export of one item; with `preview` the same request at the preview's
   * size and settings (`previewSettings`), written to `preview.out`: what
   * the picture will look like through the same colour path and encoder.
   * Returns the written path and the engine's report, or null when skipped.
   */
  async render(key, s0, seq, signal, warn, preview2) {
    const s = preview2 ? previewSettings(s0) : s0;
    await this.sessions.flush(key);
    const row = await this.library.photoRow(key);
    const file = await this.library.probe(row);
    const item = await this.library.item(key);
    const recipe2 = this.sessions.liveRecipe(key) ?? await this.library.recipe(key);
    const pixl = masterPolicy(s, {
      isHdr: file.is_hdr,
      hasGainMap: !!file.gain_map,
      editsBase: !!file.gain_map && !editsHdr(recipe2, file)
    });
    const hdrSource = !pixl && editsHdr(recipe2, file) ? await ensureHdrSource(this.engine, row, file) : null;
    const info2 = hdrSource?.info ?? file;
    const master = hdrSource?.master ?? await this.stepsMaster(row, info2, recipe2);
    const raw2 = master ? null : info2.input === "Raw" ? source$1.rawMaster(source$1.colourOf(row)) : null;
    const srcOrientation = master ? "Normal" : source$1.sourceOrientation(info2, raw2);
    const swap = ["Transpose", "Rotate90", "Transverse", "Rotate270"].includes(srcOrientation);
    const developed = raw2 ? await ensureProxies(this.engine, row, info2, source$1.BACKGROUND_THREADS) : null;
    const frameW = master?.width ?? developed?.frameWidth ?? (swap ? info2.height : info2.width);
    const frameH = master?.height ?? developed?.frameHeight ?? (swap ? info2.width : info2.height);
    const { user, width, height } = pixlfile.orientedFrame(recipe2, frameW, frameH);
    const hdrOut = !pixl && supportsHdr(s.format) && (info2.is_hdr && s.hdr.mode === "keep" || !info2.is_hdr && s.hdr.mode === "expand");
    const gainMapOut = !pixl && info2.is_hdr && s.hdr.mode === "gainmap" && supportsGainMap(s.format);
    const compiled = pixlfile.compile(recipe2, {
      isRaw: row.is_raw === 1,
      asShot: info2.as_shot_white,
      sourceOrientation: srcOrientation,
      frameWidth: frameW,
      frameHeight: frameH,
      scale: 1,
      seed: source$1.seedOf(row),
      brushPaths: await brushPlanes(row.id, recipe2, user),
      applyCrop: true,
      // HDR only where the pipeline keeps room above white: PQ/HLG out, or
      // the gain map's HDR master. Tone mapped to SDR, the grade runs after
      // the tone map on values that stop at 1.
      hdr: hdrOut || gainMapOut || pixl !== null
    });
    const cw = Math.round((compiled.crop?.width ?? 1) * width);
    const ch = Math.round((compiled.crop?.height ?? 1) * height);
    const pqOut = pixl?.headroom === true && (s.format === "jxl" || s.format === "png");
    const { encode, depth } = buildEncode(s, source$1.heavyThreads(), hdrOut || pqOut);
    let out;
    if (preview2) out = preview2.out;
    else {
      const { target: target2, stem } = this.nameOf(row, item, s, seq);
      await promises.mkdir(target2, { recursive: true });
      const ext = FORMAT_EXT[s.format];
      out = path.join(target2, `${stem}.${ext}`);
      if (await exists(out)) {
        if (s.collision === "skip") return null;
        if (s.collision === "suffix") {
          let n = 2;
          while (await exists(path.join(target2, `${stem}-${n}.${ext}`))) n++;
          out = path.join(target2, `${stem}-${n}.${ext}`);
        }
      }
      if (await sameFile(out, row.path)) throw new Error(concepts.t("the export would overwrite the original"));
    }
    const hdrKeep = !pixl && info2.is_hdr && s.hdr.mode === "keep" && supportsHdr(s.format);
    const effective = info2.is_hdr && s.hdr.mode === "keep" && !hdrKeep || s.hdr.mode === "gainmap" && !gainMapOut && !pixl ? { ...s, hdr: { ...s.hdr, mode: "sdr" } } : s;
    const peak = displayPeak(info2.peak_nits ?? s.hdr.peak);
    const resize = preview2 ? previewResize(s, cw, ch) : buildResize(s, cw, ch);
    const wm = s.watermark;
    const overlay = wm.enabled && wm.path ? await (async () => {
      const pic = await watermarkSize(wm.path);
      const outW = resize === "None" ? cw : "Exact" in resize ? resize.Exact.width : Math.round(cw * resize.Scale.factor);
      const outH = resize === "None" ? ch : "Exact" in resize ? resize.Exact.height : Math.round(ch * resize.Scale.factor);
      return watermarkOverlay(
        wm,
        wm.path,
        outW,
        outH,
        pic.width,
        pic.height,
        hdrOut || gainMapOut || pixl !== null
      );
    })() : null;
    const floatWork = compiled.grade !== null || compiled.lens !== null || compiled.retouch !== null || overlay !== null || pixlfile.framingWarps(compiled.framing);
    const color = pixl ? { Master: pixl } : gainMapOut ? "Preserve" : buildColor(effective, info2.is_hdr, info2.peak_nits);
    const floatPath = floatWork || gainMapOut || pixl !== null || resize !== "None" && !hdrKeep || typeof color === "object" && ("ToneMap" in color || "Expand" in color);
    const dither = s.dither && depth === "Eight" ? { TriangularNoise: { seed: source$1.seedOf(row) } } : "None";
    const plan = metadataPlan(s, item ?? null);
    const request = {
      ...master ? source$1.blankRequest(master.path, out, master.input) : source$1.blankRequest(row.path, out, info2.input, info2),
      raw: raw2,
      resize,
      resampler: "Lanczos3",
      // Kept HDR goes through the float path only when something needs it,
      // because that path needs the working white stated.
      linear_resample: hdrKeep ? floatWork : true,
      pixel: { depth, channels: 3 },
      encode: gainMapOut ? withGainMap(encode, gainMapEncode(s, peak)) : encode,
      // A reader reaches the base's linear light, which the map multiplies,
      // through its colour description.
      // `Master` refuses `icc: false`; so does a gain map's base, which a
      // reader reaches the linear light of through its colour description.
      metadata: gainMapOut || pixl ? { ...plan.policy, icc: true } : plan.policy,
      color,
      sdr: gainMapOut ? sdrRendition(s, peak) : null,
      // `Master` reads the map itself and refuses the field.
      ...pixl ? { gain_map: null } : {},
      grade: compiled.grade,
      // A HEIF's EXIF tag is never applied: a stated framing resets it in
      // what is written.
      framing: compiled.framing ?? (master ? null : source$1.uprightFraming("Normal", info2)),
      lens: compiled.lens,
      retouch: compiled.retouch,
      overlays: overlay ? [overlay] : null,
      dither: floatPath ? dither : "None",
      hdr: gainMapOut || hdrKeep && floatWork ? {
        reference_white_nits: s.hdr.referenceWhite,
        peak_nits: peak,
        limit: hdrLimit(s, peak)
      } : null,
      threads: source$1.heavyThreads()
    };
    const sdrOut = typeof color === "object" && ("ConvertTo" in color || "ToneMap" in color || "Master" in color && !color.Master.headroom);
    const sharpen = sdrOut ? outputSharpen(s) : null;
    const convert = (r) => this.engine.convert(
      sharpen ? {
        ...r,
        output_sharpen: outputSharpenRequest(s, sharpen),
        // The sharpen is a float pass of its own, so dither always applies.
        dither
      } : r,
      { signal }
    ).catch((err) => {
      if (err instanceof EngineError)
        err.nameInvariant(compiled.grade, r.sdr?.grade ?? null, compiled.layerIndex);
      throw err;
    });
    let report;
    if (raw2 && !preview2) {
      const plan2 = await scenePlan(info2.raw_cfa, askOf(recipe2));
      const done = await withScene(
        plan2,
        (scene) => convert({ ...request, raw: source$1.rawMaster(source$1.colourOf(row), scene) }),
        signal
      );
      log.info("export RAW develop", key, done.classic ? "classic" : plan2.tag);
      report = done.value;
    } else report = await convert(request);
    const m = report.color.master;
    if (m) log.info("export master", key, m.output, ...m.notes);
    if (preview2) return { out, report };
    for (const note of receiptNotes(request.metadata, report.metadata_written, m?.notes ?? []))
      warn(note);
    try {
      await pixlfile.embedMetadata(out, plan.tags, {
        removeLocation: plan.removeLocation,
        source: row.path
      });
    } catch (err) {
      log.warn("export metadata failed", out, err);
      warn(concepts.t("metadata not written: {{reason}}", { reason: err.message }));
    }
    return { out, report };
  }
  /** Where an item's file goes: its folder (beside the original unless one is chosen) and its name. */
  nameOf(row, item, s, seq) {
    const folder = s.folder ?? row.folder;
    return {
      target: s.subfolder ? path.join(folder, s.subfolder) : folder,
      stem: expandTemplate(s.template, {
        name: path.basename(row.name, path.extname(row.name)),
        ext: row.ext,
        seq,
        date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        rating: item?.rating ?? 0,
        copy: item?.copyName ?? ""
      })
    };
  }
  previewAbort = null;
  previewFile = null;
  /**
   * One photo as the export would write it, at the preview's size: the same
   * request through the same colour path and encoder (`previewSettings` says
   * where it differs), for the export dialog to show. A newer preview stops
   * the one before.
   */
  async preview(key, s) {
    this.previewAbort?.abort();
    const abort = new AbortController();
    this.previewAbort = abort;
    const shown2 = previewSettings(s);
    const dir = path.join(index$1.paths.cacheRoot(), "export-preview");
    await promises.mkdir(dir, { recursive: true });
    const out = path.join(dir, `${Math.random().toString(36).slice(2)}.${FORMAT_EXT[shown2.format]}`);
    const notes = [];
    try {
      const done = await this.render(key, s, 1, abort.signal, (m) => notes.push(m), { out });
      if (!done) throw new Error("nothing was rendered");
      if (this.previewFile && this.previewFile !== out) await promises.rm(this.previewFile, { force: true });
      this.previewFile = out;
      const { report } = done;
      const shownAs = [];
      if (shown2.format !== s.format)
        shownAs.push(
          concepts.t("Shown as {{shown}}: the window cannot show {{format}}.", {
            shown: FORMAT_NAME[shown2.format],
            format: FORMAT_NAME[s.format]
          })
        );
      if (shown2.hdr.mode !== s.hdr.mode) shownAs.push(concepts.t("Shown as its SDR picture."));
      return {
        url: cacheUrl(out, Date.now()),
        width: report.width,
        height: report.height,
        bytes: report.output_bytes,
        format: shown2.format,
        notes: [...shownAs, ...notes]
      };
    } catch (err) {
      await promises.rm(out, { force: true }).catch(() => void 0);
      throw err;
    } finally {
      if (this.previewAbort === abort) this.previewAbort = null;
    }
  }
  cancelPreview() {
    this.previewAbort?.abort();
  }
  /**
   * The checks an export's settings cannot make on their own: a folder that
   * cannot be written, too little room, files that would be replaced or
   * skipped, a photo past what the engine opens. The same `Guard`s as
   * `exportGuards`, raised before anything is written.
   */
  async preflight(keys, s) {
    const out = [];
    const folders = /* @__PURE__ */ new Set();
    let existing = 0;
    let replaced = false;
    let need = 0;
    const big = [];
    for (const [i, key] of keys.entries()) {
      const row = await this.library.photoRow(key).catch(() => null);
      if (!row) continue;
      const item = await this.library.item(key);
      const { target: target2, stem } = this.nameOf(row, item, s, i + 1);
      folders.add(target2);
      const file = path.join(target2, `${stem}.${FORMAT_EXT[s.format]}`);
      if (await exists(file)) {
        if (await sameFile(file, row.path)) replaced = true;
        else existing++;
      }
      need += row.size * 2;
      if (i < PROBE_LIMIT) {
        const info2 = await this.library.probe(row).catch(() => null);
        if (info2 && (info2.width * info2.height > source$1.READ_LIMITS.max_pixels || Math.max(info2.width, info2.height) > source$1.READ_LIMITS.max_side))
          big.push(row.name);
      }
    }
    if (replaced)
      out.push({
        id: "overwrite-original",
        severity: "block",
        step: "review",
        message: concepts.t(
          "A file would be written over its original: change the name, the folder or the format."
        )
      });
    for (const dir of folders) {
      const there = await nearestExisting(dir);
      const writable = await promises.access(there, fs.constants.W_OK).then(
        () => true,
        () => false
      );
      if (!writable) {
        out.push({
          id: "folder-unwritable",
          severity: "block",
          step: "review",
          message: concepts.t("Playroom cannot write to {{folder}}: choose another folder.", { folder: there })
        });
        continue;
      }
      const free = await freeBytes(there);
      if (free !== null && free < MIN_FREE)
        out.push({
          id: "disk-full",
          severity: "block",
          step: "review",
          message: concepts.t("Only {{free}} is free where {{folder}} is.", {
            free: formatBytes(free),
            folder: there
          })
        });
      else if (free !== null && free < need + MIN_FREE)
        out.push({
          id: "disk-low",
          severity: "warn",
          step: "review",
          message: concepts.t(
            "{{free}} is free where {{folder}} is; this export may need about {{need}}.",
            { free: formatBytes(free), folder: there, need: formatBytes(need) }
          )
        });
    }
    if (existing > 0) {
      out.push(
        s.collision === "overwrite" ? {
          id: "collide",
          severity: "warn",
          step: "review",
          message: concepts.tp(
            "{{count}} file already exists and will be replaced.",
            "{{count}} files already exist and will be replaced.",
            existing
          )
        } : s.collision === "skip" ? {
          id: "collide",
          severity: "warn",
          step: "review",
          message: concepts.tp(
            "{{count}} file already exists and will be skipped.",
            "{{count}} files already exist and will be skipped.",
            existing
          )
        } : {
          id: "collide",
          severity: "minor",
          step: "review",
          message: concepts.tp(
            "{{count}} file already exists: the new ones get a number.",
            "{{count}} files already exist: the new ones get a number.",
            existing
          )
        }
      );
    }
    if (big.length > 0)
      out.push({
        id: "too-large",
        severity: "warn",
        step: "format",
        message: big.length > 1 ? concepts.tp(
          "{{name}} and {{count}} more are larger than Playroom opens ({{megapixels}} megapixels) and will fail.",
          "{{name}} and {{count}} more are larger than Playroom opens ({{megapixels}} megapixels) and will fail.",
          big.length - 1,
          { name: big[0], megapixels: source$1.READ_LIMITS.max_pixels / 1e6 }
        ) : concepts.t(
          "{{name}} is larger than Playroom opens ({{megapixels}} megapixels) and will fail.",
          { name: big[0], megapixels: source$1.READ_LIMITS.max_pixels / 1e6 }
        )
      });
    return out;
  }
}
class IndexError extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.name = "IndexError";
    this.code = code;
  }
}
const MAX_RESTARTS = 5;
const STOP_WAIT_MS = 2e4;
class Connection {
  child;
  ready = false;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  restarts = 0;
  stopped = false;
  gaveUp = null;
  firstStart = true;
  listeners = [];
  start() {
    this.stopped = false;
    this.spawn();
  }
  on(listener) {
    this.listeners.push(listener);
  }
  async stop() {
    if (this.stopped) return;
    const child = this.child;
    const closing = this.request("close", []).catch(() => void 0);
    this.stopped = true;
    let timer2;
    await Promise.race([closing, new Promise((r) => timer2 = setTimeout(r, STOP_WAIT_MS))]);
    clearTimeout(timer2);
    this.child = void 0;
    child?.kill();
    this.failAll(new IndexError("the index has stopped", "IndexUnavailable"), () => true);
  }
  request(method, args) {
    if (this.stopped || this.gaveUp !== null) {
      return Promise.reject(
        new IndexError(this.gaveUp ?? "the index has stopped", "IndexUnavailable")
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const p = {
        request: { kind: "request", id, method, args },
        sent: false,
        resolve,
        reject
      };
      this.pending.set(id, p);
      if (this.ready) this.send(p);
    });
  }
  send(p) {
    p.sent = true;
    this.child?.postMessage(p.request);
  }
  failAll(err, which) {
    for (const [id, p] of this.pending) {
      if (!which(p)) continue;
      this.pending.delete(id);
      p.reject(err);
    }
  }
  spawn() {
    const args = ["--user-data", electron.app.getPath("userData")];
    if (this.firstStart) args.push("--prune");
    const exiftool = pixlfile.vendoredExiftoolPath();
    if (exiftool) args.push("--exiftool", exiftool);
    this.firstStart = false;
    const child = electron.utilityProcess.fork(path.join(MAIN_DIR, "index-host.js"), args, {
      serviceName: "pixl-index",
      stdio: "pipe"
    });
    this.child = child;
    this.ready = false;
    child.once("spawn", () => lowerPriority(child.pid));
    child.stdout?.on("data", (d) => log.info("[index]", d.toString().trimEnd()));
    child.stderr?.on("data", (d) => log.warn("[index]", d.toString().trimEnd()));
    child.on("message", (msg) => this.onMessage(msg));
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = void 0;
      this.ready = false;
      const reason = `index host exited with code ${code}`;
      this.failAll(new IndexError(reason, "IndexCrashed"), (p) => p.sent);
      if (this.stopped) return;
      log.error(reason);
      this.restarts++;
      if (this.restarts > MAX_RESTARTS) {
        this.gaveUp = `${reason}; gave up restarting`;
        this.failAll(new IndexError(this.gaveUp, "IndexUnavailable"), () => true);
        return;
      }
      setTimeout(
        () => {
          if (!this.stopped && !this.child) this.spawn();
        },
        Math.min(500 * this.restarts, 5e3)
      );
    });
  }
  onMessage(msg) {
    if (msg.kind === "hello") {
      this.ready = true;
      log.info("index ready", { pid: this.child?.pid, restarts: this.restarts });
      for (const p2 of [...this.pending.values()].sort((a, b) => a.request.id - b.request.id)) {
        if (!p2.sent) this.send(p2);
      }
      return;
    }
    if (msg.kind === "event") {
      const { kind: _kind, ...event } = msg;
      for (const l of this.listeners) l(event);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new IndexError(msg.error.message, msg.error.code));
  }
}
function openIndex() {
  const conn = new Connection();
  return new Proxy(conn, {
    get(target2, prop) {
      if (prop === "start" || prop === "stop" || prop === "on") {
        const fn = target2[prop];
        return fn.bind(target2);
      }
      if (typeof prop !== "string" || prop === "then") return void 0;
      return (...args) => target2.request(prop, args);
    }
  });
}
function licenceEnforced(version) {
  const m = /^(\d+)\.\d+\.\d+(-.+)?$/.exec(version);
  return !!m && Number(m[1]) >= 1 && m[2] === void 0;
}
const LICENCE_ENFORCED = false;
const LICENCE_RULES = {
  deviceLimit: 3,
  trialDays: 14
};
const DAY_S = 24 * 60 * 60;
function licenceState(i) {
  if (!i.signedIn) return { kind: "signed-out" };
  if (i.deviceLimit) return { kind: "device-limit", devices: i.deviceLimit };
  if (i.refusal === "beta_ended") return { kind: "beta-ended" };
  if (i.refusal === "no_beta") return { kind: "no-beta" };
  const c = i.claims;
  if (!c) return i.expired ? { kind: "revalidate" } : { kind: "checking" };
  const offlineDaysLeft = Math.max(0, Math.floor((c.exp - i.now) / DAY_S));
  const { beta, licence: licence2, trial } = c.ent;
  if (licence2) return { kind: "licensed", offlineDaysLeft };
  if (i.betaBuild && beta && (beta.until === void 0 || beta.until > i.now))
    return { kind: "beta", offlineDaysLeft };
  if (trial) {
    const left = trial.until - i.now;
    return left > 0 ? { kind: "trial", daysLeft: Math.ceil(left / DAY_S) } : { kind: "trial-ended" };
  }
  return { kind: "no-trial" };
}
function licenceStatus(input, visible2, enforced2 = LICENCE_ENFORCED) {
  const state2 = licenceState(input);
  return {
    state: state2,
    enforced: enforced2,
    deviceLimit: LICENCE_RULES.deviceLimit,
    discount: input.claims?.discount,
    confirmedAt: input.claims ? input.claims.iat * 1e3 : void 0,
    locked: lockedReason(state2, enforced2),
    visible: visible2 || enforced2
  };
}
function allows(state2, what, enforced2 = LICENCE_ENFORCED) {
  if (!enforced2) return true;
  return state2.kind === "trial" || state2.kind === "licensed" || state2.kind === "beta";
}
function lockedReason(state2, enforced2 = LICENCE_ENFORCED) {
  if (allows(state2, "export", enforced2)) return null;
  switch (state2.kind) {
    case "signed-out":
      return concepts.t(
        "Sign in with your PIXL account to start your free trial, or to use your licence. Editing still works."
      );
    case "checking":
      return concepts.t(
        "Playroom needs to check your account before it exports. Connect to the internet, then choose Check now in Settings."
      );
    case "no-trial":
      return concepts.t(
        "Start your free {{days}}-day trial in Settings, or buy a licence, to export. Editing still works.",
        { days: LICENCE_RULES.trialDays }
      );
    case "trial-ended":
      return concepts.t("Your free trial has ended. Buy a licence to export again. Editing still works.");
    case "revalidate":
      return concepts.t(
        "Playroom needs to confirm your licence before it exports again. Connect to the internet, then choose Check now in Settings."
      );
    case "device-limit":
      return concepts.tp(
        "Your licence is already on {{count}} device. Free one in Settings to use it here. Editing still works.",
        "Your licence is already on {{count}} devices. Free one in Settings to use it here. Editing still works.",
        LICENCE_RULES.deviceLimit
      );
    case "no-beta":
      return concepts.t("This account isn’t in the beta. Join it on the beta page, or use the released Pixl Playroom.");
    case "beta-ended":
      return concepts.t("The beta has ended. Update to the released Pixl Playroom to keep going.");
    default:
      return null;
  }
}
class LicenceError extends Error {
  /** locked: what was asked for needs access the account doesn't give (`allows`). */
  code;
  constructor(message, code) {
    super(message);
    this.name = "LicenceError";
    this.code = code;
  }
}
function needsLens(p) {
  return p.groups.includes("lens") && p.recipe.lens.profile.enabled;
}
function applyLook(to, p, ctx) {
  const from = p.wbOp ? { ...p.recipe, wb: pixlfile.wbFromSaved(p.recipe.wb, p.wbOp, ctx.wb) } : p.recipe;
  const next = p.fields ? recipe.applyFields(to, from, p.fields) : recipe.applyGroups(to, from, p.groups);
  if (p.groups.includes("lens")) {
    next.lens.ca = to.lens.ca;
    if (needsLens(p) && ctx.lensResolved !== "keep") ;
  }
  return next;
}
const COLLECTIONS = [
  {
    id: "camera/fujifilm",
    label: concepts.tk("Fujifilm-inspired"),
    family: "camera",
    blurb: concepts.tk("Slide, negative and cinema colour in the spirit of the film simulations.")
  },
  {
    id: "camera/leica",
    label: concepts.tk("Leica-inspired"),
    family: "camera",
    blurb: concepts.tk("Restrained contrast, long highlights and toned monochromes.")
  },
  {
    id: "camera/hasselblad",
    label: concepts.tk("Hasselblad-inspired"),
    family: "camera",
    blurb: concepts.tk("Natural, accurate colour with a gentle film curve.")
  },
  {
    id: "camera/canon",
    label: concepts.tk("Canon-inspired"),
    family: "camera",
    blurb: concepts.tk("Warm, friendly colour and flattering skin.")
  },
  {
    id: "camera/nikon",
    label: concepts.tk("Nikon-inspired"),
    family: "camera",
    blurb: concepts.tk("Picture-control looks, from neutral to the creative set.")
  },
  {
    id: "camera/sony",
    label: concepts.tk("Sony-inspired"),
    family: "camera",
    blurb: concepts.tk("Creative-look styles and cine skin tones.")
  },
  {
    id: "camera/ricoh",
    label: concepts.tk("Ricoh-inspired"),
    family: "camera",
    blurb: concepts.tk("Street looks: positive and negative film, bleach bypass, gritty mono.")
  },
  {
    id: "camera/panasonic",
    label: concepts.tk("Panasonic-inspired"),
    family: "camera",
    blurb: concepts.tk("Classic-neo colour, cine gammas and dynamic monochromes.")
  },
  {
    id: "camera/other",
    label: concepts.tk("More cameras"),
    family: "camera",
    blurb: concepts.tk("OM, Pentax and phone photographic styles.")
  },
  {
    id: "cinema",
    label: concepts.tk("Cinema cameras & print"),
    family: "cinema",
    blurb: concepts.tk("Cine-camera colour science, camera negative and theatre print film.")
  },
  {
    id: "film/colour",
    label: concepts.tk("Colour film stocks"),
    family: "film-colour",
    blurb: concepts.tk("Portrait, consumer, slide and tungsten stocks.")
  },
  {
    id: "film/instant",
    label: concepts.tk("Instant film"),
    family: "film-colour",
    blurb: concepts.tk("Instant colour and mono, fresh and faded.")
  },
  {
    id: "film/bw",
    label: concepts.tk("B&W film stocks"),
    family: "film-bw",
    blurb: concepts.tk("Press, fine-grain and night stocks.")
  },
  {
    id: "movies",
    label: concepts.tk("Movies & TV"),
    family: "movies",
    blurb: concepts.tk("Grades inspired by well-known films and series.")
  },
  {
    id: "bw",
    label: concepts.tk("Black & white"),
    family: "bw",
    blurb: concepts.tk("Filters, toning and printing styles.")
  },
  {
    id: "creative",
    label: concepts.tk("Creative"),
    family: "creative",
    blurb: concepts.tk("Seasons, moods and colour play.")
  },
  {
    id: "smart",
    label: concepts.tk("Smart looks"),
    family: "smart",
    blurb: concepts.tk("Looks that mask as they go: the sky, the subject, skin, a colour, an object; AI denoise.")
  },
  {
    id: "essentials",
    label: concepts.tk("Essentials"),
    family: "essentials",
    blurb: concepts.tk("Everyday starting points.")
  }
];
const COLLECTION_BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));
const ROOT_GROUP = {
  basic: "basicTone",
  presence: "presence",
  toneCurve: "toneCurve",
  hsl: "hsl",
  bwMix: "hsl",
  pointColors: "hsl",
  colorGrade: "colorGrade",
  effects: "effects",
  calibration: "calibration",
  treatment: "treatment"
};
function groupsOf(fields) {
  const out = /* @__PURE__ */ new Set();
  for (const f of fields) {
    const g = ROOT_GROUP[f[0]];
    if (g) out.add(g);
  }
  return [...out];
}
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
function look(slug, name, info2, ...steps) {
  const recipe$1 = recipe.defaultRecipe(false);
  const s = {
    lift: 0,
    drop: 0,
    approximates: /* @__PURE__ */ new Set(),
    include: /* @__PURE__ */ new Set(),
    smart: { masks: [], steps: [] }
  };
  for (const step of steps) step(recipe$1, s);
  if (s.lift !== 0 || s.drop !== 0) {
    const lo = s.lift;
    const hi = 1 - s.drop;
    recipe$1.toneCurve.master = recipe$1.toneCurve.master.map((p) => ({
      x: p.x,
      y: round(lo + p.y * (hi - lo))
    }));
  }
  return {
    slug,
    name,
    info: info2,
    recipe: recipe$1,
    approximates: [...s.approximates],
    include: [...s.include].map((p) => p.split(".")),
    ...s.smart.masks.length || s.smart.steps.length ? { smart: s.smart } : {}
  };
}
function collection(id, drafts) {
  const shelf = COLLECTION_BY_ID.get(id);
  if (!shelf) throw new Error(`no collection ${id}`);
  const base = recipe.defaultRecipe(false);
  return drafts.map((d) => {
    const fields = recipe.changedFields(d.recipe, base);
    for (const p of d.include) if (!fields.some((f) => f.join(".") === p.join("."))) fields.push(p);
    const meta = {
      collection: id,
      tags: d.info.tags,
      author: { kind: "pixl" },
      version: d.info.version ?? 1
    };
    if (d.info.inspiredBy) meta.inspiredBy = d.info.inspiredBy;
    if (d.info.description) meta.description = d.info.description;
    if (d.approximates.length) meta.approximates = d.approximates;
    return {
      id: `builtin:${d.slug}`,
      name: d.name,
      group: shelf.label,
      builtin: true,
      groups: groupsOf(fields),
      recipe: d.recipe,
      fields,
      meta,
      ...d.smart ? { smart: d.smart } : {}
    };
  });
}
const raw = (edit) => (r) => edit(r);
const tone = (t) => (r) => {
  for (const [k, v] of Object.entries(t)) r.basic[k] += v;
};
const presence = (p) => (r) => {
  for (const [k, v] of Object.entries(p)) r.presence[k] += v;
};
const hsl = (bands) => (r) => {
  for (const [b, [h, s, l]] of Object.entries(bands)) {
    r.hsl[b].hue += h;
    r.hsl[b].saturation += s;
    r.hsl[b].luminance += l;
  }
};
const foliage = (h, s, l) => (r) => {
  const k = 0.6;
  r.hsl.green.hue += h;
  r.hsl.green.saturation += s;
  r.hsl.green.luminance += l;
  r.hsl.yellow.hue += Math.round(h * k);
  r.hsl.yellow.saturation += Math.round(s * k);
  r.hsl.yellow.luminance += Math.round(l * k);
};
const sCurve = (k, pivot = 0.5) => (r) => {
  const d = k / 100 * 0.12;
  const q1 = pivot / 2;
  const q3 = pivot + (1 - pivot) / 2;
  r.toneCurve.master = [
    { x: 0, y: 0 },
    { x: round(q1), y: round(Math.max(0, q1 - d)) },
    { x: round(pivot), y: round(pivot) },
    { x: round(q3), y: round(Math.min(1, q3 + d)) },
    { x: 1, y: 1 }
  ];
};
const fade = (lift) => (_r, s) => {
  s.lift += lift;
};
const rolloff = (drop) => (_r, s) => {
  s.drop += drop;
};
const toPoints = (p) => p.map(([x, y]) => ({ x, y }));
const curve = (channel, points) => (r) => {
  r.toneCurve[channel] = toPoints(points);
};
const rgb = (c) => (r) => {
  if (c.r) r.toneCurve.red = toPoints(c.r);
  if (c.g) r.toneCurve.green = toPoints(c.g);
  if (c.b) r.toneCurve.blue = toPoints(c.b);
};
const wheel = (region, hue, saturation, luminance = 0) => (r) => {
  r.colorGrade[region] = { hue, saturation, luminance };
};
const split = (shadowHue, shadowSat, highlightHue, highlightSat, opts = {}) => (r) => {
  if (shadowSat > 0)
    r.colorGrade.shadows = { hue: shadowHue, saturation: shadowSat, luminance: 0 };
  if (highlightSat > 0)
    r.colorGrade.highlights = { hue: highlightHue, saturation: highlightSat, luminance: 0 };
  if (opts.balance !== void 0) r.colorGrade.balance = opts.balance;
  if (opts.blending !== void 0) r.colorGrade.blending = opts.blending;
};
const calib = (c) => (r) => {
  for (const [k, v] of Object.entries(c)) r.calibration[k] += v;
};
const mono = (mix = {}) => (r, s) => {
  r.treatment = "bw";
  for (const b of recipe.HSL_BANDS) {
    r.bwMix[b] = mix[b] ?? 0;
    s.include.add(`bwMix.${b}`);
  }
};
const grain = (amount, size = 25, roughness = 50) => (r, s) => {
  r.effects.grainAmount = amount;
  r.effects.grainSize = size;
  r.effects.grainRoughness = roughness;
  s.include.add("effects.grainSize");
  s.include.add("effects.grainRoughness");
};
const vignette = (amount, opts = {}) => (r, s) => {
  r.effects.vignetteAmount = amount;
  s.include.add("effects.vignetteMidpoint");
  s.include.add("effects.vignetteFeather");
  if (opts.midpoint !== void 0) r.effects.vignetteMidpoint = opts.midpoint;
  if (opts.feather !== void 0) r.effects.vignetteFeather = opts.feather;
  if (opts.roundness !== void 0) r.effects.vignetteRoundness = opts.roundness;
  if (opts.highlights !== void 0) r.effects.vignetteHighlights = opts.highlights;
};
const wash = (hue, saturation, amount) => (r) => {
  r.effects.wash = { hue, saturation, amount };
};
const halationApprox = (k) => (r, s) => {
  r.colorGrade.highlights = {
    hue: 12,
    saturation: Math.round(Math.max(r.colorGrade.highlights.saturation, k * 0.18)),
    luminance: r.colorGrade.highlights.luminance
  };
  r.effects.wash = { hue: 8, saturation: 70, amount: Math.round(k * 0.05) };
  r.presence.clarity -= Math.round(k * 0.08);
  s.approximates.add("halation");
};
const bloomApprox = (k) => (r, s) => {
  r.presence.clarity -= Math.round(k * 0.25);
  r.presence.texture -= Math.round(k * 0.1);
  r.basic.shadows += Math.round(k * 0.15);
  s.approximates.add("bloom");
};
const approximates = (what) => (_r, s) => {
  s.approximates.add(what);
};
const part = {
  range: (t) => ({
    target: { kind: "range", ...t },
    mode: "Add"
  }),
  linear: (start, end) => ({
    target: {
      kind: "linear",
      start: { x: start[0], y: start[1] },
      end: { x: end[0], y: end[1] }
    },
    mode: "Add"
  }),
  radial: (centre, radiusX, radiusY = radiusX, softness = 50) => ({
    target: {
      kind: "radial",
      centre: { x: centre[0], y: centre[1] },
      radiusX,
      radiusY,
      angle: 0,
      softness
    },
    mode: "Add"
  }),
  subject: () => ({ target: { kind: "subject" }, mode: "Add" }),
  background: () => ({ target: { kind: "background" }, mode: "Add" }),
  sky: () => ({ target: { kind: "sky" }, mode: "Add" }),
  person: (p) => ({ target: { kind: "person", part: p }, mode: "Add" }),
  object: (label2) => ({ target: { kind: "object", label: label2 }, mode: "Add" })
};
const joined = (p, mode) => ({ ...p, mode });
const minus = (p) => joined(p, "Subtract");
const within = (p) => joined(p, "Intersect");
const inverted = (p) => ({ ...p, invert: !p.invert });
const mask = (id, name, parts, adjust, opts = {}) => (_r, s) => {
  s.smart.masks.push({
    id,
    name,
    parts: parts.map((p, i) => i === 0 ? { ...p, mode: "Add" } : p),
    adjust,
    ...opts
  });
};
const denoise = (strength, opts = {}) => (_r, s) => {
  s.smart.steps.push({
    kind: "denoise",
    model: opts.model ?? "auto",
    strength,
    ...opts.scope ? { scope: opts.scope } : {}
  });
};
const deblur = (strength, opts = {}) => (_r, s) => {
  s.smart.steps.push({ kind: "deblur", strength, ...opts.scope ? { scope: opts.scope } : {} });
};
const BW = collection("bw", [
  look(
    "film-noir",
    "Film Noir",
    {
      tags: ["bw", "mono", "noir", "dark", "dramatic"],
      description: "Hard key light and deep, falling-off shadows."
    },
    mono({ red: 10, orange: 10 }),
    sCurve(50),
    tone({ contrast: 20, shadows: -20, blacks: -10 }),
    vignette(-30, { feather: 60 }),
    grain(15, 22, 45)
  ),
  look(
    "high-key-mono",
    "High-Key Mono",
    { tags: ["bw", "mono", "high key", "bright", "airy"], description: "Bright, light and soft." },
    mono({ orange: 15, red: 10 }),
    tone({ contrast: -15, whites: 25, shadows: 30, highlights: 10 })
  ),
  look(
    "low-key-mono",
    "Low-Key Mono",
    { tags: ["bw", "mono", "low key", "dark", "moody"], description: "Dark, brooding and heavy." },
    mono(),
    tone({ contrast: 20, whites: -20, highlights: -20, shadows: -25, blacks: -10 })
  ),
  look(
    "red-filter-drama",
    "Red Filter Drama",
    {
      tags: ["bw", "mono", "red filter", "sky", "landscape"],
      description: "Black skies and bright clouds, as through a red filter."
    },
    mono({ red: 55, orange: 40, yellow: 15, green: -25, aqua: -50, blue: -75 }),
    tone({ contrast: 30, whites: 10 }),
    presence({ clarity: 15 })
  ),
  look(
    "yellow-filter-classic",
    "Yellow Filter Classic",
    {
      tags: ["bw", "mono", "yellow filter", "classic"],
      description: "The everyday yellow filter: slightly deeper skies."
    },
    mono({ yellow: 25, orange: 18, red: 8, blue: -30, aqua: -10 }),
    tone({ contrast: 10, shadows: 10, whites: 10 }),
    fade(0.015)
  ),
  look(
    "green-filter-portrait",
    "Green Filter Portrait",
    {
      tags: ["bw", "mono", "green filter", "portrait", "skin"],
      description: "Fuller skin tones and bright foliage."
    },
    mono({ green: 40, yellow: 20, red: -28, orange: -18 }),
    tone({ contrast: 8, highlights: -10, shadows: 10 }),
    fade(0.015)
  ),
  look(
    "infrared-mono",
    "Infrared Mono",
    {
      tags: ["bw", "mono", "infrared", "surreal", "landscape"],
      description: "White foliage, black skies and a faint glow."
    },
    mono({ green: 90, yellow: 70, aqua: -40, blue: -80 }),
    tone({ contrast: 30 }),
    bloomApprox(25),
    grain(15, 22, 45)
  ),
  look(
    "matte-mono",
    "Matte Mono",
    {
      tags: ["bw", "mono", "matte", "faded", "soft"],
      description: "Faded blacks and a soft, printed top end."
    },
    mono(),
    sCurve(30),
    fade(0.1),
    rolloff(0.06)
  ),
  look(
    "silver-gelatin",
    "Silver Gelatin",
    {
      tags: ["bw", "mono", "darkroom", "print", "classic"],
      description: "A rich darkroom print with a hint of warmth."
    },
    mono({ orange: 8, red: 4 }),
    sCurve(36),
    tone({ blacks: -10, highlights: -8 }),
    wheel("global", 40, 9),
    grain(12, 20, 40)
  ),
  look(
    "cyanotype",
    "Cyanotype",
    {
      tags: ["bw", "cyanotype", "blue", "alternative process", "toned"],
      description: "Prussian-blue alternative print."
    },
    mono(),
    tone({ contrast: 10 }),
    fade(0.03),
    split(215, 55, 200, 30)
  ),
  look(
    "platinum-print",
    "Platinum Print",
    {
      tags: ["bw", "platinum", "warm", "alternative process", "toned"],
      description: "Long, soft scale with warm, neutral-brown tones."
    },
    mono(),
    tone({ contrast: -10, highlights: -10 }),
    fade(0.03),
    split(30, 15, 40, 8)
  ),
  look(
    "split-tone-mono",
    "Split-Tone Mono",
    {
      tags: ["bw", "split tone", "toned", "cool", "warm"],
      description: "Cool shadows, warm highlights."
    },
    mono(),
    tone({ contrast: 15 }),
    split(220, 20, 40, 20)
  ),
  look(
    "lith-print",
    "Lith Print",
    {
      tags: ["bw", "lith", "grain", "warm", "alternative process"],
      description: "Hard, gritty shadows and creamy, peach highlights."
    },
    mono(),
    curve("master", [
      [0, 0],
      [0.3, 0.12],
      [0.6, 0.62],
      [1, 0.96]
    ]),
    split(30, 10, 25, 25),
    grain(35, 35, 70)
  ),
  look(
    "tintype",
    "Tintype",
    {
      tags: ["bw", "tintype", "vintage", "wet plate", "portrait"],
      description: "Wet-plate feel: dark edges, cool metal tone, dark reds."
    },
    mono({ red: -40, orange: -25, blue: 30, aqua: 20 }),
    tone({ contrast: 25 }),
    wheel("global", 50, 6),
    vignette(-40, { feather: 40 }),
    grain(20, 30, 70)
  )
]);
const insp$2 = (style) => `Canon Picture Style ${style}`;
const CANON = collection("camera/canon", [
  look(
    "friendly-standard",
    "Friendly Standard",
    {
      tags: ["standard", "warm", "everyday", "canon"],
      inspiredBy: insp$2("Standard"),
      description: "Warm, punchy everyday colour with rich reds."
    },
    tone({ contrast: 12 }),
    presence({ saturation: 10, texture: 10 }),
    wheel("global", 40, 3),
    hsl({ red: [0, 10, 0], orange: [0, 10, 0] })
  ),
  look(
    "gentle-portrait",
    "Gentle Portrait",
    {
      tags: ["portrait", "skin", "soft", "warm", "canon"],
      inspiredBy: insp$2("Portrait"),
      description: "Rosy, smooth skin and a soft touch."
    },
    tone({ contrast: -8, highlights: -12, shadows: 8 }),
    presence({ texture: -18, clarity: -6 }),
    wheel("global", 15, 7),
    wheel("highlights", 25, 10),
    hsl({ orange: [-6, -8, 12], red: [0, -6, 6] })
  ),
  look(
    "lush-landscape",
    "Lush Landscape",
    {
      tags: ["landscape", "nature", "green", "blue sky", "canon"],
      inspiredBy: insp$2("Landscape"),
      description: "Vivid greens and blues with crisp detail."
    },
    tone({ contrast: 15 }),
    presence({ saturation: 15, clarity: 10 }),
    hsl({ blue: [0, 25, -10] }),
    foliage(-5, 25, 0)
  ),
  look(
    "faithful-colour",
    "Faithful Colour",
    {
      tags: ["faithful", "accurate", "colorimetric", "product", "canon"],
      inspiredBy: insp$2("Faithful"),
      description: "Colour as measured, contrast held low."
    },
    tone({ contrast: -15, highlights: -12, shadows: 10 }),
    presence({ saturation: -6 }),
    hsl({ red: [0, -6, 0], yellow: [0, -6, 0] })
  ),
  look(
    "neutral-base",
    "Neutral Base",
    {
      tags: ["neutral", "flat", "grading", "canon"],
      inspiredBy: insp$2("Neutral"),
      description: "A low-contrast, low-saturation base to grade from."
    },
    tone({ contrast: -25, shadows: 10 }),
    presence({ saturation: -15 }),
    wheel("global", 35, 4)
  ),
  look(
    "fine-detail",
    "Fine Detail",
    {
      tags: ["detail", "texture", "sharp", "canon"],
      inspiredBy: insp$2("Fine Detail"),
      description: "Fine texture brought forward, colour as standard."
    },
    tone({ contrast: 12, whites: 8, blacks: -8 }),
    presence({ saturation: 6, texture: 45, clarity: 15 }),
    wheel("global", 40, 3),
    hsl({ blue: [0, 8, -5] })
  ),
  look(
    "plain-mono",
    "Plain Mono",
    {
      tags: ["bw", "mono", "canon"],
      inspiredBy: insp$2("Monochrome"),
      description: "A straightforward black and white."
    },
    // Canon renders skin bright in mono: warm bands lifted, blue held down.
    mono({ red: 12, orange: 18, yellow: 8, blue: -12 }),
    tone({ contrast: 15, blacks: -6 })
  )
]);
const CINEMA = collection("cinema", [
  look(
    "classic-cine-camera",
    "Classic Cine Camera",
    {
      tags: ["cinema", "cine camera", "skin", "highlight rolloff", "arri", "alexa", "k1s1"],
      inspiredBy: "ARRI ALEXA LogC to Rec.709 (K1S1)",
      description: "A moderate S with a very long, desaturating highlight shoulder and kind skin."
    },
    sCurve(25),
    rolloff(0.03),
    tone({ whites: -18, highlights: -15 }),
    presence({ saturation: -6 }),
    wheel("global", 35, 4),
    hsl({ orange: [-3, 6, 2], yellow: [0, -10, 0], green: [-8, -18, 0] })
  ),
  look(
    "modern-cine-camera",
    "Modern Cine Camera",
    {
      tags: ["cinema", "cine camera", "accurate", "arri", "reveal"],
      inspiredBy: "ARRI REVEAL colour science",
      description: "The classic cine curve with cleaner, truer hues."
    },
    sCurve(25),
    rolloff(0.02),
    tone({ whites: -12, highlights: -12 }),
    presence({ vibrance: 10 }),
    wheel("global", 200, 3),
    hsl({ red: [0, 5, -4], blue: [-5, 10, -5], aqua: [0, 10, 0] })
  ),
  look(
    "cine-print-look",
    "Cine Print Look",
    {
      tags: ["cinema", "print", "film look", "arri", "look library"],
      inspiredBy: "ARRI Look Library film-print styles",
      description: "A cine camera printed to film: teal shadows, warm highlights, a little grain."
    },
    sCurve(30),
    fade(0.01),
    presence({ saturation: -12 }),
    split(185, 16, 40, 14),
    hsl({ green: [5, -12, 0] }),
    grain(8, 20, 40)
  ),
  look(
    "digital-cine-neutral",
    "Digital Cine Neutral",
    {
      tags: ["cinema", "neutral", "soft", "red", "ipp2"],
      inspiredBy: "RED IPP2 (medium contrast, soft roll-off)",
      description: "Neutral, slightly cool, with a very soft highlight roll-off."
    },
    sCurve(12),
    rolloff(0.04),
    tone({ highlights: -22, shadows: 8 }),
    presence({ saturation: -10 }),
    wheel("global", 210, 6)
  ),
  look(
    "full-frame-cine",
    "Full Frame Cine",
    {
      tags: ["cinema", "warm skin", "sony", "venice"],
      inspiredBy: "Sony VENICE Rec.709",
      description: "Rich reds, cyan skies and warm skin."
    },
    tone({ contrast: 15 }),
    presence({ saturation: 5 }),
    wheel("global", 35, 3),
    hsl({ red: [0, 10, 0], green: [-5, -10, 0], blue: [-8, 0, 0] })
  ),
  look(
    "indie-cine",
    "Indie Cine",
    {
      tags: ["cinema", "indie", "warm", "blackmagic", "gen5"],
      inspiredBy: "Blackmagic Design Gen 5 colour science",
      description: "Warm reds and a faint magenta lean."
    },
    tone({ contrast: 10 }),
    presence({ saturation: 5 }),
    wheel("global", 330, 3),
    hsl({ red: [0, 8, 0], orange: [0, 8, 0] })
  ),
  look(
    "creamy-cine",
    "Creamy Cine",
    {
      tags: ["cinema", "creamy", "skin", "soft", "panavision", "light iron"],
      inspiredBy: "Panavision / Light Iron colour",
      description: "Creamy skin and soft highlights over a gentle split."
    },
    tone({ contrast: 5, highlights: -18 }),
    rolloff(0.03),
    presence({ texture: -10 }),
    split(190, 10, 45, 14),
    hsl({ orange: [-2, -5, 8], red: [0, -5, 0] }),
    grain(5, 15, 30)
  ),
  look(
    "warm-theatre-print",
    "Warm Theatre Print",
    {
      tags: ["print film", "cinema", "warm", "dense", "kodak", "2383"],
      inspiredBy: "Kodak Vision Color Print Film 2383",
      description: "Dense blacks, a strong shoulder and the warm-teal split of a theatre print."
    },
    sCurve(45),
    rolloff(0.03),
    tone({ blacks: -5 }),
    presence({ saturation: 5 }),
    split(185, 18, 40, 15),
    hsl({ red: [0, 15, 0], yellow: [0, 10, 0], green: [0, -10, 0], blue: [-15, 0, 0] })
  ),
  look(
    "cool-theatre-print",
    "Cool Theatre Print",
    {
      tags: ["print film", "cinema", "cool", "fuji", "3513"],
      inspiredBy: "Fujifilm Eterna-CP 3513 print film",
      description: "A cooler, greener print with more neutral skin."
    },
    sCurve(35),
    split(170, 12, 50, 6),
    hsl({ red: [0, 5, 0], orange: [0, -5, 0] })
  ),
  look(
    "silver-retention-print",
    "Silver Retention Print",
    {
      tags: ["bleach bypass", "enr", "cinema", "gritty", "technicolor"],
      inspiredBy: "Technicolor ENR / bleach-bypass print processing",
      description: "Silver left in the print: heavy contrast, deep blacks, muted colour."
    },
    sCurve(50),
    tone({ contrast: 20, blacks: -10 }),
    presence({ saturation: -45, clarity: 10 }),
    grain(15, 25, 50)
  ),
  look(
    "three-strip-glory",
    "Three-Strip Glory",
    {
      tags: ["technicolor", "dye transfer", "saturated", "classic hollywood"],
      inspiredBy: "Three-strip Technicolor dye-transfer prints",
      description: "Rich primaries and inky blacks of classic dye-transfer prints."
    },
    sCurve(30),
    tone({ blacks: -8 }),
    presence({ saturation: 25 }),
    hsl({ red: [0, 20, -5], yellow: [0, 15, 0], blue: [0, 20, -10], green: [0, 10, -5] })
  ),
  look(
    "two-strip-colour",
    "Two-Strip Colour",
    {
      tags: ["technicolor", "two strip", "vintage", "red cyan"],
      inspiredBy: "Two-colour Technicolor (1920s)",
      description: "Only reds and cyans: greens and blues fold into teal, yellows into peach."
    },
    presence({ saturation: -10 }),
    hsl({
      yellow: [-60, -40, 0],
      green: [60, -30, 0],
      blue: [-60, -20, 0],
      purple: [-60, -40, 0],
      magenta: [60, -30, 0]
    }),
    approximates("hueSwap")
  ),
  look(
    "day-for-night",
    "Day for Night",
    {
      tags: ["day for night", "night", "blue", "dark", "cinema"],
      inspiredBy: "The classic day-for-night film technique",
      description: "Daylight made to read as moonlight: dark, blue and drained."
    },
    tone({ contrast: 15, highlights: -50, whites: -40, shadows: -20 }),
    presence({ saturation: -50 }),
    wheel("global", 220, 30),
    wheel("shadows", 225, 20)
  ),
  look(
    "tungsten-cine-neg-500",
    "Tungsten Cine Neg 500",
    {
      tags: ["cinema", "negative", "tungsten", "night", "grain", "kodak", "vision3", "500t"],
      inspiredBy: "Kodak Vision3 500T 5219, printed",
      description: "Fast tungsten negative: soft blacks, teal shadows, visible grain."
    },
    sCurve(18),
    fade(0.03),
    tone({ highlights: -12 }),
    presence({ saturation: -8 }),
    split(175, 18, 35, 12),
    halationApprox(40),
    grain(32, 30, 55)
  ),
  look(
    "tungsten-cine-neg-200",
    "Tungsten Cine Neg 200",
    {
      tags: ["cinema", "negative", "tungsten", "kodak", "vision3", "200t"],
      inspiredBy: "Kodak Vision3 200T 5213, printed",
      description: "Tungsten negative with finer grain and the same teal-warm split."
    },
    sCurve(28),
    fade(0.015),
    tone({ highlights: -10 }),
    presence({ saturation: -4 }),
    split(180, 18, 40, 12),
    hsl({ green: [8, -10, 0] }),
    grain(18, 25, 45)
  ),
  look(
    "daylight-cine-neg-250",
    "Daylight Cine Neg 250",
    {
      tags: ["cinema", "negative", "daylight", "kodak", "vision3", "250d"],
      inspiredBy: "Kodak Vision3 250D 5207, printed",
      description: "Daylight negative with a very long highlight range."
    },
    sCurve(20),
    rolloff(0.03),
    tone({ highlights: -18, shadows: 8 }),
    presence({ saturation: -4 }),
    split(190, 12, 45, 12),
    hsl({ green: [5, -10, 0] }),
    grain(18, 25, 45)
  ),
  look(
    "fine-daylight-cine-neg",
    "Fine Daylight Cine Neg",
    {
      tags: ["cinema", "negative", "daylight", "fine grain", "kodak", "vision3", "50d"],
      inspiredBy: "Kodak Vision3 50D 5203, printed",
      description: "Crisp, clean, fine-grained daylight negative."
    },
    sCurve(30),
    presence({ saturation: 10 }),
    wheel("shadows", 190, 6),
    grain(6, 15, 30)
  ),
  look(
    "cine-bw-neg",
    "Cine B&W Neg",
    {
      tags: ["bw", "mono", "cinema", "grain", "kodak", "double-x", "5222"],
      inspiredBy: "Kodak Double-X 5222",
      description: "Classic motion-picture black and white: punchy with real grain."
    },
    mono({ red: 10, orange: 10, blue: -10 }),
    sCurve(40),
    tone({ blacks: -15, shadows: -10, highlights: -10 }),
    vignette(-15, { feather: 70 }),
    grain(40, 35, 65)
  )
]);
const CREATIVE = collection("creative", [
  look(
    "faded-summer",
    "Faded Summer",
    {
      tags: ["summer", "faded", "warm", "nostalgic"],
      description: "A sun-bleached summer afternoon."
    },
    tone({ contrast: -10, shadows: 15 }),
    fade(0.06),
    presence({ saturation: -10 }),
    split(190, 8, 45, 15),
    grain(10, 20, 40)
  ),
  look(
    "autumn-gold",
    "Autumn Gold",
    {
      tags: ["autumn", "fall", "gold", "warm", "foliage"],
      description: "Greens turned gold and orange, warm and rich."
    },
    sCurve(20),
    presence({ vibrance: 15 }),
    wheel("midtones", 35, 10),
    hsl({ yellow: [-20, 15, 0], green: [-60, -20, -10], orange: [0, 15, -5] })
  ),
  look(
    "winter-blue",
    "Winter Blue",
    {
      tags: ["winter", "cold", "snow", "blue"],
      description: "Crisp, cold and clean, with blue shadows."
    },
    tone({ contrast: 10, whites: 10 }),
    presence({ saturation: -15 }),
    split(215, 18, 200, 6),
    hsl({ orange: [0, -10, 0] })
  ),
  look(
    "desert-heat",
    "Desert Heat",
    { tags: ["desert", "hot", "warm", "orange"], description: "Baked orange heat and hazy sky." },
    tone({ contrast: 15 }),
    presence({ dehaze: -10, saturation: -5 }),
    wheel("global", 30, 18),
    hsl({ blue: [0, -25, 10] })
  ),
  look(
    "vaporwave",
    "Vaporwave",
    {
      tags: ["vaporwave", "retro", "pink", "cyan", "synth"],
      description: "Magenta and cyan, faded and dreamy."
    },
    fade(0.05),
    split(190, 30, 320, 30),
    hsl({ magenta: [0, 30, 0], aqua: [0, 30, 0], orange: [0, -20, 0] })
  ),
  look(
    "lo-fi",
    "Lo-Fi",
    {
      tags: ["lo-fi", "cheap camera", "faded", "grain"],
      description: "Cheap-camera charm: faded, soft and grainy."
    },
    tone({ contrast: 10 }),
    fade(0.06),
    rolloff(0.05),
    presence({ saturation: -10, texture: -15 }),
    wheel("shadows", 160, 10),
    vignette(-25),
    grain(35, 40, 70)
  ),
  look(
    "cyberpunk-night",
    "Cyberpunk Night",
    {
      tags: ["cyberpunk", "neon", "night", "magenta", "teal"],
      description: "Electric magenta and teal, deep blacks."
    },
    tone({ contrast: 25, blacks: -10 }),
    split(185, 30, 315, 20),
    hsl({ magenta: [0, 35, 0], purple: [0, 25, 0], aqua: [0, 25, 0], yellow: [0, -30, 0] }),
    bloomApprox(15)
  ),
  look(
    "mint-fresh",
    "Mint Fresh",
    { tags: ["mint", "fresh", "pastel", "airy"], description: "Bright, minty and clean." },
    tone({ contrast: -10, whites: 10 }),
    presence({ saturation: -5 }),
    wheel("shadows", 160, 12),
    hsl({ aqua: [0, 10, 10] }),
    foliage(25, -10, 10)
  ),
  look(
    "sunset-glow",
    "Sunset Glow",
    { tags: ["sunset", "glow", "warm", "pink"], description: "Peach and pink evening glow." },
    tone({ highlights: -10, shadows: 10 }),
    split(280, 10, 25, 25),
    presence({ vibrance: 15 }),
    wash(25, 60, 6)
  ),
  look(
    "forest-moody",
    "Forest Moody",
    {
      tags: ["forest", "moody", "green", "dark", "nature"],
      description: "Deep, dark greens and misty quiet."
    },
    tone({ contrast: 10, highlights: -15, whites: -10 }),
    fade(0.03),
    presence({ saturation: -10 }),
    hsl({ green: [10, -15, -20], yellow: [-15, -20, -10] }),
    wheel("shadows", 170, 10)
  ),
  look(
    "ocean-deep",
    "Ocean Deep",
    {
      tags: ["ocean", "sea", "blue", "teal", "water"],
      description: "Rich teal and deep sea blue."
    },
    tone({ contrast: 15 }),
    hsl({ aqua: [-10, 35, -15], blue: [-10, 30, -20] }),
    wheel("shadows", 200, 22),
    wheel("midtones", 190, 8)
  ),
  look(
    "urban-grit",
    "Urban Grit",
    {
      tags: ["urban", "gritty", "street", "desaturated"],
      description: "Hard, gritty city detail with little colour."
    },
    tone({ contrast: 20 }),
    presence({ saturation: -40, clarity: 30, texture: 15 }),
    wheel("shadows", 200, 6),
    grain(20, 28, 60)
  ),
  look(
    "peach-skin",
    "Peach Skin",
    {
      tags: ["portrait", "peach", "warm", "soft", "skin"],
      description: "Soft peachy skin, gentle everything else."
    },
    tone({ contrast: -8, shadows: 12 }),
    presence({ texture: -12 }),
    hsl({ orange: [4, -4, 10], red: [6, -4, 6] }),
    wheel("highlights", 25, 18),
    wheel("midtones", 20, 8)
  ),
  look(
    "cotton-candy",
    "Cotton Candy",
    {
      tags: ["pastel", "pink", "blue", "sweet"],
      description: "Pink highlights, blue shadows, all pastel."
    },
    tone({ contrast: -15 }),
    fade(0.04),
    split(205, 20, 335, 18),
    presence({ saturation: -5 })
  ),
  look(
    "honey-haze",
    "Honey Haze",
    { tags: ["honey", "warm", "haze", "dreamy"], description: "Hazy, honeyed backlight." },
    tone({ contrast: -10 }),
    fade(0.04),
    presence({ dehaze: -15 }),
    wheel("global", 42, 15),
    bloomApprox(20)
  ),
  look(
    "bleach-pop",
    "Bleach Pop",
    {
      tags: ["bleach", "fashion", "contrast", "desaturated"],
      description: "Fashion bleach: hard, bright and pale."
    },
    tone({ contrast: 30, whites: 15 }),
    presence({ saturation: -35, clarity: 10 })
  ),
  look(
    "emerald-city",
    "Emerald City",
    { tags: ["green", "emerald", "night", "city"], description: "Everything leans emerald." },
    tone({ contrast: 15 }),
    split(150, 25, 130, 10),
    calib({ greenHue: 10, greenSaturation: 20 })
  )
]);
const ESSENTIALS = collection("essentials", [
  look(
    "bw-contrast",
    "High-contrast B&W",
    {
      tags: ["bw", "mono", "contrast", "punchy"],
      description: "Deep blacks, bright skies held back."
    },
    raw((r) => {
      r.treatment = "bw";
      r.bwMix = {
        red: 20,
        orange: 25,
        yellow: 10,
        green: -20,
        aqua: -25,
        blue: -40,
        purple: -10,
        magenta: 10
      };
      r.basic.contrast = 35;
      r.basic.whites = 15;
      r.basic.blacks = -20;
      r.presence.clarity = 20;
    })
  ),
  look(
    "bw-soft",
    "Soft B&W",
    { tags: ["bw", "mono", "soft", "gentle"], description: "Open shadows and quiet highlights." },
    raw((r) => {
      r.treatment = "bw";
      r.basic.contrast = -15;
      r.basic.highlights = -30;
      r.basic.shadows = 30;
      r.presence.clarity = -10;
    })
  ),
  look(
    "warm-film",
    "Warm film",
    {
      tags: ["film", "warm", "grain", "analog"],
      description: "A warm print with soft blacks and fine grain."
    },
    raw((r) => {
      r.toneCurve.master = [
        { x: 0, y: 0.05 },
        { x: 0.25, y: 0.24 },
        { x: 0.75, y: 0.78 },
        { x: 1, y: 0.95 }
      ];
      r.colorGrade.shadows = { hue: 200, saturation: 12, luminance: 0 };
      r.colorGrade.highlights = { hue: 40, saturation: 18, luminance: 0 };
      r.presence.vibrance = 10;
      r.effects.grainAmount = 18;
      r.effects.grainSize = 30;
      r.hsl.green = { hue: 15, saturation: -20, luminance: 0 };
    })
  ),
  look(
    "cool-matte",
    "Cool matte",
    {
      tags: ["film", "cool", "matte", "faded"],
      description: "Lifted blacks and cool, quiet colour."
    },
    raw((r) => {
      r.toneCurve.master = [
        { x: 0, y: 0.08 },
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.72 },
        { x: 1, y: 0.94 }
      ];
      r.colorGrade.shadows = { hue: 220, saturation: 15, luminance: 0 };
      r.colorGrade.midtones = { hue: 190, saturation: 6, luminance: 0 };
      r.presence.saturation = -15;
    })
  ),
  look(
    "vivid",
    "Vivid",
    {
      tags: ["colour", "vivid", "saturated", "punchy"],
      description: "More contrast and colour, skin kept in check."
    },
    raw((r) => {
      r.basic.contrast = 20;
      r.presence.vibrance = 35;
      r.presence.saturation = 8;
      r.presence.clarity = 10;
    })
  ),
  look(
    "teal-orange",
    "Teal & orange",
    {
      tags: ["colour", "cinematic", "teal", "orange", "blockbuster"],
      description: "Teal shadows against warm skin."
    },
    raw((r) => {
      r.colorGrade.shadows = { hue: 190, saturation: 30, luminance: -5 };
      r.colorGrade.highlights = { hue: 35, saturation: 25, luminance: 0 };
      r.colorGrade.balance = -10;
      r.hsl.orange = { hue: 0, saturation: 10, luminance: 5 };
      r.hsl.blue = { hue: -15, saturation: 10, luminance: 0 };
      r.presence.vibrance = 10;
    })
  ),
  look(
    "landscape",
    "Landscape pop",
    {
      tags: ["landscape", "nature", "sky", "clarity"],
      description: "Held highlights, open shadows, deeper skies."
    },
    raw((r) => {
      r.basic.highlights = -40;
      r.basic.shadows = 30;
      r.presence.dehaze = 15;
      r.presence.clarity = 15;
      r.presence.vibrance = 25;
      r.hsl.blue = { hue: 0, saturation: 15, luminance: -15 };
      r.hsl.green = { hue: 10, saturation: 10, luminance: 0 };
    })
  ),
  look(
    "portrait",
    "Soft portrait",
    {
      tags: ["portrait", "skin", "soft", "people"],
      description: "Smoother skin and lifted shadows."
    },
    raw((r) => {
      r.presence.texture = -20;
      r.presence.clarity = -10;
      r.basic.shadows = 15;
      r.hsl.orange = { hue: 0, saturation: -8, luminance: 10 };
      r.hsl.red = { hue: 5, saturation: -5, luminance: 5 };
    })
  ),
  look(
    "vignette",
    "Classic vignette",
    {
      tags: ["vignette", "frame", "effect"],
      description: "Darkened corners that draw the eye in."
    },
    raw((r) => {
      r.effects.vignetteAmount = -30;
      r.effects.vignetteFeather = 60;
    })
  ),
  look(
    "clean-pop",
    "Clean pop",
    {
      tags: ["colour", "clean", "bright", "everyday"],
      description: "A gentle S-curve and clean colour."
    },
    sCurve(30),
    tone({ highlights: -15, shadows: 10 }),
    presence({ vibrance: 25, clarity: 8 }),
    hsl({ blue: [0, 10, -6] })
  ),
  look(
    "matte-fade",
    "Matte fade",
    { tags: ["matte", "faded", "soft", "film"], description: "Faded blacks and softened whites." },
    sCurve(15),
    fade(0.07),
    rolloff(0.04),
    presence({ saturation: -10 })
  ),
  look(
    "golden-hour",
    "Golden hour",
    {
      tags: ["warm", "sunset", "golden", "glow"],
      description: "Low sun warmth, honeyed highlights."
    },
    split(30, 8, 42, 22),
    wheel("global", 38, 6),
    tone({ highlights: -10, shadows: 10 }),
    hsl({ orange: [0, 8, 4], yellow: [-6, 5, 0], blue: [0, -15, 0] }),
    presence({ vibrance: 10 })
  ),
  look(
    "moody-blue",
    "Moody blue",
    { tags: ["moody", "cool", "dark", "blue"], description: "Cool, dark and quiet." },
    sCurve(25),
    fade(0.03),
    tone({ highlights: -20, whites: -10 }),
    split(215, 20, 200, 6),
    presence({ saturation: -20 }),
    hsl({ orange: [0, -5, -5], blue: [-5, 10, -10] }),
    vignette(-15, { feather: 70 })
  ),
  look(
    "crisp-detail",
    "Crisp detail",
    {
      tags: ["detail", "sharp", "texture", "architecture"],
      description: "Texture and clarity without crunch."
    },
    tone({ contrast: 10, whites: 6, blacks: -6 }),
    presence({ texture: 30, clarity: 20, dehaze: 8 })
  ),
  look(
    "soft-pastel",
    "Soft pastel",
    { tags: ["pastel", "airy", "soft", "bright"], description: "Bright, low-contrast and pastel." },
    tone({ contrast: -20, shadows: 25, highlights: -10 }),
    fade(0.05),
    presence({ saturation: -12, clarity: -8 }),
    split(190, 8, 330, 8),
    grain(6, 20, 40)
  )
]);
const FILM_BW = collection("film/bw", [
  look(
    "gritty-press-400",
    "Gritty Press 400",
    {
      tags: ["bw", "mono", "film", "press", "grain", "kodak", "tri-x", "400"],
      inspiredBy: "Kodak Tri-X 400",
      description: "The reportage classic: mid-tone bite and rough grain."
    },
    mono({ red: -8, orange: -6, blue: 10, aqua: 5 }),
    sCurve(38),
    tone({ blacks: -8, whites: 5 }),
    grain(35, 35, 60)
  ),
  look(
    "pushed-press-1600",
    "Pushed Press 1600",
    {
      tags: ["bw", "mono", "film", "pushed", "night", "grain", "kodak", "tri-x"],
      inspiredBy: "Kodak Tri-X pushed to 1600",
      description: "Pushed hard: inky shadows and big grain."
    },
    mono({ red: -5, blue: 8 }),
    sCurve(50),
    tone({ contrast: 25, blacks: -25, shadows: -15, whites: 10 }),
    grain(55, 45, 75)
  ),
  look(
    "smooth-mono-100",
    "Smooth Mono 100",
    {
      tags: ["bw", "mono", "film", "fine grain", "kodak", "t-max", "100"],
      inspiredBy: "Kodak T-MAX 100",
      description: "Smooth, modern and nearly grainless."
    },
    mono({ red: 14, orange: 10, blue: -4 }),
    tone({ contrast: 6, highlights: -10, shadows: 6 }),
    wheel("global", 220, 4),
    grain(6, 12, 25)
  ),
  look(
    "smooth-mono-400",
    "Smooth Mono 400",
    {
      tags: ["bw", "mono", "film", "kodak", "t-max", "400"],
      inspiredBy: "Kodak T-MAX 400",
      description: "Clean modern mono with a little more grain."
    },
    mono({ red: 10, orange: 8 }),
    sCurve(22),
    tone({ whites: 8, blacks: -4 }),
    grain(15, 20, 40)
  ),
  look(
    "night-mono-3200",
    "Night Mono 3200",
    {
      tags: ["bw", "mono", "film", "night", "grain", "kodak", "t-max", "p3200"],
      inspiredBy: "Kodak T-MAX P3200",
      description: "Low-light mono with soft blacks and large grain."
    },
    mono({ red: 8, orange: 6 }),
    tone({ contrast: 22, shadows: -12 }),
    fade(0.03),
    grain(60, 50, 70)
  ),
  look(
    "classic-press-400",
    "Classic Press 400",
    {
      tags: ["bw", "mono", "film", "press", "ilford", "hp5", "400"],
      inspiredBy: "Ilford HP5 Plus",
      description: "Forgiving, classic mono with medium grain."
    },
    mono({ orange: 4, blue: 4 }),
    sCurve(15),
    tone({ highlights: -12, shadows: 12 }),
    grain(30, 32, 55)
  ),
  look(
    "fine-classic-125",
    "Fine Classic 125",
    {
      tags: ["bw", "mono", "film", "fine grain", "ilford", "fp4", "125"],
      inspiredBy: "Ilford FP4 Plus",
      description: "Traditional, fine-grained mono."
    },
    mono({ yellow: 10, orange: 8, red: 4, blue: -4 }),
    sCurve(18),
    tone({ highlights: -14, shadows: 8 }),
    grain(10, 18, 35)
  ),
  look(
    "ultra-fine-50",
    "Ultra-Fine 50",
    {
      tags: ["bw", "mono", "film", "fine grain", "contrast", "ilford", "pan f", "50"],
      inspiredBy: "Ilford Pan F Plus 50",
      description: "Contrasty, deep and almost grainless."
    },
    mono({ red: -15, orange: -10, blue: 6 }),
    sCurve(40),
    tone({ contrast: 10, blacks: -10 }),
    grain(4, 10, 20)
  ),
  look(
    "modern-fine-100",
    "Modern Fine 100",
    {
      tags: ["bw", "mono", "film", "fine grain", "ilford", "delta", "100"],
      inspiredBy: "Ilford Delta 100",
      description: "Crisp modern tabular-grain mono."
    },
    mono({ yellow: 5, green: 5, blue: -6 }),
    sCurve(18),
    tone({ whites: 14, blacks: -8 }),
    presence({ clarity: 14 }),
    grain(6, 12, 25)
  ),
  look(
    "night-grain-3200",
    "Night Grain 3200",
    {
      tags: ["bw", "mono", "film", "night", "grain", "ilford", "delta", "3200"],
      inspiredBy: "Ilford Delta 3200",
      description: "Soft, grainy and atmospheric."
    },
    mono({ orange: 6 }),
    tone({ contrast: -8, shadows: 12, highlights: -12 }),
    fade(0.05),
    grain(65, 55, 80)
  ),
  look(
    "chromogenic-mono",
    "Chromogenic Mono",
    {
      tags: ["bw", "mono", "film", "c41", "smooth", "ilford", "xp2"],
      inspiredBy: "Ilford XP2 Super",
      description: "Smooth, faintly warm mono from colour chemistry."
    },
    mono({ orange: 8, yellow: 4 }),
    tone({ contrast: -12, highlights: -18, shadows: 8 }),
    rolloff(0.03),
    wheel("global", 35, 7),
    grain(8, 15, 30)
  ),
  look(
    "budget-classic-100",
    "Budget Classic 100",
    {
      tags: ["bw", "mono", "film", "vintage", "foma", "fomapan", "100"],
      inspiredBy: "Fomapan 100 Classic",
      description: "Old-fashioned tonality with soft highlights."
    },
    mono({ red: -18, orange: -10, blue: 14, aqua: 8 }),
    tone({ contrast: 15, highlights: -15 }),
    fade(0.015),
    grain(15, 22, 45)
  ),
  look(
    "smooth-sky-100",
    "Smooth Sky 100",
    {
      tags: ["bw", "mono", "film", "fine grain", "sky", "fuji", "acros ii", "100"],
      inspiredBy: "Fujifilm Neopan Acros II 100",
      description: "Fine grain and gently deepened skies."
    },
    mono({ blue: -32, aqua: -18, yellow: 8 }),
    sCurve(30),
    tone({ blacks: -10, highlights: -6 }),
    grain(8, 12, 25)
  )
]);
const FILM_COLOUR = collection("film/colour", [
  look(
    "fine-portrait-160",
    "Fine Portrait 160",
    {
      tags: ["film", "portrait", "skin", "soft", "kodak", "portra", "160"],
      inspiredBy: "Kodak Portra 160",
      description: "Low contrast, gentle saturation and creamy skin; fine grain."
    },
    tone({ contrast: -10, highlights: -15 }),
    fade(0.02),
    rolloff(0.02),
    presence({ saturation: -12 }),
    split(180, 5, 45, 6),
    hsl({ orange: [0, -5, 5], blue: [0, -15, 0] }),
    foliage(5, -15, 0),
    grain(8, 18, 35)
  ),
  look(
    "warm-portrait-400",
    "Warm Portrait 400",
    {
      tags: ["film", "portrait", "warm", "wedding", "kodak", "portra", "400"],
      inspiredBy: "Kodak Portra 400",
      description: "The classic portrait negative: warm skin, soft greens, long highlights."
    },
    tone({ contrast: -5, highlights: -15 }),
    fade(0.03),
    rolloff(0.02),
    presence({ saturation: -5 }),
    split(170, 6, 42, 10),
    hsl({ orange: [-2, 0, 6], blue: [-10, -10, 0] }),
    foliage(10, -15, 0),
    grain(15, 22, 40)
  ),
  look(
    "warm-portrait-800",
    "Warm Portrait 800",
    {
      tags: ["film", "portrait", "warm", "low light", "kodak", "portra", "800"],
      inspiredBy: "Kodak Portra 800",
      description: "Richer, warmer and grainier, with a green lean in the shadows."
    },
    tone({ contrast: 8, highlights: -12 }),
    fade(0.03),
    presence({ saturation: 8 }),
    split(150, 12, 40, 16),
    hsl({ red: [0, 8, 0], orange: [-2, 10, 4], green: [8, -10, 0] }),
    grain(28, 30, 55)
  ),
  look(
    "vivid-landscape-100",
    "Vivid Landscape 100",
    {
      tags: ["film", "landscape", "saturated", "fine grain", "kodak", "ektar", "100"],
      inspiredBy: "Kodak Ektar 100",
      description: "Saturated, fine-grained landscape negative; skin runs red."
    },
    tone({ contrast: 20 }),
    presence({ saturation: 25 }),
    hsl({ red: [0, 20, 0], orange: [-4, 20, 0], blue: [0, 20, -10] }),
    grain(5, 15, 30)
  ),
  look(
    "golden-consumer-200",
    "Golden Consumer 200",
    {
      tags: ["film", "warm", "golden", "nostalgic", "kodak", "gold", "200"],
      inspiredBy: "Kodak Gold 200",
      description: "Golden, sunny consumer film with yellowed greens."
    },
    tone({ contrast: 10 }),
    presence({ saturation: 10 }),
    wheel("midtones", 45, 10),
    wheel("highlights", 50, 18),
    hsl({ blue: [0, -10, 0] }),
    foliage(-10, 0, 0),
    grain(22, 28, 50)
  ),
  look(
    "punchy-consumer-400",
    "Punchy Consumer 400",
    {
      tags: ["film", "punchy", "saturated", "everyday", "kodak", "ultramax", "400"],
      inspiredBy: "Kodak UltraMax 400",
      description: "Punchy everyday colour with strong reds."
    },
    tone({ contrast: 15 }),
    presence({ saturation: 15 }),
    split(150, 8, 45, 10),
    hsl({ red: [0, 15, 0] }),
    grain(25, 30, 55)
  ),
  look(
    "budget-warm-200",
    "Budget Warm 200",
    {
      tags: ["film", "warm", "budget", "soft", "kodak", "colorplus", "200"],
      inspiredBy: "Kodak ColorPlus 200",
      description: "Warm, soft and a little grainy, with muted blues."
    },
    tone({ contrast: 5 }),
    presence({ saturation: 5, texture: -10 }),
    wheel("global", 45, 12),
    hsl({ blue: [0, -15, 0] }),
    grain(28, 32, 55)
  ),
  look(
    "clean-slide-100",
    "Clean Slide 100",
    {
      tags: ["slide", "film", "clean", "cool", "kodak", "ektachrome", "e100"],
      inspiredBy: "Kodak Ektachrome E100",
      description: "Clean, slightly cool slide film with crisp blues."
    },
    tone({ contrast: 20, blacks: -5 }),
    presence({ saturation: 10 }),
    wheel("global", 210, 6),
    hsl({ blue: [0, 15, 0] }),
    grain(5, 15, 30)
  ),
  look(
    "classic-slide-64",
    "Classic Slide 64",
    {
      tags: ["slide", "film", "vintage", "rich", "kodak", "kodachrome", "64"],
      inspiredBy: "Kodak Kodachrome 64",
      description: "Rich reds and yellows, deep blue skies and dense blacks."
    },
    sCurve(40),
    tone({ blacks: -5 }),
    presence({ saturation: 10 }),
    split(200, 6, 45, 8),
    hsl({
      red: [0, 20, -5],
      yellow: [0, 15, 0],
      green: [-5, -10, 0],
      blue: [-8, 10, -15]
    }),
    grain(8, 18, 35)
  ),
  look(
    "saturated-slide-50",
    "Saturated Slide 50",
    {
      tags: ["slide", "film", "saturated", "landscape", "fuji", "velvia", "50"],
      inspiredBy: "Fujifilm Velvia 50 (film)",
      description: "Maximum saturation, magenta shadows and dark skies."
    },
    sCurve(40),
    tone({ contrast: 10 }),
    presence({ saturation: 40 }),
    wheel("shadows", 300, 10),
    hsl({ red: [-8, 20, 0], blue: [0, 0, -20] }),
    foliage(0, 30, 0),
    grain(4, 12, 25)
  ),
  look(
    "neutral-slide-100",
    "Neutral Slide 100",
    {
      tags: ["slide", "film", "neutral", "fuji", "provia", "100f"],
      inspiredBy: "Fujifilm Provia 100F (film)",
      description: "An honest, neutral slide film."
    },
    sCurve(30),
    tone({ blacks: -10 }),
    presence({ saturation: 6 }),
    wheel("global", 210, 7),
    hsl({ blue: [0, 10, -10] }),
    grain(5, 15, 30)
  ),
  look(
    "green-cast-consumer-400",
    "Green-Cast Consumer 400",
    {
      tags: ["film", "green", "consumer", "fuji", "superia", "400"],
      inspiredBy: "Fujifilm Superia X-TRA 400",
      description: "Everyday film with green shadows and vivid greens."
    },
    tone({ contrast: 10 }),
    presence({ saturation: 10 }),
    wheel("shadows", 155, 12),
    hsl({ orange: [-3, 0, 0] }),
    foliage(10, 10, 0),
    grain(25, 30, 55)
  ),
  look(
    "airy-pastel-400",
    "Airy Pastel 400",
    {
      tags: ["film", "pastel", "airy", "wedding", "mint", "fuji", "400h"],
      inspiredBy: "Fujifilm Pro 400H",
      description: "Bright, airy pastels with mint greens."
    },
    tone({ contrast: -20, shadows: 15, whites: 10 }),
    fade(0.04),
    presence({ saturation: -10 }),
    split(180, 10, 60, 5),
    hsl({ orange: [0, 0, 5] }),
    foliage(20, -10, 0),
    grain(15, 22, 40)
  ),
  look(
    "cool-portrait-160",
    "Cool Portrait 160",
    {
      tags: ["film", "portrait", "cool", "fuji", "pro 160ns"],
      inspiredBy: "Fujifilm Pro 160NS",
      description: "Cool, low-contrast portrait negative."
    },
    tone({ contrast: -15, highlights: -10 }),
    fade(0.02),
    presence({ saturation: -12 }),
    split(170, 12, 60, 5),
    hsl({ orange: [0, -5, 6] }),
    foliage(12, -5, 0),
    grain(8, 18, 35)
  ),
  look(
    "budget-cool-200",
    "Budget Cool 200",
    {
      tags: ["film", "cool", "green", "budget", "fuji", "c200"],
      inspiredBy: "Fujicolor C200",
      description: "Cool, green-leaning budget film."
    },
    sCurve(15),
    presence({ saturation: 5 }),
    wheel("global", 150, 10),
    wheel("shadows", 170, 12),
    hsl({ yellow: [8, 5, 0], green: [10, 10, 0], blue: [0, -10, 0] }),
    grain(25, 30, 55)
  ),
  look(
    "low-light-soft-1600",
    "Low-Light Soft 1600",
    {
      tags: ["film", "low light", "soft", "grain", "fuji", "natura", "1600"],
      inspiredBy: "Fujifilm Natura 1600",
      description: "Soft, natural low-light colour with generous grain."
    },
    tone({ contrast: -10, shadows: 12 }),
    fade(0.04),
    presence({ saturation: -8 }),
    split(150, 12, 40, 10),
    grain(35, 35, 60)
  ),
  look(
    "red-bias-consumer-200",
    "Red-Bias Consumer 200",
    {
      tags: ["film", "red", "consumer", "agfa", "vista", "200"],
      inspiredBy: "Agfa Vista 200",
      description: "Punchy reds and deep blue skies."
    },
    tone({ contrast: 15 }),
    presence({ saturation: 15 }),
    wheel("global", 15, 6),
    hsl({ red: [0, 20, 0], blue: [0, 15, -10] }),
    grain(22, 28, 50)
  ),
  look(
    "tungsten-night-800",
    "Tungsten Night 800",
    {
      tags: ["film", "night", "tungsten", "neon", "halation", "cinestill", "800t"],
      inspiredBy: "CineStill 800T",
      description: "Tungsten night film: cool light, teal shadows and red-glowing highlights."
    },
    tone({ contrast: 12 }),
    presence({ saturation: -5 }),
    split(190, 22, 30, 10),
    wheel("global", 215, 14),
    hsl({ red: [0, 12, 0] }),
    halationApprox(60),
    grain(30, 30, 55)
  ),
  look(
    "clean-daylight-50",
    "Clean Daylight 50",
    {
      tags: ["film", "daylight", "clean", "fine grain", "cinestill", "50d"],
      inspiredBy: "CineStill 50D",
      description: "Clean, saturated, very fine-grained daylight film."
    },
    sCurve(28),
    presence({ saturation: 15 }),
    wheel("global", 205, 6),
    hsl({ blue: [-5, 15, -8], aqua: [0, 10, 0] }),
    halationApprox(25),
    grain(6, 15, 30)
  ),
  look(
    "warm-daylight-400",
    "Warm Daylight 400",
    {
      tags: ["film", "daylight", "warm", "cinestill", "400d"],
      inspiredBy: "CineStill 400D",
      description: "Warm daylight film with a soft glow."
    },
    sCurve(20),
    presence({ saturation: 6 }),
    split(195, 8, 40, 18),
    hsl({ orange: [0, 8, 0] }),
    halationApprox(35),
    grain(22, 28, 50)
  ),
  look(
    "toy-colour-800",
    "Toy Colour 800",
    {
      tags: ["film", "lomo", "saturated", "vignette", "lomography", "800"],
      inspiredBy: "Lomography Color Negative 800",
      description: "Loud, warm colour, dark corners and plenty of grain."
    },
    tone({ contrast: 20 }),
    presence({ saturation: 20 }),
    wheel("global", 20, 8),
    vignette(-20),
    grain(30, 32, 60)
  ),
  look(
    "purple-swap",
    "Purple Swap",
    {
      tags: ["film", "creative", "purple", "false colour", "lomochrome"],
      inspiredBy: "LomoChrome Purple",
      description: "Greens pushed toward purple and blues toward green: an approximation of the full swap."
    },
    fade(0.03),
    calib({ greenHue: 100, blueHue: -80 }),
    hsl({ green: [100, 10, 0], aqua: [60, 0, 0], blue: [-80, 0, 0] }),
    approximates("hueSwap"),
    grain(20, 28, 50)
  ),
  look(
    "metro-desat",
    "Metro Desat",
    {
      tags: ["film", "desaturated", "urban", "contrast", "lomochrome", "metropolis"],
      inspiredBy: "LomoChrome Metropolis",
      description: "Drained urban colour with warm tones kept."
    },
    tone({ contrast: 25 }),
    presence({ saturation: -50 }),
    hsl({ red: [0, 20, 0], yellow: [0, 20, 0] }),
    grain(25, 30, 55)
  ),
  look(
    "ir-false-colour",
    "IR False Colour",
    {
      tags: ["film", "infrared", "false colour", "creative", "kodak", "aerochrome"],
      inspiredBy: "Kodak Aerochrome infrared film",
      description: "Foliage turned red-magenta: an approximation of infrared colour."
    },
    calib({ redHue: -60, greenHue: -100, greenSaturation: 40 }),
    hsl({ green: [-100, 50, 10], yellow: [-100, 30, 0], blue: [-30, 10, 0] }),
    approximates("hueSwap")
  ),
  look(
    "cross-processed-slide",
    "Cross-Processed Slide",
    {
      tags: ["film", "cross process", "creative", "saturated"],
      inspiredBy: "Slide film cross-processed in C-41",
      description: "Blown contrast, cyan shadows and yellow highlights."
    },
    tone({ contrast: 35 }),
    presence({ saturation: 25 }),
    split(210, 25, 70, 30),
    rgb({
      g: [
        [0, 0],
        [0.5, 0.56],
        [1, 1]
      ],
      b: [
        [0, 0.05],
        [0.5, 0.48],
        [1, 0.86]
      ]
    })
  ),
  look(
    "expired-film",
    "Expired Film",
    {
      tags: ["film", "expired", "faded", "vintage", "magenta"],
      inspiredBy: "Expired colour negative film",
      description: "Fogged blacks, shifted colour and heavy grain."
    },
    tone({ contrast: -15 }),
    fade(0.08),
    rolloff(0.04),
    presence({ saturation: -20 }),
    split(160, 15, 330, 10),
    grain(40, 38, 70)
  ),
  look(
    "drugstore-print",
    "Drugstore Print",
    {
      tags: ["film", "print", "nostalgic", "90s", "warm"],
      inspiredBy: "One-hour lab prints from the 1990s",
      description: "Bright, warm, slightly green-shadowed prints from the minilab."
    },
    sCurve(25),
    tone({ whites: 10 }),
    presence({ saturation: 10 }),
    split(150, 10, 45, 12),
    grain(20, 28, 50)
  )
]);
const FILM_INSTANT = collection("film/instant", [
  look(
    "instant-colour",
    "Instant Colour",
    {
      tags: ["instant", "polaroid", "faded", "square"],
      inspiredBy: "Polaroid 600 film",
      description: "Milky blacks, cyan shadows and soft, warm highlights."
    },
    tone({ contrast: -15 }),
    fade(0.08),
    presence({ saturation: -10, clarity: -10 }),
    split(190, 12, 60, 15),
    vignette(-15),
    bloomApprox(20)
  ),
  look(
    "faded-instant",
    "Faded Instant",
    {
      tags: ["instant", "polaroid", "faded", "vintage", "sx-70"],
      inspiredBy: "Aged Polaroid SX-70 prints",
      description: "An old, sun-faded instant print."
    },
    tone({ contrast: -25 }),
    fade(0.1),
    presence({ saturation: -25 }),
    wheel("global", 40, 25),
    vignette(-25)
  ),
  look(
    "instant-mono",
    "Instant Mono",
    {
      tags: ["bw", "mono", "instant", "polaroid"],
      inspiredBy: "Polaroid black-and-white film",
      description: "A soft, slightly warm instant mono."
    },
    mono(),
    tone({ contrast: -10 }),
    fade(0.06),
    wheel("global", 35, 6)
  ),
  look(
    "bright-instant",
    "Bright Instant",
    {
      tags: ["instant", "bright", "party", "instax"],
      inspiredBy: "Fujifilm Instax film",
      description: "Bright, clean and colourful, with cool shadows."
    },
    tone({ contrast: 10, whites: 15, shadows: 10 }),
    presence({ saturation: 10 }),
    wheel("shadows", 175, 10),
    hsl({ orange: [0, 0, 5] }),
    vignette(-10)
  )
]);
const insp$1 = (sim) => `Fujifilm ${sim} film simulation`;
const FUJIFILM = collection("camera/fujifilm", [
  look(
    "standard-slide",
    "Standard Slide",
    {
      tags: ["slide", "standard", "everyday", "provia", "fujifilm"],
      inspiredBy: insp$1("PROVIA/Standard"),
      description: "Balanced slide-film colour with a firm, clean curve."
    },
    sCurve(22),
    tone({ contrast: 6, blacks: -6 }),
    presence({ saturation: 8 }),
    wheel("shadows", 220, 5),
    hsl({ red: [0, 8, 0], green: [5, 6, 0], blue: [-4, 14, -10] })
  ),
  look(
    "vivid-slide",
    "Vivid Slide",
    {
      tags: ["slide", "vivid", "saturated", "landscape", "velvia", "fujifilm"],
      inspiredBy: insp$1("Velvia/Vivid"),
      description: "Dense, saturated slide colour for landscapes; skin is held back."
    },
    sCurve(35),
    tone({ contrast: 15, blacks: -8 }),
    presence({ saturation: 25, vibrance: 15 }),
    wheel("shadows", 290, 6),
    hsl({
      red: [-5, 15, 0],
      orange: [0, -5, 0],
      blue: [0, 20, -15],
      purple: [0, 15, 0],
      magenta: [0, 15, 0]
    }),
    foliage(0, 25, -5)
  ),
  look(
    "soft-slide",
    "Soft Slide",
    {
      tags: ["slide", "soft", "portrait", "astia", "fujifilm"],
      inspiredBy: insp$1("ASTIA/Soft"),
      description: "Slide colour with gentle highlights and kind skin."
    },
    sCurve(15),
    tone({ highlights: -22, shadows: 8 }),
    rolloff(0.02),
    presence({ saturation: 10 }),
    wheel("highlights", 30, 6),
    hsl({ orange: [-3, -8, 8], green: [5, 14, 0], blue: [0, 16, -6], aqua: [0, 10, 0] })
  ),
  look(
    "documentary-chrome",
    "Documentary Chrome",
    {
      tags: ["chrome", "documentary", "muted", "street", "classic chrome", "fujifilm"],
      inspiredBy: insp$1("Classic Chrome"),
      description: "Muted, hard-shadowed reportage colour with olive greens."
    },
    tone({ contrast: 15, shadows: -10, highlights: -8 }),
    presence({ saturation: -20 }),
    split(200, 8, 50, 8),
    hsl({
      red: [5, -15, 0],
      yellow: [0, -20, 0],
      green: [-10, -25, 0],
      blue: [-8, -10, -10]
    }),
    grain(10, 20, 40)
  ),
  look(
    "classic-negative",
    "Classic Negative",
    {
      tags: ["negative", "film", "street", "nostalgic", "classic neg", "fujifilm"],
      inspiredBy: insp$1("Classic Neg."),
      description: "Hard tonality and a crossover cast: teal shadows, warm highlights."
    },
    sCurve(40),
    fade(0.02),
    presence({ saturation: -10 }),
    rgb({
      r: [
        [0, 0],
        [0.25, 0.22],
        [0.75, 0.79],
        [1, 1]
      ],
      b: [
        [0, 0.03],
        [0.25, 0.28],
        [0.75, 0.72],
        [1, 0.97]
      ]
    }),
    split(180, 15, 40, 10),
    hsl({
      red: [-5, 0, 0],
      orange: [-3, 0, 0],
      yellow: [0, -15, 0],
      green: [15, -15, 0],
      blue: [-10, 0, 0]
    }),
    grain(15, 20, 40)
  ),
  look(
    "amber-nostalgia",
    "Amber Nostalgia",
    {
      tags: ["negative", "amber", "warm", "nostalgic", "nostalgic neg", "fujifilm"],
      inspiredBy: insp$1("Nostalgic Neg."),
      description: "Amber highlights, open shadows and rosy skin, like an old print."
    },
    tone({ contrast: -5, shadows: 15 }),
    fade(0.03),
    rolloff(0.02),
    presence({ saturation: 5 }),
    split(35, 8, 42, 20),
    wheel("global", 40, 4),
    hsl({ orange: [-3, 5, 0], blue: [10, 0, 0] }),
    foliage(-15, 0, 0),
    grain(10, 20, 40)
  ),
  look(
    "natural-negative",
    "Natural Negative",
    {
      tags: ["negative", "natural", "true colour", "reala", "fujifilm"],
      inspiredBy: insp$1("REALA ACE"),
      description: "Faithful colour with a crisp top and soft shadows."
    },
    sCurve(15),
    tone({ highlights: 6, shadows: 14 }),
    fade(0.02),
    presence({ saturation: -6 }),
    split(195, 8, 50, 5),
    hsl({ red: [0, -12, 0], yellow: [-5, -6, 0], green: [6, -8, 0] })
  ),
  look(
    "studio-portrait-hi",
    "Studio Portrait Hi",
    {
      tags: ["portrait", "studio", "skin", "pro neg", "fujifilm"],
      inspiredBy: insp$1("PRO Neg. Hi"),
      description: "Portrait negative with a little more bite for flat light."
    },
    sCurve(25),
    tone({ highlights: -14 }),
    presence({ saturation: -12 }),
    split(200, 10, 40, 6),
    hsl({ orange: [0, -6, 6], green: [6, -12, 0], blue: [0, -8, 0] })
  ),
  look(
    "studio-portrait-soft",
    "Studio Portrait Soft",
    {
      tags: ["portrait", "studio", "soft", "skin", "pro neg", "fujifilm"],
      inspiredBy: insp$1("PRO Neg. Std"),
      description: "Low-contrast portrait negative with quiet greens and blues."
    },
    tone({ contrast: -20, shadows: 10 }),
    presence({ saturation: -15 }),
    split(185, 8, 35, 6),
    hsl({ orange: [0, -4, 6], green: [5, -10, 0], blue: [0, -10, 0] })
  ),
  look(
    "cinema-flat",
    "Cinema Flat",
    {
      tags: ["cinema", "flat", "muted", "film", "eterna", "fujifilm"],
      inspiredBy: insp$1("ETERNA/Cinema"),
      description: "Low contrast, low saturation cinema stock with teal shadows."
    },
    tone({ contrast: -30, highlights: -15 }),
    fade(0.03),
    rolloff(0.02),
    presence({ saturation: -35 }),
    split(185, 15, 55, 6),
    hsl({ red: [0, -20, 0], orange: [0, -10, 0], blue: [0, -10, 0] }),
    foliage(12, -20, 0)
  ),
  look(
    "cinema-bleach",
    "Cinema Bleach",
    {
      tags: ["bleach bypass", "gritty", "desaturated", "cinema", "eterna", "fujifilm"],
      inspiredBy: insp$1("ETERNA Bleach Bypass"),
      description: "Silver-retained contrast with the colour drained out."
    },
    sCurve(45),
    tone({ contrast: 25 }),
    presence({ clarity: 15, saturation: -55 }),
    wheel("shadows", 170, 8)
  ),
  look(
    "fine-grain-mono",
    "Fine-Grain Mono",
    {
      tags: ["bw", "mono", "fine grain", "acros", "fujifilm"],
      inspiredBy: insp$1("ACROS"),
      description: "Rich blacks, smooth highlights and a fine, tight grain."
    },
    mono({ red: 4, blue: -4 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    "fine-grain-mono-yellow",
    "Fine-Grain Mono Yellow",
    {
      tags: ["bw", "mono", "yellow filter", "acros", "fujifilm"],
      inspiredBy: insp$1("ACROS + Ye filter"),
      description: "A yellow filter: skies a touch deeper, skin a touch lighter."
    },
    mono({ yellow: 20, orange: 15, blue: -20 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    "fine-grain-mono-red",
    "Fine-Grain Mono Red",
    {
      tags: ["bw", "mono", "red filter", "dramatic sky", "acros", "fujifilm"],
      inspiredBy: insp$1("ACROS + R filter"),
      description: "A red filter: dark, dramatic skies and glowing skin."
    },
    mono({ red: 40, orange: 30, blue: -45, aqua: -20 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    "fine-grain-mono-green",
    "Fine-Grain Mono Green",
    {
      tags: ["bw", "mono", "green filter", "foliage", "acros", "fujifilm"],
      inspiredBy: insp$1("ACROS + G filter"),
      description: "A green filter: bright foliage, deeper lips and skin."
    },
    mono({ green: 30, yellow: 10, red: -15 }),
    sCurve(32),
    tone({ highlights: -14, blacks: -12 }),
    presence({ clarity: 6 }),
    grain(20, 15, 30)
  ),
  look(
    "clean-mono",
    "Clean Mono",
    {
      tags: ["bw", "mono", "clean", "monochrome", "fujifilm"],
      inspiredBy: insp$1("Monochrome"),
      description: "A plain, grainless black and white."
    },
    mono({ green: 8, yellow: 6, red: -4 }),
    tone({ contrast: -6, highlights: -8, shadows: 10 })
  ),
  look(
    "sepia-print",
    "Sepia Print",
    {
      tags: ["bw", "sepia", "toned", "vintage", "fujifilm"],
      inspiredBy: insp$1("Sepia"),
      description: "A warm brown-toned print."
    },
    mono(),
    tone({ contrast: -5 }),
    fade(0.02),
    split(30, 30, 45, 25)
  )
]);
const HASSELBLAD = collection("camera/hasselblad", [
  look(
    "natural-colour",
    "Natural Colour",
    {
      tags: ["natural", "accurate", "medium format", "hncs", "hasselblad"],
      inspiredBy: "Hasselblad Natural Colour Solution",
      description: "True hues, a gentle film curve and very long highlights."
    },
    sCurve(22),
    rolloff(0.03),
    tone({ highlights: -18, shadows: 6 }),
    presence({ vibrance: 10 }),
    // Yellow-greens tamed and blues deepened: the "true" medium-format rendering.
    hsl({ orange: [0, -3, 3], yellow: [-4, -12, 0], green: [6, -6, 0], blue: [0, 8, -8] })
  ),
  look(
    "natural-portrait",
    "Natural Portrait",
    {
      tags: ["portrait", "skin", "natural", "medium format", "hasselblad"],
      inspiredBy: "Hasselblad Natural Colour Solution (portrait)",
      description: "Natural colour tuned for even, creamy skin."
    },
    sCurve(12),
    rolloff(0.03),
    tone({ highlights: -18, shadows: 10 }),
    presence({ texture: -12 }),
    wheel("highlights", 35, 8),
    hsl({ orange: [-3, -6, 10], red: [0, -8, 4], yellow: [0, -8, 0] })
  ),
  look(
    "panoramic-travel",
    "Panoramic Travel",
    {
      tags: ["travel", "landscape", "warm", "film", "xpan", "hasselblad"],
      inspiredBy: "Hasselblad XPan travel film",
      description: "A warm, slightly faded travel film look for wide frames."
    },
    sCurve(22),
    fade(0.03),
    tone({ highlights: -12 }),
    presence({ saturation: -8 }),
    split(200, 12, 40, 16),
    wheel("global", 40, 6),
    hsl({ blue: [-6, -10, 0] }),
    foliage(10, -15, 0),
    grain(12, 20, 40)
  )
]);
const insp = (name) => `Leica ${name}`;
const LEICA = collection("camera/leica", [
  look(
    "quiet-natural",
    "Quiet Natural",
    {
      tags: ["natural", "accurate", "subtle", "leica"],
      inspiredBy: insp("Looks: Natural"),
      description: "Accurate colour with a long, quiet highlight roll-off."
    },
    sCurve(12),
    tone({ highlights: -22, shadows: 6 }),
    rolloff(0.03),
    presence({ saturation: -8 }),
    hsl({ yellow: [0, -10, 0], green: [5, -10, 0] })
  ),
  look(
    "contemporary-clean",
    "Contemporary Clean",
    {
      tags: ["contemporary", "clean", "modern", "leica"],
      inspiredBy: insp("Looks: Contemporary"),
      description: "Clean modern contrast with smooth mid-to-highlight transitions."
    },
    sCurve(25),
    tone({ highlights: -10, blacks: -6 }),
    presence({ saturation: 6, clarity: 8 }),
    split(205, 10, 30, 4),
    hsl({ red: [0, 6, -4], blue: [0, 10, -8] })
  ),
  look(
    "analog-cinema",
    "Analog Cinema",
    {
      tags: ["classic", "analog", "film", "cinema", "leica"],
      inspiredBy: insp("Looks: Classic"),
      description: "Soft, faded film character with teal shadows and warm highlights."
    },
    tone({ contrast: -5, highlights: -10 }),
    fade(0.03),
    presence({ saturation: -15 }),
    split(190, 10, 45, 12),
    grain(8, 20, 40)
  ),
  look(
    "eternal-punch",
    "Eternal Punch",
    {
      tags: ["punchy", "saturated", "contrast", "bold", "leica"],
      inspiredBy: insp("Looks: Eternal"),
      description: "Bold contrast and colour; lovely at half strength."
    },
    tone({ contrast: 30, blacks: -5 }),
    presence({ saturation: 25 }),
    wheel("global", 320, 4)
  ),
  look(
    "muted-slide",
    "Muted Slide",
    {
      tags: ["chrome", "slide", "muted", "restrained", "leica"],
      inspiredBy: insp("Looks: Chrome"),
      description: "Slide-like restraint: firm contrast, quiet colour."
    },
    tone({ contrast: 18 }),
    presence({ saturation: -25 }),
    split(195, 8, 50, 10),
    hsl({ yellow: [0, -20, 0], green: [0, -25, 0] })
  ),
  look(
    "teal-tone",
    "Teal Tone",
    {
      tags: ["teal", "cool", "cinematic", "leica"],
      inspiredBy: insp("Looks: Teal"),
      description: "Teal shadows with skin protected."
    },
    tone({ contrast: 10 }),
    split(185, 25, 35, 10),
    hsl({ orange: [0, 5, 0], blue: [-15, 0, 0] })
  ),
  look(
    "brass-tone",
    "Brass Tone",
    {
      tags: ["brass", "warm", "gold", "vintage", "leica"],
      inspiredBy: insp("Looks: Brass"),
      description: "Golden midtones and soft blacks, blues pulled back."
    },
    tone({ contrast: 5 }),
    fade(0.02),
    wheel("midtones", 45, 20),
    wheel("highlights", 50, 15),
    hsl({ blue: [0, -30, 0] })
  ),
  look(
    "blue-tone",
    "Blue Tone",
    {
      tags: ["blue", "cool", "monochromatic", "mood", "leica"],
      inspiredBy: insp("Looks: Blue"),
      description: "A cool blue cast over muted colour."
    },
    tone({ contrast: 10 }),
    presence({ saturation: -30 }),
    wheel("global", 215, 25),
    wheel("shadows", 225, 20)
  ),
  look(
    "selenium-mono",
    "Selenium Mono",
    {
      tags: ["bw", "mono", "selenium", "toned", "leica"],
      inspiredBy: insp("Looks: Selenium"),
      description: "Deep blacks with a cool purple-brown selenium tone."
    },
    mono(),
    tone({ contrast: 20 }),
    wheel("shadows", 280, 12)
  ),
  look(
    "sensor-mono",
    "Sensor Mono",
    {
      tags: ["bw", "mono", "panchromatic", "tonal", "leica", "monochrom"],
      inspiredBy: insp("M Monochrom"),
      description: "A long, even tonal scale from a sensor that sees only light."
    },
    mono({ red: 10, orange: 8, yellow: 4 }),
    sCurve(15),
    tone({ shadows: 15, highlights: -20, blacks: -6 }),
    presence({ clarity: 8 }),
    grain(6, 15, 30)
  )
]);
const MOVIES = collection("movies", [
  look(
    "rain-city-noir",
    "Rain City Noir",
    {
      tags: ["noir", "dark", "moody", "amber", "rain", "the batman", "batman"],
      inspiredBy: "The Batman (2022)",
      description: "Crushed blacks and amber-red light in a drowned, blue-less city."
    },
    sCurve(45),
    tone({ whites: -25, highlights: -25, shadows: -20, blacks: -15 }),
    rolloff(0.04),
    presence({ saturation: -30 }),
    wheel("midtones", 28, 25),
    wheel("shadows", 20, 15),
    hsl({ red: [0, 25, -5], orange: [-4, 5, -5], aqua: [0, -60, 0], blue: [0, -60, -10] }),
    foliage(0, -50, 0),
    vignette(-20, { feather: 70 }),
    grain(12, 22, 45)
  ),
  look(
    "bronze-age-epic",
    "Bronze Age Epic",
    {
      tags: ["epic", "warm", "large format", "film", "the odyssey", "odyssey", "nolan", "imax"],
      inspiredBy: "The Odyssey (2026), shot on IMAX 65mm film",
      description: "Large-format film printed warm: open highlights, rich fire-lit interiors, fine grain."
    },
    sCurve(25),
    rolloff(0.02),
    tone({ highlights: -12 }),
    presence({ saturation: -5 }),
    wheel("midtones", 30, 20),
    wheel("highlights", 40, 16),
    wheel("shadows", 20, 8),
    hsl({ orange: [0, 5, 0], blue: [-5, -15, 0] }),
    foliage(5, -15, 0),
    grain(4, 12, 25)
  ),
  look(
    "desert-ochre",
    "Desert Ochre",
    {
      tags: ["desert", "ochre", "muted", "epic", "dune"],
      inspiredBy: "Dune (2021)",
      description: "Ochre haze over muted colour: no green, little blue, soft film texture."
    },
    tone({ contrast: -5 }),
    fade(0.02),
    presence({ saturation: -28 }),
    wheel("global", 35, 18),
    hsl({ orange: [0, 0, 5], blue: [0, -30, 0] }),
    foliage(0, -50, 0),
    grain(10, 20, 40)
  ),
  look(
    "golden-spice",
    "Golden Spice",
    {
      tags: ["desert", "golden", "warm", "epic", "dune", "part two"],
      inspiredBy: "Dune: Part Two (2024)",
      description: "Hot, golden sand light with firmer contrast."
    },
    tone({ contrast: 15 }),
    presence({ saturation: -10 }),
    wheel("global", 35, 20),
    wheel("highlights", 40, 15),
    hsl({ blue: [0, -30, 0] }),
    foliage(0, -50, 0)
  ),
  look(
    "infrared-arena",
    "Infrared Arena",
    {
      tags: ["bw", "mono", "infrared", "stark", "dune", "part two", "giedi prime"],
      inspiredBy: "Dune: Part Two (2024), the infrared arena",
      description: "Infrared-style mono: glowing skin and foliage, black skies."
    },
    mono({ green: 80, yellow: 60, red: 40, orange: 40, blue: -70, aqua: -50 }),
    tone({ contrast: 35 }),
    bloomApprox(20)
  ),
  look(
    "orange-haze-city",
    "Orange Haze City",
    {
      tags: ["orange", "haze", "dystopia", "sci-fi", "blade runner 2049"],
      inspiredBy: "Blade Runner 2049 (2017), the abandoned city",
      description: "Everything drowned in orange dust; only warm colour survives."
    },
    tone({ contrast: -20 }),
    fade(0.06),
    wheel("global", 35, 40),
    wheel("shadows", 30, 30),
    hsl({
      red: [0, -30, 0],
      aqua: [0, -60, 0],
      blue: [0, -60, 0],
      purple: [0, -60, 0],
      magenta: [0, -60, 0]
    }),
    foliage(0, -60, 0),
    bloomApprox(30)
  ),
  look(
    "cold-smog",
    "Cold Smog",
    {
      tags: ["cold", "smog", "neon", "sci-fi", "blade runner 2049"],
      inspiredBy: "Blade Runner 2049 (2017), the city at night",
      description: "Cold, smoggy and drained, with neon magentas left alive."
    },
    tone({ contrast: -10 }),
    fade(0.05),
    presence({ saturation: -40 }),
    wheel("shadows", 200, 20),
    wheel("midtones", 210, 8),
    hsl({ magenta: [0, 40, 0], purple: [0, 30, 0] }),
    bloomApprox(20),
    grain(6, 15, 30)
  ),
  look(
    "wasteland-teal-orange",
    "Wasteland Teal Orange",
    {
      tags: ["teal", "orange", "saturated", "desert", "action", "mad max", "fury road"],
      inspiredBy: "Mad Max: Fury Road (2015)",
      description: "Blazing orange desert against hard teal sky, everything turned up."
    },
    tone({ contrast: 30, blacks: -5 }),
    presence({ saturation: 35, clarity: 15 }),
    hsl({ orange: [0, 30, -5], aqua: [0, 25, 0], blue: [-20, 30, 0] })
  ),
  look(
    "black-and-chrome-wasteland",
    "Black & Chrome Wasteland",
    {
      tags: ["bw", "mono", "desert", "contrast", "mad max", "fury road", "black and chrome"],
      inspiredBy: "Mad Max: Fury Road — Black & Chrome Edition",
      description: "Bright sand and skin against black skies, hard and bright."
    },
    mono({ orange: 30, yellow: 20, blue: -50, aqua: -40 }),
    tone({ contrast: 50 }),
    presence({ clarity: 20 })
  ),
  look(
    "code-green",
    "Code Green",
    {
      tags: ["green", "sci-fi", "cyberpunk", "the matrix", "matrix"],
      inspiredBy: "The Matrix (1999), inside the code",
      description: "A sickly green cast over hard contrast, reds and blues drained."
    },
    tone({ contrast: 25, blacks: -10 }),
    presence({ saturation: -35 }),
    wheel("global", 120, 12),
    wheel("midtones", 115, 30),
    wheel("shadows", 125, 25),
    hsl({ red: [0, -40, 0], blue: [0, -40, 0] })
  ),
  look(
    "steel-blue-reality",
    "Steel Blue Reality",
    {
      tags: ["blue", "cold", "sci-fi", "the matrix", "matrix"],
      inspiredBy: "The Matrix (1999), the real world",
      description: "Cold steel blue over muted colour."
    },
    tone({ contrast: 15 }),
    presence({ saturation: -30 }),
    wheel("global", 215, 20)
  ),
  look(
    "sickly-stairway",
    "Sickly Stairway",
    {
      tags: ["sickly", "green", "yellow", "gritty", "joker"],
      inspiredBy: "Joker (2019)",
      description: "Sodium-lit city: green-teal shadows and nicotine highlights."
    },
    tone({ contrast: 10 }),
    presence({ saturation: -15 }),
    split(165, 15, 55, 12),
    hsl({ green: [0, 5, 0], yellow: [0, 5, 0] }),
    grain(15, 25, 50)
  ),
  look(
    "atomic-colour",
    "Atomic Colour",
    {
      tags: ["film", "warm", "large format", "period", "oppenheimer", "nolan"],
      inspiredBy: "Oppenheimer (2023), the colour sequences",
      description: "Warm large-format print with dense blacks."
    },
    sCurve(30),
    tone({ blacks: -5 }),
    presence({ saturation: 5 }),
    wheel("highlights", 40, 10),
    hsl({ orange: [0, 5, 0] }),
    grain(4, 12, 25)
  ),
  look(
    "atomic-mono",
    "Atomic Mono",
    {
      tags: ["bw", "mono", "contrast", "large format", "oppenheimer", "nolan"],
      inspiredBy: "Oppenheimer (2023), the black-and-white sequences",
      description: "Hard, bright, large-format black and white."
    },
    mono({ red: -6, orange: -4, blue: 6 }),
    sCurve(50),
    tone({ contrast: 20, whites: 25, highlights: 10, blacks: -5 }),
    presence({ clarity: 10 }),
    grain(8, 12, 25)
  ),
  look(
    "dust-and-ice",
    "Dust & Ice",
    {
      tags: ["dust", "film", "sci-fi", "muted", "interstellar", "nolan"],
      inspiredBy: "Interstellar (2014)",
      description: "Dusty, warm and slightly muted, on film."
    },
    sCurve(20),
    presence({ saturation: -15 }),
    wheel("global", 40, 12),
    wheel("shadows", 200, 10),
    hsl({ blue: [0, -20, 0] }),
    foliage(10, -20, 0),
    grain(8, 18, 35)
  ),
  look(
    "border-desert",
    "Border Desert",
    {
      tags: ["desert", "thriller", "hard", "muted", "sicario"],
      inspiredBy: "Sicario (2015)",
      description: "Hard desert light, deep blacks and muted warmth."
    },
    tone({ contrast: 25, blacks: -10 }),
    presence({ saturation: -25 }),
    wheel("global", 35, 10),
    wheel("shadows", 30, 8)
  ),
  look(
    "neon-drive",
    "Neon Drive",
    {
      tags: ["neon", "night", "magenta", "teal", "synthwave", "drive"],
      inspiredBy: "Drive (2011)",
      description: "Teal night and hot magenta neon, warm skin."
    },
    tone({ contrast: 15 }),
    wheel("shadows", 190, 20),
    hsl({ magenta: [10, 30, 0], purple: [0, 20, 0], orange: [0, 5, 0] }),
    bloomApprox(20)
  ),
  look(
    "green-and-gold-whimsy",
    "Green & Gold Whimsy",
    {
      tags: ["whimsical", "green", "gold", "red", "paris", "amelie"],
      inspiredBy: "Amélie (2001)",
      description: "Green and gold everywhere, bright reds, the blues all but gone."
    },
    tone({ contrast: 10 }),
    presence({ saturation: 10 }),
    wheel("midtones", 70, 20),
    wheel("highlights", 45, 15),
    hsl({ red: [0, 20, 0], blue: [-25, -30, 0] }),
    foliage(-10, 15, 0)
  ),
  look(
    "crimson-melancholy",
    "Crimson Melancholy",
    {
      tags: ["red", "romantic", "moody", "hong kong", "in the mood for love", "wong kar-wai"],
      inspiredBy: "In the Mood for Love (2000)",
      description: "Deep reds and emerald greens under warm lamplight."
    },
    tone({ contrast: 25, blacks: -5 }),
    wheel("global", 35, 12),
    hsl({ red: [0, 30, -10] }),
    foliage(10, 10, 0),
    bloomApprox(15),
    grain(20, 25, 50)
  ),
  look(
    "neon-grain-nights",
    "Neon Grain Nights",
    {
      tags: ["neon", "night", "grain", "hong kong", "chungking express", "wong kar-wai"],
      inspiredBy: "Chungking Express (1994) and Fallen Angels (1995)",
      description: "Green-cast night, smeared neon reds and rough grain."
    },
    tone({ contrast: 30 }),
    wheel("shadows", 160, 20),
    hsl({ red: [0, 20, 0] }),
    bloomApprox(15),
    grain(45, 40, 75)
  ),
  look(
    "pastel-hotel",
    "Pastel Hotel",
    {
      tags: ["pastel", "pink", "symmetry", "whimsical", "grand budapest", "wes anderson"],
      inspiredBy: "The Grand Budapest Hotel (2014)",
      description: "Candy pinks and lavender, bright and storybook."
    },
    tone({ contrast: -5 }),
    presence({ saturation: 15 }),
    wheel("global", 35, 6),
    hsl({
      red: [10, 0, 10],
      aqua: [0, 0, 10],
      purple: [0, 30, 10],
      magenta: [0, 30, 10]
    })
  ),
  look(
    "rain-rot",
    "Rain Rot",
    {
      tags: ["dark", "gritty", "rain", "thriller", "silver retention", "se7en", "fincher"],
      inspiredBy: "Se7en (1995)",
      description: "Silver-retained: crushed blacks, drained colour, a sour yellow-green."
    },
    sCurve(45),
    tone({ contrast: 20, blacks: -10 }),
    presence({ saturation: -40 }),
    wheel("midtones", 70, 12),
    grain(25, 28, 55)
  ),
  look(
    "cyan-rot",
    "Cyan Rot",
    {
      tags: ["cyan", "green", "grimy", "fight club", "fincher"],
      inspiredBy: "Fight Club (1999)",
      description: "Grimy cyan-green shadows and dirty yellow highlights."
    },
    tone({ contrast: 30 }),
    presence({ saturation: -30 }),
    split(160, 20, 60, 10),
    grain(20, 25, 50)
  ),
  look(
    "amber-dorm",
    "Amber Dorm",
    {
      tags: ["amber", "warm", "dim", "drama", "the social network", "fincher"],
      inspiredBy: "The Social Network (2010)",
      description: "Dim amber interiors with the blues held right down."
    },
    tone({ whites: -20, highlights: -15 }),
    rolloff(0.02),
    wheel("midtones", 50, 22),
    hsl({ blue: [-10, -40, 0] })
  ),
  look(
    "interrogation-olive",
    "Interrogation Olive",
    {
      tags: ["olive", "muted", "period", "crime", "mindhunter", "zodiac", "fincher"],
      inspiredBy: "Mindhunter (2017–2019) and Zodiac (2007)",
      description: "Muted olive-yellow period tone, blues pulled back."
    },
    tone({ contrast: 10 }),
    presence({ saturation: -25 }),
    wheel("midtones", 75, 15),
    hsl({ blue: [0, -30, 0] })
  ),
  look(
    "miami-cyan",
    "Miami Cyan",
    {
      tags: ["cyan", "saturated", "skin", "night", "moonlight"],
      inspiredBy: "Moonlight (2016)",
      description: "Saturated cyans and teals with rich, deep skin."
    },
    tone({ contrast: 20 }),
    presence({ saturation: 15 }),
    split(185, 20, 40, 8),
    hsl({ orange: [0, 10, -8], aqua: [0, 20, 0] })
  ),
  look(
    "coral-warmth",
    "Coral Warmth",
    {
      tags: ["coral", "warm", "soft", "romantic", "her"],
      inspiredBy: "Her (2013)",
      description: "Soft coral reds and peaches, no blue at all."
    },
    tone({ contrast: -15 }),
    fade(0.03),
    wheel("global", 25, 10),
    hsl({ red: [5, 15, 0], orange: [5, 15, 0], blue: [0, -60, 0], aqua: [0, -40, 0] }),
    bloomApprox(25)
  ),
  look(
    "golden-hour-jet",
    "Golden Hour Jet",
    {
      tags: ["golden hour", "action", "warm", "teal sky", "top gun", "maverick"],
      inspiredBy: "Top Gun: Maverick (2022)",
      description: "Big golden-hour warmth against teal sky."
    },
    tone({ contrast: 20 }),
    split(205, 12, 40, 22),
    hsl({ orange: [0, 20, 0], blue: [-10, 0, 0] })
  ),
  look(
    "neon-assassin",
    "Neon Assassin",
    {
      tags: ["neon", "night", "action", "teal", "magenta", "john wick"],
      inspiredBy: "John Wick: Chapters 2–4",
      description: "Inky blacks, teal shadows and saturated neon."
    },
    tone({ contrast: 30, blacks: -10 }),
    wheel("shadows", 190, 25),
    hsl({ magenta: [0, 30, 0], purple: [0, 20, 0], blue: [-15, 0, 0], orange: [0, -10, 0] })
  ),
  look(
    "club-purple",
    "Club Purple",
    {
      tags: ["purple", "neon", "party", "teen", "euphoria"],
      inspiredBy: "Euphoria (2019–)",
      description: "Purple and magenta club light, saturated and grainy."
    },
    tone({ contrast: 20 }),
    presence({ saturation: 20 }),
    split(275, 20, 320, 10),
    hsl({ purple: [0, 30, 0], magenta: [0, 30, 0] }),
    halationApprox(20),
    grain(15, 22, 45)
  ),
  look(
    "dream-pink",
    "Dream Pink",
    {
      tags: ["pink", "saturated", "bright", "plastic", "barbie"],
      inspiredBy: "Barbie (2023)",
      description: "Bright, saturated and very, very pink."
    },
    tone({ contrast: 10, whites: 10 }),
    presence({ saturation: 30 }),
    hsl({ red: [15, 20, 0], magenta: [0, 35, 0], purple: [10, 20, 0] })
  ),
  look(
    "eighties-small-town",
    "Eighties Small Town",
    {
      tags: ["80s", "nostalgic", "warm", "night blue", "stranger things"],
      inspiredBy: "Stranger Things (2016–2025)",
      description: "Warm interiors, blue nights and soft film blacks."
    },
    fade(0.03),
    tone({ contrast: 10 }),
    presence({ saturation: 8 }),
    wheel("midtones", 40, 16),
    wheel("shadows", 215, 22),
    hsl({ red: [0, 12, 0] }),
    grain(15, 22, 45)
  ),
  look(
    "tobacco-desert",
    "Tobacco Desert",
    {
      tags: ["yellow", "desert", "warm", "crime", "breaking bad"],
      inspiredBy: "Breaking Bad (2008–2013)",
      description: "Heavy tobacco yellow under vivid desert-blue sky."
    },
    tone({ contrast: 20 }),
    wheel("midtones", 48, 35),
    wheel("highlights", 50, 25),
    hsl({ blue: [-5, 20, 0] })
  ),
  look(
    "sepia-dust-bowl",
    "Sepia Dust Bowl",
    {
      tags: ["sepia", "dust", "yellow", "period", "o brother"],
      inspiredBy: "O Brother, Where Art Thou? (2000)",
      description: "Green foliage turned to dry gold under a sepia cast."
    },
    tone({ contrast: 10 }),
    presence({ saturation: -15 }),
    wheel("global", 45, 25),
    hsl({ aqua: [-20, -40, 0] }),
    foliage(-40, -60, 0)
  ),
  look(
    "yellow-border",
    "Yellow Border",
    {
      tags: ["yellow", "hot", "grainy", "crime", "traffic"],
      inspiredBy: "Traffic (2000)",
      description: "Blown, burning yellow and heavy grain."
    },
    tone({ contrast: 40 }),
    presence({ saturation: -20 }),
    wheel("global", 50, 40),
    grain(40, 38, 70)
  ),
  look(
    "frozen-natural",
    "Frozen Natural",
    {
      tags: ["cold", "natural light", "winter", "wilderness", "the revenant"],
      inspiredBy: "The Revenant (2015)",
      description: "Cold natural light, muted colour, blue-steel shadows."
    },
    tone({ contrast: 10 }),
    presence({ saturation: -30 }),
    wheel("shadows", 210, 12),
    hsl({ orange: [0, -10, 0] })
  ),
  look(
    "bleach-war",
    "Bleach War",
    {
      tags: ["war", "bleach bypass", "gritty", "desaturated", "saving private ryan"],
      inspiredBy: "Saving Private Ryan (1998)",
      description: "Drained, harsh and grainy: colour almost gone."
    },
    sCurve(45),
    tone({ contrast: 20, whites: 15, blacks: -5 }),
    presence({ saturation: -60 }),
    wheel("shadows", 190, 8),
    grain(35, 32, 65)
  ),
  look(
    "wartime-mono",
    "Wartime Mono",
    {
      tags: ["bw", "mono", "period", "drama", "schindler's list"],
      inspiredBy: "Schindler's List (1993)",
      description: "Documentary black and white. (The film’s single red coat needs a colour mask.)"
    },
    mono({ red: -10, orange: -6 }),
    sCurve(25),
    tone({ contrast: 10, highlights: -15, shadows: -8 }),
    fade(0.02),
    grain(25, 28, 55),
    approximates("selectiveColour")
  ),
  look(
    "frontier-dust",
    "Frontier Dust",
    {
      tags: ["western", "dust", "sci-fi", "warm", "the mandalorian"],
      inspiredBy: "The Mandalorian (2019–)",
      description: "A dusty, warm western with soft blacks."
    },
    tone({ contrast: 5 }),
    fade(0.02),
    presence({ saturation: -15 }),
    wheel("global", 35, 12),
    grain(8, 18, 35)
  ),
  look(
    "patriarch-amber",
    "Patriarch Amber",
    {
      tags: ["amber", "dark", "period", "crime", "the godfather"],
      inspiredBy: "The Godfather (1972)",
      description: "Dark amber interiors and deep, falling-off shadows."
    },
    tone({ contrast: 25, whites: -20, highlights: -15, blacks: -10 }),
    presence({ saturation: -10 }),
    wheel("midtones", 45, 25),
    grain(20, 25, 50)
  ),
  look(
    "grey-dystopia",
    "Grey Dystopia",
    {
      tags: ["grey", "desaturated", "dystopia", "bleak", "children of men"],
      inspiredBy: "Children of Men (2006)",
      description: "Bleak, grey and almost colourless."
    },
    tone({ contrast: 10 }),
    presence({ saturation: -45 }),
    wheel("shadows", 170, 10),
    grain(20, 25, 50)
  ),
  look(
    "tokyo-hush",
    "Tokyo Hush",
    {
      tags: ["soft", "night", "city", "dreamy", "lost in translation"],
      inspiredBy: "Lost in Translation (2003)",
      description: "Soft, hushed city nights with pink and blue neon."
    },
    tone({ contrast: -15 }),
    fade(0.03),
    presence({ saturation: -5 }),
    hsl({ magenta: [0, 15, 0], blue: [0, 15, 0] }),
    bloomApprox(20),
    grain(12, 20, 40)
  ),
  look(
    "milky-overcast",
    "Milky Overcast",
    {
      tags: ["overcast", "muted", "soft", "sci-fi", "arrival"],
      inspiredBy: "Arrival (2016)",
      description: "Milky, overcast and nearly colourless."
    },
    tone({ contrast: -25 }),
    fade(0.07),
    rolloff(0.03),
    presence({ saturation: -35 }),
    wheel("global", 180, 5)
  ),
  look(
    "kitchen-heat",
    "Kitchen Heat",
    {
      tags: ["kitchen", "warm", "fluorescent", "gritty", "the bear"],
      inspiredBy: "The Bear (2022–)",
      description: "Hot, greenish-yellow kitchen light and hard contrast."
    },
    tone({ contrast: 20 }),
    presence({ saturation: -12 }),
    wheel("midtones", 60, 20),
    wheel("highlights", 50, 10),
    hsl({ yellow: [0, 10, 0] }),
    grain(10, 20, 40)
  ),
  look(
    "old-money-muted",
    "Old Money Muted",
    {
      tags: ["muted", "corporate", "cool", "drama", "succession"],
      inspiredBy: "Succession (2018–2023)",
      description: "Expensive, muted and slightly cool."
    },
    tone({ contrast: -5 }),
    presence({ saturation: -15 }),
    wheel("shadows", 200, 5),
    grain(6, 15, 30)
  ),
  look(
    "candy-arena",
    "Candy Arena",
    {
      tags: ["candy", "mint", "pink", "saturated", "squid game"],
      inspiredBy: "Squid Game (2021–2025)",
      description: "Mint greens and candy pinks, clean and bright."
    },
    tone({ contrast: 10 }),
    presence({ saturation: 15 }),
    wheel("shadows", 170, 8),
    hsl({ red: [10, 15, 0], green: [25, 25, 0], aqua: [0, 20, 5], magenta: [0, 40, 5] })
  ),
  look(
    "sterile-office",
    "Sterile Office",
    {
      tags: ["sterile", "office", "green", "cold", "severance"],
      inspiredBy: "Severance (2022–)",
      description: "Clinical green-tinged whites and muted colour, greens kept."
    },
    tone({ contrast: 5, whites: 10 }),
    presence({ saturation: -25 }),
    split(170, 15, 165, 5),
    hsl({ green: [0, 25, 0] })
  ),
  look(
    "orthochromatic-mono",
    "Orthochromatic Mono",
    {
      tags: ["bw", "mono", "orthochromatic", "vintage", "gritty", "the lighthouse"],
      inspiredBy: "The Lighthouse (2019)",
      description: "Old orthochromatic stock: dark reds and skin, pale blues, heavy grain."
    },
    mono({ red: -80, orange: -50, yellow: -20, blue: 60, aqua: 40 }),
    tone({ contrast: 35 }),
    vignette(-20),
    grain(40, 38, 70)
  ),
  look(
    "digital-wide-mono",
    "Digital Wide Mono",
    {
      tags: ["bw", "mono", "clean", "wide", "roma"],
      inspiredBy: "Roma (2018)",
      description: "A clean, wide-range digital black and white."
    },
    mono({ blue: -8, aqua: -4, yellow: 6 }),
    tone({ contrast: 5, shadows: 22, highlights: -25, whites: 10 }),
    presence({ clarity: 8 })
  ),
  look(
    "vintage-studio-mono",
    "Vintage Studio Mono",
    {
      tags: ["bw", "mono", "vintage", "hollywood", "1930s", "mank"],
      inspiredBy: "Mank (2020)",
      description: "Classic studio-era black and white with a soft glow."
    },
    mono({ red: 6, orange: 6 }),
    tone({ contrast: 15, highlights: -12 }),
    fade(0.03),
    vignette(-25, { feather: 70 }),
    bloomApprox(25),
    grain(30, 30, 55)
  ),
  look(
    "magic-hour-primaries",
    "Magic Hour Primaries",
    {
      tags: ["musical", "primaries", "dusk", "purple", "la la land"],
      inspiredBy: "La La Land (2016)",
      description: "Bold primaries against a purple dusk."
    },
    presence({ saturation: 20 }),
    wheel("shadows", 260, 15),
    hsl({ blue: [0, 25, 0], yellow: [0, 25, 0], red: [0, 25, 0] })
  ),
  look(
    "crimson-chapter",
    "Crimson Chapter",
    {
      tags: ["red", "wuxia", "monochromatic", "epic", "hero"],
      inspiredBy: "Hero (2002), the red chapter",
      description: "A whole world washed in red."
    },
    presence({ saturation: -20 }),
    wheel("global", 0, 40),
    hsl({ red: [0, 30, 0] })
  ),
  look(
    "muted-16mm-romance",
    "Muted 16mm Romance",
    {
      tags: ["16mm", "muted", "romance", "period", "grain", "carol"],
      inspiredBy: "Carol (2015)",
      description: "Muted, olive-leaning period colour on grainy 16mm."
    },
    fade(0.04),
    presence({ saturation: -20 }),
    foliage(-10, -30, 0),
    grain(35, 35, 60)
  ),
  look(
    "infrared-day-for-night",
    "Infrared Day for Night",
    {
      tags: ["day for night", "night", "blue", "horror", "nope"],
      inspiredBy: "Nope (2022)",
      description: "Daylight turned to clear blue night."
    },
    tone({ contrast: 20, highlights: -45, whites: -45, shadows: -25 }),
    presence({ saturation: -50 }),
    wheel("global", 215, 30)
  ),
  look(
    "bright-folk-horror",
    "Bright Folk Horror",
    {
      tags: ["bright", "pastel", "summer", "horror", "midsommar"],
      inspiredBy: "Midsommar (2019)",
      description: "Relentless bright daylight in soft pastels."
    },
    tone({ contrast: -10, whites: 20, shadows: 20 }),
    presence({ saturation: 10 }),
    wheel("global", 60, 8)
  ),
  look(
    "shanghai-neon",
    "Shanghai Neon",
    {
      tags: ["neon", "night", "cyan", "spy", "skyfall", "bond"],
      inspiredBy: "Skyfall (2012), the Shanghai tower",
      description: "Silhouettes against cyan and blue neon."
    },
    tone({ contrast: 25, blacks: -15 }),
    split(195, 25, 190, 10),
    hsl({ aqua: [0, 25, 0], blue: [0, 20, 0] })
  ),
  look(
    "overgrown-ruin",
    "Overgrown Ruin",
    {
      tags: ["post-apocalyptic", "green", "muted", "the last of us"],
      inspiredBy: "The Last of Us (2023–)",
      description: "Muted, cool ruins overrun with soft greens."
    },
    tone({ contrast: 10 }),
    fade(0.02),
    presence({ saturation: -22 }),
    split(190, 15, 50, 6),
    hsl({ green: [-5, 15, 0], yellow: [-15, 0, 0] }),
    grain(10, 20, 40)
  )
]);
const pc = (name) => `Nikon Picture Control ${name}`;
const cpc = (name) => `Nikon Creative Picture Control ${name}`;
const NIKON = collection("camera/nikon", [
  look(
    "crisp-standard",
    "Crisp Standard",
    {
      tags: ["standard", "everyday", "nikon"],
      inspiredBy: pc("Standard"),
      description: "Balanced contrast with slightly yellow greens."
    },
    tone({ contrast: 14, blacks: -5 }),
    presence({ saturation: 10 }),
    wheel("global", 55, 4),
    hsl({ yellow: [-8, 12, 0], green: [-12, 8, 0], blue: [0, 0, -6] })
  ),
  look(
    "even-neutral",
    "Even Neutral",
    {
      tags: ["neutral", "flat", "grading", "nikon"],
      inspiredBy: pc("Neutral"),
      description: "Gentle contrast and colour to build on."
    },
    tone({ contrast: -15 }),
    presence({ saturation: -10 })
  ),
  look(
    "bold-vivid",
    "Bold Vivid",
    {
      tags: ["vivid", "saturated", "punchy", "nikon"],
      inspiredBy: pc("Vivid"),
      description: "Strong contrast and saturated blues and greens."
    },
    tone({ contrast: 22 }),
    presence({ saturation: 20 }),
    hsl({ yellow: [-8, 15, 0], green: [0, 25, 0], blue: [0, 25, -8] })
  ),
  look(
    "smooth-portrait",
    "Smooth Portrait",
    {
      tags: ["portrait", "skin", "soft", "nikon"],
      inspiredBy: pc("Portrait"),
      description: "Soft contrast and smooth, bright skin."
    },
    tone({ contrast: -8, shadows: 10 }),
    presence({ texture: -14, clarity: -6 }),
    wheel("global", 45, 7),
    hsl({ orange: [4, -6, 9], red: [0, -8, 0], yellow: [0, -6, 0] })
  ),
  look(
    "open-landscape",
    "Open Landscape",
    {
      tags: ["landscape", "nature", "green", "blue", "nikon"],
      inspiredBy: pc("Landscape"),
      description: "Rich greens and blues with extra punch."
    },
    tone({ contrast: 18, highlights: -10 }),
    presence({ vibrance: 15, clarity: 10 }),
    hsl({ yellow: [-10, 20, 0], green: [0, 30, -5], blue: [0, 30, -12], aqua: [0, 20, 0] })
  ),
  look(
    "log-flat",
    "Log Flat",
    {
      tags: ["flat", "log", "grading", "dynamic range", "nikon"],
      inspiredBy: pc("Flat"),
      description: "As much range as possible, ready to grade."
    },
    tone({ contrast: -40, shadows: 30, highlights: -30 }),
    presence({ saturation: -20 })
  ),
  look(
    "rich-tone-portrait",
    "Rich Tone Portrait",
    {
      tags: ["portrait", "skin", "rich", "zf", "nikon"],
      inspiredBy: pc("Rich Tone Portrait"),
      description: "Deep, saturated skin with soft highlights."
    },
    tone({ contrast: 8, highlights: -20, shadows: 6 }),
    presence({ vibrance: 14, texture: -8 }),
    wheel("midtones", 25, 8),
    hsl({ orange: [-3, 14, -6], red: [0, 10, -4], yellow: [0, -6, 0] })
  ),
  look(
    "soft-gradation-mono",
    "Soft Gradation Mono",
    {
      tags: ["bw", "mono", "soft", "flat", "warm", "nikon"],
      inspiredBy: pc("Flat Monochrome"),
      description: "A gentle, slightly warm monochrome with open tones."
    },
    mono(),
    tone({ contrast: -25, shadows: 10 }),
    fade(0.03),
    wheel("global", 40, 8)
  ),
  look(
    "deep-tone-mono",
    "Deep Tone Mono",
    {
      tags: ["bw", "mono", "deep", "dramatic", "nikon"],
      inspiredBy: pc("Deep Tone Monochrome"),
      description: "Heavy shadows and strong contrast."
    },
    mono(),
    tone({ contrast: 35, shadows: -25 }),
    presence({ clarity: 10 })
  ),
  look(
    "simple-mono",
    "Simple Mono",
    {
      tags: ["bw", "mono", "nikon"],
      inspiredBy: pc("Monochrome"),
      description: "A plain black and white with a little bite."
    },
    // Open mids and a yellow lean, the plain Monochrome control.
    mono({ yellow: 12, orange: 6, blue: -6 }),
    tone({ highlights: -18, shadows: 14 })
  ),
  look(
    "dream",
    "Dream",
    {
      tags: ["dreamy", "soft", "pastel", "creative", "nikon"],
      inspiredBy: cpc("Dream"),
      description: "Pale orange haze and softened detail."
    },
    tone({ contrast: -15, shadows: 15 }),
    wheel("global", 35, 15),
    bloomApprox(60)
  ),
  look(
    "morning",
    "Morning",
    {
      tags: ["morning", "cool", "fresh", "creative", "nikon"],
      inspiredBy: cpc("Morning"),
      description: "Fresh, cool and bright, like early light."
    },
    tone({ contrast: -10, shadows: 20, whites: 10 }),
    presence({ saturation: -5 }),
    wheel("global", 210, 12)
  ),
  look(
    "pop",
    "Pop",
    {
      tags: ["pop", "saturated", "bright", "creative", "nikon"],
      inspiredBy: cpc("Pop"),
      description: "Bright and loudly colourful."
    },
    tone({ contrast: 10, whites: 10 }),
    presence({ saturation: 45 })
  ),
  look(
    "sunday",
    "Sunday",
    {
      tags: ["warm", "relaxed", "bright", "creative", "nikon"],
      inspiredBy: cpc("Sunday"),
      description: "Warm, bright and easy-going."
    },
    tone({ shadows: 15, whites: 10 }),
    presence({ saturation: 10 }),
    wheel("global", 45, 10)
  ),
  look(
    "somber",
    "Somber",
    {
      tags: ["somber", "muted", "dark", "cool", "creative", "nikon"],
      inspiredBy: cpc("Somber"),
      description: "Dim, muted and cool."
    },
    tone({ contrast: -10, whites: -15, highlights: -10 }),
    presence({ saturation: -35 }),
    wheel("global", 210, 10)
  ),
  look(
    "dramatic",
    "Dramatic",
    {
      tags: ["dramatic", "contrast", "clarity", "creative", "nikon"],
      inspiredBy: cpc("Dramatic"),
      description: "Hard local contrast and drained colour."
    },
    tone({ contrast: 30, whites: 20 }),
    presence({ clarity: 35, saturation: -15 })
  ),
  look(
    "silence",
    "Silence",
    {
      tags: ["quiet", "muted", "faded", "cool", "creative", "nikon"],
      inspiredBy: cpc("Silence"),
      description: "Faded, cool and nearly colourless."
    },
    tone({ contrast: -15 }),
    fade(0.04),
    presence({ saturation: -45 }),
    wheel("global", 195, 10)
  ),
  look(
    "bleached",
    "Bleached",
    {
      tags: ["bleached", "desaturated", "gritty", "creative", "nikon"],
      inspiredBy: cpc("Bleached"),
      description: "Hard contrast, washed colour and a faint green."
    },
    tone({ contrast: 30 }),
    presence({ saturation: -50, clarity: 15 }),
    wheel("global", 130, 12)
  ),
  look(
    "melancholic",
    "Melancholic",
    {
      tags: ["melancholy", "faded", "magenta", "mood", "creative", "nikon"],
      inspiredBy: cpc("Melancholic"),
      description: "Faded, muted colour with a magenta sigh."
    },
    tone({ contrast: -10 }),
    fade(0.04),
    presence({ saturation: -25 }),
    wheel("global", 320, 12)
  ),
  look(
    "pure",
    "Pure",
    {
      tags: ["pure", "bright", "airy", "soft", "creative", "nikon"],
      inspiredBy: cpc("Pure"),
      description: "Bright, airy and veiled."
    },
    tone({ contrast: -25, shadows: 20, whites: 15 }),
    fade(0.05),
    presence({ saturation: -10 }),
    bloomApprox(40)
  ),
  look(
    "denim",
    "Denim",
    {
      tags: ["denim", "blue", "cool", "creative", "nikon"],
      inspiredBy: cpc("Denim"),
      description: "Washed indigo over everything."
    },
    tone({ contrast: 10 }),
    presence({ saturation: -20 }),
    wheel("global", 225, 35),
    hsl({ blue: [0, 20, 0] })
  ),
  look(
    "toy",
    "Toy",
    {
      tags: ["toy camera", "lomo", "vignette", "saturated", "creative", "nikon"],
      inspiredBy: cpc("Toy"),
      description: "Heavy corners and loud, yellowed colour."
    },
    tone({ contrast: 20 }),
    presence({ saturation: 20 }),
    wheel("global", 55, 12),
    vignette(-50, { feather: 45 })
  ),
  look(
    "sepia-colour",
    "Sepia Colour",
    {
      tags: ["sepia", "faded", "vintage", "creative", "nikon"],
      inspiredBy: cpc("Sepia"),
      description: "A trace of colour under a brown tone."
    },
    fade(0.03),
    presence({ saturation: -70 }),
    wheel("global", 35, 25)
  ),
  look(
    "blue-wash",
    "Blue Wash",
    {
      tags: ["blue", "tinted", "monochromatic", "creative", "nikon"],
      inspiredBy: cpc("Blue"),
      description: "Colour drained, then tinted blue."
    },
    presence({ saturation: -60 }),
    wheel("global", 215, 30)
  ),
  look(
    "red-wash",
    "Red Wash",
    {
      tags: ["red", "tinted", "monochromatic", "creative", "nikon"],
      inspiredBy: cpc("Red"),
      description: "Colour drained, then tinted red."
    },
    presence({ saturation: -60 }),
    wheel("global", 5, 30)
  ),
  look(
    "pink-wash",
    "Pink Wash",
    {
      tags: ["pink", "tinted", "monochromatic", "creative", "nikon"],
      inspiredBy: cpc("Pink"),
      description: "Colour drained, then tinted pink."
    },
    presence({ saturation: -55 }),
    wheel("global", 335, 25)
  ),
  look(
    "charcoal",
    "Charcoal",
    {
      tags: ["bw", "mono", "charcoal", "textured", "creative", "nikon"],
      inspiredBy: cpc("Charcoal"),
      description: "A smudged, textured mono like a charcoal drawing."
    },
    mono(),
    tone({ contrast: 10, whites: -20, highlights: -15, shadows: -15 }),
    fade(0.07),
    presence({ texture: 25, clarity: -10 }),
    grain(20, 35, 70)
  ),
  look(
    "graphite",
    "Graphite",
    {
      tags: ["bw", "mono", "graphite", "crisp", "creative", "nikon"],
      inspiredBy: cpc("Graphite"),
      description: "A hard, cool pencil-sharp mono."
    },
    mono(),
    tone({ contrast: 25 }),
    presence({ clarity: 30 }),
    wheel("global", 220, 5)
  ),
  look(
    "binary",
    "Binary",
    {
      tags: ["bw", "mono", "graphic", "two tone", "creative", "nikon"],
      inspiredBy: cpc("Binary"),
      description: "Nearly pure black and pure white."
    },
    mono(),
    curve("master", [
      [0, 0],
      [0.4, 0.06],
      [0.6, 0.94],
      [1, 1]
    ])
  ),
  look(
    "carbon",
    "Carbon",
    {
      tags: ["bw", "mono", "low key", "dark", "creative", "nikon"],
      inspiredBy: cpc("Carbon"),
      description: "A dark, low-key mono with deep blacks."
    },
    mono(),
    tone({ contrast: 30, whites: -20, shadows: -15, blacks: -10 })
  )
]);
const om = (name) => `OM System / Olympus ${name}`;
const px = (name) => `Pentax Custom Image ${name}`;
const ph = (name) => `iPhone Photographic Style ${name}`;
const OTHER_CAMERAS = collection("camera/other", [
  look(
    "vintage-one",
    "Vintage One",
    {
      tags: ["vintage", "warm", "faded", "om", "olympus"],
      inspiredBy: om("Vintage I"),
      description: "Faded with a warm, gentle cast."
    },
    tone({ contrast: -5 }),
    fade(0.04),
    presence({ saturation: -15 }),
    wheel("global", 40, 15)
  ),
  look(
    "vintage-olive",
    "Vintage Olive",
    {
      tags: ["vintage", "olive", "faded", "om", "olympus"],
      inspiredBy: om("Vintage II"),
      description: "Faded with an olive tint."
    },
    tone({ contrast: -10 }),
    fade(0.05),
    presence({ saturation: -20 }),
    wheel("global", 100, 10)
  ),
  look(
    "vintage-rose",
    "Vintage Rose",
    {
      tags: ["vintage", "rose", "magenta", "om", "olympus"],
      inspiredBy: om("Vintage III"),
      description: "Faded with a rosy cast."
    },
    fade(0.04),
    presence({ saturation: -10 }),
    wheel("global", 330, 10)
  ),
  look(
    "colour-creator-teal",
    "Colour Creator Teal",
    {
      tags: ["teal", "tinted", "creative", "om", "olympus"],
      inspiredBy: om("Color Creator"),
      description: "One hue for the whole picture: teal."
    },
    presence({ saturation: -20 }),
    wheel("global", 185, 20)
  ),
  look(
    "pale-and-light",
    "Pale & Light",
    {
      tags: ["pale", "airy", "bright", "pastel", "om", "olympus"],
      inspiredBy: om("Art Filter Pale & Light Color"),
      description: "Bright, pale and faintly blue."
    },
    tone({ contrast: -25, shadows: 25, whites: 15 }),
    fade(0.06),
    presence({ saturation: -20 }),
    wheel("highlights", 210, 10)
  ),
  look(
    "grainy-film",
    "Grainy Film",
    {
      tags: ["bw", "mono", "grain", "gritty", "om", "olympus"],
      inspiredBy: om("Art Filter Grainy Film"),
      description: "Hard mono with coarse grain."
    },
    mono({ blue: 10, red: -10 }),
    tone({ contrast: 60, highlights: 10, shadows: 10 }),
    fade(0.02),
    grain(70, 50, 80)
  ),
  look(
    "reversal-slide",
    "Reversal Slide",
    {
      tags: ["slide", "reversal", "saturated", "pentax"],
      inspiredBy: px("Reversal Film"),
      description: "Saturated slide colour with deep blues."
    },
    tone({ contrast: 25, blacks: -10 }),
    presence({ saturation: 15 }),
    wheel("shadows", 230, 10),
    hsl({ blue: [-6, 30, -20], aqua: [0, 15, -10], red: [0, 10, -5] })
  ),
  look(
    "silver-bleach",
    "Silver Bleach",
    {
      tags: ["bleach bypass", "desaturated", "contrast", "pentax"],
      inspiredBy: px("Bleach Bypass"),
      description: "Hard contrast with most colour gone."
    },
    tone({ contrast: 40 }),
    presence({ saturation: -55 })
  ),
  look(
    "muted-colour",
    "Muted Colour",
    {
      tags: ["muted", "calm", "pentax"],
      inspiredBy: px("Muted"),
      description: "Calm, quiet colour."
    },
    tone({ contrast: -5 }),
    presence({ saturation: -30 })
  ),
  look(
    "radiant",
    "Radiant",
    {
      tags: ["radiant", "bright", "warm", "pentax"],
      inspiredBy: px("Radiant"),
      description: "Bright and glowing with warmth."
    },
    tone({ whites: 10 }),
    presence({ saturation: 15 }),
    wheel("global", 40, 8)
  ),
  look(
    "amber-style",
    "Amber Style",
    {
      tags: ["amber", "warm", "phone", "iphone"],
      inspiredBy: ph("Amber"),
      description: "Amber warmth through the whole picture."
    },
    wheel("global", 35, 20),
    wheel("shadows", 25, 10),
    tone({ contrast: 8 })
  ),
  look(
    "gold-style",
    "Gold Style",
    {
      tags: ["gold", "warm", "phone", "iphone"],
      inspiredBy: ph("Gold"),
      description: "Golden light, colour lifted a touch."
    },
    wheel("global", 52, 18),
    wheel("highlights", 55, 12),
    tone({ shadows: 10, whites: 6 }),
    presence({ vibrance: 8 })
  ),
  look(
    "rose-gold",
    "Rose Gold",
    {
      tags: ["rose", "pink", "warm", "phone", "iphone"],
      inspiredBy: ph("Rose Gold"),
      description: "A warm pink glow."
    },
    wheel("global", 15, 14)
  ),
  look(
    "cool-rose",
    "Cool Rose",
    {
      tags: ["rose", "cool", "pink", "phone", "iphone"],
      inspiredBy: ph("Cool Rose"),
      description: "Cool with a rosy tint."
    },
    wheel("global", 290, 12)
  ),
  look(
    "vibrant-style",
    "Vibrant Style",
    {
      tags: ["vibrant", "saturated", "phone", "iphone"],
      inspiredBy: ph("Vibrant"),
      description: "Brighter, more vibrant colour."
    },
    tone({ shadows: 8, whites: 6 }),
    presence({ saturation: 18, vibrance: 25 })
  ),
  look(
    "natural-style",
    "Natural Style",
    {
      tags: ["natural", "subtle", "phone", "iphone"],
      inspiredBy: ph("Natural"),
      description: "Less processed, softer colour."
    },
    tone({ contrast: -10, highlights: -15, shadows: 12 }),
    presence({ saturation: -12, clarity: -5 }),
    hsl({ orange: [0, -5, 4], green: [0, -10, 0] })
  ),
  look(
    "luminous",
    "Luminous",
    {
      tags: ["luminous", "bright", "airy", "phone", "iphone"],
      inspiredBy: ph("Luminous"),
      description: "Bright shadows and gentle glow."
    },
    tone({ contrast: -10, shadows: 30, whites: 15, highlights: -10 }),
    presence({ vibrance: 15, clarity: -8 }),
    wheel("highlights", 45, 6)
  ),
  look(
    "dramatic-style",
    "Dramatic Style",
    {
      tags: ["dramatic", "contrast", "dark", "phone", "iphone"],
      inspiredBy: ph("Dramatic"),
      description: "Deep shadows and strong contrast."
    },
    tone({ contrast: 25, shadows: -20 }),
    presence({ saturation: 5 })
  ),
  look(
    "quiet",
    "Quiet",
    {
      tags: ["quiet", "faded", "muted", "phone", "iphone"],
      inspiredBy: ph("Quiet"),
      description: "Faded, muted and warm."
    },
    tone({ contrast: -15 }),
    fade(0.05),
    presence({ saturation: -25 }),
    wheel("global", 40, 8)
  ),
  look(
    "cozy",
    "Cozy",
    {
      tags: ["cozy", "warm", "dim", "phone", "iphone"],
      inspiredBy: ph("Cozy"),
      description: "Dim, warm and close."
    },
    tone({ whites: -10, highlights: -10 }),
    wheel("global", 35, 15)
  ),
  look(
    "ethereal",
    "Ethereal",
    {
      tags: ["ethereal", "dreamy", "pastel", "phone", "iphone"],
      inspiredBy: ph("Ethereal"),
      description: "Soft, light and faintly violet."
    },
    tone({ contrast: -20, whites: 10 }),
    fade(0.04),
    wheel("global", 260, 8)
  ),
  look(
    "muted-bw",
    "Muted B&W",
    {
      tags: ["bw", "mono", "soft", "phone", "iphone"],
      inspiredBy: ph("Muted B&W"),
      description: "A soft, faded black and white."
    },
    mono({ yellow: 6, blue: 6 }),
    tone({ contrast: -15, whites: -12, highlights: -10 }),
    fade(0.05),
    rolloff(0.04)
  ),
  look(
    "stark-bw",
    "Stark B&W",
    {
      tags: ["bw", "mono", "stark", "contrast", "phone", "iphone"],
      inspiredBy: ph("Stark B&W"),
      description: "A hard, deep black and white."
    },
    mono({ red: 8, orange: 8 }),
    tone({ contrast: 45, blacks: -25, shadows: -15, whites: 10 })
  ),
  look(
    "polar-split",
    "Polar Split",
    {
      tags: ["cool", "split", "clean", "phone", "iphone"],
      inspiredBy: ph("Cool"),
      description: "Cool shadows and clean whites."
    },
    split(210, 25, 200, 8),
    tone({ contrast: 10, whites: 10 }),
    presence({ saturation: -10 })
  )
]);
const lx = (name) => `Panasonic LUMIX ${name}`;
const PANASONIC = collection("camera/panasonic", [
  look(
    "classic-neo",
    "Classic Neo",
    {
      tags: ["classic", "soft", "nostalgic", "lumix", "panasonic"],
      inspiredBy: lx("L.Classic Neo"),
      description: "Soft blacks and gently nostalgic colour."
    },
    tone({ contrast: -10 }),
    fade(0.03),
    presence({ saturation: -10 }),
    wheel("highlights", 45, 14),
    hsl({ orange: [0, -5, 6], blue: [0, -10, 10] }),
    foliage(10, -15, 0),
    grain(12, 20, 40)
  ),
  look(
    "classic-shift",
    "Classic Shift",
    {
      tags: ["classic", "cinematic", "split", "lumix", "panasonic"],
      inspiredBy: lx("L.Classic"),
      description: "Colour that shifts with brightness: teal low, warm high."
    },
    tone({ contrast: 5 }),
    presence({ saturation: -15 }),
    split(190, 12, 45, 12)
  ),
  look(
    "gentle-mono",
    "Gentle Mono",
    {
      tags: ["bw", "mono", "warm", "lumix", "panasonic"],
      inspiredBy: lx("L.Monochrome"),
      description: "A faintly warm, even mono."
    },
    mono({ orange: 5 }),
    sCurve(12),
    tone({ shadows: 6 }),
    wheel("global", 40, 9)
  ),
  look(
    "dynamic-mono",
    "Dynamic Mono",
    {
      tags: ["bw", "mono", "dramatic", "lumix", "panasonic"],
      inspiredBy: lx("L.Monochrome D"),
      description: "Dramatic mono with bright whites and deep blacks."
    },
    mono({ red: 10, orange: 10, blue: -15 }),
    sCurve(30),
    tone({ contrast: 25, whites: 18, blacks: -18 }),
    presence({ clarity: 18 })
  ),
  look(
    "soft-mono",
    "Soft Mono",
    {
      tags: ["bw", "mono", "soft", "lumix", "panasonic"],
      inspiredBy: lx("L.Monochrome S"),
      description: "A soft, low-contrast mono."
    },
    mono({ orange: 6, green: 6 }),
    tone({ contrast: -22, highlights: -15, shadows: 15 }),
    fade(0.02),
    wheel("global", 220, 3)
  ),
  look(
    "cine-wide",
    "Cine Wide",
    {
      tags: ["cinema", "flat", "dynamic range", "video", "lumix", "panasonic"],
      inspiredBy: lx("Cinelike D2"),
      description: "Wide, flat cine gamma to grade from."
    },
    tone({ contrast: -35, highlights: -30, shadows: 25 }),
    presence({ saturation: -15 })
  ),
  look(
    "cine-contrast",
    "Cine Contrast",
    {
      tags: ["cinema", "contrast", "video", "lumix", "panasonic"],
      inspiredBy: lx("Cinelike V2"),
      description: "Cinematic contrast with soft highlights."
    },
    tone({ contrast: 15, highlights: -15 }),
    presence({ saturation: 5 }),
    hsl({ orange: [0, 5, 0] })
  )
]);
const gr = (name) => `Ricoh GR ${name}`;
const RICOH = collection("camera/ricoh", [
  look(
    "positive-film",
    "Positive Film",
    {
      tags: ["positive", "slide", "street", "ricoh"],
      inspiredBy: gr("Positive Film"),
      description: "Contrasty slide colour with a faint yellow-green."
    },
    tone({ contrast: 15 }),
    presence({ saturation: 20 }),
    wheel("global", 75, 6)
  ),
  look(
    "negative-film",
    "Negative Film",
    {
      tags: ["negative", "cool", "street", "blue", "ricoh"],
      inspiredBy: gr("Negative Film"),
      description: "Cool, low-saturation negative with blue shadows."
    },
    tone({ contrast: 25, whites: 10 }),
    presence({ saturation: -25 }),
    wheel("shadows", 210, 20),
    wheel("global", 205, 10)
  ),
  look(
    "street-bleach",
    "Street Bleach",
    {
      tags: ["bleach bypass", "gritty", "street", "ricoh"],
      inspiredBy: gr("Bleach Bypass"),
      description: "Hard and drained."
    },
    tone({ contrast: 40 }),
    presence({ saturation: -50 }),
    wheel("shadows", 200, 5)
  ),
  look(
    "retro-print",
    "Retro Print",
    {
      tags: ["retro", "vintage", "faded", "warm", "ricoh"],
      inspiredBy: gr("Retro"),
      description: "Faded, warm and vignetted."
    },
    tone({ contrast: -10 }),
    fade(0.05),
    presence({ saturation: -30 }),
    wheel("global", 45, 20),
    vignette(-25)
  ),
  look(
    "hi-contrast-street",
    "Hi-Contrast Street",
    {
      tags: ["bw", "mono", "street", "gritty", "contrast", "ricoh"],
      inspiredBy: gr("Hi-Contrast B&W"),
      description: "Inky blacks, blown whites and heavy grain."
    },
    mono(),
    tone({ contrast: 80, blacks: -20, whites: 20 }),
    presence({ clarity: 30 }),
    grain(60, 45, 80),
    vignette(-40)
  ),
  look(
    "cross-process",
    "Cross Process",
    {
      tags: ["cross process", "creative", "saturated", "ricoh"],
      inspiredBy: gr("Cross Process"),
      description: "Cyan shadows, yellow highlights, loud colour."
    },
    tone({ contrast: 25 }),
    presence({ saturation: 20 }),
    split(200, 25, 65, 25),
    rgb({
      b: [
        [0, 0.06],
        [0.5, 0.48],
        [1, 0.9]
      ]
    })
  ),
  look(
    "cinema-yellow",
    "Cinema Yellow",
    {
      tags: ["cinema", "yellow", "warm", "ricoh"],
      inspiredBy: gr("Cinema (Yellow)"),
      description: "Muted cinema colour with yellow mids."
    },
    tone({ contrast: 12 }),
    presence({ saturation: -18 }),
    wheel("midtones", 50, 22),
    wheel("highlights", 45, 16),
    wheel("shadows", 190, 8)
  ),
  look(
    "cinema-green",
    "Cinema Green",
    {
      tags: ["cinema", "green", "teal", "ricoh"],
      inspiredBy: gr("Cinema (Green)"),
      description: "Muted cinema colour with green mids."
    },
    tone({ contrast: 10 }),
    presence({ saturation: -15 }),
    wheel("midtones", 150, 12),
    wheel("shadows", 175, 10)
  ),
  look(
    "soft-monotone",
    "Soft Monotone",
    {
      tags: ["bw", "mono", "soft", "ricoh"],
      inspiredBy: gr("Soft Monotone"),
      description: "A soft, faded mono."
    },
    mono({ red: 6, orange: 6 }),
    tone({ contrast: -25, shadows: 10 }),
    fade(0.04),
    wheel("global", 30, 5)
  ),
  look(
    "hard-monotone",
    "Hard Monotone",
    {
      tags: ["bw", "mono", "hard", "ricoh"],
      inspiredBy: gr("Hard Monotone"),
      description: "A punchy, crisp mono."
    },
    mono({ blue: -12, aqua: -6 }),
    tone({ contrast: 35, highlights: -15, blacks: -12 }),
    presence({ clarity: 25, texture: 10 })
  )
]);
const SMART = collection("smart", [
  // ── Today: ranges, gradients, subject and background, AI steps ──
  look(
    "golden-subject",
    "Golden Subject",
    {
      tags: ["smart", "subject", "portrait", "warm", "cool", "separation"],
      description: "The subject warmed and lifted, the background cooled and quieted."
    },
    sCurve(15),
    mask("subject", "Subject", [part.subject()], {
      "wb.temperature": 14,
      "basic.exposure": 0.15,
      "presence.vibrance": 10
    }),
    mask("background", "Background", [part.background()], {
      "wb.temperature": -12,
      "presence.saturation": -15,
      "basic.exposure": -0.1
    })
  ),
  look(
    "subject-pop",
    "Subject Pop",
    {
      tags: ["smart", "subject", "pop", "separation", "portrait", "product"],
      description: "The subject brighter and crisper; the background a step darker."
    },
    tone({ contrast: 8 }),
    mask("subject", "Subject", [part.subject()], {
      "basic.exposure": 0.2,
      "presence.clarity": 15,
      "presence.texture": 10
    }),
    mask("background", "Background", [part.background()], {
      "basic.exposure": -0.35,
      "presence.saturation": -10
    })
  ),
  look(
    "quiet-background",
    "Quiet Background",
    {
      tags: ["smart", "background", "product", "clean", "muted", "subject"],
      description: "The background drained and softened so the subject carries the picture."
    },
    mask("background", "Background", [part.background()], {
      "presence.saturation": -60,
      "presence.clarity": -20,
      "basic.exposure": -0.2
    }),
    mask("subject", "Subject", [part.subject()], {
      "presence.vibrance": 15,
      "presence.clarity": 10
    }),
    tone({ contrast: 5 })
  ),
  look(
    "teal-water",
    "Teal Water",
    {
      tags: ["smart", "water", "sea", "teal", "colour range", "travel"],
      description: "Water and sea pushed toward clear teal, the rest left alone."
    },
    tone({ contrast: 6 }),
    mask(
      "water",
      "Water",
      [
        part.range({
          hue: { centre: 195, width: 50, softness: 30 },
          saturation: { centre: 0.55, width: 0.8, softness: 0.25 },
          smoothness: 30
        })
      ],
      {
        "hsl.aqua.hue": -10,
        "hsl.aqua.saturation": 30,
        "hsl.blue.hue": -20,
        "hsl.blue.saturation": 20,
        "basic.contrast": 10
      }
    )
  ),
  look(
    "autumn-turn",
    "Autumn Turn",
    {
      tags: ["smart", "foliage", "autumn", "fall", "colour range", "landscape"],
      description: "Green leaves turned to amber and rust; skies and skin untouched."
    },
    split(200, 8, 40, 12),
    mask(
      "leaves",
      "Leaves",
      [
        part.range({
          hue: { centre: 85, width: 60, softness: 30 },
          saturation: { centre: 0.5, width: 0.8, softness: 0.25 },
          smoothness: 30
        })
      ],
      {
        "hsl.yellow.hue": -60,
        "hsl.green.hue": -100,
        "hsl.yellow.saturation": 20,
        "hsl.green.saturation": 10,
        "hsl.green.luminance": -10
      }
    )
  ),
  look(
    "lush-greens",
    "Lush Greens",
    {
      tags: ["smart", "foliage", "green", "colour range", "landscape", "nature"],
      description: "Deeper, richer foliage; everything else as it was."
    },
    mask(
      "leaves",
      "Leaves",
      [
        part.range({
          hue: { centre: 95, width: 60, softness: 30 },
          saturation: { centre: 0.5, width: 0.8, softness: 0.25 },
          smoothness: 30
        })
      ],
      {
        "hsl.yellow.hue": 15,
        "hsl.green.saturation": 20,
        "hsl.yellow.saturation": 15,
        "hsl.green.luminance": -15,
        "hsl.yellow.luminance": -10
      }
    ),
    tone({ contrast: 6 })
  ),
  look(
    "graduated-sky",
    "Graduated Sky",
    {
      tags: ["smart", "sky", "gradient", "landscape", "nd grad"],
      description: "A graduated filter from the top: a darker, deeper sky over any horizon."
    },
    mask("grad", "Top gradient", [part.linear([0.5, 0], [0.5, 0.5])], {
      "basic.exposure": -0.6,
      "basic.highlights": -30,
      "presence.saturation": 15,
      "presence.dehaze": 10
    })
  ),
  look(
    "sunset-grad",
    "Sunset Grad",
    {
      tags: ["smart", "sky", "gradient", "sunset", "warm", "golden"],
      description: "A warm graduated filter from the top, as a sunset filter would."
    },
    mask("grad", "Top gradient", [part.linear([0.5, 0], [0.5, 0.55])], {
      "wb.temperature": 30,
      "wb.tint": 8,
      "basic.exposure": -0.3,
      "presence.saturation": 20
    }),
    tone({ contrast: 8 })
  ),
  look(
    "spotlight",
    "Spotlight",
    {
      tags: ["smart", "vignette", "light", "focus", "radial", "moody"],
      description: "Light falling off around the middle of the frame, as from a spot."
    },
    mask("edge", "Around the light", [inverted(part.radial([0.5, 0.48], 0.75, 0.6, 70))], {
      "basic.exposure": -0.55,
      "presence.saturation": -10
    }),
    tone({ contrast: 10 })
  ),
  look(
    "clean-whites",
    "Clean Whites",
    {
      tags: ["smart", "highlights", "white", "neutral", "product", "luminance range"],
      description: "Colour casts taken out of the brightest tones only."
    },
    mask(
      "whites",
      "Bright tones",
      [part.range({ luma: { centre: 0.9, width: 0.2, softness: 0.12 }, smoothness: 20 })],
      { "presence.saturation": -45, "basic.whites": 8 }
    )
  ),
  look(
    "teal-shadows",
    "Teal Shadows",
    {
      tags: ["smart", "shadows", "teal", "cinematic", "luminance range"],
      description: "Teal laid into the deep tones only, where a split tone would tint the mids too."
    },
    sCurve(15),
    mask(
      "shadows",
      "Deep tones",
      [part.range({ luma: { centre: 0.1, width: 0.25, softness: 0.15 }, smoothness: 20 })],
      { "colorGrade.global.hue": 190, "colorGrade.global.saturation": 35 }
    ),
    wheel("highlights", 40, 8)
  ),
  look(
    "night-city-clean",
    "Night City Clean",
    {
      tags: ["smart", "night", "city", "neon", "denoise", "ai", "high iso"],
      description: "AI denoise for a high-ISO night shot, then a cool neon grade."
    },
    denoise(60),
    sCurve(20),
    split(195, 22, 320, 10),
    presence({ vibrance: 15, clarity: 8 }),
    hsl({ magenta: [0, 20, 0], purple: [0, 15, 0], blue: [-8, 10, -10] })
  ),
  look(
    "high-iso-rescue",
    "High-ISO Rescue",
    {
      tags: ["smart", "denoise", "ai", "high iso", "low light", "clean"],
      description: "AI denoise, a little clarity back, the colour left as it was."
    },
    denoise(70),
    presence({ clarity: 6, texture: 6 })
  ),
  look(
    "crisp-restore",
    "Crisp Restore",
    {
      tags: ["smart", "deblur", "sharpen", "ai", "restore", "detail"],
      description: "AI deblur for a soft or shaken shot, with gentle local contrast."
    },
    deblur(50),
    presence({ clarity: 8 }),
    tone({ contrast: 5 })
  ),
  look(
    "subject-denoise",
    "Clean Subject",
    {
      tags: ["smart", "denoise", "ai", "subject", "portrait", "low light"],
      description: "AI denoise on the subject only, so the background keeps its grain."
    },
    mask("subject", "Subject", [part.subject()], { "presence.clarity": 5 }),
    denoise(55, { scope: "subject" }),
    grain(10, 20, 40)
  ),
  // ── With the next engine: sky, people's parts, objects ──
  look(
    "moody-sky",
    "Moody Sky",
    {
      tags: ["smart", "sky", "moody", "dramatic", "landscape", "storm"],
      description: "The sky (not the subject against it) darkened, deepened and given weight."
    },
    mask(
      "sky",
      "Sky",
      [part.sky(), minus(part.subject())],
      {
        "basic.exposure": -0.5,
        "basic.highlights": -40,
        "presence.saturation": 15,
        "presence.dehaze": 20,
        "basic.contrast": 15
      },
      { required: true }
    ),
    tone({ contrast: 8 })
  ),
  look(
    "blue-sky-pop",
    "Blue Sky Pop",
    {
      tags: ["smart", "sky", "blue", "travel", "landscape", "clear"],
      description: "A clear, deep blue sky, with clouds kept white."
    },
    mask(
      "sky",
      "Sky",
      [part.sky()],
      {
        "hsl.blue.saturation": 30,
        "hsl.blue.luminance": -15,
        "hsl.aqua.saturation": 15,
        "presence.dehaze": 15
      },
      { required: true }
    )
  ),
  look(
    "portrait-polish",
    "Portrait Polish",
    {
      tags: ["smart", "portrait", "skin", "eyes", "retouch", "beauty", "denoise"],
      description: "Smooth, even skin; brighter eyes; a clean subject. Hair and clothes keep their texture."
    },
    mask(
      "skin",
      "Skin",
      [part.person("skin"), within(part.subject())],
      { "presence.texture": -30, "presence.clarity": -10, "wb.temperature": 4 },
      { required: true }
    ),
    mask("eyes", "Eyes", [part.person("eyes")], {
      "basic.exposure": 0.15,
      "presence.clarity": 15,
      "presence.saturation": 8
    }),
    denoise(30, { scope: "skin" }),
    tone({ highlights: -8 })
  ),
  look(
    "bright-eyes",
    "Bright Eyes",
    {
      tags: ["smart", "portrait", "eyes", "retouch"],
      description: "Eyes a touch brighter and crisper, nothing else changed."
    },
    mask(
      "eyes",
      "Eyes",
      [part.person("eyes")],
      { "basic.exposure": 0.25, "presence.clarity": 20, "presence.saturation": 10 },
      { required: true }
    ),
    presence({ vibrance: 3 })
  ),
  look(
    "car-shine",
    "Car Shine",
    {
      tags: ["smart", "car", "object", "automotive", "gloss", "pop"],
      description: "The car crisp and glossy, the surroundings a step back."
    },
    mask(
      "car",
      "Car",
      [part.object("car")],
      { "presence.clarity": 25, "basic.contrast": 15, "presence.saturation": 15 },
      { required: true }
    ),
    mask("around", "Around it", [inverted(part.object("car"))], {
      "basic.exposure": -0.25,
      "presence.saturation": -15
    }),
    vignette(-15, { feather: 70 })
  ),
  look(
    "rain-city-noir-lift",
    "Rain City Noir Lift",
    {
      tags: ["smart", "noir", "dark", "moody", "amber", "skin", "the batman", "batman"],
      inspiredBy: "The Batman (2022)",
      description: "Rain City Noir, with faces lifted out of the crushed dark and the background pressed down."
    },
    sCurve(45),
    tone({ whites: -25, highlights: -25, shadows: -20, blacks: -15 }),
    rolloff(0.04),
    presence({ saturation: -30 }),
    wheel("midtones", 28, 25),
    wheel("shadows", 20, 15),
    hsl({ red: [0, 25, -5], orange: [-4, 5, -5], aqua: [0, -60, 0], blue: [0, -60, -10] }),
    foliage(0, -50, 0),
    mask(
      "skin",
      "Faces",
      [part.person("skin")],
      { "basic.exposure": 0.25, "presence.saturation": 10, "basic.shadows": 15 },
      { required: true }
    ),
    mask("background", "Background", [part.background()], { "basic.exposure": -0.2 }),
    grain(12, 22, 45)
  ),
  look(
    "golden-hour-skin",
    "Golden Hour Skin",
    {
      tags: ["smart", "portrait", "skin", "golden hour", "warm", "glow"],
      description: "A warm, glowing light on skin only, as late sun would give."
    },
    mask(
      "skin",
      "Skin",
      [part.person("skin")],
      { "wb.temperature": 18, "basic.exposure": 0.1, "basic.highlights": -15 },
      { required: true }
    ),
    split(210, 6, 40, 10),
    fade(0.01)
  )
]);
const cl = (name) => `Sony Creative Look ${name}`;
const SONY = collection("camera/sony", [
  look(
    "clean-standard",
    "Clean Standard",
    {
      tags: ["standard", "everyday", "st", "sony"],
      inspiredBy: cl("ST"),
      description: "A clean, lightly lifted standard."
    },
    tone({ contrast: 10, whites: 10, blacks: -5 }),
    presence({ saturation: 8, vibrance: 6, clarity: 6 }),
    wheel("global", 210, 4),
    hsl({ blue: [0, 12, -5], aqua: [0, 8, 0] })
  ),
  look(
    "soft-skin",
    "Soft Skin",
    {
      tags: ["portrait", "skin", "soft", "pt", "sony"],
      inspiredBy: cl("PT"),
      description: "Soft contrast and bright, smooth skin."
    },
    tone({ contrast: -12, highlights: -10, shadows: 12 }),
    presence({ texture: -18, clarity: -5 }),
    wheel("highlights", 345, 8),
    hsl({ orange: [-5, -8, 12], red: [0, -5, 5] })
  ),
  look(
    "muted-neutral",
    "Muted Neutral",
    {
      tags: ["neutral", "muted", "calm", "nt", "sony"],
      inspiredBy: cl("NT"),
      description: "Quiet colour and softened detail."
    },
    tone({ contrast: -15, highlights: -10 }),
    presence({ saturation: -25, texture: -15 }),
    wheel("global", 215, 4)
  ),
  look(
    "saturated-vivid",
    "Saturated Vivid",
    {
      tags: ["vivid", "saturated", "vv", "sony"],
      inspiredBy: cl("VV"),
      description: "Saturated colour and firm contrast."
    },
    tone({ contrast: 15 }),
    presence({ saturation: 22 }),
    wheel("global", 20, 3),
    hsl({ red: [0, 15, 0], orange: [0, 10, 0] })
  ),
  look(
    "vivid-clear",
    "Vivid Clear",
    {
      tags: ["vivid", "clear", "bright", "vv2", "sony"],
      inspiredBy: cl("VV2"),
      description: "Bright, clear and colourful."
    },
    tone({ whites: 10, shadows: 5 }),
    presence({ saturation: 20, clarity: 15 })
  ),
  look(
    "film-mood",
    "Film Mood",
    {
      tags: ["film", "mood", "faded", "teal", "fl", "sony"],
      inspiredBy: cl("FL"),
      description: "Moody film contrast with faded blacks and teal skies."
    },
    tone({ contrast: 20 }),
    fade(0.03),
    presence({ saturation: -15 }),
    split(190, 10, 50, 8),
    hsl({ blue: [-10, 0, 0] }),
    foliage(10, -15, 0)
  ),
  look(
    "instant-matte",
    "Instant Matte",
    {
      tags: ["matte", "faded", "instant", "in", "sony"],
      inspiredBy: cl("IN"),
      description: "Flat, matte and warm, like an instant print."
    },
    tone({ contrast: -25 }),
    fade(0.06),
    presence({ saturation: -25 }),
    wheel("global", 40, 8)
  ),
  look(
    "soft-high-key",
    "Soft High-Key",
    {
      tags: ["high key", "bright", "airy", "sh", "sony"],
      inspiredBy: cl("SH"),
      description: "Bright, soft and a little cool."
    },
    tone({ contrast: -15, shadows: 20, whites: 20, highlights: 10 }),
    presence({ vibrance: 15 }),
    wheel("global", 200, 5)
  ),
  look(
    "studio-mono",
    "Studio Mono",
    {
      tags: ["bw", "mono", "sony"],
      inspiredBy: cl("BW"),
      description: "A crisp, punchy black and white."
    },
    mono({ blue: -10, aqua: -5 }),
    tone({ contrast: 22, whites: 12, blacks: -12 }),
    presence({ clarity: 10 })
  ),
  look(
    "warm-sepia",
    "Warm Sepia",
    {
      tags: ["bw", "sepia", "toned", "se", "sony"],
      inspiredBy: cl("SE"),
      description: "A warm sepia-toned mono."
    },
    mono(),
    wheel("global", 35, 30)
  ),
  look(
    "cine-skin-tone",
    "Cine Skin Tone",
    {
      tags: ["cinema", "skin", "video", "s-cinetone", "sony"],
      inspiredBy: "Sony S-Cinetone",
      description: "Soft highlights and warm, cinematic skin."
    },
    tone({ contrast: 5, whites: -20, highlights: -18, shadows: 6 }),
    rolloff(0.03),
    presence({ saturation: -6 }),
    split(190, 8, 35, 12),
    wheel("global", 30, 6),
    hsl({ orange: [-3, 10, 4], yellow: [0, -12, 0], green: [10, -22, 0] })
  )
]);
const LOOKS = [
  ...FUJIFILM,
  ...LEICA,
  ...HASSELBLAD,
  ...CANON,
  ...NIKON,
  ...SONY,
  ...RICOH,
  ...PANASONIC,
  ...OTHER_CAMERAS,
  ...CINEMA,
  ...FILM_COLOUR,
  ...FILM_INSTANT,
  ...FILM_BW,
  ...MOVIES,
  ...SMART,
  ...BW,
  ...CREATIVE,
  ...ESSENTIALS
];
const LOOK_BY_ID = new Map(LOOKS.map((l) => [l.id, l]));
const LOOK_ALIASES = {};
function resolveLook(id) {
  return LOOK_BY_ID.get(LOOK_ALIASES[id] ?? id);
}
function cropAtAspect(crop, aspect, w, h) {
  const area = crop.width * crop.height;
  let cw = Math.sqrt(area * aspect * h / w);
  let ch = Math.sqrt(area * w / (aspect * h));
  const over = Math.max(cw, ch, 1);
  cw /= over;
  ch /= over;
  const cx = crop.x + crop.width / 2;
  const cy = crop.y + crop.height / 2;
  return {
    x: Math.min(1 - cw, Math.max(0, cx - cw / 2)),
    y: Math.min(1 - ch, Math.max(0, cy - ch / 2)),
    width: cw,
    height: ch
  };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function pct(stats, p) {
  let best = stats.luma_percentiles[0];
  for (const q of stats.luma_percentiles) {
    if (Math.abs(q.percentile - p) < Math.abs(best.percentile - p)) best = q;
  }
  return best?.value ?? 0.5;
}
const AUTO_PERCENTILES = [0.5, 2, 10, 50, 90, 95, 99.5];
const TARGET_MEDIAN = 0.46;
const TARGET_LOW_KEY = 0.4;
const TARGET_HIGH_KEY = 0.5;
const EXPOSURE_SHARE = 0.85;
const TARGET_SPREAD = 0.21;
function autoTone(stats) {
  const p005 = pct(stats, 0.5);
  const p10 = pct(stats, 10);
  const p50 = pct(stats, 50);
  const p90 = pct(stats, 90);
  const p95 = pct(stats, 95);
  const p995 = pct(stats, 99.5);
  const sigma = stats.luma_stddev;
  const clippedHigh = Math.max(...stats.clipped_high, 0);
  const clippedLow = Math.max(...stats.clipped_low, 0);
  const flat = p995 - p005 < 0.55 || sigma < 0.12;
  const lowKey = p90 < 0.5;
  const target2 = lowKey ? TARGET_LOW_KEY : flat && p10 > 0.45 ? TARGET_HIGH_KEY : TARGET_MEDIAN;
  const toTarget = Math.log2(
    srgbToLinear(target2) / Math.max(srgbToLinear(Math.max(p50, 0.01)), 1e-4)
  );
  const headroom = Math.log2(srgbToLinear(0.97) / Math.max(srgbToLinear(p995), 1e-4));
  const wanted = toTarget * EXPOSURE_SHARE;
  const exposure = clamp(lowKey ? Math.min(wanted, Math.max(headroom, 0)) : wanted, -2, 2);
  const gain = 2 ** exposure;
  const shifted = (v) => {
    const lin = srgbToLinear(v) * gain;
    return lin <= 31308e-7 ? lin * 12.92 : Math.min(1, 1.055 * lin ** (1 / 2.4) - 0.055);
  };
  const s10 = shifted(p10);
  const s95 = shifted(p95);
  const s995 = shifted(p995);
  const s005 = shifted(p005);
  const hot = clippedHigh > 3e-3 || s995 > 0.985;
  const highlights = hot || !flat && s995 >= 0.95 ? -clamp((s95 - 0.8) / 0.2 * 60, 0, 50) : 0;
  const stretch = flat ? 0.5 : 1;
  const whites = clippedHigh > 5e-3 ? clamp(-clippedHigh * 2e3, -30, 0) : clamp((0.97 - s995) / 0.2 * 100, 0, 40 * stretch);
  const blacks = clippedLow > 2e-3 ? clamp(clippedLow * 2e3, 0, 25) : s005 > 0.04 ? -clamp((s005 - 0.02) / 0.15 * 100, 0, 35 * stretch) : 0;
  const shadows = !flat && s10 < 0.12 ? clamp((0.12 - s10) / 0.12 * 50, 0, 40) : 0;
  const contrast = flat ? clamp((TARGET_SPREAD - sigma) / TARGET_SPREAD * 40, 5, 30) : clamp((TARGET_SPREAD - sigma) / TARGET_SPREAD * 30, hot ? 0 : -20, 30);
  const round2 = (v) => Math.round(v) || 0;
  return {
    exposure: Math.round(exposure * 100) / 100 || 0,
    contrast: round2(contrast),
    highlights: round2(highlights),
    shadows: round2(shadows),
    whites: round2(whites),
    blacks: round2(blacks)
  };
}
function wbSliders(linearRec2020, isRaw, asShot) {
  const op = pixlfile.opNeutralising(linearRec2020);
  return op ? wbSlidersFromOp(op, isRaw, asShot) : null;
}
function wbSlidersFromOp(op, isRaw, asShot) {
  if (isRaw && asShot) {
    const abs = pixlfile.absoluteFromOp(op, asShot);
    return {
      temperature: Math.round(abs.kelvin),
      tint: Math.round(abs.tint * pixlfile.TINT_UNITS_PER_DUV),
      clamped: op.clamped || abs.clamped
    };
  }
  const rel = pixlfile.relativeFromOp(op);
  return {
    temperature: Math.round(clamp(rel.temperature, -100, 100)),
    tint: Math.round(clamp(rel.tint, -100, 100)),
    clamped: op.clamped || Math.abs(rel.temperature) > 100 || Math.abs(rel.tint) > 100
  };
}
function linearSrgbToRec2020([r, g, b]) {
  return [
    0.6274 * r + 0.3293 * g + 0.0433 * b,
    0.0691 * r + 0.9195 * g + 0.0114 * b,
    0.0164 * r + 0.088 * g + 0.8956 * b
  ];
}
function analyzeRequest(path2, input, stride, threads = source$1.interactiveThreads()) {
  return {
    source: { Path: path2 },
    input,
    raw: null,
    domain: "Encoded",
    bins: 256,
    percentiles: [...AUTO_PERCENTILES, 1, 99],
    clip_low: 0,
    clip_high: 1,
    hue_bins: 36,
    stride,
    transparent: "Include",
    threads,
    weights: null,
    noise: false,
    orientation: "Normal",
    lens: null,
    limits: source$1.READ_LIMITS,
    hdr: null,
    gain_map: null,
    // Engine 0.19's perceptual hash and focus: asked by culling (Pass 114).
    phash: false,
    focus: null
  };
}
function hdrWorkingOf(info2) {
  return info2.is_hdr ? { reference_white_nits: 203, peak_nits: info2.peak_nits ?? 1e3, limit: "Clip" } : null;
}
function hdrSignalOf(hdr) {
  return hdr ? { reference_white_nits: hdr.reference_white_nits, peak_nits: hdr.peak_nits } : null;
}
const rendersDir = (photoId) => path.join(index$1.paths.photoCache(photoId), "renders");
async function measureAutoWb(engine2, src, dir, hdr, isRaw, asShot, threads = source$1.interactiveThreads()) {
  const linearReq = {
    ...analyzeRequest(src.path, src.input === "Png" ? "Png" : "Tiff", 1, threads),
    domain: "Linear",
    hdr: hdrSignalOf(hdr)
  };
  let means = null;
  try {
    const layer = recipe.newLocalLayer("neutral");
    const maskOut = path.join(dir, "auto-wb-mask.png");
    await engine2.convert({
      ...source$1.blankRequest(src.path, maskOut, src.input),
      threads,
      pixel: { depth: "Eight", channels: 1 },
      encode: { Png: { compression: "Fast", filter: "Sub" } },
      metadata: source$1.STRIP_ALL,
      color: "Preserve",
      grade: {
        layers: [
          {
            name: layer.name,
            enabled: true,
            opacity: 1,
            blend: { mode: "Normal", space: "LinearWorking" },
            mask: {
              components: [
                {
                  shape: {
                    Range: {
                      hue: null,
                      saturation: { centre: 0, width: 0.3, softness: 0.1 },
                      luma: { centre: 0.5, width: 0.8, softness: 0.08 },
                      blur_radius: 0,
                      invert: false
                    }
                  },
                  mode: "Add",
                  opacity: 1,
                  invert: false,
                  feather: { radius: 0, edge: "Zero" },
                  refine: null
                }
              ],
              invert: false,
              space: {
                Encoded: {
                  space: "Srgb",
                  intent: "RelativeColorimetric",
                  black_point_compensation: false
                }
              }
            },
            stages: [
              {
                space: "LinearWorking",
                ops: [
                  {
                    Primary: {
                      exposure: 0,
                      lift: { r: 0, g: 0, b: 0 },
                      gamma: { r: 1, g: 1, b: 1 },
                      gain: { r: 1, g: 1, b: 1 },
                      contrast: 1,
                      contrast_pivot: 0.18,
                      saturation: 1,
                      hue_shift: 0
                    }
                  }
                ]
              }
            ]
          }
        ]
      },
      inspect: { LayerMask: { layer: 0 } },
      hdr
    });
    const s = await engine2.analyze({
      ...linearReq,
      weights: { source: { Png: maskOut }, resampler: "Bilinear" }
    });
    const total = src.width * src.height;
    if (s.pixels_measured > total * 0.02) means = s.channel_mean;
  } catch (err) {
    log.info("grey-pixel white balance unavailable, using grey world", err.message);
  }
  if (!means) {
    const s = await engine2.analyze(linearReq);
    means = s.channel_mean;
  }
  return engineWbSliders(engine2, [means[0], means[1], means[2]], isRaw, asShot);
}
const TINT_LIMIT = 0.1;
async function engineWbSliders(engine2, linearRec2020, isRaw, asShot) {
  const [r, g, b] = linearRec2020;
  if (!(r > 0 && g > 0 && b > 0)) return null;
  try {
    const w = await engine2.whiteBalanceFromPixel({ r, g, b }, "LinearWorking");
    const clamped = w.temperature_kelvin <= pixlfile.KELVIN_MIN + 0.5 || w.temperature_kelvin >= pixlfile.KELVIN_MAX - 0.5 || Math.abs(w.tint) >= TINT_LIMIT - 1e-6;
    return wbSlidersFromOp({ kelvin: w.temperature_kelvin, tint: w.tint, clamped }, isRaw, asShot);
  } catch (err) {
    log.info("engine white balance unavailable, using the app model", err.message);
    return wbSliders(linearRec2020, isRaw, asShot);
  }
}
const errorText = (err) => err instanceof Error ? err.message : String(err);
async function currentRecipes(s, keys) {
  await Promise.all(keys.map((key) => s.sessions.flush(key)));
  const saved = await s.index.recipes(keys);
  return new Map(
    saved.map((r) => [r.key, { row: r.row, recipe: s.sessions.liveRecipe(r.key) ?? r.recipe }])
  );
}
async function commitWb(s, changes, beforeLabel, label2) {
  for (const { key, before: before2, next } of changes) {
    await s.index.appendHistory(key, beforeLabel, s.planes.slim(before2));
    await s.index.appendHistory(key, label2, s.planes.slim(next));
  }
  const items = await s.index.saveRecipes(
    changes.map((c) => ({ key: c.key, recipe: s.planes.slim(c.next) }))
  );
  for (const { key, next } of changes) {
    if (s.sessions.liveRecipe(key)) s.sessions.update(key, next, false);
    const { photoId, copyId } = pixlfile.parseKey(key);
    s.library.queueThumb(photoId, copyId, true);
  }
  return items;
}
async function autoWbBatch(s, keys) {
  const current2 = await currentRecipes(s, keys);
  const failed2 = [];
  const changes = [];
  const measure = async (key) => {
    try {
      const cur = current2.get(key);
      if (!cur) throw new Error(concepts.t("the photo is not in the library"));
      const { recipe: recipe2 } = cur;
      const row = await s.library.photoRow(key);
      const info2 = await s.library.probe(row);
      const px2 = await ensureProxies(s.bgEngine, row, info2, source$1.BACKGROUND_THREADS);
      const dir = rendersDir(row.id);
      await promises.mkdir(dir, { recursive: true });
      const wb = await measureAutoWb(
        s.bgEngine,
        px2.draft,
        dir,
        hdrWorkingOf(info2),
        row.is_raw === 1,
        info2.as_shot_white,
        source$1.BACKGROUND_THREADS
      );
      if (!wb) throw new Error(concepts.t("no neutral to work from"));
      changes.push({
        key,
        before: recipe2,
        next: {
          ...recipe2,
          wb: { mode: "custom", temperature: wb.temperature, tint: wb.tint, preset: "auto" }
        }
      });
    } catch (err) {
      failed2.push({ key, message: errorText(err) });
    }
  };
  let next = 0;
  const worker = async () => {
    while (next < keys.length) await measure(keys[next++]);
  };
  await Promise.all([worker(), worker()]);
  const previous = {};
  for (const c of changes) previous[c.key] = c.before.wb;
  const items = changes.length ? await commitWb(s, changes, concepts.t("Before auto WB"), concepts.t("White balance: Auto")) : [];
  return { items, previous, failed: failed2 };
}
async function setWbBatch(s, pairs) {
  const current2 = await currentRecipes(
    s,
    pairs.map((p) => p.key)
  );
  const changes = pairs.flatMap(({ key, wb }) => {
    const cur = current2.get(key);
    return cur ? [{ key, before: cur.recipe, next: { ...cur.recipe, wb } }] : [];
  });
  if (changes.length === 0) return [];
  return commitWb(
    s,
    changes,
    concepts.t("Before restoring white balance"),
    concepts.t("White balance: restored")
  );
}
const PRODUCT = "playroom";
const AUTH_URL = "https://lskosagqyekwklxyuczi.supabase.co/auth/v1";
const ACCOUNT_API = "https://pixlfoundation.com/api";
const CLIENT_ID = "83eab600-baf2-4f5e-aac4-252010db94b2";
const PUBLISHABLE_KEY = "sb_publishable_1ozNwiLZxZLPZO3LEK5LHw_9VVf6A7G";
const REDIRECT_PORT = 47823;
const REDIRECT_PATH = "/callback";
const SCOPES = "openid email profile";
const AUTH_CONFIG = {
  authUrl: AUTH_URL,
  clientId: CLIENT_ID,
  apiKey: PUBLISHABLE_KEY,
  scopes: SCOPES
};
const ROOT_KEYS = {
  "root-1": "C9EdMvVbY6ZY3MM9_3pg-YxeJuGLiHLTqhFxEz2cd0g",
  "root-2": "CRSgddfssdTYmQQriIHmyOc-IEjaDGZz_U0Oi0Tvu8U"
};
const DEV_ROOT_KEYS = {
  "dev-root": "mvSbsudfbttEQ4sOYN5zX8IBPisy9FoykmgqoMis_FM"
};
class OAuthError extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}
const b64url = (b) => b.toString("base64url");
function pkcePair() {
  const verifier = b64url(node_crypto.randomBytes(32));
  return { verifier, challenge: b64url(node_crypto.createHash("sha256").update(verifier).digest()) };
}
function newState() {
  return b64url(node_crypto.randomBytes(24));
}
function authorizeUrl(cfg2, p) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: cfg2.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    scope: cfg2.scopes
  });
  return `${cfg2.authUrl}/oauth/authorize?${q}`;
}
function sameState(a, b) {
  if (a === null) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && node_crypto.timingSafeEqual(x, y);
}
function readCallback(url2, state2) {
  const q = url2.searchParams;
  if (!sameState(q.get("state"), state2))
    throw new OAuthError("That sign-in answer wasn't for this sign-in.", "state");
  const error = q.get("error");
  if (error) {
    const why = q.get("error_description") || error;
    throw new OAuthError(`Sign-in was refused: ${why}`, "denied");
  }
  const code = q.get("code");
  if (!code) throw new OAuthError("The sign-in answer carried no code.", "denied");
  return code;
}
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px/1.5 system-ui,sans-serif;background:#0b0b0f;color:#e8e8ef;display:grid;place-items:center;min-height:100vh;margin:0;padding:0 16px}main{max-width:28rem;text-align:center}h1{font-size:1.25rem;font-weight:600}p{color:#a0a0b0}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function listenForCallback(opts) {
  return new Promise((resolveServer, rejectServer) => {
    let settle;
    const code = new Promise((resolve, reject) => settle = { resolve, reject });
    code.catch(() => {
    });
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer2);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
      server.close();
      server.closeAllConnections?.();
    };
    const server = node_http.createServer((req, res) => {
      const url2 = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url2.pathname !== REDIRECT_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      const send2 = (status, title, body) => {
        res.writeHead(status, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          Connection: "close"
        }).end(page(title, body));
      };
      try {
        const got = readCallback(url2, opts.state);
        send2(200, "Signed in to Pixl Playroom", "You can close this tab and go back to the app.");
        finish(() => settle.resolve(got));
      } catch (err) {
        const e = err;
        send2(400, "Sign-in didn’t finish", escapeHtml(e.message));
        if (e.code !== "state") finish(() => settle.reject(e));
      }
    });
    const timer2 = setTimeout(
      () => finish(
        () => settle.reject(
          new OAuthError("Sign-in timed out. Try again when you’re ready.", "timeout")
        )
      ),
      opts.timeoutMs
    );
    const onAbort = () => finish(() => settle.reject(new OAuthError("Sign-in was cancelled.", "cancelled")));
    if (opts.signal?.aborted) {
      clearTimeout(timer2);
      rejectServer(new OAuthError("Sign-in was cancelled.", "cancelled"));
      return;
    }
    opts.signal?.addEventListener("abort", onAbort);
    server.once("error", (err) => {
      clearTimeout(timer2);
      opts.signal?.removeEventListener("abort", onAbort);
      rejectServer(
        err.code === "EADDRINUSE" ? new OAuthError(
          "Another sign-in is already waiting in the browser. Finish or close it, then try again.",
          "port-in-use"
        ) : new OAuthError(`Couldn't start the sign-in: ${err.message}`, "network")
      );
    });
    server.listen(opts.port, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : opts.port;
      resolveServer({
        redirectUri: `http://127.0.0.1:${port}${REDIRECT_PATH}`,
        code,
        close: () => finish(() => settle.reject(new OAuthError("Sign-in was cancelled.", "cancelled")))
      });
    });
  });
}
async function tokenRequest(cfg2, body, fetchFn, now) {
  let res;
  try {
    res = await fetchFn(`${cfg2.authUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        apikey: cfg2.apiKey
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(2e4)
    });
  } catch (err) {
    throw new OAuthError(
      `Couldn't reach the PIXL account: ${err instanceof Error ? err.message : String(err)}`,
      "network"
    );
  }
  let json = {};
  try {
    json = await res.json();
  } catch {
  }
  if (!res.ok || !json.access_token || !json.refresh_token) {
    const reason = json.error ?? json.error_code ?? `HTTP ${res.status}`;
    const why = json.error_description ?? json.msg ?? reason;
    const refused = res.status === 400 || res.status === 401;
    if (!refused && !res.ok)
      throw new OAuthError(`The PIXL account is unavailable (${why}).`, "network");
    if (body.grant_type === "refresh_token")
      throw new OAuthError(`Signed out: ${why}`, "signed-out");
    throw new OAuthError(`Sign-in was refused: ${why}`, "rejected");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: now() + (json.expires_in ?? 3600) * 1e3,
    idToken: json.id_token
  };
}
function exchangeCode(cfg2, p, fetchFn, now = Date.now) {
  return tokenRequest(
    cfg2,
    {
      grant_type: "authorization_code",
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: cfg2.clientId,
      code_verifier: p.verifier
    },
    fetchFn,
    now
  );
}
function refreshTokens(cfg2, refreshToken, fetchFn, now = Date.now) {
  return tokenRequest(
    cfg2,
    { grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg2.clientId },
    fetchFn,
    now
  );
}
async function signInWithBrowser(cfg2, deps) {
  const { verifier, challenge } = pkcePair();
  const state2 = newState();
  const server = await listenForCallback({
    port: deps.port,
    state: state2,
    timeoutMs: deps.timeoutMs ?? 5 * 6e4,
    signal: deps.signal
  });
  try {
    await deps.openBrowser(authorizeUrl(cfg2, { redirectUri: server.redirectUri, state: state2, challenge }));
    const code = await server.code;
    return await exchangeCode(
      cfg2,
      { code, verifier, redirectUri: server.redirectUri },
      deps.fetch,
      deps.now
    );
  } finally {
    server.close();
  }
}
function jwtPayload(token) {
  try {
    const part2 = token.split(".")[1];
    const json = JSON.parse(Buffer.from(part2, "base64url").toString("utf8"));
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}
async function endSession(cfg2, accessToken2, fetchFn) {
  await fetchFn(`${cfg2.authUrl}/logout?scope=local`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken2}`, apikey: cfg2.apiKey },
    signal: AbortSignal.timeout(1e4)
  });
}
const EARLY_MS = 6e4;
function identityOf(t) {
  const access2 = jwtPayload(t.accessToken);
  const id = t.idToken ? jwtPayload(t.idToken) : {};
  const str = (v) => typeof v === "string" && v.trim() ? v.trim() : void 0;
  return {
    sub: str(access2.sub) ?? str(id.sub) ?? "",
    email: str(access2.email) ?? str(id.email),
    name: str(id.name) ?? str(access2.user_metadata?.full_name)
  };
}
let Session$1 = class Session {
  stored;
  access = null;
  refreshing = null;
  cfg;
  store;
  fetchFn;
  now;
  /** Told whenever someone signs in or out. */
  onChange;
  constructor(cfg2, store, fetchFn, now = Date.now, onChange = () => {
  }) {
    this.cfg = cfg2;
    this.store = store;
    this.fetchFn = fetchFn;
    this.now = now;
    this.onChange = onChange;
    this.stored = store.load();
  }
  identity() {
    const s = this.stored;
    return s ? { sub: s.sub, email: s.email, name: s.name } : null;
  }
  keep(t, who) {
    this.stored = { refreshToken: t.refreshToken, ...who };
    this.store.save(this.stored);
    this.access = { token: t.accessToken, expiresAt: t.expiresAt };
  }
  async signIn(deps) {
    const t = await signInWithBrowser(this.cfg, { ...deps, fetch: this.fetchFn, now: this.now });
    const who = identityOf(t);
    await this.refreshing?.catch(() => {
    });
    this.keep(t, who);
    this.onChange();
    return who;
  }
  /** Forgets the session on this device. The account page can revoke it on the server too. */
  signOut() {
    const had = this.stored !== null;
    this.stored = null;
    this.access = null;
    this.store.save(null);
    if (had) this.onChange();
  }
  /**
   * A current access token, refreshed first when it is about to expire.
   * Throws OAuthError: `signed-out` (the session is gone, and is forgotten
   * here), or `network` (the session is kept for the next try).
   */
  accessToken() {
    if (this.access && this.access.expiresAt - EARLY_MS > this.now())
      return Promise.resolve(this.access.token);
    return this.refresh();
  }
  /** Refreshes now (single-flight), whatever the access token's expiry. */
  refresh() {
    if (this.refreshing) return this.refreshing;
    const stored = this.stored;
    if (!stored) return Promise.reject(new OAuthError("Not signed in.", "signed-out"));
    this.refreshing = (async () => {
      try {
        const t = await refreshTokens(this.cfg, stored.refreshToken, this.fetchFn, this.now);
        if (this.stored !== stored) throw new OAuthError("Signed out.", "signed-out");
        const who = identityOf(t);
        this.keep(t, {
          sub: who.sub || stored.sub,
          email: who.email ?? stored.email,
          name: who.name ?? stored.name
        });
        return t.accessToken;
      } catch (err) {
        if (err instanceof OAuthError && err.code === "signed-out" && this.stored === stored)
          this.signOut();
        throw err;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
};
const cfg = {
  ...AUTH_CONFIG,
  authUrl: (process.env["PLAYROOM_AUTH_URL"] || AUTH_CONFIG.authUrl).replace(/\/+$/, "")
};
const visible$1 = !electron.app.isPackaged || electron.app.getVersion().includes("-beta") || licenceEnforced(electron.app.getVersion()) || process.env["PLAYROOM_LICENCE_UI"] === "1";
function filePath$2() {
  return path.join(electron.app.getPath("userData"), "account.json");
}
const fileStore = {
  load() {
    let s;
    try {
      s = JSON.parse(fs.readFileSync(filePath$2(), "utf8"));
    } catch {
      return null;
    }
    try {
      const refreshToken = electron.safeStorage.decryptString(Buffer.from(s.refreshSealed, "base64"));
      return { refreshToken, sub: s.sub, email: s.email, name: s.name };
    } catch (err) {
      log.warn("account: the stored session could not be decrypted", err);
      return null;
    }
  },
  save(s) {
    if (!s || !electron.safeStorage.isEncryptionAvailable()) {
      fs.rmSync(filePath$2(), { force: true });
      return;
    }
    const out = {
      sub: s.sub,
      email: s.email,
      name: s.name,
      refreshSealed: electron.safeStorage.encryptString(s.refreshToken).toString("base64")
    };
    fs.writeFileSync(filePath$2(), JSON.stringify(out, null, 2) + "\n", {
      encoding: "utf8",
      mode: 384
    });
  }
};
let session;
let signingIn = null;
function theSession() {
  session ??= new Session$1(cfg, fileStore, fetch, Date.now, () => broadcast$2());
  return session;
}
function accountStatus() {
  const who = theSession().identity();
  return {
    signedIn: who !== null,
    email: who?.email,
    name: who?.name,
    signingIn: signingIn !== null,
    visible: visible$1
  };
}
const listeners$3 = [];
function onAccountChange(fn) {
  listeners$3.push(fn);
}
function broadcast$2() {
  const status = accountStatus();
  for (const win2 of electron.BrowserWindow.getAllWindows()) {
    if (!win2.isDestroyed()) win2.webContents.send(index$1.IPC.account.changed, status);
  }
  for (const fn of listeners$3) fn(status);
  return status;
}
function refreshAccess() {
  return theSession().refresh();
}
function accessToken() {
  return theSession().accessToken();
}
async function signIn() {
  signingIn?.abort();
  const controller = new AbortController();
  signingIn = controller;
  broadcast$2();
  try {
    const who = await theSession().signIn({
      port: REDIRECT_PORT,
      signal: controller.signal,
      openBrowser: (url2) => electron.shell.openExternal(url2)
    });
    log.info(`account: signed in (${who.sub})`);
    const win2 = electron.BrowserWindow.getAllWindows()[0];
    if (win2 && !win2.isDestroyed()) {
      if (win2.isMinimized()) win2.restore();
      win2.show();
      electron.app.focus({ steal: true });
    }
  } catch (err) {
    if (err instanceof OAuthError && err.code === "cancelled") return accountStatus();
    log.warn("account: sign-in failed", err);
    throw err;
  } finally {
    if (signingIn === controller) signingIn = null;
    broadcast$2();
  }
  return accountStatus();
}
function cancelSignIn() {
  signingIn?.abort();
  return accountStatus();
}
async function signOut() {
  const s = theSession();
  const token = s.identity() ? await s.accessToken().catch(() => null) : null;
  s.signOut();
  log.info("account: signed out");
  if (token) {
    void endSession(cfg, token, fetch).catch(
      (err) => log.warn("account: ending the session on the server failed", err)
    );
  }
  return broadcast$2();
}
function startAccount() {
  if (process.env["PLAYROOM_HIDDEN"] === "1") return;
  const s = theSession();
  if (!s.identity()) return;
  void s.refresh().catch((err) => {
    if (err instanceof OAuthError && err.code === "signed-out")
      log.info("account: the session had ended; signed out");
    else log.warn("account: the launch check failed", err);
  });
}
class AccountError extends Error {
  code;
  /** `device_limit`: the account's devices, to free one. */
  devices;
  /** `too_many`: seconds to wait, when the Worker says. */
  retryAfter;
  constructor(message, code, extra = {}) {
    super(message);
    this.name = "AccountError";
    this.code = code;
    this.devices = extra.devices;
    this.retryAfter = extra.retryAfter;
  }
}
const MESSAGES = {
  auth: "Sign in again to continue.",
  device_limit: "Your licence is already in use on the most devices it allows.",
  trial_used_account: "This account has already had its free trial.",
  trial_used_device: "This device has already had a free trial, under another account.",
  no_beta: "This account isn’t in the beta yet.",
  beta_ended: "The beta has ended. Update to the released Pixl Playroom to keep going.",
  wrong_client: "Sign-in isn’t set up for this build of Pixl Playroom.",
  bad_request: "Pixl Playroom sent something the account server didn’t understand.",
  too_many: "Too many tries. Wait a little, then try again."
};
class AccountApi {
  d;
  constructor(deps) {
    this.d = deps;
  }
  entitlements(device) {
    return this.call("POST", "/entitlements", this.body(device));
  }
  /** Starts the trial, or answers with the token of one already running (it's idempotent). */
  startTrial(device) {
    return this.call("POST", "/trials", this.body(device));
  }
  async freeDevice(id) {
    await this.call("DELETE", `/devices/${encodeURIComponent(id)}`);
  }
  body(device) {
    return { product: this.d.product, ...device, appVersion: this.d.appVersion };
  }
  async call(method, path2, body) {
    let token = await this.d.accessToken();
    let res = await this.send(method, path2, token, body);
    if (res.status === 401) {
      token = await this.d.refreshAccess();
      res = await this.send(method, path2, token, body);
    }
    let json = {};
    try {
      json = await res.json();
    } catch {
    }
    if (res.ok) {
      if (method !== "DELETE" && (typeof json.token !== "string" || typeof json.keyset !== "string"))
        throw new AccountError("The account server sent an answer without a token.", "network");
      return json;
    }
    const code = typeof json.error === "string" ? json.error : "";
    if (code in MESSAGES) {
      const c = code;
      const retry = Number(res.headers.get("Retry-After"));
      throw new AccountError(MESSAGES[c], c, {
        devices: Array.isArray(json.devices) ? json.devices : void 0,
        retryAfter: Number.isFinite(retry) && retry > 0 ? retry : void 0
      });
    }
    throw new AccountError(`The account server answered HTTP ${res.status}.`, "network");
  }
  async send(method, path2, token, body) {
    try {
      return await this.d.fetch(`${this.d.base}${path2}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...body ? { "Content-Type": "application/json" } : {}
        },
        body: body ? JSON.stringify(body) : void 0,
        signal: AbortSignal.timeout(2e4)
      });
    } catch (err) {
      throw new AccountError(
        `Couldn't reach the PIXL account: ${err instanceof Error ? err.message : String(err)}`,
        "network"
      );
    }
  }
}
const ENTITLEMENT_ISSUER = "pixlfoundation.com";
const MAX_LIFETIME_S = 31 * 24 * 60 * 60;
const keyCache = /* @__PURE__ */ new Map();
function publicKey(raw2) {
  let k = keyCache.get(raw2);
  if (!k) {
    k = node_crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw2 }, format: "jwk" });
    keyCache.set(raw2, k);
  }
  return k;
}
function decode(part2) {
  return JSON.parse(Buffer.from(part2, "base64url").toString("utf8"));
}
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
function wellFormed(c) {
  if (!c || typeof c !== "object") return false;
  const o = c;
  const ent = o.ent;
  return typeof o.sub === "string" && typeof o.aud === "string" && typeof o.dev === "string" && typeof o.iss === "string" && isNum(o.iat) && isNum(o.exp) && isNum(o.rfa) && !!ent && typeof ent === "object" && Array.isArray(ent.addons);
}
function effectiveNow(nowMs, seenAtMs, iat) {
  return Math.max(nowMs, seenAtMs ?? 0, (iat ?? 0) * 1e3) / 1e3;
}
function verifyJws(jws, keys) {
  const parts = jws.split(".");
  if (parts.length !== 3) return { ok: false, problem: "malformed" };
  const [h, p, s] = parts;
  let header;
  let payload;
  try {
    header = decode(h);
    payload = decode(p);
  } catch {
    return { ok: false, problem: "malformed" };
  }
  if (header?.alg !== "EdDSA") return { ok: false, problem: "malformed" };
  const kid = typeof header.kid === "string" ? header.kid : void 0;
  const raw2 = kid !== void 0 && Object.hasOwn(keys, kid) ? keys[kid] : void 0;
  if (!kid || !raw2) return { ok: false, problem: "unknown-key" };
  let good = false;
  try {
    good = node_crypto.verify(null, Buffer.from(`${h}.${p}`), publicKey(raw2), Buffer.from(s, "base64url"));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, problem: "signature" };
  const typ = typeof header.typ === "string" ? header.typ : void 0;
  return { ok: true, header: { alg: "EdDSA", kid, typ }, payload };
}
function checkEntitlement(token, opts) {
  const jws = verifyJws(token, opts.keys);
  if (!jws.ok) return jws;
  if (jws.header.typ === KEYSET_TYPE) return { ok: false, problem: "malformed" };
  const claims = jws.payload;
  if (!wellFormed(claims)) return { ok: false, problem: "malformed" };
  if (claims.iss !== ENTITLEMENT_ISSUER) return { ok: false, problem: "issuer" };
  if (claims.aud !== opts.product) return { ok: false, problem: "audience" };
  if (claims.dev !== opts.device) return { ok: false, problem: "device" };
  if (claims.exp - claims.iat > MAX_LIFETIME_S) return { ok: false, problem: "malformed" };
  const now = effectiveNow(opts.nowMs, opts.seenAtMs, claims.iat);
  if (now >= claims.exp) return { ok: false, problem: "expired" };
  return { ok: true, claims, refreshDue: now >= claims.rfa };
}
const KEYSET_TYPE = "pixl-keyset";
const RAW_KEY = /^[A-Za-z0-9_-]{43}$/;
function checkKeyset(jws, roots, minIat = 0) {
  const v = verifyJws(jws, roots);
  if (!v.ok) return v;
  if (v.header.typ !== KEYSET_TYPE) return { ok: false, problem: "malformed" };
  const o = v.payload;
  if (!o || typeof o !== "object" || !isNum(o.iat) || !o.keys || typeof o.keys !== "object")
    return { ok: false, problem: "malformed" };
  if (o.iss !== ENTITLEMENT_ISSUER) return { ok: false, problem: "issuer" };
  const keys = {};
  for (const [kid, raw2] of Object.entries(o.keys)) {
    if (typeof raw2 !== "string" || !RAW_KEY.test(raw2)) return { ok: false, problem: "malformed" };
    if (Object.hasOwn(roots, kid)) return { ok: false, problem: "malformed" };
    keys[kid] = raw2;
  }
  if (o.iat < minIat) return { ok: false, problem: "stale" };
  return { ok: true, keys, iat: o.iat };
}
class Access {
  d;
  device = null;
  deviceLimit = null;
  refusal = null;
  fetching = null;
  constructor(deps) {
    this.d = deps;
  }
  /** Reads the device once; the status can't judge a token before it knows the device. */
  async ready() {
    this.device ??= await this.d.device();
    return this.device;
  }
  keys(f) {
    if (!f.keyset) return {};
    const k = checkKeyset(f.keyset, this.d.roots);
    return k.ok ? k.keys : {};
  }
  check(f) {
    if (!f.token || !this.device) return null;
    return checkEntitlement(f.token, {
      keys: this.keys(f),
      product: this.d.product,
      device: this.device.deviceHash,
      nowMs: this.d.now(),
      seenAtMs: f.seenAt
    });
  }
  input() {
    const f = this.d.load();
    const c = this.check(f);
    return {
      signedIn: this.d.signedIn(),
      claims: c?.ok ? c.claims : null,
      expired: c?.ok === false && c.problem === "expired",
      deviceLimit: this.deviceLimit,
      refusal: this.refusal,
      betaBuild: this.d.betaBuild,
      now: effectiveNow(this.d.now(), f.seenAt)
    };
  }
  status(visible2, enforced2) {
    return licenceStatus(this.input(), visible2, enforced2);
  }
  /** Whether the server should be asked now: signed in, and no good token or one due a refresh. */
  due() {
    if (!this.d.signedIn()) return false;
    const c = this.check(this.d.load());
    return !c || !c.ok || c.refreshDue;
  }
  /** Moves `seenAt` up to now (never back). */
  touch() {
    const f = this.d.load();
    const now = this.d.now();
    if ((f.seenAt ?? 0) < now) this.d.save({ ...f, seenAt: now });
  }
  /** Forgets the token: signed out, or the server no longer gives this device one. */
  forget() {
    const f = this.d.load();
    this.d.save({ keyset: f.keyset, keysetIat: f.keysetIat, seenAt: f.seenAt });
    this.deviceLimit = null;
    this.refusal = null;
    this.d.onChange();
  }
  /** Takes a token and its key set, once both check out. */
  accept(r) {
    const f = this.d.load();
    const now = this.d.now();
    const ks = checkKeyset(r.keyset, this.d.roots, f.keysetIat ?? 0);
    const keyset = ks.ok ? r.keyset : f.keyset;
    const keysetIat = ks.ok ? ks.iat : f.keysetIat;
    if (!ks.ok && ks.problem !== "stale")
      throw new AccountError(
        `The account server's keys couldn't be verified (${ks.problem}).`,
        "network"
      );
    const seenAt = Math.max(f.seenAt ?? 0, now);
    const next = { token: r.token, keyset, keysetIat, seenAt };
    const c = this.check(next);
    if (!c?.ok)
      throw new AccountError(
        `The account server's answer couldn't be verified (${c?.problem ?? "no device"}).`,
        "network"
      );
    this.deviceLimit = null;
    this.refusal = null;
    this.d.save(next);
  }
  /**
   * Asks the server for this device's token (single-flight). Signed out
   * forgets it; a device-limit refusal is remembered with the account's
   * devices; a refusal of the beta forgets it. Anything else (no network, a
   * rate limit) keeps the token there is and throws for whoever asked.
   */
  refresh() {
    this.fetching ??= this.doRefresh().finally(() => this.fetching = null);
    return this.fetching;
  }
  async doRefresh() {
    if (!this.d.signedIn()) {
      this.forget();
      return;
    }
    const device = await this.ready();
    try {
      this.accept(await this.d.server.entitlements(device));
    } catch (err) {
      this.refused(err);
      throw err;
    } finally {
      this.d.onChange();
    }
  }
  refused(err) {
    if (err instanceof OAuthError && err.code === "signed-out") this.forget();
    else if (err instanceof AccountError) {
      if (err.code === "device_limit") {
        const f = this.d.load();
        this.d.save({ keyset: f.keyset, keysetIat: f.keysetIat, seenAt: f.seenAt });
        this.deviceLimit = err.devices ?? [];
        this.refusal = null;
      } else if (err.code === "no_beta" || err.code === "beta_ended") {
        this.forget();
        this.refusal = err.code;
      } else if (err.code === "signed-out") this.forget();
    }
  }
  /** Starts the trial (or answers with the one running). Refusals (`trial_used_*`) go to the caller. */
  async startTrial() {
    const device = await this.ready();
    try {
      this.accept(await this.d.server.startTrial(device));
    } catch (err) {
      this.refused(err);
      throw err;
    } finally {
      this.d.onChange();
    }
  }
  /** Frees one of the account's devices (from the device-limit list), then asks again for this one. */
  async freeDevice(id) {
    await this.d.server.freeDevice(id);
    await this.refresh();
  }
}
const run = node_util.promisify(node_child_process.execFile);
function deviceHash(machineId2, product) {
  return node_crypto.createHmac("sha256", `pixl:${product}:device:v1`).update(machineId2, "utf8").digest("hex");
}
function parseIoreg(out) {
  return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? null;
}
function parseRegQuery(out) {
  return /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)?.[1] ?? null;
}
async function machineId(platform = process.platform) {
  let id = null;
  if (platform === "darwin") {
    const { stdout } = await run("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
    id = parseIoreg(stdout);
  } else if (platform === "win32") {
    const reg = `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32\\reg.exe`;
    const { stdout } = await run(reg, [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
      "/v",
      "MachineGuid",
      "/reg:64"
    ]);
    id = parseRegQuery(stdout);
  } else {
    for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      id = (await promises$2.readFile(f, "utf8").catch(() => "")).trim() || null;
      if (id) break;
    }
  }
  if (!id) throw new Error("Couldn't identify this device");
  return id;
}
function deviceOs(platform = process.platform) {
  return platform === "darwin" ? "macos" : platform === "win32" ? "windows" : "linux";
}
function deviceName(platform = process.platform) {
  const os2 = { darwin: "macOS", win32: "Windows", linux: "Linux" }[platform];
  return `${node_os.hostname().replace(/\.local$/, "")} (${os2 ?? platform})`;
}
const betaBuild$2 = electron.app.getVersion().includes("-beta");
const enforced = licenceEnforced(electron.app.getVersion());
const visible = !electron.app.isPackaged || betaBuild$2 || process.env["PLAYROOM_LICENCE_UI"] === "1";
const hidden$1 = process.env["PLAYROOM_HIDDEN"] === "1";
const CHECK_EVERY_MS$1 = 60 * 60 * 1e3;
const FOCUS_GAP_MS = 10 * 60 * 1e3;
function filePath$1() {
  return path.join(electron.app.getPath("userData"), "licence.json");
}
function load() {
  try {
    const f = JSON.parse(fs.readFileSync(filePath$1(), "utf8"));
    return f && typeof f === "object" ? f : {};
  } catch {
    return {};
  }
}
function save$1(f) {
  fs.writeFileSync(filePath$1(), JSON.stringify(f, null, 2) + "\n", "utf8");
}
const access = new Access({
  load,
  save: save$1,
  server: new AccountApi({
    base: (process.env["PLAYROOM_ACCOUNT_URL"] || ACCOUNT_API).replace(/\/+$/, ""),
    product: PRODUCT,
    appVersion: electron.app.getVersion(),
    fetch,
    accessToken,
    refreshAccess
  }),
  device: async () => ({
    deviceHash: deviceHash(await machineId(), PRODUCT),
    deviceName: deviceName(),
    os: deviceOs()
  }),
  // The development root signs the mock's key sets; a packaged app never trusts it.
  roots: electron.app.isPackaged ? ROOT_KEYS : { ...ROOT_KEYS, ...DEV_ROOT_KEYS },
  product: PRODUCT,
  betaBuild: betaBuild$2,
  signedIn: () => accountStatus().signedIn,
  now: Date.now,
  onChange: () => broadcast$1()
});
const listeners$2 = [];
let ready = false;
function onLicenceChange(fn) {
  listeners$2.push(fn);
}
function licenceReady() {
  return ready;
}
function broadcast$1() {
  const status = licence();
  for (const win2 of electron.BrowserWindow.getAllWindows()) {
    if (!win2.isDestroyed()) win2.webContents.send(index$1.IPC.licence.changed, status);
  }
  for (const fn of listeners$2) fn();
  return status;
}
function licence() {
  return access.status(visible, enforced);
}
function requireLicence(what) {
  const s = licence();
  if (s.locked) {
    log.info(`licence: ${what} refused (${s.state.kind})`);
    throw new LicenceError(s.locked, "locked");
  }
}
async function logged(what, fn) {
  try {
    await fn();
  } catch (err) {
    log.warn(`licence: ${what} failed`, err);
    throw err;
  }
  const status = licence();
  log.info(`licence: ${what} done (${status.state.kind})`);
  return status;
}
function refreshLicence() {
  return logged("check", () => access.refresh());
}
function startTrial() {
  return logged("starting the trial", () => access.startTrial());
}
function freeDevice(id) {
  return logged("freeing a device", () => access.freeDevice(id));
}
function refreshIfDue(why) {
  if (!access.due()) return;
  void access.refresh().then(() => log.info(`licence: refreshed (${why}): ${licence().state.kind}`)).catch((err) => log.warn(`licence: refresh (${why}) failed`, err));
}
function startLicence() {
  void access.ready().then(() => {
    ready = true;
    access.touch();
    broadcast$1();
    if (!hidden$1) refreshIfDue("launch");
  }).catch((err) => log.warn("licence: couldn't identify this device", err));
  let signedIn = accountStatus().signedIn;
  onAccountChange((s) => {
    if (s.signedIn === signedIn) return;
    signedIn = s.signedIn;
    if (signedIn) {
      void access.refresh().then(() => log.info(`licence: refreshed after sign-in: ${licence().state.kind}`)).catch((err) => log.warn("licence: refresh after sign-in failed", err));
    } else access.forget();
  });
  if (hidden$1) return;
  setInterval(() => {
    access.touch();
    refreshIfDue("hourly");
  }, CHECK_EVERY_MS$1).unref();
  let lastFocus = Date.now();
  electron.app.on("browser-window-focus", () => {
    if (Date.now() - lastFocus < FOCUS_GAP_MS) return;
    lastFocus = Date.now();
    refreshIfDue("focus");
  });
}
async function benchmarkSam3(engine2, models2, switches, progress) {
  throw new Error("SAM 3 is held back for now (it brings the engine down: E58)");
}
function opLabel(op) {
  switch (op.kind) {
    case "component":
      return "Shaping mask";
    case "enable":
      return "Mask ready";
    case "segment":
      if (op.target !== "sky") return "Finding the subject";
      return "Finding the sky";
    case "person":
      return `Finding ${op.part}`;
    case "object":
      return op.detect ? `Finding the ${op.label}` : `Pointing at the ${op.label}`;
    case "denoise":
      return op.model === "nafnet" ? "AI denoise (NAFNet)" : "AI denoise (DRUNet)";
    case "deblur":
      return "AI deblur";
  }
}
function opMs(op, megapixels, rates = {}) {
  const r = { ...pixlfile.SMART_RATES, ...rates };
  switch (op.kind) {
    case "component":
    case "enable":
      return 50;
    case "segment":
      return r.segmentMs;
    case "person":
      return r.personMs;
    case "object":
      return (op.detect ? r.detectMs : 0) + r.sam2Ms;
    case "denoise":
      return megapixels * (op.model === "nafnet" ? r.nafnetMsPerMp : r.drunetMsPerMp);
    case "deblur":
      return megapixels * r.deblurMsPerMp;
  }
}
const NOT_YET = concepts.tk("needs the next engine update");
class LookRuns {
  runs = /* @__PURE__ */ new Map();
  deps;
  constructor(deps) {
    this.deps = deps;
  }
  /** Start a run; it goes on by itself and says how it is going. */
  start(req) {
    const run2 = { req, cancelled: false, jobId: null, pick: null };
    this.runs.set(req.runId, run2);
    void this.go(run2).finally(() => this.runs.delete(req.runId));
  }
  /** Stop a run: the job under way, a question waiting, and everything after. */
  cancel(runId) {
    const run2 = this.runs.get(runId);
    if (!run2) return;
    run2.cancelled = true;
    if (run2.jobId) this.deps.cancelJob(run2.jobId);
    run2.pick?.({ kind: "skip" });
  }
  /** The user's answer to a run's question (a click, a box, or skip). */
  answer(runId, a) {
    this.runs.get(runId)?.pick?.(a);
  }
  /** Every run on a photo, stopped (the look was swapped or taken off there). */
  cancelFor(key) {
    for (const r of this.runs.values()) if (r.req.key === key) this.cancel(r.req.runId);
  }
  get size() {
    return this.runs.size;
  }
  async go(run2) {
    const { key, runId, look: look2, ops: ops2 } = run2.req;
    const mp = await this.deps.megapixels(key).catch(() => 24);
    const parts = ops2.map((op) => ({ label: opLabel(op), ms: opMs(op, mp) }));
    this.deps.send({ kind: "start", key, runId, look: look2, parts });
    const failed2 = [];
    const lost = /* @__PURE__ */ new Set();
    for (const [index2, op] of ops2.entries()) {
      if (run2.cancelled) break;
      const layerId = "layerId" in op ? op.layerId : null;
      if (layerId && lost.has(layerId)) continue;
      this.deps.send({ kind: "part", key, runId, index: index2, label: parts[index2].label });
      try {
        await this.part(run2, index2, op);
        if (run2.cancelled) break;
        this.deps.send({ kind: "landed", key, runId, index: index2, label: parts[index2].label });
      } catch (err) {
        if (run2.cancelled) break;
        const why = err.message || concepts.t("failed");
        failed2.push({ label: parts[index2].label, why });
        if (op.kind !== "denoise" && op.kind !== "deblur" && layerId) {
          lost.add(layerId);
          await this.deps.edit(key, (r) => {
            r.layers = r.layers.filter((l) => l.id !== layerId);
          }).catch(() => void 0);
          this.deps.send({ kind: "landed", key, runId, index: index2, label: concepts.t("Mask removed") });
        }
      }
    }
    this.deps.send({
      kind: "end",
      key,
      runId,
      phase: run2.cancelled ? "cancelled" : failed2.length && failed2.length === ops2.length ? "error" : "done",
      failed: failed2
    });
  }
  /** One part. Throws when it could not be made. */
  async part(run2, index2, op) {
    const { key, runId, look: look2 } = run2.req;
    const group = runId;
    switch (op.kind) {
      case "component":
        return this.deps.edit(key, (r) => {
          const l = r.layers.find((x) => x.id === op.layerId);
          if (!l) throw new Error(concepts.t("its mask is gone"));
          const c = structuredClone(op.component);
          if (l.components.length === 0) c.mode = "Add";
          l.components.push(c);
        });
      case "enable":
        return this.deps.edit(key, (r) => {
          const l = r.layers.find((x) => x.id === op.layerId);
          if (!l) throw new Error(concepts.t("its mask is gone"));
          l.enabled = true;
        });
      case "segment": {
        if (op.target === "sky" && pixlfile.SKY_BY_CLICK) ;
        await this.job(
          run2,
          this.deps.startJob({
            task: "segment",
            key,
            target: op.target,
            into: { layerId: op.layerId, mode: op.mode },
            group
          })
        );
        if (op.invert) await this.invertLast(key, op.layerId);
        return;
      }
      case "person": {
        if (pixlfile.isPartTarget(op.part) || recipe.isFacePart(op.part)) {
          await this.job(
            run2,
            this.deps.startJob({
              task: "segment",
              key,
              target: op.part,
              into: { layerId: op.layerId, mode: op.mode },
              group
            })
          );
          if (op.invert) await this.invertLast(key, op.layerId);
          return;
        }
        if (!this.deps.personJob) throw new Error(concepts.t(NOT_YET));
        await this.job(
          run2,
          this.deps.personJob({ key, group, layerId: op.layerId, mode: op.mode, part: op.part })
        );
        if (op.invert) await this.invertLast(key, op.layerId);
        return;
      }
      case "object": {
        if (op.detect) {
          await this.job(
            run2,
            this.deps.startJob({
              task: "segment",
              key,
              target: "phrase",
              phrase: op.label,
              into: { layerId: op.layerId, mode: op.mode },
              group
            })
          );
          if (op.invert) await this.invertLast(key, op.layerId);
          return;
        }
        if (!this.deps.promptJob) throw new Error(concepts.t(NOT_YET));
        let prompt = {
          kind: "label"
        };
        if (!op.detect) {
          const a = await this.ask(run2, index2, op.label, look2);
          if (a.kind === "skip") throw new Error(concepts.t("skipped"));
          prompt = a.kind === "point" ? { kind: "point", point: a.point } : a;
        }
        await this.job(
          run2,
          this.deps.promptJob({
            key,
            group,
            layerId: op.layerId,
            mode: op.mode,
            label: op.label,
            prompt
          })
        );
        if (op.invert) await this.invertLast(key, op.layerId);
        return;
      }
      case "denoise": {
        await this.job(
          run2,
          this.deps.startJob({
            task: "denoise",
            key,
            model: op.model === "nafnet" ? "nafnet-sidd-w32" : "drunet-color",
            strength: op.strength,
            layerId: op.layerId,
            group
          })
        );
        return;
      }
      case "deblur":
        await this.job(
          run2,
          this.deps.startJob({
            task: "enhance",
            key,
            // Deblur alone: the default's ×2 would enlarge the whole photo past the mask.
            settings: {
              ...DEFAULT_ENHANCE,
              deblur: true,
              deblurStrength: op.strength,
              upscale: "off"
            },
            layerId: op.layerId,
            group
          })
        );
        return;
    }
  }
  /** Wait for a job to end; throws unless it ended done. */
  async job(run2, started2) {
    let resolve = () => void 0;
    const ended = new Promise((r) => resolve = r);
    let id = null;
    const early = [];
    const off = this.deps.onJobEnded((e) => {
      if (id === null) early.push(e);
      else if (e.jobId === id) resolve(e);
    });
    try {
      id = await started2;
      run2.jobId = id;
      const seen = early.find((e2) => e2.jobId === id);
      if (seen) resolve(seen);
      if (run2.cancelled) this.deps.cancelJob(id);
      const e = await ended;
      if (e.phase === "cancelled") throw new Error(concepts.t("cancelled"));
      if (e.phase !== "done") throw new Error(e.message ?? concepts.t("failed"));
    } finally {
      off();
      run2.jobId = null;
    }
  }
  /** The user is asked to point at `label`; resolves with what they did. */
  ask(run2, index2, label2, look2) {
    const { key, runId } = run2.req;
    return new Promise((resolve) => {
      run2.pick = (a) => {
        run2.pick = null;
        resolve(a);
      };
      this.deps.send({ kind: "pick", key, runId, index: index2, label: label2, look: look2 });
    });
  }
  /** A model's mask landed as the layer's last component: selected the other way round. */
  invertLast(key, layerId) {
    return this.deps.edit(key, (r) => {
      const c = r.layers.find((l) => l.id === layerId)?.components.at(-1);
      if (c) c.invert = !c.invert;
    });
  }
}
const FORMAT = 1;
const BASE = (process.env.PLAYROOM_LENS_PROFILES_URL ?? `${MODELS_BASE}/lens-profiles/v1`).replace(
  /\/+$/,
  ""
);
const FIRST_CHECK_MS = 15e3;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1e3;
const FETCH_TIMEOUT_MS = 3e4;
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
async function fetchBytes(url$1) {
  if (url$1.startsWith("file:")) return promises.readFile(url.fileURLToPath(url$1));
  const res = await fetch(url$1, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url$1}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
function readIndex(v) {
  const i = v;
  if (!i || typeof i !== "object" || i.format !== FORMAT || typeof i.version !== "string")
    return null;
  if (!Array.isArray(i.shards) || i.shards.some((s) => !/^[\w.-]+\.json$/.test(s.file))) return null;
  return i;
}
async function readIndexAt(dir) {
  try {
    return readIndex(JSON.parse(await promises.readFile(path.join(dir, "index.json"), "utf8")));
  } catch {
    return null;
  }
}
async function readCatalog(dir, origin) {
  if (!await exists(path.join(dir, "index.json"))) return null;
  try {
    const index2 = readIndex(JSON.parse(await promises.readFile(path.join(dir, "index.json"), "utf8")));
    if (!index2) return null;
    const lenses = [];
    const cameras = [];
    const mounts = [];
    for (const s of index2.shards) {
      const body = await promises.readFile(path.join(dir, s.file));
      if (sha256(body) !== s.sha256) throw new Error(`${s.file}: checksum differs from the index`);
      const shard = JSON.parse(body.toString("utf8"));
      for (const l of shard.lenses ?? []) {
        const id = l.id;
        const p = recipe.validateProfile(l, typeof id === "string" ? id : "");
        if (typeof p !== "string" && p.id) lenses.push(p);
      }
      cameras.push(...shard.cameras ?? []);
      mounts.push(...shard.mounts ?? []);
    }
    return { index: index2, origin, dir, lenses, cameras, mounts };
  } catch (err) {
    log.warn("lens catalogue unreadable", dir, err.message);
    return null;
  }
}
async function listImported() {
  const dir = index$1.paths.lensProfiles();
  const files = (await promises.readdir(dir)).filter((f) => path.extname(f).toLowerCase() === ".json").sort();
  const out = [];
  for (const f of files) {
    try {
      const p = recipe.validateProfile(
        JSON.parse(await promises.readFile(path.join(dir, f), "utf8")),
        path.basename(f, ".json")
      );
      if (typeof p === "string") log.warn("lens profile refused", f, p);
      else out.push({ ...p, source: p.source ?? "Imported" });
    } catch (err) {
      log.warn("lens profile unreadable", f, err.message);
    }
  }
  return out;
}
async function importProfiles(files) {
  const out = [];
  for (const f of files) {
    const id = path.basename(f, path.extname(f));
    let parsed;
    try {
      parsed = JSON.parse(await promises.readFile(f, "utf8"));
    } catch {
      throw new Error(`${path.basename(f)} is not JSON`);
    }
    const p = recipe.validateProfile(parsed, id);
    if (typeof p === "string") throw new Error(`${path.basename(f)}: ${p}`);
    await promises.writeFile(path.join(index$1.paths.lensProfiles(), `${id}.json`), JSON.stringify(parsed, null, 2));
    out.push(p);
  }
  return out;
}
class LensProfileStore {
  catalog = null;
  imported = [];
  checkedAt = null;
  error = null;
  checking = null;
  timer;
  /** Read what is here, then keep the catalogue current in the background. */
  async start() {
    await this.load();
    setTimeout(() => void this.check().catch(() => void 0), FIRST_CHECK_MS);
    this.timer = setInterval(() => void this.check().catch(() => void 0), CHECK_EVERY_MS);
  }
  stop() {
    clearInterval(this.timer);
  }
  /** The bundled and the downloaded catalogue, whichever is newer, and the imported profiles. */
  async load() {
    const [bundledIndex, onlineIndex] = await Promise.all([
      readIndexAt(index$1.paths.bundledLensCatalog()),
      readIndexAt(index$1.paths.lensCatalog())
    ]);
    const onlineFirst = !!onlineIndex && (!bundledIndex || onlineIndex.generated >= bundledIndex.generated);
    const order = onlineFirst ? [
      [index$1.paths.lensCatalog(), "online"],
      [index$1.paths.bundledLensCatalog(), "bundled"]
    ] : [
      [index$1.paths.bundledLensCatalog(), "bundled"],
      [index$1.paths.lensCatalog(), "online"]
    ];
    this.catalog = null;
    for (const [dir, origin] of order) {
      this.catalog = await readCatalog(dir, origin);
      if (this.catalog) break;
    }
    this.imported = await listImported().catch(() => []);
    if (!this.catalog) log.warn("no lens catalogue: neither the bundled nor a downloaded one reads");
  }
  /** Every profile: the imported first (they win a tie), then the catalogue's. */
  all() {
    return [...this.imported, ...this.catalog?.lenses ?? []];
  }
  status() {
    const c = this.catalog;
    return {
      version: c?.index.version ?? null,
      origin: c?.origin ?? null,
      generated: c?.index.generated ?? null,
      lensfunCommit: c?.index.source.commit ?? null,
      lenses: c?.lenses.length ?? 0,
      cameras: c?.cameras.length ?? 0,
      imported: this.imported.length,
      checkedAt: this.checkedAt,
      error: this.error,
      url: `${BASE}/index.json`
    };
  }
  /**
   * Look for a newer catalogue online and take it: the index first; each
   * shard it names that is not here with the same SHA-256 downloaded and
   * checked; the whole set staged beside the current one and swapped in.
   */
  check() {
    this.checking ??= this.update().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }
  async update() {
    try {
      const raw2 = await fetchBytes(`${BASE}/index.json`);
      const index2 = readIndex(JSON.parse(raw2.toString("utf8")));
      if (!index2) throw new Error("the online catalogue is in a format this version does not read");
      this.checkedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.error = null;
      const current2 = this.catalog;
      if (current2?.index.version === index2.version) return this.status();
      if (current2 && index2.generated < current2.index.generated) return this.status();
      const target2 = index$1.paths.lensCatalog();
      const staging = `${target2}.staging`;
      await promises.rm(staging, { recursive: true, force: true });
      await promises.mkdir(staging, { recursive: true });
      const have = /* @__PURE__ */ new Map();
      const bundledDir = index$1.paths.bundledLensCatalog();
      const bundledIndex = await readIndexAt(bundledDir);
      for (const c of [
        current2 && { index: current2.index, dir: current2.dir },
        bundledIndex && { index: bundledIndex, dir: bundledDir }
      ])
        for (const s of c?.index.shards ?? []) have.set(s.sha256, path.join(c.dir, s.file));
      let fetched = 0;
      for (const s of index2.shards) {
        const local = have.get(s.sha256);
        if (local && await exists(local)) {
          await promises.cp(local, path.join(staging, s.file));
          continue;
        }
        const body = await fetchBytes(`${BASE}/${s.file}`);
        if (sha256(body) !== s.sha256) throw new Error(`${s.file}: checksum differs from the index`);
        await promises.writeFile(path.join(staging, s.file), body);
        fetched++;
      }
      await promises.writeFile(path.join(staging, "index.json"), raw2);
      const staged = await readCatalog(staging, "online");
      if (!staged) throw new Error("the downloaded catalogue does not read");
      await promises.rm(target2, { recursive: true, force: true });
      await promises.rename(staging, target2);
      this.catalog = { ...staged, dir: target2 };
      log.info("lens catalogue updated", index2.version, `${fetched} shard(s) downloaded`);
      this.changed();
    } catch (err) {
      this.checkedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.error = err.message;
      log.info("lens catalogue check failed", this.error);
    }
    return this.status();
  }
  /** Imported profiles changed (an import): read them again and say so. */
  async reloadImported() {
    this.imported = await listImported().catch(() => []);
    this.changed();
  }
  changed() {
    for (const w of electron.BrowserWindow.getAllWindows())
      w.webContents.send(index$1.IPC.lens.changed, this.status());
  }
  /** Lenses whose name contains every word of `query`, best first. */
  search(query, limit = 40) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const hits = [];
    for (const p of this.all()) {
      const name = recipe.profileName(p).toLowerCase();
      const hay = `${name} ${(p.aliases ?? []).join(" ").toLowerCase()} ${(p.mounts ?? [p.mount ?? ""]).join(" ").toLowerCase()}`;
      if (words.every((w) => hay.includes(w)))
        hits.push({
          id: p.id,
          name: recipe.profileName(p),
          mount: p.mount ?? null,
          crop: p.calibration?.crop ?? null,
          source: p.source ?? null
        });
      if (hits.length >= limit) break;
    }
    return hits;
  }
  /**
   * The profile for a photo — the one chosen by id, or the best match for
   * its lens — resolved at its focal length, aperture, crop factor and
   * frame, with how it was found.
   */
  /** A shot's crop factor: from its EXIF, else its camera's in the catalogue; null when neither says. */
  crop(shot) {
    const camera = recipe.findCamera(shot.camera, this.catalog?.cameras ?? []);
    return recipe.shotCrop(shot.lens, camera)?.value ?? null;
  }
  resolve(shot, id) {
    const camera = recipe.findCamera(shot.camera, this.catalog?.cameras ?? []);
    const crop = recipe.shotCrop(shot.lens, camera);
    const all2 = this.all();
    const profile = id ? all2.find((p) => p.id === id) ?? null : recipe.matchProfile(shot.lens, all2, {
      mounts: recipe.mountsFor(camera?.mount ?? null, this.catalog?.mounts ?? []),
      crop: crop?.value ?? null
    });
    return {
      profile: profile ? {
        id: profile.id,
        name: recipe.profileName(profile),
        source: profile.source ?? null,
        mount: profile.mount ?? null,
        calibrationCrop: profile.calibration?.crop ?? null
      } : null,
      camera: camera ? { name: recipe.profileName(camera), crop: camera.crop } : null,
      resolved: profile ? recipe.resolveProfile(profile, shot.lens, { crop, width: shot.width, height: shot.height }) : null,
      catalog: this.status().version
    };
  }
}
function gateFor(i) {
  if (!i.betaBuild || i.skip) return { kind: "open" };
  if (i.betaOpen === false) return { kind: "beta-ended" };
  if (!i.signedIn) return { kind: "sign-in" };
  if (!i.ready) return { kind: "pending" };
  switch (i.state.kind) {
    case "beta":
    case "licensed":
      return { kind: "open" };
    case "beta-ended":
      return { kind: "beta-ended" };
    case "device-limit":
      return { kind: "device-limit", devices: i.state.devices };
    case "checking":
      return { kind: "checking", offline: false };
    case "revalidate":
      return { kind: "checking", offline: true };
    default:
      return { kind: "join" };
  }
}
function allowedWhileGated(channel) {
  return /^(account|licence|updates|prefs|app):/.test(channel);
}
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
function parsePolicy(json) {
  if (!json || typeof json !== "object") return {};
  const o = json;
  const p = {};
  if (typeof o.minVersion === "string" && VERSION.test(o.minVersion)) p.minVersion = o.minVersion;
  if (typeof o.betaOpen === "boolean") p.betaOpen = o.betaOpen;
  if (typeof o.message === "string" && o.message.trim()) p.message = o.message.trim().slice(0, 500);
  return p;
}
function compareVersions(a, b) {
  const x = VERSION.exec(a);
  const y = VERSION.exec(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return Math.sign(d);
  }
  const pa = x[4]?.split(".");
  const pb = y[4]?.split(".");
  if (!pa || !pb) return pa ? -1 : pb ? 1 : 0;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === void 0) return -1;
    if (pb[i] === void 0) return 1;
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : NaN;
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : NaN;
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return Math.sign(na - nb);
    } else if (!isNaN(na)) return -1;
    else if (!isNaN(nb)) return 1;
    else if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}
function belowFloor(version, policy2) {
  return policy2.minVersion !== void 0 && compareVersions(version, policy2.minVersion) < 0;
}
const POLICY_URL = "https://updates.pixlfoundation.com/playroom/policy.json";
const EVERY_MS = 4 * 60 * 60 * 1e3;
function policyUrl() {
  const feed = process.env["PLAYROOM_UPDATE_URL"];
  return process.env["PLAYROOM_POLICY_URL"] || (feed ? `${feed.replace(/\/+$/, "")}/policy.json` : POLICY_URL);
}
function filePath() {
  return path.join(electron.app.getPath("userData"), "policy.json");
}
let current = {};
const listeners$1 = [];
function policy() {
  return current;
}
function onPolicy(fn) {
  listeners$1.push(fn);
  fn(current);
}
function take(next) {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const fn of listeners$1) fn(current);
}
async function fetchPolicy() {
  const url2 = policyUrl();
  try {
    const res = await fetch(url2, { cache: "no-store", signal: AbortSignal.timeout(15e3) });
    if (res.status === 404) return save({});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    save(parsePolicy(await res.json()));
  } catch (err) {
    log.warn(`policy: couldn't read ${url2}`, err);
  }
}
function save(p) {
  fs.writeFileSync(filePath(), JSON.stringify(p, null, 2) + "\n", "utf8");
  take(p);
}
function startPolicy() {
  try {
    current = parsePolicy(JSON.parse(fs.readFileSync(filePath(), "utf8")));
  } catch {
    current = {};
  }
  if (process.env["PLAYROOM_HIDDEN"] === "1") return;
  void fetchPolicy();
  setInterval(() => void fetchPolicy(), EVERY_MS).unref();
}
const betaBuild$1 = electron.app.getVersion().includes("-beta");
const skip = (!electron.app.isPackaged || process.env["PLAYROOM_HIDDEN"] === "1") && process.env["PLAYROOM_BETA_GATE"] !== "1";
let shown = { kind: "pending" };
function gate() {
  return gateFor({
    betaBuild: betaBuild$1,
    skip,
    ready: licenceReady(),
    signedIn: accountStatus().signedIn,
    state: licence().state,
    betaOpen: policy().betaOpen
  });
}
function gateRefuses(channel) {
  return gate().kind !== "open" && !allowedWhileGated(channel);
}
function update() {
  const next = gate();
  if (JSON.stringify(next) === JSON.stringify(shown)) return;
  log.info(`gate: ${shown.kind} → ${next.kind}`);
  shown = next;
  for (const win2 of electron.BrowserWindow.getAllWindows()) {
    if (!win2.isDestroyed()) win2.webContents.send(index$1.IPC.app.gateChanged, next);
  }
}
function startGate() {
  shown = gate();
  onAccountChange(update);
  onLicenceChange(update);
  onPolicy(update);
  if (skip || !betaBuild$1) return;
  let last2 = 0;
  electron.app.on("browser-window-focus", () => {
    const k = gate().kind;
    if (k !== "join" && k !== "checking" || Date.now() - last2 < 5e3) return;
    last2 = Date.now();
    void refreshLicence().catch(() => {
    });
  });
}
const TEXT_FALLBACK = {
  "edit.undo": "undo",
  "edit.redo": "redo",
  "edit.selectAll": "selectAll"
};
const SITE = "https://playroom.pixlfoundation.com";
const LEGAL = "https://playroom.pixlfoundation.com/legal";
const mac = process.platform === "darwin";
const target = () => electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
const toRenderer = (channel) => () => {
  target()?.webContents.send(channel);
};
const settings = () => ({
  label: concepts.t("Settings…"),
  accelerator: "CmdOrCtrl+,",
  click: toRenderer(index$1.IPC.app.openPreferences)
});
const engineReport = () => ({
  label: concepts.t("Engine Report…"),
  accelerator: "CmdOrCtrl+Alt+E",
  click: toRenderer(index$1.IPC.app.openEngineReport)
});
const help = () => [
  { label: concepts.t("Pixl Playroom Website"), click: () => void electron.shell.openExternal(SITE) },
  { label: concepts.t("Report a Problem…"), click: toRenderer(index$1.IPC.app.openReport) },
  { type: "separator" },
  { label: concepts.t("Licence Agreement"), click: () => void electron.shell.openExternal(`${LEGAL}/eula/`) },
  // The copy this build shipped with, offline too.
  ...electron.app.getVersion().includes("-beta") ? [{ label: concepts.t("Beta Terms"), click: () => void electron.shell.openPath(index$1.paths.betaTerms()) }] : [],
  { label: concepts.t("Privacy Policy"), click: () => void electron.shell.openExternal(`${LEGAL}/privacy/`) },
  { label: concepts.t("Third-Party Notices"), click: () => void electron.shell.openPath(index$1.paths.notices()) }
];
const times = (n) => `${Number(n.toFixed(2))}×`;
function choose(id, win2, e) {
  const w = win2 ?? target();
  if (!w || w.isDestroyed()) return;
  if (e.triggeredByAccelerator) {
    const fallback = TEXT_FALLBACK[id];
    if (fallback) w.webContents[fallback]();
    return;
  }
  w.webContents.send(index$1.IPC.menu.run, id);
}
function toItem(n) {
  if (n.type === "separator") return { type: "separator" };
  if (n.role) return { role: n.role, ...n.label ? { label: n.label } : {} };
  const item = {
    label: n.label ?? "",
    enabled: n.enabled ?? true
  };
  if (n.accelerator) {
    item.accelerator = n.accelerator;
    if (!mac) item.registerAccelerator = false;
  }
  if (n.checked !== void 0) {
    item.type = n.radio ? "radio" : "checkbox";
    item.checked = n.checked;
  }
  if (n.submenu) item.submenu = n.submenu.map(toItem);
  else if (n.id) {
    const id = n.id;
    item.click = (_item, win2, e) => choose(id, win2, e);
  }
  return item;
}
let spec = null;
function setMenuSpec(next) {
  spec = next;
  buildMenu();
}
function popupMenu(items) {
  const win2 = target();
  if (!win2 || win2.isDestroyed() || items.length === 0) return;
  electron.Menu.buildFromTemplate(items.map(toItem)).popup({ window: win2 });
}
function renderingMenu() {
  const s = index$1.renderScale();
  if (!s.available || s.native === null) return [];
  const native = s.native;
  const label2 = {
    ultra: concepts.t("Ultra ({{scale}})", { scale: times(index$1.ULTRA_SCALE) }),
    performance: concepts.t("Performance ({{scale}})", { scale: times(index$1.PERFORMANCE_SCALE) }),
    native: concepts.t("Native ({{scale}})", { scale: times(native) })
  };
  const shown2 = s.modes.includes(s.mode) ? s.mode : "native";
  return [
    { type: "separator" },
    {
      label: concepts.t("Rendering"),
      submenu: s.modes.map((m) => ({
        label: label2[m],
        type: "radio",
        checked: m === shown2,
        click: () => index$1.setRenderMode(m)
      }))
    }
  ];
}
function buildMenu() {
  const developer = {
    label: concepts.t("Developer"),
    submenu: [{ role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }]
  };
  const viewTail = [
    engineReport(),
    ...renderingMenu(),
    { type: "separator" },
    { role: "togglefullscreen" },
    { type: "separator" },
    developer
  ];
  const theirs = spec?.menus ?? [];
  const fileMenu = theirs.length > 0 ? theirs[0] : void 0;
  const viewMenu = theirs.length > 1 ? theirs[theirs.length - 1] : void 0;
  const fileItems = (fileMenu?.items ?? []).map(toItem);
  const viewItems = (viewMenu?.items ?? []).map(toItem);
  const middle = theirs.slice(1, -1).map((m) => ({ label: m.label, submenu: m.items.map(toItem) }));
  const settingsItem = settings();
  const template = [
    ...mac ? [
      {
        label: electron.app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          settingsItem,
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" }
        ]
      }
    ] : [],
    spec ? {
      label: fileMenu?.label ?? concepts.t("File"),
      submenu: [
        ...fileItems,
        { type: "separator" },
        mac ? { role: "close" } : settingsItem,
        ...mac ? [] : [{ type: "separator" }, { role: "quit" }]
      ]
    } : mac ? { role: "fileMenu" } : { label: concepts.t("File"), submenu: [settingsItem, { type: "separator" }, { role: "quit" }] },
    // Until the renderer has said, the OS's Edit menu (text fields' copy and paste).
    ...spec ? middle : [{ role: "editMenu" }],
    {
      label: viewMenu?.label ?? concepts.t("View"),
      submenu: viewItems.length ? [...viewItems, { type: "separator" }, ...viewTail] : viewTail
    },
    { role: "windowMenu" },
    { role: "help", submenu: help() }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}
const Add = "Add";
const Added = "Added";
const Advanced = "Advanced";
const AI = "AI";
const all = "all";
const All = "All";
const Amount = "Amount";
const Analyse = "Analyse";
const and = "and";
const any = "any";
const Any = "Any";
const Aperture = "Aperture";
const Applied = "Applied";
const Apply = "Apply";
const aqua = "aqua";
const Aspect = "Aspect";
const Auto = "Auto";
const Automatic = "Automatic";
const Background = "Background";
const before = "before";
const Before = "Before";
const Benchmarking = "Benchmarking";
const Blend = "Blend";
const blue = "blue";
const Blue = "Blue";
const Bottom = "Bottom";
const Box = "Box";
const Brightness = "Brightness";
const Brows = "Brows";
const Brush = "Brush";
const Calibration = "Calibration";
const Camera = "Camera";
const Cancel = "Cancel";
const cancelled = "cancelled";
const Cancelled2 = "Cancelled";
const Caption = "Caption";
const Centre = "Centre";
const Changed = "Changed";
const Changes = "Changes";
const clean = "clean";
const Clear = "Clear";
const click = "click";
const Clipping = "Clipping";
const Clone = "Clone";
const Close = "Close";
const Clothes = "Clothes";
const Cloudy = "Cloudy";
const Collection = "Collection";
const Collections = "Collections";
const Colour = "Colour";
const Colours = "Colours";
const contains = "contains";
const Copy = "Copy";
const Copyright = "Copyright";
const Create = "Create";
const Crop = "Crop";
const Culling = "Culling";
const Current = "Current";
const damaged = "damaged";
const Darken = "Darken";
const Day = "Day";
const Daylight = "Daylight";
const days = "days";
const Deblur = "Deblur";
const Defringe = "Defringe";
const Dehaze = "Dehaze";
const Delete = "Delete";
const Denoising = "Denoising";
const Density = "Density";
const Detail = "Detail";
const Deutan = "Deutan";
const develop = "develop";
const Develop = "Develop";
const Developer = "Developer";
const Developing = "Developing";
const Diagonal = "Diagonal";
const Dials = "Dials";
const Difference = "Difference";
const Done = "Done";
const Download = "Download";
const Downloading = "Downloading";
const Draw = "Draw";
const Duplicate = "Duplicate";
const Duplicates = "Duplicates";
const Edit = "Edit";
const Edited = "Edited";
const Edits = "Edits";
const Effects = "Effects";
const Enhance = "Enhance";
const Enhancing = "Enhancing";
const Erase = "Erase";
const Everything = "Everything";
const Exact = "Exact";
const Expect = "Expect";
const Export = "Export";
const Exposure = "Exposure";
const Extension = "Extension";
const Eyes = "Eyes";
const Face = "Face";
const Faces = "Faces";
const failed = "failed";
const Failed = "Failed";
const Far = "Far";
const Feather = "Feather";
const Field = "Field";
const File = "File";
const Fill = "Fill";
const Filmstrip = "Filmstrip";
const Filters = "Filters";
const flag = "flag";
const Flag = "Flag";
const Flash = "Flash";
const Flat = "Flat";
const Flip = "Flip";
const Flow = "Flow";
const Fluorescent = "Fluorescent";
const Folder = "Folder";
const Folders = "Folders";
const Free = "Free";
const From = "From";
const Full = "Full";
const Geometry = "Geometry";
const get = "get";
const Glass = "Glass";
const Golden = "Golden";
const Good = "Good";
const Grain = "Grain";
const green = "green";
const Green = "Green";
const Grid = "Grid";
const Group = "Group";
const Guided = "Guided";
const Guides = "Guides";
const Hair = "Hair";
const HardLight = "HardLight";
const Headroom = "Headroom";
const Heal = "Heal";
const Hide = "Hide";
const Histogram = "Histogram";
const History = "History";
const Hue = "Hue";
const info = "info";
const Info = "Info";
const Inset = "Inset";
const Intersect = "Intersect";
const Invert = "Invert";
const Inverted = "Inverted";
const is = "is";
const Keep = "Keep";
const Keyword = "Keyword";
const Keywords = "Keywords";
const Kind = "Kind";
const label = "label";
const Label = "Label";
const Lasso = "Lasso";
const Later = "Later";
const Left = "Left";
const Lens = "Lens";
const Level = "Level";
const Library$1 = "Library";
const Light = "Light";
const Lighten = "Lighten";
const Linear = "Linear";
const Lips = "Lips";
const Look = "Look";
const Looks = "Looks";
const Luminance = "Luminance";
const magenta = "magenta";
const map = "map";
const Mask = "Mask";
const Masks = "Masks";
const Match = "Match";
const Matte = "Matte";
const max = "max";
const Method = "Method";
const Metrics = "Metrics";
const min = "min";
const Mixed = "Mixed";
const Model = "Model";
const Moderate = "Moderate";
const months = "months";
const More = "More";
const Move = "Move";
const Multiply = "Multiply";
const Name = "Name";
const Navigation = "Navigation";
const Near = "Near";
const Neutralise = "Neutralise";
const New = "New";
const No = "No";
const none = "none";
const None = "None";
const Normal = "Normal";
const object = "object";
const Objects = "Objects";
const Off = "Off";
const offline = "offline";
const Offline = "Offline";
const On = "On";
const Opacity = "Opacity";
const Open = "Open";
const Opened = "Opened";
const Operator = "Operator";
const Optics = "Optics";
const orange = "orange";
const Organise = "Organise";
const Original = "Original";
const Outline = "Outline";
const Overlay = "Overlay";
const People = "People";
const Perceptual = "Perceptual";
const Person = "Person";
const Photo = "Photo";
const Pick = "Pick";
const PICK = "PICK";
const Picked = "Picked";
const Picks = "Picks";
const Position = "Position";
const Presence = "Presence";
const Preset = "Preset";
const Presets = "Presets";
const Pressure = "Pressure";
const preview = "preview";
const Preview = "Preview";
const Profile = "Profile";
const Protan = "Protan";
const purple = "purple";
const Purple = "Purple";
const queued = "queued";
const Queued = "Queued";
const Quick = "Quick";
const Range = "Range";
const rate = "rate";
const Rating = "Rating";
const Recent = "Recent";
const Recommended = "Recommended";
const red = "red";
const Red = "Red";
const Redo = "Redo";
const Refine = "Refine";
const Reject = "Reject";
const Rejected = "Rejected";
const Remove = "Remove";
const Rename = "Rename";
const Rendering = "Rendering";
const Reset = "Reset";
const Restart = "Restart";
const Right = "Right";
const Rule = "Rule";
const Rules = "Rules";
const Saturation = "Saturation";
const Save = "Save";
const Scale = "Scale";
const Scopes = "Scopes";
const Screen = "Screen";
const seconds = "seconds";
const Segmenting = "Segmenting";
const Selecting = "Selecting";
const Settings = "Settings";
const Shade = "Shade";
const Sharpening = "Sharpening";
const Show = "Show";
const Similar = "Similar";
const Size = "Size";
const Skin = "Skin";
const Skip = "Skip";
const skipped = "skipped";
const Sky = "Sky";
const Slow = "Slow";
const Smart = "Smart";
const Smoothing = "Smoothing";
const Smoothness = "Smoothness";
const Snapshots = "Snapshots";
const SoftLight = "SoftLight";
const Softness = "Softness";
const soon = "soon";
const Sort = "Sort";
const Source = "Source";
const Sources = "Sources";
const Split = "Split";
const stack = "stack";
const Stack = "Stack";
const Stacking = "Stacking";
const Starting = "Starting";
const steady = "steady";
const Stop = "Stop";
const Straighten = "Straighten";
const Strength = "Strength";
const Strong = "Strong";
const Subfolders = "Subfolders";
const Subject = "Subject";
const Subtract = "Subtract";
const sync = "sync";
const Taken = "Taken";
const Target = "Target";
const Targeted = "Targeted";
const Teeth = "Teeth";
const Thirds = "Thirds";
const Title = "Title";
const To = "To";
const Tools = "Tools";
const Top = "Top";
const Tritan = "Tritan";
const Try = "Try";
const Tungsten = "Tungsten";
const Turn = "Turn";
const unavailable = "unavailable";
const Undo = "Undo";
const Unedited = "Unedited";
const Unflagged = "Unflagged";
const Unit = "Unit";
const Unpin = "Unpin";
const Unstack = "Unstack";
const Value = "Value";
const Vegetation = "Vegetation";
const Vertical = "Vertical";
const Vibrance = "Vibrance";
const View = "View";
const Vignette = "Vignette";
const Waiting = "Waiting";
const Water = "Water";
const Watermark = "Watermark";
const weeks = "weeks";
const working = "working";
const years = "years";
const yellow = "yellow";
const Yellow = "Yellow";
const Yes = "Yes";
const en = {
  "“{{name}}”": "“{{name}}”",
  "(removed)": "(removed)",
  "(was {{pct}}%)": "(was {{pct}}%)",
  "{{count}} edited": "{{count}} edited",
  "{{count}} Enhance steps were made from the previous RAW develop. Undo it in History and run Enhance again to match this one._one": "One Enhance step was made from the previous RAW develop. Undo it in History and run Enhance again to match this one.",
  "{{count}} Enhance steps were made from the previous RAW develop. Undo it in History and run Enhance again to match this one._other": "{{count}} Enhance steps were made from the previous RAW develop. Undo it in History and run Enhance again to match this one.",
  "{{count}} failed ({{error}})_one": "{{count}} failed ({{error}})",
  "{{count}} failed ({{error}})_other": "{{count}} failed ({{error}})",
  "{{count}} files already exist and will be replaced._one": "{{count}} file already exists and will be replaced.",
  "{{count}} files already exist and will be replaced._other": "{{count}} files already exist and will be replaced.",
  "{{count}} files already exist and will be skipped._one": "{{count}} file already exists and will be skipped.",
  "{{count}} files already exist and will be skipped._other": "{{count}} files already exist and will be skipped.",
  "{{count}} files already exist: the new ones get a number._one": "{{count}} file already exists: the new ones get a number.",
  "{{count}} files already exist: the new ones get a number._other": "{{count}} files already exist: the new ones get a number.",
  "{{count}} heal strokes were made from the previous RAW develop: its patch can show a seam. Undo it in History and heal again to match this one._one": "One heal stroke was made from the previous RAW develop: its patch can show a seam. Undo it in History and heal again to match this one.",
  "{{count}} heal strokes were made from the previous RAW develop: its patch can show a seam. Undo it in History and heal again to match this one._other": "{{count}} heal strokes were made from the previous RAW develop: its patch can show a seam. Undo it in History and heal again to match this one.",
  "{{count}} megapixels_one": "{{count}} megapixel",
  "{{count}} megapixels_other": "{{count}} megapixels",
  "{{count}} of {{total}} shown": "{{count}} of {{total}} shown",
  "{{count}} photos · edits apply to all_one": "{{count}} photo · edits apply to all",
  "{{count}} photos · edits apply to all_other": "{{count}} photos · edits apply to all",
  "{{count}} photos flagged rejected: nothing deleted_one": "{{count}} photo flagged rejected: nothing deleted",
  "{{count}} photos flagged rejected: nothing deleted_other": "{{count}} photos flagged rejected: nothing deleted",
  "{{count}} photos_one": "{{count}} photo",
  "{{count}} photos_other": "{{count}} photos",
  "{{count}} roundings_one": "{{count}} rounding",
  "{{count}} roundings_other": "{{count}} roundings",
  "{{count}} roundings, one float pass_one": "{{count}} rounding, one float pass",
  "{{count}} roundings, one float pass_other": "{{count}} roundings, one float pass",
  "{{count}} runs_one": "{{count}} run",
  "{{count}} runs_other": "{{count}} runs",
  "{{count}} samples clamped_one": "{{count}} sample clamped",
  "{{count}} samples clamped_other": "{{count}} samples clamped",
  "{{count}} selected": "{{count}} selected",
  "{{count}} spots baked_one": "{{count}} spot baked",
  "{{count}} spots baked_other": "{{count}} spots baked",
  "{{count}} spots drawn live (HDR photos cannot be baked yet)._one": "{{count}} spot drawn live (HDR photos cannot be baked yet).",
  "{{count}} spots drawn live (HDR photos cannot be baked yet)._other": "{{count}} spots drawn live (HDR photos cannot be baked yet).",
  "{{count}} spots drawn live, from before spots were baked._one": "{{count}} spot drawn live, from before spots were baked.",
  "{{count}} spots drawn live, from before spots were baked._other": "{{count}} spots drawn live, from before spots were baked.",
  "{{count}} stars or more_one": "{{count}} star or more",
  "{{count}} stars or more_other": "{{count}} stars or more",
  "{{count}} suggested rejects: hover one for why._one": "{{count}} suggested reject: hover one for why.",
  "{{count}} suggested rejects: hover one for why._other": "{{count}} suggested rejects: hover one for why.",
  "{{done}} of {{count}} photos_one": "{{done}} of {{count}} photo",
  "{{done}} of {{count}} photos_other": "{{done}} of {{count}} photos",
  "{{folder}} and subfolders": "{{folder}} and subfolders",
  "{{format}} cannot hold HDR. Choose AVIF, JPEG XL or PNG, or set HDR to SDR.": "{{format}} cannot hold HDR. Choose AVIF, JPEG XL or PNG, or set HDR to SDR.",
  "{{format}} has no place for a gain map. Choose JPEG or AVIF, or set HDR to SDR.": "{{format}} has no place for a gain map. Choose JPEG or AVIF, or set HDR to SDR.",
  "{{format}} has no place for IPTC: it will not be written.": "{{format}} has no place for IPTC: it will not be written.",
  "{{format}} is written without transparency; a photo that has some is flattened.": "{{format}} is written without transparency; a photo that has some is flattened.",
  "{{free}} is free where {{folder}} is; this export may need about {{need}}.": "{{free}} is free where {{folder}} is; this export may need about {{need}}.",
  "{{key}} already does “{{command}}”.": "{{key}} already does “{{command}}”.",
  "{{key}} cycles": "{{key}} cycles",
  "{{keyword}} — only some of the selection; click to add it to all": "{{keyword}} — only some of the selection; click to add it to all",
  "{{label}} (fine)": "{{label}} (fine)",
  "{{label}} from": "{{label}} from",
  "{{label}} to": "{{label}} to",
  "{{look}} needs you to point at the {{label}}": "{{look}} needs you to point at the {{label}}",
  "{{mask}}: add colour": "{{mask}}: add colour",
  "{{mask}}: colour wash": "{{mask}}: colour wash",
  "{{mean}} a {{unit}}, {{pace}}, {{peak}} of {{memory}}": "{{mean}} a {{unit}}, {{pace}}, {{peak}} of {{memory}}",
  "{{mode}} — click for {{next}}": "{{mode}} — click for {{next}}",
  "{{mp}} MP · ~{{size}} in the project": "{{mp}} MP · ~{{size}} in the project",
  "{{name}} and {{count}} more are larger than Playroom opens ({{megapixels}} megapixels) and will fail._one": "{{name}} and {{count}} more are larger than Playroom opens ({{megapixels}} megapixels) and will fail.",
  "{{name}} and {{count}} more are larger than Playroom opens ({{megapixels}} megapixels) and will fail._other": "{{name}} and {{count}} more are larger than Playroom opens ({{megapixels}} megapixels) and will fail.",
  "{{name}} is larger than Playroom opens ({{megapixels}} megapixels) and will fail.": "{{name}} is larger than Playroom opens ({{megapixels}} megapixels) and will fail.",
  "{{name}} is missing, and its project does not carry a copy of it yet": "{{name}} is missing, and its project does not carry a copy of it yet",
  "{{name}} is not a collections file": "{{name}} is not a collections file",
  "{{name}} selects nothing": "{{name}} selects nothing",
  "{{name}} value": "{{name}} value",
  "{{name}} was not written (the original has none, or the format has no place for it)": "{{name}} was not written (the original has none, or the format has no place for it)",
  "{{name}}: more": "{{name}}: more",
  "{{open}} {{close}} size · Alt erases": "{{open}} {{close}} size · Alt erases",
  "{{purpose}} is not available": "{{purpose}} is not available",
  "{{purpose}} needs this model, a one-time download.": "{{purpose}} needs this model, a one-time download.",
  "{{share}} % slower by the end": "{{share}} % slower by the end",
  "{{stacked}} ({{photos}} from other folders left out)": "{{stacked}} ({{photos}} from other folders left out)",
  "{{step}}: strength": "{{step}}: strength",
  "{{task}} is not available in this build": "{{task}} is not available in this build",
  "{{time}} for a {{mp}}-megapixel photo": "{{time}} for a {{mp}}-megapixel photo",
  "{{time}} per photo": "{{time}} per photo",
  "{{total}} ms · decode {{decode}} · colour {{color}} · encode {{encode}}": "{{total}} ms · decode {{decode}} · colour {{color}} · encode {{encode}}",
  "{{what}} in {{where}} made pixels that are not numbers. Lower it, or undo.": "{{what}} in {{where}} made pixels that are not numbers. Lower it, or undo.",
  "{{what}}: match": "{{what}}: match",
  "{{what}}: neutralise": "{{what}}: neutralise",
  "`{{key}}` must be a list of samples": "`{{key}}` must be a list of samples",
  "`maker` and `model` must be strings": "`maker` and `model` must be strings",
  "`unit` must be HalfShorterSide, HalfDiagonal, FarthestCorner or Lensfun": "`unit` must be HalfShorterSide, HalfDiagonal, FarthestCorner or Lensfun",
  "+{{ev}} EV headroom": "+{{ev}} EV headroom",
  "+1 doubles the light; highlights are the first to clip.": "+1 doubles the light; highlights are the first to clip.",
  "×2 is a safe default; ×4 makes very large files. Source picks the model: Clean stays closest to a sharp original, Damaged repairs a compressed or noisy one as it enlarges, Keep texture leaves its grain.": "×2 is a safe default; ×4 makes very large files. Source picks the model: Clean stays closest to a sharp original, Damaged repairs a compressed or noisy one as it enlarges, Keep texture leaves its grain.",
  "−100 is black and white; past +30, skin turns orange.": "−100 is black and white; past +30, skin turns orange.",
  "≈ Approximates {{list}} with the sliders we have.": "≈ Approximates {{list}} with the sliders we have.",
  "8-bit output of a RAW or HDR photo can band in smooth skies: turn Dither on.": "8-bit output of a RAW or HDR photo can band in smooth skies: turn Dither on.",
  "A {{mp}} MP file is large to edit; consider ×2.": "A {{mp}} MP file is large to edit; consider ×2.",
  "a `Lensfun` profile needs `calibration`: its camera’s `crop` and `aspect`": "a `Lensfun` profile needs `calibration`: its camera’s `crop` and `aspect`",
  "A bidirectional gradient, and gradients that stay exact at any size.": "A bidirectional gradient, and gradients that stay exact at any size.",
  "A CIE 1976 chart with PixlRGB and the gamuts you compare it to.": "A CIE 1976 chart with PixlRGB and the gamuts you compare it to.",
  "A clearer masks panel, and Molten glass draws a solid line along sharp edges.": "A clearer masks panel, and Molten glass draws a solid line along sharp edges.",
  "A correction that warps the frame crops its empty edges.": "A correction that warps the frame crops its empty edges.",
  "A few seconds. The times above then match this computer.": "A few seconds. The times above then match this computer.",
  "A file would be written over its original: change the name, the folder or the format.": "A file would be written over its original: change the name, the folder or the format.",
  "a finer cut-out that keeps hair and fur (BiRefNet lite, 224 MB, about 10 seconds a photo)": "a finer cut-out that keeps hair and fur (BiRefNet lite, 224 MB, about 10 seconds a photo)",
  "a fisheye sample’s `realFocal` must be a positive number": "a fisheye sample’s `realFocal` must be a positive number",
  "A gentle wash, a light leak or a faded print.": "A gentle wash, a light leak or a faded print.",
  "A group of rules with its own all / any / none": "A group of rules with its own all / any / none",
  "A JavaScript error occurred in the main process": "A JavaScript error occurred in the main process",
  "a layer": "a layer",
  "A little clipping in true blacks (shadows under a car) is fine.": "A little clipping in true blacks (shadows under a car) is fine.",
  "A mask’s edge is one crisp line at any zoom.": "A mask’s edge is one crisp line at any zoom.",
  "A model is needed": "A model is needed",
  "A natural lift that rarely looks overdone.": "A natural lift that rarely looks overdone.",
  "A new RAW engine (LibRaw): more cameras, and RAW files that would not open before are tried again.": "A new RAW engine (LibRaw): more cameras, and RAW files that would not open before are tried again.",
  "A new Smoothing slider, under Dehaze, keeps colour and tone changes smooth across sea, sky and skin, so they don’t go blotchy or show a JPEG’s blocks. It shows when you let go of a slider. Photos you edited before start with it off, so they look as they did.": "A new Smoothing slider, under Dehaze, keeps colour and tone changes smooth across sea, sky and skin, so they don’t go blotchy or show a JPEG’s blocks. It shows when you let go of a slider. Photos you edited before start with it off, so they look as they did.",
  "A pen's pressure sets size and flow": "A pen's pressure sets size and flow",
  "A saved render was made by another engine and is made again.": "A saved render was made by another engine and is made again.",
  "A scale past 1000% is not allowed.": "A scale past 1000% is not allowed.",
  "A small language model that looks at your photos on this computer, nothing sent anywhere: it will name what is in each one, so masks are a tap away. It will work in the background only while the computer is idle and plugged in.": "A small language model that looks at your photos on this computer, nothing sent anywhere: it will name what is in each one, so masks are a tap away. It will work in the background only while the computer is idle and plugged in.",
  "A small negative amount draws the eye to the centre.": "A small negative amount draws the eye to the centre.",
  "a stage": "a stage",
  "A trained model removes the noise once; Strength then blends its result with the original.": "A trained model removes the noise once; Strength then blends its result with the original.",
  "a typical computer; test yours below": "a typical computer; test yours below",
  "A wall shot at an angle faces you more squarely.": "A wall shot at an angle faces you more squarely.",
  "A warm glow on a face, a cooler sky, without touching the rest.": "A warm glow on a face, a cooler sky, without touching the rest.",
  "about {{count}} hours_one": "about {{count}} hour",
  "about {{count}} hours_other": "about {{count}} hours",
  "about {{count}} minutes_one": "about {{count}} minute",
  "about {{count}} minutes_other": "about {{count}} minutes",
  "about {{count}} seconds_one": "about {{count}} second",
  "about {{count}} seconds_other": "about {{count}} seconds",
  "About {{name}}": "About {{name}}",
  "Above the {{peak}}× peak: {{pct}}% — click to show": "Above the {{peak}}× peak: {{pct}}% — click to show",
  "Absolute colorimetric": "Absolute colorimetric",
  Add,
  "Add {{count}} selected": "Add {{count}} selected",
  "Add a key": "Add a key",
  "Add a key for {{command}}": "Add a key for {{command}}",
  "Add a keyword…": "Add a keyword…",
  "Add a watermark": "Add a watermark",
  "Add color": "Add color",
  "Add colour": "Add colour",
  "Add colour range": "Add colour range",
  "Add custom layer": "Add custom layer",
  "Add lasso point": "Add lasso point",
  "Add luminance range": "Add luminance range",
  "Add selection": "Add selection",
  "Add selection to collection…": "Add selection to collection…",
  "Add to Collection": "Add to Collection",
  "Add to My Looks": "Add to My Looks",
  "Add to the mask": "Add to the mask",
  "Add to this mask": "Add to this mask",
  "Add to this mask with": "Add to this mask with",
  "Add to this mask: {{tool}}": "Add to this mask: {{tool}}",
  "Add to this mask: every tool": "Add to this mask: every tool",
  "Add…": "Add…",
  Added,
  "Added {{count}} photos to {{name}}_one": "Added {{count}} photo to {{name}}",
  "Added {{count}} photos to {{name}}_other": "Added {{count}} photos to {{name}}",
  "Added on top of Upright. Reset puts the sliders back and keeps the Upright mode.": "Added on top of Upright. Reset puts the sliders back and keeps the Upright mode.",
  "Adds coloured light only where the mask selects.": "Adds coloured light only where the mask selects.",
  "Adds coloured light to the whole scene, as a gel on a lamp would, after exposure.": "Adds coloured light to the whole scene, as a gel on a lamp would, after exposure.",
  "Adds film-like grain.": "Adds film-like grain.",
  "Adds or removes contrast in the midtones, around edges.": "Adds or removes contrast in the midtones, around edges.",
  Advanced,
  "Advanced layers": "Advanced layers",
  AI,
  "AI · judges the damage": "AI · judges the damage",
  "AI denoise": "AI denoise",
  "AI Denoise": "AI Denoise",
  "AI Denoise · {{model}}": "AI Denoise · {{model}}",
  "AI Denoise · {{model}} in {{mask}}": "AI Denoise · {{model}} in {{mask}}",
  "AI denoise & deblur": "AI denoise & deblur",
  "AI Denoise becomes a step": "AI Denoise becomes a step",
  "AI models": "AI models",
  "AI models are off: turn them on in Settings → AI models": "AI models are off: turn them on in Settings → AI models",
  "AI models are off. Nothing below runs until you turn them back on; RAW files still develop with their model.": "AI models are off. Nothing below runs until you turn them back on; RAW files still develop with their model.",
  "AI runs on {{chip}}.": "AI runs on {{chip}}.",
  "AI runs on the processor.": "AI runs on the processor.",
  "AI work runs on your Mac’s performance cores, where it is fastest.": "AI work runs on your Mac’s performance cores, where it is fastest.",
  all,
  All,
  "All {{count}} faces_one": "All {{count}} face",
  "All {{count}} faces_other": "All {{count}} faces",
  "All looks": "All looks",
  "All photos": "All photos",
  Amount,
  "An HDR (PQ/HLG) photo": "An HDR (PQ/HLG) photo",
  "An MCP server for the editor": "An MCP server for the editor",
  "An older edit of this component's edge or opacity is applied": "An older edit of this component's edge or opacity is applied",
  "An S shape adds contrast; lifting the bottom-left point fades the blacks.": "An S shape adds contrast; lifting the bottom-left point fades the blacks.",
  "An SDR picture with a gain map: edit it as HDR from the toolbar": "An SDR picture with a gain map: edit it as HDR from the toolbar",
  "An upscale is always the whole photo.": "An upscale is always the whole photo.",
  Analyse,
  "Analysing the photo…": "Analysing the photo…",
  and,
  "And a cookie": "And a cookie",
  "And much more": "And much more",
  any,
  Any,
  "Any camera": "Any camera",
  "Any keyword": "Any keyword",
  "Any lens": "Any lens",
  "Any rating": "Any rating",
  "Any text": "Any text",
  Aperture,
  Applied,
  "Applied at {{amount}}%. Pick another look to swap it, or take it off.": "Applied at {{amount}}%. Pick another look to swap it, or take it off.",
  "Applied to {{count}} photos_one": "Applied to {{count}} photo",
  "Applied to {{count}} photos_other": "Applied to {{count}} photos",
  "Applied to the photo": "Applied to the photo",
  Apply,
  "Apply settings to {{count}} photos_one": "Apply settings to {{count}} photo",
  "Apply settings to {{count}} photos_other": "Apply settings to {{count}} photos",
  "Approximated with the sliders we have": "Approximated with the sliders we have",
  aqua,
  "Around −15 is a gentle portrait smoother.": "Around −15 is a gentle portrait smoother.",
  "asks you to point at an object": "asks you to point at an object",
  Aspect,
  "Aspect {{aspect}}": "Aspect {{aspect}}",
  Auto,
  "Auto Mask": "Auto Mask",
  "Auto Mask: paint only where the colour matches the colour under the brush": "Auto Mask: paint only where the colour matches the colour under the brush",
  "Auto per photo": "Auto per photo",
  "Auto picks the most the lines support. The crop then fits the corrected picture; Transform adds to it.": "Auto picks the most the lines support. The crop then fits the corrected picture; Transform adds to it.",
  "Auto tone": "Auto tone",
  "Auto Tone": "Auto Tone",
  "Auto WB": "Auto WB",
  "Auto white balance": "Auto white balance",
  "Auto White Balance": "Auto White Balance",
  "Auto White Balance ({{count}} Photos)_one": "Auto White Balance ({{count}} Photo)",
  "Auto White Balance ({{count}} Photos)_other": "Auto White Balance ({{count}} Photos)",
  "Auto white balance on {{count}} photos_one": "Auto white balance on {{count}} photo",
  "Auto white balance on {{count}} photos_other": "Auto white balance on {{count}} photos",
  "Auto white balance on each selected photo": "Auto white balance on each selected photo",
  "Auto white balance on the selection": "Auto white balance on the selection",
  "Auto white balance: {{error}}": "Auto white balance: {{error}}",
  "Auto-stack by capture time": "Auto-stack by capture time",
  "Auto-stack by capture time…": "Auto-stack by capture time…",
  Automatic,
  "AVIF speed 10 is not available: use 9 or lower.": "AVIF speed 10 is not available: use 9 or lower.",
  "Back to the adjustments (Esc)": "Back to the adjustments (Esc)",
  "Back to the default": "Back to the default",
  "Back to the library": "Back to the library",
  Background,
  "Bake {{count}} spots_one": "Bake {{count}} spot",
  "Bake {{count}} spots_other": "Bake {{count}} spots",
  "Bake into pixels": "Bake into pixels",
  "Baking…": "Baking…",
  before,
  Before,
  "Before / after": "Before / after",
  "Before / after split": "Before / after split",
  "Before / After Split": "Before / After Split",
  "Before auto WB": "Before auto WB",
  "Before restoring white balance": "Before restoring white balance",
  "Before/after split": "Before/after split",
  "Benchmark again": "Benchmark again",
  "Benchmark: {{note}}. It works at full load for about a minute.": "Benchmark: {{note}}. It works at full load for about a minute.",
  "Benchmarked on another computer: run it again here": "Benchmarked on another computer: run it again here",
  Benchmarking,
  "Bends the curve in four broad ranges without placing points.": "Bends the curve in four broad ranges without placing points.",
  "Best on high-ISO shots. Fine texture such as bark or fabric can look a little crisper or flatter. It works on the full-size picture, so judge it at 100%; the export has it too. Most cameras only: not Fujifilm X-Trans.": "Best on high-ISO shots. Fine texture such as bark or fabric can look a little crisper or flatter. It works on the full-size picture, so judge it at 100%; the export has it too. Most cameras only: not Fujifilm X-Trans.",
  "Best on small things against plain or repeating backgrounds.": "Best on small things against plain or repeating backgrounds.",
  "Best quality RAW develop": "Best quality RAW develop",
  "Best quality RAW develop, Fujifilm": "Best quality RAW develop, Fujifilm",
  "beta terms": "beta terms",
  "Beta Terms": "Beta Terms",
  "Better models": "Better models",
  "Bidirectional gradient": "Bidirectional gradient",
  "Bidirectional gradient mask": "Bidirectional gradient mask",
  "Bidirectional gradient: full line": "Bidirectional gradient: full line",
  "Bigger, clean": "Bigger, clean",
  "Bigger, keeps texture": "Bigger, keeps texture",
  "Bigger, repaired": "Bigger, repaired",
  Blend,
  blue,
  Blue,
  "Blue primary saturation up is a well-known trick for richer, cleaner colour.": "Blue primary saturation up is a well-known trick for richer, cleaner colour.",
  "Boosts muted colours more than strong ones, and protects skin.": "Boosts muted colours more than strong ones, and protects skin.",
  "Both are only judged right at 100% (Z); fitted to the screen they look weaker.": "Both are only judged right at 100% (Z); fitted to the screen they look weaker.",
  "both eyes of every face, found by a model; pick one face after": "both eyes of every face, found by a model; pick one face after",
  Bottom,
  "Bottom left": "Bottom left",
  "Bottom right": "Bottom right",
  Box,
  "Brightens or darkens one colour at a time.": "Brightens or darkens one colour at a time.",
  "Brightens or darkens the whole picture, in stops.": "Brightens or darkens the whole picture, in stops.",
  Brightness,
  "Brightness and contrast, from the overall level down to the deepest blacks.": "Brightness and contrast, from the overall level down to the deepest blacks.",
  "Brings out or smooths fine detail: skin pores, foliage, fabric.": "Brings out or smooths fine detail: skin pores, foliage, fabric.",
  "Broad, subtle colour changes across the whole palette.": "Broad, subtle colour changes across the whole palette.",
  Brows,
  Brush,
  "Brush {{slot}}": "Brush {{slot}}",
  "Brush erase": "Brush erase",
  "Brush mask": "Brush mask",
  "Brush over the object": "Brush over the object",
  "Brush over the object · Alt-brush what is not part of it": "Brush over the object · Alt-brush what is not part of it",
  "Brush stroke": "Brush stroke",
  "Buildings stop leaning backwards; the crop fits the corrected picture.": "Buildings stop leaning backwards; the crop fits the corrected picture.",
  "Builds the full-size picture from your RAW’s sensor data with fine detail and clean edges. Downloaded by itself; used at 100%, for AI tools and in the export. On a Mac it runs on the graphics chip: about 5 seconds for a 24 MP RAW, where the faster classic method takes 3.": "Builds the full-size picture from your RAW’s sensor data with fine detail and clean edges. Downloaded by itself; used at 100%, for AI tools and in the export. On a Mac it runs on the graphics chip: about 5 seconds for a 24 MP RAW, where the faster classic method takes 3.",
  Calibration,
  Camera,
  "Camera colour: {{colour}}": "Camera colour: {{colour}}",
  "Can’t read": "Can’t read",
  Cancel,
  "Cancel download": "Cancel download",
  cancelled,
  Cancelled: Cancelled2,
  Caption,
  "Capture date": "Capture date",
  "Capture time": "Capture time",
  Centre,
  "Change…": "Change…",
  Changed,
  Changes,
  "Changes the hue, saturation and brightness of one colour family at a time.": "Changes the hue, saturation and brightness of one colour family at a time.",
  "Check now": "Check now",
  "Checking the models": "Checking the models",
  "Checking your beta access": "Checking your beta access",
  "Choose a folder, or export beside each original.": "Choose a folder, or export beside each original.",
  "Choose a photo": "Choose a photo",
  "Choose a watermark": "Choose a watermark",
  "Choose at least one step": "Choose at least one step",
  "Choose folder…": "Choose folder…",
  "Choose PNG…": "Choose PNG…",
  "Choose…": "Choose…",
  "Chosen groups overwrite the same groups on each target. Everything else on the targets is kept.": "Chosen groups overwrite the same groups on each target. Everything else on the targets is kept.",
  "Classic looks: teal shadows with warm highlights, or a warm overall wash.": "Classic looks: teal shadows with warm highlights, or a warm overall wash.",
  clean,
  "Clean · closest to the original": "Clean · closest to the original",
  "Clean and detailed": "Clean and detailed",
  "Cleans the speckled grain out of photos taken in low light or at high ISO.": "Cleans the speckled grain out of photos taken in low light or at high ISO.",
  "Cleans up the blocky squares and smudged colour of heavily compressed JPEGs.": "Cleans up the blocky squares and smudged colour of heavily compressed JPEGs.",
  Clear,
  "Clear component name": "Clear component name",
  "Clear rating": "Clear rating",
  click,
  "Click {{name}} on the photo": "Click {{name}} on the photo",
  "Click a bar to open that colour in the Colour mixer; Shift-click makes a mask of it. The faint bars are the photo before your edits.": "Click a bar to open that colour in the Colour mixer; Shift-click makes a mask of it. The faint bars are the photo before your edits.",
  "Click a bar to open that colour in the Colour mixer.": "Click a bar to open that colour in the Colour mixer.",
  "Click a colour in the photo: add its complement, so it turns neutral": "Click a colour in the photo: add its complement, so it turns neutral",
  "Click a colour to make neutral": "Click a colour to make neutral",
  "Click a glowing pet pupil to bring it to dark.": "Click a glowing pet pupil to bring it to dark.",
  "Click a key to change it, then press the new one. Esc cancels; Backspace removes it.": "Click a key to change it, then press the new one. Esc cancels; Backspace removes it.",
  "Click a purple or green fringe along an edge (zoom in to find one)": "Click a purple or green fringe along an edge (zoom in to find one)",
  "Click a red pupil to darken it to neutral.": "Click a red pupil to darken it to neutral.",
  "Click corners or drag freehand · ⌫ undo point · Alt subtracts · Esc cancels": "Click corners or drag freehand · ⌫ undo point · Alt subtracts · Esc cancels",
  "Click each brow": "Click each brow",
  "Click each eye": "Click each eye",
  "Click each patch of skin": "Click each patch of skin",
  "Click each piece of clothing": "Click each piece of clothing",
  "Click or paint · drag the spot to its source · Alt-click sets a source · ⌫ deletes · [ ] size": "Click or paint · drag the spot to its source · Alt-click sets a source · ⌫ deletes · [ ] size",
  "Click something on the photo and it is found and removed (SAM 2.1, then MI-GAN)": "Click something on the photo and it is found and removed (SAM 2.1, then MI-GAN)",
  "Click something that should be neutral grey": "Click something that should be neutral grey",
  "Click the {{object}} for {{look}} · drag for a box": "Click the {{object}} for {{look}} · drag for a box",
  "Click the colour or tone the mask should select": "Click the colour or tone the mask should select",
  "Click the colour to change": "Click the colour to change",
  "Click the colour to shift on its own": "Click the colour to shift on its own",
  "Click the colour to turn into {{goal}}": "Click the colour to turn into {{goal}}",
  "Click the face": "Click the face",
  "Click the hair": "Click the hair",
  "Click the lips": "Click the lips",
  "Click the person": "Click the person",
  "Click the photo to centre the range on that distance": "Click the photo to centre the range on that distance",
  "Click the photo to centre this range on that colour or tone": "Click the photo to centre this range on that colour or tone",
  "Click the sky": "Click the sky",
  "Click the teeth": "Click the teeth",
  "Click what should go: it is rebuilt from the rest of the photo.": "Click what should go: it is rebuilt from the rest of the photo.",
  "Click, drag a box or brush over anything in a photo (a car, a dog, a window, the sky) and the mask takes exactly that, its edges snapped to the photo’s own.": "Click, drag a box or brush over anything in a photo (a car, a dog, a window, the sky) and the mask takes exactly that, its edges snapped to the photo’s own.",
  "Click, then press a new key": "Click, then press a new key",
  Clipping,
  Clone,
  Close,
  "Close (Esc)": "Close (Esc)",
  "Close info": "Close info",
  Clothes,
  Cloudy,
  "Collapse stack": "Collapse stack",
  "Collapse this stack of {{size}} (S)": "Collapse this stack of {{size}} (S)",
  Collection,
  Collections,
  "Color grading": "Color grading",
  "Color mixer": "Color mixer",
  Colour,
  "Colour each component": "Colour each component",
  "Colour follows edges": "Colour follows edges",
  "Colour from PIXL’s own science, from the sensor to your screen.": "Colour from PIXL’s own science, from the sensor to your screen.",
  "Colour grading": "Colour grading",
  "Colour is stored at half resolution (4:2:2). 4:4:4 keeps it whole.": "Colour is stored at half resolution (4:2:2). 4:4:4 keeps it whole.",
  "Colour is stored at half width resolution. 4:4:4 keeps it whole.": "Colour is stored at half width resolution. 4:4:4 keeps it whole.",
  "Colour is stored at quarter resolution (4:2:0). 4:4:4 keeps it whole.": "Colour is stored at quarter resolution (4:2:0). 4:4:4 keeps it whole.",
  "Colour is stored at quarter resolution. 4:4:4 keeps it whole.": "Colour is stored at quarter resolution. 4:4:4 keeps it whole.",
  "Colour label": "Colour label",
  "Colour Label": "Colour Label",
  "Colour label: blue": "Colour label: blue",
  "Colour label: green": "Colour label: green",
  "Colour label: red": "Colour label: red",
  "Colour label: yellow": "Colour label: yellow",
  "Colour mixer": "Colour mixer",
  "Colour overlay": "Colour overlay",
  "Colour overlay on B&W": "Colour overlay on B&W",
  "Colour range": "Colour range",
  "Colour wash": "Colour wash",
  Colours,
  "Colours beyond sRGB (RAW files and HDR photos have them) are compressed into sRGB. Display P3 or Adobe RGB keep more.": "Colours beyond sRGB (RAW files and HDR photos have them) are compressed into sRGB. Display P3 or Adobe RGB keep more.",
  "Colours in the photo": "Colours in the photo",
  "Colours inside the new space stay exact; those outside are moved to its nearest edge. White maps to white. The usual choice for photographs.": "Colours inside the new space stay exact; those outside are moved to its nearest edge. White maps to white. The usual choice for photographs.",
  "coming soon": "coming soon",
  "Coming soon": "Coming soon",
  "Compiled grade": "Compiled grade",
  "Component name": "Component name",
  "Component options": "Component options",
  "Connect to confirm your beta access": "Connect to confirm your beta access",
  "Container (the file’s own)": "Container (the file’s own)",
  contains,
  "Cools (left) or warms (right) the picture.": "Cools (left) or warms (right) the picture.",
  Copy,
  "Copy (converted per photo)": "Copy (converted per photo)",
  "Copy File Path": "Copy File Path",
  "Copy grade JSON": "Copy grade JSON",
  "Copy settings": "Copy settings",
  "Copy Settings": "Copy Settings",
  "Copy settings from a photo first ({{key}} in Develop).": "Copy settings from a photo first ({{key}} in Develop).",
  Copyright,
  "Corrects distortion and vignetting by hand.": "Corrects distortion and vignetting by hand.",
  "Corrects distortion and vignetting from a measured profile of your lens.": "Corrects distortion and vignetting from a measured profile of your lens.",
  "Corrects what the lens did: distortion, dark corners, colour fringes.": "Corrects what the lens did: distortion, dark corners, colour fringes.",
  "Couldn't open the beta terms: {{reason}}": "Couldn't open the beta terms: {{reason}}",
  "Couldn't open the third-party notices: {{reason}}": "Couldn't open the third-party notices: {{reason}}",
  "Couldn't send the report. Check your connection and try again.": "Couldn't send the report. Check your connection and try again.",
  "Couldn't update: {{error}}": "Couldn't update: {{error}}",
  "Covers {{pct}}% of the photo": "Covers {{pct}}% of the photo",
  Create,
  "Create new mask": "Create new mask",
  Crop,
  "Crop & straighten": "Crop & straighten",
  "Crop tool": "Crop tool",
  Culling,
  Current,
  "Curve preset: {{name}}": "Curve preset: {{name}}",
  "Custom curve": "Custom curve",
  "Custom layer": "Custom layer",
  "Custom layers": "Custom layers",
  "Cuts through haze and fog by bringing back local contrast where the air is thick.": "Cuts through haze and fog by bringing back local contrast where the air is thick.",
  "Cycle how the mask overlay shows": "Cycle how the mask overlay shows",
  "Cycle the crop guides": "Cycle the crop guides",
  damaged,
  "Damaged · repairs compression and noise": "Damaged · repairs compression and noise",
  Darken,
  "Darkens (left) or brightens (right) the corners after the crop.": "Darkens (left) or brightens (right) the corners after the crop.",
  "Darkens or brightens only the bright parts of the picture.": "Darkens or brightens only the bright parts of the picture.",
  "Darker blues give dramatic skies; brighter oranges give luminous skin.": "Darker blues give dramatic skies; brighter oranges give luminous skin.",
  "Date added": "Date added",
  Day,
  Daylight,
  "Daylight sits near 5500 K; tungsten rooms want around 3200 K.": "Daylight sits near 5500 K; tungsten rooms want around 3200 K.",
  days,
  Deblur,
  "Defish fisheye lenses with their lens profiles.": "Defish fisheye lenses with their lens profiles.",
  Defringe,
  Dehaze,
  "Dehaze has been rebuilt. It brings back local contrast where the air is hazy and keeps each area’s brightness and colour, instead of darkening and tinting the whole picture. The same value looks gentler on brightness and colour and stronger on detail; for the old, denser result add some Contrast or a Tone Curve. Negative Dehaze is unchanged.": "Dehaze has been rebuilt. It brings back local contrast where the air is hazy and keeps each area’s brightness and colour, instead of darkening and tinting the whole picture. The same value looks gentler on brightness and colour and stronger on detail; for the old, denser result add some Contrast or a Tone Curve. Negative Dehaze is unchanged.",
  Delete,
  'Delete "{{name}}"': 'Delete "{{name}}"',
  "Delete “{{name}}”? The photos stay where they are.": "Delete “{{name}}”? The photos stay where they are.",
  "Delete collection": "Delete collection",
  "Delete component": "Delete component",
  "Delete mask": "Delete mask",
  "Delete set": "Delete set",
  "Delete the selected mask or component": "Delete the selected mask or component",
  "Delete the set “{{name}}”? The collections in it move to the top level.": "Delete the set “{{name}}”? The collections in it move to the top level.",
  "Deleted {{name}} — {{key}} to undo": "Deleted {{name}} — {{key}} to undo",
  "Denoise inside {{layer}}": "Denoise inside {{layer}}",
  "Denoise the photo": "Denoise the photo",
  "Denoise the RAW data, under Noise reduction → AI: an AI model takes the grain out of a RAW’s sensor data before it becomes a picture, measuring each photo’s noise by itself. Off unless you turn it on; it shows at 100% and in the export.": "Denoise the RAW data, under Noise reduction → AI: an AI model takes the grain out of a RAW’s sensor data before it becomes a picture, measuring each photo’s noise by itself. Off unless you turn it on; it shows at 100% and in the export.",
  Denoising,
  "Denoising a preview": "Denoising a preview",
  "Denoising at full resolution": "Denoising at full resolution",
  Density,
  "Depth far": "Depth far",
  "Depth finder": "Depth finder",
  "Depth near": "Depth near",
  "Depth range": "Depth range",
  "Depth range: select by distance. Playroom maps the photo’s depth once (a small model you download the first time); click the photo to take what is at that distance, then set Near, Far and Softness, with the depth map in the card.": "Depth range: select by distance. Playroom maps the photo’s depth once (a small model you download the first time); click the photo to take what is at that distance, then set Near, Far and Softness, with the depth map in the card.",
  "Depth softness": "Depth softness",
  "Describe the problem first.": "Describe the problem first.",
  Detail,
  "Detail → Noise reduction → AI": "Detail → Noise reduction → AI",
  "Detail → Noise reduction → AI → Denoise the RAW data": "Detail → Noise reduction → AI → Denoise the RAW data",
  Deutan,
  "Deuteranopia (no green)": "Deuteranopia (no green)",
  develop,
  Develop,
  "Develop RAW files": "Develop RAW files",
  "Develop the focused photo": "Develop the focused photo",
  Developer,
  Developing,
  Diagonal,
  Dials,
  Difference,
  "distance ≤ {{distance}}": "distance ≤ {{distance}}",
  "does not contain": "does not contain",
  Done,
  "Done (R or Esc)": "Done (R or Esc)",
  "Double-click to add a point": "Double-click to add a point",
  "Double-click to rename · Alt+↑↓ to move": "Double-click to rename · Alt+↑↓ to move",
  "Double-click to switch to a linear scale (now log).": "Double-click to switch to a linear scale (now log).",
  "Double-click to switch to a log scale (now linear).": "Double-click to switch to a log scale (now linear).",
  Download,
  "Download · {{size}}": "Download · {{size}}",
  "download {{model}}": "download {{model}}",
  "Download {{size}}": "Download {{size}}",
  "Download a model first": "Download a model first",
  "Download any model first.": "Download any model first.",
  "Download it instead": "Download it instead",
  "Download Pixl Playroom": "Download Pixl Playroom",
  "download SAM 2.1": "download SAM 2.1",
  "download the subject model": "download the subject model",
  "Downloaded: it installs when Playroom restarts.": "Downloaded: it installs when Playroom restarts.",
  Downloading,
  "Downloading · {{percent}}%…": "Downloading · {{percent}}%…",
  "Downloading {{model}}": "Downloading {{model}}",
  "Downloading {{version}}… {{percent}}%": "Downloading {{version}}… {{percent}}%",
  "Downloading in the background…": "Downloading in the background…",
  "Downloading the update… {{percent}}%": "Downloading the update… {{percent}}%",
  "Downloading…": "Downloading…",
  "Drag a box around the object": "Drag a box around the object",
  "Drag along edges that should be upright or level · {{n}}/{{max}} · Alt-click removes": "Drag along edges that should be upright or level · {{n}}/{{max}} · Alt-click removes",
  "Drag from the centre · Shift: circle · the ring softens · double-click the pin to fill · ' inverts": "Drag from the centre · Shift: circle · the ring softens · double-click the pin to fill · ' inverts",
  "Drag out from where it is full · Shift keeps to 45° · drag an end to widen that side, the dot to slide the full line, the knob to turn": "Drag out from where it is full · Shift keeps to 45° · drag an end to widen that side, the dot to slide the full line, the knob to turn",
  "Drag outside the box to straighten": "Drag outside the box to straighten",
  "Drag outside the crop to straighten": "Drag outside the crop to straighten",
  "Drag to draw · Shift keeps to 45° · drag the pin to move, the ends to reshape, the knob to turn": "Drag to draw · Shift keeps to 45° · drag the pin to move, the ends to reshape, the knob to turn",
  "Drag to move · Alt-click to remove": "Drag to move · Alt-click to remove",
  "Drag to move · its edges widen · its slopes soften": "Drag to move · its edges widen · its slopes soften",
  "Drag to reorder": "Drag to reorder",
  "Drag to where it copies from · let go to clone": "Drag to where it copies from · let go to clone",
  "Drag to where it copies from, or let go to heal": "Drag to where it copies from, or let go to heal",
  Draw,
  "Draw a box around it instead: Objects finds what is inside": "Draw a box around it instead: Objects finds what is inside",
  "Draw a larger outline around the object first": "Draw a larger outline around the object first",
  "Draw at least two guides along edges": "Draw at least two guides along edges",
  "DRUNet · measured": "DRUNet · measured",
  Duplicate,
  "Duplicate component": "Duplicate component",
  "Duplicate mask": "Duplicate mask",
  "Duplicate of {{name}}": "Duplicate of {{name}}",
  "Duplicate the selected mask or component": "Duplicate the selected mask or component",
  Duplicates,
  "Each {{unit}} took {{mean}} on average; it has to be under {{bar}}": "Each {{unit}} took {{mean}} on average; it has to be under {{bar}}",
  "Each component of the selected mask in a colour of its own (a subtracting one hatched)": "Each component of the selected mask in a colour of its own (a subtracting one hatched)",
  "Each denoise step of a photo this size would take about {{lossless}} in its project, instead of about {{near}} near-losslessly.\n\nLossless keeps the most room for editing afterwards: pushing exposure or shadows far shows nothing of compression. Steps already made keep how they were stored. RAW photos are always stored losslessly.": "Each denoise step of a photo this size would take about {{lossless}} in its project, instead of about {{near}} near-losslessly.\n\nLossless keeps the most room for editing afterwards: pushing exposure or shadows far shows nothing of compression. Steps already made keep how they were stored. RAW photos are always stored losslessly.",
  "each distortion sample needs `focal`, `model` (poly3, poly5, ptlens) and its `k`": "each distortion sample needs `focal`, `model` (poly3, poly5, ptlens) and its `k`",
  "each fisheye sample needs `focal`, `model` (none, poly3, poly5, ptlens) and its `k`": "each fisheye sample needs `focal`, `model` (none, poly3, poly5, ptlens) and its `k`",
  "Each model’s licence is in the third-party notices. Hover a model’s technical name for what is known about the data it was trained on.": "Each model’s licence is in the third-party notices. Hover a model’s technical name for what is known about the data it was trained on.",
  "Each one is downloaded only when you want it and kept on this computer ({{size}} in use). Pick what you want to do to see the models for it.": "Each one is downloaded only when you want it and kept on this computer ({{size}} in use). Pick what you want to do to see the models for it.",
  "Each one is downloaded only when you want it and kept on this computer. Pick what you want to do to see the models for it.": "Each one is downloaded only when you want it and kept on this computer. Pick what you want to do to see the models for it.",
  "Each spot is baked into the photo’s pixels and kept in its project.": "Each spot is baked into the photo’s pixels and kept in its project.",
  "each tca sample needs `focal`, `model` (linear, poly3), `red` and `blue`": "each tca sample needs `focal`, `model` (linear, poly3), `red` and `blue`",
  "each vignetting sample needs `focal`, `aperture` and `k`": "each vignetting sample needs `focal`, `aperture` and `k`",
  "Earlier spots": "Earlier spots",
  "Edge adjusted": "Edge adjusted",
  "Edge radius": "Edge radius",
  Edit,
  "Edit as HDR": "Edit as HDR",
  "Edit as SDR": "Edit as SDR",
  "Edit collection": "Edit collection",
  "Edit custom layer": "Edit custom layer",
  "Edit rules…": "Edit rules…",
  "Edit set": "Edit set",
  "Edit smart collection": "Edit smart collection",
  "Edit the HDR rendition the gain map lifts this photo to (it is written as HDR, or as SDR with a gain map)": "Edit the HDR rendition the gain map lifts this photo to (it is written as HDR, or as SDR with a gain map)",
  "Edit the photo as": "Edit the photo as",
  "Edit the SDR picture the file stores (what a display without HDR shows)": "Edit the SDR picture the file stores (what a display without HDR shows)",
  "Edit the whole photo": "Edit the whole photo",
  "Edit the whole photo (Esc)": "Edit the whole photo (Esc)",
  Edited,
  "Edited as HDR: the rendition its gain map lifts it to": "Edited as HDR: the rendition its gain map lifts it to",
  "Edited first": "Edited first",
  "Editing {{name}}": "Editing {{name}}",
  Edits,
  "Edits that act on the colour channels themselves (curves, colour mixing, per-channel gain, HSL) can look a little different. Open any photo you edited before to see it before and after; remove the old previews whenever you like.": "Edits that act on the colour channels themselves (curves, colour mixing, per-channel gain, HSL) can look a little different. Open any photo you edited before to see it before and after; remove the old previews whenever you like.",
  "Edits to {{name}} were not saved: {{reason}}": "Edits to {{name}} were not saved: {{reason}}",
  Effects,
  "Engine crashed": "Engine crashed",
  "Engine offline": "Engine offline",
  "Engine ready": "Engine ready",
  "Engine report": "Engine report",
  "Engine report (Ctrl+Alt+E)": "Engine report (Ctrl+Alt+E)",
  "Engine Report…": "Engine Report…",
  "Engine starting": "Engine starting",
  "Engine unavailable": "Engine unavailable",
  Enhance,
  "Enhance · {{subject}}": "Enhance · {{subject}}",
  "Enhance · {{subject}} in {{mask}}": "Enhance · {{subject}} in {{mask}}",
  "Enhance {{count}} photos_one": "Enhance {{count}} photo",
  "Enhance {{count}} photos_other": "Enhance {{count}} photos",
  "Enhance → Deblur": "Enhance → Deblur",
  "Enhance → JPEG restore → AI, judges the damage": "Enhance → JPEG restore → AI, judges the damage",
  "Enhance → Super resolution → Source: Clean": "Enhance → Super resolution → Source: Clean",
  "Enhance → Super resolution → Source: Damaged": "Enhance → Super resolution → Source: Damaged",
  "Enhance → Super resolution → Source: Keep texture": "Enhance → Super resolution → Source: Keep texture",
  "Enhance inside {{layer}}": "Enhance inside {{layer}}",
  "Enhance is not available": "Enhance is not available",
  "Enhance needs an SDR photo; this one is HDR": "Enhance needs an SDR photo; this one is HDR",
  Enhancing,
  "Enlarges a photo with believable detail, for printing big or cropping in close.": "Enlarges a photo with believable detail, for printing big or cropping in close.",
  "Enlarging makes a bigger picture, not a sharper one.": "Enlarging makes a bigger picture, not a sharper one.",
  "Enter a size above zero.": "Enter a size above zero.",
  Erase,
  "Erase (or hold Alt)": "Erase (or hold Alt)",
  "Esc when done": "Esc when done",
  "Estimated from earlier runs": "Estimated from earlier runs",
  "estimated from this computer’s speed test": "estimated from this computer’s speed test",
  "Even in feel across the range: all the way down halves a colour’s brightness, so a sky deepens without going black.": "Even in feel across the range: all the way down halves a colour’s brightness, so a sky deepens without going black.",
  "Every face": "Every face",
  "Every RAW, at full size": "Every RAW, at full size",
  Everything,
  Exact,
  "Exact and similar photos": "Exact and similar photos",
  "Expand stack": "Expand stack",
  "Expand the colour chart": "Expand the colour chart",
  "Expand the histogram": "Expand the histogram",
  "Expand this stack of {{size}} (S)": "Expand this stack of {{size}} (S)",
  Expect,
  Export,
  "Export {{count}} Photos…_one": "Export {{count}} Photo…",
  "Export {{count}} Photos…_other": "Export {{count}} Photos…",
  "Export all…": "Export all…",
  "Export in four steps: Format, Size & colour, Metadata & HDR, and Review, built from the editor’s own cards and sliders.": "Export in four steps: Format, Size & colour, Metadata & HDR, and Review, built from the editor’s own cards and sliders.",
  "Export selected": "Export selected",
  "Export…": "Export…",
  "Exported to {{name}}": "Exported to {{name}}",
  Exposure,
  "Exposure & tone": "Exposure & tone",
  "Exposure, Contrast or Saturation": "Exposure, Contrast or Saturation",
  Extension,
  Eyes,
  "Eyes closed? ({{score}})": "Eyes closed? ({{score}})",
  "Eyes, Brows, Lips and Teeth in one click, outlined on every face in the photo, small faces in a group too. With several faces, pick one under the mask. Brows are rough for now.": "Eyes, Brows, Lips and Teeth in one click, outlined on every face in the photo, small faces in a group too. With several faces, pick one under the mask. Brows are rough for now.",
  Face,
  "Face {{n}}": "Face {{n}}",
  "Face finder": "Face finder",
  "Face parts outliner": "Face parts outliner",
  Faces,
  failed,
  Failed,
  Far,
  "Faster RAW previews, using a third of the memory on large files.": "Faster RAW previews, using a third of the memory on large files.",
  "Faster, again": "Faster, again",
  Feather,
  "Feather {{value}} · drag in to soften, out to harden": "Feather {{value}} · drag in to soften, out to harden",
  "Features you would reach for in Photoshop or Lightroom, the PIXL way.": "Features you would reach for in Photoshop or Lightroom, the PIXL way.",
  Field,
  File,
  "File kind": "File kind",
  "File name": "File name",
  "File path copied": "File path copied",
  "File size": "File size",
  Fill,
  "Fills in what you paint over (a stranger, a sign, a power line) with what was likely behind it.": "Fills in what you paint over (a stranger, a sign, a power line) with what was likely behind it.",
  Filmstrip,
  "Filter by rating, flag, label, edits, camera, lens, kind, ISO, focal length, date or keyword": "Filter by rating, flag, label, edits, camera, lens, kind, ISO, focal length, date or keyword",
  Filters,
  "Filters, {{count}} on": "Filters, {{count}} on",
  "Find “{{text}}”": "Find “{{text}}”",
  "Find by name": "Find by name",
  "Find by name, best quality": "Find by name, best quality",
  "Find by name: red car, the dog…": "Find by name: red car, the dog…",
  "Find by name: type what you want masked (“red car”, “the trees”) at the top of the New mask menu, and every one in the photo is found (a 385 MB model, downloaded when you first use it).": "Find by name: type what you want masked (“red car”, “the trees”) at the top of the New mask menu, and every one in the photo is found (a 385 MB model, downloaded when you first use it).",
  "Find copies of the same picture, in this folder or the whole library": "Find copies of the same picture, in this folder or the whole library",
  "Find object": "Find object",
  "Find the object inside this outline (SAM 2.1) and use its own edges instead": "Find the object inside this outline (SAM 2.1) and use its own edges instead",
  "Find the subject": "Find the subject",
  "Finding “{{text}}”": "Finding “{{text}}”",
  "finding an object by name needs the next engine update": "finding an object by name needs the next engine update",
  "Finding duplicates": "Finding duplicates",
  "Finding faces": "Finding faces",
  "Finding the {{subject}}": "Finding the {{subject}}",
  "Finding the lines": "Finding the lines",
  "Finding the object in the outline…": "Finding the object in the outline…",
  "Finds a person’s hair, face, skin and clothes in one click each. Best when the person fills a good part of the frame; edges are soft.": "Finds a person’s hair, face, skin and clothes in one click each. Best when the person fills a good part of the frame; edges are soft.",
  "Finds every face in a photo, small ones in a group too, for the face part masks. Tiny and quick.": "Finds every face in a photo, small ones in a group too, for the face part masks. Tiny and quick.",
  "Finds the main subject for the Subject and Background masks, small and fast.": "Finds the main subject for the Subject and Background masks, small and fast.",
  "Finds the main subject with a finer edge than the quick finder, keeping hair, fur and feathers. Larger, and about ten seconds a photo.": "Finds the main subject with a finer edge than the quick finder, keeping hair, fur and feathers. Larger, and about ten seconds a photo.",
  "Finds the sky (through branches too), trees and plants, and water in one click each. About a second a photo.": "Finds the sky (through branches too), trees and plants, and water in one click each. About a second a photo.",
  "Fine detail wants under 1; soft or large subjects can take more.": "Fine detail wants under 1; soft or large subjects can take more.",
  "Fine subject": "Fine subject",
  "Fine subject finder": "Fine subject finder",
  "Fine subject: a finer cut-out that keeps hair, fur and feathers (a larger model, downloaded when you first use it; about ten seconds a photo).": "Fine subject: a finer cut-out that keeps hair, fur and feathers (a larger model, downloaded when you first use it; about ten seconds a photo).",
  "Finish signing in in your browser…": "Finish signing in in your browser…",
  "Finishing touches: a vignette, film grain and a colour wash.": "Finishing touches: a vignette, film grain and a colour wash.",
  "Fit ↔ 100%": "Fit ↔ 100%",
  "Fit a photo inside a width and height, and read what each rendering intent does next to the choice.": "Fit a photo inside a width and height, and read what each rendering intent does next to the choice.",
  "Fit in Window": "Fit in Window",
  "Fit to the window": "Fit to the window",
  "Fix motion blur": "Fix motion blur",
  "Fix Temp first; Tint is for the cast that remains in skin and greys.": "Fix Temp first; Tint is for the cast that remains in skin and greys.",
  flag,
  Flag,
  "Flag as pick": "Flag as pick",
  "Flag as reject": "Flag as reject",
  Flash,
  Flat,
  Flip,
  "Flip horizontal": "Flip horizontal",
  Flow,
  Fluorescent,
  "Focal length": "Focal length",
  "Fold the panel": "Fold the panel",
  Folder,
  Folders,
  "For a denser, darker look add Contrast or a Tone Curve. Go negative for a soft, misty look.": "For a denser, darker look add Contrast or a Tone Curve. Go negative for a soft, misty look.",
  "For portraits, raise Masking until the skin stays smooth.": "For portraits, raise Masking until the skin stays smooth.",
  "For reading this far. 🍪": "For reading this far. 🍪",
  "For very grainy night and indoor shots. It judges the grain by itself and cleans harder, which can smooth fine texture a little. On a Mac it runs on the graphics chip: about a quarter of a minute for a 24 MP photo.": "For very grainy night and indoor shots. It judges the grain by itself and cleans harder, which can smooth fine texture a little. On a Mac it runs on the graphics chip: about a quarter of a minute for a 24 MP photo.",
  "found by a model": "found by a model",
  "found by a model; best when the person is a good part of the frame": "found by a model; best when the person is a good part of the frame",
  Free,
  "Free a device": "Free a device",
  From,
  "From how fast earlier runs went here": "From how fast earlier runs went here",
  "From the nearest edges, as a share of the picture's shorter edge": "From the nearest edges, as a share of the picture's shorter edge",
  "Fujifilm X-Trans RAWs, at full size": "Fujifilm X-Trans RAWs, at full size",
  Full,
  "Full effect from here": "Full effect from here",
  "Full HDR": "Full HDR",
  "Full HDR, on the top bar: on a display with headroom, such as a MacBook Pro’s or an HDR monitor, the photo shows its highlights brighter than white while you edit, as an HDR export holds them. The eyedropper, scopes and overlays still read the SDR picture.": "Full HDR, on the top bar: on a display with headroom, such as a MacBook Pro’s or an HDR monitor, the photo shows its highlights brighter than white while you edit, as an HDR export holds them. The eyedropper, scopes and overlays still read the SDR picture.",
  "Full resolution": "Full resolution",
  "Gather photos from any folder: make a collection with +, then drag photos onto it.": "Gather photos from any folder: make a collection with +, then drag photos onto it.",
  "Gemma gave no usable names for this photo": "Gemma gave no usable names for this photo",
  "Gemma is looking…": "Gemma is looking…",
  "Gemma, the local assistant": "Gemma, the local assistant",
  Geometry,
  get,
  Glass,
  "Go to {{name}}": "Go to {{name}}",
  Golden,
  Good,
  Grain,
  green,
  Green,
  Grid,
  Group,
  "Group into Stack": "Group into Stack",
  Guided,
  "Guided Upright": "Guided Upright",
  "Guided: draw two to four lines that should be upright or level.": "Guided: draw two to four lines that should be upright or level.",
  Guides,
  Hair,
  HardLight,
  "Hazy areas regain depth and detail and keep their own brightness and colour; it does not darken the whole picture.": "Hazy areas regain depth and detail and keep their own brightness and colour; it does not darken the whole picture.",
  "HDR editing (gain map)": "HDR editing (gain map)",
  "HDR exports use the engine’s own tone mapping, gamut compression and gain maps.": "HDR exports use the engine’s own tone mapping, gamut compression and gain maps.",
  "HDR photos are tone mapped to SDR: the highlights above white are compressed.": "HDR photos are tone mapped to SDR: the highlights above white are compressed.",
  "HDR photos cannot take AI pixel steps yet": "HDR photos cannot take AI pixel steps yet",
  "HDR while you edit, masks you can ask for by name, suggested rejects, and noise reduction that matches your export.": "HDR while you edit, masks you can ask for by name, suggested rejects, and noise reduction that matches your export.",
  "HDR: an SDR picture with a gain map (edit it as HDR in Develop)": "HDR: an SDR picture with a gain map (edit it as HDR in Develop)",
  "HDR: the graded photo as an HDR export holds it, in stops. Click for the screen (SDR) view.": "HDR: the graded photo as an HDR export holds it, in stops. Click for the screen (SDR) view.",
  Headroom,
  "Headroom above reference white (203 nits) up to the photo's peak": "Headroom above reference white (203 nits) up to the photo's peak",
  Heal,
  "Heal → Remove": "Heal → Remove",
  "Heal tool": "Heal tool",
  "Heal, Clone and Remove": "Heal, Clone and Remove",
  "Heal, clone and remove spots": "Heal, clone and remove spots",
  "Heavy models": "Heavy models",
  "HEIC export is replaced by AVIF (HEIC files still open).": "HEIC export is replaced by AVIF (HEIC files still open).",
  Hide,
  "Hide mask": "Hide mask",
  "Hide or show the selected mask": "Hide or show the selected mask",
  "Hide rejected": "Hide rejected",
  "Hide the filmstrip": "Hide the filmstrip",
  "Hide the smart looks that need something this build does not have yet": "Hide the smart looks that need something this build does not have yet",
  "Hide this mask": "Hide this mask",
  "Hide while adjusting": "Hide while adjusting",
  "Hides banding and noise and adds texture; Size and Roughness shape its character.": "Hides banding and noise and adds texture; Size and Roughness shape its character.",
  "High values make surfaces look plastic.": "High values make surfaces look plastic.",
  "Higher brings out texture, and noise with it.": "Higher brings out texture, and noise with it.",
  "Higher is smoother and subtler; lower keeps each range’s colour distinct.": "Higher is smoother and subtler; lower keeps each range’s colour distinct.",
  "Higher sharpens only the strongest edges.": "Higher sharpens only the strongest edges.",
  "Higher shows fainter specks": "Higher shows fainter specks",
  "Highlights clipped: {{pct}}% — click to show": "Highlights clipped: {{pct}}% — click to show",
  "Highlights, Shadows, Whites or Blacks": "Highlights, Shadows, Whites or Blacks",
  Histogram,
  "Histogram numbers": "Histogram numbers",
  History,
  "Hover a look to see it on the photo, then dial it in with Amount. Clicking another swaps it.": "Hover a look to see it on the photo, then dial it in with Amount. Clicking another swaps it.",
  "Hover to see an object · click to take it · or drag a box": "Hover to see an object · click to take it · or drag a box",
  "Hover to see an object, click to take it": "Hover to see an object, click to take it",
  "How a new component joins this mask": "How a new component joins this mask",
  "How different two pictures may be and still count as similar (0: only identical pictures)": "How different two pictures may be and still count as similar (0: only identical pictures)",
  "How far the blocks and banding are smoothed: only ever into what the file's own coefficients allow": "How far the blocks and banding are smoothed: only ever into what the file's own coefficients allow",
  "How far the photo's edges may pull this one, as a share of its shorter side: about three times how far off the edge is": "How far the photo's edges may pull this one, as a share of its shorter side: about three times how far off the edge is",
  "How gradually the range fades past Near and Far": "How gradually the range fades past Near and Far",
  "How many": "How many",
  "How much fine texture is sharpened, beyond the main edges.": "How much fine texture is sharpened, beyond the main edges.",
  "How much of each colour the photo holds; the faint bars are the photo before your edits.": "How much of each colour the photo holds; the faint bars are the photo before your edits.",
  "How much of the blended result shows; with Normal, Amount does the same": "How much of the blended result shows; with Normal, Amount does the same",
  "How much of the photo sits at each brightness, shadows on the left, highlights on the right.": "How much of the photo sits at each brightness, shadows on the left, highlights on the right.",
  "How much of the radius fades out": "How much of the radius fades out",
  "How much the three tints overlap.": "How much the three tints overlap.",
  "How strong colour is overall.": "How strong colour is overall.",
  "How strongly edges are sharpened.": "How strongly edges are sharpened.",
  "How the colours look to": "How the colours look to",
  "How wide the sharpened edge is.": "How wide the sharpened edge is.",
  "HSL / B&W mix": "HSL / B&W mix",
  Hue,
  "I’ve joined": "I’ve joined",
  "If an adjustment ever breaks the picture, the slider responsible turns red and says so; your edit is kept.": "If an adjustment ever breaks the picture, the slider responsible turns red and says so; your edit is kept.",
  "Image on black": "Image on black",
  "Image on white": "Image on white",
  "Import…": "Import…",
  "Imported {{count}} collections_one": "Imported {{count}} collection",
  "Imported {{count}} collections_other": "Imported {{count}} collections",
  "in mask": "in mask",
  "In My Looks": "In My Looks",
  "In My Looks: remove": "In My Looks: remove",
  "In Playroom: {{where}}": "In Playroom: {{where}}",
  "In set": "In set",
  "In the last speed test, one test picture took {{cpu}} on the processor; Playroom uses the faster.": "In the last speed test, one test picture took {{cpu}} on the processor; Playroom uses the faster.",
  "In the last speed test, one test picture took {{fast}} on {{chip}} and {{cpu}} on the processor; Playroom uses the faster.": "In the last speed test, one test picture took {{fast}} on {{chip}} and {{cpu}} on the processor; Playroom uses the faster.",
  "In the last speed test, one test picture took {{fast}} on {{chip}}; Playroom uses the faster.": "In the last speed test, one test picture took {{fast}} on {{chip}}; Playroom uses the faster.",
  info,
  Info,
  "Info and metadata": "Info and metadata",
  Inset,
  "Inspired by {{name}}": "Inspired by {{name}}",
  Intersect,
  "Intersect with the mask": "Intersect with the mask",
  "Intersect with this mask": "Intersect with this mask",
  "Intersect with this mask with": "Intersect with this mask with",
  "Intersect with this mask: {{tool}}": "Intersect with this mask: {{tool}}",
  "Intersect with this mask: every tool": "Intersect with this mask: every tool",
  Invert,
  "Invert component": "Invert component",
  "Invert mask": "Invert mask",
  "Invert the selected component, or the mask": "Invert the selected component, or the mask",
  "Invert this component": "Invert this component",
  "Invert this mask": "Invert this mask",
  Inverted,
  "Inverted — click to un-invert": "Inverted — click to un-invert",
  is,
  "is after": "is after",
  "is at least": "is at least",
  "is at most": "is at most",
  "is before": "is before",
  "is between": "is between",
  "is empty": "is empty",
  "is in the last": "is in the last",
  "is not": "is not",
  "is not empty": "is not empty",
  "It cannot bring back focus that was missed.": "It cannot bring back focus that was missed.",
  "It downloads once and stays on this Mac or PC; everything it does runs here, offline.": "It downloads once and stays on this Mac or PC; everything it does runs here, offline.",
  "It slowed down by {{share}} % as it kept working (too hot, or too little room)": "It slowed down by {{share}} % as it kept working (too hot, or too little room)",
  "It stays sharp at any size and is never graded with the photo.": "It stays sharp at any size and is never graded with the photo.",
  "It used {{peak}}, more than {{share}} % of this computer’s {{memory}}": "It used {{peak}}, more than {{share}} % of this computer’s {{memory}}",
  "Its edits and history are in {{project}} — click to show it": "Its edits and history are in {{project}} — click to show it",
  "its mask is gone": "its mask is gone",
  "Join the beta": "Join the beta",
  "Joining what was found": "Joining what was found",
  "JPEG rebuild": "JPEG rebuild",
  "JPEG repair, automatic": "JPEG repair, automatic",
  "JPEG restore": "JPEG restore",
  "JPEG restore is for JPEG files; choose another step": "JPEG restore is for JPEG files; choose another step",
  "JPEG restore reads the file itself, so it must come first: undo the other pixel steps, or leave it off": "JPEG restore reads the file itself, so it must come first: undo the other pixel steps, or leave it off",
  "Judge it at 100%: grain that looks right fitted is usually too strong.": "Judge it at 100%: grain that looks right fitted is usually too strong.",
  "Jump to": "Jump to",
  "Jump to a panel": "Jump to a panel",
  Keep,
  "Keep (Not a Reject)": "Keep (Not a Reject)",
  "Keep it modest here; the Tone curve gives finer control.": "Keep it modest here; the Tone curve gives finer control.",
  "Keep it: never suggested again": "Keep it: never suggested again",
  "Keep saturation low (under 20) and let Blending soften the joins.": "Keep saturation low (under 20) and let Blending soften the joins.",
  "keep texture": "keep texture",
  "Keep texture · leaves the grain": "Keep texture · leaves the grain",
  "Keep this stroke to the object it was painted on, cut at the object's edges (SAM 2.1)": "Keep this stroke to the object it was painted on, cut at the object's edges (SAM 2.1)",
  "Keep: not a suggested reject": "Keep: not a suggested reject",
  "Keeping it": "Keeping it",
  "Keeping it in the project": "Keeping it in the project",
  "Keeps colour and tone changes smooth across flat areas such as sea, sky and skin, so they don’t go blotchy or show the file’s compression blocks.": "Keeps colour and tone changes smooth across flat areas such as sea, sky and skin, so they don’t go blotchy or show the file’s compression blocks.",
  "Keeps colours exact, white included, with no adaptation to the new white. For soft-proofing a print on screen.": "Keeps colours exact, white included, with no adaptation to the new white. For soft-proofing a print on screen.",
  "Keeps colours vivid rather than accurate. For graphics and charts, rarely for photographs.": "Keeps colours vivid rather than accurate. For graphics and charts, rarely for photographs.",
  "Keeps each AI result exactly, at about six times the size of near-lossless.": "Keeps each AI result exactly, at about six times the size of near-lossless.",
  "Keeps sharpening off smooth areas such as sky and skin.": "Keeps sharpening off smooth areas such as sky and skin.",
  Keyword,
  Keywords,
  "Keywords added in the Info panel (I) gather here.": "Keywords added in the Info panel (I) gather here.",
  Kind,
  label,
  Label,
  "Label: {{label}}": "Label: {{label}}",
  "Laid on after the crop and resize, at the size the picture is exported.": "Laid on after the crop and resize, at the size the picture is exported.",
  "Landscapes and architecture like +10 to +25; portraits rarely want more than +5.": "Landscapes and architecture like +10 to +25; portraits rarely want more than +5.",
  "Large models that work your computer hard. Each stays off until a benchmark shows this computer can keep it up, and you turn it on.": "Large models that work your computer hard. Each stays off until a benchmark shows this computer can keep it up, and you turn it on.",
  "Larger heal brush": "Larger heal brush",
  "Larger mask brush": "Larger mask brush",
  Lasso,
  "Lasso · {{count}} points_one": "Lasso · {{count}} point",
  "Lasso · {{count}} points_other": "Lasso · {{count}} points",
  "Lasso mask": "Lasso mask",
  "Lasso subtract": "Lasso subtract",
  "Last render": "Last render",
  "Last render {{ms}} ms": "Last render {{ms}} ms",
  Later,
  "Layers in the engine's own terms (a {{type}} as JSON: stages in any space, any op — CDL, qualifiers, LUTs, blend modes). They run after the panels and masks. The engine names the field when one is wrong.": "Layers in the engine's own terms (a {{type}} as JSON: stages in any space, any op — CDL, qualifiers, LUTs, blend modes). They run after the panels and masks. The engine names the field when one is wrong.",
  "Leaning buildings stand up straight; some of the frame is cropped.": "Leaning buildings stand up straight; some of the frame is cropped.",
  Left,
  "Left brings back clouds and bright skin; far left can look flat or grey.": "Left brings back clouds and bright skin; far left can look flat or grey.",
  "Left gives punch and deep blacks; right gives a faded, matte look.": "Left gives punch and deep blacks; right gives a faded, matte look.",
  "Left lets the highlight tint reach deeper; right lets the shadow tint climb.": "Left lets the highlight tint reach deeper; right lets the shadow tint climb.",
  "Left smooths skin without blurring edges; right adds crispness.": "Left smooths skin without blurring edges; right adds crispness.",
  Lens,
  "Lens corrections": "Lens corrections",
  "Lens profile": "Lens profile",
  "Lens: pick green fringe": "Lens: pick green fringe",
  "Lens: pick purple fringe": "Lens: pick purple fringe",
  "Let an AI assistant work in Playroom with you, on your own computer.": "Let an AI assistant work in Playroom with you, on your own computer.",
  "Let an AI assistant you already use work in Playroom with you, on your own computer, through an MCP server.": "Let an AI assistant you already use work in Playroom with you, on your own computer, through an MCP server.",
  "Let go without dragging and it picks a source itself.": "Let go without dragging and it picks a source itself.",
  "Let’s go": "Let’s go",
  "Lets masks find the main subject for you, or anything you click, box or brush over.": "Lets masks find the main subject for you, or anything you click, box or brush over.",
  Level,
  "Levels the photo and makes it upright from the straight lines in it.": "Levels the photo and makes it upright from the straight lines in it.",
  "Levels with > (Places > Canada), several with commas; Enter adds": "Levels with > (Places > Canada), several with commas; Enter adds",
  Library: Library$1,
  "Licence Agreement": "Licence Agreement",
  "Lifted shadows": "Lifted shadows",
  "Lifting blue in the shadows and cutting it in the highlights gives a cross-processed look.": "Lifting blue in the shadows and cutting it in the highlights gives a cross-processed look.",
  "Lifts or deepens only the dark parts of the picture.": "Lifts or deepens only the dark parts of the picture.",
  "Lifts the whole finished picture toward one colour, blacks as much as whites.": "Lifts the whole finished picture toward one colour, blacks as much as whites.",
  Light,
  Lighten,
  "Like the repairing one, but leaves more of the photo’s own texture, and a little of its grain.": "Like the repairing one, but leaves more of the photo’s own texture, and a little of its grain.",
  Linear,
  "Linear gradient": "Linear gradient",
  "Linear gradient mask": "Linear gradient mask",
  Lips,
  "loaded in {{seconds}} s": "loaded in {{seconds}} s",
  "Loading {{model}}": "Loading {{model}}",
  "Loading the model": "Loading the model",
  "Local AI, honestly": "Local AI, honestly",
  "Local contrast at three scales: fine texture, midtone punch and haze.": "Local contrast at three scales: fine texture, midtone punch and haze.",
  Look,
  "Look for the update": "Look for the update",
  "Look: {{name}}": "Look: {{name}}",
  "Looking for duplicates… the first look reads every picture, so it takes a while.": "Looking for duplicates… the first look reads every picture, so it takes a while.",
  "Looking for the update…": "Looking for the update…",
  Looks,
  "Looks that understand more of the photo and adjust each part on its own.": "Looks that understand more of the photo and adjust each part on its own.",
  "Looks, a new way to make masks, and a new RAW engine.": "Looks, a new way to make masks, and a new RAW engine.",
  "Lossless AVIF keeps full colour: set Chroma to 4:4:4 or turn Lossless off.": "Lossless AVIF keeps full colour: set Chroma to 4:4:4 or turn Lossless off.",
  "Lower it whenever the clipping warning (J) shows red in the sky.": "Lower it whenever the clipping warning (J) shows red in the sky.",
  "Lower Saturation with higher Vibrance gives a modern, muted look.": "Lower Saturation with higher Vibrance gives a modern, muted look.",
  Luminance,
  "Luminance range": "Luminance range",
  "Made {{count}} stacks by capture time_one": "Made {{count}} stack by capture time",
  "Made {{count}} stacks by capture time_other": "Made {{count}} stacks by capture time",
  "Made from the previous RAW develop: being made again.": "Made from the previous RAW develop: being made again.",
  "Made from the previous RAW develop.": "Made from the previous RAW develop.",
  magenta,
  "Make a virtual copy": "Make a virtual copy",
  "Make cover": "Make cover",
  "Make photos bigger": "Make photos bigger",
  "Make Stack Cover": "Make Stack Cover",
  "Make the focused photo its stack's cover": "Make the focused photo its stack's cover",
  "Make Virtual Copy": "Make Virtual Copy",
  "Makes a clean photo twice or four times as wide and tall, staying closest to the original. Quick: a fraction of a second.": "Makes a clean photo twice or four times as wide and tall, staying closest to the original. Quick: a fraction of a second.",
  "Makes a photo twice or four times as wide and tall and repairs compression blocks and noise as it goes. Best for small, damaged pictures; edges come out a little smooth.": "Makes a photo twice or four times as wide and tall and repairs compression blocks and noise as it goes. Best for small, damaged pictures; edges come out a little smooth.",
  "Makes every colour stronger or weaker by the same amount.": "Makes every colour stronger or weaker by the same amount.",
  "Makes the photo larger with a model that adds believable detail.": "Makes the photo larger with a model that adds believable detail.",
  "Makes: {{list}}": "Makes: {{list}}",
  "Manage devices": "Manage devices",
  map,
  "Maps every input brightness to an output brightness, for full control of contrast.": "Maps every input brightness to an output brightness, for full control of contrast.",
  Mask,
  "Mask {{name}}": "Mask {{name}}",
  "Mask blend": "Mask blend",
  "Mask name": "Mask name",
  "Mask opacity": "Mask opacity",
  "Mask options": "Mask options",
  "Mask removed": "Mask removed",
  Masks,
  "Masks & local adjustments": "Masks & local adjustments",
  "Masks → New → Depth range": "Masks → New → Depth range",
  "Masks → New → Eyes, Brows, Lips or Teeth": "Masks → New → Eyes, Brows, Lips or Teeth",
  "Masks → New → Face, Hair, Skin or Clothes": "Masks → New → Face, Hair, Skin or Clothes",
  "Masks → New → Find by name": "Masks → New → Find by name",
  "Masks → New → Fine subject": "Masks → New → Fine subject",
  "Masks → New → Objects or Sky": "Masks → New → Objects or Sky",
  "Masks → New → Sky, Vegetation or Water": "Masks → New → Sky, Vegetation or Water",
  "Masks → New → Subject or Background": "Masks → New → Subject or Background",
  "Masks window": "Masks window",
  Match,
  "Match to a colour": "Match to a colour",
  Matte,
  max,
  "Mean brightness {{mean}} · spread {{spread}} · mean saturation {{saturation}}": "Mean brightness {{mean}} · spread {{spread}} · mean saturation {{saturation}}",
  "Measure each photo's own white": "Measure each photo's own white",
  "measured on this computer": "measured on this computer",
  "Measuring {{done}} of {{total}}…": "Measuring {{done}} of {{total}}…",
  "Medium contrast": "Medium contrast",
  "metadata not written: {{reason}}": "metadata not written: {{reason}}",
  Method,
  Metrics,
  "Metrics before and after (range, contrast, clipping, colour cast), the photo’s dominant colours with their values, and how it reads with a colour-vision deficiency.": "Metrics before and after (range, contrast, clipping, colour cast), the photo’s dominant colours with their values, and how it reads with a colour-vision deficiency.",
  min,
  "Minimum rating": "Minimum rating",
  Mixed,
  Model,
  Moderate,
  months,
  More,
  "More contrast deepens shadows, brightens highlights and saturates colour a little.": "More contrast deepens shadows, brightens highlights and saturates colour a little.",
  "More of the tools you know": "More of the tools you know",
  "Most visible near the corners of wide lenses.": "Most visible near the corners of wide lenses.",
  "Motion blur · focus {{share}} of the burst’s best": "Motion blur · focus {{share}} of the burst’s best",
  "Motion blur fix": "Motion blur fix",
  Move,
  "Move · double-click to fill the frame": "Move · double-click to fill the frame",
  "Move bidirectional gradient": "Move bidirectional gradient",
  "Move down": "Move down",
  "Move lasso point": "Move lasso point",
  "Move linear gradient": "Move linear gradient",
  "Move radial gradient": "Move radial gradient",
  "Move the edge in (−) or out (+), up to 3% of the photo's shorter side": "Move the edge in (−) or out (+), up to 3% of the photo's shorter side",
  "Move up": "Move up",
  "Moves the point where shadows hand over to highlights.": "Moves the point where shadows hand over to highlights.",
  "Much cleaner than classic noise reduction at high ISO. The result is kept with the photo, so undo, redo and Strength never run the model again.": "Much cleaner than classic noise reduction at high ISO. The result is kept with the photo, so undo, redo and Strength never run the model again.",
  Multiply,
  "Multiply · darkens": "Multiply · darkens",
  "Multiply suits a dark mark on light pictures, Screen a light one on dark": "Multiply suits a dark mark on light pictures, Screen a light one on dark",
  "My Looks": "My Looks",
  "My presets": "My presets",
  "NAFNet · real noise": "NAFNet · real noise",
  Name,
  "Name a thing to mask": "Name a thing to mask",
  "Name a thing…": "Name a thing…",
  "Name what’s in it": "Name what’s in it",
  "named by Gemma": "named by Gemma",
  "Native ({{scale}})": "Native ({{scale}})",
  Navigation,
  Near,
  "Near-lossless (the default) cannot be told apart, but leaves a little less room for very strong exposure or shadow pushes.": "Near-lossless (the default) cannot be told apart, but leaves a little less room for very strong exposure or shadow pushes.",
  "needs the next engine update": "needs the next engine update",
  "neutral {{pct}}%": "neutral {{pct}}%",
  Neutralise,
  "Neutralise turns a colour you click grey; Match turns one colour into another.": "Neutralise turns a colour you click grey; Match turns one colour into another.",
  New,
  "New collection": "New collection",
  "New collection…": "New collection…",
  "New mask": "New mask",
  "New Mask": "New Mask",
  "New set": "New set",
  "New set…": "New set…",
  "New sliders: drag the bar, click the value to type one, double-click to reset.": "New sliders: drag the bar, click the value to type one, double-click to reset.",
  "New smart collection": "New smart collection",
  "New smart collection…": "New smart collection…",
  "Next Overlay Style": "Next Overlay Style",
  "Next panel": "Next panel",
  "Next Panel": "Next Panel",
  "Next photo": "Next photo",
  No,
  "No {{label}} found in this photo": "No {{label}} found in this photo",
  "No bursts to stack": "No bursts to stack",
  "No clear subject in this photo: try a brush or a range mask": "No clear subject in this photo: try a brush or a range mask",
  "No colour measured yet.": "No colour measured yet.",
  "No device to free.": "No device to free.",
  "No duplicates here. Raise “Similar” to find looser matches.": "No duplicates here. Raise “Similar” to find looser matches.",
  "No duplicates match the filters.": "No duplicates match the filters.",
  "No effect past here": "No effect past here",
  "No effect past here (this side)": "No effect past here (this side)",
  "No face found in this photo for {{label}}": "No face found in this photo for {{label}}",
  "no grade — the fast path": "no grade — the fast path",
  "No look matches “{{query}}”.": "No look matches “{{query}}”.",
  "No masks yet. New limits edits to part of the photo.": "No masks yet. New limits edits to part of the photo.",
  "no neutral to work from": "no neutral to work from",
  "No person found in this photo for {{label}}: try a brush": "No person found in this photo for {{label}}: try a brush",
  "No photos match the filters.": "No photos match the filters.",
  "No PNG chosen": "No PNG chosen",
  "No rules yet: every photo matches.": "No rules yet: every photo matches.",
  "No suggested rejects here": "No suggested rejects here",
  "No suggested rejects here.": "No suggested rejects here.",
  "No update reached this copy yet. Try again shortly, or download it.": "No update reached this copy yet. Try again shortly, or download it.",
  "Noise measurement: {{error}}": "Noise measurement: {{error}}",
  "Noise reduction": "Noise reduction",
  "Noise Reduction looks the same in the preview, at 100% and in the exported file. Exports of noisy photos are cleaner than before at the same settings, most in bright, even areas such as walls and skies.": "Noise Reduction looks the same in the preview, at 100% and in the exported file. Exports of noisy photos are cleaner than before at the same settings, most in bright, even areas such as walls and skies.",
  none,
  None,
  "None (top level)": "None (top level)",
  Normal,
  "not a JSON object": "not a JSON object",
  "Not a language Playroom has.": "Not a language Playroom has.",
  "Not allowed.": "Not allowed.",
  "Not applied": "Not applied",
  "Not enough straight lines for {{mode}}": "Not enough straight lines for {{mode}}",
  "Not enough straight lines for {{mode}} ({{why}})": "Not enough straight lines for {{mode}} ({{why}})",
  "Not found at {{path}}": "Not found at {{path}}",
  "Not now": "Not now",
  "Not passed: this computer can’t keep it up": "Not passed: this computer can’t keep it up",
  "Not RAW": "Not RAW",
  "Nothing found for “{{text}}”: try other words, or Objects to draw a box": "Nothing found for “{{text}}”: try other words, or Objects to draw a box",
  "Nothing open": "Nothing open",
  "Nothing rendered yet.": "Nothing rendered yet.",
  "Nothing stands out inside this outline": "Nothing stands out inside this outline",
  "nothing was found there to remove": "nothing was found there to remove",
  "nothing was pointed at": "nothing was pointed at",
  "Now click the colour it should become": "Now click the colour it should become",
  object,
  "Object": "Object",
  "Object detection": "Object detection",
  "Object detection has its own button beside the brush, gradients and lasso.": "Object detection has its own button beside the brush, gradients and lasso.",
  "Object remover": "Object remover",
  Objects,
  "Objects mask (select by pointing)": "Objects mask (select by pointing)",
  "Objects: point at anything and Playroom selects it. Hover and click, draw a box or scribble over it; Shift adds a part, Alt takes one away.": "Objects: point at anything and Playroom selects it. Hover and click, draw a box or scribble over it; Shift adds a part, Alt takes one away.",
  "of the {{count}} photos in {{place}} match_one": "of the {{count}} photo in {{place}} match",
  "of the {{count}} photos in {{place}} match_other": "of the {{count}} photos in {{place}} match",
  "of the {{count}} photos in view match_one": "of the {{count}} photo in view match",
  "of the {{count}} photos in view match_other": "of the {{count}} photos in view match",
  "of the following": "of the following",
  "of the following rules": "of the following rules",
  Off,
  "Off stops every AI model at once: masks found by a model, AI denoise, Enhance, Find by name and Gemma. RAW files still develop with their model.": "Off stops every AI model at once: masks found by a model, AI denoise, Enhance, Find by name and Gemma. RAW files still develop with their model.",
  "Off until benchmarked and turned on": "Off until benchmarked and turned on",
  offline,
  Offline,
  On,
  "On a RAW, the model works on the developed, linear pixels: white balance, profile and tone stay as editable as before.": "On a RAW, the model works on the developed, linear pixels: white balance, profile and tone stay as editable as before.",
  "On encoded values, 0 to 1.": "On encoded values, 0 to 1.",
  "One-off AI steps on the pixels: JPEG repair, deblur and upscaling.": "One-off AI steps on the pixels: JPEG repair, deblur and upscaling.",
  "Only {{free}} is free where {{folder}} is.": "Only {{free}} is free where {{folder}} is.",
  "only a RAW has a camera colour": "only a RAW has a camera colour",
  "Only along edges; flat areas of the same hue are left alone.": "Only along edges; flat areas of the same hue are left alone.",
  "Only camera RAW files and DNGs have a camera colour.": "Only camera RAW files and DNGs have a camera colour.",
  "Only that band moves: oranges for skin, blues for sky, greens for foliage.": "Only that band moves: oranges for skin, blues for sky, greens for foliage.",
  Opacity,
  Open,
  "Open a folder first": "Open a folder first",
  "Open a folder of photographs.": "Open a folder of photographs.",
  "Open a folder…": "Open a folder…",
  "Open folder": "Open folder",
  "Open folder…": "Open folder…",
  "Open Folder…": "Open Folder…",
  "Open in Develop": "Open in Develop",
  "Open or Close Stack": "Open or Close Stack",
  "Open or close the focused stack": "Open or close the focused stack",
  "Open Recent": "Open Recent",
  Opened,
  "Opened as saved": "Opened as saved",
  "Opening the library index": "Opening the library index",
  "Opening your last folder": "Opening your last folder",
  Operator,
  Optics,
  orange,
  Organise,
  Original,
  "Our own colour science": "Our own colour science",
  "Our own language models": "Our own language models",
  "out: {{space}} · {{from}}→{{to}} bits": "out: {{space}} · {{from}}→{{to}} bits",
  Outline,
  "Outlines each face’s eyes, brows, lips and mouth, so a mask takes exactly them. Brows are rough for now.": "Outlines each face’s eyes, brows, lips and mouth, so a mask takes exactly them. Brows are rough for now.",
  "Over 300 looks, from film stocks and cinema to camera makers’ own, browsed on your photo with live previews, search and shelves.": "Over 300 looks, from film stocks and cinema to camera makers’ own, browsed on your photo with live previews, search and shelves.",
  Overlay,
  "Overlay colour": "Overlay colour",
  "Overlay mode": "Overlay mode",
  "Overlay options": "Overlay options",
  "Paint a little past its edges, shadow included.": "Paint a little past its edges, shadow included.",
  "Paint over what should go: an AI model fills it with what was likely behind it.": "Paint over what should go: an AI model fills it with what was likely behind it.",
  "Paint overlay needs an SDR picture; this HDR photo keeps highlight priority": "Paint overlay needs an SDR picture; this HDR photo keeps highlight priority",
  "Paints over things you want gone from a photo.": "Paints over things you want gone from a photo.",
  "Pair a Shadows lift with a slight Blacks drop to keep depth.": "Pair a Shadows lift with a slight Blacks drop to keep depth.",
  "Pan (hold and drag)": "Pan (hold and drag)",
  "Passed: this computer can keep it up": "Passed: this computer can keep it up",
  "Past about 60, edges halo and noise grows.": "Past about 60, edges halo and noise grows.",
  "Paste settings": "Paste settings",
  "Paste Settings": "Paste Settings",
  "Paste settings onto the selection…": "Paste settings onto the selection…",
  "Paste Settings…": "Paste Settings…",
  "Pasted onto {{count}} photos_one": "Pasted onto {{count}} photo",
  "Pasted onto {{count}} photos_other": "Pasted onto {{count}} photos",
  People,
  "People parts finder": "People parts finder",
  "People: Face, Hair, Skin and Clothes in one click each, found by a small model. They work best when the person fills a good part of the frame.": "People: Face, Hair, Skin and Clothes in one click each, found by a small model. They work best when the person fills a good part of the frame.",
  Perceptual,
  "Performance ({{scale}})": "Performance ({{scale}})",
  Person,
  "Perspective by hand: tilt, turn, rotate, stretch and move the picture.": "Perspective by hand: tilt, turn, rotate, stretch and move the picture.",
  "Pet eye": "Pet eye",
  Photo,
  "photo named": "photo named",
  "photo read": "photo read",
  "Photos in this folder taken no more than this far apart become one stack, the first on top. Photos already in a stack are left as they are.": "Photos in this folder taken no more than this far apart become one stack, the first on top. Photos already in a stack are left as they are.",
  "Photos that look like rejects, with why: nothing is deleted": "Photos that look like rejects, with why: nothing is deleted",
  Pick,
  PICK,
  "Pick a grey or white with the eyedropper first, then season by eye.": "Pick a grey or white with the eyedropper first, then season by eye.",
  "Pick a tool below to shape this mask.": "Pick a tool below to shape this mask.",
  "Pick both in the photo": "Pick both in the photo",
  "Pick depth": "Pick depth",
  "Pick one in the library or the filmstrip.": "Pick one in the library or the filmstrip.",
  "Pick range": "Pick range",
  "Pick the colour to change": "Pick the colour to change",
  Picked,
  Picks,
  "Picks one exact colour from the photo and shifts only it.": "Picks one exact colour from the photo and shifts only it.",
  "Pin {{name}}": "Pin {{name}}",
  "Pin to the top": "Pin to the top",
  "pinch or scroll to zoom, {{key}}+drag to pan": "pinch or scroll to zoom, {{key}}+drag to pan",
  "PIXL engine {{version}}": "PIXL engine {{version}}",
  "Pixl Playroom is locked until beta access is confirmed.": "Pixl Playroom is locked until beta access is confirmed.",
  "Pixl Playroom Website": "Pixl Playroom Website",
  "Pixl Playroom works offline for a month at a time. Connect to the internet so it can confirm your beta access, then choose Check now.": "Pixl Playroom works offline for a month at a time. Connect to the internet so it can confirm your beta access, then choose Check now.",
  "PIXL’s own colour, a clearer way to export, and scopes at full size.": "PIXL’s own colour, a clearer way to export, and scopes at full size.",
  "PIXL's own looks, made with Playroom's sliders. Cameras, film stocks and films are named only as what inspired a look; PIXL is not affiliated with or endorsed by their owners.": "PIXL's own looks, made with Playroom's sliders. Cameras, film stocks and films are named only as what inspired a look; PIXL is not affiliated with or endorsed by their owners.",
  "Places points on the curve itself, for all channels or red, green and blue alone.": "Places points on the curve itself, for all channels or red, green and blue alone.",
  "Playroom {{version}} is on its way. Its notes show once it is installed.": "Playroom {{version}} is on its way. Its notes show once it is installed.",
  "Playroom {{version}} is ready: restart to update": "Playroom {{version}} is ready: restart to update",
  "Playroom cannot write to {{folder}}: choose another folder.": "Playroom cannot write to {{folder}}: choose another folder.",
  "Playroom measures how grainy your photo is first, then removes just that much, so hair, fabric and skin keep their texture.": "Playroom measures how grainy your photo is first, then removes just that much, so hair, fabric and skin keep their texture.",
  "Playroom needs to check your account before it exports. Connect to the internet, then choose Check now in Settings.": "Playroom needs to check your account before it exports. Connect to the internet, then choose Check now in Settings.",
  "Playroom needs to confirm your licence before it exports again. Connect to the internet, then choose Check now in Settings.": "Playroom needs to confirm your licence before it exports again. Connect to the internet, then choose Check now in Settings.",
  "Point color": "Point color",
  "Point colour": "Point colour",
  "Point colour: add": "Point colour: add",
  "Point colour: re-sample": "Point colour: re-sample",
  Position,
  Presence,
  Preset,
  "Preset name": "Preset name",
  "Preset: {{name}}": "Preset: {{name}}",
  Presets,
  "Press a key…": "Press a key…",
  "Press on the flaw, hold and drag to where it should copy from, and let go.": "Press on the flaw, hold and drag to where it should copy from, and let go.",
  "Press on the photo and drag up or down to move what controls that colour or tone": "Press on the photo and drag up or down to move what controls that colour or tone",
  "Press on what should go, hold and drag to what should replace it, and let go.": "Press on what should go, hold and drag to what should replace it, and let go.",
  Pressure,
  preview,
  Preview,
  "Previous panel": "Previous panel",
  "Previous Panel": "Previous Panel",
  "Previous photo": "Previous photo",
  "Privacy Policy": "Privacy Policy",
  Profile,
  Protan,
  "Protanopia (no red)": "Protanopia (no red)",
  "Pull this edge onto the photo's own edges, at full resolution (the engine's refine)": "Pull this edge onto the photo's own edges, at full resolution (the engine's refine)",
  "Pulls a green (left) or magenta (right) cast out.": "Pulls a green (left) or magenta (right) cast out.",
  purple,
  Purple,
  "Push it until the clipping warning (J) just shows, then back off a touch.": "Push it until the clipping warning (J) just shows, then back off a touch.",
  "Put the tool down, edit the whole photo, fit, or back to the library": "Put the tool down, edit the whole photo, fit, or back to the library",
  queued,
  Queued,
  Quick,
  "Radial feather": "Radial feather",
  "Radial gradient": "Radial gradient",
  "Radial gradient mask": "Radial gradient mask",
  "Radial gradient: fill the frame": "Radial gradient: fill the frame",
  "Raise Feather for a vignette nobody notices but everybody feels.": "Raise Feather for a vignette nobody notices but everybody feels.",
  "Raise it until the grain is gone at 100%, then back off a little.": "Raise it until the grain is gone at 100%, then back off a little.",
  "Raise Range to catch the colour’s shadows and highlights too.": "Raise Range to catch the colour’s shadows and highlights too.",
  Range,
  "Range smoothness": "Range smoothness",
  rate,
  "Rate 1 star": "Rate 1 star",
  "Rate 2 stars": "Rate 2 stars",
  "Rate 3 stars": "Rate 3 stars",
  "Rate 4 stars": "Rate 4 stars",
  "Rate 5 stars": "Rate 5 stars",
  Rating,
  "Rating & flags": "Rating & flags",
  "RAW files keep their highlights: blown areas are rebuilt from the channels that still hold detail, and the brightest parts roll softly into white instead of clipping. RAWs you edited before are developed again the first time you open them.": "RAW files keep their highlights: blown areas are rebuilt from the channels that still hold detail, and the brightest parts roll softly into white instead of clipping. RAWs you edited before are developed again the first time you open them.",
  "RAW files use PIXL’s own camera colour for the 46 bodies it knows (the others keep the file’s own). RAWs you edited before can shift a little, and heals, denoise and enhance made on the old colour are marked, because their pixels moved. Your white balance keeps its look. Switch any photo back under Colour in the develop panel.": "RAW files use PIXL’s own camera colour for the 46 bodies it knows (the others keep the file’s own). RAWs you edited before can shift a little, and heals, denoise and enhance made on the old colour are marked, because their pixels moved. Your white balance keeps its look. Switch any photo back under Colour in the develop panel.",
  "RAW sensor denoise": "RAW sensor denoise",
  "RAW sharpening now sharpens edges and leaves flat areas alone. When sharpening is too fine to show at the current zoom, the Sharpening panel says so.": "RAW sharpening now sharpens edges and leaves flat areas alone. When sharpening is too fine to show at the current zoom, the Sharpening panel says so.",
  "RAWs are developed at full size with an AI model for crisper fine detail and fewer colour fringes, at 100%, for AI tools and in the export. The model (2 MB) downloads by itself; without it, a better classic method than before is used. Fujifilm X-Trans gets its own the first time you open one.": "RAWs are developed at full size with an AI model for crisper fine detail and fewer colour fringes, at 100%, for AI tools and in the export. The model (2 MB) downloads by itself; without it, a better classic method than before is used. Fujifilm X-Trans gets its own the first time you open one.",
  "Reach for Vibrance first, and Saturation only for a deliberate look.": "Reach for Vibrance first, and Saturation only for a deliberate look.",
  "Reading the file and building proxies": "Reading the file and building proxies",
  "Rebuild (no model)": "Rebuild (no model)",
  "Rebuild first; the AI suits pictures saved from the web or messaging apps.": "Rebuild first; the AI suits pictures saved from the web or messaging apps.",
  "Rebuild works from the file’s own compressed data, changing nothing it states; the AI methods repaint the damage.": "Rebuild works from the file’s own compressed data, changing nothing it states; the AI methods repaint the damage.",
  "Rec.2020 in an 8-bit {{format}} is a very wide space for 256 steps: many viewers will show it dull.": "Rec.2020 in an 8-bit {{format}} is a very wide space for 256 steps: many viewers will show it dull.",
  Recent,
  Recommended,
  red,
  Red,
  "Red eye": "Red eye",
  Redo,
  "Reduce noise first, then sharpen what remains.": "Reduce noise first, then sharpen what remains.",
  "Reduces motion blur from camera shake or a moving subject.": "Reduces motion blur from camera shake or a moving subject.",
  Refine,
  "Refining the edges": "Refining the edges",
  "Region sliders are the gentle way in; the point curve is for precise shapes and colour.": "Region sliders are the gentle way in; the point curve is for precise shapes and colour.",
  Reject,
  "Reject all {{count}}": "Reject all {{count}}",
  "Reject every suggested reject shown": "Reject every suggested reject shown",
  "Reject it (X): nothing is deleted": "Reject it (X): nothing is deleted",
  "Reject Suggested Rejects": "Reject Suggested Rejects",
  Rejected,
  "Rejected only": "Rejected only",
  "Relative colorimetric": "Relative colorimetric",
  "Remaking a denoise on the new RAW develop": "Remaking a denoise on the new RAW develop",
  Remove,
  "Remove {{count}} spots_one": "Remove {{count}} spot",
  "Remove {{count}} spots_other": "Remove {{count}} spots",
  "Remove {{keyword}}": "Remove {{keyword}}",
  "Remove {{name}} from the list": "Remove {{name}} from the list",
  "Remove {{step}}": "Remove {{step}}",
  "Remove bakes into the photo’s pixels, which an HDR photo cannot take yet.": "Remove bakes into the photo’s pixels, which an HDR photo cannot take yet.",
  "Remove custom layer": "Remove custom layer",
  "Remove flag": "Remove flag",
  "Remove from “{{name}}”": "Remove from “{{name}}”",
  "Remove from {{name}}": "Remove from {{name}}",
  "Remove from the list": "Remove from the list",
  "Remove from the list (the folder and its photos stay on disk)": "Remove from the list (the folder and its photos stay on disk)",
  "Remove grain": "Remove grain",
  "Remove group": "Remove group",
  "Remove lasso point": "Remove lasso point",
  "Remove motion blur": "Remove motion blur",
  "Remove objects": "Remove objects",
  "Remove rule": "Remove rule",
  "Remove selection from it": "Remove selection from it",
  "Remove this group": "Remove this group",
  "Remove this layer": "Remove this layer",
  "Remove this rule": "Remove this rule",
  "Remove this step (undo brings it back)": "Remove this step (undo brings it back)",
  "Remove: {{error}}": "Remove: {{error}}",
  "Remove: nothing to change": "Remove: nothing to change",
  "Remove: paint over something, or click it with Find object, and an AI model fills it with what was likely behind it — people, signs, wires. It is baked into the photo like your other heal strokes.": "Remove: paint over something, or click it with Find object, and an AI model fills it with what was likely behind it — people, signs, wires. It is baked into the photo like your other heal strokes.",
  "Removed {{count}} photos from {{name}}_one": "Removed {{count}} photo from {{name}}",
  "Removed {{count}} photos from {{name}}_other": "Removed {{count}} photos from {{name}}",
  "Removed {{name}} from the list": "Removed {{name}} from the list",
  "Removes coloured speckles from noise.": "Removes coloured speckles from noise.",
  "Removes purple and green fringes around bright edges.": "Removes purple and green fringes around bright edges.",
  "Removes the red and blue fringes along high-contrast edges.": "Removes the red and blue fringes along high-contrast edges.",
  Rename,
  "Rename component": "Rename component",
  "Rename mask": "Rename mask",
  "Rename…": "Rename…",
  Rendering,
  "Reorder mask components": "Reorder mask components",
  "Reorder masks": "Reorder masks",
  "Repair JPEGs": "Repair JPEGs",
  "Repairs the blocks and colour smearing of heavily compressed JPEGs.": "Repairs the blocks and colour smearing of heavily compressed JPEGs.",
  "Report a Problem…": "Report a Problem…",
  Reset,
  "Reset {{command}}": "Reset {{command}}",
  "Reset {{name}}": "Reset {{name}}",
  "Reset adjustments": "Reset adjustments",
  "Reset all": "Reset all",
  "Reset component edge": "Reset component edge",
  "Reset crop": "Reset crop",
  "Reset crop and straighten": "Reset crop and straighten",
  Restart,
  "Restart to update": "Restart to update",
  "Resting while Playroom is in the background, to spare the battery and memory. It starts again with the next thing you do.": "Resting while Playroom is in the background, to spare the battery and memory. It starts again with the next thing you do.",
  "Retired AI models are removed from your disk, and so is the before-and-after with the previous engine from 0.3.": "Retired AI models are removed from your disk, and so is the before-and-after with the previous engine from 0.3.",
  "Review shows the first photo as it will be exported, and what would go wrong before it does: a setting that cannot work, a folder that cannot be written, a full disk, files that would be replaced.": "Review shows the first photo as it will be exported, and what would go wrong before it does: a setting that cannot work, a folder that cannot be written, a full disk, files that would be replaced.",
  Right,
  "Right adds sparkle; past the edge, pure white areas lose detail.": "Right adds sparkle; past the edge, pure white areas lose detail.",
  "Right gives grit and depth; left gives a soft glow.": "Right gives grit and depth; left gives a soft glow.",
  "Right opens up detail in shade; too far looks HDR and lifts noise.": "Right opens up detail in shade; too far looks HDR and lifts noise.",
  "Rotate left": "Rotate left",
  "Rotate right": "Rotate right",
  "Rotation & flip": "Rotation & flip",
  Rule,
  Rules,
  "Run it again on the new develop": "Run it again on the new develop",
  "Run it once the exposure is roughly right, before fine colour work.": "Run it once the exposure is roughly right, before fine colour work.",
  "Run it once, then fine-tune with Strength.": "Run it once, then fine-tune with Strength.",
  "Run the benchmark": "Run the benchmark",
  "Run the benchmark first: it has to pass on this computer": "Run the benchmark first: it has to pass on this computer",
  "Runs the steps above once and keeps the result in the photo’s project as a step.": "Runs the steps above once and keeps the result in the photo’s project as a step.",
  "Safe to raise to 25 or so; very high values bleed colour at edges.": "Safe to raise to 25 or so; very high values bleed colour at edges.",
  "SAM 2.1 selects it": "SAM 2.1 selects it",
  "SAM 3, Find by name at its best": "SAM 3, Find by name at its best",
  "same file contents": "same file contents",
  "sat {{pct}}%": "sat {{pct}}%",
  Saturation,
  Save,
  "Save preset": "Save preset",
  "Save this curve as a preset…": "Save this curve as a preset…",
  "Save your own looks with their masks and AI steps: they are made again on every photo you use them on.": "Save your own looks with their masks and AI steps: they are made again on every photo you use them on.",
  "Saved {{name}}": "Saved {{name}}",
  "Saved {{name}} · {{count}} photos_one": "Saved {{name}} · {{count}} photo",
  "Saved {{name}} · {{count}} photos_other": "Saved {{name}} · {{count}} photos",
  "Saved {{name}} · drag photos onto it to add them": "Saved {{name}} · drag photos onto it to add them",
  "Saved as instructions, made again on each photo:": "Saved as instructions, made again on each photo:",
  'Saved curve preset "{{name}}"': 'Saved curve preset "{{name}}"',
  'Saved mask preset "{{name}}"': 'Saved mask preset "{{name}}"',
  "Saved preset {{name}}": "Saved preset {{name}}",
  "saved, it looks through the whole library": "saved, it looks through the whole library",
  Scale,
  "Scene finder": "Scene finder",
  Scopes,
  Screen,
  "Screen · lightens": "Screen · lightens",
  "Search also finds titles, captions and keywords.": "Search also finds titles, captions and keywords.",
  "Search by name, camera, film stock, movie or mood": "Search by name, camera, film stock, movie or mood",
  "Search commands or keys": "Search commands or keys",
  "Search names, titles, keywords, camera": "Search names, titles, keywords, camera",
  seconds,
  "Seconds between shots": "Seconds between shots",
  "Sees which parts of a photo are near and which are far, for the Depth range mask.": "Sees which parts of a photo are near and which are far, for the Depth range mask.",
  Segmenting,
  "Select {{what}}": "Select {{what}}",
  "Select a Depth range first": "Select a Depth range first",
  "Select a mask first": "Select a mask first",
  "Select a photo to see and edit its details.": "Select a photo to see and edit its details.",
  "Select all": "Select all",
  "Select All": "Select All",
  "Select anything": "Select anything",
  "Select gradient": "Select gradient",
  "Select object": "Select object",
  "Select objects and the sky": "Select objects and the sky",
  "Select or create a mask to paint into.": "Select or create a mask to paint into.",
  "Select Subject is moving to one smaller model (U²-Netp). If you already have U²-Net or the exact JPEG repair, they are listed under AI models as being retired: U²-Net keeps making Subject and Background masks until the next update, and either can be removed to free the space.": "Select Subject is moving to one smaller model (U²-Netp). If you already have U²-Net or the exact JPEG repair, they are listed under AI models as being retired: U²-Net keeps making Subject and Background masks until the next update, and either can be removed to free the space.",
  "Select subjects and objects": "Select subjects and objects",
  "Select this bidirectional gradient": "Select this bidirectional gradient",
  "Select this linear gradient": "Select this linear gradient",
  "Select this radial gradient": "Select this radial gradient",
  "Select two or more photos to stack": "Select two or more photos to stack",
  Selecting,
  "Sense depth": "Sense depth",
  "Set it for the subject’s midtones, then pull Highlights back if the sky burns.": "Set it for the subject’s midtones, then pull Highlights back if the sky burns.",
  "Sets how bright each original colour becomes in black and white.": "Sets how bright each original colour becomes in black and white.",
  "Sets what counts as neutral white, so colours read as they did in the light you shot in.": "Sets what counts as neutral white, so colours read as they did in the light you shot in.",
  "Sets where the brightest tones end.": "Sets where the brightest tones end.",
  "Sets where the darkest tones end.": "Sets where the darkest tones end.",
  Settings,
  "Settings ({{key}})": "Settings ({{key}})",
  "Settings → AI models → Use AI models turns every AI model off at once (RAW files still develop with theirs).": "Settings → AI models → Use AI models turns every AI model off at once (RAW files still develop with theirs).",
  "Settings → Display says what Playroom reads from your screen, or lets you state its white and peak yourself.": "Settings → Display says what Playroom reads from your screen, or lets you state its white and peak yourself.",
  "Settings copied ({{paste}} to paste, {{choose}} to choose)": "Settings copied ({{paste}} to paste, {{choose}} to choose)",
  "Settings opens wide, in sections across the top like Export: General, Projects & interface, Display, AI models, Key bindings, and Privacy & about.": "Settings opens wide, in sections across the top like Export: General, Projects & interface, Display, AI models, Key bindings, and Privacy & about.",
  "Settings…": "Settings…",
  Shade,
  "Shadows clipped: {{pct}}% — click to show": "Shadows clipped: {{pct}}% — click to show",
  "Shape (Shift: circle)": "Shape (Shift: circle)",
  "Sharp 1:1 zoom on straightened, cropped and lens-corrected photos.": "Sharp 1:1 zoom on straightened, cropped and lens-corrected photos.",
  Sharpening,
  "Sharpening and noise reduction.": "Sharpening and noise reduction.",
  "Sharpening shows at 100% only: at this zoom its radius is under half a pixel.": "Sharpening shows at 100% only: at this zoom its radius is under half a pixel.",
  "Sharpens a photo smeared by camera shake or a moving subject. It cannot rescue a photo that was simply out of focus.": "Sharpens a photo smeared by camera shake or a moving subject. It cannot rescue a photo that was simply out of focus.",
  "Sharpens photos smeared by a shaky hand or a moving subject.": "Sharpens photos smeared by a shaky hand or a moving subject.",
  "Sharper selections, the sky on its own, and people’s hair, skin and eyes found for you.": "Sharper selections, the sky on its own, and people’s hair, skin and eyes found for you.",
  "Shift edge": "Shift edge",
  "Shift-click a bar to make a mask of that colour.": "Shift-click a bar to make a mask of that colour.",
  "Shift-click adds · Alt-click removes": "Shift-click adds · Alt-click removes",
  "Shift-click adds a part · Alt-click removes one · Enter keeps it": "Shift-click adds a part · Alt-click removes one · Enter keeps it",
  "Shifts how the camera’s red, green and blue primaries are read.": "Shifts how the camera’s red, green and blue primaries are read.",
  Show,
  "Show {{card}}": "Show {{card}}",
  "Show all": "Show all",
  "Show all masks": "Show all masks",
  "Show clipping": "Show clipping",
  "Show Clipping": "Show Clipping",
  "Show dust and spots": "Show dust and spots",
  "Show Filmstrip": "Show Filmstrip",
  "Show in Explorer": "Show in Explorer",
  "Show in Finder": "Show in Finder",
  "Show in folder": "Show in folder",
  "Show in Folder": "Show in Folder",
  "Show info": "Show info",
  "Show Info": "Show Info",
  "Show mask": "Show mask",
  "Show Masks": "Show Masks",
  "Show models for": "Show models for",
  "Show or hide the info drawer": "Show or hide the info drawer",
  "Show or hide the mask overlay": "Show or hide the mask overlay",
  "Show or hide the masks window": "Show or hide the masks window",
  "Show or hide the sources": "Show or hide the sources",
  "Show Overlay": "Show Overlay",
  "Show Sources": "Show Sources",
  "Show the filmstrip": "Show the filmstrip",
  "Show the HDR histogram": "Show the HDR histogram",
  "Show the overlay": "Show the overlay",
  "Show the photo in HDR, with the light above white this display can show": "Show the photo in HDR, with the light above white this display can show",
  "Show the photos in its subfolders too": "Show the photos in its subfolders too",
  "Show the picture as specks on black, where dust stands out": "Show the picture as specks on black, where dust stands out",
  "Show the sources": "Show the sources",
  "Show this mask": "Show this mask",
  "Showing the photo in HDR, for this display: click to show it in SDR": "Showing the photo in HDR, for this display: click to show it in SDR",
  "Showing the photos in its subfolders too: show this folder’s own": "Showing the photos in its subfolders too: show this folder’s own",
  "Shown as {{shown}}: the window cannot show {{format}}.": "Shown as {{shown}}: the window cannot show {{format}}.",
  "Shown as its SDR picture.": "Shown as its SDR picture.",
  "Shutter speed": "Shutter speed",
  "Sign in to the beta": "Sign in to the beta",
  "Sign in with your PIXL account to start your free trial, or to use your licence. Editing still works.": "Sign in with your PIXL account to start your free trial, or to use your licence. Editing still works.",
  "Sign in…": "Sign in…",
  "Signed in as {{email}}. Confirming your beta access with your PIXL account…": "Signed in as {{email}}. Confirming your beta access with your PIXL account…",
  "Signed in. Confirming your beta access with your PIXL account…": "Signed in. Confirming your beta access with your PIXL account…",
  Similar,
  "Similarity threshold": "Similarity threshold",
  Size,
  "Size sets how big the pupil is.": "Size sets how big the pupil is.",
  Skin,
  Skip,
  skipped,
  "Skipped: this photo is a HEIC.": "Skipped: this photo is a HEIC.",
  "Skipped: this photo is a JPEG XL.": "Skipped: this photo is a JPEG XL.",
  "Skipped: this photo is a PNG.": "Skipped: this photo is a PNG.",
  "Skipped: this photo is a RAW.": "Skipped: this photo is a RAW.",
  "Skipped: this photo is a TIFF.": "Skipped: this photo is a TIFF.",
  "Skipped: this photo is a WebP.": "Skipped: this photo is a WebP.",
  "Skipped: this photo is an AVIF.": "Skipped: this photo is an AVIF.",
  Sky,
  "Sky in one click, found by a model instead of a click on the sky, and two new ones beside it: Vegetation (trees, grass, plants) and Water (sea, lakes, rivers).": "Sky in one click, found by a model instead of a click on the sky, and two new ones beside it: Vegetation (trees, grass, plants) and Water (sea, lakes, rivers).",
  "Slide the full line between the two": "Slide the full line between the two",
  Slow,
  "Small models of our own, made to understand photos and editing, light enough for a laptop.": "Small models of our own, made to understand photos and editing, light enough for a laptop.",
  "Small moves matter: fluorescent and LED light usually need some magenta.": "Small moves matter: fluorescent and LED light usually need some magenta.",
  "Small moves recolour; big moves look surreal.": "Small moves recolour; big moves look surreal.",
  "Small objects picked with Objects keep their mask instead of fading out.": "Small objects picked with Objects keep their mask instead of fading out.",
  "Smaller heal brush": "Smaller heal brush",
  "Smaller mask brush": "Smaller mask brush",
  Smart,
  "Smart look: makes masks or runs AI as it is applied": "Smart look: makes masks or runs AI as it is applied",
  "Smart look. {{reasons}}": "Smart look. {{reasons}}",
  "Smart looks find the subject, the sky or an object and adjust just that part.": "Smart looks find the subject, the sky or an object and adjust just that part.",
  "Smart looks, reimagined": "Smart looks, reimagined",
  "Smooth, safe changes that never cross over.": "Smooth, safe changes that never cross over.",
  Smoothing,
  Smoothness,
  "Smooths grainy brightness noise.": "Smooths grainy brightness noise.",
  "Snap to edges": "Snap to edges",
  "Snap to edges for brushes, lassos and AI masks, and crisper Subject and Background edges.": "Snap to edges for brushes, lassos and AI masks, and crisper Subject and Background edges.",
  "Snap to edges off": "Snap to edges off",
  Snapshots,
  "Soft · focus {{share}} of the burst’s best": "Soft · focus {{share}} of the burst’s best",
  "Soft film S": "Soft film S",
  SoftLight,
  Softness,
  "Solo mode": "Solo mode",
  "Solo: one panel open at a time": "Solo: one panel open at a time",
  "Solo: open one panel at a time": "Solo: open one panel at a time",
  soon,
  Sort,
  "Sort by": "Sort by",
  Source,
  Sources,
  Split,
  "Spot removal & eyes": "Spot removal & eyes",
  "Spreads the tones apart (right) or draws them together (left).": "Spreads the tones apart (right) or draws them together (left).",
  "Squeezes all the colours together so their relationships look natural, which shifts colours that would have fitted. Best when much of the picture is outside the new space.": "Squeezes all the colours together so their relationships look natural, which shifts colours that would have fitted. Best when much of the picture is outside the new space.",
  stack,
  Stack,
  "Stack selection": "Stack selection",
  "Stack the selection": "Stack the selection",
  "Stacked {{count}} photos_one": "Stacked {{count}} photo",
  "Stacked {{count}} photos_other": "Stacked {{count}} photos",
  Stacking,
  "Stacks and collections": "Stacks and collections",
  "Start your free {{days}}-day trial in Settings, or buy a licence, to export. Editing still works.": "Start your free {{days}}-day trial in Settings, or buy a licence, to export. Editing still works.",
  Starting,
  "Starting PIXL Engine": "Starting PIXL Engine",
  "starts with": "starts with",
  steady,
  Stop,
  "Stop this batch": "Stop this batch",
  "stopped before {{count}} more_one": "stopped before {{count}} more",
  "stopped before {{count}} more_other": "stopped before {{count}} more",
  "Stopping auto white balance": "Stopping auto white balance",
  "Store AI results losslessly?": "Store AI results losslessly?",
  "Store losslessly": "Store losslessly",
  "Store results losslessly": "Store results losslessly",
  Straighten,
  "Straightened: the zoom shows the preview, enlarged": "Straightened: the zoom shows the preview, enlarged",
  "Straightens verticals and horizons, and corrects perspective.": "Straightens verticals and horizons, and corrects perspective.",
  "Straighter lines near the edges and even brightness corner to corner.": "Straighter lines near the edges and even brightness corner to corner.",
  Strength,
  "Strokes keep inside {{layer}}.": "Strokes keep inside {{layer}}.",
  Strong,
  "Strong clean-up": "Strong clean-up",
  "Strong contrast": "Strong contrast",
  Subfolders,
  Subject,
  "Subject finder": "Subject finder",
  "Subject soft · focus {{share}} of the burst’s best": "Subject soft · focus {{share}} of the burst’s best",
  "Subject soft · the background is sharper": "Subject soft · the background is sharper",
  Subtract,
  "Subtract from the mask": "Subtract from the mask",
  "Subtract from this mask": "Subtract from this mask",
  "Subtract from this mask with": "Subtract from this mask with",
  "Subtract from this mask: {{tool}}": "Subtract from this mask: {{tool}}",
  "Subtract from this mask: every tool": "Subtract from this mask: every tool",
  "Suggested reject": "Suggested reject",
  "Suggested rejects only": "Suggested rejects only",
  "Suggested rejects: photos that look like rejects (a soft frame in a burst, a subject softer than its background, too dark or too bright, closed eyes, a duplicate) show dimmed and grey. Hover one for why, then Keep or Reject it; Filters → Suggested rejects only lists them, and Reject all flags them in one go. Nothing is ever deleted, a star or a pick means a photo is never suggested, and what you keep and reject tunes the suggestions. Measured on your computer while it is idle and plugged in; Settings → Projects & interface turns it off.": "Suggested rejects: photos that look like rejects (a soft frame in a burst, a subject softer than its background, too dark or too bright, closed eyes, a duplicate) show dimmed and grey. Hover one for why, then Keep or Reject it; Filters → Suggested rejects only lists them, and Reject all flags them in one go. Nothing is ever deleted, a star or a pick means a photo is never suggested, and what you keep and reject tunes the suggestions. Measured on your computer while it is idle and plugged in; Settings → Projects & interface turns it off.",
  "Super resolution": "Super resolution",
  "Super Resolution ×{{scale}} ({{source}})": "Super Resolution ×{{scale}} ({{source}})",
  "Super Resolution has a Source choice: Clean stays closest to a sharp original, with a new, much faster model; Damaged repairs compression and noise as it enlarges; Keep texture leaves the grain.": "Super Resolution has a Source choice: Clean stays closest to a sharp original, with a new, much faster model; Damaged repairs compression and noise as it enlarges; Keep texture leaves the grain.",
  sync,
  "Sync settings": "Sync settings",
  "Sync settings…": "Sync settings…",
  "Sync Settings…": "Sync Settings…",
  "Take {{name}} off": "Take {{name}} off",
  "Take it off the list": "Take it off the list",
  "Take off": "Take off",
  Taken,
  "Taken from": "Taken from",
  "Taken to": "Taken to",
  "Takes a moment": "Takes a moment",
  "Takes grain out of a RAW’s sensor data before it becomes a picture, measuring how noisy each photo is by itself. Best on high-ISO shots; can look a little crisp on fine texture. Under a second on a Mac.": "Takes grain out of a RAW’s sensor data before it becomes a picture, measuring how noisy each photo is by itself. Best on high-ISO shots; can look a little crisp on fine texture. Under a second on a Mac.",
  "Takes the grain out of the camera’s raw sensor data before it becomes a picture, with an AI model (PMRID) that reads how noisy this photo is by itself.": "Takes the grain out of the camera’s raw sensor data before it becomes a picture, with an AI model (PMRID) that reads how noisy this photo is by itself.",
  "Takes the place of {{name}} (Alt: on top of it)": "Takes the place of {{name}} (Alt: on top of it)",
  Target,
  "Target colour as a hex": "Target colour as a hex",
  Targeted,
  "Targeted Adjustment": "Targeted Adjustment",
  "Targeted adjustment (HSL or Tone Curve)": "Targeted adjustment (HSL or Tone Curve)",
  "Targeted: Aqua hue": "Targeted: Aqua hue",
  "Targeted: Aqua luminance": "Targeted: Aqua luminance",
  "Targeted: Aqua saturation": "Targeted: Aqua saturation",
  "Targeted: Blue hue": "Targeted: Blue hue",
  "Targeted: Blue luminance": "Targeted: Blue luminance",
  "Targeted: Blue saturation": "Targeted: Blue saturation",
  "Targeted: curve (blue)": "Targeted: curve (blue)",
  "Targeted: curve (green)": "Targeted: curve (green)",
  "Targeted: curve (master)": "Targeted: curve (master)",
  "Targeted: curve (red)": "Targeted: curve (red)",
  "Targeted: Green hue": "Targeted: Green hue",
  "Targeted: Green luminance": "Targeted: Green luminance",
  "Targeted: Green saturation": "Targeted: Green saturation",
  "Targeted: Magenta hue": "Targeted: Magenta hue",
  "Targeted: Magenta luminance": "Targeted: Magenta luminance",
  "Targeted: Magenta saturation": "Targeted: Magenta saturation",
  "Targeted: Orange hue": "Targeted: Orange hue",
  "Targeted: Orange luminance": "Targeted: Orange luminance",
  "Targeted: Orange saturation": "Targeted: Orange saturation",
  "Targeted: Purple hue": "Targeted: Purple hue",
  "Targeted: Purple luminance": "Targeted: Purple luminance",
  "Targeted: Purple saturation": "Targeted: Purple saturation",
  "Targeted: Red hue": "Targeted: Red hue",
  "Targeted: Red luminance": "Targeted: Red luminance",
  "Targeted: Red saturation": "Targeted: Red saturation",
  "Targeted: Yellow hue": "Targeted: Yellow hue",
  "Targeted: Yellow luminance": "Targeted: Yellow luminance",
  "Targeted: Yellow saturation": "Targeted: Yellow saturation",
  Teeth,
  "Test this computer’s speed": "Test this computer’s speed",
  "Testing…": "Testing…",
  "Texture or Clarity": "Texture or Clarity",
  "Thank you for testing. Pixl Playroom is out: update to the released version to keep going. Your photos and edits are kept as they are, and your tester discount is on your PIXL account.": "Thank you for testing. Pixl Playroom is out: update to the released version to keep going. Your photos and edits are kept as they are, and your tester discount is on your PIXL account.",
  "That is not a purple or green fringe": "That is not a purple or green fringe",
  "That pixel cannot be made neutral (a channel is black)": "That pixel cannot be made neutral (a channel is black)",
  "That pixel is grey: there is no colour to adjust": "That pixel is grey: there is no colour to adjust",
  "The benchmark did not finish": "The benchmark did not finish",
  "The beta has ended": "The beta has ended",
  "The beta has ended. Update to the released Pixl Playroom to keep going.": "The beta has ended. Update to the released Pixl Playroom to keep going.",
  "The beta is free and comes as is: joining means accepting the {{terms}}, including that there is no warranty and that PIXL Foundation accepts no liability for it.": "The beta is free and comes as is: joining means accepting the {{terms}}, including that there is no warranty and that PIXL Foundation accepts no liability for it.",
  "The Color Mixer’s Luminance sliders feel even across their range: all the way down darkens a colour strongly but no longer turns it black, so skies keep their tone.": "The Color Mixer’s Luminance sliders feel even across their range: all the way down darkens a colour strongly but no longer turns it black, so skies keep their tone.",
  "The colour added": "The colour added",
  "The colour needed more than the slider reaches": "The colour needed more than the slider reaches",
  "The corner triangles light up when shadows or highlights clip; click one to see where on the photo.": "The corner triangles light up when shadows or highlights clip; click one to see where on the photo.",
  "The depth map could not be read.": "The depth map could not be read.",
  "The download stopped: {{reason}}.": "The download stopped: {{reason}}.",
  "The engine now works in PixlRGB, PIXL’s own wide working space.": "The engine now works in PixlRGB, PIXL’s own wide working space.",
  "the export would overwrite the original": "the export would overwrite the original",
  "the eyebrows of every face (beta: their outlines are rough)": "the eyebrows of every face (beta: their outlines are rough)",
  "The farthest distance the range takes: 100 is the farthest thing in the photo": "The farthest distance the range takes: 100 is the farthest thing in the photo",
  "The file name is empty.": "The file name is empty.",
  "The first component always adds": "The first component always adds",
  "the graphics card": "the graphics card",
  "the graphics chip": "the graphics chip",
  "The HDR rendition could not be opened": "The HDR rendition could not be opened",
  "The histogram and the colour chart open at full size: overlay, parade, one channel or luma, with the before picture behind and HDR in stops.": "The histogram and the colour chart open at full size: overlay, parade, one channel or luma, with the before picture behind and HDR in stops.",
  "the inside of every mouth: the closest outline to the teeth there is": "the inside of every mouth: the closest outline to the teeth there is",
  "The larger, surer model behind Find by name: it finds more, and says “nothing” rather than guess. It needs a lot of memory while it reads a photo.": "The larger, surer model behind Find by name: it finds more, and says “nothing” rather than guess. It needs a lot of memory while it reads a photo.",
  "The larger, surer model behind Find by name: it says “nothing” rather than guess.": "The larger, surer model behind Find by name: it says “nothing” rather than guess.",
  "The layer’s blend": "The layer’s blend",
  "the lines ask for too strong a correction": "the lines ask for too strong a correction",
  "the lips of every face, the mouth inside left out": "the lips of every face, the mouth inside left out",
  "The look": "The look",
  "The mark's width, as a share of the picture's shorter edge": "The mark's width, as a share of the picture's shorter edge",
  "the mask is gone": "the mask is gone",
  "The masks panel sits in the left pane, beside your presets and history, instead of floating over the photo.": "The masks panel sits in the left pane, beside your presets and history, instead of floating over the photo.",
  "The model is not downloaded yet": "The model is not downloaded yet",
  "The nearest distance the range takes: 0 is the nearest thing in the photo": "The nearest distance the range takes: 0 is the nearest thing in the photo",
  "the Neural Engine and graphics chip": "the Neural Engine and graphics chip",
  "The next engine brings its own speed-ups, and we keep making Playroom lighter on your computer.": "The next engine brings its own speed-ups, and we keep making Playroom lighter on your computer.",
  "the object’s mask went missing": "the object’s mask went missing",
  "The order top to bottom is the order most edits go in.": "The order top to bottom is the order most edits go in.",
  "The overlay steps aside while a slider that changes the photo moves (Lightroom's auto toggle)": "The overlay steps aside while a slider that changes the photo moves (Lightroom's auto toggle)",
  "The photo could not be opened": "The photo could not be opened",
  "the photo is not in the library": "the photo is not in the library",
  "The photo's depth, the range tinted": "The photo's depth, the range tinted",
  "the photo’s settings": "the photo’s settings",
  "The picked white reached the end of the range": "The picked white reached the end of the range",
  "The picture could not be rendered after {{stage}}. Undo the last change.": "The picture could not be rendered after {{stage}}. Undo the last change.",
  "The pins over the photo are gone; gradient and lasso handles show when the pointer is over the photo.": "The pins over the photo are gone; gradient and lasso handles show when the pointer is over the photo.",
  "The pixels come exactly as they are, tone and all.": "The pixels come exactly as they are, tone and all.",
  "The preset carries only the checked groups:": "The preset carries only the checked groups:",
  "the profile corrects nothing": "the profile corrects nothing",
  "The report server answered {{status}}. Try again later.": "The report server answered {{status}}. Try again later.",
  "The result is kept losslessly, so pushing it later shows no compression; undo, redo and Strength never run the model again.": "The result is kept losslessly, so pushing it later shows no compression; undo, redo and Strength never run the model again.",
  "The same for Fujifilm’s X-Trans sensors. Downloaded by itself the first time you open one.": "The same for Fujifilm’s X-Trans sensors. Downloaded by itself the first time you open one.",
  "The same white on every photo, converted between RAW and other files": "The same white on every photo, converted between RAW and other files",
  "the sea, lakes, rivers and waterfalls": "the sea, lakes, rivers and waterfalls",
  "The sky in a click, and a lasso that finds the object inside it.": "The sky in a click, and a lasso that finds the object inside it.",
  "The sliders scale the correction: 100 is as measured.": "The sliders scale the correction: 100 is as measured.",
  "the step is gone": "the step is gone",
  "The targeted tool moves the H, S and L tabs, not Point": "The targeted tool moves the H, S and L tabs, not Point",
  "The texture comes from the source, the tone from around the spot.": "The texture comes from the source, the tone from around the spot.",
  "the watermark is not at {{path}}": "the watermark is not at {{path}}",
  "the watermark is over 25 MB: use a smaller PNG": "the watermark is over 25 MB: use a smaller PNG",
  "the watermark must be a PNG": "the watermark must be a PNG",
  "The whole picture shifts warmer or cooler, greener or pinker.": "The whole picture shifts warmer or cooler, greener or pinker.",
  "There is no import step: your photos stay where they are.": "There is no import step: your photos stay where they are.",
  "These change how sharp and deep a picture feels without moving its overall brightness.": "These change how sharp and deep a picture feels without moving its overall brightness.",
  "These run after the crop, on the finished picture.": "These run after the crop, on the finished picture.",
  "They run once and are kept with the photo; undo takes them away.": "They run once and are kept with the photo; undo takes them away.",
  "Things in this photo": "Things in this photo",
  "Third-Party Notices": "Third-Party Notices",
  Thirds,
  "This account isn’t in the beta. Join it on the beta page, or use the released Pixl Playroom.": "This account isn’t in the beta. Join it on the beta page, or use the released Pixl Playroom.",
  "this build of the engine runs no models": "this build of the engine runs no models",
  "this build of the engine ships no ONNX Runtime": "this build of the engine ships no ONNX Runtime",
  "This camera is not in PIXL’s database yet: the file’s own colour is used.": "This camera is not in PIXL’s database yet: the file’s own colour is used.",
  "This collection is empty. Drag photos onto it in the sidebar to add them.": "This collection is empty. Drag photos onto it in the sidebar to add them.",
  "This computer": "This computer",
  "This computer has {{memory}} of memory; it needs {{needed}} or more": "This computer has {{memory}} of memory; it needs {{needed}} or more",
  "This display shows SDR: Full HDR needs one with headroom (Settings → Display)": "This display shows SDR: Full HDR needs one with headroom (Settings → Display)",
  "this engine build has no prompted segmentation": "this engine build has no prompted segmentation",
  "this engine build runs no models": "this engine build runs no models",
  "This file cannot be read": "This file cannot be read",
  "This folder": "This folder",
  "This HDR output describes its colour with the ICC profile: turn ICC on.": "This HDR output describes its colour with the ICC profile: turn ICC on.",
  "This is a beta of Pixl Playroom. Sign in with the PIXL account you joined the beta with, and the app opens.": "This is a beta of Pixl Playroom. Sign in with the PIXL account you joined the beta with, and the app opens.",
  "This is a beta: there is a lot more on the way.": "This is a beta: there is a lot more on the way.",
  "This mask's overlay colour": "This mask's overlay colour",
  "This name, beside the original and in its format, would write over the original: change the name or the folder.": "This name, beside the original and in its format, would write over the original: change the name or the folder.",
  "This picture is {{size}} ({{side}} px on its longest side), more than Playroom opens.": "This picture is {{size}} ({{side}} px on its longest side), more than Playroom opens.",
  "This picture is {{size}}, more than Playroom opens.": "This picture is {{size}}, more than Playroom opens.",
  "This RAW format isn't supported ({{detail}}).": "This RAW format isn't supported ({{detail}}).",
  "This RAW format isn't supported.": "This RAW format isn't supported.",
  "This RAW holds several frames (dual pixel, pixel shift or a burst), which Playroom cannot develop yet.": "This RAW holds several frames (dual pixel, pixel shift or a burst), which Playroom cannot develop yet.",
  "This version of Pixl Playroom ({{current}}) needs updating before you go on: version {{min}} or later. Your photos and edits are kept as they are.": "This version of Pixl Playroom ({{current}}) needs updating before you go on: version {{min}} or later. Your photos and edits are kept as they are.",
  "Thumbnail size": "Thumbnail size",
  "Tighter than the bands: a single jacket or a sign.": "Tighter than the bands: a single jacket or a sign.",
  "Tilts the picture forward or back to fix converging verticals.": "Tilts the picture forward or back to fix converging verticals.",
  "Tints shadows, midtones and highlights separately, as in film and cinema grading.": "Tints shadows, midtones and highlights separately, as in film and cinema grading.",
  Title,
  To,
  "Toggle custom layer": "Toggle custom layer",
  "Told the noise it measures on the photo; gentler, keeps fine texture.": "Told the noise it measures on the photo; gentler, keeps fine texture.",
  "Tone curve": "Tone curve",
  "Too bright · {{share}} blown": "Too bright · {{share}} blown",
  "Too dark · {{share}} crushed": "Too dark · {{share}} crushed",
  "too large": "too large",
  "Too many reports just now. Try again in a minute.": "Too many reports just now. Try again in a minute.",
  Tools,
  Top,
  "Top left": "Top left",
  "Top right": "Top right",
  "Trained on real camera noise; judges it by itself. Best on high-ISO shots, and quick on a Mac’s graphics chip.": "Trained on real camera noise; judges it by itself. Best on high-ISO shots, and quick on a Mac’s graphics chip.",
  "Treatment (colour / B&W)": "Treatment (colour / B&W)",
  "trees, grass, plants and flowers": "trees, grass, plants and flowers",
  Tritan,
  "Tritanopia (no blue)": "Tritanopia (no blue)",
  Try,
  "Try again": "Try again",
  "try again later": "try again later",
  "Try Auto first; Guided lets you draw the lines that should be straight.": "Try Auto first; Guided lets you draw the lines that should be straight.",
  "Try Auto, then adjust Exposure and recover Highlights and Shadows by hand.": "Try Auto, then adjust Exposure and recover Highlights and Shadows by hand.",
  Tungsten,
  Turn,
  "Turn (Shift: 15° steps)": "Turn (Shift: 15° steps)",
  "Turn {{name}} off": "Turn {{name}} off",
  "Turn {{name}} on": "Turn {{name}} on",
  "Turn it down only if you want each pixel to follow an adjustment exactly.": "Turn it down only if you want each pixel to follow an adjustment exactly.",
  "Turn off": "Turn off",
  "Turn on": "Turn on",
  "Turn on profile corrections for nearly every photo.": "Turn on profile corrections for nearly every photo.",
  "Turn on the target tool and drag up or down on the photo to bend the curve there.": "Turn on the target tool and drag up or down on the photo to bend the curve there.",
  "Turn one colour into another: choose the target on a wheel or as a hex, or pick it in the photo": "Turn one colour into another: choose the target on a wheel or as a hex, or pick it in the photo",
  "Turns a camera’s raw sensor data into the full-size picture, with crisper edges and fewer colour fringes on fine detail. Without it, Playroom uses a faster classic method.": "Turns a camera’s raw sensor data into the full-size picture, with crisper edges and fewer colour fringes on fine detail. Without it, Playroom uses a faster classic method.",
  "Turns every colour inside the mask around the colour wheel.": "Turns every colour inside the mask around the colour wheel.",
  "Turns the picture left or right in perspective.": "Turns the picture left or right in perspective.",
  "Type what to find: “red car”, “the dog”": "Type what to find: “red car”, “the dog”",
  "Type what you want masked (“red car”, “the trees”) and it finds every one in the photo. Clear names work best; a vague one can find the wrong thing. About 4 seconds the first time on a photo, 2 seconds each word after.": "Type what you want masked (“red car”, “the trees”) and it finds every one in the photo. Clear names work best; a vague one can find the wrong thing. About 4 seconds the first time on a photo, 2 seconds each word after.",
  "Ultra ({{scale}})": "Ultra ({{scale}})",
  unavailable,
  "under a second": "under a second",
  Undo,
  "Undo takes it away; the next spot works on what the last one healed.": "Undo takes it away; the next spot works on what the last one healed.",
  "Undo, redo and History never run the models again, and no file is written beside the photo. An upscale makes the photo larger from this step on; crop, masks and spots keep their places.": "Undo, redo and History never run the models again, and no file is written beside the photo. An upscale makes the photo larger from this step on; crop, masks and spots keep their places.",
  Unedited,
  Unflagged,
  "Unfold the panel": "Unfold the panel",
  Unit,
  "unknown error": "unknown error",
  "Unlike the wheels it tints by adding light, so shadows warm without going muddy.": "Unlike the wheels it tints by adding light, so shadows warm without going muddy.",
  Unpin,
  "Unpin {{name}}": "Unpin {{name}}",
  Unstack,
  "Update available: Playroom {{version}}": "Update available: Playroom {{version}}",
  "Update available! Playroom {{version}} is downloading": "Update available! Playroom {{version}} is downloading",
  "Update required": "Update required",
  "Upright (perspective)": "Upright (perspective)",
  "Upright: {{mode}}": "Upright: {{mode}}",
  "Use AI models": "Use AI models",
  "Use another account": "Use another account",
  "Use it for “{{command}}”": "Use it for “{{command}}”",
  "Use the overlay's colour": "Use the overlay's colour",
  "Use the picker on a fringe to set the hue for you.": "Use the picker on a fringe to set the hue for you.",
  "Use the target tool in the photo: drag on a colour to change the band under it.": "Use the target tool in the photo: drag on a colour to change the band under it.",
  "User presets": "User presets",
  Value,
  Vegetation,
  "Version {{version}} found; downloading…": "Version {{version}} found; downloading…",
  "Version {{version}} is ready.": "Version {{version}} is ready.",
  Vertical,
  Vibrance,
  "Vibrance protects skin and already-strong colours; Saturation treats every colour alike.": "Vibrance protects skin and already-strong colours; Saturation treats every colour alike.",
  View,
  Vignette,
  "vignetting takes at most three coefficients": "vignetting takes at most three coefficients",
  "Virtual copy": "Virtual copy",
  "Virtual copy created": "Virtual copy created",
  "Visualise spots": "Visualise spots",
  Waiting,
  "Waiting for another AI job…": "Waiting for another AI job…",
  "Waiting its turn": "Waiting its turn",
  "Warm a touch past neutral for golden hour, cool for night and snow.": "Warm a touch past neutral for golden hour, cool for night and snow.",
  Water,
  Watermark,
  "We are still working out how a local model best fits your workflow without slowing your computer down: when it should run, how much it may use, and what is worth its time. Until we have that right, every AI tool in Playroom is a small, focused model that does one job quickly, and Settings → AI models turns them all off at once.": "We are still working out how a local model best fits your workflow without slowing your computer down: when it should run, how much it may use, and what is worth its time. Until we have that right, every AI tool in Playroom is a small, focused model that does one job quickly, and Settings → AI models turns them all off at once.",
  "We tried a local language model inside Playroom, one that would look at your photos and name what is in them so a mask is a tap away, all on your own computer. It works, but today it needs 3 to 4 GB of memory and 10 to 20 seconds a photo on a fast Mac, and more on an older one. That is too heavy to switch on for everyone, so it is not in this release.": "We tried a local language model inside Playroom, one that would look at your photos and name what is in them so a mask is a tap away, all on your own computer. It works, but today it needs 3 to 4 GB of memory and 10 to 20 seconds a photo on a fast Mac, and more on an older one. That is too heavy to switch on for everyone, so it is not in this release.",
  weeks,
  "What an export at full resolution sends to the engine.": "What an export at full resolution sends to the engine.",
  "What’s new": "What’s new",
  "What’s new in Playroom {{version}}": "What’s new in Playroom {{version}}",
  "Where the picture rises above white: amber just above, magenta at the peak": "Where the picture rises above white: amber just above, magenta at the peak",
  "Where to look": "Where to look",
  "Which face this mask takes: every face found, or one, numbered left to right": "Which face this mask takes: every face found, or one, numbered left to right",
  "While Playroom is minimised or another app is in front, it lets its engine rest and draws flat, still panels, which is lighter on the battery and frees memory; the top bar says Engine offline, in yellow, until you come back. Settings → Interface → Always flat keeps the flat look all the time.": "While Playroom is minimised or another app is in front, it lets its engine rest and draws flat, still panels, which is lighter on the battery and frees memory; the top bar says Engine offline, in yellow, until you come back. Settings → Interface → Always flat keeps the flat look all the time.",
  "White balance": "White balance",
  "White balance only": "White balance only",
  "White balance picker": "White balance picker",
  "White Balance Picker": "White Balance Picker",
  "White balance restored on {{count}} photos_one": "White balance restored on {{count}} photo",
  "White balance restored on {{count}} photos_other": "White balance restored on {{count}} photos",
  "White balance: Auto": "White balance: Auto",
  "White balance: picker": "White balance: picker",
  "White balance: restored": "White balance: restored",
  "White on black": "White on black",
  "Whole library": "Whole library",
  "Without look": "Without look",
  "Work in the background no longer slows the app: opening a large folder, masks and the HDR preview keep their pixel work off the window’s thread.": "Work in the background no longer slows the app: opening a large folder, masks and the HDR preview keep their pixel work off the window’s thread.",
  "Work running in the background (AI jobs, exports, model downloads) shows on the top bar with how far it has come; click it to see the queue, go to a photo or stop a job.": "Work running in the background (AI jobs, exports, model downloads) shows on the top bar with how far it has come; click it to see the queue, go to a photo or stop a job.",
  working,
  "Working…": "Working…",
  "Works now": "Works now",
  "Works on Dehaze, Highlights and Shadows, Vibrance, Point Color and Color Grading. It shows when you let go of a slider, not while you drag.": "Works on Dehaze, Highlights and Shadows, Vibrance, Point Color and Color Grading. It shows when you let go of a slider, not while you drag.",
  "Works on people, signs, wires and larger things where Fill would repeat the background. With Find object, click something and it is found for you.": "Works on people, signs, wires and larger things where Fill would repeat the background. With Find object, click something and it is found for you.",
  "Works out by itself how damaged the file is. Good for pictures saved from the web or sent through messaging apps.": "Works out by itself how damaged the file is. Good for pictures saved from the web or sent through messaging apps.",
  "Works out what is near and what is far, so a mask can take the foreground or the background by distance.": "Works out what is near and what is far, so a mask can take the foreground or the background by distance.",
  years,
  yellow,
  Yellow,
  Yes,
  "You'll find it later in {{where}}.": "You'll find it later in {{where}}.",
  "You’re signed in as {{email}}, but this account isn’t in the beta yet. Join it on the beta page; the app opens as soon as you come back.": "You’re signed in as {{email}}, but this account isn’t in the beta yet. Join it on the beta page; the app opens as soon as you come back.",
  "You’re signed in, but this account isn’t in the beta yet. Join it on the beta page; the app opens as soon as you come back.": "You’re signed in, but this account isn’t in the beta yet. Join it on the beta page; the app opens as soon as you come back.",
  "Your account is already on as many devices as it allows. Free one to use this one.": "Your account is already on as many devices as it allows. Free one to use this one.",
  "Your free trial has ended. Buy a licence to export again. Editing still works.": "Your free trial has ended. Buy a licence to export again. Editing still works.",
  "Your licence is already on {{count}} devices. Free one in Settings to use it here. Editing still works._one": "Your licence is already on {{count}} device. Free one in Settings to use it here. Editing still works.",
  "Your licence is already on {{count}} devices. Free one in Settings to use it here. Editing still works._other": "Your licence is already on {{count}} devices. Free one in Settings to use it here. Editing still works.",
  "Zoom in": "Zoom in",
  "Zoom In": "Zoom In",
  "Zoom out": "Zoom out",
  "Zoom Out": "Zoom Out",
  "Zoom to 100%": "Zoom to 100%"
};
const fr = {};
const de = {};
const zhHans = {};
const ja = {};
const vi = {};
const resources = {
  en: { translation: en },
  fr: { translation: fr },
  de: { translation: de },
  "zh-Hans": { translation: zhHans },
  ja: { translation: ja },
  vi: { translation: vi }
};
function startI18n(language) {
  const inst2 = i18next.createInstance();
  void inst2.init({
    resources,
    lng: language,
    fallbackLng: "en",
    // The English is the key: its dots, colons and ellipses are text.
    keySeparator: false,
    nsSeparator: false,
    returnEmptyString: false,
    // React (and the menus) escape; the text is never HTML.
    interpolation: { escapeValue: false },
    initAsync: false
  });
  concepts.setTranslator((key, values) => inst2.t(key, values));
  return inst2;
}
let inst = null;
let state$1 = null;
const listeners = /* @__PURE__ */ new Set();
function preferred() {
  const list = electron.app.getPreferredSystemLanguages();
  return list.length ? list : [electron.app.getLocale()];
}
function startLanguage() {
  const setting2 = readSettings().language ?? "system";
  state$1 = { setting: setting2, language: concepts.resolveLanguage(setting2, preferred()) };
  inst = startI18n(state$1.language);
  return state$1;
}
function languageState() {
  return state$1 ?? startLanguage();
}
function setLanguage(setting2) {
  writeSettings({ language: setting2 });
  state$1 = { setting: setting2, language: concepts.resolveLanguage(setting2, preferred()) };
  if (!inst) inst = startI18n(state$1.language);
  else void inst.changeLanguage(state$1.language);
  for (const w of electron.BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) w.webContents.send(index$1.IPC.app.languageChanged, state$1);
  listeners.forEach((f) => f());
  return state$1;
}
function onLanguage(f) {
  listeners.add(f);
}
const RELEASE_NOTES = [
  // Engines 0.18 and 0.19 together (TODO.md Phases N and O). Gemma, its
  // llama.cpp server and SAM 3 are held out of this release (the owner).
  {
    version: "0.4.0-beta",
    headline: concepts.tk("HDR while you edit, masks you can ask for by name, suggested rejects, and noise reduction that matches your export."),
    sections: [
      {
        title: "HDR",
        items: [
          concepts.tk("Full HDR, on the top bar: on a display with headroom, such as a MacBook Pro’s or an HDR monitor, the photo shows its highlights brighter than white while you edit, as an HDR export holds them. The eyedropper, scopes and overlays still read the SDR picture."),
          concepts.tk("Settings → Display says what Playroom reads from your screen, or lets you state its white and peak yourself."),
          concepts.tk("RAW files keep their highlights: blown areas are rebuilt from the channels that still hold detail, and the brightest parts roll softly into white instead of clipping. RAWs you edited before are developed again the first time you open them.")
        ]
      },
      {
        title: concepts.tk("Dials"),
        items: [
          concepts.tk("Dehaze has been rebuilt. It brings back local contrast where the air is hazy and keeps each area’s brightness and colour, instead of darkening and tinting the whole picture. The same value looks gentler on brightness and colour and stronger on detail; for the old, denser result add some Contrast or a Tone Curve. Negative Dehaze is unchanged."),
          concepts.tk("The Color Mixer’s Luminance sliders feel even across their range: all the way down darkens a colour strongly but no longer turns it black, so skies keep their tone."),
          concepts.tk("A new Smoothing slider, under Dehaze, keeps colour and tone changes smooth across sea, sky and skin, so they don’t go blotchy or show a JPEG’s blocks. It shows when you let go of a slider. Photos you edited before start with it off, so they look as they did.")
        ]
      },
      {
        title: concepts.tk("Detail"),
        items: [
          concepts.tk("Noise Reduction looks the same in the preview, at 100% and in the exported file. Exports of noisy photos are cleaner than before at the same settings, most in bright, even areas such as walls and skies."),
          concepts.tk("RAW sharpening now sharpens edges and leaves flat areas alone. When sharpening is too fine to show at the current zoom, the Sharpening panel says so."),
          concepts.tk("RAWs are developed at full size with an AI model for crisper fine detail and fewer colour fringes, at 100%, for AI tools and in the export. The model (2 MB) downloads by itself; without it, a better classic method than before is used. Fujifilm X-Trans gets its own the first time you open one."),
          concepts.tk("Denoise the RAW data, under Noise reduction → AI: an AI model takes the grain out of a RAW’s sensor data before it becomes a picture, measuring each photo’s noise by itself. Off unless you turn it on; it shows at 100% and in the export.")
        ]
      },
      {
        title: concepts.tk("Masks"),
        items: [
          concepts.tk("Depth range: select by distance. Playroom maps the photo’s depth once (a small model you download the first time); click the photo to take what is at that distance, then set Near, Far and Softness, with the depth map in the card."),
          concepts.tk("Fine subject: a finer cut-out that keeps hair, fur and feathers (a larger model, downloaded when you first use it; about ten seconds a photo)."),
          concepts.tk("Sky in one click, found by a model instead of a click on the sky, and two new ones beside it: Vegetation (trees, grass, plants) and Water (sea, lakes, rivers)."),
          concepts.tk("People: Face, Hair, Skin and Clothes in one click each, found by a small model. They work best when the person fills a good part of the frame."),
          concepts.tk("Find by name: type what you want masked (“red car”, “the trees”) at the top of the New mask menu, and every one in the photo is found (a 385 MB model, downloaded when you first use it)."),
          concepts.tk("Eyes, Brows, Lips and Teeth in one click, outlined on every face in the photo, small faces in a group too. With several faces, pick one under the mask. Brows are rough for now."),
          concepts.tk("Small objects picked with Objects keep their mask instead of fading out."),
          concepts.tk("The masks panel sits in the left pane, beside your presets and history, instead of floating over the photo.")
        ]
      },
      {
        title: concepts.tk("Library"),
        items: [
          concepts.tk("Suggested rejects: photos that look like rejects (a soft frame in a burst, a subject softer than its background, too dark or too bright, closed eyes, a duplicate) show dimmed and grey. Hover one for why, then Keep or Reject it; Filters → Suggested rejects only lists them, and Reject all flags them in one go. Nothing is ever deleted, a star or a pick means a photo is never suggested, and what you keep and reject tunes the suggestions. Measured on your computer while it is idle and plugged in; Settings → Projects & interface turns it off.")
        ]
      },
      {
        title: concepts.tk("Heal"),
        items: [
          concepts.tk("Remove: paint over something, or click it with Find object, and an AI model fills it with what was likely behind it — people, signs, wires. It is baked into the photo like your other heal strokes.")
        ]
      },
      {
        title: concepts.tk("Changes"),
        items: [
          concepts.tk("Super Resolution has a Source choice: Clean stays closest to a sharp original, with a new, much faster model; Damaged repairs compression and noise as it enlarges; Keep texture leaves the grain."),
          concepts.tk("Retired AI models are removed from your disk, and so is the before-and-after with the previous engine from 0.3."),
          concepts.tk("If an adjustment ever breaks the picture, the slider responsible turns red and says so; your edit is kept."),
          concepts.tk("AI work runs on your Mac’s performance cores, where it is fastest."),
          concepts.tk("Work running in the background (AI jobs, exports, model downloads) shows on the top bar with how far it has come; click it to see the queue, go to a photo or stop a job."),
          concepts.tk("Settings → AI models → Use AI models turns every AI model off at once (RAW files still develop with theirs)."),
          concepts.tk("While Playroom is minimised or another app is in front, it lets its engine rest and draws flat, still panels, which is lighter on the battery and frees memory; the top bar says Engine offline, in yellow, until you come back. Settings → Interface → Always flat keeps the flat look all the time."),
          concepts.tk("Settings opens wide, in sections across the top like Export: General, Projects & interface, Display, AI models, Key bindings, and Privacy & about."),
          concepts.tk("Work in the background no longer slows the app: opening a large folder, masks and the HDR preview keep their pixel work off the window’s thread.")
        ]
      },
      {
        title: concepts.tk("Local AI, honestly"),
        items: [
          concepts.tk("We tried a local language model inside Playroom, one that would look at your photos and name what is in them so a mask is a tap away, all on your own computer. It works, but today it needs 3 to 4 GB of memory and 10 to 20 seconds a photo on a fast Mac, and more on an older one. That is too heavy to switch on for everyone, so it is not in this release."),
          concepts.tk("We are still working out how a local model best fits your workflow without slowing your computer down: when it should run, how much it may use, and what is worth its time. Until we have that right, every AI tool in Playroom is a small, focused model that does one job quickly, and Settings → AI models turns them all off at once.")
        ]
      }
    ],
    next: [
      {
        title: concepts.tk("Our own language models"),
        text: concepts.tk("Small models of our own, made to understand photos and editing, light enough for a laptop.")
      },
      {
        title: "MCP",
        text: concepts.tk("Let an AI assistant you already use work in Playroom with you, on your own computer, through an MCP server.")
      },
      {
        title: concepts.tk("More of the tools you know"),
        text: concepts.tk("Features you would reach for in Photoshop or Lightroom, the PIXL way.")
      },
      {
        title: concepts.tk("Faster, again"),
        text: concepts.tk("The next engine brings its own speed-ups, and we keep making Playroom lighter on your computer.")
      },
      { title: concepts.tk("And a cookie"), text: concepts.tk("For reading this far. 🍪") }
    ]
  },
  {
    version: "0.3.0-beta",
    headline: concepts.tk("PIXL’s own colour, a clearer way to export, and scopes at full size."),
    sections: [
      {
        title: concepts.tk("Colour"),
        items: [
          concepts.tk("The engine now works in PixlRGB, PIXL’s own wide working space."),
          concepts.tk("Edits that act on the colour channels themselves (curves, colour mixing, per-channel gain, HSL) can look a little different. Open any photo you edited before to see it before and after; remove the old previews whenever you like."),
          concepts.tk("HDR exports use the engine’s own tone mapping, gamut compression and gain maps."),
          concepts.tk("RAW files use PIXL’s own camera colour for the 46 bodies it knows (the others keep the file’s own). RAWs you edited before can shift a little, and heals, denoise and enhance made on the old colour are marked, because their pixels moved. Your white balance keeps its look. Switch any photo back under Colour in the develop panel.")
        ]
      },
      {
        title: concepts.tk("Export"),
        items: [
          concepts.tk("Export in four steps: Format, Size & colour, Metadata & HDR, and Review, built from the editor’s own cards and sliders."),
          concepts.tk("Review shows the first photo as it will be exported, and what would go wrong before it does: a setting that cannot work, a folder that cannot be written, a full disk, files that would be replaced."),
          concepts.tk("Fit a photo inside a width and height, and read what each rendering intent does next to the choice.")
        ]
      },
      {
        title: concepts.tk("Scopes"),
        items: [
          concepts.tk("The histogram and the colour chart open at full size: overlay, parade, one channel or luma, with the before picture behind and HDR in stops."),
          concepts.tk("A CIE 1976 chart with PixlRGB and the gamuts you compare it to."),
          concepts.tk("Metrics before and after (range, contrast, clipping, colour cast), the photo’s dominant colours with their values, and how it reads with a colour-vision deficiency.")
        ]
      },
      {
        title: concepts.tk("Masks"),
        items: [
          concepts.tk("Object detection has its own button beside the brush, gradients and lasso."),
          concepts.tk("A mask’s edge is one crisp line at any zoom."),
          concepts.tk("The pins over the photo are gone; gradient and lasso handles show when the pointer is over the photo.")
        ]
      },
      {
        title: concepts.tk("Changes"),
        items: [
          concepts.tk("HEIC export is replaced by AVIF (HEIC files still open)."),
          concepts.tk("Select Subject is moving to one smaller model (U²-Netp). If you already have U²-Net or the exact JPEG repair, they are listed under AI models as being retired: U²-Net keeps making Subject and Background masks until the next update, and either can be removed to free the space.")
        ]
      }
    ],
    next: [
      {
        title: concepts.tk("Better models"),
        text: concepts.tk("Sharper selections, the sky on its own, and people’s hair, skin and eyes found for you.")
      },
      {
        title: concepts.tk("Smart looks, reimagined"),
        text: concepts.tk("Looks that understand more of the photo and adjust each part on its own.")
      },
      {
        title: concepts.tk("An MCP server for the editor"),
        text: concepts.tk("Let an AI assistant work in Playroom with you, on your own computer.")
      },
      { title: concepts.tk("And much more"), text: concepts.tk("This is a beta: there is a lot more on the way.") }
    ]
  },
  {
    version: "0.2.0-beta",
    headline: concepts.tk("Looks, a new way to make masks, and a new RAW engine."),
    sections: [
      {
        title: concepts.tk("Looks"),
        items: [
          concepts.tk("Over 300 looks, from film stocks and cinema to camera makers’ own, browsed on your photo with live previews, search and shelves."),
          concepts.tk("Hover a look to see it on the photo, then dial it in with Amount. Clicking another swaps it."),
          concepts.tk("Smart looks find the subject, the sky or an object and adjust just that part."),
          concepts.tk("Save your own looks with their masks and AI steps: they are made again on every photo you use them on.")
        ]
      },
      {
        title: concepts.tk("Masks"),
        items: [
          concepts.tk("Objects: point at anything and Playroom selects it. Hover and click, draw a box or scribble over it; Shift adds a part, Alt takes one away."),
          concepts.tk("The sky in a click, and a lasso that finds the object inside it."),
          concepts.tk("Snap to edges for brushes, lassos and AI masks, and crisper Subject and Background edges."),
          concepts.tk("A bidirectional gradient, and gradients that stay exact at any size."),
          concepts.tk("A clearer masks panel, and Molten glass draws a solid line along sharp edges.")
        ]
      },
      {
        title: concepts.tk("Develop"),
        items: [
          concepts.tk("A new RAW engine (LibRaw): more cameras, and RAW files that would not open before are tried again."),
          concepts.tk("Sharp 1:1 zoom on straightened, cropped and lens-corrected photos."),
          concepts.tk("Defish fisheye lenses with their lens profiles."),
          concepts.tk("Faster RAW previews, using a third of the memory on large files."),
          concepts.tk("New sliders: drag the bar, click the value to type one, double-click to reset.")
        ]
      }
    ],
    next: [
      {
        title: concepts.tk("Better models"),
        text: concepts.tk("Sharper selections, the sky on its own, and people’s hair, skin and eyes found for you.")
      },
      {
        title: concepts.tk("Our own colour science"),
        text: concepts.tk("Colour from PIXL’s own science, from the sensor to your screen.")
      },
      { title: concepts.tk("And much more"), text: concepts.tk("This is a beta: there is a lot more on the way.") }
    ]
  }
];
function notesToShow(current2, seen, hadInstall2, notes = RELEASE_NOTES) {
  const built = notes.filter((n) => compareVersions(n.version, current2) <= 0);
  if (seen) return built.filter((n) => compareVersions(n.version, seen) > 0);
  return hadInstall2 ? built.slice(0, 1) : [];
}
function parseReleaseNotes(raw2, version) {
  const text = Array.isArray(raw2) ? raw2.filter((r) => !r.version || r.version === version).map((r) => r.note ?? "").join("\n\n") : typeof raw2 === "string" ? raw2 : "";
  const plain = text.replace(/<\/(p|li|h\d)>/gi, "\n").replace(/<li>/gi, "- ").replace(/<h\d>/gi, "## ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  if (!plain) return null;
  const notes = { version, headline: "", sections: [] };
  let section = null;
  let coming = false;
  for (const raw22 of plain.split("\n")) {
    const line = raw22.trim();
    if (!line) continue;
    const h = /^#{1,3}\s+(.*)$/.exec(line);
    if (h) {
      coming = /^coming soon$/i.test(h[1].trim());
      section = coming ? null : { title: h[1].trim(), items: [] };
      if (section) notes.sections.push(section);
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item && coming) {
      const m = /^\*\*(.+?)\*\*:?\s*(.*)$/.exec(item[1]);
      (notes.next ??= []).push(m ? { title: m[1], text: m[2] } : { title: item[1], text: "" });
      continue;
    }
    if (item) {
      if (!section) notes.sections.push(section = { title: concepts.tk("What’s new"), items: [] });
      section.items.push(item[1]);
      continue;
    }
    if (!notes.headline && !section) notes.headline = line;
    else if (section) section.items.push(line);
    else notes.headline += ` ${line}`;
  }
  return notes;
}
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1e3;
const betaBuild = electron.app.getVersion().includes("-beta");
const channelFor = (chosen) => betaBuild ? "beta" : chosen;
let state = {
  phase: "idle",
  channel: "latest",
  currentVersion: electron.app.getVersion()
};
let enabled = false;
let timer;
let autoUpdater;
function broadcast() {
  for (const win2 of electron.BrowserWindow.getAllWindows()) {
    if (!win2.isDestroyed()) win2.webContents.send(index$1.IPC.updates.event, state);
  }
}
function setState(patch) {
  state = { ...state, ...patch };
  broadcast();
}
function applyChannel(channel) {
  autoUpdater.channel = channel;
  autoUpdater.allowPrerelease = channel === "beta";
  autoUpdater.allowDowngrade = false;
}
function updateState() {
  return state;
}
async function checkForUpdates() {
  if (!enabled || state.phase === "downloading" || state.phase === "downloaded") return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log.warn("update check failed", err);
  }
  return state;
}
function installUpdate() {
  if (enabled && state.phase === "downloaded") setImmediate(() => autoUpdater.quitAndInstall());
}
async function setUpdateChannel(channel) {
  if (channel !== "latest" && channel !== "beta" || betaBuild) return state;
  writeSettings({ updateChannel: channel });
  setState({ channel, phase: enabled ? "idle" : state.phase, version: void 0, error: void 0 });
  if (!enabled) return state;
  applyChannel(channel);
  return checkForUpdates();
}
async function setupUpdater() {
  state = { ...state, channel: channelFor(readSettings().updateChannel) };
  if (!electron.app.isPackaged && !process.env["PLAYROOM_FORCE_UPDATER"] || process.env["PLAYROOM_HIDDEN"] === "1") {
    state = { ...state, phase: "disabled" };
    return;
  }
  const updater = await import("electron-updater");
  autoUpdater = updater.autoUpdater ?? updater.default.autoUpdater;
  enabled = true;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  if (!electron.app.isPackaged) autoUpdater.forceDevUpdateConfig = true;
  const feed = process.env["PLAYROOM_UPDATE_URL"];
  if (feed) {
    log.info(`updates: reading ${feed} (PLAYROOM_UPDATE_URL)`);
    autoUpdater.setFeedURL({ provider: "generic", url: feed.replace(/\/+$/, "") });
  }
  applyChannel(state.channel);
  autoUpdater.on("checking-for-update", () => {
    setState({ phase: "checking", error: void 0, lastCheckedAt: (/* @__PURE__ */ new Date()).toISOString() });
  });
  autoUpdater.on("update-available", (info2) => {
    setState({
      phase: "available",
      version: info2.version,
      releaseDate: info2.releaseDate,
      // What it brings, from the feed (build/release-notes.md as published).
      notes: parseReleaseNotes(info2.releaseNotes, info2.version)
    });
  });
  autoUpdater.on("update-not-available", (info2) => {
    setState({ phase: "not-available", version: info2.version, progress: void 0 });
  });
  autoUpdater.on("download-progress", (p) => {
    setState({
      phase: "downloading",
      progress: {
        percent: p.percent,
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond
      }
    });
  });
  autoUpdater.on("update-downloaded", (info2) => {
    setState({
      phase: "downloaded",
      version: info2.version,
      progress: void 0,
      notes: parseReleaseNotes(info2.releaseNotes, info2.version) ?? state.notes
    });
  });
  autoUpdater.on("error", (err) => {
    setState({ phase: "error", error: err.message.split("\n")[0] });
  });
  onPolicy((p) => {
    const required = belowFloor(electron.app.getVersion(), p) ? { minVersion: p.minVersion, message: p.message } : void 0;
    if (JSON.stringify(required) === JSON.stringify(state.required)) return;
    if (required) log.warn(`updates: ${electron.app.getVersion()} is below the floor ${required.minVersion}`);
    setState({ required });
    if (required) void checkForUpdates();
  });
  void checkForUpdates();
  timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
  electron.app.on("before-quit", () => clearInterval(timer));
}
let hadInstall = false;
function noteInstall() {
  hadInstall = fs.existsSync(path.join(electron.app.getPath("userData"), "playroom.db"));
}
function whatsNew() {
  const seen = readSettings().notesSeen ?? null;
  const notes = notesToShow(electron.app.getVersion(), seen, hadInstall);
  if (!seen && notes.length === 0) writeSettings({ notesSeen: electron.app.getVersion() });
  return notes;
}
function notesSeen() {
  writeSettings({ notesSeen: electron.app.getVersion() });
}
function toAppError(err) {
  if (err instanceof EngineError)
    return { message: err.userMessage, code: err.code, field: err.field };
  if (err instanceof IndexError) return { message: err.message, code: err.code };
  if (err instanceof LicenceError) return { message: err.message, code: err.code };
  if (err instanceof OAuthError) return { message: err.message, code: err.code };
  if (err instanceof AccountError) return { message: err.message, code: err.code };
  return { message: err instanceof Error ? err.message : String(err), code: "Error" };
}
const isAppPage = appPage(
  url.pathToFileURL(path.join(MAIN_DIR, "../renderer/index.html")).href,
  utils.is.dev ? process.env["ELECTRON_RENDERER_URL"] : void 0
);
const TRACE = process.env.PLAYROOM_IPC_TRACE === "1";
function sizeOf(v) {
  if (v === void 0 || v === null) return 0;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}
function trace(row) {
  const g = globalThis;
  (g.__playroomIpcTrace ??= []).push(row);
}
function handle(channel, fn) {
  electron.ipcMain.handle(channel, async (e, ...args) => {
    if (!TRACE) return answer(channel, fn, e, args);
    const t0 = performance.now();
    const out = await answer(channel, fn, e, args);
    trace({ channel, ms: performance.now() - t0, inBytes: sizeOf(args), outBytes: sizeOf(out) });
    return out;
  });
}
async function answer(channel, fn, e, args) {
  if (!isAppPage(e.senderFrame?.url)) {
    log.warn(`ipc: refused ${channel} from ${e.senderFrame?.url ?? "a closed frame"}`);
    return { ok: false, error: { message: concepts.t("Not allowed."), code: "Forbidden" } };
  }
  if (gateRefuses(channel)) {
    return {
      ok: false,
      error: {
        message: concepts.t("Pixl Playroom is locked until beta access is confirmed."),
        code: "Gated"
      }
    };
  }
  try {
    const value = await fn(...args);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: toAppError(err) };
  }
}
async function wbContext(library, key) {
  const row = await library.photoRow(key);
  const isRaw = row.is_raw === 1;
  const info2 = isRaw ? await library.probe(row) : null;
  return { isRaw, asShot: info2?.as_shot_white ?? null };
}
function aiOff() {
  const why = concepts.t("AI models are off: turn them on in Settings → AI models");
  return {
    enhance: false,
    segment: false,
    denoise: false,
    prompt: false,
    smart: pixlfile.smartReadiness({
      models: true,
      subjectModel: true,
      drunetModel: true,
      enhance: true,
      off: true,
      engine: { sky: true, people: true, sam2: true, detector: false, nafnet: false }
    }),
    finders: { click: false, text: false, parts: false, "sky-model": false },
    get: {},
    why: { enhance: why, segment: why, denoise: why, prompt: why }
  };
}
async function baseFrame(s, key) {
  if (s.sessions.liveRecipe(key)) {
    const shot = await s.sessions.lensShot(key);
    return { width: shot.width, height: shot.height };
  }
  const row = await s.library.photoRow(key);
  const px2 = await ensureProxies(s.bgEngine, row, await s.library.probe(row), source$1.BACKGROUND_THREADS);
  return { width: px2.frameWidth, height: px2.frameHeight };
}
async function lensShotOf(s, key) {
  const row = await s.library.photoRow(key);
  const info2 = await s.library.probe(row);
  const item = await s.library.item(key);
  return {
    lens: info2.lens ?? null,
    camera: item ? { make: item.camera.make, model: item.camera.model } : null,
    // Only the frame's shape matters, and a RAW's developed frame keeps it.
    width: info2.width,
    height: info2.height
  };
}
function registerIpc(s) {
  const win2 = () => electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
  handle(index$1.IPC.app.cpus, () => os.cpus().length);
  handle(index$1.IPC.app.engineStatus, () => s.engine.getStatus());
  handle(index$1.IPC.app.getSetting, (key) => s.index.getSetting(key));
  handle(index$1.IPC.app.setSetting, (key, value) => s.index.setSetting(key, value));
  handle(index$1.IPC.app.reveal, (path2) => electron.shell.showItemInFolder(path2));
  handle(index$1.IPC.menu.set, (spec2) => setMenuSpec(spec2));
  handle(index$1.IPC.app.language, () => languageState());
  handle(index$1.IPC.app.setLanguage, (setting2) => {
    if (!concepts.isLanguageSetting(setting2)) throw new Error(concepts.t("Not a language Playroom has."));
    return setLanguage(setting2);
  });
  handle(index$1.IPC.menu.popup, (items) => popupMenu(items));
  handle(index$1.IPC.app.renderScale, () => index$1.renderScale());
  handle(index$1.IPC.app.displayHdr, () => displayHdr());
  handle(index$1.IPC.app.setDisplayHdr, async (v) => {
    await s.index.setSetting(DISPLAY_SETTING_KEY, v);
    return setDisplaySetting(v);
  });
  handle(index$1.IPC.app.restart, () => index$1.restart());
  handle(index$1.IPC.app.reportError, (e) => reportRendererError(e));
  handle(
    index$1.IPC.app.reportProblem,
    (r) => sendProblemReport(r, s.engine.getStatus().version)
  );
  handle(index$1.IPC.app.openNotices, async () => {
    const err = await electron.shell.openPath(index$1.paths.notices());
    if (err) throw new Error(concepts.t("Couldn't open the third-party notices: {{reason}}", { reason: err }));
  });
  handle(index$1.IPC.app.openBetaTerms, async () => {
    const err = await electron.shell.openPath(index$1.paths.betaTerms());
    if (err) throw new Error(concepts.t("Couldn't open the beta terms: {{reason}}", { reason: err }));
  });
  handle(index$1.IPC.app.whatsNew, () => whatsNew());
  handle(index$1.IPC.app.notesSeen, () => notesSeen());
  handle(index$1.IPC.app.gate, () => gate());
  handle(index$1.IPC.account.status, () => accountStatus());
  handle(index$1.IPC.account.signIn, () => signIn());
  handle(index$1.IPC.account.cancelSignIn, () => cancelSignIn());
  handle(index$1.IPC.account.signOut, () => signOut());
  handle(index$1.IPC.updates.getState, () => updateState());
  handle(index$1.IPC.updates.check, () => checkForUpdates());
  handle(index$1.IPC.updates.install, () => installUpdate());
  handle(index$1.IPC.updates.setChannel, (c) => setUpdateChannel(c));
  handle(index$1.IPC.prefs.get, () => ({
    updateChannel: readSettings().updateChannel,
    crashReports: crashConsent(),
    version: electron.app.getVersion(),
    platform: process.platform,
    arch: process.arch
  }));
  handle(index$1.IPC.prefs.setCrashReports, (c) => setCrashConsent(c));
  handle(index$1.IPC.licence.status, () => licence());
  handle(index$1.IPC.licence.refresh, () => refreshLicence());
  handle(index$1.IPC.licence.startTrial, () => startTrial());
  handle(index$1.IPC.licence.freeDevice, (id) => {
    if (typeof id !== "string" || !id) throw new Error(concepts.t("No device to free."));
    return freeDevice(id);
  });
  handle(index$1.IPC.app.takeOpens, () => index$1.takeOpens());
  handle(index$1.IPC.library.chooseFolder, async () => {
    const w = win2();
    const r = w ? await electron.dialog.showOpenDialog(w, { properties: ["openDirectory"] }) : await electron.dialog.showOpenDialog({ properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle(index$1.IPC.library.openFolder, async (folder) => ({
    folder,
    items: await s.library.openFolder(folder)
  }));
  handle(index$1.IPC.library.recentFolders, () => s.index.recentFolders());
  handle(index$1.IPC.library.forgetFolder, (folder) => s.index.forgetFolder(folder));
  handle(index$1.IPC.library.subfolders, (folder) => s.index.subfolders(folder));
  handle(index$1.IPC.library.setMeta, (keys, patch) => s.index.setMeta(keys, patch));
  handle(index$1.IPC.library.createCopy, async (key) => {
    await s.sessions.flush(key);
    const item = await s.index.createCopy(key);
    s.library.queueThumb(item.photoId, item.copyId);
    return item;
  });
  handle(index$1.IPC.library.deleteCopy, async (key) => {
    await s.sessions.close(key);
    await s.index.deleteCopy(key);
  });
  handle(
    index$1.IPC.library.applyRecipe,
    async (keys, slim2, groups, sourceKey) => {
      const recipe$1 = await s.planes.hydrate(slim2);
      let sourceWb = null;
      if (groups.includes("whiteBalance") && recipe$1.wb.mode === "custom" && sourceKey) {
        sourceWb = await wbContext(s.library, sourceKey);
      }
      await Promise.all(keys.map((key) => s.sessions.flush(key)));
      const saved = new Map((await s.index.recipes(keys)).map((r) => [r.key, r.recipe]));
      const pairs = [];
      for (const key of keys) {
        const target2 = sourceWb ? await wbContext(s.library, key) : null;
        const from = sourceWb && target2 ? { ...recipe$1, wb: pixlfile.convertWb(recipe$1.wb, sourceWb, target2) } : recipe$1;
        const live = s.sessions.liveRecipe(key);
        const base = live ?? saved.get(key);
        if (!base) continue;
        const next = recipe.applyGroups(base, from, groups);
        const g = next.geometry;
        if (groups.includes("crop") && g.crop && g.aspect && key !== sourceKey) {
          try {
            const frame = await baseFrame(s, key);
            const o = pixlfile.orientedFrame(next, frame.width, frame.height);
            g.crop = cropAtAspect(g.crop, g.aspect, o.width, o.height);
          } catch (err) {
            log.info("pasted crop not refitted for", key, err.message);
          }
        }
        if (groups.includes("lens") && key !== sourceKey) next.lens.ca = base.lens.ca;
        if (groups.includes("lens") && next.lens.profile.enabled) {
          try {
            const shot = live ? await s.sessions.lensShot(key) : await lensShotOf(s, key);
            next.lens.profile.resolved = s.lenses.resolve(shot, next.lens.profile.id).resolved;
          } catch (err) {
            next.lens.profile.resolved = null;
            log.info("lens profile not re-resolved for", key, err.message);
          }
        }
        pairs.push({ key, recipe: next });
      }
      const items = await s.index.saveRecipes(
        pairs.map((p) => ({ key: p.key, recipe: s.planes.slim(p.recipe) }))
      );
      for (const { key, recipe: next } of pairs) {
        if (s.sessions.liveRecipe(key)) s.sessions.update(key, next, false);
        const { photoId, copyId } = pixlfile.parseKey(key);
        s.library.queueThumb(photoId, copyId, true);
      }
      return items;
    }
  );
  handle(index$1.IPC.library.prioritize, (keys) => s.library.prioritize(keys));
  handle(index$1.IPC.library.resetRecipe, async (keys) => {
    const { items, recipes } = await s.index.resetRecipes(keys);
    for (const key of keys) {
      if (s.sessions.liveRecipe(key)) s.sessions.update(key, recipes[key], false);
      const { photoId, copyId } = pixlfile.parseKey(key);
      s.library.queueThumb(photoId, copyId, true);
    }
    return items;
  });
  handle(index$1.IPC.library.openSource, (src) => s.library.openSource(src));
  handle(index$1.IPC.library.resolvePaths, (paths2) => s.index.resolvePaths(paths2));
  handle(index$1.IPC.library.projectInfo, (key) => s.index.originalState(key));
  handle(
    index$1.IPC.library.setMetadata,
    (keys, patch) => s.index.setMetadata(keys, patch)
  );
  handle(index$1.IPC.library.keywordTree, () => s.index.keywordTree());
  handle(index$1.IPC.library.collections, () => s.index.collections());
  handle(
    index$1.IPC.library.saveCollection,
    (c) => s.index.saveCollection(c)
  );
  handle(index$1.IPC.library.removeCollection, (id) => s.index.removeCollection(id));
  handle(
    index$1.IPC.library.collectionItems,
    (id, keys, action) => s.index.collectionItems(id, keys, action)
  );
  handle(index$1.IPC.library.exportCollections, async (ids) => {
    const file = await s.index.exportCollections(ids);
    const only = file.collections.length === 1 ? file.collections[0].name : concepts.t("Collections");
    const opts = {
      defaultPath: `${only.replace(/[/\\:*?"<>|]/g, "-")}.json`,
      filters: [{ name: concepts.t("Collections"), extensions: ["json"] }]
    };
    const w = win2();
    const r = w ? await electron.dialog.showSaveDialog(w, opts) : await electron.dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    await promises.writeFile(r.filePath, JSON.stringify(file, null, 2));
    return r.filePath;
  });
  handle(index$1.IPC.library.importCollections, async () => {
    const opts = {
      properties: ["openFile"],
      filters: [{ name: concepts.t("Collections"), extensions: ["json"] }]
    };
    const w = win2();
    const r = w ? await electron.dialog.showOpenDialog(w, opts) : await electron.dialog.showOpenDialog(opts);
    if (r.canceled || r.filePaths.length === 0) return [];
    let parsed;
    try {
      parsed = JSON.parse(await promises.readFile(r.filePaths[0], "utf8"));
    } catch {
      throw new Error(
        concepts.t("{{name}} is not a collections file", { name: path.basename(r.filePaths[0]) })
      );
    }
    return s.index.importCollections(parsed);
  });
  handle(index$1.IPC.library.stack, (keys, cover) => s.index.stack(keys, cover));
  handle(index$1.IPC.library.unstack, (keys) => s.index.unstack(keys));
  handle(index$1.IPC.library.stackTop, (key) => s.index.stackTop(key));
  handle(
    index$1.IPC.library.autoStack,
    (folder, seconds2) => s.index.autoStack(folder, seconds2 ?? 3)
  );
  handle(
    index$1.IPC.library.duplicates,
    (folder, threshold) => s.library.duplicates(folder, threshold ?? 6)
  );
  handle(index$1.IPC.library.autoWb, (keys) => autoWbBatch(s, keys));
  handle(index$1.IPC.library.setWb, (pairs) => setWbBatch(s, pairs));
  handle(index$1.IPC.develop.open, async (key) => {
    const d = await s.sessions.open(key);
    s.embedder.request(pixlfile.keyOf(pixlfile.parseKey(key).photoId, null));
    const focal35 = d.info.lens?.focal_35mm ? d.info.lens.focal_35mm : recipe.equivalentFocal(
      d.info.lens,
      await s.sessions.lensShot(key).then((shot) => s.lenses.crop(shot)).catch(() => null)
    );
    return {
      ...d,
      focal35,
      recipe: s.planes.slim(d.recipe),
      snapshots: d.snapshots.map((sn) => ({ ...sn, recipe: s.planes.slim(sn.recipe) }))
    };
  });
  handle(index$1.IPC.develop.close, (key) => s.sessions.close(key));
  handle(index$1.IPC.develop.setRawColour, async (key, colour) => {
    await s.sessions.flush(key);
    const now = await s.library.setRawColour(key, colour);
    await s.sessions.close(key);
    return now;
  });
  handle(
    index$1.IPC.develop.update,
    async (key, recipe2, interactive, rev) => s.sessions.update(key, await s.planes.hydrate(recipe2), interactive, rev)
  );
  handle(
    index$1.IPC.develop.preview,
    async (key, recipe2) => s.sessions.preview(key, recipe2 ? await s.planes.hydrate(recipe2) : null)
  );
  handle(index$1.IPC.develop.view, (key, view) => s.sessions.view(key, view));
  handle(index$1.IPC.develop.region, (req) => s.sessions.region(req));
  handle(index$1.IPC.develop.measureCa, (key) => s.sessions.measureCa(key));
  handle(
    index$1.IPC.develop.bakeSpot,
    (key, spot, layerId, steps) => s.sessions.bakeSpot(key, spot, layerId, steps)
  );
  handle(
    index$1.IPC.develop.removeObject,
    async (key, at, feather, layerId, steps) => {
      const found = await s.select.oneShot(
        key,
        { rect: null, points: [{ x: at.x, y: at.y, fg: true }] },
        { via: "click", label: "Remove" },
        new AbortController().signal
      );
      const png2 = await s.planes.get(found.ref);
      if (png2 === void 0) throw new Error(concepts.t("the object’s mask went missing"));
      const stroke = pixlfile.strokeOver(ops.grey8(Buffer.from(png2, "base64")));
      if (!stroke) throw new Error(concepts.t("nothing was found there to remove"));
      return s.sessions.bakeSpot(
        key,
        pixlfile.removeSpot(stroke.points, stroke.radius, feather),
        layerId,
        steps
      );
    }
  );
  handle(
    index$1.IPC.develop.suggestHeal,
    (key, points, radius, feather, kind) => s.sessions.suggestHeal(key, points, radius, feather, kind)
  );
  handle(
    index$1.IPC.develop.suggestUpright,
    (key, mode, focal) => s.sessions.suggestUpright(key, mode, focal)
  );
  handle(
    index$1.IPC.develop.uprightFromLines,
    (key, lines, focal) => s.sessions.uprightFromLines(key, lines, focal)
  );
  handle(index$1.IPC.develop.sample, (key, x, y) => s.sessions.sample(key, x, y));
  handle(index$1.IPC.develop.autoTone, (key) => s.sessions.autoTone(key));
  handle(index$1.IPC.develop.autoWb, (key) => s.sessions.autoWb(key));
  handle(index$1.IPC.develop.noise, (key) => s.sessions.noise(key));
  handle(index$1.IPC.develop.putPlane, (png2) => {
    const ref = pixlfile.planeRef(png2);
    s.planes.put(ref, png2);
    return ref;
  });
  handle(index$1.IPC.develop.getPlane, async (ref) => {
    const png2 = await s.planes.get(ref);
    if (png2 === void 0) throw new Error("a painted mask is missing from the plane store");
    return png2;
  });
  handle(
    index$1.IPC.develop.saveSnapshots,
    (key, snapshots) => s.index.saveSnapshots(
      key,
      snapshots.map((sn) => ({ ...sn, recipe: s.planes.slim(sn.recipe) }))
    )
  );
  const slimLog = (log2) => ({
    ...log2,
    base: log2.base && { ...log2.base, recipe: s.planes.slim(log2.base.recipe) },
    ...log2.head ? { head: s.planes.slim(log2.head) } : {}
  });
  handle(index$1.IPC.develop.warm, (keys) => s.library.warm(keys));
  handle(index$1.IPC.develop.historyList, async (key) => slimLog(await s.index.history(key)));
  handle(index$1.IPC.develop.historyAppend, async (key, label2, recipe2) => {
    const live = s.sessions.liveRecipe(key);
    const saved = live ? s.planes.slim(live) : recipe2;
    const change = await s.index.commitEdit(key, label2, s.planes.slim(recipe2), saved);
    if (live) s.sessions.saved(key, live);
    return change.base ? { ...change, base: { ...change.base, recipe: s.planes.slim(change.base.recipe) } } : change;
  });
  handle(
    index$1.IPC.develop.historyAmend,
    async (key, seq, label2, recipe2) => {
      const live = s.sessions.liveRecipe(key);
      const saved = live ? s.planes.slim(live) : recipe2;
      const change = await s.index.amendEdit(key, seq, label2, s.planes.slim(recipe2), saved);
      if (change && live) s.sessions.saved(key, live);
      return change;
    }
  );
  handle(
    index$1.IPC.develop.historySetHidden,
    async (key, seqs, hidden2) => slimLog(await s.index.setHistoryHidden(key, seqs, hidden2))
  );
  handle(
    index$1.IPC.develop.historyDelete,
    async (key, seqs) => slimLog(await s.index.deleteHistory(key, seqs))
  );
  let userPresets = null;
  handle(
    index$1.IPC.presets.list,
    async () => (await s.index.presets()).map((p) => ({
      ...p,
      recipe: s.planes.slim(p.recipe)
    }))
  );
  handle(index$1.IPC.presets.save, async (p) => {
    const { wbOp, ...rest } = p;
    const keepsWb = p.groups.includes("whiteBalance") && p.recipe.wb.mode === "custom";
    const preset = {
      ...rest,
      ...keepsWb && wbOp ? { wbOp } : {},
      recipe: await s.planes.hydrate(p.recipe),
      id: p.id ?? recipe.newId(),
      builtin: false
    };
    await s.index.savePreset(preset);
    userPresets = null;
    return preset;
  });
  handle(index$1.IPC.presets.remove, async (id) => {
    userPresets = null;
    await s.index.removePreset(id);
  });
  handle(index$1.IPC.looks.thumbs, async (req) => {
    const wb = s.sessions.wbContext(req.key);
    if (!wb) return;
    const base = await s.planes.hydrate(req.base);
    userPresets ??= s.index.presets();
    const user = await userPresets;
    const frame = req.ids.some((id) => resolveLook(id)?.smart) ? await baseFrame(s, req.key) : null;
    const jobs = req.ids.flatMap((id) => {
      if (id === "current") return [{ id, recipe: base }];
      const p = resolveLook(id) ?? user.find((u) => u.id === id);
      if (!p) return [];
      const recipe2 = applyLook(base, p, { wb, lensResolved: "keep" });
      if (p.smart && frame)
        recipe2.layers.push(
          ...pixlfile.previewLayers(
            p.id,
            pixlfile.immediateLayers(p.smart, {
              frameWidth: frame.width,
              frameHeight: frame.height
            })
          )
        );
      return [{ id, recipe: recipe2 }];
    });
    s.sessions.lookThumbs(req.key, req.token, jobs, req.edge);
  });
  handle(index$1.IPC.looks.cancel, (key) => s.sessions.cancelLookThumbs(key));
  const runs = new LookRuns({
    startJob: (req) => s.ai.start(req),
    cancelJob: (id) => s.ai.cancel(id),
    onJobEnded: (l) => s.ai.onEnded(l),
    edit: (key, change) => editPhotoRecipe(key, change, { library: s.library, sessions: s.sessions }),
    send: (e) => {
      for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(index$1.IPC.looks.runEvent, e);
    },
    megapixels: async (key) => {
      const f = await baseFrame(s, key);
      return f.width * f.height / 1e6;
    },
    // SAM 2.1 (engine 0.16) selects what the user points at. Finding an
    // object by its name needs the detector (E45), and people's parts their
    // model (E30): neither has shipped, so `label` waits and `personJob` is
    // not given.
    promptJob: (r) => {
      if (r.prompt.kind === "label")
        throw new Error(concepts.t("finding an object by name needs the next engine update"));
      const prompt = r.prompt.kind === "point" ? { rect: null, points: [{ ...r.prompt.point, fg: true }] } : { rect: recipe.boxAround([r.prompt.from, r.prompt.to]), points: [] };
      if (!prompt.rect && prompt.points.length === 0) throw new Error(concepts.t("nothing was pointed at"));
      return s.ai.start({
        task: "prompt",
        key: r.key,
        group: r.group,
        label: r.label,
        prompt,
        via: r.label.toLowerCase() === "sky" ? "sky" : "look",
        into: { layerId: r.layerId, mode: r.mode }
      });
    }
  });
  handle(index$1.IPC.looks.run, (req) => runs.start(req));
  handle(index$1.IPC.looks.cancelRun, (by) => {
    if (by.runId) runs.cancel(by.runId);
    if (by.key) runs.cancelFor(by.key);
  });
  handle(index$1.IPC.looks.answer, (runId, a) => runs.answer(runId, a));
  handle(
    index$1.IPC.presets.luts,
    async () => (await promises.readdir(index$1.paths.luts())).filter((f) => f.toLowerCase().endsWith(".cube")).map((f) => ({ name: path.basename(f, ".cube"), path: path.join(index$1.paths.luts(), f) }))
  );
  handle(index$1.IPC.lens.status, () => s.lenses.status());
  handle(index$1.IPC.lens.check, () => s.lenses.check());
  handle(index$1.IPC.lens.search, (query) => s.lenses.search(query));
  handle(
    index$1.IPC.lens.resolve,
    async (key, id) => s.lenses.resolve(await s.sessions.lensShot(key), id)
  );
  handle(index$1.IPC.lens.importProfiles, async () => {
    const w = win2();
    const opts = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: concepts.t("Lens profile"), extensions: ["json"] }]
    };
    const r = w ? await electron.dialog.showOpenDialog(w, opts) : await electron.dialog.showOpenDialog(opts);
    if (r.canceled) return [];
    const added = await importProfiles(r.filePaths);
    await s.lenses.reloadImported();
    return added;
  });
  handle(index$1.IPC.presets.importLut, async () => {
    const w = win2();
    const opts = {
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Cube LUT", extensions: ["cube"] }]
    };
    const r = w ? await electron.dialog.showOpenDialog(w, opts) : await electron.dialog.showOpenDialog(opts);
    if (r.canceled) return [];
    return Promise.all(
      r.filePaths.map(async (f) => {
        const dest = path.join(index$1.paths.luts(), path.basename(f));
        await promises.copyFile(f, dest);
        return { name: path.basename(f, ".cube"), path: dest };
      })
    );
  });
  handle(index$1.IPC.export.chooseFolder, async () => {
    const w = win2();
    const opts = {
      properties: ["openDirectory", "createDirectory"]
    };
    const r = w ? await electron.dialog.showOpenDialog(w, opts) : await electron.dialog.showOpenDialog(opts);
    return r.canceled ? null : r.filePaths[0];
  });
  handle(index$1.IPC.export.chooseWatermark, async () => {
    const w = win2();
    const opts = {
      title: concepts.t("Choose a watermark"),
      properties: ["openFile"],
      filters: [{ name: "PNG", extensions: ["png"] }]
    };
    const r = w ? await electron.dialog.showOpenDialog(w, opts) : await electron.dialog.showOpenDialog(opts);
    return r.canceled || !r.filePaths[0] ? null : readWatermark(r.filePaths[0]);
  });
  handle(index$1.IPC.export.readWatermark, (path2) => readWatermark(path2));
  handle(index$1.IPC.export.start, (keys, settings2) => {
    requireLicence("export");
    void s.index.setSetting("export.last", settings2).catch(() => {
    });
    return s.exporter.start(keys, settings2);
  });
  handle(index$1.IPC.export.cancel, (id) => s.exporter.cancel(id));
  handle(
    index$1.IPC.export.preview,
    (key, settings2) => s.exporter.preview(key, settings2)
  );
  handle(index$1.IPC.export.cancelPreview, () => s.exporter.cancelPreview());
  handle(
    index$1.IPC.export.check,
    (keys, settings2) => s.exporter.preflight(keys, settings2)
  );
  handle(index$1.IPC.export.presets, () => s.index.exportPresets());
  handle(index$1.IPC.export.savePreset, async (p) => {
    const preset = { ...p, id: p.id ?? recipe.newId() };
    await s.index.saveExportPreset(preset);
    return preset;
  });
  handle(index$1.IPC.export.removePreset, (id) => s.index.removeExportPreset(id));
  handle(index$1.IPC.enhance.rates, () => enhanceRates(s.index));
  handle(index$1.IPC.models.list, () => s.models.list());
  handle(index$1.IPC.models.download, (id) => void s.models.download(id));
  handle(index$1.IPC.models.cancel, (id) => s.models.cancel(id));
  handle(index$1.IPC.models.remove, (id) => s.models.remove(id));
  handle(index$1.IPC.models.provider, () => s.models.providerInfo());
  handle(index$1.IPC.models.benchmark, () => s.models.benchmark(s.aiEngine));
  handle(index$1.IPC.ai.start, (req) => s.ai.start(req));
  handle(index$1.IPC.ai.cancel, (jobId) => s.ai.cancel(jobId));
  handle(index$1.IPC.ai.list, () => s.ai.list());
  handle(index$1.IPC.ai.switches, () => s.switches.get());
  handle(index$1.IPC.ai.setEnabled, (on) => s.switches.setEnabled(on === true));
  handle(
    index$1.IPC.ai.setHeavy,
    (model, on) => s.switches.setHeavy(model, on === true)
  );
  handle(index$1.IPC.ai.benchmark, (model) => {
    const progress = (p, note) => {
      for (const w of electron.BrowserWindow.getAllWindows())
        w.webContents.send(index$1.IPC.ai.benchmarkProgress, { model, progress: p, note });
    };
    return model === "gemma" ? s.brain.benchmark(progress) : benchmarkSam3(s.aiEngine, s.models, s.switches);
  });
  handle(index$1.IPC.brain.status, () => s.brain.status());
  handle(index$1.IPC.brain.download, () => void s.brain.download());
  handle(index$1.IPC.brain.cancel, () => s.brain.cancel());
  handle(index$1.IPC.brain.remove, () => s.brain.remove());
  handle(index$1.IPC.cull.suggestions, (keys) => s.cull.suggestions(keys));
  handle(index$1.IPC.cull.keep, (keys, keep) => s.cull.keep(keys, keep));
  handle(index$1.IPC.cull.measure, (keys) => s.cull.measureNow(keys));
  handle(
    index$1.IPC.names.get,
    async (key) => pixlfile.readNames(await s.index.namesOf(pixlfile.parseKey(key).photoId))
  );
  handle(index$1.IPC.names.name, (key) => s.namer.nameNow(pixlfile.parseKey(key).photoId));
  handle(
    index$1.IPC.names.edit,
    (key, names) => s.namer.edit(pixlfile.parseKey(key).photoId, names === null ? null : pixlfile.readNames(names))
  );
  handle(index$1.IPC.ai.capabilities, async () => {
    if (!await s.switches.enabled()) return aiOff();
    const enhance = enhanceAvailability(s.bgEngine.getStatus());
    const subject = await s.models.installed("u2netp");
    const status = s.bgEngine.getStatus();
    const models2 = status.enhance === true;
    const segment = models2 && subject;
    const sam2 = models2 && status.prompt === true;
    const samModel = await s.select.installed();
    const smart = pixlfile.smartReadiness({
      models: models2,
      subjectModel: subject,
      drunetModel: await s.models.installed("drunet-color"),
      nafnetModel: await s.models.installed("nafnet-sidd-w32"),
      samModel,
      enhance: enhance.available,
      sceneModel: await s.models.installed(pixlfile.SCENE_MODEL),
      partsModel: await s.models.installed(pixlfile.PARTS_MODEL),
      faceModels: await s.models.installed(recipe.FACE_DETECTOR) && await s.models.installed(recipe.FACE_LANDMARKER),
      phraseModel: await s.models.installed(pixlfile.PHRASE_MODELS[0]) || await s.models.installed(pixlfile.PHRASE_MODELS[1]),
      // The scene planes, people's parts and face parts came with 0.19
      // (models the engine runs); the detector (E45) is still to come. NAFNet
      // denoise came with 0.19 too, held back until its fixed export (E55).
      engine: {
        sky: models2,
        people: models2,
        faces: models2,
        phrase: models2,
        sam2,
        detector: false,
        nafnet: recipe.NAFNET_DENOISE
      }
    });
    const drunet = await s.models.installed("drunet-color");
    return {
      enhance: enhance.available,
      segment,
      denoise: models2,
      prompt: sam2 && samModel,
      smart,
      // By name: the sky, people's parts and anything by a phrase (SAM 3),
      // their models (0.19) offered when not downloaded.
      finders: { click: sam2, text: models2, parts: models2, "sky-model": models2 },
      // What to download for a task that waits only on its model: the one
      // Playroom recommends (the detailed subject model, SAM 2.1, DRUNet).
      get: {
        ...models2 && !subject ? { segment: "u2netp" } : {},
        ...sam2 && !samModel ? { prompt: SAM_MODEL } : {},
        ...models2 && !drunet ? { denoise: "drunet-color" } : {}
      },
      why: {
        ...enhance.available ? {} : { enhance: enhance.reason },
        ...segment ? {} : { segment: concepts.t("download {{model}}", { model: modelName(s.models.entry("u2netp")) }) },
        ...models2 ? {} : { denoise: concepts.t("this engine build runs no models") },
        ...sam2 && samModel ? {} : {
          prompt: sam2 ? concepts.t("download {{model}}", { model: modelName(s.models.entry(SAM_MODEL)) }) : concepts.t("this engine build has no prompted segmentation")
        }
      }
    };
  });
  handle(index$1.IPC.select.open, async (key) => {
    if (!await s.switches.enabled())
      throw new Error(concepts.t("AI models are off: turn them on in Settings → AI models"));
    return s.select.open(key);
  });
  handle(index$1.IPC.select.decode, (selId, req) => s.select.decode(selId, req));
  handle(
    index$1.IPC.select.commit,
    (selId, source2) => s.select.commit(selId, source2)
  );
  handle(index$1.IPC.select.close, (selId) => s.select.close(selId));
}
const THUMB_EDGE = 400;
const NAMING_EDGE = 1024;
const WARM_MAX = 3;
const versionOf = (row) => `${row.path}:${row.mtime}:${row.size}`;
function hdrKindOf(info2) {
  if (info2.gain_map) return "gainmap";
  if (!info2.is_hdr) return "";
  return /HLG/i.test(info2.color) ? "hlg" : "pq";
}
class Library {
  /** What edited photos looked like before engine 0.17: the first-open comparison. */
  constructor(index2, engine2, planes) {
    this.index = index2;
    this.engine = engine2;
    this.planes = planes;
    index2.on((e) => {
      if (e.name === "changed") this.broadcast(index$1.IPC.library.changed, { folder: e.folder });
      else if (e.name === "sources") this.broadcast(index$1.IPC.library.sourcesChanged, null);
    });
  }
  index;
  engine;
  planes;
  probes = /* @__PURE__ */ new Map();
  probing = /* @__PURE__ */ new Map();
  /** JPEGs being rebuilt from a project's JPEG XL repack, by where they go. */
  rebuilding = /* @__PURE__ */ new Map();
  queue = [];
  /** Keys waiting in the queue. */
  queued = /* @__PURE__ */ new Set();
  /** Keys rendering now, and those changed since theirs began (rendered again after). */
  rendering = /* @__PURE__ */ new Set();
  stale = /* @__PURE__ */ new Set();
  /** Who waits for a key's thumbnail: told when a render of it ends. */
  waiting = /* @__PURE__ */ new Map();
  running = 0;
  /** The duplicate search hashing pictures now, if any. */
  dupes = null;
  /**
   * Thumbnails still to make: the safe-shutdown rest keeps the background
   * engine for them (rest.ts), as for an export, so a folder opened just
   * before Playroom goes behind finishes once, rather than the host being
   * let go between two thumbnails and started again for the next (Pass 116:
   * that churn made a 259-RAW folder take minutes instead of a minute).
   */
  get busy() {
    return this.running > 0 || this.queue.length > 0;
  }
  broadcast(channel, payload) {
    for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
  }
  /**
   * A photo's probe, cached per file version: in memory, and on disk beside
   * its proxies so a photo opened again (another day) does not ask the
   * engine. `engine`: the one to ask when it must (opening a photo asks the
   * interactive one, not the background one busy with thumbnails).
   */
  async probe(photo, engine2 = this.engine) {
    return this.withColour(photo, await this.engineProbe(photo, engine2));
  }
  /** Photos whose camera colour is being chosen now, so two probes choose it once. */
  adopting = /* @__PURE__ */ new Map();
  /**
   * A RAW's probe as the app reads it: its camera colour recorded the first
   * time it is wanted (PIXL's where the database holds the body, else the
   * file's own), `photo.raw_colour` set on the caller's row (every cache's
   * name, `versionStamp`, reads it), and the as-shot white the one that
   * colour develops with (`effectiveInfo`). The first time, the photo's
   * saved absolute white balances move with the white so the picture keeps
   * its look; the colour is written before anything is made from it.
   */
  async withColour(photo, info2) {
    if (photo.is_raw !== 1) return info2;
    if (!source$1.parseRawColour(photo.raw_colour)) {
      let p = this.adopting.get(photo.id);
      if (!p) {
        p = this.adoptColour(photo.id, info2).finally(() => this.adopting.delete(photo.id));
        this.adopting.set(photo.id, p);
      }
      photo.raw_colour = await p;
    }
    return source$1.effectiveInfo(info2, source$1.resolveRawColour(photo.raw_colour, info2));
  }
  async adoptColour(photoId, info2) {
    const colour = source$1.defaultRawColour(info2);
    await this.index.setRawColour(photoId, colour);
    if (colour !== "container")
      await this.index.carryWhite(
        photoId,
        { isRaw: true, asShot: source$1.asShotFor(info2, "container") },
        { isRaw: true, asShot: source$1.asShotFor(info2, colour) },
        concepts.t("Camera colour: {{colour}}", { colour: source$1.rawColourLabel(info2, colour) })
      );
    return colour;
  }
  /**
   * The person's choice of camera colour for a RAW: recorded (in its sidecar
   * or project too), its saved white balances carried to the new as-shot
   * white, and the caches that name the colour made again on the next use.
   * Returns the colour now in force. Nothing is changed for a body PIXL's
   * database lacks.
   */
  async setRawColour(key, colour) {
    const row = await this.photoRow(key);
    if (row.is_raw !== 1) throw new Error(concepts.t("only a RAW has a camera colour"));
    const info2 = await this.engineProbe(row, this.engine);
    const to = source$1.resolveRawColour(colour, info2);
    const from = source$1.resolveRawColour(row.raw_colour, info2);
    if (to === from && source$1.parseRawColour(row.raw_colour)) return to;
    await this.index.setRawColour(row.id, to, true);
    await this.index.carryWhite(
      row.id,
      { isRaw: true, asShot: source$1.asShotFor(info2, from) },
      { isRaw: true, asShot: source$1.asShotFor(info2, to) },
      concepts.t("Camera colour: {{colour}}", { colour: source$1.rawColourLabel(info2, to) })
    );
    this.queueThumb(row.id, null, true);
    return to;
  }
  async engineProbe(photo, engine2) {
    const k = versionOf(photo);
    const hit = this.probes.get(k);
    if (hit) return hit;
    let p = this.probing.get(k);
    if (!p) {
      p = this.probeOnce(photo, k, engine2).finally(() => this.probing.delete(k));
      this.probing.set(k, p);
    }
    return p;
  }
  async probeOnce(photo, k, engine2) {
    const file = path.join(
      index$1.paths.photoCachePath(photo.id),
      `probe-${recipe.hash32(`${k}:${electron.app.getVersion()}`).toString(16)}.json`
    );
    let info2 = null;
    try {
      info2 = JSON.parse(await promises.readFile(file, "utf8"));
    } catch {
      info2 = await engine2.probe(photo.path);
      await promises.mkdir(index$1.paths.photoCachePath(photo.id), { recursive: true });
      await promises.writeFile(file, JSON.stringify(info2)).catch(() => void 0);
    }
    this.probes.set(k, info2);
    const kind = hdrKindOf(info2);
    if (photo.hdr_key !== versionOf(photo) || (photo.hdr ?? "") !== kind) {
      void this.index.setHdr(photo.id, kind).catch(() => void 0);
      this.broadcast(index$1.IPC.library.hdr, { photoId: photo.id, hdr: kind || null });
    }
    return info2;
  }
  /** Photos whose HDR kind is not known yet, probed one by one in the background. */
  hdrWork = [];
  hdrSeen = /* @__PURE__ */ new Set();
  hdrRunning = false;
  queueHdr(items) {
    for (const it of items) {
      if (it.hdr !== void 0 || it.offline || it.unreadable || it.copyId) continue;
      if (this.hdrSeen.has(it.key)) continue;
      this.hdrSeen.add(it.key);
      this.hdrWork.push(it.key);
    }
    if (this.hdrRunning) return;
    this.hdrRunning = true;
    void (async () => {
      while (this.hdrWork.length) {
        const key = this.hdrWork.shift();
        try {
          await this.probe(await this.photoRow(key));
        } catch {
        }
      }
      this.hdrRunning = false;
    })();
  }
  /** Photos whose proxies are to be made ahead, the newest asked for first. */
  warming = [];
  warmRunning = false;
  /**
   * Make these photos' proxies ahead, on the background engine (behind any
   * preview being rendered): the photos either side of the open one, so
   * stepping to the next opens at once. Asking again replaces what has not
   * started; one is made at a time.
   */
  warm(keys) {
    this.warming = keys.slice(0, WARM_MAX);
    if (this.warmRunning) return;
    this.warmRunning = true;
    void (async () => {
      while (this.warming.length > 0) {
        const key = this.warming.shift();
        try {
          const row = await this.readable(await this.photoRow(key));
          await ensureProxies(this.engine, row, await this.probe(row), source$1.BACKGROUND_THREADS);
        } catch (err) {
          log.info("proxies not made ahead for", key, err.message);
        }
      }
      this.warmRunning = false;
    })();
  }
  /** A folder's items as the index has them; its thumbnails are queued. */
  async openFolder(folder) {
    const items = await this.index.listFolder(folder);
    for (const it of items) this.queueThumb(it.photoId, it.copyId);
    this.queueHdr(items);
    return items;
  }
  /**
   * Any source's items (a collection's come from many folders); thumbnails
   * are queued for those that are there. Thumbnails belong to photos, not
   * folders, so one rendered for a folder serves every collection too.
   */
  async openSource(src) {
    if (src.kind !== "duplicates") this.dupes?.abort();
    const listing = src.kind === "duplicates" ? await this.duplicates(src.folder, src.threshold) : await this.index.listSource(src);
    for (const it of listing.items) if (!it.offline) this.queueThumb(it.photoId, it.copyId);
    this.queueHdr(listing.items);
    return listing;
  }
  /**
   * Exact and near duplicates in a folder or the whole library. Near ones
   * need each photo's picture hash, made here from its thumbnail (rendered
   * first where there is none) since this side has the engine.
   */
  async duplicates(folder, threshold = 6) {
    this.dupes?.abort();
    const abort = new AbortController();
    this.dupes = abort;
    const work = await this.index.dhashWork(folder);
    let next = 0;
    const worker = async () => {
      while (next < work.length && !abort.signal.aborted) {
        const w = work[next++];
        try {
          await this.hashPicture(w.photoId, w.thumbPath);
        } catch (err) {
          const message = err?.message ?? String(err);
          log.warn("picture hash failed", w.photoId, message);
          void this.index.markFailed(w.photoId, message).catch(() => {
          });
        }
      }
    };
    await Promise.all([worker(), worker()]);
    if (this.dupes === abort) this.dupes = null;
    return this.index.duplicates(folder, threshold);
  }
  /** A photo's 64-bit dHash, of its thumbnail shrunk to 9×8 by the engine. */
  async hashPicture(photoId, thumbPath) {
    if (!thumbPath) await this.thumbFor(photoId, null);
    const row = await this.index.row(pixlfile.keyOf(photoId, null));
    if (!row.thumb_path || !row.thumb_key || !fs.existsSync(row.thumb_path)) return;
    const report = await this.engine.convert({
      ...source$1.blankRequest(row.thumb_path, "", "Jpeg"),
      sink: "Bytes",
      resize: { Exact: { width: 9, height: 8 } },
      resampler: "Bilinear",
      pixel: { depth: "Eight", channels: 3 },
      encode: { Png: { compression: "Fast", filter: "NoFilter" } },
      threads: 1
    });
    if (!report.output) throw new Error("the engine returned no pixels");
    const px2 = ops.pngToFloats(Buffer.from(report.output));
    const grey = new Uint8Array(px2.width * px2.height);
    for (let i = 0; i < grey.length; i++) {
      const o = i * px2.channels;
      const y = px2.channels >= 3 ? 0.299 * px2.data[o] + 0.587 * px2.data[o + 1] + 0.114 * px2.data[o + 2] : px2.data[o];
      grey[i] = Math.round(y * 255);
    }
    await this.index.setDhash(row.id, pixlfile.dhashFromGrey(grey, px2.width, px2.height), row.thumb_key);
  }
  item(key) {
    return this.index.item(key);
  }
  /** The photo's row, its path a file that can be read (see `readable`). */
  async photoRow(key) {
    return this.readable(await this.index.sourceRow(key));
  }
  /**
   * A row (from `sourceRow`, `openData` or `thumbJob`) whose path is a file
   * the engine can read: the photo itself, or, when it is gone, the copy its
   * project carries. A JPEG the project keeps repacked into JPEG XL is
   * rebuilt into the very JPEG it was, byte for byte, once.
   */
  async readable(row) {
    const e = row.embedded;
    if (e === void 0) return row;
    if (e === null)
      throw new Error(
        concepts.t("{{name}} is missing, and its project does not carry a copy of it yet", { name: row.name })
      );
    if (e.codec !== "jxl-jpeg") return { ...row, path: e.path };
    const jpg = e.path.replace(/\.jxl$/i, ".jpg");
    if (!fs.existsSync(jpg)) {
      let made = this.rebuilding.get(jpg);
      if (!made) {
        made = this.engine.convert({
          ...source$1.blankRequest(e.path, jpg, "Jxl"),
          encode: "JpegFromJxl",
          metadata: source$1.PRESERVE_ALL
        }).then(() => void 0).finally(() => this.rebuilding.delete(jpg));
        this.rebuilding.set(jpg, made);
      }
      await made;
    }
    return { ...row, path: jpg };
  }
  /** A key's saved recipe, its planes filled in. */
  async recipe(key) {
    return this.planes.hydrate(await this.index.recipe(key));
  }
  /** Save a key's recipe; its planes cross by reference. */
  saveRecipe(key, recipe2) {
    return this.index.saveRecipe(key, this.planes.slim(recipe2));
  }
  // ── thumbnails ──
  /** Pictures offered for the next thumbnail of a key (see `Picture`). */
  pictures = /* @__PURE__ */ new Map();
  queueThumb(photoId, copyId, urgent = false, picture) {
    const k = pixlfile.keyOf(photoId, copyId);
    if (picture) this.pictures.set(k, picture);
    else this.pictures.delete(k);
    if (this.rendering.has(k)) {
      this.stale.add(k);
      return;
    }
    if (this.queued.has(k)) {
      if (urgent) this.prioritize([k]);
      return;
    }
    this.queued.add(k);
    if (urgent) this.queue.unshift({ photoId, copyId });
    else this.queue.push({ photoId, copyId });
    this.pump();
  }
  /** A key's thumbnail, rendered through the queue (never beside it); resolves when it is current. */
  thumbFor(photoId, copyId) {
    const k = pixlfile.keyOf(photoId, copyId);
    return new Promise((resolve) => {
      this.waiting.set(k, [...this.waiting.get(k) ?? [], resolve]);
      this.queueThumb(photoId, copyId, true);
    });
  }
  /** Move these keys' waiting thumbnails to the front of the queue. */
  prioritize(keys) {
    const want = new Set(keys);
    const first = this.queue.filter((j) => want.has(pixlfile.keyOf(j.photoId, j.copyId)));
    if (first.length === 0) return;
    this.queue = [...first, ...this.queue.filter((j) => !want.has(pixlfile.keyOf(j.photoId, j.copyId)))];
  }
  pump() {
    while (this.running < 2 && this.queue.length > 0) {
      const job = this.queue.shift();
      const k = pixlfile.keyOf(job.photoId, job.copyId);
      this.queued.delete(k);
      this.rendering.add(k);
      this.running++;
      this.thumb(job).catch((err) => {
        log.warn("thumbnail failed", job, err?.message ?? err);
        if (!(err instanceof EngineError) || err.cancelled) return;
        void this.index.markFailed(job.photoId, err.userMessage).catch(() => {
        });
        this.broadcast(index$1.IPC.library.thumb, {
          key: pixlfile.keyOf(job.photoId, job.copyId),
          url: null,
          unreadable: true
        });
      }).finally(() => {
        this.running--;
        this.rendering.delete(k);
        if (this.stale.delete(k)) this.queueThumb(job.photoId, job.copyId, true);
        else {
          for (const done of this.waiting.get(k) ?? []) done();
          this.waiting.delete(k);
        }
        this.pump();
      });
    }
  }
  async thumb(job) {
    const picture = this.pictures.get(pixlfile.keyOf(job.photoId, job.copyId));
    this.pictures.delete(pixlfile.keyOf(job.photoId, job.copyId));
    let work = await this.index.thumbJob(job.photoId, job.copyId);
    if (!work) return;
    if (work.row.is_raw === 1 && !work.row.raw_colour) {
      await this.probe(await this.readable(work.row));
      work = await this.index.thumbJob(job.photoId, job.copyId);
      if (!work) return;
    }
    const { edited, stamp: stamp2 } = work;
    const recipe$1 = await this.planes.hydrate(work.recipe);
    const row = await this.readable(work.row);
    const key = pixlfile.keyOf(row.id, job.copyId);
    const raw2 = row.is_raw === 1;
    const info2 = await this.probe(row);
    const out = path.join(
      index$1.paths.thumbs(),
      `${row.id}${job.copyId ? "-" + job.copyId : ""}-${recipe.hash32(stamp2).toString(16)}.jpg`
    );
    const base = {
      encode: { Jpeg: { quality: 85, subsampling: "Quarter", optimize: true } },
      pixel: { depth: "Eight", channels: 3 },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      threads: source$1.BACKGROUND_THREADS,
      color: source$1.displayPolicy(info2, "Srgb")
    };
    if (!edited) {
      const rawMode = raw2 ? "EmbeddedPreview" : null;
      const orientation = source$1.sourceOrientation(info2, rawMode);
      const long = Math.max(info2.width, info2.height);
      const factor = Math.min(1, THUMB_EDGE / long);
      try {
        await this.engine.convert({
          ...source$1.blankRequest(row.path, out, info2.input, info2),
          ...base,
          raw: rawMode,
          resize: factor < 1 ? { Scale: { factor } } : "None",
          framing: orientation === "Normal" ? null : { orientation, rotate_degrees: 0, rotate_resampler: "Lanczos3", crop: null }
        });
      } catch (err) {
        if (!raw2) throw err;
        await this.graded(row, info2, recipe$1, out, base);
      }
    } else if (!picture || !await this.shrunk(picture, out, base)) {
      await this.graded(row, info2, recipe$1, out, base);
    }
    await this.index.setThumb(row.id, job.copyId, out, stamp2);
    this.broadcast(index$1.IPC.library.thumb, { key, url: cacheUrl(out, stamp2) });
  }
  /**
   * The photo as Gemma is shown it (shared/naming.ts): unedited (names are
   * of what is in it, not of an edit), NAMING_EDGE on its long side.
   */
  async namingPicture(photoId) {
    const out = path.join(index$1.paths.cacheRoot(), `naming-${process.pid}-${photoId}.jpg`);
    try {
      await this.writeUnedited(photoId, NAMING_EDGE, out);
      return await promises.readFile(out);
    } finally {
      await promises.rm(out, { force: true });
    }
  }
  /**
   * The photo unedited, upright and sRGB, at most `edge` on its long side,
   * as a JPEG at `out`: what is measured or named of it (Gemma's names, the
   * cull signals), never an edit. A RAW's embedded preview, anything else
   * its own pixels; a RAW with no usable preview is developed plainly at
   * thumbnail size.
   */
  async writeUnedited(photoId, edge, out) {
    const row = await this.readable(await this.index.row(pixlfile.keyOf(photoId, null)));
    const info2 = await this.probe(row);
    const raw2 = row.is_raw === 1;
    const base = {
      encode: { Jpeg: { quality: 90, subsampling: "Quarter", optimize: false } },
      pixel: { depth: "Eight", channels: 3 },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      threads: source$1.BACKGROUND_THREADS,
      color: source$1.displayPolicy(info2, "Srgb")
    };
    const rawMode = raw2 ? "EmbeddedPreview" : null;
    const orientation = source$1.sourceOrientation(info2, rawMode);
    const factor = Math.min(1, edge / Math.max(info2.width, info2.height));
    try {
      await this.engine.convert({
        ...source$1.blankRequest(row.path, out, info2.input, info2),
        ...base,
        raw: rawMode,
        resize: factor < 1 ? { Scale: { factor } } : "None",
        framing: orientation === "Normal" ? null : { orientation, rotate_degrees: 0, rotate_resampler: "Lanczos3", crop: null }
      });
    } catch (err) {
      if (!raw2) throw err;
      await this.graded(row, info2, recipe.defaultRecipe(true), out, base);
    }
  }
  /**
   * A thumbnail shrunk from a picture Develop rendered (Display P3, so turned
   * into sRGB on the way): its settled JPEG, or in Full HDR its SDR companion
   * (a PNG), so the thumbnail is the picture as it was shown. False when it could not be (the picture already
   * replaced by a newer one): the caller grades the photo instead.
   */
  async shrunk(picture, out, base) {
    if (!fs.existsSync(picture.path)) return false;
    const factor = Math.min(1, THUMB_EDGE / Math.max(picture.width, picture.height, 1));
    try {
      await this.engine.convert({
        ...source$1.blankRequest(picture.path, out, picture.path.endsWith(".png") ? "Png" : "Jpeg"),
        ...base,
        color: {
          ConvertTo: { to: "Srgb", intent: "RelativeColorimetric", black_point_compensation: false }
        },
        resize: factor < 1 ? { Scale: { factor } } : "None"
      });
      return true;
    } catch (err) {
      log.info("thumbnail not shrunk from the develop picture", err.message);
      return false;
    }
  }
  /**
   * A thumbnail of the graded picture, from the photo's draft proxy — a
   * quarter of the proxy's pixels, and still more than a thumbnail needs —
   * or the proxy when a tight crop leaves the draft too few.
   */
  async graded(row, file, recipe2, out, base) {
    const hdr = editsHdr(recipe2, file) ? await ensureHdrSource(this.engine, row, file) : null;
    const info2 = hdr?.info ?? file;
    if (hdr) base = { ...base, color: source$1.displayPolicy(info2, "Srgb") };
    const plain = hdr?.px ?? (recipe2.pixels.length > 0 ? await ensureProxies(this.engine, row, info2, source$1.BACKGROUND_THREADS) : await ensureThumbSource(this.engine, row, info2, source$1.BACKGROUND_THREADS));
    const px2 = !hdr && recipe2.pixels.length > 0 ? (await ensureWorking(
      pixelDeps(this.engine, this.index, row),
      source$1.versionStamp(row),
      plain,
      recipe2.pixels,
      null
    )).px : plain;
    const { user, width, height } = pixlfile.orientedFrame(recipe2, px2.frameWidth, px2.frameHeight);
    const cropOf = pixlfile.compile(recipe2, {
      isRaw: row.is_raw === 1,
      asShot: info2.as_shot_white,
      sourceOrientation: "Normal",
      frameWidth: px2.frameWidth,
      frameHeight: px2.frameHeight,
      scale: 1,
      seed: 0,
      brushPaths: {},
      applyCrop: true
    }).crop;
    const cropLong = Math.max((cropOf?.width ?? 1) * width, (cropOf?.height ?? 1) * height);
    const src = cropLong * (px2.draft.width / px2.frameWidth) >= THUMB_EDGE ? px2.draft : px2.proxy;
    const compiled = pixlfile.compile(recipe2, {
      isRaw: row.is_raw === 1,
      asShot: info2.as_shot_white,
      sourceOrientation: "Normal",
      frameWidth: px2.frameWidth,
      frameHeight: px2.frameHeight,
      scale: src.width / px2.frameWidth,
      seed: source$1.seedOf(row),
      brushPaths: await brushPlanes(row.id, recipe2, user),
      applyCrop: true,
      hdr: info2.is_hdr
    });
    const cropW = (compiled.crop?.width ?? 1) * width;
    const cropH = (compiled.crop?.height ?? 1) * height;
    const factor = Math.min(1, THUMB_EDGE / (Math.max(cropW, cropH) * (src.width / px2.frameWidth)));
    await this.engine.convert({
      ...source$1.blankRequest(src.path, out, src.input),
      ...base,
      resize: factor < 1 ? { Scale: { factor } } : "None",
      grade: compiled.grade,
      framing: compiled.framing,
      lens: compiled.lens,
      retouch: compiled.retouch
    });
  }
}
const MB = 1024 * 1024;
const DNG_METADATA = { exif: true, icc: false, xmp: false, iptc: false };
const verbatim = (ext, why) => ({
  kind: "verbatim",
  codec: ext,
  encode: null,
  metadata: source$1.PRESERVE_ALL,
  ext,
  why
});
function planFor(ext, size, info2) {
  const e = ext.toLowerCase();
  if (info2.input === "Raw") {
    if (e === "dng") return verbatim(e, "already a DNG");
    return {
      kind: "dng",
      codec: "dng",
      ext: "dng",
      metadata: DNG_METADATA,
      encode: {
        Dng: {
          compression: "Lossless",
          embed_original: false,
          preview: true,
          thumbnail: true,
          crop: "None",
          apply_scaling: false,
          predictor: 1,
          index: 0
        }
      }
    };
  }
  if (info2.input === "Jpeg") {
    if (info2.gain_map) return verbatim(e, "a JPEG with a gain map is kept whole");
    return {
      kind: "jxl-jpeg",
      codec: "jxl-jpeg",
      ext: "jxl",
      metadata: source$1.PRESERVE_ALL,
      encode: { JxlJpegRepack: { effort: 7, threads: source$1.BACKGROUND_THREADS } }
    };
  }
  if (info2.input === "Png" || info2.input === "Tiff") {
    if (size < 5 * MB) return verbatim(e, "small enough as it is");
    const effort = size < 20 * MB ? 9 : size < 50 * MB ? 6 : 3;
    return {
      kind: "jxl-lossless",
      codec: "jxl",
      ext: "jxl",
      metadata: source$1.PRESERVE_ALL,
      encode: { JxlLossless: { effort, threads: source$1.BACKGROUND_THREADS } }
    };
  }
  return verbatim(e, "already compact");
}
function sameShape(kind, a, b) {
  if (kind === "dng") {
    if (!b.is_raw_mosaic && a.is_raw_mosaic) return "the DNG lost the sensor mosaic";
    if (a.as_shot_white && !b.as_shot_white) return "the DNG lost the as-shot white";
    return null;
  }
  const same = a.width === b.width && a.height === b.height || a.width === b.height && a.height === b.width;
  if (!same) return "the size changed";
  if (a.channels !== b.channels) return "the channels changed";
  if (a.bits !== b.bits) return "the bit depth changed";
  if (a.orientation !== b.orientation) return "the orientation changed";
  return null;
}
class OriginalEmbedder {
  queue = [];
  running = false;
  index;
  library;
  engine;
  constructor(index2, library, engine2) {
    this.index = index2;
    this.library = library;
    this.engine = engine2;
  }
  /** Embed the original of a photo's project, if it has one and not its original yet. */
  request(key) {
    if (this.queue.includes(key)) return;
    this.queue.push(key);
    if (!this.running) void this.drain();
  }
  async drain() {
    this.running = true;
    try {
      for (let key = this.queue.shift(); key; key = this.queue.shift()) {
        try {
          await this.embed(key);
        } catch (err) {
          log.warn("embedding the original failed", key, err);
        }
      }
    } finally {
      this.running = false;
    }
  }
  async embed(key) {
    if (await this.index.getSetting("projects.embedOriginal") === false) return;
    const state2 = await this.index.originalState(key);
    if (!state2.project || state2.state === "ready" || state2.state === "failed") return;
    const row = await this.index.row(key);
    if (row.path.toLowerCase().endsWith(pixlfile.PIXL_EXT) || !fs.existsSync(row.path)) return;
    const size = fs.statSync(row.path).size;
    const info2 = await this.library.probe(row);
    const plan = planFor(row.ext, size, info2);
    const dir = index$1.paths.photoCache(row.id);
    const out = path.join(dir, `embed-${Date.now()}.${plan.ext}`);
    const check = path.join(dir, `embed-check-${Date.now()}.jpg`);
    let made = {
      file: row.path,
      plan: verbatim(row.ext.toLowerCase()),
      note: plan.why ?? null
    };
    try {
      if (plan.encode) {
        const req = {
          ...source$1.blankRequest(row.path, out, info2.input, info2),
          encode: plan.encode,
          metadata: plan.metadata,
          threads: source$1.BACKGROUND_THREADS
        };
        await this.engine.convert(req);
        const smaller = fs.statSync(out).size < size;
        let problem = smaller ? null : "it came out no smaller";
        if (!problem && plan.kind === "jxl-jpeg") {
          await this.engine.convert({
            ...source$1.blankRequest(out, check, "Jxl"),
            encode: "JpegFromJxl",
            metadata: source$1.PRESERVE_ALL,
            threads: source$1.BACKGROUND_THREADS
          });
          if (pixlfile.sha256File(check) !== pixlfile.sha256File(row.path))
            problem = "the JPEG did not come back bit for bit";
        } else if (!problem) {
          problem = sameShape(plan.kind, info2, await this.engine.probe(out));
        }
        if (problem) made.note = `kept as it is: ${problem}`;
        else made = { file: out, plan, note: null };
      }
      const shape = made.plan.kind === "verbatim" ? info2 : await this.engine.probe(made.file);
      await this.index.putOriginal(key, made.file, made.plan.kind, {
        codec: made.plan.codec,
        width: shape.width,
        height: shape.height,
        note: made.note
      });
      log.info(
        `embedded ${row.name} in its project: ${made.plan.kind}`,
        `${(fs.statSync(made.file).size / MB).toFixed(1)} MB of ${(size / MB).toFixed(1)} MB`,
        made.note ?? ""
      );
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      try {
        await this.index.putOriginal(key, row.path, "verbatim", {
          codec: row.ext.toLowerCase(),
          width: info2.width,
          height: info2.height,
          note: `kept as it is: ${why}`
        });
      } catch (again) {
        await this.index.originalFailed(key, why).catch(() => void 0);
        throw again;
      }
    } finally {
      await promises.rm(out, { force: true });
      await promises.rm(check, { force: true });
    }
  }
}
const KEEP_BYTES = 192 * 1024 * 1024;
class PlaneStore {
  constructor(index2) {
    this.index = index2;
  }
  index;
  mem = /* @__PURE__ */ new Map();
  bytes = 0;
  /** Kept at once; the index is told in passing (it answers in order, so a later `get` finds it). */
  put(ref, png2) {
    if (this.mem.has(ref)) {
      this.remember(ref, png2);
      return;
    }
    this.index.putPlane(ref, png2).catch(() => {
    });
    this.remember(ref, png2);
  }
  async get(ref) {
    const hit = this.mem.get(ref);
    if (hit !== void 0) {
      this.mem.delete(ref);
      this.mem.set(ref, hit);
      return hit;
    }
    const png2 = await this.index.plane(ref);
    if (png2 !== void 0) this.remember(ref, png2);
    return png2;
  }
  remember(ref, png2) {
    const was = this.mem.get(ref);
    if (was !== void 0) this.bytes -= was.length;
    this.mem.delete(ref);
    this.mem.set(ref, png2);
    this.bytes += png2.length;
    for (const [k, v] of this.mem) {
      if (this.bytes <= KEEP_BYTES || k === ref) break;
      this.mem.delete(k);
      this.bytes -= v.length;
    }
  }
  /** Going out: planes by reference (and kept, so they can come back). */
  slim(recipe2) {
    return pixlfile.slim(recipe2, (ref, png2) => this.put(ref, png2));
  }
  /**
   * Coming in: every referenced plane filled in. The reference stays beside
   * it (it is the plane's content hash): what names a plane by it, a plane
   * file or a slim copy going out again, need not hash the PNG.
   */
  async hydrate(recipe$1) {
    const wants = recipe$1.layers.some(
      (l) => l.components.some((c) => recipe.hasPlane(c) && !c.png && c.ref)
    );
    if (!wants) return recipe$1;
    return {
      ...recipe$1,
      layers: await Promise.all(
        recipe$1.layers.map(async (l) => ({
          ...l,
          components: await Promise.all(
            l.components.map(async (c) => {
              if (!recipe.hasPlane(c) || c.png || !c.ref) return c;
              const png2 = await this.get(c.ref);
              if (png2 === void 0)
                throw new Error("a painted mask is missing from the plane store");
              return { ...c, png: png2 };
            })
          )
        }))
      )
    };
  }
}
const mappers = /* @__PURE__ */ new Map();
async function toSource(ctx) {
  if (!moves(ctx.lens)) return (p) => p;
  const path2 = await lensMap(ctx.deps, ctx.lens, ctx.master.width, ctx.master.height);
  let f = mappers.get(path2);
  if (!f) {
    const m = ops.pngSamples16(fs.readFileSync(path2));
    const at = (x, y, c) => m.data[(y * m.width + x) * 3 + c] / 65535;
    f = (p) => {
      const mx = Math.min(m.width - 1, Math.max(0, p.x * m.width - 0.5));
      const my = Math.min(m.height - 1, Math.max(0, p.y * m.height - 0.5));
      const x0 = Math.floor(mx);
      const y0 = Math.floor(my);
      const x1 = Math.min(m.width - 1, x0 + 1);
      const y1 = Math.min(m.height - 1, y0 + 1);
      const fx = mx - x0;
      const fy = my - y0;
      const bil = (c) => (at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) + (at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx) * fy;
      return { x: ops.rampFraction(bil(0), m.width), y: ops.rampFraction(bil(1), m.height) };
    };
    if (mappers.size > 8) mappers.clear();
    mappers.set(path2, f);
  }
  return f;
}
function localScale(map2, p, w, h) {
  const e = 5e-3;
  const a = map2(p);
  const bx = map2({ x: p.x + e, y: p.y });
  const by = map2({ x: p.x, y: p.y + e });
  const sx = Math.hypot((bx.x - a.x) * w, (bx.y - a.y) * h) / (e * w);
  const sy = Math.hypot((by.x - a.x) * w, (by.y - a.y) * h) / (e * h);
  const k = (sx + sy) / 2;
  return Number.isFinite(k) && k > 0 ? k : 1;
}
function spotBounds(s, w, h) {
  const short = Math.min(w, h);
  const reach = (Math.max(s.radius, s.radiusY || 0) + 3 * pixlfile.featherOf(s).radius) * short + 4;
  const xs = s.points.map((p) => p.x * w);
  const ys = s.points.map((p) => p.y * h);
  const x = Math.max(0, Math.floor(Math.min(...xs) - reach));
  const y = Math.max(0, Math.floor(Math.min(...ys) - reach));
  const x1 = Math.min(w, Math.ceil(Math.max(...xs) + reach));
  const y1 = Math.min(h, Math.ceil(Math.max(...ys) + reach));
  return { x, y, width: Math.max(1, x1 - x), height: Math.max(1, y1 - y) };
}
const frozen = /* @__PURE__ */ new Map();
async function bakeSpot(ctx, spot, layerId) {
  const { master, deps } = ctx;
  const W = master.width;
  const H = master.height;
  const map2 = await toSource(ctx);
  const centre = {
    x: spot.points.reduce((t, p) => t + p.x, 0) / Math.max(1, spot.points.length),
    y: spot.points.reduce((t, p) => t + p.y, 0) / Math.max(1, spot.points.length)
  };
  const k = moves(ctx.lens) ? localScale(map2, centre, W, H) : 1;
  const onPhoto = {
    ...spot,
    points: spot.points.map(map2),
    source: spot.source ? map2(spot.source) : null,
    radius: spot.radius * k,
    radiusY: spot.radiusY ? spot.radiusY * k : spot.radiusY
  };
  const inpainter = spot.kind === "remove" ? await inpainterRef() : null;
  if (spot.kind === "remove" && !inpainter)
    throw new Error("download the object remover (MI-GAN) in Settings → AI models first");
  const retouch = pixlfile.compileRetouch([onPhoto], "Normal", W, H, inpainter);
  if (!retouch) return null;
  const region = spotBounds(onPhoto, W, H);
  const stamp2 = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const render = async (out, withStroke) => {
    await deps.engine.convert({
      ...source$1.blankRequest(master.path, out, master.input),
      pixel: { depth: "Sixteen", channels: 3 },
      encode: { Png: { compression: "Fast", filter: "Sub" } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: "Preserve",
      retouch: withStroke ? retouch : null,
      region: { ...region, margin: 16 },
      threads: source$1.BACKGROUND_THREADS
    });
  };
  const a = path.join(deps.cacheDir, `heal-${stamp2}-with.png`);
  const b = path.join(deps.cacheDir, `heal-${stamp2}-without.png`);
  const patchFile = path.join(deps.cacheDir, `heal-${stamp2}-patch.png`);
  const bake = async () => {
    await Promise.all([render(a, true), render(b, false)]);
    const layer = layerId ? ctx.recipe.layers.find((l) => l.id === layerId) : void 0;
    let mask2;
    if (layer) {
      const keyed = layer.components.some((c) => c.kind === "range");
      const sig = JSON.stringify([
        W,
        H,
        layer.components,
        layer.invert,
        ctx.lens,
        keyed ? [master.path, { ...ctx.recipe, layers: [], pixels: [], retouch: [] }] : null
      ]);
      let plane = frozen.get(sig);
      if (plane && !fs.existsSync(plane)) plane = void 0;
      if (!plane) {
        plane = await ctx.freeze(ctx.recipe, layer.id) ?? void 0;
        if (!plane) return null;
        if (frozen.size > 16) frozen.clear();
        frozen.set(sig, plane);
      }
      mask2 = { path: plane, at: { x: region.x, y: region.y } };
    }
    const placed = await deps.work({
      op: "patch",
      withStroke: a,
      without: b,
      out: patchFile,
      mask: mask2
    });
    if (!placed) return null;
    const blob = await ctx.store(patchFile, {
      kind: "pixels",
      codec: "png",
      width: placed.w,
      height: placed.h
    });
    const what = pixlfile.SPOT_LABEL[spot.kind];
    return {
      id: recipe.newId(),
      kind: "retouch",
      label: layer ? `${what} in ${layer.name}` : what,
      blob,
      alpha: null,
      scope: layer?.name ?? null,
      opacity: 100,
      width: W,
      height: H,
      rect: { x: region.x + placed.x, y: region.y + placed.y, w: placed.w, h: placed.h },
      // The spot itself too, so a later develop can bake it again.
      params: { spot: spot.kind, geometry: JSON.stringify(spot) }
    };
  };
  try {
    return await bake();
  } finally {
    for (const f of [a, b, patchFile]) await promises.rm(f, { force: true }).catch(() => void 0);
  }
}
class LookThumbQueue {
  waiting = [];
  token = 0;
  running = null;
  closed = false;
  make;
  emit;
  same;
  constructor(make, emit, same = (a, b) => a === b) {
    this.make = make;
    this.emit = emit;
    this.same = same;
  }
  /**
   * The cards wanted now, in order. A token older than the last one asked
   * with is a late message and changes nothing.
   */
  request(token, jobs) {
    if (this.closed || token < this.token) return;
    this.token = token;
    this.waiting = [...jobs];
    const r = this.running;
    if (r) {
      const still = this.waiting.findIndex(
        (j) => j.id === r.job.id && this.same(j.recipe, r.job.recipe)
      );
      if (still >= 0) this.waiting.splice(still, 1);
      else r.abort.abort();
    }
    void this.pump();
  }
  /** Nothing more is wanted (the browser closed). */
  cancel() {
    this.waiting = [];
    this.running?.abort.abort();
  }
  /** The photo closed: nothing more, ever. */
  close() {
    this.closed = true;
    this.cancel();
  }
  get busy() {
    return this.running !== null || this.waiting.length > 0;
  }
  async pump() {
    while (!this.running && !this.closed) {
      const job = this.waiting.shift();
      if (!job) return;
      const abort = new AbortController();
      this.running = { job, abort };
      try {
        const thumb = await this.make(job, abort.signal);
        if (!abort.signal.aborted && !this.closed) this.emit(this.token, job.id, thumb);
      } catch (err) {
        if (!abort.signal.aborted && !this.closed) console.warn("look thumbnail failed", err);
      } finally {
        this.running = null;
      }
    }
  }
}
const DAY = 24 * 60 * 60 * 1e3;
const RENDERS = [
  [/^before-/, 0],
  [/^mthumb-/, 0]
];
const CACHE = [
  [/^heal-/, 0],
  [/^freeze-/, DAY],
  [/^brush-/, 7 * DAY],
  [/^grad-/, 7 * DAY]
];
async function sweep(dir, kinds) {
  const now = Date.now();
  for (const name of await promises.readdir(dir).catch(() => [])) {
    const kind = kinds.find(([re]) => re.test(name));
    if (!kind) continue;
    const file = path.join(dir, name);
    if (kind[1] > 0) {
      const st = await promises.stat(file).catch(() => null);
      if (!st || now - st.mtimeMs < kind[1]) continue;
    }
    await promises.rm(file, { force: true }).catch(() => void 0);
  }
}
async function sweepPhoto(rendersDir2, cacheDir) {
  await sweep(rendersDir2, RENDERS);
  await sweep(cacheDir, CACHE);
}
const SETTLE_MS = 180;
const SETTLE_LARGE_MS = 500;
const EMPTY = "empty";
const SAVE_MS = 600;
const MASK_THUMB_EDGE = 512;
const THUMB_IDLE_MS = 4e3;
const MID_SHORTFALL = 0.8;
const RECENT_FULL = 3;
const LOOK_EDGE_DEFAULT = 320;
const LOOK_EDGE_MIN = 96;
const LOOK_EDGE_MAX = 640;
const LOOK_KEEP = 600;
function masterFor(display, stated, companionEdge = COMPANION_EDGE) {
  return {
    Master: {
      headroom: true,
      peak: stated ? { Nits: stated.peakNits } : "Measured",
      ceiling: { Display: { white_nits: display.whiteNits, peak_nits: display.peakNits } },
      reach: stated ? { Stated: stated.reach } : "Measured",
      look: "Colorimetric",
      float: "ExtendedLinearDisplayP3",
      companion: { longest_side: companionEdge, resampler: "Bilinear" }
    }
  };
}
const SETTLED_ARM = process.env["PLAYROOM_SETTLED"] === "avif" ? "avif" : "frame";
const SETTLED_AVIF = {
  Avif: {
    quality: 90,
    lossless: false,
    bit_depth: 8,
    chroma: "Full",
    speed: 9,
    matrix: "Bt601",
    threads: 2,
    tune: "Ssim",
    tiling: "Single"
  }
};
function hdrFile(display, stated) {
  return { color: masterFor(display, stated), encode: SETTLED_AVIF };
}
const COMPANION_EDGE = 1024;
const DRAFT_COMPANION_EDGE = 512;
const TILE_COMPANION_EDGE = 256;
function companionOf(c) {
  return { width: c.width, height: c.height, data: c.data };
}
function named(compiled) {
  return (err) => {
    if (err instanceof EngineError) err.nameInvariant(compiled.grade, null, compiled.layerIndex);
    throw err;
  };
}
function measureOf(stride) {
  return {
    at: "Output",
    domain: "Encoded",
    bins: 256,
    percentiles: [...AUTO_PERCENTILES, 1, 99],
    clip_low: 0,
    clip_high: 1,
    hue_bins: 36,
    stride,
    transparent: "Include",
    noise: false
  };
}
function statsOf(r) {
  if (!r.stats) throw new Error("the engine measured nothing");
  return r.stats;
}
function reportOf(r, totalMs, notes, layerIndex) {
  const graded = r.color.graded?.layers ?? [];
  const layers = {};
  for (const [id, i] of Object.entries(layerIndex)) {
    const l = graded[i];
    if (l) layers[id] = { applied: l.applied, coverage: l.mask?.coverage ?? null, ms: l.layer_ms };
  }
  const lines = [];
  for (const l of r.color.graded?.layers ?? []) {
    lines.push(
      `▸ ${l.name || "layer"} — ${l.applied ? `${l.blend}, opacity ${l.opacity.toFixed(2)}` : "not applied"} (${l.layer_ms} ms)`
    );
    if (l.mask) lines.push(`   mask: coverage ${(l.mask.coverage * 100).toFixed(1)}%`);
    for (const s of l.stages) {
      lines.push(`   [${s.space}]`);
      for (const op of s.ops) lines.push(`     ${op}`);
    }
  }
  return {
    totalMs,
    decodeMs: r.decode_ms,
    colorMs: r.color_ms,
    encodeMs: r.encode_ms,
    gradeLines: lines,
    clampedSamples: r.color.graded?.clamped_samples ?? 0,
    loss: r.loss,
    notes,
    colorSpace: r.color.space,
    layers
  };
}
class Session2 {
  constructor(key, row, info2, px2, recipe2, owner, file = info2, hdrMaster = null) {
    this.key = key;
    this.row = row;
    this.info = info2;
    this.px = px2;
    this.recipe = recipe2;
    this.owner = owner;
    this.file = file;
    this.hdrMaster = hdrMaster;
    this.dir = rendersDir(row.id);
    void this.clearEarlier();
  }
  key;
  row;
  info;
  px;
  recipe;
  owner;
  file;
  hdrMaster;
  seq = 0;
  /**
   * The renderer's number for the recipe last received: every render says
   * which recipe it was made from, so the loupe's own preview knows when
   * the engine has caught up with it.
   */
  rev = 0;
  view = { cropMode: false, before: false, maskLayer: null, targetEdge: 2560 };
  inflight = false;
  /** What is rendering, and how to stop it. */
  inflightKind = null;
  abort = null;
  /** The 1:1 region being rendered: a newer one stops it. */
  regionAbort = null;
  pending = null;
  /** The render running now, or the last one. */
  current = Promise.resolve();
  settle;
  save;
  /**
   * Picture, mask and headroom files: each render its own name, so an event
   * kept for re-sending (or the picture pickers measure) still finds what it
   * was made as. The newest few of each are kept, and any one still named.
   */
  tag = Date.now().toString(36);
  fileSeq = 0;
  files = {};
  lastOut = { draft: "", full: "" };
  lastMaskOut = "";
  regionSlot = 0;
  /** Full HDR 1:1 tiles sent as frames, numbered: each its own frame id. */
  tileSeq = 0;
  beforeKey = "";
  /**
   * What each kind of picture was last rendered from, and the event sent for
   * it. An edit that compiles to the same engine request (a straighten while
   * the crop tool shows the unrotated frame, a slider dragged back to where
   * it was) re-sends the last event instead of rendering again, so the loupe
   * keeps its image and nothing downstream reloads.
   */
  lastSig = { draft: "", full: "" };
  lastEvent = { draft: null, full: null };
  maskSig = "";
  /** The last mask event sent: re-sent (with the current seq and rev) when nothing changed. */
  lastMask = null;
  /** Per layer, what its thumbnail was last rendered from. */
  thumbSig = {};
  dir;
  closed = false;
  /** How a PQ/HLG source is graded and measured: 1.0 is 203-nit reference white. */
  get hdrWorking() {
    return hdrWorkingOf(this.info);
  }
  /** An earlier session's picture files: nothing names them now. */
  async clearEarlier() {
    for (const name of await promises.readdir(this.dir).catch(() => [])) {
      if (/^(view|mask|headroom|look)-/.test(name) && !name.includes(`-${this.tag}-`))
        await promises.rm(path.join(this.dir, name), { force: true }).catch(() => void 0);
    }
  }
  get isRaw() {
    return this.row.is_raw === 1;
  }
  /**
   * Compile a recipe for a source. A source from the prepared set already
   * carries the lens correction and the spots: the engine is not asked to do
   * those again. `smoothing` false for a draft: the Smoothing slider's work
   * waits for the settled render (engine 0.18: on release, not while dragging).
   */
  async compileFor(recipe2, source2, applyCrop, headroom = false, smoothing = true, hdrOut = false) {
    const baked = this.isBaked(source2);
    const px2 = baked ? this.lensed.px : this.basePx();
    const { user } = pixlfile.orientedFrame(recipe2, px2.frameWidth, px2.frameHeight);
    const compiled = pixlfile.compile(recipe2, {
      isRaw: this.isRaw,
      asShot: this.info.as_shot_white,
      sourceOrientation: "Normal",
      frameWidth: px2.frameWidth,
      frameHeight: px2.frameHeight,
      scale: source2.width / px2.frameWidth,
      seed: source$1.seedOf(this.row),
      brushPaths: await brushPlanes(this.row.id, recipe2, user),
      applyCrop,
      // HDR only where the request's pipeline has room above white (Preserve
      // with the HDR working space: masks, the headroom plane, HDR stats). A
      // picture for the screen is tone mapped to SDR first and graded after,
      // its values stopping at 1, so it compiles as SDR (a curve carried past
      // 1 there is refused).
      hdr: headroom && this.info.is_hdr || hdrOut,
      showTransform: !this.view.guides,
      smoothing
    });
    return baked ? { ...compiled, lens: null, retouch: null } : compiled;
  }
  /** Whether a source is one of the prepared set's (lens and spots baked in). */
  isBaked(source2) {
    const px2 = this.lensed?.px;
    return !!px2 && (source2 === px2.proxy || source2 === px2.mid || source2 === px2.draft);
  }
  /** Whether a source is the plain photo's (no pixel step laid on). */
  isPlain(source2) {
    return source2 === this.px.proxy || source2 === this.px.mid || source2 === this.px.draft;
  }
  // ── pixel steps (shared/pixels.ts, pixels/working.ts) ──
  /** The working set for the recipe's pixel steps, once made (or the last, while the next is). */
  working = null;
  /** A pixel step being made: its draft, shown in its place until the step lands. */
  preview = null;
  /** The working pixels being made for the recipe's steps (resolved once they are). */
  workingJob = Promise.resolve();
  stepsKey(recipe2) {
    return workingKey(source$1.versionStamp(this.row), recipe2.pixels);
  }
  /**
   * The proxies everything else starts from: a step being made's preview,
   * the working pixels (the recipe's steps laid on), or the plain photo.
   */
  basePx() {
    if (this.preview) return this.preview;
    if (this.recipe.pixels.length === 0) return this.px;
    return this.working?.px ?? this.px;
  }
  /**
   * Make the working pixels for the recipe's steps (the proxies; the
   * full-resolution master waits for a 1:1 view or an export), then render
   * again from them. Steps undone or hidden find theirs already made.
   */
  async refreshWorking() {
    const key = this.stepsKey(this.recipe);
    if (this.working?.key === key) return;
    if (this.recipe.pixels.length === 0) {
      const was = this.frameSize();
      this.working = null;
      this.frameChanged(was);
      this.schedule("full");
      return;
    }
    try {
      const set = await ensureWorking(
        pixelDeps(this.owner.bgEngine, this.owner.library.index, this.row),
        source$1.versionStamp(this.row),
        this.px,
        this.recipe.pixels,
        null
      );
      if (this.closed || this.stepsKey(this.recipe) !== set.key) return;
      const was = this.frameSize();
      this.working = set;
      this.frameChanged(was);
      this.schedule("full");
    } catch (err) {
      log.warn("working pixels failed", err.message);
      this.owner.send(index$1.IPC.develop.renderError, {
        key: this.key,
        message: err.message,
        code: "Pixels"
      });
    }
  }
  /**
   * The full-resolution frame's size: the photo's, or (an upscale step in
   * the recipe) the steps'. What a 1:1 view and the renderer measure in.
   */
  frameSize() {
    const px2 = this.recipe.pixels.length > 0 ? this.working?.px ?? this.px : this.px;
    return { width: px2.frameWidth, height: px2.frameHeight };
  }
  /** The full-resolution working frame (the recipe's steps on the photo at full size): 1:1 and export. */
  async workingMaster() {
    if (this.recipe.pixels.length === 0) return null;
    const set = await ensureWorking(
      pixelDeps(this.owner.bgEngine, this.owner.library.index, this.row),
      source$1.versionStamp(this.row),
      this.px,
      this.recipe.pixels,
      () => ensureBase(this.owner.bgEngine, this.row, this.file, askOf(this.recipe))
    );
    return set.master;
  }
  /** An upscale step added or undone: the renderer measures in the new frame. */
  frameChanged(was) {
    const now = this.frameSize();
    if (now.width === was.width && now.height === was.height) return;
    this.owner.send(index$1.IPC.develop.frame, {
      key: this.key,
      frameWidth: now.width,
      frameHeight: now.height
    });
  }
  /** Show a pixel step's draft while it is made (null: back to the recipe's pixels). */
  showPreview(draft) {
    this.preview = draft ? { proxy: draft, draft, frameWidth: this.px.frameWidth, frameHeight: this.px.frameHeight } : null;
    this.schedule("full");
  }
  /** Resolves when the render running now (which may read a preview just cleared) has ended. */
  whenIdle() {
    return this.inflight ? this.current : Promise.resolve();
  }
  /**
   * What the prepared proxies hold for a recipe: its lens correction and
   * its spots, placed on the base frame (the proxy's own).
   */
  prepared(recipe$1) {
    return {
      base: this.basePx().proxy.path,
      lens: recipe.lensCorrection(recipe$1.lens),
      retouch: pixlfile.compileRetouch(
        recipe$1.retouch,
        "Normal",
        this.basePx().frameWidth,
        this.basePx().frameHeight
      )
    };
  }
  /** What names the prepared proxies a recipe needs: '' for none (the plain proxies serve). */
  /** The last `lensKey` asked for, by what it is made from (asked several times per update). */
  lensKeyMemo = null;
  lensKey(recipe2) {
    const base = this.basePx();
    const m = this.lensKeyMemo;
    if (m && m.lens === recipe2.lens && m.retouch === recipe2.retouch && m.base === base) return m.key;
    const key = this.lensKeyOf(recipe2);
    this.lensKeyMemo = { lens: recipe2.lens, retouch: recipe2.retouch, base, key };
    return key;
  }
  lensKeyOf(recipe$1) {
    const p = this.prepared(recipe$1);
    return p.lens || p.retouch ? recipe.hash32(JSON.stringify(p)).toString(16) : "";
  }
  /**
   * The proxies previews are graded from: the lens-corrected set when it is
   * the recipe's correction, else the plain one (the correction then runs
   * live, as while a lens slider moves).
   */
  viewPx() {
    const key = this.lensKey(this.recipe);
    return key && this.lensed?.key === key ? this.lensed.px : this.basePx();
  }
  /** A correction waiting for its corrected proxies (one whose bake failed is corrected live). */
  bakePending() {
    const key = this.lensKey(this.recipe);
    return key !== "" && this.lensed?.key !== key && key !== this.bakeFailed;
  }
  baking = null;
  /** The correction whose bake failed: not tried again this session. */
  bakeFailed = null;
  /**
   * Make the recipe's lens-corrected proxies in the background (once the
   * edit has settled), then render again from them. One at a time; a
   * correction changed meanwhile is baked next.
   */
  bake() {
    const key = this.lensKey(this.recipe);
    if (!key || this.lensed?.key === key || this.baking === key || this.bakeFailed === key) return;
    const { lens, retouch } = this.prepared(this.recipe);
    const base = this.basePx();
    this.baking = key;
    ensureLensedProxies(
      this.owner.bgEngine,
      this.row,
      base,
      lens,
      retouch,
      key,
      this.hdrWorking
    ).then(
      (px2) => {
        if (this.baking === key) this.baking = null;
        if (this.closed) return;
        if (this.lensKey(this.recipe) === key) {
          const before2 = this.lensed?.key;
          this.lensed = { key, px: px2 };
          this.schedule("full");
          void pruneLensed(this.row, this.key, key, before2);
        } else this.bake();
      },
      (err) => {
        if (this.baking === key) this.baking = null;
        log.warn("lens proxies failed; correcting live", err.message);
        this.bakeFailed = key;
        if (!this.closed && this.lensKey(this.recipe) === key) this.schedule("full");
      }
    );
  }
  update(next, interactive, rev) {
    const stepsWere = recipe.stackSignature(this.recipe.pixels);
    const recipe$1 = recipe.normaliseRecipe(next, this.isRaw);
    this.recipe = recipe$1;
    this.previewing = null;
    if (rev !== void 0) this.rev = rev;
    if (recipe.stackSignature(recipe$1.pixels) !== stepsWere) this.workingJob = this.refreshWorking();
    if (this.inflight && (this.inflightKind === "full" || !interactive)) this.abort?.abort();
    clearTimeout(this.save);
    this.save = setTimeout(() => this.persist(), SAVE_MS);
    this.schedule(interactive ? "draft" : "full");
  }
  /**
   * A recipe shown on the loupe and nothing more (a look hovered in the
   * rail): never saved, never the thumbnail, no mask, before or headroom
   * render made for it. Null goes back to the photo's own recipe, which a
   * moment ago was a settled picture and so comes back at once.
   */
  previewRecipe(next) {
    if (!next && !this.previewing) return;
    this.previewing = next ? recipe.normaliseRecipe(next, this.isRaw) : null;
    if (this.inflight) this.abort?.abort();
    this.schedule(next ? "draft" : "full");
  }
  /** Save the recipe now. The index answers in order, so what is asked of it next sees this. */
  persist() {
    clearTimeout(this.save);
    this.save = void 0;
    return this.owner.library.saveRecipe(this.key, this.recipe).then(
      () => this.thumbLater(),
      (err) => {
        log.error("saving recipe failed", err);
        this.owner.send(index$1.IPC.develop.renderError, {
          key: this.key,
          message: concepts.t("Edits to {{name}} were not saved: {{reason}}", {
            name: this.row.name,
            reason: err.message
          }),
          code: "Save"
        });
      }
    );
  }
  /** `recipe` was saved elsewhere (with a history step): a save of it still waiting is not needed. */
  saved(recipe2) {
    if (recipe2 !== this.recipe || !this.save) return;
    clearTimeout(this.save);
    this.save = void 0;
    this.thumbLater();
  }
  thumbTimer;
  /**
   * The thumbnail (and the project's preview) once editing pauses for a
   * while, or the photo closes: a full graded render on the background
   * engine is not made at every save.
   */
  thumbLater(now = false) {
    clearTimeout(this.thumbTimer);
    this.thumbTimer = void 0;
    const queue = () => {
      this.thumbTimer = void 0;
      const { photoId, copyId } = pixlfile.parseKey(this.key);
      const shown2 = this.fullPicture;
      const picture = shown2?.recipe === this.recipe ? shown2.picture : void 0;
      this.owner.library.queueThumb(photoId, copyId, true, picture);
    };
    if (now) return queue();
    this.thumbTimer = setTimeout(queue, THUMB_IDLE_MS);
  }
  /** Whether the view has been asked for yet: the first picture comes as a draft, at once. */
  viewed = false;
  setView(view) {
    this.view = view;
    if (!this.viewed) {
      this.viewed = true;
      return this.schedule("draft");
    }
    this.schedule("full");
  }
  schedule(kind) {
    clearTimeout(this.settle);
    if (kind === "draft") {
      const wait = this.source("full") === this.viewPx().proxy ? SETTLE_LARGE_MS : SETTLE_MS;
      this.settle = setTimeout(() => this.schedule("full"), wait);
    }
    if (this.inflight) {
      this.pending = this.pending === "full" || kind === "full" ? "full" : "draft";
      return;
    }
    this.current = this.run(kind);
  }
  async run(kind) {
    this.inflight = true;
    this.inflightKind = kind;
    const abort = new AbortController();
    this.abort = abort;
    const { signal } = abort;
    try {
      if (kind === "full") this.bake();
      await this.renderPicture(kind, signal);
      if (kind === "draft" && this.view.maskLive && this.view.maskLayer && !this.closed && !this.previewing)
        await this.renderMask("draft", signal);
      const extras = !this.closed && !this.pending && !this.bakePending() && !this.previewing;
      if (kind === "full" && extras) {
        if (this.view.maskLayer) await this.renderMask("full", signal);
        if (this.view.before) await this.renderBefore(signal);
        if (this.view.headroom) await this.renderHeadroom(signal);
        if (this.view.maskThumbs) await this.renderMaskThumbs(signal);
      }
    } catch (err) {
      if (isCancelled(err)) return;
      const e = err;
      log.warn("render failed", e.code, e.message);
      this.owner.send(index$1.IPC.develop.renderError, {
        key: this.key,
        message: e.message,
        code: e.code ?? "Unknown",
        field: e instanceof EngineError ? e.field : void 0,
        invariant: e instanceof EngineError ? e.invariant ?? void 0 : void 0
      });
    } finally {
      this.inflight = false;
      this.inflightKind = null;
      this.abort = null;
      const next = this.pending;
      this.pending = null;
      if (next && !this.closed) this.current = this.run(next);
    }
  }
  source(kind) {
    const px2 = this.viewPx();
    if (kind === "draft") return px2.draft;
    if (this.bakePending()) return px2.draft;
    const long = (f) => Math.max(f.width, f.height);
    if (this.view.targetEdge <= long(px2.draft)) return px2.draft;
    if (px2.mid && this.view.targetEdge * MID_SHORTFALL <= long(px2.mid)) return px2.mid;
    return px2.proxy;
  }
  nextFile(stem, ext) {
    const out = path.join(this.dir, `${stem}-${this.tag}-${++this.fileSeq}.${ext}`);
    const list = [...this.files[stem] ?? [], out];
    const held2 = /* @__PURE__ */ new Set([
      this.lastOut.draft,
      this.lastOut.full,
      this.lastFull,
      this.lastMaskOut,
      ...[...this.recentFull.values()].map((r) => r.out)
    ]);
    const drop = new Set(list.slice(0, -6).filter((f) => !held2.has(f)));
    this.files[stem] = list.filter((f) => !drop.has(f));
    for (const f of drop) void promises.rm(f, { force: true }).catch(() => void 0);
    return out;
  }
  async renderPicture(kind, signal) {
    const t0 = performance.now();
    const src = this.source(kind);
    const cropMode = this.view.cropMode;
    const rev = this.rev;
    const preview2 = this.previewing;
    const recipe$1 = preview2 ?? this.recipe;
    const display = this.view.display ?? null;
    const compiled = await this.compileFor(
      recipe$1,
      src,
      !cropMode,
      false,
      kind !== "draft",
      display !== null
    );
    const seq = ++this.seq;
    const whole = kind === "full" && !cropMode && !preview2 && !pixlfile.framingTransparent(compiled.framing);
    const sig = String(
      recipe.hash32(
        pixlfile.gradeKey([
          src.path,
          cropMode,
          display,
          compiled.grade,
          compiled.framing,
          compiled.lens,
          compiled.retouch
        ])
      )
    );
    const known = kind === "full" ? this.recentFull.get(sig) : void 0;
    const last2 = known?.event ?? (sig === this.lastSig[kind] ? this.lastEvent[kind] : null);
    if (last2) {
      if (known) {
        this.lastFull = known.out;
        this.lastSig.full = sig;
        this.lastEvent.full = known.event;
        this.lastOut.full = known.out;
      }
      const shown2 = display ? this.lastCompanion : { path: this.lastFull, width: last2.width, height: last2.height };
      if (whole && shown2) this.fullPicture = { recipe: recipe$1, picture: shown2 };
      if (!this.closed) this.owner.send(index$1.IPC.develop.rendered, { ...last2, seq, rev });
      return;
    }
    const alpha = pixlfile.framingTransparent(compiled.framing);
    const avif = display !== null && kind === "full" && !alpha && SETTLED_ARM === "avif";
    const frame = kind === "draft" || display && !avif ? `${this.tag}-${seq}` : void 0;
    const out = frame ? "" : this.nextFile("view", avif ? "avif" : alpha ? "png" : "jpg");
    const hdrStats = kind === "full" ? this.measureHdr(cropMode, signal) : Promise.resolve(void 0);
    const report = await this.owner.engine.convert(
      {
        ...source$1.blankRequest(src.path, out, src.input),
        ...frame ? { sink: "Bytes" } : {},
        pixel: {
          depth: display && frame ? "F32" : "Eight",
          channels: alpha || frame ? 4 : 3
        },
        encode: frame ? { Pixels: { sample: display ? "F16" : "U8" } } : avif ? SETTLED_AVIF : alpha ? { Png: { compression: "Fast", filter: "Sub" } } : {
          // A settled picture is a few MB less as 4:2:0, which a screen
          // shows the same; the draft keeps full chroma at its lower quality.
          Jpeg: {
            quality: kind === "draft" ? 92 : 95,
            subsampling: kind === "draft" ? "None" : "Quarter",
            optimize: false
          }
        },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: display ? masterFor(
          display,
          void 0,
          kind === "draft" ? DRAFT_COMPANION_EDGE : COMPANION_EDGE
        ) : source$1.displayPolicy(this.info, "DisplayP3"),
        // The master reads a gain map itself, and refuses the field.
        ...display ? { gain_map: null } : {},
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        threads: source$1.interactiveThreads(),
        // A warp shown whole counts its empty corners (as black) rather than
        // risk measuring nothing when little of the picture is left.
        measure: measureOf(kind === "draft" ? 2 : 1)
      },
      { signal, frame }
    ).catch(named(compiled));
    if (frame && report.output)
      this.owner.send(index$1.IPC.develop.previewFrame, {
        frame,
        width: report.width,
        height: report.height,
        data: report.output,
        sample: display ? "F16" : "U8",
        ...report.companion ? { companion: companionOf(report.companion) } : {}
      });
    const stats = statsOf(report);
    let readUrl;
    if (kind === "full" && display) {
      const m = report.color.master;
      this.hdrFigures = m && m.gamut ? { peakNits: m.peak_nits, reach: m.gamut.reach } : this.hdrFigures;
      const c = report.companion;
      if (c) {
        const file = this.nextFile("companion", "png");
        await writeCompanion(file, c.data, c.width, c.height);
        this.lastFull = file;
        readUrl = cacheUrl(file, seq);
        this.lastCompanion = { path: file, width: c.width, height: c.height };
        if (!preview2) this.fullPicture = whole ? { recipe: recipe$1, picture: this.lastCompanion } : null;
      } else {
        this.lastFull = "";
        this.lastCompanion = null;
      }
    } else if (kind === "full" && out) {
      this.lastFull = out;
      if (!preview2)
        this.fullPicture = whole ? { recipe: recipe$1, picture: { path: out, width: report.width, height: report.height } } : null;
    }
    const hdr = await hdrStats;
    if (this.closed) return;
    const event = {
      key: this.key,
      seq,
      rev,
      kind,
      cropMode,
      url: frame ? `frame:${frame}` : cacheUrl(out, seq),
      ...readUrl ? { readUrl } : {},
      width: report.width,
      height: report.height,
      stats,
      hdrStats: hdr,
      ...display && report.color.master?.display ? { ceiling: report.color.master.display.headroom } : {},
      report: reportOf(
        report,
        Math.round(performance.now() - t0),
        compiled.notes,
        compiled.layerIndex
      )
    };
    this.lastSig[kind] = sig;
    this.lastEvent[kind] = event;
    this.lastOut[kind] = out;
    if (kind === "full" && out && !display) {
      this.recentFull.delete(sig);
      this.recentFull.set(sig, { event, out });
      while (this.recentFull.size > RECENT_FULL)
        this.recentFull.delete(this.recentFull.keys().next().value);
    }
    this.owner.send(index$1.IPC.develop.rendered, event);
  }
  /**
   * For a PQ/HLG photo, the graded draft kept HDR (as an HDR export would
   * hold it) and measured in linear light, so the histogram can show the
   * highlights above reference white. Runs beside the preview; a failure
   * only loses the HDR histogram.
   */
  async measureHdr(cropMode, signal) {
    const hdr = this.hdrWorking;
    if (!hdr) return void 0;
    try {
      const src = this.viewPx().draft;
      const compiled = await this.compileFor(this.recipe, src, !cropMode, true);
      const out = path.join(this.dir, "hdr-stats.tiff");
      const bins = 4096;
      const request = {
        ...source$1.blankRequest(src.path, out, src.input),
        pixel: { depth: "Sixteen", channels: pixlfile.framingTransparent(compiled.framing) ? 4 : 3 },
        encode: { Tiff: { compression: "None" } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: "Preserve",
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        threads: source$1.interactiveThreads()
      };
      const floatWork = compiled.grade !== null || compiled.lens !== null || compiled.retouch !== null || pixlfile.framingWarps(compiled.framing);
      if (floatWork) {
        const r = await this.owner.engine.convert(
          { ...request, hdr, measure: { ...measureOf(1), domain: "Linear", bins } },
          { signal }
        ).catch(named(compiled));
        return statsOf(r);
      }
      await this.owner.engine.convert(request, { signal }).catch(named(compiled));
      return await this.owner.engine.analyze(
        { ...analyzeRequest(out, "Tiff", 1), domain: "Linear", bins, hdr: hdrSignalOf(hdr) },
        { signal }
      );
    } catch (err) {
      if (!isCancelled(err)) log.info("HDR histogram unavailable", err.message);
      return void 0;
    }
  }
  /**
   * Where an HDR picture rises above its white, as the engine measures it on
   * the pixels an HDR export would hold: a grey plane, 0 at and below white,
   * 1 at the working peak (`stops` above white). The loupe colours it.
   */
  async renderHeadroom(signal) {
    const hdr = this.hdrWorking;
    if (!hdr) return;
    const src = this.source("full");
    const compiled = await this.compileFor(this.recipe, src, !this.view.cropMode, true);
    if (pixlfile.framingTransparent(compiled.framing)) return;
    const display = this.view.display ?? null;
    const stops = Math.max(
      0.5,
      Math.log2(
        display ? display.peakNits / display.whiteNits : hdr.peak_nits / hdr.reference_white_nits
      )
    );
    const out = this.nextFile("headroom", "png");
    try {
      const r = await this.owner.engine.convert(
        {
          ...source$1.blankRequest(src.path, out, src.input),
          pixel: { depth: "Eight", channels: 1 },
          encode: { Png: { compression: "Fast", filter: "Sub" } },
          metadata: source$1.STRIP_ALL,
          color: "Preserve",
          hdr,
          grade: compiled.grade,
          framing: compiled.framing,
          lens: compiled.lens,
          retouch: compiled.retouch,
          inspect: { Headroom: { stops } },
          threads: source$1.interactiveThreads()
        },
        { signal }
      ).catch(named(compiled));
      if (this.closed) return;
      this.owner.send(index$1.IPC.develop.rendered, {
        key: this.key,
        seq: this.seq,
        kind: "headroom",
        cropMode: this.view.cropMode,
        url: cacheUrl(out, `${Date.now()}`),
        width: r.width,
        height: r.height,
        stops
      });
    } catch (err) {
      if (isCancelled(err)) throw err;
      log.info("headroom overlay unavailable", err.message);
    }
  }
  /**
   * The chosen layer's mask as a grey plane, and the picture measured inside
   * it. A draft (while a range slider moves) is the draft proxy's plane with
   * no measuring, so the overlay keeps up; the settled one follows. The same
   * plane again re-sends its event, stamped with the current recipe, so the
   * loupe's preview knows the engine agrees with it.
   */
  /** The last picture `measureMask` measured through the plane. */
  maskStatsFor = null;
  /**
   * The picture the renderer shows (the last full render) measured through a
   * plane. `weights` is an engine feature that may be missing from an older
   * build: the overlay still shows without it.
   */
  async measureMask(plane, signal) {
    if (!this.lastFull) return void 0;
    try {
      return await this.owner.engine.analyze(
        {
          ...analyzeRequest(this.lastFull, this.lastFull.endsWith(".png") ? "Png" : "Jpeg", 1),
          weights: { source: { Png: plane }, resampler: "Bilinear" }
        },
        { signal }
      );
    } catch (err) {
      if (isCancelled(err)) throw err;
      log.info("masked analysis unavailable", err.message);
      return void 0;
    }
  }
  async renderMask(kind, signal) {
    const src = kind === "draft" ? this.viewPx().draft : this.source("full");
    const rev = this.rev;
    const compiled = await this.compileFor(
      this.recipe,
      src,
      !this.view.cropMode,
      true,
      kind !== "draft"
    );
    const layerId = this.view.maskLayer ?? void 0;
    const index2 = layerId ? compiled.layerIndex[layerId] : void 0;
    const send2 = (e) => {
      if (this.closed) return;
      this.lastMask = { key: this.key, seq: this.seq, rev, kind: "mask", layerId, ...e };
      this.owner.send(index$1.IPC.develop.rendered, this.lastMask);
    };
    if (index2 === void 0 || !compiled.grade || pixlfile.framingTransparent(compiled.framing)) {
      this.maskSig = EMPTY;
      send2({ cropMode: this.view.cropMode, url: "", width: 0, height: 0 });
      return;
    }
    const measure = kind === "full";
    const layer = compiled.grade.layers[index2];
    const keyed = layer.mask?.components.some((c) => "Range" in c.shape) ?? false;
    const sig = String(
      recipe.hash32(
        pixlfile.gradeKey([
          src.path,
          layerId,
          index2,
          layer.mask,
          keyed ? compiled.grade.layers.slice(0, index2) : null,
          compiled.framing,
          compiled.lens,
          compiled.retouch
        ])
      )
    );
    const statsFor = measure ? this.lastFull : null;
    if (sig === this.maskSig && this.lastMask && this.lastMaskOut) {
      const restamp = { ...this.lastMask, seq: this.seq, rev };
      if (statsFor !== null && statsFor !== this.maskStatsFor) {
        const maskStats2 = await this.measureMask(this.lastMaskOut, signal);
        this.maskStatsFor = statsFor;
        restamp.maskStats = maskStats2;
      }
      if (!this.closed) {
        this.lastMask = restamp;
        this.owner.send(index$1.IPC.develop.rendered, this.lastMask);
      }
      return;
    }
    const out = this.nextFile("mask", "png");
    const report = await this.owner.engine.convert(
      {
        ...source$1.blankRequest(src.path, out, src.input),
        pixel: { depth: "Eight", channels: 1 },
        encode: { Png: { compression: "Fast", filter: "Sub" } },
        metadata: source$1.STRIP_ALL,
        color: "Preserve",
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        inspect: { LayerMask: { layer: index2 } },
        hdr: this.hdrWorking
      },
      { signal }
    ).catch(named(compiled));
    const maskStats = measure ? await this.measureMask(out, signal) : void 0;
    this.maskStatsFor = statsFor;
    this.maskSig = sig;
    this.lastMaskOut = out;
    send2({
      cropMode: this.view.cropMode,
      url: cacheUrl(out, `${this.seq}-m`),
      width: report.width,
      height: report.height,
      maskStats
    });
  }
  /**
   * Every local layer's mask, small, from the draft proxy: the masks panel's
   * thumbnails and the "show all" overlay. A thumbnail is redrawn only when
   * what shapes its mask changed (not its sliders), and the loop yields to a
   * newer edit waiting behind it. Always SDR, Full HDR or not: a mask is
   * shown by its shape, not its light.
   */
  async renderMaskThumbs(signal) {
    const src = this.viewPx().draft;
    const compiled = await this.compileFor(this.recipe, src, !this.view.cropMode, true);
    if (pixlfile.framingTransparent(compiled.framing)) return;
    const live = /* @__PURE__ */ new Set();
    for (const layer of this.recipe.layers) {
      live.add(layer.id);
      if (this.pending || this.closed) return;
      const index2 = compiled.grade ? compiled.layerIndex[layer.id] : void 0;
      if (index2 === void 0 || !compiled.grade) {
        if (this.thumbSig[layer.id] !== EMPTY) {
          this.thumbSig[layer.id] = EMPTY;
          this.owner.send(index$1.IPC.develop.rendered, {
            key: this.key,
            seq: this.seq,
            kind: "mask-thumb",
            layerId: layer.id,
            cropMode: this.view.cropMode,
            url: "",
            width: 0,
            height: 0
          });
        }
        continue;
      }
      const sig = String(
        recipe.hash32(
          pixlfile.gradeKey([
            src.path,
            layer.components,
            layer.invert,
            compiled.framing,
            compiled.lens,
            this.view.cropMode,
            // A range keys on the colours the layers before it make; its own
            // sliders and the layers after it do not move its plane.
            layer.components.some((c) => c.kind === "range") ? compiled.grade.layers.slice(0, index2) : null
          ])
        )
      );
      if (this.thumbSig[layer.id] === sig) continue;
      const out = path.join(this.dir, `mthumb-${layer.id}-${sig}.png`);
      const k = Math.min(1, MASK_THUMB_EDGE / Math.max(src.width, src.height));
      const report = await this.owner.engine.convert(
        {
          ...source$1.blankRequest(src.path, out, src.input),
          resize: k < 1 ? { Scale: { factor: k } } : "None",
          resampler: "Bilinear",
          pixel: { depth: "Eight", channels: 1 },
          encode: { Png: { compression: "Fast", filter: "Sub" } },
          metadata: source$1.STRIP_ALL,
          color: "Preserve",
          grade: compiled.grade,
          framing: compiled.framing,
          lens: compiled.lens,
          retouch: compiled.retouch,
          inspect: { LayerMask: { layer: index2 } },
          hdr: this.hdrWorking
        },
        { signal }
      ).catch(named(compiled));
      this.thumbSig[layer.id] = sig;
      if (this.closed) return;
      this.owner.send(index$1.IPC.develop.rendered, {
        key: this.key,
        seq: this.seq,
        kind: "mask-thumb",
        layerId: layer.id,
        cropMode: this.view.cropMode,
        url: cacheUrl(out, sig),
        width: report.width,
        height: report.height
      });
    }
    for (const id of Object.keys(this.thumbSig)) {
      if (live.has(id)) continue;
      delete this.thumbSig[id];
      if (!this.closed)
        this.owner.send(index$1.IPC.develop.rendered, {
          key: this.key,
          seq: this.seq,
          kind: "mask-thumb",
          layerId: id,
          cropMode: this.view.cropMode,
          url: "",
          width: 0,
          height: 0
        });
    }
  }
  /** The most recent full render's file: what the masked hue chart measures. */
  lastFull = "";
  /** The last settled Full HDR picture's SDR companion, as a file. */
  lastCompanion = null;
  /** The last settled Full HDR picture's peak and reach (`HdrFigures`). */
  hdrFigures = null;
  /** The last few settled pictures by signature, newest last (see RECENT_FULL). */
  recentFull = /* @__PURE__ */ new Map();
  /** A recipe shown instead of the photo's, not saved (see `previewRecipe`). */
  previewing = null;
  /** The last whole settled picture and the recipe it shows (see `thumbLater`). */
  fullPicture = null;
  /** The default recipe with the same framing: the "before", and the ghost bars. */
  async renderBefore(signal) {
    const before2 = recipe.defaultRecipe(this.isRaw);
    before2.geometry = structuredClone(this.recipe.geometry);
    before2.lens = { ...structuredClone(this.recipe.lens), defringe: before2.lens.defringe };
    before2.retouch = structuredClone(this.recipe.retouch);
    const view = this.source("full");
    const src = this.isPlain(view) || this.isBaked(view) && this.basePx() === this.px ? view : this.px.proxy;
    const display = this.view.display ?? null;
    const compiled = await this.compileFor(
      before2,
      src,
      !this.view.cropMode,
      false,
      true,
      display !== null
    );
    const key = JSON.stringify([
      compiled.framing,
      compiled.lens,
      compiled.retouch,
      src.path,
      this.view.cropMode,
      display
    ]);
    if (key === this.beforeKey) return;
    const alpha = pixlfile.framingTransparent(compiled.framing);
    const hdr = display && !alpha ? hdrFile(display) : null;
    const ext = hdr ? "avif" : alpha ? "png" : "jpg";
    const out = path.join(this.dir, `before-${recipe.hash32(key).toString(16)}.${ext}`);
    const report = await this.owner.engine.convert(
      {
        ...source$1.blankRequest(src.path, out, src.input),
        pixel: { depth: "Eight", channels: alpha ? 4 : 3 },
        encode: hdr ? hdr.encode : alpha ? { Png: { compression: "Fast", filter: "Sub" } } : { Jpeg: { quality: 95, subsampling: "None", optimize: false } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: hdr ? hdr.color : source$1.displayPolicy(this.info, "DisplayP3"),
        ...hdr ? { gain_map: null } : {},
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        measure: measureOf(1)
      },
      { signal }
    ).catch(named(compiled));
    const stats = statsOf(report);
    this.beforeKey = key;
    if (this.closed) return;
    this.owner.send(index$1.IPC.develop.rendered, {
      key: this.key,
      seq: this.seq,
      kind: "before",
      cropMode: this.view.cropMode,
      url: cacheUrl(out, recipe.hash32(key)),
      width: report.width,
      height: report.height,
      stats
    });
  }
  /**
   * The RAW master a 1:1 view reads: the plan's (DemosaicNet) once it is
   * made; until then a quick classic one (PPG, about 1.2 s) at once, the
   * plan's made in the background, and the window told to ask again when it
   * is (the engine's viewing guide, 2026-10-09).
   */
  async rawMasterForView() {
    const ask = askOf(this.recipe);
    const plan = await scenePlan(this.file.raw_cfa, ask);
    const plain = () => ensureMaster(this.owner.bgEngine, this.row, this.file, ask);
    if (plan.demosaic === "classic" || await masterCached(this.row, this.file, ask))
      return plain();
    const key = this.key;
    void plain().then(
      () => {
        if (!this.closed) this.owner.send(index$1.IPC.develop.tileStale, { key });
      },
      (err) => log.warn("RAW master for 1:1 not made", err.message)
    );
    return ensureQuickMaster(this.owner.bgEngine, this.row);
  }
  /** A 1:1 (or smaller) render of part of the full-resolution frame. */
  async region(req) {
    const t0 = performance.now();
    this.regionAbort?.abort();
    const abort = new AbortController();
    this.regionAbort = abort;
    const { signal } = abort;
    const tMaster = performance.now();
    const stepsMaster = await this.workingMaster();
    const raw2 = this.isRaw;
    const src = stepsMaster ? stepsMaster : this.hdrMaster ? this.hdrMaster : raw2 ? await this.rawMasterForView() : {
      path: this.row.path,
      input: this.info.input,
      width: this.px.frameWidth,
      height: this.px.frameHeight
    };
    const masterMs = Math.round(performance.now() - tMaster);
    const { user, width, height } = pixlfile.orientedFrame(this.recipe, src.width, src.height);
    const zoom = req.zoom >= 0.9999 ? 1 : Math.min(1, req.zoom);
    const figures = this.hdrFigures;
    const display = figures ? this.view.display ?? null : null;
    const hdr = display !== null && figures !== null;
    const compiled = pixlfile.compile(this.recipe, {
      isRaw: raw2,
      asShot: this.info.as_shot_white,
      sourceOrientation: raw2 || stepsMaster || this.hdrMaster ? "Normal" : source$1.sourceOrientation(this.info, null),
      frameWidth: src.width,
      frameHeight: src.height,
      scale: zoom,
      seed: source$1.seedOf(this.row),
      brushPaths: await brushPlanes(this.row.id, this.recipe, user),
      applyCrop: !this.view.cropMode,
      showTransform: !this.view.guides,
      // Tone mapped to SDR for the screen, as the picture is (see compileFor);
      // kept HDR for a Full HDR display.
      hdr: display !== null
    });
    const framed = await this.framedSize(compiled, width, height);
    const x = Math.max(0, Math.min(framed.width - 1, Math.floor(req.x * framed.width)));
    const y = Math.max(0, Math.min(framed.height - 1, Math.floor(req.y * framed.height)));
    const w = Math.max(1, Math.min(framed.width - x, Math.ceil(req.width * framed.width)));
    const h = Math.max(1, Math.min(framed.height - y, Math.ceil(req.height * framed.height)));
    this.regionSlot = (this.regionSlot + 1) % 4;
    const frame = hdr ? `${this.tag}-tile${++this.tileSeq}` : void 0;
    const out = frame ? "" : path.join(this.dir, `region-${this.regionSlot}.jpg`);
    const original = raw2 || stepsMaster || this.hdrMaster ? null : this.file;
    const request = {
      ...source$1.blankRequest(src.path, out, src.input, original),
      raw: null,
      ...frame ? { sink: "Bytes" } : {},
      resize: zoom < 1 ? { Scale: { factor: zoom } } : "None",
      pixel: frame ? { depth: "F32", channels: 4 } : { depth: "Eight", channels: 3 },
      encode: frame ? { Pixels: { sample: "F16" } } : { Jpeg: { quality: 95, subsampling: "None", optimize: false } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: frame && display && figures ? masterFor(display, figures, TILE_COMPANION_EDGE) : source$1.displayPolicy(this.info, "DisplayP3"),
      // The master reads a gain map itself, and refuses the field.
      ...hdr ? { gain_map: null } : {},
      grade: compiled.grade,
      framing: compiled.framing,
      lens: compiled.lens,
      retouch: compiled.retouch,
      region: { x, y, width: w, height: h, margin: 96 },
      // A Full HDR tile is resized inside the master's float pass, which the
      // engine allows only as a linear resample.
      ...hdr && zoom < 1 ? { linear_resample: true } : {}
    };
    const tConvert = performance.now();
    const report = await this.owner.engine.convert(request, { signal, frame }).catch(named(compiled));
    if (frame && report.output)
      this.owner.send(index$1.IPC.develop.previewFrame, {
        frame,
        width: report.width,
        height: report.height,
        data: report.output,
        sample: "F16",
        ...report.companion ? { companion: companionOf(report.companion) } : {}
      });
    traceRegion({
      step: "region",
      key: this.key,
      asked: req,
      // Where the region's pixels come from, and how long getting it took.
      source: stepsMaster ? "working master (pixel steps)" : this.hdrMaster ? "HDR master" : raw2 ? "RAW master" : "the original",
      masterMs,
      src,
      zoom: req.zoom,
      fullHdr: hdr,
      convertMs: Math.round(performance.now() - tConvert),
      totalMs: Math.round(performance.now() - t0),
      request,
      report: {
        width: report.width,
        height: report.height,
        input_bytes: report.input_bytes,
        output_bytes: report.output_bytes,
        decode_ms: report.decode_ms,
        resize_ms: report.resize_ms,
        color_ms: report.color_ms,
        ingest_ms: report.ingest_ms,
        egress_ms: report.egress_ms,
        encode_ms: report.encode_ms,
        region: report.region,
        frame_width: report.frame_width,
        frame_height: report.frame_height
      }
    });
    if (this.regionAbort === abort) this.regionAbort = null;
    return {
      url: frame ? `frame:${frame}` : cacheUrl(out, `${Date.now()}`),
      x: x / framed.width,
      y: y / framed.height,
      width: w / framed.width,
      height: h / framed.height,
      ms: Math.round(performance.now() - t0)
    };
  }
  /** Framed output sizes, by what decides them. */
  framedSizes = /* @__PURE__ */ new Map();
  /**
   * The size of a compiled render's output at full resolution, before any
   * resize: the oriented frame, its lens correction's crop, then the
   * framing's (straighten, Upright, crop). What a region's pixels are of.
   */
  async framedSize(c, width, height) {
    const key = JSON.stringify([c.lens, c.framing, width, height]);
    const had = this.framedSizes.get(key);
    if (had) return had;
    let w = width;
    let h = height;
    if (c.lens) {
      const f = await this.owner.engine.lensFrame(c.lens, width, height);
      w = f.frame.width;
      h = f.frame.height;
    }
    let size = { width: w, height: h };
    if (c.framing) {
      const r = await this.owner.engine.framingCrop({ ...c.framing, orientation: "Normal" }, w, h);
      size = { width: r.width, height: r.height };
    }
    if (this.framedSizes.size > 32) this.framedSizes.clear();
    this.framedSizes.set(key, size);
    return size;
  }
  /** Per lens correction and frame size, the shrink its crop makes (1 when none). */
  lensScale = /* @__PURE__ */ new Map();
  /** The recipe's lens correction baked into proxies (see `ensureLensedProxies`). */
  lensed = null;
  /**
   * A rectangle of the oriented frame (`width × height` pixels) as a region
   * of the lens-corrected one, which a correction's crop makes smaller at
   * the same shape: the same part of the picture, in its pixels.
   */
  async correctedRegion(lens, width, height, r, margin = 96) {
    let k = 1;
    if (lens) {
      const key = JSON.stringify([lens, width, height]);
      let cached = this.lensScale.get(key);
      if (cached === void 0) {
        const f = await this.owner.engine.lensFrame(lens, width, height);
        cached = f.frame.width / width;
        if (this.lensScale.size > 32) this.lensScale.clear();
        this.lensScale.set(key, cached);
      }
      k = cached;
    }
    const fw = Math.max(1, Math.floor(width * k));
    const fh = Math.max(1, Math.floor(height * k));
    const x = Math.max(0, Math.min(fw - 1, Math.floor(r.x * k)));
    const y = Math.max(0, Math.min(fh - 1, Math.floor(r.y * k)));
    return {
      x,
      y,
      width: Math.max(1, Math.min(fw - x, Math.round(r.w * k))),
      height: Math.max(1, Math.min(fh - y, Math.round(r.h * k))),
      margin
    };
  }
  /**
   * The source's colour (before any grade) at a point of the user-oriented,
   * uncropped frame (normalised), averaged over 5×5 proxy pixels, in linear
   * Rec.2020 — what the white balance runs on.
   */
  async sample(nx, ny) {
    const src = this.px.proxy;
    const { user, width, height } = pixlfile.orientedFrame(this.recipe, src.width, src.height);
    const lens = recipe.lensCorrection(this.recipe.lens);
    const at = await this.correctedRegion(
      lens,
      width,
      height,
      { x: Math.max(0, nx * width - 2), y: Math.max(0, ny * height - 2), w: 5, h: 5 },
      0
    );
    const linear = this.info.is_hdr ? {
      ToneMap: {
        to: "LinearSrgb",
        operator: "Clip",
        mode: "PerChannel",
        source_peak: { Nits: this.info.peak_nits ?? 1e3 },
        target_peak_nits: 203,
        gamut: "Clip",
        intent: "RelativeColorimetric",
        black_point_compensation: false
      }
    } : {
      ConvertTo: {
        to: "LinearSrgb",
        intent: "RelativeColorimetric",
        black_point_compensation: false
      }
    };
    const report = await this.owner.engine.convert({
      ...source$1.blankRequest(src.path, "", src.input),
      sink: "Bytes",
      pixel: { depth: "Sixteen", channels: 3 },
      encode: { Png: { compression: "Fast", filter: "NoFilter" } },
      metadata: source$1.STRIP_ALL,
      color: linear,
      framing: user === "Normal" ? null : { orientation: user, rotate_degrees: 0, rotate_resampler: "Lanczos3", crop: null },
      lens,
      region: at
    });
    if (!report.output) throw new Error("the engine returned no sample");
    const px2 = ops.pngToFloats(Buffer.from(report.output));
    const sum = [0, 0, 0];
    const n = px2.width * px2.height;
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += px2.data[i * px2.channels + c];
    const rgb2 = linearSrgbToRec2020([sum[0] / n, sum[1] / n, sum[2] / n]);
    const wb = await engineWbSliders(this.owner.engine, rgb2, this.isRaw, this.info.as_shot_white);
    return { linear: rgb2, wb };
  }
  /** Auto tone: measure the picture with the tone sliders at zero. */
  async autoTone() {
    const flat = structuredClone(this.recipe);
    flat.basic = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
    flat.layers = [];
    const src = this.viewPx().draft;
    const compiled = await this.compileFor(flat, src, true);
    const out = path.join(this.dir, "auto-tone.png");
    const report = await this.owner.engine.convert({
      ...source$1.blankRequest(src.path, out, src.input),
      pixel: { depth: "Eight", channels: 3 },
      encode: { Png: { compression: "Fast", filter: "Sub" } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: source$1.displayPolicy(this.info, "DisplayP3"),
      grade: compiled.grade,
      framing: compiled.framing,
      lens: compiled.lens,
      retouch: compiled.retouch,
      measure: measureOf(1)
    }).catch(named(compiled));
    return autoTone(statsOf(report));
  }
  /** Auto white balance, measured on the draft proxy (see `autowb.ts`). */
  autoWb() {
    return measureAutoWb(
      this.owner.engine,
      this.px.draft,
      this.dir,
      this.hdrWorking,
      this.isRaw,
      this.info.as_shot_white
    );
  }
  /**
   * Lateral chromatic aberration measured on the original at full size (the
   * shifts are fractions of a pixel), as the centred radial scale a lens
   * correction states — rotation- and flip-free, so the same numbers hold
   * for the previews and the export.
   */
  async measureCa() {
    const raw2 = this.isRaw ? source$1.rawDevelop(source$1.colourOf(this.row)) : null;
    const r = await this.owner.bgEngine.suggestLateralCa({
      source: { Path: this.row.path },
      input: this.file.input,
      raw: raw2,
      gain_map: source$1.gainMapOf(this.file),
      orientation: source$1.sourceOrientation(this.file, raw2),
      geometry: recipe.MANUAL_GEOMETRY,
      model: "Scale",
      // The source's own primaries: 0.16.0's fit, valid for every source.
      planes: "Frame",
      limits: source$1.READ_LIMITS,
      threads: source$1.BACKGROUND_THREADS
    });
    return {
      ca: r.lateral_ca,
      red: [r.red_before_px, r.red_after_px],
      blue: [r.blue_before_px, r.blue_after_px],
      points: r.red_points + r.blue_points
    };
  }
  /**
   * Upright: the photo's lines found and the transform a mode asks for, on
   * the large proxy as the loupe frames it (the user's turns, and the lens
   * correction, which comes first). A mode the lines cannot support fails
   * by name; the caller decides whether to try a lesser one.
   */
  async suggestUpright(mode, focal) {
    const src = this.px.proxy;
    const { user } = pixlfile.orientedFrame(this.recipe, src.width, src.height);
    const r = await this.owner.engine.suggestUpright({
      source: { Path: src.path },
      input: src.input,
      raw: null,
      gain_map: null,
      orientation: user,
      lens: recipe.lensCorrection(this.recipe.lens),
      mode,
      focal,
      limits: source$1.READ_LIMITS,
      threads: source$1.interactiveThreads()
    });
    this.usableUpright(r.transform, src.width, src.height);
    return r.transform;
  }
  /**
   * Whether a suggestion is one to keep: a few mis-fitted lines can ask for
   * a turn so steep the photo shrinks to a sliver (or past what the engine
   * will resample). Centred as the develop view keeps it, a quarter of the
   * frame must remain; otherwise it fails by name and Auto tries a lesser
   * mode.
   */
  usableUpright(tf, w, h) {
    const { width, height } = pixlfile.orientedFrame(this.recipe, w, h);
    const tooSteep = new Error(concepts.t("the lines ask for too strong a correction"));
    if (Math.abs(tf.vertical) > 40 || Math.abs(tf.horizontal) > 40) throw tooSteep;
    const centred = recipe.uprightTransform({ ...recipe.defaultUpright(), suggested: tf }, width, height);
    if (!centred) return;
    const kept = pixlfile.fitCrop({ x: 0, y: 0, width: 1, height: 1 }, 0, width, height, centred);
    if (kept.width * kept.height < 0.25) throw tooSteep;
  }
  /** Guided Upright: the transform that makes the guides (frame fractions) upright or level. */
  async uprightFromLines(lines, focal) {
    const { width, height } = pixlfile.orientedFrame(this.recipe, this.px.frameWidth, this.px.frameHeight);
    const tf = await this.owner.engine.uprightFromLines(lines, width, height, focal);
    this.usableUpright(tf, this.px.frameWidth, this.px.frameHeight);
    return tf;
  }
  /**
   * Where a heal or clone spot should copy from: the engine's search around
   * it on the large proxy, in the base frame (the proxy's own) after the
   * lens correction, as the spot is stored. Texture for a heal (the membrane
   * fixes the tone), difference for a clone (it keeps the source's tone).
   */
  async suggestHeal(points, radius, feather, kind) {
    const src = this.basePx().proxy;
    const r = await this.owner.bgEngine.suggestHealSource({
      source: { Path: src.path },
      input: src.input,
      raw: null,
      gain_map: null,
      orientation: "Normal",
      lens: recipe.lensCorrection(this.recipe.lens),
      shape: pixlfile.spotShape(points, radius),
      feather: pixlfile.featherOf({ feather, radius }),
      score: kind === "heal" ? "Texture" : "Difference",
      limits: source$1.READ_LIMITS,
      threads: source$1.BACKGROUND_THREADS
    });
    const at = points[0];
    return { x: at.x + r.source_offset.x, y: at.y + r.source_offset.y };
  }
  /**
   * Bake a heal, clone, fill or eye stroke into a pixel step (pixels/heal.ts),
   * on the photo with `steps` laid on (the recipe's, as the renderer has it,
   * strokes before this one included). Null when it changed nothing.
   */
  async bakeSpot(spot, layerId, steps) {
    const deps = pixelDeps(this.owner.bgEngine, this.owner.library.index, this.row);
    const set = await ensureWorking(
      deps,
      source$1.versionStamp(this.row),
      this.px,
      steps,
      () => ensureBase(this.owner.bgEngine, this.row, this.file, askOf(this.recipe))
    );
    const key = pixlfile.keyOf(this.row.id, null);
    const step = await bakeSpot(
      {
        deps,
        recipe: this.recipe,
        lens: recipe.lensCorrection(this.recipe.lens),
        photoId: this.row.id,
        isRaw: this.isRaw,
        asShot: this.info.as_shot_white,
        seed: source$1.seedOf(this.row),
        master: set.master,
        freeze: (recipe2, layerId2) => freezeMask(
          deps,
          {
            photoId: this.row.id,
            isRaw: this.isRaw,
            asShot: this.info.as_shot_white,
            seed: source$1.seedOf(this.row),
            master: set.master
          },
          recipe2,
          layerId2
        ),
        store: (file, info2) => this.owner.library.index.putBlob(key, file, info2)
      },
      spot,
      layerId
    );
    if (step && this.isRaw) step.params.develop = source$1.developMark(source$1.colourOf(this.row));
    if (step)
      void ensureWorking(
        deps,
        source$1.versionStamp(this.row),
        this.px,
        [...steps, step],
        () => ensureBase(this.owner.bgEngine, this.row, this.file, askOf(this.recipe))
      ).catch(() => void 0);
    return step;
  }
  /** The noise the denoiser would measure, on the full-resolution frame. */
  async noise() {
    const src = this.isRaw ? await ensureMaster(this.owner.bgEngine, this.row, this.file, askOf(this.recipe)) : { path: this.row.path, input: this.file.input };
    const s = await this.owner.bgEngine.analyze({
      ...analyzeRequest(src.path, "Png", 1),
      input: src.input,
      raw: null,
      gain_map: this.isRaw ? null : source$1.gainMapOf(this.file),
      noise: true,
      hue_bins: 1,
      bins: 16,
      percentiles: []
    });
    return s.noise;
  }
  // ── the Looks browser's cards (lookthumbs.ts) ──
  lookQueue = null;
  /** Cards made, by what they were made from: a look scrolled past and back costs nothing. */
  lookMade = /* @__PURE__ */ new Map();
  lookFiles = /* @__PURE__ */ new Map();
  lookEdge = LOOK_EDGE_DEFAULT;
  /**
   * The cards wanted now, in order (see `LookThumbQueue.request`). Always
   * SDR, Full HDR or not: small cards side by side compare looks, and a
   * strip of them glowing would outshine the photo.
   */
  lookThumbs(token, jobs, edge) {
    if (this.closed) return;
    this.lookEdge = Math.round(Math.max(LOOK_EDGE_MIN, Math.min(LOOK_EDGE_MAX, edge)));
    this.lookQueue ??= new LookThumbQueue(
      (job, signal) => this.makeLookThumb(job.recipe, signal),
      (tok, id, thumb) => this.owner.send(index$1.IPC.looks.thumb, {
        key: this.key,
        token: tok,
        id,
        ...thumb
      }),
      recipe.sameValue
    );
    this.lookQueue.request(token, jobs);
  }
  cancelLookThumbs() {
    this.lookQueue?.cancel();
  }
  /** One card: the draft proxy, graded with `recipe`, cropped, small, on the background engine. */
  async makeLookThumb(recipe$1, signal) {
    const src = this.viewPx().draft;
    const compiled = await this.compileFor(recipe$1, src, true);
    const edge = this.lookEdge;
    const sig = recipe.hash32(
      pixlfile.gradeKey([src.path, edge, compiled.grade, compiled.framing, compiled.lens, compiled.retouch])
    ).toString(16);
    const known = this.lookMade.get(sig);
    if (known) return known;
    const out = path.join(this.dir, `look-${this.tag}-${sig}.jpg`);
    const k = Math.min(1, edge / Math.max(src.width, src.height));
    const report = await this.owner.bgEngine.convert(
      {
        ...source$1.blankRequest(src.path, out, src.input),
        resize: k < 1 ? { Scale: { factor: k } } : "None",
        resampler: "Bilinear",
        pixel: { depth: "Eight", channels: 3 },
        encode: { Jpeg: { quality: 85, subsampling: "Quarter", optimize: false } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: source$1.displayPolicy(this.info, "DisplayP3"),
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        threads: source$1.BACKGROUND_THREADS
      },
      { signal }
    );
    const thumb = { url: cacheUrl(out, sig), width: report.width, height: report.height };
    this.lookMade.set(sig, thumb);
    this.lookFiles.set(sig, out);
    while (this.lookMade.size > LOOK_KEEP) {
      const oldest = this.lookMade.keys().next().value;
      this.lookMade.delete(oldest);
      const f = this.lookFiles.get(oldest);
      this.lookFiles.delete(oldest);
      if (f) void promises.rm(f, { force: true }).catch(() => void 0);
    }
    return thumb;
  }
  /** Stop, writing a pending edit; resolves once it is saved. */
  close() {
    this.closed = true;
    this.lookQueue?.close();
    for (const f of this.lookFiles.values()) void promises.rm(f, { force: true }).catch(() => void 0);
    clearTimeout(this.settle);
    this.abort?.abort();
    this.regionAbort?.abort();
    void pruneLensed(this.row, this.key, this.lensKey(this.recipe));
    void sweepPhoto(this.dir, index$1.paths.photoCache(this.row.id));
    const saved = (this.save ? this.persist() : Promise.resolve()).then(() => {
      if (this.thumbTimer) this.thumbLater(true);
    });
    return saved.then(
      () => this.owner.library.index.holdOpen(this.key, false).catch(() => void 0)
    );
  }
}
async function writeCompanion(file, data, w, h) {
  const own = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
  const px2 = own ? data : data.slice();
  try {
    await pixels.run({ op: "png8", data: px2, w, h, out: file }, [px2.buffer]);
  } catch (err) {
    if (px2.byteLength === 0) throw err;
    await promises.writeFile(file, ops.encodePng8(px2, w, h, 1, [ops.CICP_DISPLAY_P3]));
  }
}
class DevelopSessions {
  constructor(library, engine2, bgEngine2) {
    this.library = library;
    this.engine = engine2;
    this.bgEngine = bgEngine2;
  }
  library;
  engine;
  bgEngine;
  sessions = /* @__PURE__ */ new Map();
  /** Counts fresh opens: an open that finds a later one started makes no session. */
  opening = 0;
  /** The photo a fresh open is loading, until its session is made. */
  openingKey = null;
  send(channel, payload) {
    for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
  }
  get(key) {
    const s = this.sessions.get(key);
    if (!s) throw new Error(`photo ${key} is not open`);
    return s;
  }
  /** One photo at a time: closing the others writes their pending edits. */
  closeOthers(key) {
    for (const [k, s] of this.sessions) {
      if (k !== key) {
        void s.close();
        this.sessions.delete(k);
      }
    }
  }
  async open(key) {
    const fresh = !this.sessions.has(key);
    const token = fresh ? ++this.opening : this.opening;
    if (fresh) {
      this.openingKey = key;
      this.closeOthers(key);
    }
    let data = await this.library.index.openData(key);
    let row = await this.library.readable(data.row);
    let info2 = await this.library.probe(row, this.engine);
    if (data.row.is_raw === 1 && !data.row.raw_colour && row.raw_colour) {
      data = await this.library.index.openData(key);
      row = await this.library.readable(data.row);
      info2 = await this.library.probe(row, this.engine);
    }
    const { item, snapshots } = data;
    const recipe2 = await this.library.planes.hydrate(data.recipe);
    const hdr = editsHdr(recipe2, info2) ? await ensureHdrSource(this.engine, row, info2) : null;
    const graded = hdr?.info ?? info2;
    const px2 = hdr?.px ?? await ensureProxies(this.engine, row, info2);
    await promises.mkdir(rendersDir(row.id), { recursive: true });
    let session2 = this.sessions.get(key);
    if (!session2) {
      if (!fresh || token !== this.opening) throw new Error(`opening ${key} was superseded`);
      this.openingKey = null;
      this.closeOthers(key);
      session2 = new Session2(key, row, graded, px2, recipe2, this, info2, hdr?.master ?? null);
      this.sessions.set(key, session2);
      void this.library.index.holdOpen(key, true).catch(() => void 0);
      session2.workingJob = session2.refreshWorking();
      await session2.workingJob;
    }
    return {
      key,
      item,
      info: info2,
      isRaw: row.is_raw === 1,
      isHdr: graded.is_hdr,
      asShot: info2.as_shot_white,
      rawColour: row.is_raw === 1 ? source$1.resolveRawColour(row.raw_colour, info2) : null,
      cameraColour: row.is_raw === 1 && info2.camera_colour ? {
        make: info2.camera_colour.make,
        model: info2.camera_colour.model,
        pixlCamera: info2.camera_colour.pixl_camera,
        supported: source$1.pixlSupported(info2)
      } : null,
      // The working frame: an upscale step makes it larger than the file.
      frameWidth: session2.frameSize().width,
      frameHeight: session2.frameSize().height,
      proxyWidth: px2.proxy.width,
      proxyHeight: px2.proxy.height,
      recipe: session2.recipe,
      snapshots,
      seed: source$1.seedOf(row)
    };
  }
  close(key) {
    const s = this.sessions.get(key);
    if (!s) {
      if (key === this.openingKey) {
        ++this.opening;
        this.openingKey = null;
      }
      return Promise.resolve();
    }
    this.sessions.delete(key);
    return s.close();
  }
  closeAll() {
    return Promise.all([...this.sessions.keys()].map((k) => this.close(k))).then(() => void 0);
  }
  update(key, recipe2, interactive, rev) {
    this.get(key).update(recipe2, interactive, rev);
  }
  /** Show `recipe` on an open photo's loupe without making it the photo's (null: its own again). */
  preview(key, recipe2) {
    this.sessions.get(key)?.previewRecipe(recipe2);
  }
  /** What a white balance saved elsewhere converts into on this photo; null when it is not open. */
  wbContext(key) {
    const s = this.sessions.get(key);
    return s ? { isRaw: s.isRaw, asShot: s.info.as_shot_white } : null;
  }
  /** The Looks browser's cards for an open photo; a photo since closed is not asked. */
  lookThumbs(key, token, jobs, edge) {
    this.sessions.get(key)?.lookThumbs(token, jobs, edge);
  }
  cancelLookThumbs(key) {
    this.sessions.get(key)?.cancelLookThumbs();
  }
  view(key, view) {
    this.get(key).setView(view);
  }
  region(req) {
    const t0 = performance.now();
    return this.get(req.key).region(req).catch((err) => {
      traceRegion({
        step: "region failed",
        key: req.key,
        asked: req,
        zoom: req.zoom,
        ms: Math.round(performance.now() - t0),
        message: err?.message ?? String(err)
      });
      throw err;
    });
  }
  sample(key, x, y) {
    return this.get(key).sample(x, y);
  }
  autoTone(key) {
    return this.get(key).autoTone();
  }
  autoWb(key) {
    return this.get(key).autoWb();
  }
  noise(key) {
    return this.get(key).noise();
  }
  measureCa(key) {
    return this.get(key).measureCa();
  }
  /** What lens matching needs of an open photo: its lens, its camera and its frame. */
  async lensShot(key) {
    const session2 = this.get(key);
    const item = await this.library.item(key);
    return {
      lens: session2.file.lens ?? null,
      camera: item ? { make: item.camera.make, model: item.camera.model } : null,
      width: session2.px.frameWidth,
      height: session2.px.frameHeight
    };
  }
  /** A pixel step's draft shown on the photo while it is made (null when it is done or failed). */
  pixelPreview(key, draft) {
    this.sessions.get(key)?.showPreview(draft);
  }
  /** The preview gone, and no render still reading it: its file can be deleted. */
  async clearPreview(key) {
    const s = this.sessions.get(key);
    if (!s) return;
    s.showPreview(null);
    await s.whenIdle();
  }
  /** Resolves once an open photo's working pixels are made for its steps. */
  workingReady(key) {
    return this.sessions.get(key)?.workingJob ?? Promise.resolve();
  }
  bakeSpot(key, spot, layerId, steps) {
    return this.get(key).bakeSpot(spot, layerId, steps);
  }
  suggestHeal(key, points, radius, feather, kind) {
    return this.get(key).suggestHeal(points, radius, feather, kind);
  }
  suggestUpright(key, mode, focal) {
    return this.get(key).suggestUpright(mode, focal);
  }
  uprightFromLines(key, lines, focal) {
    return this.get(key).uprightFromLines(lines, focal);
  }
  /** The recipe an open session holds, which may be newer than the sidecar. */
  liveRecipe(key) {
    return this.sessions.get(key)?.recipe;
  }
  /** An open session's recipe was saved elsewhere: see `Session.saved`. */
  saved(key, recipe2) {
    this.sessions.get(key)?.saved(recipe2);
  }
  /** Save an open session's recipe now; resolves once it is saved. */
  flush(key) {
    return this.sessions.get(key)?.persist() ?? Promise.resolve();
  }
}
log.initialize();
log.transports.file.level = "info";
registerSchemePrivileges();
startCrashReporting();
const hidden = process.env["PLAYROOM_HIDDEN"] === "1";
const secondary = !hidden && !electron.app.requestSingleInstanceLock({ argv: process.argv });
if (secondary) electron.app.exit(0);
let mainWindow;
function focusWindow() {
  if (!mainWindow || hidden) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
const ARGV_SKIP = electron.app.isPackaged ? 1 : 2;
const APP_PATH = electron.app.isPackaged ? void 0 : electron.app.getAppPath();
electron.app.on("open-file", (e, path2) => {
  e.preventDefault();
  const p = index$1.openable(path2);
  if (p) index$1.queueOpen([p]);
  if (!electron.app.isReady() || secondary) return;
  if (!mainWindow) createWindow();
  else focusWindow();
});
electron.app.on("second-instance", (_e, argv, cwd, data) => {
  index$1.queueOpen(
    index$1.pathsFromArgv(data?.argv ?? argv, cwd, ARGV_SKIP, APP_PATH)
  );
  if (!electron.app.isReady()) return;
  if (!mainWindow) createWindow();
  else focusWindow();
});
if (!secondary) index$1.takeHandOff(electron.app.getPath("userData"));
index$1.queueOpen(index$1.pathsFromArgv(process.argv, process.cwd(), ARGV_SKIP, APP_PATH));
const engine = new EngineClient("interactive", 8);
const bgEngine = new EngineClient("background", 4, true);
const aiEngine = new EngineClient("ai", 4, true);
const selectEngine = new EngineClient("select", 4);
bgEngine.holdFor(engine);
aiEngine.holdFor(engine);
noteInstall();
const index = openIndex();
let sessions;
function createWindow() {
  const win2 = new electron.BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1e3,
    minHeight: 640,
    show: false,
    // The launch splash's black, so the window never flashes another colour first.
    backgroundColor: "#000000",
    // macOS: no title bar; the window's buttons sit in the top bar (its
    // drag region), centred in its 36 px.
    ...process.platform === "darwin" ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 11 } } : {},
    title: "Pixl Playroom",
    // macOS takes the bundle's .icns; elsewhere the window carries the mark.
    ...process.platform !== "darwin" ? { icon } : {},
    webPreferences: {
      preload: path.join(MAIN_DIR, "../preload/index.js"),
      // The preload needs nothing beyond contextBridge, ipcRenderer and webUtils.
      sandbox: true,
      backgroundThrottling: !hidden,
      // Automation renders offscreen: a hidden window stops painting after
      // its first frame, and nothing appears on the user's screen.
      offscreen: hidden
    }
  });
  mainWindow = win2;
  win2.on("ready-to-show", () => {
    if (!hidden) win2.show();
  });
  win2.webContents.on("did-start-loading", index$1.rendererGone);
  win2.webContents.on("did-finish-load", () => engine.sendPreviewsTo(win2.webContents));
  win2.on("closed", () => {
    index$1.rendererGone();
    if (mainWindow === win2) mainWindow = void 0;
  });
  win2.webContents.setWindowOpenHandler((details) => {
    if (externalAllowed(details.url)) void electron.shell.openExternal(details.url);
    else log.warn(`refused to open ${details.url}`);
    return { action: "deny" };
  });
  win2.webContents.on("will-navigate", (event, url2) => {
    if (url2 === win2.webContents.getURL()) return;
    event.preventDefault();
    if (externalAllowed(url2)) void electron.shell.openExternal(url2);
  });
  win2.webContents.on("will-attach-webview", (event) => event.preventDefault());
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    win2.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win2.loadFile(path.join(MAIN_DIR, "../renderer/index.html"));
  }
  index$1.watchDisplay(win2);
  void index.getSetting(DISPLAY_SETTING_KEY).catch(() => null).then((stored) => watchDisplayHdr(win2, stored));
}
function setAbout(engineVersion) {
  electron.app.setAboutPanelOptions({
    applicationName: "Pixl Playroom",
    applicationVersion: electron.app.getVersion(),
    credits: engineVersion ? `Powered by PIXL Engine ${engineVersion}` : "Powered by PIXL Engine",
    copyright: "Copyright © 2026 Syed Ali (PIXL Foundation)",
    iconPath: icon
  });
}
function leaveForRelaunch() {
  index$1.handOffOpens(electron.app.getPath("userData"));
  electron.app.exit(0);
}
electron.app.whenReady().then(() => {
  if (secondary) return;
  if (index$1.settleScale()) return leaveForRelaunch();
  utils.electronApp.setAppUserModelId("com.xuckless.pixlplayroom");
  if (!electron.app.isPackaged) electron.app.dock?.setIcon(dockIcon);
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  registerProtocol();
  index.start();
  engine.start();
  setTimeout(() => bgEngine.ensureStarted(), 3e3);
  setTimeout(() => {
    void sweepEngineTemps(index$1.paths.cacheRoot()).then(
      (n) => n > 0 && log.info(`swept ${n} stale engine temp file(s)`),
      () => void 0
    );
  }, 3e4).unref();
  setTimeout(() => {
    void index.pruneThumbs(index$1.paths.thumbs()).then((n) => n > 0 && log.info(`pruned ${n} unused thumbnails`)).catch((err) => log.warn("pruning thumbnails failed", err));
  }, 2e4);
  void engine.whenStarted().then(() => setAbout(engine.getStatus().version));
  const planes = new PlaneStore(index);
  const library = new Library(index, bgEngine, planes);
  sessions = new DevelopSessions(library, engine, bgEngine);
  const embedder = new OriginalEmbedder(index, library, bgEngine);
  index.on((e) => {
    if (e.name === "project") embedder.request(e.key);
  });
  const models2 = new ModelStore(index, () => bgEngine.getStatus());
  const switches = new AiSwitchStore(index);
  const brain = new BrainStore(models2, switches);
  setInpainter(
    async () => await models2.installed(INPAINTER_MODEL) ? models2.ref(INPAINTER_MODEL) : null
  );
  setRawModels({
    installed: (id) => models2.installed(id),
    ref: (id, provider) => models2.ref(id, provider),
    withCpuFallback: (ids, make, signal) => models2.withCpuFallback(ids, make, signal),
    canRun: async () => {
      if (bgEngine.getStatus().status === "starting") {
        bgEngine.start();
        await bgEngine.whenStarted();
      }
      return bgEngine.getStatus().enhance === true;
    },
    fetch: (id) => void models2.autoFetch([id])
  });
  setTimeout(() => {
    void models2.prune().catch((err) => log.warn("model clean-up failed", err.message)).then(() => models2.autoFetch([DEMOSAIC_MODEL.Bayer]));
    void promises.rm(index$1.paths.legacyPreviews(), { recursive: true, force: true }).catch(() => void 0);
  }, 2e4).unref();
  const lenses = new LensProfileStore();
  void lenses.start();
  const exporter = new Exporter(library, sessions, bgEngine);
  const select = new SelectService(selectEngine, bgEngine, library, planes, models2, () => sessions);
  setBrushSnapper({
    key: (key, lens) => select.snapKey(key, lens),
    object: (key, lens, stroke) => select.objectUnder(key, lens, stroke)
  });
  const ai = new AiJobs(
    {
      prompt: new PromptRunner(select, models2),
      enhance: new EnhanceRunner(
        library,
        aiEngine,
        () => bgEngine.getStatus(),
        models2,
        index,
        () => sessions
      ),
      segment: new SegmentRunner(library, planes, aiEngine, models2, () => sessions),
      denoise: new DenoiseRunner(library, aiEngine, models2, index, () => sessions)
    },
    async (key) => (await library.photoRow(key)).name,
    (e) => applyMaskResult(e, { library, sessions, planes })
  );
  ai.gate = () => switches.enabled();
  const namer = new Namer(index, library, brain, switches);
  if (gemmaInBuild(electron.app.isPackaged)) namer.start();
  const cull = new CullMeasurer(index, library, bgEngine, aiEngine, models2, switches);
  cull.start();
  watchRest(
    [
      { engine },
      // Queued work finishes first: an export, a folder's thumbnails, a
      // batch of cull signals (asked for, or the idle one under way); then
      // the hosts rest instead of starting again for each next piece.
      { engine: bgEngine, busy: () => exporter.busy || library.busy || cull.busy },
      { engine: aiEngine, busy: () => ai.busy || cull.busy },
      { engine: selectEngine }
    ],
    () => engine.ensureStarted(),
    // Gemma's server goes too, unless it is naming (the namer stops it after).
    () => {
      if (!brain.isBusy()) void brain.stop();
    }
  );
  electron.app.on("will-quit", () => {
    namer.stop();
    cull.stop();
    brain.killNow();
  });
  process.on("exit", () => brain.killNow());
  registerIpc({
    namer,
    cull,
    index,
    embedder,
    planes,
    library,
    sessions,
    exporter,
    ai,
    engine,
    bgEngine,
    aiEngine,
    models: models2,
    lenses,
    select,
    switches,
    brain
  });
  index$1.onOpenPaths((paths2) => mainWindow?.webContents.send(index$1.IPC.app.openPaths, paths2));
  startLanguage();
  buildMenu();
  index$1.onRenderScale(buildMenu);
  onLanguage(buildMenu);
  createWindow();
  startPolicy();
  void setupUpdater().catch((err) => log.warn("updater setup failed", err));
  startLicence();
  startAccount();
  startGate();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
const QUIT_DRAIN_MS = 3e3;
let drained = false;
electron.app.on("before-quit", (e) => {
  if (drained) return;
  e.preventDefault();
  drained = true;
  const drain = Promise.all([
    (async () => {
      await sessions?.closeAll();
      await index.stop();
    })().catch((err) => log.warn("quit: draining the index failed", err)),
    // The exporter's perl processes.
    pixlfile.endExiftool().catch((err) => log.warn("quit: stopping exiftool failed", err))
  ]);
  let timer2;
  void Promise.race([drain, new Promise((r) => timer2 = setTimeout(r, QUIT_DRAIN_MS))]).then(
    () => {
      clearTimeout(timer2);
      engine.stop();
      bgEngine.stop();
      aiEngine.stop();
      selectEngine.stop();
      pixels.close();
      electron.app.quit();
    }
  );
});
