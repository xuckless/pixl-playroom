"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const log = require("electron-log/main");
const child_process = require("child_process");
const fs = require("fs");
const path = require("path");
const source = require("./chunks/source-CdsxFjqD.js");
require("./chunks/concepts-BqKJKtxp.js");
require("./chunks/recipe-CiIOoIr9.js");
require("os");
const IPC = {
  /** The native menus (shared/appmenu.ts). */
  menu: {
    /** renderer → main: the menu bar's menus, as they apply now */
    set: "menu:set",
    /** renderer → main: a right-click menu, at the pointer */
    popup: "menu:popup",
    /** main → renderer: the item chosen, by id */
    run: "menu:run",
    /** Windows: the menu bar's names, and one opened under its name in the top bar */
    top: "menu:top",
    openTop: "menu:open-top",
    /** main → renderer: the menu bar was made again (Windows reads its names again) */
    changed: "menu:changed"
  },
  app: {
    cpus: "app:cpus",
    engineStatus: "app:engine-status",
    getSetting: "app:get-setting",
    setSetting: "app:set-setting",
    reveal: "app:reveal",
    renderScale: "app:render-scale",
    /** The window's display as an HDR target (shared/hdrdisplay.ts). */
    displayHdr: "app:display-hdr",
    /** Preferences → Display: automatic, or a stated white and peak. */
    setDisplayHdr: "app:set-display-hdr",
    /** main → renderer: the display's HDR numbers moved */
    displayHdrChanged: "app:display-hdr-changed",
    restart: "app:restart",
    /** Paths the OS asked us to open (Open With, a second launch), taken once the renderer is up. */
    takeOpens: "app:take-opens",
    /** main → renderer: more paths to open */
    openPaths: "app:open-paths",
    /** main → renderer: the display or the rendering mode changed */
    renderScaleChanged: "app:render-scale-changed",
    /** main → renderer: the menu's Settings… was chosen */
    /** The language in force and the setting it comes from; Settings sets it. */
    language: "app:language",
    setLanguage: "app:set-language",
    /** main → renderer: the language changed */
    languageChanged: "app:language-changed",
    openPreferences: "app:open-preferences",
    /** main → renderer: the menu's Engine Report… was chosen */
    openEngineReport: "app:open-engine-report",
    /** main → renderer: Help → Report a Problem (Settings, at that section). */
    openReport: "app:open-report",
    /** An uncaught error in the renderer, for the log and (opted in) a crash report. */
    reportError: "app:report-error",
    /** A problem report the user wrote (Settings); answers the server's reference. */
    reportProblem: "app:report-problem",
    /** The bundled THIRD_PARTY_NOTICES.txt, opened in the system's text viewer. */
    openNotices: "app:open-notices",
    /** The bundled beta terms, opened in the system's text viewer. */
    openBetaTerms: "app:open-beta-terms",
    /** The release notes to show at launch (shared/releasenotes.ts), and that they were shown. */
    whatsNew: "app:whats-new",
    notesSeen: "app:notes-seen",
    /** The beta gate (shared/gate.ts): what stands in front of the window. */
    gate: "app:gate",
    /** main → renderer: the gate changed */
    gateChanged: "app:gate-changed"
  },
  updates: {
    getState: "updates:get-state",
    check: "updates:check",
    install: "updates:install",
    setChannel: "updates:set-channel",
    /** main → renderer: the update state changed */
    event: "updates:event"
  },
  prefs: {
    get: "prefs:get",
    setCrashReports: "prefs:set-crash-reports"
  },
  account: {
    status: "account:status",
    signIn: "account:sign-in",
    cancelSignIn: "account:cancel-sign-in",
    signOut: "account:sign-out",
    /** main → renderer: signed in or out, or a sign-in started or ended */
    changed: "account:changed"
  },
  licence: {
    status: "licence:status",
    /** Check now: ask the account for this device's access. */
    refresh: "licence:refresh",
    startTrial: "licence:start-trial",
    /** Free one of the account's devices (the device-limit list), by its id. */
    freeDevice: "licence:free-device",
    /** main → renderer: the licence changed */
    changed: "licence:changed"
  },
  library: {
    chooseFolder: "library:choose-folder",
    openFolder: "library:open-folder",
    /** A folder's subfolders (one level): the sidebar's folder tree. */
    subfolders: "library:subfolders",
    recentFolders: "library:recent-folders",
    /** Take a folder off the sidebar's list (nothing on disk changes). */
    forgetFolder: "library:forget-folder",
    setMeta: "library:set-meta",
    createCopy: "library:create-copy",
    deleteCopy: "library:delete-copy",
    applyRecipe: "library:apply-recipe",
    resetRecipe: "library:reset-recipe",
    /** Thumbnails of these keys first (they are on screen). */
    prioritize: "library:prioritize",
    /** main → renderer: a thumbnail (re)rendered */
    thumb: "library:thumb",
    hdr: "library:hdr",
    /** main → renderer: a photo's search words from its names (every copy shares them). */
    names: "library:names",
    /** main → renderer: the folder's items changed (new file, new copy) */
    changed: "library:changed",
    /** The items of any source: a folder, a collection, a keyword, the duplicates. */
    openSource: "library:open-source",
    /** Files → their folder and item keys (indexing the folder if new). */
    resolvePaths: "library:resolve-paths",
    projectInfo: "library:project-info",
    setMetadata: "library:set-metadata",
    keywordTree: "library:keyword-tree",
    collections: "library:collections",
    saveCollection: "library:save-collection",
    removeCollection: "library:remove-collection",
    /** Add or remove items of a manual collection. */
    collectionItems: "library:collection-items",
    exportCollections: "library:export-collections",
    importCollections: "library:import-collections",
    stack: "library:stack",
    unstack: "library:unstack",
    stackTop: "library:stack-top",
    autoStack: "library:auto-stack",
    duplicates: "library:duplicates",
    /** Measure and set each photo's own auto white balance. */
    autoWb: "library:auto-wb",
    /** Put white balances back (the undo of autoWb). */
    setWb: "library:set-wb",
    /** main → renderer: collections, keywords or metadata changed */
    sourcesChanged: "library:sources-changed"
  },
  develop: {
    open: "develop:open",
    /** A RAW's camera colour chosen (returns the one in force); the session is closed for the caller to reopen. */
    setRawColour: "develop:set-raw-colour",
    /** Make these photos' proxies ahead (the open one's neighbours in the filmstrip). */
    warm: "develop:warm",
    close: "develop:close",
    update: "develop:update",
    view: "develop:view",
    region: "develop:region",
    sample: "develop:sample",
    autoTone: "develop:auto-tone",
    autoWb: "develop:auto-wb",
    /** A painted plane (grey PNG, base64) into the plane store; its reference back. */
    putPlane: "develop:put-plane",
    getPlane: "develop:get-plane",
    saveSnapshots: "develop:save-snapshots",
    historyList: "develop:history-list",
    historyAppend: "develop:history-append",
    historyAmend: "develop:history-amend",
    preview: "develop:preview",
    /** main → renderer: the port preview frames arrive on, from the interactive engine */
    previewPort: "develop:preview-port",
    /** main → renderer: a preview frame main relays (when the engine had no port) */
    previewFrame: "develop:preview-frame",
    /** main → renderer: the 1:1 tile's source got better (the plan's RAW master after the quick one): ask again. */
    tileStale: "develop:tile-stale",
    historySetHidden: "develop:history-set-hidden",
    historyDelete: "develop:history-delete",
    noise: "develop:noise",
    /** Measure the photo's lateral chromatic aberration (Lens → Remove CA). */
    measureCa: "develop:measure-ca",
    /** Upright: a mode's suggestion measured on the photo, or the guides' transform. */
    suggestUpright: "develop:suggest-upright",
    uprightFromLines: "develop:upright-from-lines",
    /** Heal / clone: the best place to copy a spot from. */
    suggestHeal: "develop:suggest-heal",
    bakeSpot: "develop:bake-spot",
    /** AI Remove on the object clicked (SAM 2.1's mask as a stroke, MI-GAN fills it), baked. */
    removeObject: "develop:remove-object",
    /** Where the open photo's AI denoise stands. */
    /** main → renderer: a render finished */
    rendered: "develop:rendered",
    /** main → renderer: a render failed */
    renderError: "develop:render-error",
    /** The working frame changed size (an upscale step added or undone). */
    frame: "develop:frame"
  },
  presets: {
    list: "presets:list",
    save: "presets:save",
    remove: "presets:remove",
    importLut: "presets:import-lut",
    luts: "presets:luts"
  },
  looks: {
    /** The Looks browser's cards wanted now (`LookThumbRequest`). */
    thumbs: "looks:thumbs",
    /** The browser closed: stop making cards. */
    cancel: "looks:cancel",
    /** main → renderer: a card made (`LookThumbEvent`). */
    thumb: "looks:thumb",
    /** A smart look's model work, started (`LookRunRequest`). */
    run: "looks:run",
    /** Stop a run (by id), or every run on a photo (by key). */
    cancelRun: "looks:cancel-run",
    /** The user pointed at what a run asked for (`PickAnswer`). */
    answer: "looks:answer",
    /** main → renderer: how a run is going (`LookRunEvent`). */
    runEvent: "looks:run-event"
  },
  models: {
    list: "models:list",
    download: "models:download",
    cancel: "models:cancel",
    remove: "models:remove",
    /** Time the models on the CPU and the accelerator; keep the faster. */
    benchmark: "models:benchmark",
    provider: "models:provider",
    /** main → renderer: the models' state changed (a download's progress, one installed). */
    event: "models:event"
  },
  lens: {
    importProfiles: "lens:import-profiles",
    status: "lens:status",
    check: "lens:check",
    search: "lens:search",
    resolve: "lens:resolve",
    /** main → renderer: the catalogue or the imported profiles changed. */
    changed: "lens:changed"
  },
  export: {
    start: "export:start",
    cancel: "export:cancel",
    chooseFolder: "export:choose-folder",
    chooseWatermark: "export:choose-watermark",
    readWatermark: "export:read-watermark",
    presets: "export:presets",
    savePreset: "export:save-preset",
    removePreset: "export:remove-preset",
    /** One photo as the export would write it, for the dialog; and the checks the disk and the photos make. */
    preview: "export:preview",
    cancelPreview: "export:cancel-preview",
    check: "export:check",
    /** main → renderer */
    progress: "export:progress"
  },
  enhance: {
    rates: "enhance:rates"
  },
  ai: {
    start: "ai:start",
    cancel: "ai:cancel",
    list: "ai:list",
    capabilities: "ai:capabilities",
    /** main → renderer: a job's progress, its end and its result */
    event: "ai:event",
    /** The killswitch and the heavy models' switches (shared/heavy.ts). */
    switches: "ai:switches",
    setEnabled: "ai:set-enabled",
    setHeavy: "ai:set-heavy",
    /** A heavy model's sustained-load benchmark; resolves with its result. */
    benchmark: "ai:benchmark",
    /** main → renderer: the switches changed. */
    switchesEvent: "ai:switches-event",
    /** main → renderer: a benchmark's progress. */
    benchmarkProgress: "ai:benchmark-progress"
  },
  /** Gemma, the local assistant (main/ai/brain.ts). */
  brain: {
    status: "brain:status",
    download: "brain:download",
    cancel: "brain:cancel",
    remove: "brain:remove",
    /** main → renderer: its state changed. */
    event: "brain:event"
  },
  /** Cull suggestions (shared/cullsuggest.ts): the Library's suggested rejects. */
  cull: {
    suggestions: "cull:suggestions",
    keep: "cull:keep",
    /** Measure now what isn't yet (Suggested rejects shown). */
    measure: "cull:measure",
    /** main → renderer: signals or decisions changed. */
    event: "cull:event",
    /** main → renderer: `{ done, total }` of a measure-now. */
    progress: "cull:progress"
  },
  /** What Gemma named in a photo (shared/naming.ts): the Masks pane's chips. */
  names: {
    get: "names:get",
    /** Name the photo now (its Masks pane), idle or not. */
    name: "names:name",
    /** The user's own list: a chip taken off, a name typed. */
    edit: "names:edit",
    /** main → renderer: a photo's names changed. */
    event: "names:event"
  },
  /** Select by clicks, a box or strokes (SAM 2.1): main/select/service.ts. */
  select: {
    open: "select:open",
    decode: "select:decode",
    commit: "select:commit",
    close: "select:close"
  }
};
const made = /* @__PURE__ */ new Set();
function dir(...parts) {
  const p = path.join(electron.app.getPath("userData"), ...parts);
  if (!made.has(p)) {
    fs.mkdirSync(p, { recursive: true });
    made.add(p);
  }
  return p;
}
const paths = {
  // The index (playroom.db) is the index host's: see indexer/service.ts.
  /** The rendering mode and the last display's scale, read before the app is ready. */
  displayState: () => path.join(dir(), "display.json"),
  /** The update channel and crash-report consent, read before the app is ready (settings.ts). */
  settings: () => path.join(dir(), "settings.json"),
  /** Per-photo working files: proxies, renders, mask planes. */
  photoCache: (photoId) => dir("cache", "photos", String(photoId)),
  /**
   * The same folder's path, not made: for the paths every photo of a folder
   * asks for as it opens (the probe, the thumbnail's source), whose callers
   * make it themselves, off the main thread, only when they write (300
   * `mkdirSync` calls cost 170 ms of main's time opening a 300-photo folder).
   */
  photoCachePath: (photoId) => path.join(electron.app.getPath("userData"), "cache", "photos", String(photoId)),
  thumbs: () => dir("cache", "thumbs"),
  /**
   * Where 0.3's before/after kept edited photos' thumbnails from the engine
   * before 0.17: only removed now (the comparison went with engine 0.18).
   */
  legacyPreviews: () => path.join(electron.app.getPath("userData"), "cache", "legacy-previews"),
  luts: () => dir("luts"),
  /** Imported lens profiles, one JSON file per lens (`shared/lens.ts`). */
  lensProfiles: () => dir("lens-profiles"),
  /** The lens catalogue downloaded from the models server (`lensprofiles.ts`). */
  lensCatalog: () => dir("lens-profiles", "catalog"),
  /** The lens catalogue the app ships: beside its resources when packaged, in resources/ in a checkout. */
  bundledLensCatalog: () => electron.app.isPackaged ? path.join(process.resourcesPath, "lens-profiles") : path.join(electron.app.getAppPath(), "resources", "lens-profiles"),
  /** Downloaded AI models, `<id>/<version>/<files>` (see `ai/models.ts`). */
  models: () => dir("models"),
  cacheRoot: () => dir("cache"),
  /** THIRD_PARTY_NOTICES.txt: beside the app's resources when packaged, in build/ in a checkout. */
  notices: () => electron.app.isPackaged ? path.join(process.resourcesPath, "THIRD_PARTY_NOTICES.txt") : path.join(electron.app.getAppPath(), "build", "THIRD_PARTY_NOTICES.txt"),
  /** The beta terms the app ships (scripts/legal-copy.mjs), beside its resources or in build/legal/. */
  betaTerms: () => electron.app.isPackaged ? path.join(process.resourcesPath, "legal", "beta-terms.txt") : path.join(electron.app.getAppPath(), "build", "legal", "beta-terms.txt")
};
const PERFORMANCE_SCALE = 1.5;
const ULTRA_SCALE = 1;
const SWITCH = "force-device-scale-factor";
const mac = process.platform === "darwin";
let state = { mode: "performance", scale: null };
let forced = null;
let canRelaunch = false;
let current = null;
const listeners = [];
function read() {
  try {
    const s = JSON.parse(fs.readFileSync(paths.displayState(), "utf8"));
    return {
      mode: s.mode === "native" || s.mode === "ultra" ? s.mode : "performance",
      scale: typeof s.scale === "number" && s.scale > 0 ? s.scale : null
    };
  } catch {
    return { mode: "performance", scale: null };
  }
}
function write() {
  try {
    fs.writeFileSync(paths.displayState(), JSON.stringify(state));
  } catch (err) {
    log.warn("saving the display state failed", err);
  }
}
function scaleOf(mode, native) {
  if (!mac || native === null) return null;
  const s = mode === "ultra" ? ULTRA_SCALE : mode === "performance" ? PERFORMANCE_SCALE : null;
  return s !== null && native > s ? s : null;
}
function wanted(native) {
  return scaleOf(state.mode, native);
}
function relaunch() {
  const args = process.argv.slice(1).filter((a) => !a.startsWith(`--${SWITCH}`));
  const scale = wanted(current);
  if (scale !== null) args.push(`--${SWITCH}=${scale}`);
  electron.app.relaunch({ args });
}
function bootScale(opts) {
  if (!mac) return false;
  state = read();
  current = state.scale;
  const v = parseFloat(electron.app.commandLine.getSwitchValue(SWITCH));
  forced = v > 0 ? v : null;
  canRelaunch = opts.canRelaunch;
  if (!canRelaunch || forced !== null || wanted(current) === null) return false;
  relaunch();
  return true;
}
function settleScale() {
  if (!mac || state.scale !== null || forced !== null) return false;
  current = electron.screen.getPrimaryDisplay().scaleFactor;
  state.scale = current;
  write();
  if (!canRelaunch || wanted(current) === null) return false;
  relaunch();
  return true;
}
let probed = null;
const pair = (s) => {
  const m = typeof s === "string" ? /(\d+)\s*x\s*(\d+)/.exec(s) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
};
function parseProfile(json) {
  const out = [];
  try {
    const gpus = JSON.parse(json).SPDisplaysDataType;
    for (const gpu of gpus ?? []) {
      for (const d of gpu.spdisplays_ndrvs ?? []) {
        const points = pair(d["_spdisplays_resolution"]);
        const pixels = pair(d["_spdisplays_pixels"]) ?? points;
        if (!points || !pixels || points[0] === 0) continue;
        out.push({
          id: Number(d["_spdisplays_displayID"]),
          width: points[0],
          height: points[1],
          scale: Math.round(pixels[0] / points[0] * 100) / 100
        });
      }
    }
  } catch (err) {
    log.warn("reading the display profile failed", err);
  }
  return out;
}
function probe() {
  return new Promise(
    (resolve) => child_process.execFile(
      "system_profiler",
      ["SPDisplaysDataType", "-json"],
      (err, stdout) => resolve(err ? [] : parseProfile(stdout))
    )
  );
}
async function nativeScale(d) {
  if (forced === null) return d.scaleFactor;
  probed ??= probe();
  const all = await probed;
  const hit = all.find((p) => p.id === d.id) ?? all.find((p) => p.width === d.size.width && p.height === d.size.height);
  return hit?.scale ?? null;
}
function renderScale() {
  const w = wanted(current);
  return {
    available: scaleOf("ultra", current) !== null,
    modes: ["ultra", "performance", "native"].filter(
      (m) => m === "native" || scaleOf(m, current) !== null
    ),
    mode: state.mode,
    target: w,
    native: current,
    active: forced ?? current,
    restartNeeded: canRelaunch && w !== forced,
    canRestart: canRelaunch
  };
}
function publish() {
  const s = renderScale();
  for (const w of electron.BrowserWindow.getAllWindows()) w.webContents.send(IPC.app.renderScaleChanged, s);
  for (const l of listeners) l();
}
function onRenderScale(l) {
  listeners.push(l);
}
function setRenderMode(mode) {
  if (!mac || mode === state.mode) return;
  state.mode = mode;
  write();
  if (!canRelaunch && wanted(current) !== forced)
    log.info(
      `rendering: ${mode} applies from the next start` + (wanted(current) !== null ? ` (in dev: pnpm dev -- --${SWITCH}=${wanted(current)})` : "")
    );
  publish();
}
function restart() {
  if (!canRelaunch) return;
  relaunch();
  electron.app.quit();
}
async function locate(win) {
  if (win.isDestroyed()) return;
  const n = await nativeScale(electron.screen.getDisplayMatching(win.getBounds()));
  if (n === null || win.isDestroyed()) return;
  const changed = n !== current;
  current = n;
  if (n !== state.scale) {
    state.scale = n;
    write();
  }
  if (changed) publish();
}
function watchDisplay(win) {
  if (!mac) return;
  let t;
  const check = () => {
    clearTimeout(t);
    t = setTimeout(() => void locate(win), 400);
  };
  const reprobe = () => {
    probed = null;
    check();
  };
  const metrics = (_e, _d, changed) => {
    if (changed.includes("bounds") || changed.includes("scaleFactor")) reprobe();
  };
  win.on("moved", check);
  electron.screen.on("display-added", reprobe);
  electron.screen.on("display-removed", reprobe);
  electron.screen.on("display-metrics-changed", metrics);
  win.on("closed", () => {
    clearTimeout(t);
    electron.screen.off("display-added", reprobe);
    electron.screen.off("display-removed", reprobe);
    electron.screen.off("display-metrics-changed", metrics);
  });
  void locate(win);
}
const OPENABLE = /* @__PURE__ */ new Set([...source.IMAGE_EXTENSIONS, "pixl"]);
function pathsFromArgv(argv, cwd, skip, appPath) {
  const app = appPath ? path.resolve(appPath) : null;
  const out = [];
  for (const arg of argv.slice(skip)) {
    if (!arg || arg.startsWith("-")) continue;
    const full = path.resolve(cwd, arg);
    if (app && full === app) continue;
    const path$1 = openable(path.isAbsolute(arg) ? arg : full);
    if (path$1 && !out.includes(path$1)) out.push(path$1);
  }
  return out;
}
function openable(path$1) {
  try {
    const st = fs.statSync(path$1);
    if (st.isDirectory()) return path$1.endsWith(path.sep) ? path$1 : path$1 + path.sep;
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return OPENABLE.has(path.extname(path$1).slice(1).toLowerCase()) ? path$1 : null;
}
let queue = [];
let ready = false;
let deliver = null;
function onOpenPaths(send) {
  deliver = send;
}
function queueOpen(paths2) {
  if (paths2.length === 0) return;
  if (ready && deliver) deliver(paths2);
  else for (const p of paths2) if (!queue.includes(p)) queue.push(p);
}
function takeOpens() {
  ready = true;
  const paths2 = queue;
  queue = [];
  return paths2;
}
function rendererGone() {
  ready = false;
}
const HANDOFF = "pending-opens.json";
const HANDOFF_MS = 6e4;
function handOffOpens(dir2) {
  if (queue.length === 0) return;
  try {
    fs.writeFileSync(path.join(dir2, HANDOFF), JSON.stringify({ at: Date.now(), paths: queue }));
  } catch {
  }
}
function takeHandOff(dir2) {
  const file = path.join(dir2, HANDOFF);
  let left;
  try {
    left = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.rmSync(file, { force: true });
  } catch {
    return;
  }
  if (!Array.isArray(left.paths) || !(Date.now() - (left.at ?? 0) < HANDOFF_MS)) return;
  const paths2 = left.paths.filter((p) => typeof p === "string");
  queueOpen(paths2.map(openable).filter((p) => p !== null));
}
if (process.env["PLAYROOM_USER_DATA"]) electron.app.setPath("userData", process.env["PLAYROOM_USER_DATA"]);
const hidden = process.env["PLAYROOM_HIDDEN"] === "1";
if (bootScale({ canRelaunch: electron.app.isPackaged && !hidden })) {
  electron.app.on("open-file", (e, path2) => {
    e.preventDefault();
    const p = openable(path2);
    if (p) queueOpen([p]);
  });
  queueOpen(
    pathsFromArgv(
      process.argv,
      process.cwd(),
      electron.app.isPackaged ? 1 : 2,
      electron.app.isPackaged ? void 0 : electron.app.getAppPath()
    )
  );
  electron.app.once("ready", () => {
    handOffOpens(electron.app.getPath("userData"));
    electron.app.exit(0);
  });
} else {
  void Promise.resolve().then(() => require("./chunks/app-BG_ZvH2w.js"));
}
exports.IPC = IPC;
exports.PERFORMANCE_SCALE = PERFORMANCE_SCALE;
exports.ULTRA_SCALE = ULTRA_SCALE;
exports.handOffOpens = handOffOpens;
exports.onOpenPaths = onOpenPaths;
exports.onRenderScale = onRenderScale;
exports.openable = openable;
exports.paths = paths;
exports.pathsFromArgv = pathsFromArgv;
exports.queueOpen = queueOpen;
exports.renderScale = renderScale;
exports.rendererGone = rendererGone;
exports.restart = restart;
exports.setRenderMode = setRenderMode;
exports.settleScale = settleScale;
exports.takeHandOff = takeHandOff;
exports.takeOpens = takeOpens;
exports.watchDisplay = watchDisplay;
