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
- [ ] UI/UX pass (explicitly out of scope for this pass).

## Masks and local tools (industry standard, not in this pass)

- [ ] Linear gradient and radial gradient masks (the engine's `MaskShape` is
      shaped for them; needs the variants in the engine).
- [ ] AI masks: Select Subject, Select Sky, Select Background, Select People
      (face/skin/hair/eyes/lips/teeth/clothes), Object selection by
      brush/box — a segmentation model through the engine's `enhance` seam
      producing a raster plane.
- [ ] Depth range mask (needs a depth map: iPhone HEIC/ProRAW auxiliary
      images, or a monocular depth model).
- [ ] Brush: auto-mask (edge-aware), density vs flow, pen pressure,
      separate A/B brushes, mask intersect-with brushes.
- [ ] Mask refinement: edge-aware refine (guided filter), per-component
      overlay colour, show all masks, mask presets.
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
- [ ] 1:1 view of a straightened/cropped photo: the region view shows the
      uncropped, unrotated frame (the engine refuses a region with a
      straighten); needs a canvas-space region in the engine.
- [ ] Cancellation of an in-flight render (the engine is synchronous; a
      stale render finishes and is dropped).

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
