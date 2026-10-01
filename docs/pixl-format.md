# The `.pixl` project format

A `.pixl` file is one photo's project: everything Pixl Playroom knows about
how that photo is developed, in one file that goes wherever the file goes.

- **What it holds**
  - the photo's develop settings (its _recipe_);
  - its virtual copies;
  - its snapshots;
  - its rating, pick/reject flag and colour label;
  - its place in a stack;
  - the whole edit history of the photo and of each copy;
  - every painted mask plane those name;
  - a preview.
- **What later versions add:** a compressed copy of the original, and stored
  pixel results (AI denoise, enhance, healed pixels), so the project needs
  nothing outside itself.
- **What it never does:** change the original. Exports are new files made from it.

This document is the format's specification. It is versioned; anything not
written here is not part of the format.

## Container

A `.pixl` file is a [SQLite 3](https://sqlite.org/fileformat.html) database:
one file, written transactionally, readable by any SQLite tool or library.

| Property                | Value                           |
| ----------------------- | ------------------------------- |
| Extension               | `.pixl`                         |
| `PRAGMA application_id` | `0x5049584C` (`"PIXL"`)         |
| `PRAGMA user_version`   | the format's major version, `2` |
| `meta.format`           | `pixl-project`                  |
| `meta.format_version`   | `2`                             |
| Page size               | 16384                           |
| Auto-vacuum             | incremental                     |
| Journal                 | rollback (`DELETE`); never WAL  |
| Text                    | UTF-8                           |

**Reading a file**

1. Check `application_id`.
2. Refuse a file whose `user_version` is higher than the reader knows: it is
   from a newer major version.
3. Ignore tables and `meta` keys the reader does not know. A later minor
   version only _adds_, and an older reader keeps working.

**Writing a file**

- Every change is one transaction (a writer may gather several changes made
  within a moment into one).
- Writers never use WAL, so no `-wal` or `-shm` files sit beside the photo.
  Projects live in folders that are copied, synced and backed up.
- A writer closes the file when idle.
- A new project is built under a temporary name (`<name>.pixl.creating-<pid>`)
  and renamed into place. A `.pixl` path is either absent or a whole project.

## Tables

### `meta`

`key TEXT PRIMARY KEY, value TEXT NOT NULL`. Free-form facts about the project:

| key              | value                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `format`         | `pixl-project`                                                                           |
| `format_version` | `2`                                                                                      |
| `created_at`     | ISO 8601 time                                                                            |
| `created_by`     | the application that made it                                                             |
| `stack`          | JSON `{ "id": string, "position": number }` (position 0 is the stack's cover), or absent |

### `origin`

One row (`id = 1`): the photo the project was made from, as it was then.

| column          | meaning                                                            |
| --------------- | ------------------------------------------------------------------ |
| `name`          | its file name (`IMG_0001.CR3`); this ties the project to its photo |
| `ext`           | its extension, lower case                                          |
| `size`, `mtime` | its size in bytes and modification time (ms since the epoch)       |
| `path`          | where it was when the project was made                             |
| `is_raw`        | 1 for a camera RAW                                                 |
| `sha1`          | its SHA-1, when known                                              |

### `items`

The photo and its virtual copies, one row each.

| column       | meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `item_id`    | `''` for the photo; the copy's id for a copy                   |
| `name`       | the file name for the photo; the copy's name ("Copy 1")        |
| `sort`       | display order (the photo is 0)                                 |
| `rating`     | 0–5                                                            |
| `flag`       | `pick`, `reject` or NULL                                       |
| `label`      | `red`, `yellow`, `green`, `blue`, `purple` or NULL             |
| `recipe`     | the develop settings as JSON (see _Recipes_), or NULL for none |
| `snapshots`  | JSON array of `{ id, name, at, recipe }`                       |
| `updated_at` | ISO 8601 time                                                  |

### `history`

Each item's edit history.

| column     | meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `item_key` | the item's `item_id`                                                |
| `seq`      | 1, 2, …, in order                                                   |
| `label`    | what the step did ("Exposure", "Mask 1: Contrast")                  |
| `at`       | ISO 8601 time                                                       |
| `recipe`   | the base's whole recipe (first row); for a step, `''` or a keyframe |
| `patch`    | NULL for the base; for a step, the JSON patch it made               |
| `hidden`   | 1 for a step that is undone (hidden steps are kept for redo)        |

- **The base:** the first row of an item, a whole recipe.
- **Patches:** a patch is an array of operations:
  - `{ "path": Seg[], "value": any }` sets a value at a path;
  - `{ "path": Seg[], "del": true }` deletes one;
  - `{ "path": Seg[], "order": string[] }` reorders a list.
- **Paths:** a `Seg` is a field name, or `{ "id": string }` naming an entity in
  a list by its id. Masks, mask components, retouch spots, point colours and
  custom layers are addressed this way.
- **The current recipe:** the base with every visible step's patch applied,
  in order.
- **Keyframes:** a step's `recipe` may hold the whole current recipe as of
  that step (the base with every visible step up to it applied). Writers keep
  one every 25 steps, so the current recipe is the latest keyframe with the
  steps after it applied. Hiding, showing or deleting a step clears the
  keyframes from it on. A reader may ignore keyframes and replay from the
  base: the result is the same.
- **Folding:** past 200 rows, the oldest steps fold into the base, and a hidden
  one is dropped.

### Painted planes

Painted mask planes are blobs (below) of `kind` `plane`, `codec` `png`: an
8-bit grey PNG, its bytes as they are. Each is kept once.

- A plane's name (its `blobs.hash`) is the SHA-256 of its PNG bytes.
- Recipes name a plane by it: a brush component with `"png": ""` and
  `"ref": "<sha256>"` uses that plane. A component with a non-empty `png`
  (base64) carries its plane inline.
- A plane no item, snapshot or history row names may be removed.
- **Version 1** kept planes as base64 text in a `planes(ref, png)` table, named
  by a 32-bit hash and the text's length. Opening a version-1 file upgrades
  it: each plane becomes a blob, every `"ref"` naming it is renamed, the
  `planes` table is dropped and `user_version` becomes 2.

### `preview`

One row (`id = 1`): a JPEG of the photo as developed (`jpeg`), `width` and
`height` (0 when not recorded), and `updated_at`.

### `blobs` and `blob_chunks`

Large binaries, stored once by content.

| `blobs` column      | meaning                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `hash`              | SHA-256 of the bytes, lower-case hex (the blob's name)                                                        |
| `kind`              | what it is: `original`, `pixels` (a step's image), `mask` (a step's frozen mask) or `plane` (a painted plane) |
| `codec`             | how the bytes are encoded: `dng`, `jxl-jpeg`, `jxl`, or the original's own extension (`jpg`, `cr3`, `heic`…)  |
| `width`, `height`   | its pixel size when known (a JPEG XL reports it turned by the orientation)                                    |
| `channels`, `depth` | when known                                                                                                    |
| `bytes`             | its length                                                                                                    |
| `created_at`        | ISO 8601 time                                                                                                 |

`blob_chunks(hash, idx, data)` holds the bytes:

- in order of `idx` from 0;
- each chunk at most 4 MiB (`data` is a BLOB);
- a reader concatenates the chunks.

A blob nothing names may be removed. Names are `original.blob`, and any
`"blob"`, `"alpha"` or `"ref"` field holding a 64-hex hash in a recipe,
snapshot or history row.

### `original`

One row (`id = 1`): the original as the project carries it, so the project
needs nothing outside itself.

| column  | meaning                                                     |
| ------- | ----------------------------------------------------------- |
| `kind`  | how it is kept (below)                                      |
| `blob`  | the `blobs.hash` holding it, or NULL while it is being made |
| `state` | `pending`, `ready` or `failed`                              |
| `note`  | why it was kept as it is, or why it failed                  |

| `kind`         | made from                                                                                              | how to get the original back                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `dng`          | a camera RAW                                                                                           | the blob is a DNG with lossless JPEG-92 pixels (Adobe's converter's kind); it _is_ the photo's raw data, not its file           |
| `jxl-jpeg`     | a JPEG                                                                                                 | the blob is a JPEG XL repack; reconstructing the JPEG from it gives the original file byte for byte (checked before it is kept) |
| `jxl-lossless` | a PNG or TIFF of 5 MB or more                                                                          | the blob is mathematically lossless JPEG XL with the same pixels and metadata                                                   |
| `verbatim`     | anything else, a DNG, a JPEG with a gain map, or a conversion that came out larger or failed its check | the blob is the original file's own bytes                                                                                       |

## The photo and its project

A project ties itself to its photo by `origin.name`, among the images in the
folder beside it (or in the folder its projects subfolder belongs to).

- **The photo is there:** it is read from its own file.
- **The photo is gone:** the project stands in for it. It is listed as the
  photo, and develops and exports from the original it carries.
- **The photo comes back:** it takes its place again.
- **The photo moved away from a project kept in a projects folder:** it is found
  again by its name and size, and `origin.path` is updated.
- **Grain:** the grain and dither seeds hash `origin.path` as it was when the
  project was made, so a photo's grain does not change when it moves.

## Recipes

A recipe is JSON: the photo's develop settings in the units the sliders show.
Its fields:

| field                         | holds                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `version`                     | currently 2                                                                                                           |
| `profile`, `profileAmount`    | the profile                                                                                                           |
| `treatment`                   | `color` or `bw`                                                                                                       |
| `wb`                          | white balance                                                                                                         |
| `basic`                       | exposure and tone                                                                                                     |
| `presence`                    | texture, clarity, dehaze, vibrance, saturation, hue                                                                   |
| `toneCurve`                   | the tone curve                                                                                                        |
| `hsl`, `bwMix`, `pointColors` | the colour mixer and point colours                                                                                    |
| `colorGrade`                  | colour grading                                                                                                        |
| `detail`                      | sharpening and noise                                                                                                  |
| `lens`                        | lens corrections                                                                                                      |
| `effects`                     | effects                                                                                                               |
| `calibration`                 | calibration                                                                                                           |
| `geometry`                    | crop, rotation, upright                                                                                               |
| `retouch`                     | heal, clone and fill spots                                                                                            |
| `pixels`                      | pixel steps, in order (below)                                                                                         |
| `layers`                      | masks, each with `components` (its shape) and `settings` (the same settings as the photo's, as a change on top of it) |
| `custom`                      | custom layers                                                                                                         |
| `gainMap`                     | HDR gain-map editing                                                                                                  |

- **Full definition:** `src/shared/recipe.ts`.
- **Reading older or partial recipes:** a reader fills a field it lacks with its
  default, and version-1 masks (an `adjust` block of sliders) are converted to
  `settings`.

## Pixel steps

`recipe.pixels` lists what changed the photo's pixels rather than its
settings (an AI denoise, an Enhance, a baked heal stroke), in the order they apply. Each is an image computed
once and kept as a blob, so undoing, redoing or changing its strength never
computes it again.

| field             | meaning                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | the step's id (history patches name it, as they name masks)                                                                                                   |
| `kind`            | `denoise`, `enhance` or `retouch` (a heal, clone, fill or eye stroke)                                                                                         |
| `label`           | what it is called ("AI Denoise · SCUNet in Mask 1")                                                                                                           |
| `blob`            | the image it made: a `blobs.hash`, the whole frame (`width × height`), 16-bit RGB in JPEG XL (`codec` `jxl` near-lossless at distance 0.1, or `jxl-lossless`) |
| `alpha`           | the mask it was made inside, frozen as it was then: a `blobs.hash` of an 8-bit grey PNG of the same size; null for the whole frame                            |
| `scope`           | that mask's name, for showing                                                                                                                                 |
| `opacity`         | 0–100: how much of it is laid on                                                                                                                              |
| `width`, `height` | the frame it was made at                                                                                                                                      |
| `rect`            | a patch's place on the frame (`retouch` steps), else null                                                                                                     |
| `params`          | how it was made (`model`, `chain`, `scale`, `lossless`); `resizes: true` for an upscale                                                                       |

- **The source frame:** steps live on the photo's own pixels at full size,
  upright (the file's orientation applied), before lens correction. A mask drawn
  over the corrected picture is put back onto that frame when frozen.
- **Patches:** a `retouch` step's `blob` is only the pixels the stroke changed:
  a 16-bit RGBA PNG whose alpha is where it changed (times the mask that clipped
  it), placed at `rect` (`{ x, y, w, h }`, pixels of its `width × height`
  frame).
- **Upscales:** a step with `params.resizes` (an upscale) is larger than the
  frame before it; from it on, the frame is its size, and the steps before it
  are resampled to it. Positions in the recipe are fractions, so nothing moves.
- **Applying them:** the developed picture is the source frame with each step's
  image laid over it in order, in linear light, through `alpha` (or
  everywhere) at `opacity`. Lens correction, retouch, the grade and framing
  follow.

## Where projects are

A photo's project is made on its first edit:

- an edited recipe;
- a history step past the first;
- a virtual copy;
- a snapshot.

A rating, flag or label alone does not make one; until there is a project they
stay in the older `<photo>.playroom.json` sidecar. When the project is made,
it takes over that sidecar and the edit history, and the sidecar is removed.

**Where a new project goes:**

| Setting                                                      | Path                                                                                                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beside the photo (default)                                   | `IMG_0001.pixl` next to `IMG_0001.CR3`. When another image in the folder shares the stem (a RAW and its JPEG), the name keeps the extension: `IMG_0001.CR3.pixl`. |
| A projects folder (`~/Pixl Projects`, or one the user chose) | `<projects folder>/<photo folder name>-<6 hex of SHA-1 of the folder's path>/<name>.pixl`                                                                         |

A folder that cannot be written puts its projects in `~/Pixl Projects`.

**How a project finds its photo:** by `origin.name`, among the images in the
folder it is beside or the folder its projects subfolder belongs to.
