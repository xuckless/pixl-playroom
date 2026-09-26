# Pixl Playroom

A photo developer — the Lightroom kind — built on the **PIXL engine**. Every
pixel on screen is a real engine render of the photo with its recipe, through
the same compiler an export uses; the histogram and the colour-concentration
chart are the engine's `analyze` of exactly what is shown.

A near-black, matte-purple interface built around the photo: two slim bars,
a rail that folds to a spine, one tool at a time chosen on a thumb-wheel, and
liquid-glass controls floating over the picture.

## What it does

**Library** — open a folder (no import step; files stay where they are): grid
with engine thumbnails (a RAW's embedded preview until it is edited, the graded
picture after), ratings (0–5), pick/reject flags (P/X/U), colour labels (6–9),
filter/sort, virtual copies, copy/paste/sync settings to a selection, batch
export, Enhance.

**Develop**

| Panel          | What                                                                                                                                                                                                                                                                                                                                | Engine                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Profile        | Neutral, Playroom Standard, Vivid, Monochrome, any imported `.cube` (with amount)                                                                                                                                                                                                                                                   | `Curves`, `Vibrance`, `Lut`                         |
| White balance  | As shot / Auto / eyedropper / Custom / saved presets; RAWs show absolute Kelvin from the camera's as-shot white and offer Daylight, Cloudy…; copy to a batch with Sync → White balance only                                                                                                                                         | `WhiteBalance` (Bradford), `probe().as_shot_white`  |
| Tone           | Exposure (with a highlight shoulder for positive values), Contrast, Highlights, Shadows, Whites, Blacks, Auto                                                                                                                                                                                                                       | `Primary`, 1D `Lut`, `Tone`                         |
| Presence       | Texture, Clarity, Dehaze, Vibrance, Saturation                                                                                                                                                                                                                                                                                      | `LocalContrast` ×2, `Dehaze`, `Vibrance`, `Primary` |
| Tone curve     | Parametric (4 regions, movable splits) and point curves (RGB, R, G, B)                                                                                                                                                                                                                                                              | `Curves`                                            |
| HSL / B&W mix  | 8 bands × hue/sat/lum; B&W mix                                                                                                                                                                                                                                                                                                      | `HslBands`, `Primary`                               |
| Colour grading | Shadows/midtones/highlights/global wheels, blending, balance                                                                                                                                                                                                                                                                        | `ColorGrade`                                        |
| Detail         | Sharpening (amount, radius, detail, masking); noise reduction (luminance/colour + detail); measured noise σ̂                                                                                                                                                                                                                         | `Sharpen`, `Denoise`, `analyze(noise)`              |
| Effects        | Post-crop vignette (fitted to the crop, follows the straighten), grain (seeded)                                                                                                                                                                                                                                                     | `Vignette`, `Grain`                                 |
| Calibration    | Shadows tint; red/green/blue primary hue & saturation                                                                                                                                                                                                                                                                               | `ChannelMixer`, `Primary`                           |
| Crop & rotate  | Crop tool with aspect presets, straighten, rotate left/right, flip                                                                                                                                                                                                                                                                  | `Framing`                                           |
| Masks          | Lightroom's masks panel (thumbnails; components joined by Add / Subtract / Intersect); brush A/B/erase with flow, density, pressure and Auto Mask; linear and radial gradients with pins; editable lasso; colour & luminance ranges with smoothness; Amount, blend, opacity, invert, 17 local sliders; five overlay modes, show all | `GradeLayer`, `Mask`, `Inspect::LayerMask`          |
| Advanced       | The last render's engine report line by line, the compiled grade JSON, and custom layers written directly in the engine's terms (any op, any stage space, CDL, qualifiers)                                                                                                                                                          | the whole `Grade` model                             |

**Scopes** — RGB histogram with clipping markers and overlay (J), and the
**colour-concentration chart**: 36 hue bins (10° each), bars coloured by hue
and mean saturation, the _before_ picture's bars as dashed ghosts behind, a
masked-region mode that measures inside the selected mask, click a bar to
focus its HSL band, Shift-click to make a colour-range mask there.

**Viewing** — before (\\), split before/after (Y), zoom from fit to 400%
(pinch, wheel, Z for 100%) with every tool still on the photo, the part in
view rendered sharp by the engine from the full-resolution frame,
crop with composition guides (thirds, grid, golden, diagonal) and
drag-outside-to-straighten, a fine grid while straightening, clipping
overlay, brush cursor, lasso and gradient handles.

**Interface** — two tiers (identity: photo, frame, engine status; tools:
library, history, view modes, copy, enhance, export). The left rail is a
spine of Presets, Snapshots, History and Info, one pane at a time, folding to
the spine. The right column pins the scopes above a thumb-wheel that turns
through the ten tools (scroll, drag, click, arrows, Ctrl+1…9) and shows one
at a time. The filmstrip waits under the loupe until its glass chip is
clicked. Liquid glass (an SVG refraction filter as the backdrop filter) on
the loupe's badges and bars, the wheel, dialogs, pins and popovers; a
three.js processing sphere over long operations and a shader gradient behind
empty views, with CSS fallbacks and reduced-motion stills.

**Workflow** — undo/redo and a history list (per photo, kept in the index),
snapshots (in the sidecar), presets (built-in and saved, each carrying chosen
groups), copy/paste/sync (Ctrl+C / Ctrl+V / Ctrl+Shift+S) — e.g. white balance
only, to a batch.

**Export** — chosen folder (or beside each original), subfolder, filename
template (`{name} {seq} {date} {rating} {copy} {ext}`), JPEG/PNG/TIFF/WebP/
AVIF/JPEG XL/HEIC with each codec's knobs, bit depth, resize (long/short edge,
width, height, megapixels, percent), colour space + intent + BPC, metadata
blocks, dither, HDR (tone map HDR sources, keep HDR, expand SDR to PQ/HLG),
export presets, batch with progress and cancel.

**Enhance → Super Resolution** — ×2 with the bundled Real-ESRGAN model on the
bundled ONNX Runtime (CoreML on macOS, CPU elsewhere, DirectML on Windows when
a DirectML runtime is bundled) into a new 16-bit TIFF beside the original,
which starts with the source's recipe.

## How it fits together

```
renderer (React)  ──IPC──>  main process ──postMessage──> utility process "interactive" ─> @xuckless/pixl-engine
   panels, loupe             library, thumbnails,            (previews, analysis)
   tools, charts             render sessions, export,     utility process "background" ─> @xuckless/pixl-engine
                             enhance, pixl:// cache          (thumbnails, exports, masters, enhance)
                                                          utility process "index" ─> node:sqlite, sidecars
                                                             (folder scans, exif, history, presets, settings)
```

- **The recipe** (`src/shared/recipe.ts`) is what the sliders hold, in
  photographer's units, and what the sidecar stores.
- **The compiler** (`src/shared/compile.ts`) is the only place those units
  get meaning: recipe → engine `Grade` + `Framing`. Physics (white balance,
  calibration, exposure, a RAW's noise) runs in the engine's linear working
  space; the look runs display-referred in Display P3. Pure, tested.
- **Proxies** (`src/main/proxy.ts`): each photo is decoded once (a RAW
  developed once) into a 16-bit upright proxy (≤ 2560 px) and a draft
  (≤ 1280 px); every preview grades those. Masks and radii are fractions of
  the frame, so a preview and an export select and blur the same things.
- **Render sessions** (`src/main/render.ts`): coalesced renders (a moving
  slider renders the draft, the full proxy follows when it settles; both
  JPEG), each followed by `analyze`; the before render; mask planes via `Inspect`; 1:1
  regions via `Region`; the eyedropper via a 5×5 region in linear sRGB.
- **Sidecars** (`<photo>.playroom.json`, `src/main/sidecar.ts`) are the
  truth: recipe, snapshots, virtual copies, rating, flag, label. The index
  (`node:sqlite`, `src/main/db.ts`) mirrors them for speed and keeps history,
  presets, export presets and settings. The original is never written.
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
  (gradients rasterised, brush planes turned) run in a `worker_threads`
  pool (`src/main/workers/`); the brush paints in a worker on
  the GPU (WebGL2 on the loupe's transferred canvas, `workers/brush.worker.ts`);
  the liquid glass's lens maps are drawn in a worker; the clipping overlay is
  a shader. Brush planes cross IPC by reference (`src/main/planestore.ts`), so
  a slider drag sends kilobytes whatever is painted.
- **White balance** (`src/shared/wb.ts`) mirrors the engine's locus model
  exactly, so absolute RAW Kelvin, relative sliders, Auto (grey pixels ∩ grey
  world) and the eyedropper all become the one `WhiteBalance` op.

## Running

The engine is `@xuckless/pixl-engine`, a private package of compiled
binaries on GitHub Packages (macOS and Windows), so installing needs a token
with `read:packages` for it; see `.github/RELEASING.md`.

```sh
pnpm install
pnpm fetch-ai            # ONNX Runtime + Real-ESRGAN for this platform (Enhance)
pnpm dev                 # the app
pnpm test                # the pure modules (compiler, white balance, orientation)
pnpm typecheck && pnpm lint && pnpm build
```

`node scripts/drive.mjs` drives the built app for automation: a hidden,
offscreen-rendered window with a throwaway profile (`PLAYROOM_HIDDEN=1`,
`PLAYROOM_USER_DATA`), commands on stdin (`launch`, `folder <path>`,
`open <name>`, `edit <js on r>`, `stroke x,y x,y…`, `drag x,y x,y [--render]`,
`tap x,y… [--dbl]`, `wheel <selector> <dy>`, `panel <tool>`, `ss <name>`,
`eval <js>`).

## Keys

| Key                      | Where          | Does                                                                   |
| ------------------------ | -------------- | ---------------------------------------------------------------------- |
| G / Esc                  | develop        | back to the library (Esc first leaves a tool, then the zoom)           |
| Enter / D                | library        | develop the focused photo                                              |
| ← →                      | both           | previous / next photo                                                  |
| 0–5, P X U, 6–9          | both           | rating, pick / reject / unflag, colour label                           |
| Ctrl+Z / Ctrl+Shift+Z    | develop        | undo / redo                                                            |
| Ctrl+C / Ctrl+V          | develop / both | copy settings / paste onto the selection                               |
| Ctrl+Shift+S             | both           | sync settings (choose groups)                                          |
| Ctrl+Shift+E             | both           | export                                                                 |
| Ctrl+'                   | develop        | virtual copy                                                           |
| \\ , Y                   | develop        | before, split before/after                                             |
| J                        | develop        | clipping overlay                                                       |
| Z                        | develop        | fit ↔ 100% at the pointer (double-click the photo too)                 |
| Pinch, wheel             | develop        | zoom at the pointer, fit to 400%                                       |
| Two fingers, Space+drag  | develop        | pan the zoomed photo (a plain drag too, with no tool)                  |
| Ctrl+= / Ctrl+- / Ctrl+0 | develop        | zoom in / out / fit                                                    |
| Ctrl+1…9, Ctrl+↑/↓       | develop        | pick / turn the tool wheel                                             |
| R, W                     | develop        | crop tool, white-balance picker                                        |
| B/K, L, M, Shift+M       | develop        | brush, lasso, linear, radial gradient (a new mask if none is selected) |
| O                        | develop        | mask overlay (in the crop tool: cycle guides)                          |
| H                        | develop        | mask pins: auto, always, never                                         |
| [ ], Alt                 | develop        | brush size, erase while held                                           |
| Shift+A                  | develop        | auto tone                                                              |

See `TODO.md` for everything not in this pass.

## Source

This repository is public so the app can be read: how a slider becomes an
engine operation, what a mask selects, what is written to disk. It cannot be
built without the PIXL engine, a private, compiled component distributed only
as binaries to the app's own build pipeline.

<sub>Copyright © 2026 xuckless. All rights reserved. The source is published
for reference only; see [LICENSE](LICENSE). The PIXL engine is a separate,
closed component and is not made available through this repository.</sub>
