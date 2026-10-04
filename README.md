# Pixl Playroom

**Website:** https://playroom.pixlfoundation.com (source in the
[pixl-web](https://github.com/xuckless/pixl-web) repo; its media are rebuilt from here with
`scripts/site-media.sh`)

A photo developer — the Lightroom kind — built on the **PIXL engine**. Every
pixel on screen is a real engine render of the photo with its recipe, through
the same compiler an export uses; the histogram and the colour-concentration
chart are the engine's measurement of exactly what is shown, taken as it
renders.

A near-black, matte-purple interface built around the photo: two slim bars,
a rail that folds to a spine, the adjustments as folding cards under a tool
strip, and liquid-glass controls floating over the picture.

## What it does

**Library** — open a folder (no import step; files stay where they are): grid
with engine thumbnails (a RAW's embedded preview until it is edited, the graded
picture after), sorted by name, capture time, date added, rating, file size or
edited first; ratings (0–5), pick/reject flags (P/X/U), colour labels (6–9),
virtual copies, copy/paste/sync settings to a selection, batch export, Enhance.

- **Sources sidebar** (\\ or Ctrl+Shift+L): folders (pinned and recent; one
  can be taken off the list, its photos left on disk), collections, keywords
  and duplicates; the grid shows whichever is chosen, across folders.
- **Collections** — manual ones (drag photos onto them), smart ones built from
  rules in nested all / any / none groups (rating, flag, label, kind, camera,
  lens, ISO, focal length, aperture, shutter, capture date, keywords, text,
  other collections…), and sets to hold both; exported and imported as JSON.
- **Metadata** — title, caption, copyright and hierarchical keywords
  ("Places › Canada › Winnipeg") in the Info drawer (I) and in Develop's Info
  pane, many photos at once. They are written to standard `.xmp` sidecars
  through ExifTool (`IMG_0001.xmp` beside a RAW, `IMG_0001.jpg.xmp` beside
  anything else); the original is never touched.
- **Search and filters** — text over names, titles, captions, keywords,
  camera and lens; filters for rating, flag, label, edits, camera, lens, RAW or
  not, ISO and focal ranges, dates and keyword. They mean exactly what the
  same rules mean in a smart collection.
- **Stacks** — stack a selection under a cover (Ctrl+G), open and close it
  (S), or auto-stack a folder by capture time; kept in each photo's sidecar,
  so a stack travels with the folder.
- **Duplicates** — exact copies (size and SHA-1) and near ones (a 64-bit
  difference hash of the thumbnail, with an adjustable distance), in a folder
  or the whole library.
- **Auto white balance per photo** across a selection (Ctrl+Shift+U, the
  toolbar's Auto WB, or "Auto per photo" in Sync), each photo measured on its
  own, with a history step each and one Undo for the batch.
- **Open with Pixl Playroom** — Finder's and Explorer's Open With (RAW, DNG,
  JPEG, TIFF, HEIC, PNG, WebP, AVIF, JPEG XL, each with its own document icon)
  opens the photo in Develop, in the running app if there is one. Playroom
  registers as an alternative only and never takes over a file type.

**Develop** — the right column holds every adjustment as a folding card, in
Lightroom Classic's order; above them a strip holds the canvas tools (Crop,
Heal, Masks).

| Card or tool        | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Engine                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile, treatment  | Above the cards: Colour or B&W; Neutral, Playroom Standard, Vivid, Monochrome, any imported `.cube` (with amount; an HDR photo's LUT keeps its headroom)                                                                                                                                                                                                                                                                                                              | `Curves`, `Vibrance`, `Lut`                                                                                                                   |
| White balance       | As shot / Auto / eyedropper / Custom / saved presets; RAWs show absolute Kelvin from the camera's as-shot white and offer Daylight, Cloudy…; a saved white (and a preset's) converts between a RAW's Kelvin and another photo's relative sliders; Sync copies it, converted, or measures each photo's own                                                                                                                                                             | `WhiteBalance` (Bradford), `probe().as_shot_white`                                                                                            |
| Light               | Exposure (with a highlight shoulder for positive values), Contrast, Highlights, Shadows, Whites, Blacks, Auto (scene-aware: a flat, overcast frame gets contrast, not a highlight pull)                                                                                                                                                                                                                                                                               | `Primary`, 1D `Lut`, `Tone`                                                                                                                   |
| Presence            | Texture, Clarity, Dehaze                                                                                                                                                                                                                                                                                                                                                                                                                                              | `LocalContrast` ×2, `Dehaze`                                                                                                                  |
| Colour              | Vibrance, Saturation (and Hue, in a mask)                                                                                                                                                                                                                                                                                                                                                                                                                             | `Vibrance`, `Primary`                                                                                                                         |
| Colour mixer        | 8 bands × hue/sat/lum; B&W mix; Point colour (up to 8 colours picked off the photo, each shifted in hue, saturation and luminance with its own range); the targeted tool (T) drags the band under the pointer                                                                                                                                                                                                                                                         | `HslBands`, `Qualifier`, `Primary`                                                                                                            |
| Colour grading      | Shadows/midtones/highlights/global wheels, blending, balance; Add colour (coloured light, with Neutralise and Match pickers)                                                                                                                                                                                                                                                                                                                                          | `ColorGrade`, `AddColor`                                                                                                                      |
| Tone curve          | Parametric (4 regions, movable splits) and point curves (RGB, R, G, B) with Refine Saturation; built-in and saved curve presets; the targeted tool (T) drags the curve at the tone under the pointer                                                                                                                                                                                                                                                                  | `Curves` (`refine_saturation`)                                                                                                                |
| Detail              | Sharpening (amount, radius, detail, masking); noise reduction, Classic (luminance/colour + detail; measured noise σ̂) or AI (SCUNet blind / DRUNet measured, strength)                                                                                                                                                                                                                                                                                                 | `Sharpen`, `Denoise`, `analyze(noise)`, `enhance`                                                                                             |
| Effects             | Post-crop vignette (fitted to the crop, follows the straighten; highlight priority or paint overlay), colour wash (a lift toward a colour, with the same pickers), grain (seeded)                                                                                                                                                                                                                                                                                     | `Vignette`, `AddColor`, `Grain`                                                                                                               |
| Optics              | A profile for the lens the file names, found in the bundled Lensfun catalogue (1566 lenses, kept current from the models server) or imported, searchable, placed by the photo's crop factor and evaluated at its focal length, aperture and focus distance; Defish for a fisheye (its own projection, with Field 50–100%); Remove chromatic aberration, measured on the photo; manual distortion and vignetting; defringe (purple and green, on edges, with a picker) | `LensCorrection` (`Fisheye`), `suggestLateralCa`, `Defringe`                                                                                  |
| Geometry            | Upright (Auto, Level, Vertical, Full from the photo's lines; Guided from two to four drawn lines) and Transform sliders (vertical, horizontal, rotate, aspect, scale, offset), the photo kept centred and the crop fitted to the corrected picture                                                                                                                                                                                                                    | `Framing` (`transform`), `suggestUpright`, `uprightFromLines`                                                                                 |
| Calibration         | Shadows tint; red/green/blue primary hue & saturation                                                                                                                                                                                                                                                                                                                                                                                                                 | `ChannelMixer`, `Primary`                                                                                                                     |
| Crop (strip, R)     | Crop tool with aspect presets and straighten; rotate left/right, flip and guides on its floating bar                                                                                                                                                                                                                                                                                                                                                                  | `Framing`                                                                                                                                     |
| Masks (strip, M)    | The masks window (below)                                                                                                                                                                                                                                                                                                                                                                                                                                              | `GradeLayer`, `Mask`, `LinearGradient`, `RadialGradient`, `BidirectionalGradient`, `Refine`, `segment`, `segmentPrompt`, `Inspect::LayerMask` |
| Heal (strip, Q)     | Heal, clone and content-aware fill, Photoshop's way (click or paint, then drag from the spot to its source, live; or Alt-click a source first, later spots keep the offset), red eye and pet eye (drag over the pupil); outlines only while editing (hover or H shows them); a spot list; Q, H, ⌫, Enter, [ ]                                                                                                                                                         | `Retouch`, `suggestHealSource`                                                                                                                |
| Enhance (last card) | JPEG restore (rebuilt from the file's coefficients, or FBCNN blind / at a quality), deblur (NAFNet), super-resolution (×2 Real-ESRGAN, ×4 general or keep-texture) into a new 16-bit TIFF with the recipe                                                                                                                                                                                                                                                             | `enhance` (JpegReconstruct, Model, Upscale)                                                                                                   |
| Engine report       | View ▸ Engine Report… (Ctrl+Alt+E) or the toolbar's `</>`: the last render's engine report line by line, the compiled grade JSON, and custom layers written directly in the engine's terms (any op, any stage space, CDL, qualifiers)                                                                                                                                                                                                                                 | the whole `Grade` model                                                                                                                       |

**Masks** — a window that floats over the photo or docks beside it (M):
Lightroom's masks list (thumbnails; components joined by Add / Subtract /
Intersect, each mask with its own overlay colour). A selected mask edits with
every card but Optics and Geometry, plus Amount, blend and opacity. New masks
come from:

- **Automatic** — Subject and Background (U²-Net); **Objects** (SAM 2.1, on
  its own engine host): hover to see what lies under the pointer and click to
  take it, drag a box, or scribble over it; Shift-click adds a part, Alt-click
  takes one away, Enter keeps it, Esc drops it. **Sky** is one click on the
  sky (SAM 2.1) until a sky model ships. The People tools (body, face, hair,
  skin…) are marked "soon".
- **Draw** — brush A/B/erase with flow, density, pressure and Auto Mask;
  linear, radial and bidirectional gradients with pins (drawn by the engine,
  exact at any size); an editable lasso, whose Find object puts the object
  inside it in its place.
- **Range** — colour and luminance ranges with smoothness. Depth range is
  marked "soon" (it needs a depth map).

Snap to edges (with an Edge radius) holds a brush stroke, a lasso or an AI mask
to the photo's edges: on a brush, to the object it was painted on (SAM 2.1). A
tool whose model is missing offers it there, in a "Model needed" popup.
Overlay views: Molten glass (the default: a pane of clear glass over the
photo, a solid line along a sharp edge), colour overlay (on B&W too), image on
black or white, white on black, outline; show all, or each component in its
own colour.

**Scopes** — RGB histogram with clipping markers and overlay (J), and the
**colour-concentration chart**: 36 hue bins (10° each), bars coloured by hue
and mean saturation, the _before_ picture's bars as dashed ghosts behind, a
masked-region mode that measures inside the selected mask, click a bar to
open that colour in the Colour mixer, Shift-click to make a colour-range mask
there. The histogram's numbers wait behind its `</>`.

**Viewing** — before (\\), split before/after (Y), zoom from fit to 400%
(pinch, wheel, Z for 100%) with every tool still on the photo, the part in
view rendered sharp by the engine from the full-resolution frame (on a
straightened, cropped, Upright or lens-corrected photo too: the full render's
own pixels there), crop with composition guides (thirds, grid, golden,
diagonal) and drag-outside-to-straighten, a fine grid while straightening, clipping
overlay, brush cursor, lasso and gradient handles.

**Interface** — two tiers (identity: photo, frame, engine status; tools:
library, undo and redo, view modes, SDR | HDR, the masks window, engine
report, virtual copy, export). The left rail is a spine of Presets,
Snapshots, History and Info, one pane at a time, folding to the spine. The
right column pins the scopes above the tool strip (Crop, Heal, Masks; Jump
to, which opens a card and scrolls to it; and a solo switch, under which
opening a card folds the others), then the cards, each with an (i) note, a
dot when it is changed and a reset, and Enhance last; Crop's and Heal's
panels take the cards' place while their tool is in hand, and with a mask
selected only the cards a mask carries show. Ctrl+1…9 opens the first nine
cards, Ctrl+↑/↓ the previous or next. A slider is one glass bar with its
label and value inside: drag it (Alt is finer), click the value to type one,
double-click to reset, arrow keys to step. The filmstrip waits under the
loupe until its glass chip is clicked. Liquid glass (an SVG refraction filter
as the backdrop filter) on the loupe's badges and bars, dialogs, pins and
popovers; a three.js processing sphere over long operations and a shader
gradient behind empty views, with CSS fallbacks and reduced-motion stills.

**Workflow** — undo/redo and a history list (per photo, kept in the index),
snapshots (in the sidecar), saved presets (each carrying chosen groups; with
"Masks & local adjustments" or "AI denoise & deblur", those go as
instructions, made again on each photo the preset is applied to: ranges and
gradients as they are, a model's mask as what to ask the model for, a denoise
or deblur as a step scoped to its mask), copy/paste/sync (Ctrl+C / Ctrl+V /
Ctrl+Shift+S) — e.g. white balance only, to a batch, copied or measured per
photo.

**Looks** — 306 looks: 284 made with Playroom's own sliders (no bundled LUTs)
and 22 smart looks. Camera colour first (Fujifilm-, Leica-, Hasselblad-,
Canon-, Nikon-, Sony-, Ricoh-, Panasonic-inspired and more), then cinema
cameras and print film, colour and black-and-white film stocks, movies and TV,
smart looks, black and white, creative and essentials. Names are PIXL's own; a
camera, stock or film shows only as "Inspired by …", and PIXL is not
affiliated with their owners. Looks the sliders can only approximate
(halation, bloom) are marked ≈. The Presets rail keeps My Looks (reorder by
dragging) and the user's saved presets, with search; hovering a look shows it
on the loupe without saving. Browse opens the full catalog as cards of the
open photo with each look on it. Applying is one history step; the Applied
bar's Amount scales only what the look moved, and another look takes its place
in the same step (Alt puts it on top). A smart look also carries instructions
(`src/shared/looks/smart.ts`): masks made of parts (ranges, gradients, the
subject, the background, the sky, people's parts, an object), each with its
own settings and Amount, and AI steps (denoise, deblur) scoped to them;
applying one puts its sliders, ranges and gradients in at once and runs its
model work in order, with one progress bar and Cancel, and asks for a click or
a box where it needs an object pointed at. 18 of the 22 work on today's engine
once their models are downloaded; four wait for a people model (skin, eyes,
faces). The browser can show only the looks that work now. A look can travel
as a `pixl-look` file (`src/shared/looks/schema.ts`), the format a marketplace
will use.

**Export** — chosen folder (or beside each original), subfolder, filename
template (`{name} {seq} {date} {rating} {copy} {ext}`), JPEG/PNG/TIFF/WebP/
AVIF/JPEG XL/HEIC with each codec's knobs, bit depth, resize (long/short edge,
width, height, megapixels, percent), colour space + intent + BPC, metadata
blocks, dither, HDR (tone map HDR sources, keep HDR, expand SDR to PQ/HLG,
or SDR + gain map: UltraHDR JPEG, AVIF, HEIC; highlights clipped at the peak
or rolled off by BT.2390 from a chosen knee),
a watermark (a PNG at one of nine anchors, sized and inset by the
picture's shorter edge, with opacity and Normal / Multiply / Screen, previewed
on the photo and composited after the resize so it stays sharp), export
presets, batch with progress and cancel (it stops the file being
written). Output sharpening after the resize (Screen, Matte or Glossy × Low,
Standard or High), in the same engine pass.
The photo's title, caption, keywords and copyright are written into the file
(EXIF, XMP and IPTC, in the blocks kept), or only a copyright ("Copyright
only"), with a default copyright for photos that have none and "Remove
location" to strip GPS.

**Enhance** — the last card in the right column runs the engine's enhance
chain over the photo's original, in its fixed order: a JPEG rebuilt from its
DCT coefficients (no model) or FBCNN's JPEG restore, NAFNet's motion deblur,
then Real-ESRGAN ×2 or ×4. The result is a new 16-bit TIFF beside the original
(`-Enhanced`, numbered when taken), which starts with the source's recipe. The
panel shows the output size, the file size and a time estimate learned from
earlier runs, offers each missing model, and runs a selection as a batch.
Models run on the ONNX Runtime the engine ships (CoreML on macOS, DirectML on
Windows, or the CPU when the performance test finds it faster); one the
accelerator cannot load (FBCNN, SCUNet under CoreML) moves to the CPU on its
own.

**AI models** — none ships with the app: Settings → AI models downloads each
from models.pixlfoundation.com when wanted (resumable, checked against the
engine's roster), shows its size, licence, what is known about its training
data and how long it takes for a photo on this computer (measured on earlier
runs, else scaled by the speed test), marks the one Playroom recommends for
each task, and removes it. A tool that needs a missing model offers it right
there, in a "Model needed" popup, and goes on when it is here. Select Subject
and Background (Masks) run U²-Net; Objects, Sky and Find object run SAM 2.1.

**Lens profiles** — the app ships Lensfun's database (CC BY-SA 3.0) as its
lens catalogue, so every lens Lensfun knows is corrected offline (a fisheye
with its own projection, defished on request), and checks the models server
for a newer one at start and every six hours (only changed shards are
downloaded, each checked by SHA-256). The Lens panel matches the file's lens
(and, where the EXIF gives no 35 mm focal, the camera's crop factor from the
catalogue), shows what it found and at which crop, and searches the whole
catalogue by hand; imported JSON profiles come first. Pasting, syncing or a
preset re-resolves each photo at its own lens and focal length.
`pnpm lens-profiles` rebuilds the catalogue from Lensfun, `--bucket <name>`
publishes it.

**HDR and gain maps** — the grid marks HDR photos (a gain map, PQ or HLG).
A gain-map photo (an iPhone HEIC, an UltraHDR JPEG, an Apple JPEG) is edited
on its SDR picture, or with the toolbar's **SDR | HDR** on the HDR rendition
its map lifts it to: the map applied once at the file's headroom into a PQ
master (`src/main/hdrsource.ts`), which the loupe, the 1:1 view, the
thumbnails and the export then grade like any PQ photo, with the HDR
histogram. **Headroom** in the view bar colours where the picture rises
above white, amber to magenta at its peak. On an HDR photo the grade keeps
its highlights: positive exposure has no SDR shoulder, tone curves run on
past white, and a LUT profile keeps the headroom.

**AI denoise** — Detail → Noise reduction → AI runs SCUNet (blind, for real
camera noise) or DRUNet (told the noise it measures) over the photo once and
keeps the result under the photo's cache, per model and strength: a denoised
draft first (seconds; the loupe switches to it), then the full-resolution
master, from which the proxies are remade. Every view, the 1:1 region,
thumbnails and export then grade the denoised pixels, with the classic
denoise off; an export that finds no master makes it. HDR photos are refused.
A model the accelerator cannot load (SCUNet under CoreML) runs on the CPU.

**Updates** — Settings → Updates follows the stable or beta channel (a beta
build follows beta); an update downloads in the background and installs when
Playroom quits, or at once with Restart to update. The first launch after an
update says once, in a What's new popup, what it brought and what is coming
(`src/shared/releasenotes.ts`); Settings → Updates shows it again.

## How it fits together

```
renderer (React)  ──IPC──>  main process ──postMessage──> utility process "interactive" ─> @xuckless/pixl-engine
   panels, loupe             library, thumbnails,            (previews, analysis)
   tools, charts             render sessions, export,     utility process "background" ─> @xuckless/pixl-engine
                             AI jobs, pixl:// cache          (thumbnails, exports, masters)
                                                          utility process "ai" ─> @xuckless/pixl-engine
                                                             (Select Subject, AI denoise, Enhance: one job at a time)
                                                          utility process "select" ─> @xuckless/pixl-engine
                                                             (SAM 2.1: Objects, Sky, Find object; asleep when idle)
                                                          utility process "index" ─> node:sqlite, sidecars, ExifTool
                                                             (folder scans, exif, .xmp, collections, history, presets, settings)
```

- **The recipe** (`src/shared/recipe.ts`) is what the sliders hold, in
  photographer's units, and what the sidecar stores.
- **The compiler** (`src/shared/compile.ts`) is the only place those units
  get meaning: recipe → engine `Grade` + `Framing`. Physics (white balance,
  calibration, exposure, a RAW's noise) runs in the engine's linear working
  space; the look runs display-referred in Display P3. Pure, tested.
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
- **Sidecars** (`<photo>.playroom.json`, `src/main/sidecar.ts`) are the
  truth: recipe, snapshots, virtual copies, rating, flag, label, stack. The
  descriptive metadata lives in a standard `.xmp` sidecar, so other apps read
  it too (`src/main/indexer/xmp.ts`, ExifTool through `exiftool-vendored`,
  unpacked from the asar in a build). The index (`node:sqlite`,
  `src/main/db.ts`) mirrors both for speed and keeps what has no better home:
  history, collections, presets, export presets and settings. Its schema
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

## Running

The engine is `@xuckless/pixl-engine`, a private package of compiled
binaries on GitHub Packages (macOS and Windows), so installing needs a token
with `read:packages` for it; see `.github/RELEASING.md`.

```sh
pnpm install
pnpm dev                 # the app (pnpm dev -- /path/to/photo.CR2 opens a photo)
pnpm test                # the pure modules and the index (compiler, white balance, library rules…)
pnpm typecheck && pnpm lint && pnpm build
pnpm doc-icons           # re-render the document icons (build/doc-icons/)
scripts/site-media.sh    # rebuild the website's media (../pixl-web/public/)
```

`node scripts/drive.mjs` drives the built app for automation: a hidden,
offscreen-rendered window with a throwaway profile (`PLAYROOM_HIDDEN=1`,
`PLAYROOM_USER_DATA`), commands on stdin (`launch`, `folder <path>`,
`open <name>`, `settle`, `edit <js on r>`, `stroke x,y x,y…`,
`drag x,y x,y [--render]`, `tap x,y… [--dbl]`, `click <selector>`,
`mclick <selector> [--dbl]`, `mhover <selector>`, `mdrag <selector> <dx> [--alt]`,
`press <key>`, `wheel <selector> <dy>`, `reduced on|off`, `ss <name>`,
`eval <js>`, `wait <ms>`, `quit`).

AI models download on demand (Settings → AI models) from
models.pixlfoundation.com, mirrored there by `pnpm publish-models --bucket
<bucket>`; `PLAYROOM_MODELS_URL` points at another mirror (`file://` works) for
development, e.g. one made with `pnpm publish-models --dry-run --out <dir>`.
`window.__maskPreview` reports the loupe's own mask preview (`stats`, and
`read()` for its plane, to compare with the engine's).

## Keys

Every key can be changed in Settings → Key bindings; these are the defaults.

| Key                      | Where          | Does                                                                    |
| ------------------------ | -------------- | ----------------------------------------------------------------------- |
| G / Esc                  | develop        | back to the library (Esc first leaves a tool, then the zoom)            |
| Enter / D / E            | library        | develop the focused photo                                               |
| ← →                      | both           | previous / next photo                                                   |
| 0–5, P X U, 6–9          | both           | rating, pick / reject / unflag, colour label                            |
| Ctrl+Z / Ctrl+Shift+Z    | develop        | undo / redo                                                             |
| Ctrl+C / Ctrl+V          | develop / both | copy settings / paste onto the selection                                |
| Ctrl+A                   | library        | select all                                                              |
| Ctrl+Shift+S             | both           | sync settings (choose groups)                                           |
| Ctrl+Shift+E             | both           | export                                                                  |
| Ctrl+'                   | develop        | virtual copy                                                            |
| \\ , Y                   | develop        | before, split before/after                                              |
| J                        | develop        | clipping overlay                                                        |
| Z                        | develop        | fit ↔ 100% at the pointer (double-click the photo too)                  |
| Pinch, wheel             | develop        | zoom at the pointer, fit to 400%                                        |
| Two fingers, Space+drag  | develop        | pan the zoomed photo (a plain drag too, with no tool)                   |
| Ctrl+= / Ctrl+- / Ctrl+0 | develop        | zoom in / out / fit                                                     |
| Ctrl+1…9, Ctrl+↑/↓       | develop        | open one of the first nine cards; the previous / next card              |
| R, Q, W                  | develop        | crop tool, heal tool, white-balance picker                              |
| M                        | develop        | show or hide the masks window                                           |
| B/K, L, Shift+M, Alt+M   | develop        | brush, lasso, linear, radial gradient (a new mask if none is selected)  |
| O, Shift+O               | develop        | mask overlay; cycle its view (in the crop tool O cycles guides)         |
| H, Shift+H               | develop        | hide / show the selected mask (masks window) |
| '                        | develop        | invert the selected component, or else the mask (masks window)          |
| Delete / Backspace       | develop        | delete the selected mask component, or else the mask (masks window)     |
| Ctrl+D                   | develop        | duplicate the selected mask component, or else the mask (masks window)  |
| [ ], Alt                 | develop        | brush size (mask or heal), erase while held                             |
| Shift+A                  | develop        | auto tone                                                               |
| T                        | develop        | targeted adjustment (in the Colour mixer and Tone curve cards)          |
| Ctrl+Shift+U             | both           | auto white balance, each selected photo its own                         |
| \\ or Ctrl+Shift+L       | library        | sources sidebar                                                         |
| I                        | library        | info drawer (title, caption, copyright, keywords)                       |
| Ctrl+G / Ctrl+Shift+G    | library        | stack the selection under the focused photo / unstack                   |
| S, Shift+S               | library        | open or close the focused stack, make the focused photo its cover       |

See `TODO.md` for everything not in this pass.

## Source

This repository is public so the app can be read: how a slider becomes an
engine operation, what a mask selects, what is written to disk. It cannot be
built without the PIXL engine, a private, compiled component distributed only
as binaries to the app's own build pipeline.

<sub>Copyright © 2026 xuckless. All rights reserved. The source is published
for reference only; see [LICENSE](LICENSE). The PIXL engine is a separate,
closed component and is not made available through this repository.</sub>
