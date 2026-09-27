# TODO — Pixl Playroom

Everything the first pass deliberately left out, and what it found along the
way. Grouped by area; roughly in priority order within each.

## Before a first release

- [ ] **Enhance in the published engine.** The published binding is built
      without the engine's Enhance support, so `hasEnhance()` is false and
      Enhance says so; the release still bundles the runtime and model.
- [ ] **Signing and updates**: CI, release-please and the release builds
      (GitHub-hosted, per-arch, `pnpm fetch-ai` per target) are set up as in
      space-pixl, but builds are unsigned until the signing secrets exist
      (see `.github/RELEASING.md`), and there is no in-app updater yet
      (electron-updater against the release feed, as space-pixl has).
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
      a grey plane stored as a raster component.
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
      constancy model, e.g. FFCC or a small CNN) beside today's grey-pixel ∩
      grey-world estimate; per-photo auto WB across a batch (today a batch
      gets one photo's WB copied: Ctrl+Shift+S → White balance only); saved
      WB presets converted across kinds (today they are kept per kind:
      absolute for RAWs, relative otherwise).
- [ ] Auto tone heuristics tuning (currently strong on overcast frames:
      highlights −80, blacks −60 on the CR2 fixture); an adaptive/learned auto.
- [ ] Highlight recovery on RAW: rawler clips at sensor white; reconstruct
      clipped channels before the develop's clamp (engine).
- [ ] Profiles: camera-matching profiles (DCP support), Adobe-compatible
      `.xmp` profiles, profile browser with previews.
- [ ] Lens corrections: distortion, chromatic aberration, vignetting from a
      profile database (lensfun) and manual; defringe.
- [ ] Transform/Upright: perspective correction (vertical, horizontal, auto,
      guided), scale, aspect.
- [ ] Colour mixer "point colour" (Lightroom's newer targeted colour tool).
- [ ] Targeted adjustment tool (drag on the photo to move a curve or HSL
      band).
- [ ] Tone curve: per-channel parametric, curve presets.
- [ ] Output sharpening on export (after the resize: needs a second pass or
      an engine post-resample sharpen).
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

- [ ] Catalog features: collections, smart collections, keywords (with
      hierarchy), people, map/GPS, search by metadata, stacks, duplicates.
- [ ] Recursive folders / folder tree, watch folders for changes.
- [ ] Metadata editing: title, caption, copyright, keywords written to
      XMP; export options "copyright only" and "remove location" (the engine
      copies metadata blocks verbatim, so this needs host-side EXIF/XMP
      writing).
- [ ] XMP sidecar interop (read/write Lightroom `crs:` settings where they
      map).
- [ ] Compare view (two photos side by side) and survey view.
- [ ] Batch rename, move/copy/delete to trash.
- [ ] Watermarks, print module, slideshow, web gallery, book.
- [ ] Tethered capture.
- [ ] History persisted with the recipe in the sidecar (today the index keeps
      it; moving a folder to another machine keeps snapshots but not
      history).

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
