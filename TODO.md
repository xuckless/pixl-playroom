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

- [x] Licence keys, 3-device activation, a 14-day trial and a 30-day offline
      grace, against Lemon Squeezy's licence API (`src/shared/licence.ts`,
      `src/main/licence.ts`, Settings → Licence; tests in
      `tests/licence.test.ts`). **Not enforced**: `LICENCE_ENFORCED` is false,
      and the Licence section only shows in development or with
      `PLAYROOM_LICENCE_UI=1`.
- [ ] The Lemon Squeezy store: create it, the Playroom product with an
      activation limit of 3, then set `LS_PRODUCT` (store and product ids) in
      `src/shared/licence.ts` so other products' keys are refused. Test with a
      test-mode key (`PLAYROOM_LICENCE_UI=1` in a packaged build).
- [ ] Enforcement, once checkout is live: decide what an ended trial and an
      unconfirmed licence (`revalidate`) lock (exports? the whole Develop
      view?), gate it with `allows()` and flip `LICENCE_ENFORCED`. The trial's
      start lives in `licence.json`, which deleting resets; if that matters,
      record trials on the server by device.
- [ ] Lost devices: the app can only free its own place. Until the website
      account lists devices, freeing a lost one is by email (the account page
      says so).
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
- [x] Output sharpening on export, after the resize, in the same engine
      pass (`output_sharpen`; Screen / Matte / Glossy × Low / Standard / High).
- [ ] Portrait RAWs: IMG_3086.CR2 (EXIF "Rotate 270 CW") shows and exports
      landscape; check how the RAW's orientation reaches the develop.
- [ ] Engine: every JPEG export writes a malformed APP1 (the `Exif\0\0`
      header twice), so EXIF is unreadable until the exporter's ExifTool
      pass repairs it (`repairJpegExif` in `src/main/exiftool.ts`). Fix it
      in the engine's JPEG writer and the repair becomes a no-op.
- [ ] Engine: this build has no HEIC encoder ("libheif has no encoder"), so
      HEIC export fails.
- [ ] Raw-domain noise reduction (engine). (AI denoise: Phase 8.)
- [ ] Soft proofing (output profile preview + gamut warning).
- [ ] HDR preview on HDR displays (render PQ AVIF / PNG cICP to the loupe);
      the loupe shows HDR photos tone mapped for SDR today. (Grading in HDR,
      the HDR histogram and gain-map export: Phase 10.)
- [ ] Merge to HDR / panorama / HDR panorama; focus stacking.
- [ ] ProRAW and DNG gain maps (engine).
- [ ] Sharpening/NR previews at fit size (today sharpening is shown only when
      its radius is ≥ half a proxy pixel, i.e. at 1:1).
- [ ] Sharp zoom of a straightened photo: the zoomed loupe enlarges the
      preview instead (the engine refuses a region with a straighten);
      needs a canvas-space region in the engine.
- [x] Cancellation of an in-flight render: a newer edit stops a settled
      render and what follows it, a newer 1:1 region the last one, Cancel
      the file being exported, and Enhance between model tiles (engine
      0.15's signal, checked between stages — a RAW decode still finishes).
- [ ] **Preview round trip.** The histogram now comes from the render
      itself (`measure`, engine 0.15); the preview is still written as a
      JPEG and decoded by the loupe. Hand the renderer raw pixels
      (`Encode::Pixels`, 0.15) over a `MessagePort` into a canvas, with no
      file and no decode.
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

## Upgrade to pixl-engine 0.15.0

Phased; each phase is tested and committed before the next.

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
- [ ] Native `ParametricCurve`: not adopted. At ±1 the engine moves a
      region by half the gap to its neighbour (0.0625 at the default
      splits); Playroom's own curve moves 0.25, so switching would weaken
      every existing region edit about fourfold. Revisit if the engine takes
      a strength, or with a recipe migration that rescales the sliders.
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
  - [ ] 1:1 sharp tiles with a warp or a straighten (the engine renders a
        region only of the plain frame).
- [x] Preview speed with lens corrections: a lens warp (distortion, CA,
      vignetting) cost ~1 s per settled 2.5K render and again for "before"
      and the mask renders (IMG_1750.CR2: 2.0 s). The correction is now
      baked once into lens-corrected proxies (`ensureLensedProxies`, per
      correction, beside the plain ones) and previews grade those; while a
      lens slider moves the draft corrects live, and a settled change bakes
      in the background. Same photo: 0.57–0.88 s settled, ~0.17 s drafts.
      Graded thumbnails render from the draft proxy. Engine 0.15 itself is
      as fast as 0.13 for the same work.
  - [ ] Upright's focal length from the 35 mm equivalent only; a file that
        states only the real focal length and no crop factor gets 35 mm.
- [x] Phase 6 — the Heal tool (after Masks; Q): heal, clone and
      content-aware fill as round spots or painted strokes, Photoshop's way:
      a heal or clone starts with its source on the spot and is dragged to
      where it copies from (live), or Alt-click sets the source first and
      later spots keep the offset (aligned); outlines go once a spot is set
      (hover or H shows them); "Find a source automatically" asks
      `suggestHealSource`. Red eye and pet eye as dragged ellipses. Spots are stored in
      the base frame like masks (`src/shared/retouch.ts`), a source that would
      read outside the frame is pulled back inside, and spots are baked into
      the prepared proxies with the lens correction, so they cost nothing per
      render once placed. Not in Sync or presets by default.
  - [ ] AI Remove: needs an inpainting model we can ship (LaMa's weights
        were trained on Places2, non-commercial).
  - [ ] Spots under an Upright warp are placed round on the unwarped frame
        and show as circles on the warped one (close, not exact).
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
  - [ ] **Before release:** run `pnpm publish-models --bucket <bucket>` (your
        GitHub Packages token and `wrangler login`) and point the
        `models.pixlfoundation.com` custom domain at the bucket. Until then the
        app falls back to each file's public upstream (Hugging Face, rembg's
        GitHub releases; same checksum), which covers six of the ten; NAFNet,
        the two FBCNNs and Real-ESRGAN general WDN are only in the engine's
        private release and wait for the mirror. `PLAYROOM_MODELS_URL` points
        at another mirror (`file://` works) for development.
  - [ ] Sky: no sky model in the roster yet.
- [x] Phase 8 — AI denoise in Detail (a cached denoised master). Classic | AI
      in Noise reduction; SCUNet or DRUNet with strength; an AI job makes a
      denoised draft (the loupe switches at once) then a 16-bit master and
      proxies from it (`src/main/ai/denoise.ts`), kept per photo, model and
      strength (three sets per photo). Develop, the 1:1 region, thumbnails and
      export use it; the renderer (`lib/denoise.ts`) starts or restarts the
      job when the settings ask for something not made. SCUNet cannot load
      under CoreML (ONNX Runtime refuses a reshape) and falls back to the CPU.
  - [ ] SCUNet on the CPU is ~27 s/MP (a 24 MP RAW takes ~10 min): ask the
        engine for a CoreML-loadable SCUNet export, or an fp16 one.
  - [ ] DRUNet's `MeasuredNoise` gain (1.33) under-states synthetic
        per-channel noise (halves σ 7 rather than removing it); check it on
        high-ISO RAWs and expose a Noise level override if needed.
  - [ ] Virtual copies share the photo's denoise sets; pruning keeps the
        newest three, which a copy with other settings may lose (it rebuilds).
- [x] Phase 9 — Enhance on the wheel (JPEG restore, deblur, upscale ×2/×4).
      `panels/enhance.tsx` replaces the dialog; `shared/enhance.ts` plans the
      chain (JpegReconstruct → FBCNN → NAFNet → Upscale), sizes and times it
      (per-step ms/MP, learned); `main/enhance.ts` runs it into
      `<stem>-Enhanced.tif`. A model the accelerator cannot load moves to the
      CPU alone (`ModelStore.withCpuFallback`, per model).
  - [ ] A before/after preview of a crop before running (the engine refuses
        `region` with a chain: crop to a temp file first; a JPEG rebuild needs
        the whole file).
  - [ ] FBCNN is ~50 s/MP on the CPU and CoreML cannot load it: ask the engine
        for a CoreML-loadable export.
  - [ ] A long-edge limit for ×4 (the request's `resize` after the chain).
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
  - [ ] HEIC gain-map export needs the engine's HEIC encoder (this build has
        none; JPEG and AVIF work).
  - [ ] A LUT profile flattens an HDR photo's highlights (a table is 0…1):
        HDR-aware profiles, or the table on the SDR range only.
  - [ ] Exporting an SDR-edited gain-map photo drops its map; carry the
        original map (or remake it) so the export stays HDR-capable.
  - [ ] Existing edits on HEIC photos were placed on the sideways frame
        (crops, masks): they now land turned. Offer to rotate them once.
- [x] Phase 11 — export watermark. `shared/watermark.ts` places a PNG
      (anchor, inset and size as shares of the shorter edge, opacity, blend)
      in whole output pixels and hands the engine an `overlays` entry; the
      export dialog's Watermark section previews it on the first photo; it is
      kept in the last settings and in export presets. SDR files blend in
      sRGB, HDR ones (Keep, Expand, SDR + gain map) on the PQ signal.
  - [ ] Text watermarks (a copyright line typed in the dialog): render the
        text to a PNG in the renderer (canvas) and hand it over as a file.
  - [ ] A watermark per preset folder of logos (light and dark versions,
        chosen by the picture's brightness under the mark).
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
  - [ ] **R2**: `npx wrangler login`, then `pnpm lens-profiles --bucket
    <bucket>` (and `pnpm publish-models --bucket <bucket>`), and attach
        `models.pixlfoundation.com` to the bucket (it has no DNS record yet).
        See `.github/RELEASING.md`.
  - [ ] Corrections the file carries: DNG `OpcodeList3` (WarpRectilinear →
        the engine's `Rectilinear`, `FarthestCorner`; FixVignetteRadial →
        `Multiply` at `Corrected`), read with ExifTool; then Sony, Fujifilm,
        Olympus/OM and Panasonic maker-note distortion and vignetting. Needs
        sample files (the one local DNG, from Adobe DNG Converter, carries no
        OpcodeList3).
  - [ ] Adobe LCP import (the user's own, not redistributable): LCP's
        perspective model and `Focal` unit map directly.
  - [ ] Lensfun lens-centre offsets (`<center>`, unused in today's data) and
        its focal-spline interpolation (we interpolate linearly).
  - [ ] Fisheye lenses: their distortion is left out (it needs a projection
        change the engine does not make); TCA and vignetting apply.
  - [ ] Constrain Crop off (keep the warped frame's empty corners as
        transparent) needs an alpha preview path; today a warp always crops.
- [ ] HEIC export: the published engine's libheif has no HEVC encoder
      (`EncoderUnavailable`); AVIF works.

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
- [ ] Dehaze memory (~580 MB at 24 MP), a colour-priority vignette style
      (the engine has highlight priority and paint overlay), calibrating the
      new ops' constants against a reference.
