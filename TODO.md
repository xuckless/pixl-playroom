# TODO — Pixl Playroom

Everything the first pass deliberately left out, and what it found along the
way. Grouped by area; roughly in priority order within each.

## Before a first release

- [ ] **Enhance in the published engine.** The published binding is built
      without the engine's Enhance support, so `hasEnhance()` is false and
      Enhance says so; the release still bundles the runtime and model.
- [ ] **Code signing**: CI, release-please and the release builds
      (GitHub-hosted, per-arch, `pnpm fetch-ai` per target) are set up as in
      space-pixl, but builds are unsigned until the signing secrets exist. The
      steps (Apple Developer ID and notarization; Azure Trusted Signing or an
      OV/EV certificate on Windows) are in `.github/RELEASING.md`. Start now:
      both take days.
- [x] **In-app updates**: electron-updater against the GitHub releases
      (`src/main/updater.ts`), Stable/Beta in Settings. macOS updates start
      working once the builds are signed.
- [x] **Settings** (⌘, / Ctrl+,): updates, crash reports, legal links
      (`src/renderer/src/views/Preferences.tsx`); Help menu with the legal pages.
- [x] **Opt-in crash reporting** (`src/main/crash.ts`): asked once at first
      launch. Minidumps and scrubbed JSON reports to
      `pixlfoundation.com/api/crash`.
  - [ ] Somewhere to keep them: the Worker only logs a summary. Store them in
        R2 with a retention period (and put that period in the privacy policy),
        or send them to Sentry (its Electron SDK can take over from
        `crashReporter`); symbol files for minidumps either way.
- [x] **Third-party notices** (`pnpm notices` → `build/THIRD_PARTY_NOTICES.txt`,
      shipped and opened from Settings/Help, copied to
      pixlfoundation.com/legal/third-party/).
- [ ] **Legal pages**: licence agreement and privacy policy are drafts on
      pixlfoundation.com/legal/ (pixl-web `src/legal/`). Fill in the
      [bracketed] parts (legal entity, jurisdiction, address, refunds, what a
      finished trial does, crash-report retention) and have a lawyer review
      both before launch.
- [ ] `tests/indexer.test.ts` fails on Node 26 ("A FileHandle object was
      closed during garbage collection"), on `main` too; CI's Node 22 passes.
      Close the FileHandle explicitly in the indexer.

## Licensing compliance (before selling)

Found while writing the third-party notices; needs a lawyer's view before the
first paid release.

- [ ] **jpegxl-sys is GPL-3.0-or-later** (0.12.1 in pixl-engine's Cargo.lock)
      and is compiled into the engine, which ships inside a proprietary app.
      libjxl itself is BSD-3-Clause; only the Rust binding crate is GPL. Likely
      fix in the engine: replace it with our own bindgen bindings to libjxl
      (the engine already wraps it in `src/encode/jxl.rs`).
- [ ] **rawler is LGPL-2.1** (0.7.2), statically linked into the engine.
      Static linking under the LGPL means users must be able to relink with a
      modified rawler (object files or source for the rest). Options: ship the
      engine's object files on request, move RAW decoding into a separately
      loaded library, or confirm with the author.
- [ ] A complete list of the engine's Rust crates and their licences, from
      its own release build (`cargo about` in pixl-engine), merged into
      `build/third-party.json` instead of the one summary line there now.

## Business: licensing and accounts

- [ ] Licence keys, 3-device activation and a 14-day trial (Lemon Squeezy),
      and the website account that manages them: Phase 5 of the web and
      release plan.
- [ ] Update policy in writing: 1.x updates included, major versions a
      discounted paid upgrade (the EULA draft says so).
- [ ] AI harness (MCP, bring your own agent; every agent action a history
      step tagged with actor and run ID) and the cloud tiers and credits.
- [ ] **Windows DirectML**: bundle a DirectML build of ONNX Runtime (the
      GitHub zip is CPU-only; the provider falls back to the CPU and says so).
- [ ] Design polish still open: a light theme; user-reorderable tools on the
      wheel.
- [x] Remembering the wheel's tool per photo (index setting
      `wheel.byPhoto`, `src/renderer/src/develop/wheelMemory.ts`; Crop is
      never restored). Keyboard focus in the glass popovers: focus moves in
      on open and back on close, menus take arrow keys, Home and End.

## Masks and local tools

- [ ] **Engine-native gradient shapes.** Linear and radial gradients are
      drawn by the host into 512 px raster planes (`src/shared/gradients.ts`,
      cached in the photo's cache) and reach the engine as `Raster` masks.
      Add `MaskShape::Linear { start, end }` and `MaskShape::Radial { centre,
    radii, angle, softness }` to the engine so they are resolution-free at
      export, then retire the planes and their cache.
- [ ] **AI masks**: Select Subject, Select Sky, Select Background (their
      entries are in the tool picker, disabled until a model ships), Select
      People (face/skin/hair/eyes/lips/teeth/clothes), Objects by brush or
      box. A segmentation model (e.g. U²-Net/ISNet for subject, a sky model)
      fetched by `pnpm fetch-ai`, run on the bundled ONNX Runtime (a mask
      seam beside the engine's `enhance` upscaler, or in the host), producing
      a grey plane stored as a raster component. The job side is built:
      `main/ai/segment.ts` is the runner (stages, progress, cancel, the plane
      into the plane store, the mask applied to its photo), and
      `PLAYROOM_FAKE_AI=1` runs it with a stand-in plane; what is missing is
      the model itself, in a utility process that cancelling can kill.
- [ ] **Depth range mask** (its picker entry is disabled): a depth map from
      iPhone HEIC/ProRAW auxiliary images or a monocular depth model, and a
      `MaskShape::DepthRange` in the engine.
- [ ] Other engine mask shapes: a luminance/colour range keyed on a smoothed
      plane (guided-filter refine) rather than a box blur; an edge-aware
      brush (Auto Mask is colour-only today).
- [ ] Brush: intersect-with brushes.
- [x] Auto Mask off the main thread: it runs on the brush worker
      (`src/renderer/src/workers/brush.worker.ts`), on the GPU with a CPU
      fallback.
- [x] Mask presets (a mask's sliders and Amount, index setting
      `mask.presets`); renaming components; an overlay colour per mask.
- [ ] Per-component overlay colour: needs a rendered plane per component
      (the overlay is one plane per mask today).
- [x] Brush planes by reference: `src/main/planestore.ts` swaps PNGs for
      refs across IPC; the index keeps them in its `planes` table.
- [ ] Healing / clone / content-aware remove (spot removal, generative
      remove), with visualise spots.
- [ ] Red-eye / pet-eye correction.

## Develop

- [ ] **Layer-based editing.** Every manipulation can be its own layer:
      the user adds a layer (exposure, a curve, an HSL move, a colour
      grade, a LUT…), and each layer has a name, visibility, opacity, a
      blend mode, an optional mask and a place in an ordered stack that can
      be reordered, duplicated, grouped and deleted. Today the global panels
      are one flat set of sliders per recipe, and only masked local
      adjustments (`LocalLayer`) are layers. Needs a layer stack in the
      recipe (with a migration of today's global settings to a base layer),
      the compiler emitting one engine stage per layer in stack order, a
      layers panel in develop, and per-layer copy/paste, sync and presets.
- [ ] **Industry-standard white balance fixer**: learned auto WB (a colour
      constancy model, e.g. FFCC or a small CNN) beside today's grey-pixel
      estimate (grey-world when too few grey pixels).
- [x] Per-photo auto WB across a batch (`library.autoWb`,
      `src/main/autowb.ts`; Cmd/Ctrl+Shift+U, the Library's Auto WB, or
      "Auto per photo" in Sync), with history per photo and Undo.
- [x] White balances across kinds: saved WB presets and develop presets keep
      the engine's white (`src/shared/wbconvert.ts`) and convert between a
      RAW's absolute Kelvin and relative sliders.
- [x] Auto tone tuned: gentler and scene-aware (flat vs hot frames, low- and
      high-key targets; `src/shared/auto.ts`, `tests/auto.test.ts`).
- [ ] An adaptive/learned auto tone.
- [ ] Highlight recovery on RAW: rawler clips at sensor white; reconstruct
      clipped channels before the develop's clamp (engine).
- [ ] Profiles: camera-matching profiles (DCP support), Adobe-compatible
      `.xmp` profiles, profile browser with previews.
- [ ] Lens corrections: distortion, chromatic aberration, vignetting from a
      profile database (lensfun) and manual; defringe.
- [ ] Transform/Upright: perspective correction (vertical, horizontal, auto,
      guided), scale, aspect.
- [x] Colour mixer "point colour": the HSL panel's Point tab, up to 8
      picked colours compiled to engine `Qualifier` ops.
- [x] Targeted adjustment tool (T): drag on the photo to move the HSL band
      or the curve under the pointer (`src/shared/tat.ts`).
- [x] Tone curve presets (built-in and saved, `src/shared/curves.ts`).
- [ ] Tone curve: per-channel parametric (the region sliders are master only).
- [x] Output sharpening on export, as a second engine pass after the resize
      (Screen / Matte / Glossy × Low / Standard / High).
- [ ] Portrait RAWs: IMG_3086.CR2 (EXIF "Rotate 270 CW") shows and exports
      landscape; check how the RAW's orientation reaches the develop.
- [ ] Engine: every JPEG export writes a malformed APP1 (the `Exif\0\0`
      header twice), so EXIF is unreadable until the exporter's ExifTool
      pass repairs it (`repairJpegExif` in `src/main/exiftool.ts`). Fix it
      in the engine's JPEG writer and the repair becomes a no-op.
- [ ] Engine: this build has no HEIC encoder ("libheif has no encoder"), so
      HEIC export fails.
- [ ] AI denoise and raw-domain noise reduction (engine).
- [ ] Soft proofing (output profile preview + gamut warning).
- [ ] Full HDR editing and preview: render HDR previews (PQ AVIF / PNG cICP)
      on HDR displays, an HDR histogram, grade HDR sources in HDR (engine
      `HdrWorking` with PQ look stages), gain-map (ISO 21496-1) export.
- [ ] Merge to HDR / panorama / HDR panorama; focus stacking.
- [ ] ProRAW and DNG gain maps (engine).
- [ ] Sharpening/NR previews at fit size (today sharpening is shown only when
      its radius is ≥ half a proxy pixel, i.e. at 1:1).
- [ ] Sharp zoom of a straightened photo: the zoomed loupe enlarges the
      preview instead (the engine refuses a region with a straighten);
      needs a canvas-space region in the engine.
- [ ] Cancellation of an in-flight render (the engine is synchronous; a
      stale render finishes and is dropped).
- [ ] **Preview round trip.** Each preview is written to disk as a JPEG,
      decoded again by `analyze` for the histogram, and a third time by the
      loupe. Have `convert` return the histogram itself (an engine change),
      and in time hand the renderer raw RGBA over a `MessagePort` into a
      canvas, with no file and no decode.
- [ ] A ~1920 px proxy between the draft and the 2560 proxy, if a Retina
      loupe in Native mode still waits on settled renders.
- [ ] Re-check the engine hosts' libuv pools (8 interactive, 4 background)
      against the calls actually in flight.
- [x] **Interactive edit history.** Every step can be hidden, shown or
      deleted from any position (`src/shared/history.ts`, the History pane);
      hiding or deleting a step that made a mask takes the steps that use it
      along, after asking; Undo hides the newest visible step and Redo shows
      it again.
- [x] Edit history stored as diffs: the index keeps a base recipe and a
      patch per step; older whole-recipe rows convert when first read.
- [ ] Folder watching in the index host (today a folder is rescanned when it
      is opened or refreshed; changes made outside the app appear then).

## Library and workflow

- [x] Catalog: a sources sidebar (folders, pinned folders, collections,
      keywords, duplicates); manual collections, smart collections with
      nested rules (`src/shared/smart.ts`) and sets, exported and imported as
      JSON; hierarchical keywords; search and filters by metadata; stacks
      (kept in the sidecar); exact and near duplicates (SHA-1, dHash).
- [ ] Catalog: people, map/GPS.
- [ ] Collections import adds copies; merging into existing collections of
      the same name is not offered.
- [ ] Recursive folders / folder tree, watch folders for changes.
- [x] Metadata editing: title, caption, copyright and keywords written to
      `.xmp` sidecars through ExifTool (`IMG.xmp` for a RAW, `IMG.jpg.xmp`
      otherwise; originals are never written), in the Library's Info drawer
      and Develop's Info pane; embedded into exports, with "copyright only"
      and "remove location".
- [ ] XMP sidecar interop (read/write Lightroom `crs:` settings where they
      map).
- [ ] Compare view (two photos side by side) and survey view.
- [ ] Batch rename, move/copy/delete to trash.
- [ ] Watermarks, print module, slideshow, web gallery, book.
- [ ] Tethered capture.
- [ ] History persisted with the recipe in the sidecar (today the index keeps
      it; moving a folder to another machine keeps snapshots but not
      history).
- [x] **Open with Pixl Playroom**: `fileAssociations` on macOS
      (`LSHandlerRank: Alternate`), `open-file` and a second instance's argv
      (`src/main/open.ts`), surviving the display-scale relaunch; the photo
      opens in Develop.
- [ ] Windows "Open with": `build/installer.nsh` (OpenWithProgids, never the
      default) has never been compiled or run; check it on a Windows machine
      (see `.github/RELEASING.md`).

## Branding

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
- [ ] Windows installer art: the kit's installer sidebar (164×314) and
      banner (150×57) are unused while the NSIS installer is one-click, which
      shows neither. They need rendering to BMP if the installer becomes
      assisted (`oneClick: false`).

## Upgrade to pixl-engine 0.13.0 (done)

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
- [ ] Enhance on HDR by tone mapping to SDR first, then upscaling as a
      second conversion (output SDR).

## Engine gaps found while building this

- [x] Grading a single-channel source: fixed in engine 0.13.0 (grey
      sources are graded through a grey profile). Playroom has no grey
      export yet; check one when it gets one.
- [ ] Region + straighten (engine). Still open in 0.13.0.
- [x] Qualifier blur edges inside a region: fixed in engine 0.13.0 (the
      key's blur is exact inside a region, at any thread count).
- [ ] Dehaze memory (~580 MB at 24 MP), vignette styles beyond highlight
      priority, calibrating the new ops' constants against a reference.
