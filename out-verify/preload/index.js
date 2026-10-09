"use strict";
const electron = require("electron");
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
async function call(channel, ...args) {
  const r = await electron.ipcRenderer.invoke(channel, ...args);
  if (r.ok) return r.value;
  const err = new Error(r.error.message);
  err.code = r.error.code;
  err.field = r.error.field;
  throw err;
}
function on(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  electron.ipcRenderer.on(channel, listener);
  return () => electron.ipcRenderer.removeListener(channel, listener);
}
const api = {
  menu: {
    set: (spec) => call(IPC.menu.set, spec),
    popup: (items) => call(IPC.menu.popup, items),
    onRun: (cb) => on(IPC.menu.run, cb),
    top: () => call(IPC.menu.top),
    openTop: (index, x, y) => call(IPC.menu.openTop, index, x, y),
    onChanged: (cb) => on(IPC.menu.changed, cb)
  },
  app: {
    cpus: () => call(IPC.app.cpus),
    engineStatus: () => call(IPC.app.engineStatus),
    getSetting: (key) => call(IPC.app.getSetting, key),
    setSetting: (key, value) => call(IPC.app.setSetting, key, value),
    reveal: (path) => call(IPC.app.reveal, path),
    renderScale: () => call(IPC.app.renderScale),
    displayHdr: () => call(IPC.app.displayHdr),
    setDisplayHdr: (setting) => call(IPC.app.setDisplayHdr, setting),
    onDisplayHdr: (cb) => on(IPC.app.displayHdrChanged, cb),
    restart: () => call(IPC.app.restart),
    onRenderScale: (cb) => on(IPC.app.renderScaleChanged, cb),
    takeOpens: () => call(IPC.app.takeOpens),
    onOpenPaths: (cb) => on(IPC.app.openPaths, cb),
    pathOf: (file) => electron.webUtils.getPathForFile(file),
    language: () => call(IPC.app.language),
    setLanguage: (setting) => call(IPC.app.setLanguage, setting),
    onLanguageChanged: (cb) => on(IPC.app.languageChanged, cb),
    onOpenPreferences: (cb) => on(IPC.app.openPreferences, cb),
    onOpenEngineReport: (cb) => on(IPC.app.openEngineReport, cb),
    onOpenReport: (cb) => on(IPC.app.openReport, cb),
    reportError: (e) => call(IPC.app.reportError, e),
    reportProblem: (r) => call(IPC.app.reportProblem, r),
    openNotices: () => call(IPC.app.openNotices),
    openBetaTerms: () => call(IPC.app.openBetaTerms),
    whatsNew: () => call(IPC.app.whatsNew),
    notesSeen: () => call(IPC.app.notesSeen),
    gate: () => call(IPC.app.gate),
    onGate: (cb) => on(IPC.app.gateChanged, cb)
  },
  updates: {
    getState: () => call(IPC.updates.getState),
    check: () => call(IPC.updates.check),
    install: () => call(IPC.updates.install),
    setChannel: (channel) => call(IPC.updates.setChannel, channel),
    onState: (cb) => on(IPC.updates.event, cb)
  },
  account: {
    status: () => call(IPC.account.status),
    signIn: () => call(IPC.account.signIn),
    cancelSignIn: () => call(IPC.account.cancelSignIn),
    signOut: () => call(IPC.account.signOut),
    onChange: (cb) => on(IPC.account.changed, cb)
  },
  licence: {
    status: () => call(IPC.licence.status),
    refresh: () => call(IPC.licence.refresh),
    startTrial: () => call(IPC.licence.startTrial),
    freeDevice: (id) => call(IPC.licence.freeDevice, id),
    onChange: (cb) => on(IPC.licence.changed, cb)
  },
  prefs: {
    get: () => call(IPC.prefs.get),
    setCrashReports: (c) => call(IPC.prefs.setCrashReports, c)
  },
  library: {
    chooseFolder: () => call(IPC.library.chooseFolder),
    openFolder: (folder) => call(IPC.library.openFolder, folder),
    subfolders: (folder) => call(IPC.library.subfolders, folder),
    recentFolders: () => call(IPC.library.recentFolders),
    forgetFolder: (folder) => call(IPC.library.forgetFolder, folder),
    setMeta: (keys, patch) => call(IPC.library.setMeta, keys, patch),
    createCopy: (key) => call(IPC.library.createCopy, key),
    deleteCopy: (key) => call(IPC.library.deleteCopy, key),
    /** `sourceKey` is the photo the recipe came from, so a white balance can change units. */
    applyRecipe: (keys, recipe, groups, sourceKey) => call(IPC.library.applyRecipe, keys, recipe, groups, sourceKey),
    resetRecipe: (keys) => call(IPC.library.resetRecipe, keys),
    prioritize: (keys) => call(IPC.library.prioritize, keys),
    onThumb: (cb) => on(IPC.library.thumb, cb),
    /** A photo's HDR kind, learned from its probe (every copy of it shares it). */
    onHdr: (cb) => on(IPC.library.hdr, cb),
    /** A photo's search words from Gemma's names (every copy shares them). */
    onNames: (cb) => on(IPC.library.names, cb),
    onChanged: (cb) => on(IPC.library.changed, cb),
    openSource: (source) => call(IPC.library.openSource, source),
    resolvePaths: (paths) => call(IPC.library.resolvePaths, paths),
    projectInfo: (key) => call(IPC.library.projectInfo, key),
    setMetadata: (keys, patch) => call(IPC.library.setMetadata, keys, patch),
    keywordTree: () => call(IPC.library.keywordTree),
    collections: () => call(IPC.library.collections),
    saveCollection: (c) => call(IPC.library.saveCollection, c),
    removeCollection: (id) => call(IPC.library.removeCollection, id),
    collectionItems: (id, keys, action) => call(IPC.library.collectionItems, id, keys, action),
    /** Asks where to save; null when cancelled. */
    exportCollections: (ids) => call(IPC.library.exportCollections, ids),
    /** Asks for a file; the collections it added. */
    importCollections: () => call(IPC.library.importCollections),
    stack: (keys, cover) => call(IPC.library.stack, keys, cover),
    unstack: (keys) => call(IPC.library.unstack, keys),
    stackTop: (key) => call(IPC.library.stackTop, key),
    autoStack: (folder, seconds) => call(IPC.library.autoStack, folder, seconds),
    duplicates: (folder, threshold) => call(IPC.library.duplicates, folder, threshold),
    autoWb: (keys) => call(IPC.library.autoWb, keys),
    setWb: (pairs) => call(IPC.library.setWb, pairs),
    onSourcesChanged: (cb) => on(IPC.library.sourcesChanged, cb)
  },
  develop: {
    open: (key) => call(IPC.develop.open, key),
    setRawColour: (key, colour) => call(IPC.develop.setRawColour, key, colour),
    close: (key) => call(IPC.develop.close, key),
    update: (key, recipe, interactive, rev) => call(IPC.develop.update, key, recipe, interactive, rev),
    view: (key, view) => call(IPC.develop.view, key, view),
    region: (req) => call(IPC.develop.region, req),
    sample: (key, x, y) => call(IPC.develop.sample, key, x, y),
    autoTone: (key) => call(IPC.develop.autoTone, key),
    autoWb: (key) => call(IPC.develop.autoWb, key),
    noise: (key) => call(IPC.develop.noise, key),
    measureCa: (key) => call(IPC.develop.measureCa, key),
    bakeSpot: (key, spot, layerId, steps) => call(IPC.develop.bakeSpot, key, spot, layerId, steps),
    removeObject: (key, at, feather, layerId, steps) => call(IPC.develop.removeObject, key, at, feather, layerId, steps),
    suggestHeal: (key, points, radius, feather, kind) => call(IPC.develop.suggestHeal, key, points, radius, feather, kind),
    suggestUpright: (key, mode, focal) => call(IPC.develop.suggestUpright, key, mode, focal),
    uprightFromLines: (key, lines, focal) => call(IPC.develop.uprightFromLines, key, lines, focal),
    putPlane: (png) => call(IPC.develop.putPlane, png),
    getPlane: (ref) => call(IPC.develop.getPlane, ref),
    saveSnapshots: (key, snapshots) => call(IPC.develop.saveSnapshots, key, snapshots),
    historyList: (key) => call(IPC.develop.historyList, key),
    warm: (keys) => call(IPC.develop.warm, keys),
    historyAppend: (key, label, recipe) => call(IPC.develop.historyAppend, key, label, recipe),
    historyAmend: (key, seq, label, recipe) => call(IPC.develop.historyAmend, key, seq, label, recipe),
    /** Show `recipe` on the loupe without making it the photo's (null: the photo's again). */
    preview: (key, recipe) => call(IPC.develop.preview, key, recipe),
    historySetHidden: (key, seqs, hidden) => call(IPC.develop.historySetHidden, key, seqs, hidden),
    historyDelete: (key, seqs) => call(IPC.develop.historyDelete, key, seqs),
    onRendered: (cb) => on(IPC.develop.rendered, cb),
    /** The 1:1 tile's source got better (the plan's RAW master after the quick one): ask again. */
    onTileStale: (cb) => on(IPC.develop.tileStale, cb),
    onRenderError: (cb) => on(IPC.develop.renderError, cb),
    onFrame: (cb) => on(IPC.develop.frame, cb)
  },
  models: {
    list: () => call(IPC.models.list),
    download: (id) => call(IPC.models.download, id),
    cancel: (id) => call(IPC.models.cancel, id),
    remove: (id) => call(IPC.models.remove, id),
    provider: () => call(IPC.models.provider),
    benchmark: () => call(IPC.models.benchmark),
    onEvent: (cb) => on(IPC.models.event, cb)
  },
  lens: {
    importProfiles: () => call(IPC.lens.importProfiles),
    status: () => call(IPC.lens.status),
    /** Ask the models server for a newer catalogue now. */
    check: () => call(IPC.lens.check),
    search: (query) => call(IPC.lens.search, query),
    /** The open photo's profile (the chosen one, or null for the best match) and its correction. */
    resolve: (key, id) => call(IPC.lens.resolve, key, id),
    onChanged: (cb) => on(IPC.lens.changed, cb)
  },
  presets: {
    list: () => call(IPC.presets.list),
    save: (p) => call(IPC.presets.save, p),
    remove: (id) => call(IPC.presets.remove, id),
    luts: () => call(IPC.presets.luts),
    importLut: () => call(IPC.presets.importLut)
  },
  looks: {
    thumbs: (req) => call(IPC.looks.thumbs, req),
    cancel: (key) => call(IPC.looks.cancel, key),
    onThumb: (cb) => on(IPC.looks.thumb, cb),
    run: (req) => call(IPC.looks.run, req),
    cancelRun: (by) => call(IPC.looks.cancelRun, by),
    answer: (runId, a) => call(IPC.looks.answer, runId, a),
    onRun: (cb) => on(IPC.looks.runEvent, cb)
  },
  export: {
    chooseFolder: () => call(IPC.export.chooseFolder),
    /** Pick a watermark PNG; null when the dialog is cancelled. */
    chooseWatermark: () => call(IPC.export.chooseWatermark),
    /** A chosen watermark again (a preset's), or an error when it is gone. */
    readWatermark: (path) => call(IPC.export.readWatermark, path),
    start: (keys, settings) => call(IPC.export.start, keys, settings),
    cancel: (id) => call(IPC.export.cancel, id),
    presets: () => call(IPC.export.presets),
    savePreset: (p) => call(IPC.export.savePreset, p),
    removePreset: (id) => call(IPC.export.removePreset, id),
    /** One photo as the export would write it, at a reduced size. A newer call stops the one before. */
    preview: (key, settings) => call(IPC.export.preview, key, settings),
    cancelPreview: () => call(IPC.export.cancelPreview),
    /** The checks the disk and the photos make: folder, room, replaced files, size. */
    check: (keys, settings) => call(IPC.export.check, keys, settings),
    onProgress: (cb) => on(IPC.export.progress, cb)
  },
  enhance: {
    /** How fast each step has run here (ms per megapixel), for the panel's estimate. */
    rates: () => call(IPC.enhance.rates)
  },
  ai: {
    start: (req) => call(IPC.ai.start, req),
    cancel: (jobId) => call(IPC.ai.cancel, jobId),
    list: () => call(IPC.ai.list),
    capabilities: () => call(IPC.ai.capabilities),
    onEvent: (cb) => on(IPC.ai.event, cb),
    switches: () => call(IPC.ai.switches),
    setEnabled: (on2) => call(IPC.ai.setEnabled, on2),
    setHeavy: (model, on2) => call(IPC.ai.setHeavy, model, on2),
    benchmark: (model) => call(IPC.ai.benchmark, model),
    onSwitches: (cb) => on(IPC.ai.switchesEvent, cb),
    onBenchmark: (cb) => on(IPC.ai.benchmarkProgress, cb)
  },
  brain: {
    status: () => call(IPC.brain.status),
    download: () => call(IPC.brain.download),
    cancel: () => call(IPC.brain.cancel),
    remove: () => call(IPC.brain.remove),
    onEvent: (cb) => on(IPC.brain.event, cb)
  },
  cull: {
    suggestions: (keys) => call(IPC.cull.suggestions, keys),
    keep: (keys, keep) => call(IPC.cull.keep, keys, keep),
    measure: (keys) => call(IPC.cull.measure, keys),
    onEvent: (cb) => on(IPC.cull.event, cb),
    onProgress: (cb) => on(IPC.cull.progress, cb)
  },
  names: {
    get: (key) => call(IPC.names.get, key),
    name: (key) => call(IPC.names.name, key),
    edit: (key, names) => call(IPC.names.edit, key, names),
    onEvent: (cb) => on(IPC.names.event, cb)
  },
  /** Select by clicks, a box or strokes (SAM 2.1) on the open photo. */
  select: {
    open: (key) => call(IPC.select.open, key),
    /** Null for a probe a later one replaced. */
    decode: (selId, req) => call(IPC.select.decode, selId, req),
    commit: (selId, source) => call(IPC.select.commit, selId, source),
    close: (selId) => call(IPC.select.close, selId)
  }
};
function toPage(m) {
  const own = (d) => {
    const whole = d.byteOffset === 0 && d.byteLength === d.buffer.byteLength;
    return (whole ? d : d.slice()).buffer;
  };
  const buffer = own(m.data);
  const companion = m.companion ? { width: m.companion.width, height: m.companion.height, data: own(m.companion.data) } : void 0;
  window.postMessage(
    {
      pixlFrame: {
        frame: m.frame,
        width: m.width,
        height: m.height,
        data: buffer,
        sample: m.sample ?? "U8",
        ...companion ? { companion } : {}
      }
    },
    "*",
    companion ? [buffer, companion.data] : [buffer]
  );
}
electron.ipcRenderer.on(IPC.develop.previewPort, (e) => {
  const port = e.ports[0];
  if (!port) return;
  port.onmessage = (m) => toPage(m.data);
  port.start();
});
electron.ipcRenderer.on(IPC.develop.previewFrame, (_e, m) => toPage(m));
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("playroom", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.playroom = api;
}
