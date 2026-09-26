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
- [x] UI/UX pass: the OLED/purple design system, two-tier bars, the spine
      rail, the thumb-wheel with one tool at a time, liquid glass, the
      three.js processing sphere and ambient gradient, Lightroom-style masks.
- [ ] Design polish still open: a light theme; user-reorderable tools on the
      wheel; remembering the wheel's tool per photo; keyboard focus rings
      audited across the glass popovers.

## Masks and local tools

Done in the UI pass: the Lightroom masks panel (thumbnails, components with
Add / Subtract / Intersect, the tool picker), linear and radial gradients
with on-canvas pins, per-mask Amount, range Smoothness, overlay modes and
colour, show all masks, pins Auto/Always/Never, the overlay at 1:1, brushes
A/B/erase with flow, density and pen pressure, a colour Auto Mask, and
editable lasso points.

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
      brush (Auto Mask is colour-only today, host-side on the preview).
- [ ] Brush: intersect-with brushes; Auto Mask off the main thread (a worker
      over the picture in Lab) for very large brushes.
- [ ] Mask presets; per-component overlay colour; renaming components.
- [ ] Brush planes travel inside every recipe update; send them once and
      refer to them by hash.
- [ ] Healing / clone / content-aware remove (spot removal, generative
      remove), with visualise spots.
- [ ] Red-eye / pet-eye correction.

## Develop

- [ ] **Industry-standard white balance fixer**: learned auto WB (a colour
      constancy model, e.g. FFCC or a small CNN) beside today's grey-pixel ∩
      grey-world estimate; per-photo auto WB across a batch (today a batch
      gets one photo's WB copied: Ctrl+Shift+S → White balance only); saved
      WB presets are done (WB menu → Save current as preset…), but are kept
      per kind (absolute for RAWs, relative otherwise) with no conversion.
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
- [ ] **An index worker**, as VS Code keeps its shared process: the SQLite
      index and all sidecar reads and writes in a `worker_threads` worker
      that owns the `DatabaseSync`, with `Library` and `Store` async across
      the bridge. Today they run on the main process (in transactions, with
      prepared statements reused), so a large folder scan or batch edit
      still holds up IPC while it runs.
- [ ] Edit history stored as diffs against the previous entry rather than
      whole recipes.

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

## Engine gaps found while building this

- [ ] Grading a single-channel source fails in the engine. Playroom's
      proxies are always RGB, so it only bites a grey export.
- [ ] Region + straighten; qualifier blur edges inside a region (engine).
- [ ] Dehaze memory (~580 MB at 24 MP), vignette styles beyond highlight
      priority, calibrating the new ops' constants against a reference.
