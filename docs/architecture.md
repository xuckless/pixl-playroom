# How it fits together

<sub>[README](../README.md) · [Features](features.md) · [How it fits together](architecture.md) · [Development](development.md) · [Keys](keys.md) · [The .pixl format](pixl-format.md)</sub>

```text
renderer (React)  ──IPC──>  main process ──postMessage──> utility process "interactive" ─> @xuckless/pixl-engine
   panels, loupe             library, thumbnails,            (previews, analysis)
   tools, charts             render sessions, export,     utility process "background" ─> @xuckless/pixl-engine
                             AI jobs, pixl:// cache          (thumbnails, exports, masters)
                                                          utility process "ai" ─> @xuckless/pixl-engine
                                                             (Select Subject, AI denoise, Enhance: one job at a time)
                                                          utility process "select" ─> @xuckless/pixl-engine
                                                             (SAM 2.1: Objects, Sky, Find object; asleep when idle)
                                                          utility process "index" ─> node:sqlite, projects, ExifTool
                                                             (folder scans, exif, .xmp, .pixl projects, collections, presets, settings)
```

- **The recipe** (`src/shared/recipe.ts`) is what the sliders hold, in
  photographer's units, and what the project stores.
- **The compiler** (`src/shared/compile.ts`) is the only place those units
  get meaning: recipe → engine `Grade` + `Framing`. Edits run in PixlRGB, the
  engine's 32-bit float working space, whose primaries enclose the whole
  visible range: every camera colour, and every colour in sRGB, Display P3,
  Adobe RGB and Rec.2020, is a positive number and is never clipped by the
  space it is edited in. Pure, tested.
- **Proxies** (`src/main/proxy.ts`): each photo is decoded once (a RAW
  developed once, by LibRaw in the engine) into a 16-bit upright proxy
  (≤ 2560 px), a mid copy (≤ 1920 px) and a draft (≤ 1280 px); a RAW whose
  colour-filter cells are more than the proxy needs is developed at half size
  (one pixel per cell, no demosaic: about 40% faster, a third of the memory on
  a large file), never its master, 1:1 or export. Every preview grades those —
  a lens correction baked into a corrected copy of them once it settles, so no
  preview warps again. Masks and radii are fractions of the frame, so a
  preview and an export select and blur the same things.
- **Render sessions** (`src/main/render.ts`): coalesced renders (a moving
  slider renders the draft, the full proxy follows when it settles; both JPEG,
  measured as they render); a newer edit cancels a settled render at the
  engine's next stage; the before render; mask planes via `Inspect`; 1:1
  regions via `Region`, framed as the preview is; the eyedropper via a 5×5
  region in linear sRGB and the engine's `whiteBalanceFromPixel`.
- **Projects** (`<photo>.pixl`, `src/main/project/pixlfile.ts`; format in
  `docs/pixl-format.md`) are the truth about a photo: recipe, virtual copies,
  snapshots, rating, flag, label, stack, its whole edit history, painted mask
  planes, a preview and, by default, the original itself, so a folder copied or
  synced carries its edits. A project is one SQLite file, written
  transactionally with a rollback journal (never WAL). It goes beside the photo
  or in a projects folder (Settings). The descriptive metadata lives in a
  standard `.xmp` sidecar, so other apps read it too (`src/main/indexer/xmp.ts`,
  ExifTool through `exiftool-vendored`, unpacked from the asar in a build). The
  index (`node:sqlite`, `src/main/db.ts`) mirrors both for speed and keeps what
  has no better home: collections, presets, export presets and settings. Its schema
  moves forward by numbered migrations (`PRAGMA user_version`). The original
  is never written.
- **The library's rules** (`src/shared/smart.ts`) are one predicate for smart
  collections and the filter bar (`src/shared/filter.ts`); stacks
  (`src/shared/stacks.ts`), duplicates (`src/shared/dupes.ts`) and keywords
  (`src/shared/keywords.ts`) are pure and tested the same way.
- **The index host** (`src/main/indexer/`), as VS Code keeps its shared
  process: every index query and sidecar read or write runs in a utility
  process, one request at a time in the order sent, so batches are one
  transaction and main never blocks on a folder scan. Opening a folder
  answers from the index at once and rescans after, announcing only
  changes. A crash restarts it; calls wait for it.
- **Rendering scale** (`src/main/display.ts`): on a scaled Mac display
  (Retina), View ▸ Rendering chooses Ultra (the app and the picture at 1×),
  Performance (1.5×, scaled by macOS: every blur and glass filter costs about
  half as many pixels) or Native. Performance is the default. Chromium takes the scale
  only from its command line, so a packaged build starts itself again with
  it; in dev pass it yourself: `pnpm dev -- --force-device-scale-factor=1.5`.
  While a live edit re-renders the photo, the liquid glass drops its lens
  (`data-interacting` on the root) and the loupe swaps pictures unfaded.
- **Off the main threads**, as VS Code keeps its UI thread free: mask planes
  (brush planes turned, and a gradient an older version gave an edge
  rasterised; other gradients are the engine's own shapes) run in a
  `worker_threads` pool (`src/main/workers/`); the brush paints in a worker on
  the GPU (WebGL2 on the loupe's transferred canvas, `workers/brush.worker.ts`);
  the liquid glass's lens maps are drawn in a worker; the clipping overlay is
  a shader. Brush planes cross IPC by reference (`src/main/planestore.ts`), so
  a slider drag sends kilobytes whatever is painted.
- **White balance** (`src/shared/wb.ts`) mirrors the engine's locus model
  exactly, so absolute RAW Kelvin, relative sliders, Auto (grey pixels, grey
  world when too few) and the eyedropper all become the one `WhiteBalance`
  op; `src/shared/wbconvert.ts` moves a white between the two kinds of units.
- **Opening from outside** (`src/main/open.ts`): one instance; Finder's
  `open-file`, a second launch's arguments and the command line queue until
  the renderer has booted, and survive the display-scale relaunch.
