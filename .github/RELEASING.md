# Releasing Pixl Playroom

Maintainer notes. The public README does not carry these.

## Develop

```sh
pnpm config set //npm.pkg.github.com/:_authToken <PAT with read:packages>   # @xuckless/pixl-engine on GitHub Packages
pnpm install
pnpm fetch-ai                              # ONNX Runtime + Real-ESRGAN for this machine (Enhance)
pnpm dev                                   # electron-vite dev with HMR
pnpm typecheck && pnpm lint && pnpm test   # tests: node --test over src/shared
pnpm build:unpack                          # unpacked app in dist/
```

The published binding ships macOS and Windows binaries only. On Linux, build one with the
helper outside this repo (`node ../tools/engine-linux.mjs --app .`) and the app runs the real
engine. If `pnpm dev` fails with `Error: Electron uninstall`, fetch the binary with
`node node_modules/electron/install.js`.

## Release flow

1. Commit to `main` through PRs with conventional commits. `feat` and `fix` bump the patch
   while pre-1.0 (`bump-patch-for-minor-pre-major`); `docs`/`chore` bump nothing.
2. `release-please.yml` keeps a release PR open with the next version and CHANGELOG.
3. Merging that PR tags `vX.Y.Z`, creates the GitHub release, and `release.yml` builds
   macOS arm64, macOS x64 and Windows x64 on GitHub-hosted runners: `pnpm fetch-ai` for the
   job's own target, `electron-vite build`, then `electron-builder --publish always`, which
   signs and notarizes macOS when the secrets exist and attaches installers plus
   `latest*.yml` manifests. A final `mac-channel` job replaces `latest-mac.yml` with both
   arches merged.

**One arch per job.** The engine binding is a platform package that pnpm installs for the
runner it runs on, so a job can only package its own architecture. `mac.target` in
`electron-builder.yml` carries no `arch` list (one would override the CLI flag and package
both), `build/after-pack.mjs` fails the build if the app and its binding disagree, and
`build/merge-mac-channel.mjs` stitches the two single-arch `latest-mac.yml` files into one
feed.

**Asset names carry no version** (`artifactName` in `electron-builder.yml`), so
`releases/latest/download/<name>` links survive every release.

**Channels.** Derived from the version: `0.3.0` → `latest`, `0.3.0-beta.1` → `beta`.

**Engine updates.** `bump-engine.yml` opens a `fix(engine): bump pixl-engine to X` PR, on a
`pixl-engine-released` repository dispatch or by hand (_Actions → Bump engine → Run
workflow_ with the version).

**Manual build.** _Actions → Release → Run workflow_ with a tag; `EP_GH_IGNORE_TIME` lets
electron-builder upload to an older published release.

**CI.** `ci.yml` runs typecheck, lint, tests and a build on pushes to `main` and on PRs from
this repository. Forks and Dependabot PRs cannot install the private engine package, so their
checks fail.

## Secrets

| Name                                                         | Purpose                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `PACKAGES_TOKEN`                                             | classic PAT with `read:packages` for `@xuckless/pixl-engine` |
| `RELEASE_PLEASE_TOKEN`                                       | PAT with `repo` + `workflow` so release PRs get workflows    |
| `CSC_LINK` / `CSC_KEY_PASSWORD`                              | base64 Developer ID Application `.p12` and its password      |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | notarization                                                 |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`                      | Windows code-signing `.pfx` (optional)                       |

Until the Apple secrets exist, macOS builds are unsigned: Gatekeeper reports them as
"damaged" (users clear quarantine with `xattr`). Windows works unsigned with a SmartScreen
warning.
