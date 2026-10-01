# TODO — Pixl Playroom

Everything still open in Playroom, as numbered **passes**: small, ordered
batches of related work a model (or you) can take one at a time. Work the
engine has to do is in [ENGINE-REQUESTS.md](ENGINE-REQUESTS.md) (E1, E2…);
Playroom work that waits on it is under "Waiting on the engine". Things only
you can do (accounts, certificates, lawyers, decisions) are under "Owner
tasks". What is finished is under "Done" at the end. Re-planned 2026-10-01
from the old TODO and a full performance and bug sweep.

## How to read this

| Size            | Points   | Roughly                                                 |
| --------------- | -------- | ------------------------------------------------------- |
| S               | 1        | a local fix in one or two files                         |
| M               | 2        | a few files, or one with a test to write                |
| L               | 3        | a feature or refactor across several modules            |
| XL              | 4        | a large feature, several days                           |
| XXL             | 5        | the largest that still fits one pass                    |
| XXXL, 4XL, 5XL… | 6, 7, 8… | each extra X adds a point: an epic, split across passes |

- A pass is at most **5 points**. An item over 5 points is an epic, and its
  parts are graded and spread over consecutive passes (marked "1/3", "2/3"…).
- Passes are in order. "After" names the passes (or engine requests) a pass
  depends on; otherwise passes in the same phase can be taken in any order.
- Each pass is tested and committed before the next.
- File references are where the 2026-10-01 sweep found the problem; check
  they still hold before changing anything.

---

## Phase A — Bugs: lost edits and wrong output (passes 1–11)

### Pass 1 — Lost and misdirected edits · 5 pts

- [x] **S** · **An Upright-only edit is lost on save.** `geometry.upright` is
      in no recipe group (`shared/recipe.ts:707-831`), so `isEdited` is false
      and `saveRecipe` stores `null` (`indexer/service.ts:1608`); Upright also
      can't be pasted, synced or put in a preset. Add it to the `crop` group
      (or its own) and test.
- [x] **M** · **Switching photos quickly can open the wrong one.**
      `develop.open` (`state/develop.ts:287-334`) has no generation check after
      its awaits, and `session` keeps the old photo while loading; main's
      `DevelopSessions.open` (`render.ts:1467-1491`) closes other sessions
      before its own awaits, so two can stay live. Arrowing through the
      filmstrip can show B while C is selected, and edits go to the wrong
      photo. Add an open token on both sides; clear `session` at the start.
- [x] **S** · **Undo can hide the wrong step.** `commit` fires
      `historyAppend` without awaiting it (`develop.ts:369`); `undo` waits only
      for `landing`, so a quick Cmd+Z hides the previous step and the commit's
      `.then` clears `redo`. Chain the append through `queueHistoryOp`.
- [x] **S** · **Paste and Sync in Develop skip history.**
      `commands.ts:438-441` and `Dialogs.tsx:752-755` set the recipe with no
      step, so Cmd+Z undoes the edit before the paste. Use
      `replace(recipe, 'Paste settings')`; add a `.catch` (errors are
      swallowed).

### Pass 2 — Saves, exports and thumbnails · 5 pts

After: Pass 1.

- [x] **M** · **A crash can silently revert the last edits.** The recipe is
      saved 600 ms after its history step and a failed `persist` is only logged
      (`render.ts:488-491`); on the next open the stale recipe is recorded as
      "Opened as saved" (`develop.ts:316-322`). Write the history step and the
      recipe in one project transaction; tell the user when a save fails.
- [x] **S** · **Export can overwrite the original on a case-insensitive
      disk.** The guard is `out === row.path` (`exporter.ts:223`), so
      `IMG_1.jpg` passes for `IMG_1.JPG` with collision "overwrite". Compare
      `realpath` or dev+inode (or case-fold on darwin/win32), before the
      collision branch.
- [x] **S** · **Stale thumbnail and preview after an edit.** `queueThumb`
      skips a key still in `queued` (`library.ts:259-263, 279-283`), so an
      edit saved while that photo's thumbnail renders never re-queues. Mark it
      dirty and render again after.
- [x] **S** · **Two thumbnail renders can write the same file.**
      `hashPicture` calls `this.thumb()` directly (`library.ts:183`), bypassing
      the queue; same stamp, same output name (`library.ts:309-312`). Route it
      through the queue.

### Pass 3 — Render file races · 5 pts

- [x] **M** · **Two builds of the same working set at once.** The in-flight
      key includes `m`/`p` (`pixels/working.ts:286`), so after a heal stroke
      `bakeSpot` (`render.ts:1411`) and `refreshWorking` both write
      `proxy.tiff`/`draft.tiff` in place; a render can read a half-written
      file, and `set.json` (last writer wins) can lose `master`. One in-flight
      build per key, master chained after proxies; write to a temp name and
      rename (see E5).
- [x] **M** · **A recycled preview slot can show the wrong picture.**
      `lastEvent[kind]` keeps `view-<slot>`, but the 6 slots are shared with
      mask and headroom (`render.ts:563-593`); a full render matching an
      earlier signature re-sends a file that now holds another draft. Masked
      stats and pickers read it too. Name each render's file uniquely and
      prune, or drop `lastEvent` when its slot is reused.
- [x] **S** · **One failed lens bake degrades the session until the next
      edit.** `bakePending()` stays true (`render.ts:458-461, 526, 558`), so
      settled renders use the draft and mask/before/headroom never run.
      Remember the failed key, treat it as not pending, schedule a full render.

### Pass 4 — Denoise, virtual copies, AI jobs · 5 pts

- [x] **M** · **Denoise can drop heals, then flashes the original.** The
      denoise step is computed on the steps that existed when it started and
      appended on top of heals made meanwhile (`ai/denoise.ts:166-201`);
      `addPixelStep` doesn't wait for the working pixels (`steps.ts:18-19`) and
      `finally` clears the preview (`denoise.ts:325`), and the preview TIFF is
      deleted while a queued render may read it. Insert at the computed
      position (or serialise the jobs); await `refreshWorking`, then delete.
- [x] **S** · **Closing one virtual copy deletes the others' lens-corrected
      proxies.** `pruneLensed` keeps only the closing copy's set
      (`render.ts:1443`, `proxy.ts:291-297`); keep every copy's current set.
- [x] **S** · **Partial lens map; colliding freeze names.**
      `pixels/lensmap.ts:49` can return a partially written map;
      `freeze.ts:72` names files by `Date.now()` alone.
- [x] **S** · **An AI job says "Cancelled" after it applied.** Enhance adds the
      step inside `run()`; Cancel in the save stage throws `Cancelled`
      (`ai/jobs.ts:169`) and skips `onResult`. Check the signal before
      committing, finish as done once committed; give the JXL convert in
      `enhance.ts` (~268) the signal.

### Pass 5 — Crop and orientation · 5 pts

- [x] **M** · **A crop collapses to 0×0 under Upright.** `dragCrop` calls
      `cropFits` without `g.transform` (`crop.ts:45`), so crops reach the empty
      wedges; `fitCrop` (`compile.ts:436-461`) only shrinks about the centre and
      ends at width 0, which the engine refuses. Pass the transform; in
      `fitCrop` move the centre in when it doesn't fit, with a minimum size.
      (Reproduced: Upright Scale 75, crop {0.8, 0.8, 0.2, 0.2}.)
- [x] **M** · **Flip and Rotate leave geometry in the old frame.** Flip keeps
      the crop and straighten unmirrored (`renderer/lib/geometry.ts:17`), so the
      other half shows and a level horizon is 6° off; Rotate keeps the aspect
      lock (a 3:2 crop cuts 56% after rotating) and Upright's `suggested` and
      guides in the old orientation (`geometry.ts:14-16`, `render.ts:1296`).
      Mirror `crop.x` and negate straighten and Upright on flip; invert the
      aspect and clear or remap Upright on an odd turn.
- [x] **S** · **A tiny straighten is refused.** Under 5e-5 it rounds to
      `rotate_degrees: 0` but still sets `outside: 'Crop'`
      (`compile.ts:1196`). Test the rounded value.

### Pass 6 — Mask and heal precision · 5 pts

- [x] **S** · **A Subtract component becomes Add** when the one before it is
      dropped (a brush whose plane didn't hydrate, a one-point lasso):
      `compile.ts:725-730` promotes it. Drop leading non-Add components.
- [x] **S** · **Heal lens map read with the wrong pixel convention**:
      written as i/(mw−1), read as a fraction by `toSource` and as v·(w−1) by
      `unwarpMask` (`pixels/heal.ts:58-70`, `ops.ts:93`); ±2.8 px at the edges
      of 6000 px. Use (v·(mw−1)+0.5)/mw.
- [x] **S** · **Heal radius not mapped through the lens correction.**
- [x] **S** · **Proxy heal patches snap to whole pixels** (a 15.8 px patch is
      drawn at 17 px).
- [x] **S** · **Mask overlay draws gradients compile drops** (no plane file
      yet), so the overlay shows a mask that isn't applied.

### Pass 7 — Lens, presets and paste · 5 pts

- [x] **S** · **Lens profile resolve throws at f-number 0** (manual or adapted
      lenses): `stops(0)` is −Infinity, the aperture filter returns `[]`, and
      `interpolate([])` crashes (`lens.ts:446-453`, `lensprofiles.ts:355`).
      Treat ≤ 0 or non-finite as null; guard the empty list.
- [x] **S** · **Lens paste carries the source's measured CA** to every target
      (`main/ipc.ts:206-214`); a failed re-resolve keeps the source's profile;
      Develop presets re-resolve nothing. Clear or re-measure `ca`; set
      `resolved = null` in the catch.
- [x] **S** · **Old saved presets are never normalised** (`db.ts:815`,
      `left.tsx:41`); one saved before `colorGrade.add`/`effects.wash` makes
      compile throw. Normalise when listing.
- [x] **S** · **Sync and Save Preset on an untouched RAW pre-tick profile,
      sharpening and noise** (`Dialogs.tsx:722, 853` compare against
      `defaultRecipe(false)`); syncing to JPEGs gives them the Standard
      profile, sharpening 40 and colour NR 25. Use `defaultRecipe(isRaw)`.
- [x] **S** · **A pasted crop isn't rebuilt to the locked aspect** on a
      differently shaped photo.

### Pass 8 — Recipe hardening · 5 pts

- [x] **M** · **`normaliseRecipe` doesn't validate inside arrays**
      (`recipe.ts:568-607`): `layers: [null]` throws; a layer without
      `enabled`/`opacity`/`blend` compiles to `opacity: null`; `splits: [25]`
      gives null curve values; a null curve point throws; a one-point curve
      reaches the engine; a non-object crop compiles to NaN. Normalise layer
      fields, splits, curve points and the crop rectangle; add fuzz cases.
- [x] **S** · **`curve()` dedupes before `round4`**, so 0.50001 and 0.50004
      both become 0.5 (not strictly increasing).
- [x] **S** · **`changedGroups`/`isNeutral` compare with `JSON.stringify`**,
      so the same values in another key order count as changed.
- [x] **S** · **Vignette rotation is clamped to ±45 after Upright's rotate is
      subtracted.**

### Pass 9 — App-level bugs · 5 pts

- [x] **S** · **Shortcuts leak through the confirm dialog.** `App.tsx:333`
      checks only `lib.dialog`; Esc on a confirm also runs `develop.escape`
      (can jump to the Library), Delete removes the selected mask, digits rate.
      Also return when `useConfirm.getState().open`.
- [x] **S** · **The updater loses a downloaded update.** The 4-hour re-check
      after a download sets `checking`, then `error` offline
      (`updater.ts:51`); `installUpdate` (`updater.ts:63`) then refuses. Skip
      checks once downloaded, or keep a `downloaded` flag.
- [x] **S** · **A finished model `.part` never resumes**: quitting during the
      checksum makes the next try send `Range: bytes=<size>-` → HTTP 416,
      forever (`ai/models.ts` `fetchFile`). If `from === bytes`, verify and
      rename; on 416, delete the part and restart.
- [x] **S** · **ImageBitmaps are never closed** (`MaskCanvas.tsx:159, 172,
    226-227`): drafts arrive per frame and hold tens of MB until GC. Close
      on replace and eviction.
- [x] **S** · **exifr leaks a FileHandle on Node 26**
      (`exifr/src/file-readers/FsReader.mjs:27-28`: `fh.stat(path)` is refused
      and the handle is garbage-collected; a truncated JPEG kills the
      process). Electron 44 (Node 24) is fine today. Read the head ourselves
      (as `headOf` does) and pass exifr a Buffer (`camera.ts:56`); add a real
      JPEG fixture. Replaces the old "indexer test fails on Node 26" item,
      which passes now.

### Pass 10 — Projects and durability · 5 pts

- [x] **L** · **Projects are linked to photos by name only**
      (`service.ts:399-408`). A new `IMG_0001.JPG` after a counter reset
      inherits an old project (recipe, history, embedded original); a renamed
      photo detaches and its project shows as a stand-in. Check size and SHA-1
      from `origin`; follow a rename by hash.
- [x] **M** · **Quit and create can leave a torn project.** `stop()` kills the
      index host after 2 s (`indexer/client.ts:79-82`), mid-transaction during
      an embed or scan, leaving a hot `.pixl-journal` beside the photo;
      `createProject` renames into place without a directory fsync, then
      deletes the sidecar and index history (`service.ts:516-521`,
      `pixlfile.ts:234`). Ask the host to finish its transaction and close;
      fsync the directory before deleting the old copies.

### Pass 11 — Behaviour calls (needs your decision first) · 4 pts

- [x] **M** · **On a B&W photo a mask's Temp/Tint adds colour**: mask layers
      run after the base layer's saturation 0 (`compile.ts:1044`). Decide:
      keep (it's a tint tool) or run masks before B&W.
- [x] **M** · **Built-in presets replace whole groups**: "Soft portrait"
      resets exposure and whites to 0; "Warm film" deletes point colours.
      Decide: partial presets (only the fields they set) or keep.

---

## Phase B — Performance: quick wins (passes 12–22)

Biggest felt lag first: slider jank, save cost, background contention.

### Pass 12 — Slider jank · 5 pts

- [x] **M** · **`edit()` deep-clones the whole recipe on every input event**
      (`state/develop.ts:354`: `structuredClone`), so every subscriber to any
      slice re-renders per tick: the Loupe, both `MasksWindow`s, every slider
      in the open panel, the presets rail. Use structural sharing (immer
      `produce`) so untouched slices keep their identity; have `RS`
      (`global.tsx:63`) select its own number.
- [x] **S** · **Loupe geometry and mask redraw per tick.** Memoise
      `viewGeometry` (`Loupe.tsx:131`) on the geometry/lens slices so
      `SharpTile`, `BrushLayer`, `GradientTools`, `LassoEditor` keep `memo`;
      `MaskCanvas` compares `layer.components` by identity instead of a global
      subscribe with `JSON.stringify` (`MaskCanvas.tsx:122-123`) and stops the
      GL `compose()` per tick (`:308`).
- [x] **S** · **`edit()` + `commit()` send two identical updates** (hydrate,
      normalise and compile twice; the first render aborted):
      `masks/model.ts:280-302`, `BrushTool.tsx:226-250`, `ui.tsx:140-153`.
- [x] **S** · **Listener and poll churn**: `Slider`'s effect has no deps and
      re-adds two window listeners every render (`ui.tsx:131`); `ProjectRows`
      polls IPC every 4 s forever (`left.tsx:321`); `usePresets(4000)`
      (`hooks.ts:13`) re-sets the list every 4 s; `BrushLayer` sets state per
      pointermove for the cursor (`BrushTool.tsx:269-270`).

### Pass 13 — History and save cost · 5 pts

- [x] **S** · **History replay clones the whole recipe per step**
      (`history.ts:144`), and `append` reads the whole history three times
      (`historytable.ts:130-152`): ~20 ms at 200 steps, linear, in the index
      process every commit and on the renderer's main thread every undo.
      Clone once, apply ops in place (measured ~18 ms → ~0.3 ms); build the
      log in memory.
- [x] **S** · **Reading history takes a write lock and records a write**:
      `BEGIN IMMEDIATE` (`historytable.ts:90`, `pixlfile.ts:298`) and
      `noteProjectWrite` (`service.ts:1758-1768`) on a read. Drop both.
- [x] **S** · **Every save rewrites every item and snapshot**
      (`service.ts:1586-1590`, `pixlfile.ts:406-442`). Update the changed row
      only; skip `putPlane` for refs already stored.
- [x] **S** · **Thumbnail jobs read and hash whole hydrated projects**
      (`service.ts:1694-1714`): read one item, keep it slim, hash the slim
      recipe.
- [x] **S** · **The origin cache misses after our own writes** (keyed on the
      file stamp, `service.ts:300-308`), opening a second connection per edit.
      Invalidate on `setOrigin` or a foreign change only.

### Pass 14 — Index plumbing · 5 pts

After: Pass 13.

- [x] **S** · **The open photo's project closes after 2 s idle**
      (`pixlfile.ts:665`), dropping its statement cache. Keep the Develop
      photo's project open until its session closes.
- [x] **S** · **No busy timeout, loose transactions, a missing index**: set
      `busy_timeout` 2–5 s; wrap `mirror` and `openData`'s plane copies in a
      transaction; `CREATE INDEX photos_project ON photos(project_path)`.
- [x] **S** · **Opening a photo waits on sequential calls**
      (`develop.ts:311-322`): run `open` and `historyList` together; compare
      recipes with a deep-equal, not `JSON.stringify` (key order makes a
      spurious "Opened as saved").
- [x] **S** · **`isEdited` does ~76 deep clones per call** (19 groups × 2
      `applyGroups`), per photo in the indexer (`service.ts:703, 713, 1608,
    1710`). Compare each group's fields directly; stop at the first change.
- [x] **S** · **A thumbnail render and preview write at every 600 ms pause**
      (`render.ts:479, 489`; `library.ts:353-418`): a full graded render on the
      background engine that warps the lens live. Queue them on session close
      or after a few seconds idle.

### Pass 15 — Background work stops competing with editing · 5 pts

- [x] **M** · **Background engine work uses every core.** `blankRequest`
      defaults to `INTERACTIVE_THREADS` (`source.ts:216`) and `proxy.ts` never
      overrides it: proxy builds, the bake after every lens/heal edit
      (`render.ts:435-462`), `ensureMaster`, export encode (`exporter.ts:199`),
      Auto WB analyze (`autowb.ts:51`). Pass `BACKGROUND_THREADS` from
      background callers.
- [x] **S** · **No process is niced.** `os.setPriority(pid, 10)` for the
      background and AI engines and the index host.
- [x] **M** · **Batches that can't be stopped or bounded.** Auto WB queues
      every photo at once with `Promise.all` (`autowb.ts:269`); 500 RAWs = 500
      proxy builds, no cancel. Whole-library duplicates (dHash renders) keep
      going after you navigate away (`library.ts:161-179`). Limit Auto WB to 2
      at a time with Cancel; tie duplicates to an AbortSignal.

### Pass 16 — The settled-render chain · 5 pts

Each release runs picture → mask → before → headroom → mask thumbnails
(`render.ts:526-531`), each decoding and grading again.

- [x] **S** · **The mask plane re-renders after every slider change**: its
      key includes `lastFull`, a rotating file name (`render.ts:795`), then
      `analyze` decodes the JPEG and plane again (`:830`). Give the plane its
      own key; re-analyze only when the picture changed.
- [x] **S** · **Mask thumbnails render at 1280 for ~64 px tiles**, and range
      masks' keys include the grade (`render.ts:859, 896`). Render at ~256.
- [x] **S** · **"Before" is a 2560 PNG even without alpha**
      (`render.ts:977-983`). JPEG when there is no transparency.
- [x] **S** · **Previews are JPEG q95 with no chroma subsampling**
      (`render.ts:606`). Use 4:2:0 for full renders.
- [x] **S** · **The plane store LRU holds 48** (`planestore.ts:12`): a photo
      with more brush components misses on every update. Size it by bytes.

### Pass 17 — Compile hot path and opening a photo · 5 pts

- [x] **M** · **Per-frame hashing on the main process**: `brushPlanes`
      re-hashes each brush PNG per compile (`brushes.ts:56`) though the key
      equals `planeRef`; `lensKey()` runs 4–6 times per update
      (`render.ts:407, 424, 502, 554, 558`); the cache key stringifies a
      ~28 KB `.cube` whenever exposure > 0 (`compile.ts:959`). Key brushes by
      ref; memoise `lensKey` on lens/retouch identity; key the cube by hash.
- [x] **M** · **Opening a photo is one long serial path**
      (`render.ts:1475-1490`): `probe` runs on the background engine
      (`library.ts:95`) behind thumbnails and exports, its cache is in memory
      only, and the first render is a full 2560 render plus a 2560 before.
      Probe on the interactive engine and persist probes; render a draft
      first.
- [x] **S** · **An untouched framing misses the engine's fast path**: an
      aspect equal to the frame's emits a `{0,0,1,1}` crop.

### Pass 18 — Glass and UI loops · 5 pts

- [x] **S** · **The liquid-glass filter re-filters every frame during pan,
      zoom, brush and window drags**: only `edit()` sets `data-interacting`
      (`develop.ts:359`; `primitives.css:747-751`). Call `touchInteracting()`
      in `Loupe.tsx:186` `preview`, the brush pointermove and `startDrag`.
- [x] **S** · **A WebGL gradient renders at 30 fps behind every dialog**
      (`fx/AmbientGradient.tsx:71`, `DialogBackdrop.tsx:14`) under refracting
      glass. Stop its clock after one frame there; flat glass for modals.
- [x] **S** · **An open Popover runs a layout-forcing rAF loop**
      (`Popover.tsx:79-100`). ResizeObserver plus scroll/resize listeners.
- [x] **S** · **Range masks re-decode the full preview on every draft**
      (`MaskCanvas.tsx:167-177, 308`). Decode downscaled; refresh on settled
      renders only.
- [x] **S** · **Dragging the masks window writes localStorage per pointer
      move** (`MasksWindow.tsx:695` → `ui.ts:177`, no `partialize`). Move it by
      transform, commit on pointer-up; `partialize` and throttle storage.

### Pass 19 — Library responsiveness and the startup chain · 5 pts

- [x] **M** · **The library re-sorts everything on every thumbnail.**
      `onThumb` does `items.find` + `patchItems` over all items
      (`App.tsx:360-367` → `library.ts:265-276`): O(n²) while a folder fills.
      `useVisible()` filters and sorts 3–5 times per change; the inline
      `onOpen`/`onPick` defeat `memo` (`Library.tsx:468`, `Filmstrip.tsx:38`);
      `selection.includes` per tile (`Library.tsx:49`); `MetadataEditor.tsx:236`
      is O(N·K); search filters per keystroke. Batch thumbnail events per frame
      with a key→index map; compute `visible` once; stable callbacks by key; a
      `Set` selection; `Intl.Collator`; `useDeferredValue` on the search.
- [x] **S** · **The startup chain is serial**: the index host runs
      `prunePlanes` (a regex over all history JSON, 3.5 MB and growing) before
      hello (`indexer/host.ts:31-38`); the renderer loads recents,
      collections and keywords before opening the last folder
      (`App.tsx:410-422`). Say hello first and prune when idle; open the last
      source alongside.
- [x] **S** · **Startup does work it could defer**: both lens catalogues are
      parsed, hashed and validated (`lensprofiles.ts:207-210`, and again in
      `check()` at `:266`) — compare `generated` dates and parse the newer;
      `bgEngine.start()` is eager (`index.ts:192`); `sysctl` via
      `execFileSync` at module load (`source.ts:146`).
- [x] **S** · **Unreadable files are retried every launch** (failures in
      memory only, `service.ts:174`). Persist them with the version key.

### Pass 20 — Startup relaunch and folder open · 4 pts

- [x] **M** · **A packaged launch on a Retina Mac starts twice**, after
      loading every static import (electron-updater ~65 ms, exiftool-vendored
      ~36 ms): `bootScale` relaunches when the scale switch is missing
      (`display.ts:38, 92-101`; `index.ts:55-59`). A tiny entry that runs
      `bootScale` first, then imports the app; load the updater only when
      packaged and exiftool only for export and metadata.
- [x] **M** · **Opening a folder redoes all per-item work.** A full rescan
      every time (`service.ts:217-222`), an unchunked `statSync` loop in
      `fillXmp` (`:757-765`), a thumbnail job per item (`library.ts:136, 151`)
      whose `recipe()` opens each sidecar or `.pixl`, and `fillCameras`
      triggering a second full `refresh()`. Store the recipe hash in the row so
      a thumbnail job compares stamps without reading files; skip a rescan done
      seconds ago; chunk `fillXmp`.

### Pass 21 — Disk cache hygiene · 4 pts

- [x] **M** · **Caches grow without limit** (12 GB in `cache/photos` on the
      dev machine; 158 `lens-*` files ≈ 1.6 GB for one photo; 2,623 thumbnails
      on disk, 646 referenced). Delete the previous lens set when a new one is
      installed (keep current + one; today only on close, fire-and-forget,
      `render.ts:1443`); unlink the old thumbnail in `setThumb` (`db.ts:680`,
      `library.ts:309`); prune `before-*.png`, `mthumb-*`, `brush-*`, `heal-*`
      and `freeze-*`.
- [x] **M** · **The frozen-mask cache misses on every stroke**: keyed on
      `master.path`, which changes per stroke, so a stroke inside a mask
      re-freezes it at full resolution; when it hits, it ignores the grade a
      colour-range mask depends on. Key on the steps' content and the grade.

### Pass 22 — HDR and pixel-step formats · 5 pts

- [x] **M** · **HDR paths inflate 16-bit PNGs per render**: PQ/HLG proxies
      are 16-bit PNG (`proxy.ts:117-122`); `measureHdr` runs a second graded
      pass written as a 16-bit PNG only to measure it (`render.ts:597, 666`);
      the gain-map master is a 16-bit PNG (`hdrsource.ts:95-110`, 1–2 s to
      inflate per 1:1 tile); 1:1 tiles are PNG at device size
      (`render.ts:1017-1072`). Uncompressed TIFF where cICP isn't needed, a
      cheap encoder for the stats pass, JPEG tiles.
      _Done: the stats pass is an uncompressed TIFF, 1:1 tiles are JPEG.
      Left for E34: the PQ/HLG proxies and the gain-map master need cICP._
- [x] **S** · **Pixel steps**: `layOn` runs proxy then draft in sequence
      (`working.ts:344-357`), and `stepImage`/`sized()` write full-resolution
      16-bit PNG caches (`working.ts:113-172`). `Promise.all`; TIFF.
      _Done: proxy and draft are laid on together. Left for E33: overlays
      take only PNG._
- [x] **M** · **HeadroomOverlay is a full-preview CPU pass**
      (`HeadroomOverlay.tsx:49-58`: `getImageData` + LUT + `putImageData`, ~5 MP
      per settled HDR render). A GPU LUT, as `ClippingOverlay` does.

---

## Phase C — Release code (passes 23–26)

Code that ships with the first paid release. Each waits on an owner task.

### Pass 23 — Licence enforcement · 3 pts

After: Owner tasks "Lemon Squeezy store" and "What a lapsed licence locks".

- [ ] **S** · Set `LS_PRODUCT` (store and product ids) in
      `src/shared/licence.ts` so other products' keys are refused; test with a
      test-mode key (`PLAYROOM_LICENCE_UI=1` in a packaged build).
      _Waits on the store. Then flip `LICENCE_ENFORCED`, which also shows the
      Licence section in production._
- [x] **M** · Gate what an ended trial and an unconfirmed licence
      (`revalidate`) lock with `allows()`, show the Licence section in
      production, and flip `LICENCE_ENFORCED`.
      _Done (behind the flag, still off): a lapsed licence locks exporting
      only (`LICENSED`); `requireLicence('export')` refuses `export:start`,
      and the Export dialog says why, with Enter a key / Buy._

### Pass 24 — Crash reports kept · 5 pts

After: Owner task "Where crash reports live". Partly in pixl-web.

- [x] **L** · Store crash reports: R2 with the retention period (the Worker
      only logs a summary today), or Sentry's Electron SDK taking over from
      `crashReporter` (`src/main/crash.ts`).
      _Done: R2 (pixl-web `worker/api.ts`, bucket `pixl-reports`, 90 days
      until confirmed; `scripts/reports-bucket.sh` there), rate limited.
      Also new: Settings → Report a problem (and Help → Report a Problem…)
      sends the user's words, an optional email and the scrubbed end of the
      log to `/api/report`, kept a year._
- [x] **M** · Symbol files for minidumps, uploaded by the release build.
      _Done: `scripts/upload-symbols.mjs`, the release workflow's Crash
      symbols step (needs the `CLOUDFLARE_SYMBOLS_TOKEN` and
      `CLOUDFLARE_ACCOUNT_ID` secrets). The engine's frames wait on E35._

### Pass 25 — Trials recorded on the server · 3 pts

After: Pass 23. pixl-web plus `src/main/licence.ts`.

- [ ] **L** · The trial's start lives in `licence.json`, which deleting
      resets. Record trials on the server by device, if that matters.
      _Deferred (2026-10-01): waits on the account system in pixl-web._

### Pass 26 — Freeing a lost device · 3 pts

After: Pass 23. pixl-web.

- [ ] **L** · The website account lists a licence's devices and frees one
      (the app can only free its own place; today it's by email).
      _Deferred (2026-10-01): waits on the account system in pixl-web._

---

## Phase D — Performance: architecture (passes 27–35)

### Pass 27 — History keyframes · 3 pts

After: Passes 2, 13.

- [x] **L** · Store a full recipe every K steps (or a cached head) so
      appending is O(1) and hide/show replays from the nearest keyframe; make
      `items.recipe` the history head, written in the same transaction.
      _Done: a keyframe every 25 steps (`historytable.ts`); an append reads
      at most 25 rows and returns only what changed (`HistoryAppend`,
      `appendToLog`); hide/show/delete rebuild keyframes and send the head,
      so the renderer doesn't replay. The recipe and step were already one
      transaction (`commitEdit`, Pass 2)._

### Pass 28 — One write-behind queue per project · 4 pts

After: Pass 27.

- [x] **L** · Merge recipe, history and preview writes within ~250 ms into
      one transaction; flush on idle, session close and quit.
      _Done: `ProjectPool.write` opens a batch committed after 250 ms (or on
      leaving Develop, idle close, drop and quit); `tx` inside it is a
      savepoint; the index notes each commit's mtime (`projectCommitted`)._
- [x] **S** · Then `PRAGMA fullfsync` on macOS: `synchronous=FULL` alone
      doesn't reach stable storage, so the "every commit on disk" comment
      (`pixlfile.ts:190`) is false today. Measured 15.6 ms per commit,
      affordable once batched.

### Pass 29 — Mask planes as content-addressed blobs · 4 pts

After: Pass 28. A `.pixl` format version bump (docs/pixl-format.md).

- [x] **XL** · Store planes as binary BLOBs keyed by SHA-256 in the existing
      `blobs` table instead of base64 TEXT (a third larger); only refs cross
      IPC (today `saveRecipe`, `thumbJob`, `openData` and `slim` ship PNGs
      between processes, ~800 KB with two brush masks). Retires the 32-bit
      `hash32` + length ref, where a collision under `INSERT OR IGNORE` could
      silently swap masks. Migrate existing projects.
      _Done: planes are SHA-256-named binary blobs (`planeref.ts`; the
      project's `blobs`, kind `plane`; the index's `plane_blobs`, migration
      9); format 2, version-1 projects upgrade on open, renaming every ref.
      Recipes cross between main and the index by reference only (`Library`
      slims and hydrates; the index hydrates only sidecar files)._

### Pass 30 — Off the index request loop · 5 pts

- [x] **L** · Embedding the original (`putBlobFile`, `pixlfile.ts:507`: a
      SHA-256 of the whole file, synchronous) and `gc` block every index
      request, saves included. Move them to a worker with its own connection,
      or chunk them in small transactions with `state=pending`.
      _Done: `putBlobFileInPieces` hashes as a stream and writes a chunk per
      turn, the `blobs` row last (originals and pixel steps); `gc` runs a
      moment later (`gcLater`) and vacuums 4 MB a step; orphaned chunks go._
- [x] **M** · Take the library thumbnail from the picture Develop already
      rendered instead of a second background render.
      _Done: the session offers its last whole settled JPEG when it shows the
      saved recipe; the library shrinks it to sRGB, else grades as before._

### Pass 31 — One engine scheduler · 5 pts

After: Pass 15.

- [x] **L** · Hold background requests while interactive renders are in
      flight; don't start the next render until a cancelled one has stopped
      (`client.ts:258-263` settles at once; better with E6). The libuv pools
      (8/4) aren't the bottleneck; too many engine threads are.
      _Done: the client tracks calls the host is still on (cancelled ones
      too); background and AI calls wait up to 1.5 s behind interactive work
      (`holdFor`), a cancellable call up to 250 ms for cancelled ones._
- [x] **M** · A ~1920 px proxy between the draft and the 2560: on a Retina
      loupe `targetEdge` is box × DPR, so nearly every settled render uses
      2560 (`render.ts:559-560`); ~44% fewer pixels on a 1200 pt loupe.
      _Done: `mid` (1920) beside the plain and lens-corrected proxies, used
      for a view up to 1.25× its size (`MID_SHORTFALL`); pixel-step and HDR
      sets have none and use the 2560._

### Pass 32 — The preview as pixels, not a file · 4 pts

After: Pass 31.

- [x] **XL** · Each settled render writes a 2–4 MB JPEG, streams it back
      through `protocol.handle` in main-process JS (`protocol.ts:43-48`), and
      the loupe decodes it (~30–50 ms). Hand the renderer raw pixels
      (`Encode::Pixels`, engine 0.15) over a transferred `MessagePort` into a
      canvas; no file, no decode. The histogram already comes from `measure`.
      _Done for drafts (the renders while a slider moves): RGBA pixels from
      the engine host straight to the window on their own port
      (`sendPreviewsTo`, `lib/frames.ts`), drawn on a canvas; main relays if
      no port is up. The settled picture stays a JPEG: main measures masks
      through it (`measureMask`) and thumbnails shrink it, and the engine
      cannot analyse from memory._

### Pass 33 — A virtualised library · 5 pts

After: Pass 19.

- [ ] **L** · Virtualise the grid and the filmstrip (today only
      `content-visibility: auto`, `library.css:101`, which still pays React and
      DOM cost for N nodes).
- [ ] **M** · Near-duplicate grouping compares every pair, synchronously in
      the index host (`dupes.ts:74-83`). A BK-tree or multi-index hash.

### Pass 34 — Folders as a tree; warm neighbours · 5 pts

- [ ] **L** · Recursive folders and a folder tree in the sources sidebar.
- [ ] **M** · Build proxies for the filmstrip neighbours of the open photo
      ahead of time, on the background engine.

### Pass 35 — Watching folders · 3 pts

After: Pass 34.

- [ ] **L** · Watch open folders (FSEvents / `fs.watch`) in the index host
      instead of rescanning on open or refresh; changes made outside the app
      appear as they happen.

---

## Phase E — Masks, retouch and geometry (passes 36–39)

**Epic — AI subject and lasso masks bloom past their edge · XXXL (6):
passes 36–37.** The AI plane is soft (model probabilities) and low resolution
(1024 px, `ai/segment.ts`), upsampled over the photo; a lasso's feather is
symmetric about its edge, so half falls outside. The engine has only
`feather { radius, edge }` (an optional engine route is E14).

### Pass 36 — Mask edges 1/2 · 4 pts

- [ ] **M** · Add `edge: { shift: −100…100, harden: 0…100 }` to
      `ComponentBase` and apply it where raster planes are written
      (`planes.ts` `writeBrushPlane`, in the pixels worker): a min/max filter
      of `shift` pixels contracts or expands; a levels curve around 50%
      hardens. Covers AI masks, brushes and gradients. Default new AI masks to
      a small contract and some harden (`ai/apply.ts`).
- [ ] **S** · A lasso "inside" feather: offset the polygon inward by the
      feather radius before it reaches the engine (`compile.ts`
      `maskComponent`).
- [ ] **S** · Shift and Harden on the component card (`MaskTool.tsx`
      `ComponentCard`).

### Pass 37 — Mask edges 2/2; intersect brushes · 4 pts

After: Pass 36.

- [ ] **M** · The loupe's live mask preview applies the same shift and harden
      (`maskgl` shaders).
- [ ] **M** · Brush: intersect-with brushes.

### Pass 38 — Mask overlays and spots · 5 pts

- [ ] **L** · A per-component overlay colour: needs a rendered plane per
      component (the overlay is one plane per mask today).
- [ ] **M** · Visualise spots for the Heal tool (show dust and spots on a
      high-contrast view).

### Pass 39 — Geometry follow-ups · 5 pts

- [ ] **M** · Heal spots under an Upright warp are placed round on the
      unwarped frame and show as circles on the warped one (close, not exact).
- [ ] **S** · Upright's focal length comes from the 35 mm equivalent only; a
      file stating only the real focal length and no crop factor gets 35 mm.
      Use the camera list's crop factor.
- [ ] **M** · Portrait RAWs: IMG_3086.CR2 (EXIF "Rotate 270 CW") shows and
      exports landscape. `source.ts:82-84` assumes a developed RAW comes out
      upright; check what rawler returns and fix here, or raise E25.

---

## Phase F — Develop features and phase leftovers (passes 40–52)

### Pass 40 — Tone and detail · 5 pts

- [ ] **L** · Tone curve: per-channel parametric (the region sliders are
      master only).
- [ ] **M** · Sharpening/NR previews at fit size (today sharpening shows only
      when its radius is ≥ half a proxy pixel, i.e. at 1:1).

### Pass 41 — Denoise and Enhance limits · 5 pts

- [ ] **M** · DRUNet's `MeasuredNoise` gain (1.33) under-states synthetic
      per-channel noise (halves σ 7 rather than removing it): check on
      high-ISO RAWs; add a Noise level override if needed.
- [ ] **M** · Virtual copies share the photo's denoise sets; pruning keeps the
      newest three, which a copy with other settings may lose (it rebuilds).
      Keep each live copy's set.
- [ ] **S** · A long-edge limit for Enhance ×4 (the request's `resize` after
      the chain).

### Pass 42 — Enhance previews and HDR · 4 pts

- [ ] **M** · A before/after preview of a crop before running Enhance: crop to
      a temp file first (the engine refuses `region` with a chain, E4; a JPEG
      rebuild needs the whole file).
- [ ] **M** · Enhance on HDR by tone mapping to SDR first, then upscaling as
      a second conversion (output SDR). Refused up front today.

### Pass 43 — HDR follow-ups · 4 pts

- [ ] **M** · Exporting an SDR-edited gain-map photo drops its map; carry the
      original map (or remake it) so the export stays HDR-capable.
- [ ] **M** · A LUT profile flattens an HDR photo's highlights: apply the
      table to the SDR range only, until E20.

### Pass 44 — One-time migrations and merges · 4 pts

- [ ] **M** · Existing edits on HEIC photos were placed on the sideways frame
      (crops, masks) and now land turned: offer to rotate them once.
- [ ] **M** · Importing collections adds copies; offer merging into existing
      collections of the same name.

### Pass 45 — Watermarks · 4 pts

- [ ] **M** · Text watermarks: a copyright line typed in the dialog, rendered
      to a PNG in the renderer (canvas) and handed over as a file.
- [ ] **M** · A watermark per preset folder of logos (light and dark
      versions, chosen by the picture's brightness under the mark).

### Pass 46 — Lens data · 5 pts

- [ ] **M** · Lensfun lens-centre offsets (`<center>`, unused in today's data)
      and its focal-spline interpolation (we interpolate linearly).
- [ ] **L** · Adobe LCP import (the user's own, not redistributable): LCP's
      perspective model and `Focal` unit map directly.

**Epic — Lens corrections the file carries · 8XL (11): passes 47–49.** Read
with ExifTool. Needs sample files (Owner tasks).

### Pass 47 — Corrections from the file 1/3 · 5 pts

- [ ] **L** · DNG `OpcodeList3`: WarpRectilinear → the engine's
      `Rectilinear`, `FarthestCorner`; FixVignetteRadial → `Multiply` at
      `Corrected`.
- [ ] **M** · Sony maker-note distortion and vignetting.

### Pass 48 — Corrections from the file 2/3 · 4 pts

- [ ] **M** · Fujifilm maker-note distortion and vignetting.
- [ ] **M** · Olympus/OM maker-note distortion and vignetting.

### Pass 49 — Corrections from the file 3/3; Constrain Crop off · 5 pts

- [ ] **M** · Panasonic maker-note distortion and vignetting.
- [ ] **L** · Constrain Crop off: keep a warped frame's empty corners as
      transparent (needs an alpha preview path; today a warp always crops).

### Pass 50 — Profile browser · 3 pts

- [ ] **L** · A profile browser with previews (camera-matching DCP and Adobe
      `.xmp` profiles wait on E21).

### Pass 51 — Soft proofing · 3 pts

- [ ] **L** · Soft proofing: preview through the output profile (the gamut
      warning waits on E22).

### Pass 52 — HDR on HDR displays · 3 pts

After: Pass 32.

- [ ] **L** · Show HDR photos as HDR on HDR displays (render PQ AVIF / PNG
      cICP to the loupe); today they are tone mapped for SDR.

---

## Phase G — Library, output and design (passes 53–64)

### Pass 53 — Compare and survey · 5 pts

- [ ] **L** · Compare view (two photos side by side).
- [ ] **M** · Survey view.

### Pass 54 — File operations · 4 pts

- [ ] **M** · Batch rename.
- [ ] **M** · Move, copy, and delete to trash.

### Pass 55 — Map; history that travels · 4 pts

- [ ] **L** · Catalog: map/GPS.
- [ ] **S** · History travels with a `.pixl` now; check what a sidecar-only
      photo keeps when its folder moves to another machine (the old item:
      snapshots but not history), and close or fix.

**Epic — Lightroom `crs:` interop · XXXL (6): passes 56–57.**

### Pass 56 — XMP interop 1/2 · 3 pts

- [ ] **L** · Read Lightroom `crs:` settings from `.xmp` where they map.

### Pass 57 — XMP interop 2/2 · 3 pts

- [ ] **L** · Write `crs:` settings where they map.

### Pass 58 — Slideshow · 3 pts

- [ ] **L** · Slideshow.

### Pass 59 — Print · 4 pts

- [ ] **XL** · Print module.

### Pass 60 — Web gallery · 4 pts

- [ ] **XL** · Web gallery.

**Epic — Book · XXXL (6): passes 61–62.**

### Pass 61 — Book 1/2 · 3 pts

- [ ] **L** · Page layout model and templates.

### Pass 62 — Book 2/2 · 3 pts

- [ ] **L** · Book editor and export.

### Pass 63 — Tethered capture · 5 pts

- [ ] **XXL** · Tethered capture.

### Pass 64 — Design polish · 5 pts

- [ ] **L** · A light theme.
- [ ] **M** · User-reorderable tools on the wheel.

---

## Phase H — Epics (passes 65–71)

**Epic — Layer-based editing · 15XL (18): passes 65–68.** Every manipulation
can be its own layer (exposure, a curve, an HSL move, a colour grade, a LUT…),
each with a name, visibility, opacity, blend mode, optional mask and a place in
an ordered stack. Today the global panels are one flat set of sliders per
recipe, and only masked local adjustments (`LocalLayer`) are layers.
After: Passes 8, 27.

### Pass 65 — Layers 1/4 · 5 pts

- [ ] **L** · A layer stack in the recipe (name, visibility, opacity, blend,
      mask ref, order).
- [ ] **M** · Migrate today's global settings to a base layer (recipes,
      presets, history bases).

### Pass 66 — Layers 2/4 · 5 pts

- [ ] **L** · The compiler emits one engine stage per layer, in stack order.
- [ ] **M** · Optional masks per layer, reusing the mask components.

### Pass 67 — Layers 3/4 · 5 pts

- [ ] **L** · A layers panel in Develop: add, rename, show/hide, opacity,
      blend, reorder, duplicate, delete.
- [ ] **M** · Layer groups.

### Pass 68 — Layers 4/4 · 3 pts

- [ ] **L** · Per-layer copy/paste, sync and presets.

**Epic — AI harness, cloud tiers and credits · 12XL (15): passes 69–71.**
MCP, bring your own agent; every agent action a history step tagged with actor
and run ID. After: Pass 27; Owner task "Tiers and credits".

### Pass 69 — AI harness 1/3 · 5 pts

- [ ] **M** · History steps carry an actor and a run ID.
- [ ] **L** · An MCP server with read-only tools (library, photo, recipe,
      history).

### Pass 70 — AI harness 2/3 · 5 pts

- [ ] **L** · MCP edit tools, each action a tagged history step.
- [ ] **M** · Review an agent's run: list, accept or undo its steps.

### Pass 71 — AI harness 3/3 · 5 pts

- [ ] **L** · A credits ledger (pixl-web).
- [ ] **M** · Cloud tiers gated in the app.

---

## Waiting on the engine

Playroom work that starts once the engine request lands
([ENGINE-REQUESTS.md](ENGINE-REQUESTS.md)). Becomes a pass then.

- [ ] **S** · Drop `repairJpegExif` once JPEG EXIF is written correctly (E1).
- [ ] **S** · HEIC export and HEIC gain-map export (E2).
- [ ] **M** · Sharp 1:1 zoom and 1:1 tiles on straightened, Upright and
      lens-warped photos (E3).
- [ ] **S** · Enhance crop preview by `region` instead of a temp file (E4).
- [ ] **S** · Drop the host's temp-and-rename around engine writes (E5).
- [ ] **S** · The scheduler waits for a cancel to finish (E6).
- [ ] **M** · Fast 1:1 pans from a cached or tiled source (E7).
- [ ] **M** · Retire the 512 px gradient planes and their cache for native
      linear and radial shapes (E11).
- [ ] **M** · Depth range mask (its picker entry is disabled) (E12).
- [ ] **M** · Smoothed range masks and an edge-aware brush in the tools (E13).
- [ ] **S** · Move mask shift/harden to the engine, if E14 lands.
- [ ] **S** · Highlight recovery on RAW, in the develop (E15).
- [ ] **S** · Raw-domain noise reduction controls (E16).
- [ ] **S** · Pixel steps' image caches as uncompressed TIFF overlays (E33).
- [ ] **S** · PQ/HLG proxies and the gain-map master as uncompressed TIFF (E34).
- [ ] **S** · Engine frames in crash reports: feed the binding's published
      debug symbols to `scripts/upload-symbols.mjs` (E35).
- [ ] **S** · ProRAW and DNG gain maps (E17).
- [ ] **S** · Fisheye distortion from Lensfun profiles (E18).
- [ ] **M** · Native `ParametricCurve`, with a recipe migration that
      rescales the region sliders (E19).
- [ ] **S** · HDR-aware LUT profiles replace the SDR-range fallback (E20).
- [ ] **M** · Camera-matching DCP and Adobe `.xmp` profiles (E21).
- [ ] **M** · Gamut warning in soft proofing (E22).
- [ ] **XL** · Merge to HDR, panorama, HDR panorama, focus stacking (E23).
- [ ] **S** · AI denoise (SCUNet) and Enhance (FBCNN) on the accelerator
      (E26, E27).
- [ ] **M** · Select Sky (its picker entry is disabled) (E28).
- [ ] **L** · AI Remove (generative remove) in the Heal tool (E29).
- [ ] **L** · Select People: face, skin, hair, eyes, lips, teeth, clothes
      (E30).
- [ ] **L** · Objects by brush or box (E30).
- [ ] **L** · Catalog: people (E30).
- [ ] **M** · Learned auto white balance beside the grey-pixel estimate (E31).
- [ ] **M** · An adaptive/learned auto tone (E31).
- [ ] **S** · DirectML on Windows (E32).

## Owner tasks (not model passes)

- [ ] **L** · **Code signing**: a Developer ID Application certificate and an
      App Store Connect API key (macOS); Azure Trusted Signing with identity
      validation (Windows). Steps and the secrets/variables to add in
      `.github/RELEASING.md`; `release.yml` signs with whatever exists. Builds
      are unsigned until then, and macOS in-app updates need signed builds.
- [ ] **M** · **Legal pages**: fill in the [bracketed] parts of the licence
      agreement and privacy policy on pixlfoundation.com/legal/ (pixl-web
      `src/legal/`: legal entity, jurisdiction, address, refunds, what a
      finished trial does, crash-report retention); have a lawyer review both.
- [ ] **S** · **Licensing view**: a lawyer's view on jpegxl-sys (GPL) and
      rawler (LGPL, static) before the first paid release (engine side: E8–E10).
- [ ] **S** · **Lemon Squeezy store**: create it and the Playroom product with
      an activation limit of 3; hand over the store and product ids (Pass 23).
- [x] **S** · **What a lapsed licence locks**: exports only (2026-10-01).
      Trials on the server: not for now (Pass 25 deferred).
- [ ] **S** · **Update policy in writing**: 1.x updates included, major
      versions a discounted paid upgrade (the EULA draft says so).
- [x] **S** · **Where crash reports live**: R2 (2026-10-01).
- [ ] **S** · **Reports bucket and retention**: confirm 90 days for crash
      reports and a year for problem reports (the privacy policy has both in
      brackets), run pixl-web's `scripts/reports-bucket.sh` before deploying
      the Worker, and add the `CLOUDFLARE_SYMBOLS_TOKEN` and
      `CLOUDFLARE_ACCOUNT_ID` secrets to the playroom repository (Pass 24).
- [ ] **M** · **Tiers and credits**: what the cloud tiers include and cost
      (Pass 71).
- [ ] **S** · **Windows "Open with"**: `build/installer.nsh`
      (OpenWithProgids, never the default) has never been compiled or run;
      check it on a Windows machine (see `.github/RELEASING.md`).
- [ ] **S** · **Sample files** for Passes 47–49: a DNG carrying
      `OpcodeList3` (the local one from Adobe DNG Converter has none), and
      Sony, Fujifilm, OM and Panasonic RAWs with lens corrections in the maker
      notes.
- [ ] **S** · **Windows installer art**: the kit's sidebar (164×314) and
      banner (150×57) need rendering to BMP only if the installer becomes
      assisted (`oneClick: false`).
- [ ] **S** · **Behaviour calls** for Pass 11 (B&W mask colour; partial
      presets).

---

## Done

Kept for reference: what was built, and where.

### Closed in the 2026-10-01 re-plan

- [x] **Enhance in the published engine**: the 0.15.0 binding reports
      `hasEnhance()` true; Enhance runs on the engine's bundled ONNX Runtime.
- [x] Red-eye / pet-eye correction: done in Phase 6 (dragged ellipses).
- [x] Healing / clone / content-aware fill: done in Phase 6. Generative remove
      waits on E29; visualise spots is Pass 38.
- [x] Lens corrections (profiles, manual, defringe): Phases 4 and 12. File
      corrections are Passes 47–49; fisheye waits on E18.
- [x] Transform/Upright: Phase 5. Spots under a warp are Pass 39.
- [x] Re-check the engine hosts' libuv pools: the sweep found the pools (8
      interactive, 4 background) aren't the bottleneck; thread
      oversubscription is (Passes 15, 31).
- [x] `tests/indexer.test.ts` on Node 26: passes now (19/19, five runs); the
      underlying exifr FileHandle leak is Pass 9.

### Before a first release

- [x] **In-app updates**: electron-updater against the GitHub releases
      (`src/main/updater.ts`), Stable/Beta in Settings. macOS updates start
      working once the builds are signed.
- [x] **Settings** (⌘, / Ctrl+,): updates, crash reports, legal links
      (`src/renderer/src/views/Preferences.tsx`); Help menu with the legal pages.
- [x] **Opt-in crash reporting** (`src/main/crash.ts`): asked once at first
      launch. Minidumps and scrubbed JSON reports to
      `pixlfoundation.com/api/crash`.
- [x] **Third-party notices** (`pnpm notices` → `build/THIRD_PARTY_NOTICES.txt`,
      shipped and opened from Settings/Help, copied to
      pixlfoundation.com/legal/third-party/).
- [x] CI, release-please and the release builds (GitHub-hosted, per-arch) are
      set up as in space-pixl; unsigned until the signing secrets exist.

### Business: licensing and accounts

- [x] Licence keys, 3-device activation, a 14-day trial and a 30-day offline
      grace, against Lemon Squeezy's licence API (`src/shared/licence.ts`,
      `src/main/licence.ts`, Settings → Licence; tests in
      `tests/licence.test.ts`). **Not enforced**: `LICENCE_ENFORCED` is false,
      and the Licence section only shows in development or with
      `PLAYROOM_LICENCE_UI=1`.
- [x] Remembering the wheel's tool per photo (index setting
      `wheel.byPhoto`, `src/renderer/src/develop/wheelMemory.ts`; Crop is
      never restored). Keyboard focus in the glass popovers: focus moves in
      on open and back on close, menus take arrow keys, Home and End.

### Masks and local tools

- [x] Auto Mask off the main thread: it runs on the brush worker
      (`src/renderer/src/workers/brush.worker.ts`), on the GPU with a CPU
      fallback.
- [x] Mask presets (a mask's sliders and Amount, index setting
      `mask.presets`); renaming components; an overlay colour per mask.
- [x] Brush planes by reference: `src/main/planestore.ts` swaps PNGs for
      refs across IPC; the index keeps them in its `planes` table.
- [x] AI masks, Select Subject and Background: U²-Net(p) through the
      engine's `segment` (Phase 7); the job side (`main/ai/segment.ts`:
      stages, progress, cancel, the plane into the plane store) is built, and
      `PLAYROOM_FAKE_AI=1` runs it with a stand-in plane.

### Develop

- [x] Per-photo auto WB across a batch (`library.autoWb`,
      `src/main/autowb.ts`; Cmd/Ctrl+Shift+U, the Library's Auto WB, or
      "Auto per photo" in Sync), with history per photo and Undo.
- [x] White balances across kinds: saved WB presets and develop presets keep
      the engine's white (`src/shared/wbconvert.ts`) and convert between a
      RAW's absolute Kelvin and relative sliders.
- [x] Auto tone tuned: gentler and scene-aware (flat vs hot frames, low- and
      high-key targets; `src/shared/auto.ts`, `tests/auto.test.ts`).
- [x] Colour mixer "point colour": the HSL panel's Point tab, up to 8
      picked colours compiled to engine `Qualifier` ops.
- [x] Targeted adjustment tool (T): drag on the photo to move the HSL band
      or the curve under the pointer (`src/shared/tat.ts`).
- [x] Tone curve presets (built-in and saved, `src/shared/curves.ts`).
- [x] Output sharpening on export, after the resize, in the same engine
      pass (`output_sharpen`; Screen / Matte / Glossy × Low / Standard / High).
- [x] Cancellation of an in-flight render: a newer edit stops a settled
      render and what follows it, a newer 1:1 region the last one, Cancel
      the file being exported, and Enhance between model tiles (engine
      0.15's signal, checked between stages — a RAW decode still finishes).
- [x] The histogram comes from the render itself (`measure`, engine 0.15).
- [x] **Interactive edit history.** Every step can be hidden, shown or
      deleted from any position (`src/shared/history.ts`, the History pane);
      hiding or deleting a step that made a mask takes the steps that use it
      along, after asking; Undo hides the newest visible step and Redo shows
      it again.
- [x] Edit history stored as diffs: the index keeps a base recipe and a
      patch per step; older whole-recipe rows convert when first read.
- [x] `.pixl` projects: one photo's edits in one SQLite file (recipe, virtual
      copies, snapshots, history, mask planes, preview; embedding the
      original), documented in `docs/pixl-format.md`.

### Library and workflow

- [x] Catalog: a sources sidebar (folders, pinned folders, collections,
      keywords, duplicates); manual collections, smart collections with
      nested rules (`src/shared/smart.ts`) and sets, exported and imported as
      JSON; hierarchical keywords; search and filters by metadata; stacks
      (kept in the sidecar); exact and near duplicates (SHA-1, dHash).
- [x] Metadata editing: title, caption, copyright and keywords written to
      `.xmp` sidecars through ExifTool (`IMG.xmp` for a RAW, `IMG.jpg.xmp`
      otherwise; originals are never written), in the Library's Info drawer
      and Develop's Info pane; embedded into exports, with "copyright only"
      and "remove location".
- [x] **Open with Pixl Playroom**: `fileAssociations` on macOS
      (`LSHandlerRank: Alternate`), `open-file` and a second instance's argv
      (`src/main/open.ts`), surviving the display-scale relaunch; the photo
      opens in Develop.
- [x] Watermarks on export (Phase 11).

### Branding

The PIXL Brand Kit design canvas holds the source for all of this; the SVG
masters are in `build/brand/`.

- [x] Document icons from the kit's "Files Playroom opens" board, for RAW,
      DNG, JXL, HEIC, TIFF, JPEG, PNG, WebP and AVIF (`pnpm doc-icons` →
      `build/doc-icons/`), handed to `fileAssociations`.
- [x] Website: playroom.pixlfoundation.com, in the pixl-web repo (one
      Cloudflare Worker for every PIXL site); media rebuilt from here by
      `scripts/site-media.sh`, tool screenshots by `scripts/site-tools.mjs`.
      `site/` is only a redirect from the old GitHub Pages address. Downloads
      say "Soon" until the first release.

### Upgrade to pixl-engine 0.15.0

- [x] Phase 1 — the port, no change in output: request shapes brought up to
      0.15 (`Framing.outside` with a straighten, `Vignette.style`,
      `Curves.refine_saturation`, HDR `limit: 'Clip'`, `AnalyzeRequest.hdr`
      as an `HdrSignal`, `gain_map: 'Base'` for iPhone HEIC and UltraHDR
      originals, HEIF `matrix` — BT.601 as libheif assumed, BT.2020 wide or
      HDR, Identity lossless); Screen, Overlay, Soft and Hard Light blend on
      the PQ signal in an HDR pipeline (0.14 refuses them above white);
      Enhance on the engine's bundled ONNX Runtime and the new `UpscalerRef`
      (fetch-ai fetches only the model now); the Engine tool left the wheel
      for View ▸ Engine Report… (Ctrl+Alt+E).
- [x] Phase 2 — cancel in-flight renders, 1:1 regions, exports and
      Enhance; the histogram, hue chart, "before" ghosts, auto tone and HDR
      histogram measured by the render itself (`measure`); one-pass
      `output_sharpen`; the eyedropper and Auto WB take the engine's own
      neutral white (`whiteBalanceFromPixel`).
- [x] Phase 3 — Refine Saturation under the RGB point curve; the vignette's
      paint-overlay style (HDR photos keep highlight priority: the engine
      refuses paint over white); Additive Colour — light in Colour grading
      and masks (linear sRGB, in the linear stage), a wash in Effects
      (Display P3 code values, before the grain) — with Neutralise and
      Match pickers that sample the shown picture in Display P3 and add
      onto what is there (`src/shared/addcolor.ts`).
- [x] Native `ParametricCurve`: not adopted (see E19 and "Waiting on the
      engine").
- [x] Phase 4 — the Lens tool (after Detail): lens profiles
      (`src/shared/lens.ts`: JSON, Lensfun's poly3/poly5/ptlens distortion,
      linear/poly3 TCA and `pa` vignetting, matched on the file's lens model,
      interpolated by focal length, vignetting at the nearest aperture;
      imported into `userData/lens-profiles/`, the resolved correction kept
      in the recipe), Remove CA measured on the original
      (`suggestLateralCa`, radial scale about the centre), manual
      distortion and vignetting (profile and manual vignetting multiply into
      one polynomial), defringe with a fringe picker. A warp crops its empty
      edges (`Outside::Crop`), keeping the frame's shape, so crops and masks
      stay fractions of it; 1:1 regions and the eyedropper are mapped into
      the corrected frame (`lensFrame`). Match in Additive Colour takes its
      target from a wheel or a hex too.
- [x] Phase 5 — Upright in Crop & Rotate (`src/shared/upright.ts`): Off /
      Auto (Full, else Vertical, else Level) / Level / Vertical / Full from
      `suggestUpright` on the large proxy, Guided from two to four lines
      (`uprightFromLines`, drawn on the frame before the warp), and the
      Transform sliders on top. The engine's homography is reproduced
      exactly, so masks, pins and pickers map through it, and the crop is
      fitted to the corrected picture as the engine would; the photo's
      centre is kept at the canvas centre (a re-aimed camera slides it). A
      suggestion that keeps under a quarter of the frame, or tilts past 40°,
      is refused and Auto tries the next. The crop tool shows the warp whole,
      its empty corners transparent (a PNG preview with alpha; mask planes
      wait while it is open).
- [x] Preview speed with lens corrections: a lens warp (distortion, CA,
      vignetting) cost ~1 s per settled 2.5K render and again for "before"
      and the mask renders (IMG_1750.CR2: 2.0 s). The correction is now
      baked once into lens-corrected proxies (`ensureLensedProxies`, per
      correction, beside the plain ones) and previews grade those; while a
      lens slider moves the draft corrects live, and a settled change bakes
      in the background. Same photo: 0.57–0.88 s settled, ~0.17 s drafts.
      Graded thumbnails render from the draft proxy. Engine 0.15 itself is
      as fast as 0.13 for the same work.
- [x] Phase 6 — the Heal tool (after Masks; Q): heal, clone and
      content-aware fill as round spots or painted strokes, Photoshop's way:
      a heal or clone starts with its source on the spot and is dragged to
      where it copies from (live), or Alt-click sets the source first and
      later spots keep the offset (aligned); outlines go once a spot is set
      (hover or H shows them); "Find a source automatically" asks
      `suggestHealSource`. Red eye and pet eye as dragged ellipses. Spots are
      stored in the base frame like masks (`src/shared/retouch.ts`), a source
      that would read outside the frame is pulled back inside, and spots are
      baked into the prepared proxies with the lens correction, so they cost
      nothing per render once placed. Not in Sync or presets by default.
- [x] Phase 7 — AI models on demand: the engine's roster
      (`@xuckless/pixl-models`), downloaded into `userData/models` from
      `models.pixlfoundation.com/<id>/<version>/<file>` (resumable, checked
      against the roster's SHA-256), listed in Settings → AI models with
      size, licence and training-data caveat; the provider test (engine
      `benchmark`) picks CoreML/DirectML or the CPU. Select Subject and
      Background run U²-Net(p) through the engine's `segment` on the
      lens-corrected proxy (CPU: faster than compiling for CoreML for one
      run). Enhance ×2 takes its model from the store; `fetch-ai`,
      `resources/ai` and the release step are gone; every model is credited
      in the notices from the roster.
  - [x] **Before release:** the models are mirrored in R2 (`pixl-models`,
        `models.pixlfoundation.com`), including NAFNet, the two FBCNNs and
        Real-ESRGAN general WDN, which have no public upstream.
        `PLAYROOM_MODELS_URL` points at another mirror (`file://` works) for
        development.
- [x] Phase 8 — AI denoise in Detail (a cached denoised master). Classic | AI
      in Noise reduction; SCUNet or DRUNet with strength; an AI job makes a
      denoised draft (the loupe switches at once) then a 16-bit master and
      proxies from it (`src/main/ai/denoise.ts`), kept per photo, model and
      strength (three sets per photo). Develop, the 1:1 region, thumbnails and
      export use it; the renderer (`lib/denoise.ts`) starts or restarts the
      job when the settings ask for something not made. SCUNet cannot load
      under CoreML (ONNX Runtime refuses a reshape) and falls back to the CPU.
- [x] Phase 9 — Enhance on the wheel (JPEG restore, deblur, upscale ×2/×4).
      `panels/enhance.tsx` replaces the dialog; `shared/enhance.ts` plans the
      chain (JpegReconstruct → FBCNN → NAFNet → Upscale), sizes and times it
      (per-step ms/MP, learned); `main/enhance.ts` runs it into
      `<stem>-Enhanced.tif`. A model the accelerator cannot load moves to the
      CPU alone (`ModelStore.withCpuFallback`, per model).
- [x] Phase 10 — HDR gain maps: read, grade and write. The grid's HDR badge
      (probe kind, kept per file version: migration 3); SDR | HDR for
      gain-map photos (recipe `gainMap`, a PQ master of the applied map,
      `hdrsource.ts`; switching reopens the session); the Headroom overlay
      (`Inspect::Headroom`); export mode SDR + gain map (`sdr` rendition +
      `encode.gain_map`) and a Clip / Roll-off limit with its knee.
      Fixed on the way: HDR grades flattened everything above white (the
      exposure shoulder and tone curves ending at 1), and HEIF/AVIF photos
      were turned twice (libheif applies `irot`; the EXIF tag is now ignored,
      and older sideways working copies are remade).
- [x] Phase 11 — export watermark. `shared/watermark.ts` places a PNG
      (anchor, inset and size as shares of the shorter edge, opacity, blend)
      in whole output pixels and hands the engine an `overlays` entry; the
      export dialog's Watermark section previews it on the first photo; it is
      kept in the last settings and in export presets. SDR files blend in
      sRGB, HDR ones (Keep, Expand, SDR + gain map) on the PQ signal.
- [x] Phase 12 — real lens profiles. Lensfun's database (1557 lenses, 1057
      cameras) converted by `scripts/lensfun-profiles.mjs` into
      `resources/lens-profiles` (bundled, works offline) and, with `--bucket`,
      uploaded to R2 (`lens-profiles/v1/`); `main/lensprofiles.ts` loads the
      newer of the bundled and the downloaded catalogue, checks the server at
      start and every 6 h, downloads only changed shards (SHA-256), swaps the
      set in whole and tells the renderer, which re-resolves photos on a
      profile. Matching (maker prefix and punctuation aside, focal range,
      mount, the calibration closest to the photo's crop) and resolving are
      in main; Lensfun's coefficients stay as calibrated, placed on each
      photo by the engine's `Focal` unit from the two crop factors (EXIF's
      35 mm focal, else the camera list) and aspects. Paste, sync and presets
      re-resolve each target at its own lens and focal length. Credit and
      CC BY-SA 3.0 text in the notices.
  - [x] **R2**: bucket `pixl-models` with `models.pixlfoundation.com`
        attached; the lens catalogue (version 9f8904d4) and the models are
        published there. See `.github/RELEASING.md`.

### Upgrade to pixl-engine 0.13.0

- [x] Pinned 0.13.0; `AnalyzeRequest.hdr`, `ImageStats.range_max` and
      `bindingVersion()` mirrored in `src/shared/engine-types.ts`.
- [x] Version guard: a `VersionMismatch` at load reaches the engine banner
      by name; `build/after-pack.mjs` fails a build whose platform package
      version differs from the base package's.
- [x] Qualifier blur: `smoothnessRadius` already clamps against the full
      frame, so region renders are unaffected; an oversize radius in an
      Advanced layer shows the engine's field in the render error.
- [x] HDR: auto white balance works on PQ/HLG photos (linear analysis with
      `hdr`; before, the fallback would have been refused by 0.13), and a
      settled render of an HDR photo carries an HDR histogram (the graded
      draft as an HDR export holds it, drawn in stops, reference white
      marked, headroom shaded; the HDR chip switches views).
- [x] Enhance on HDR: refused up front with a reason per photo; the dialog
      lists every failure.

### Engine gaps fixed upstream

- [x] Grading a single-channel source: fixed in engine 0.13.0 (grey
      sources are graded through a grey profile). Playroom has no grey
      export yet; check one when it gets one.
- [x] Qualifier blur edges inside a region: fixed in engine 0.13.0 (the
      key's blur is exact inside a region, at any thread count).
