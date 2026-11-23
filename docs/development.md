# Development

<sub>[README](../README.md) · [Features](features.md) · [How it fits together](architecture.md) · [Development](development.md) · [Keys](keys.md) · [The .pixl format](pixl-format.md)</sub>

The engine is `@xuckless/pixl-engine` (PIXL Engine 0.17.0), a private package of compiled
binaries on GitHub Packages (macOS and Windows), so installing needs a token
with `read:packages` for it; see [`.github/RELEASING.md`](../.github/RELEASING.md).

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
<bucket>` (the shipped models from their packages; the on-demand ones, such as
BiRefNet lite and EfficientSAM3's vocabulary, from their pinned upstream files,
each checked against the roster); `pnpm publish-models --check` asks the live
mirror for every file the app offers. `PLAYROOM_MODELS_URL` points at another
mirror (`file://` works) for development, e.g. one made with
`pnpm publish-models --dry-run --out <dir>`.
`window.__maskPreview` reports the loupe's own mask preview (`stats`, and
`read()` for its plane, to compare with the engine's).

## Running against a development kit

A development kit is a folder the engine's side makes for trying unreleased
work on this computer: an engine addon built from a branch
(`engine/<platform>/`), the models package with a roster that names PIXL's own
unreleased models (`pixl-models/`), their weights (`models/<id>/<version>/`),
and `kit.json`, which lists every file with its size and SHA-256. It is looked
for in `~/Public/pixl-weights`, or where `--kit <dir>` or `PLAYROOM_DEV_KIT`
says. Not a release: the kit's engine must be the installed package's version,
and on a Mac it loads Homebrew's libraries, so `brew install libheif jpeg-xl`
first (a released engine carries its own).

```sh
pnpm dev:kit                  # install the kit, then pnpm dev with PLAYROOM_DEV_KIT set
pnpm dev:kit -- /path/to/photo.CR2
pnpm engine:dev --check       # what is installed: the released packages, or which kit
pnpm engine:dev --restore     # put the released engine and models back
```

`scripts/engine-dev.mjs` lays the kit over the installed
`@xuckless/pixl-engine` and `@xuckless/pixl-models` (only the files `kit.json`
lists, each checked first; the released files are kept beside as
`<name>.released`), and changes neither `package.json` nor the lockfile.
Restore before packaging a build. With the kit, Settings → AI models lists
PIXL demosaic (development): one model that develops a RAW at full size and
takes out its grain, in place of DemosaicNet and PMRID, with a switch to go
back to the released develop (both full-size pictures are kept, so flipping it
develops nothing again). The terminal says what developed each full-size
picture, on what and how long (`[dev kit] RAW master pd · CoreMl (CpuAndGpu,
static shapes) · 8412 ms`), and says so in one line when the engine refuses
the model and the released develop stands in.
