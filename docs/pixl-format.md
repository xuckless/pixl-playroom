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
| `PRAGMA user_version`   | the format's major version, `1` |
| `meta.format`           | `pixl-project`                  |
| `meta.format_version`   | `1`                             |
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

- Every change is one transaction.
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
| `format_version` | `1`                                                                                      |
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

| column     | meaning                                                      |
| ---------- | ------------------------------------------------------------ |
| `item_key` | the item's `item_id`                                         |
| `seq`      | 1, 2, …, in order                                            |
| `label`    | what the step did ("Exposure", "Mask 1: Contrast")           |
| `at`       | ISO 8601 time                                                |
| `recipe`   | the base's whole recipe (first row); `''` for a step         |
| `patch`    | NULL for the base; for a step, the JSON patch it made        |
| `hidden`   | 1 for a step that is undone (hidden steps are kept for redo) |

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
- **Folding:** past 200 rows, the oldest steps fold into the base, and a hidden
  one is dropped.

### `planes`

`ref TEXT PRIMARY KEY, png TEXT NOT NULL`. Painted mask planes, each kept once.

- `png` is an 8-bit grey PNG, base64.
- `ref` is how recipes name the plane: a brush component with `"png": ""` and
  `"ref": "<ref>"` uses this plane. A component with a non-empty `png`
  carries its plane inline.
- A plane no item, snapshot or history row names may be removed.

### `preview`

One row (`id = 1`): a JPEG of the photo as developed (`jpeg`), `width` and
`height` (0 when not recorded), and `updated_at`.

### Reserved for later versions

`original`, `blobs` and `blob_chunks` exist and are empty in version 1. They
will hold the embedded original and stored pixel results:

- blobs are content-addressed by hash;
- they are stored in chunks of at most 4 MiB, in standard codecs (DNG, JXL, PNG).

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
| `layers`                      | masks, each with `components` (its shape) and `settings` (the same settings as the photo's, as a change on top of it) |
| `custom`                      | custom layers                                                                                                         |
| `gainMap`                     | HDR gain-map editing                                                                                                  |

- **Full definition:** `src/shared/recipe.ts`.
- **Reading older or partial recipes:** a reader fills a field it lacks with its
  default, and version-1 masks (an `adjust` block of sliders) are converted to
  `settings`.

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
