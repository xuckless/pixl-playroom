# Releasing Pixl Playroom

Maintainer notes. The public README does not carry these.

## Develop

```sh
pnpm config set //npm.pkg.github.com/:_authToken <PAT with read:packages>   # @xuckless/pixl-engine on GitHub Packages
pnpm install
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
   macOS arm64, macOS x64 and Windows x64 on GitHub-hosted runners: `electron-vite build`, then `electron-builder --publish always`, which
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

**Betas (now).** `release-please-config.json` sets `"prerelease": true`, `"versioning":
"prerelease"` and `"prerelease-type": "beta"`: release PRs propose beta versions
(`0.1.1-beta`, then `0.1.1-beta.1`…), and each GitHub release is flagged _Pre-release_, so it
publishes only the `beta` feed and `releases/latest` (stable updates, the website's download
links) never points at it. To cut a stable release, remove those three settings (or set
`"prerelease": false` and drop `versioning`) in the PR before merging the release PR, or pin
a version with a `Release-As: X.Y.Z` commit footer.

**Engine updates.** `bump-engine.yml` opens a `fix(engine): bump pixl-engine to X` PR, on a
`pixl-engine-released` repository dispatch or by hand (_Actions → Bump engine → Run
workflow_ with the version).

**Manual build.** _Actions → Release → Run workflow_ with a tag; `EP_GH_IGNORE_TIME` lets
electron-builder upload to an older published release.

**CI.** `ci.yml` runs typecheck, lint, tests and a build on pushes to `main` and on PRs from
this repository. Forks and Dependabot PRs cannot install the private engine package, so their
checks fail.

**File associations.** Playroom is offered in "Open With" for every format it reads and never
made the default. On macOS that is `mac.fileAssociations` (`rank: Alternate`). On Windows
it is `build/installer.nsh` (ProgIds plus `OpenWithProgids`, per user). The document icons
in `build/doc-icons/` come from `pnpm doc-icons`; rerun it when `build/brand/doc-icon.html`
changes. **Windows file associations are untested.** Before relying on them, check on a
Windows machine that the installer builds, that Explorer's "Open with" lists Playroom with
the icons, that the default apps stay as they were, and that uninstalling removes the keys.

## Secrets

| Name                                                          | Purpose                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `PACKAGES_TOKEN`                                              | classic PAT with `read:packages` for `@xuckless/pixl-engine`                |
| `RELEASE_PLEASE_TOKEN`                                        | PAT with `repo` + `workflow` so release PRs get workflows                   |
| `CSC_LINK` / `CSC_KEY_PASSWORD`                               | base64 Developer ID Application `.p12` and its password                     |
| `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`     | notarization: the App Store Connect API key's `.p8` text, key ID, issuer ID |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | the service principal allowed to sign with Azure Trusted Signing            |

Repository **variables** (not secrets; _Settings → Secrets and variables → Actions →
Variables_) for Windows signing: `AZURE_SIGNING_ENDPOINT` (the account's region endpoint,
e.g. `https://eus.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT` (the Trusted Signing
account name), `AZURE_SIGNING_PROFILE` (the certificate profile name) and
`WIN_PUBLISHER_NAME` (the certificate's subject CN, exactly as Azure shows it).

Until the Apple secrets exist, macOS builds are unsigned: Gatekeeper reports them as
"damaged" (users clear quarantine with `xattr`). Until the Azure secrets and variables all
exist, the Windows installer is unsigned and SmartScreen warns.

## Code signing

Both take days of waiting on someone else, so start them before anything else on the
release list. `release.yml` signs whatever it has credentials for and leaves the rest
unsigned.

**macOS (Developer ID + notarization).**

1. On this Mac, Keychain Access → _Certificate Assistant → Request a Certificate From a
   Certificate Authority…_, saved to disk. At developer.apple.com → _Certificates_ → **+** →
   **Developer ID Application** (G2 Sub-CA), upload the request, download the `.cer` and
   double-click it. `security find-identity -v -p codesigning` then lists
   `Developer ID Application: <name> (<team id>)`. (An "Apple Development" identity cannot
   sign for distribution.)
2. Export it from Keychain Access (_My Certificates_, the certificate together with its
   private key) as a `.p12` with a password. `CSC_LINK` is `base64 -i cert.p12`,
   `CSC_KEY_PASSWORD` the password. Keep the `.p12` somewhere safe and off the repo.
3. App Store Connect → _Users and Access → Integrations → App Store Connect API_ → **Team
   Keys** → generate a key with the **Developer** role. Download the `.p8` (only once).
   `APPLE_API_KEY` is the file's text (`pbcopy < AuthKey_XXXX.p8`), `APPLE_API_KEY_ID` the
   key ID, `APPLE_API_ISSUER` the issuer ID above the list.
4. Try it locally before a release: `APPLE_API_KEY=~/path/AuthKey_XXXX.p8
APPLE_API_KEY_ID=… APPLE_API_ISSUER=… pnpm build:mac:arm64` (the identity is found in the
   keychain), then `codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/Pixl
Playroom.app"`, `spctl -a -vv` on it (expect `source=Notarized Developer ID`) and
   `xcrun stapler validate` on the app and the `.dmg`.

`electron-builder.yml` already has `hardenedRuntime`, the entitlements and `notarize: true`.

**Windows (Azure Trusted Signing).**

1. An Azure subscription, then a **Trusted Signing account** (Basic tier) in a supported
   region; note its endpoint URI.
2. Give your own user the _Trusted Signing Identity Verifier_ role on the account, then
   _Identity validation_ → **New** (Public, Individual or Organization). Individuals: US or
   Canada; organisations: also the EU and UK. Approval takes from hours to days.
3. A **certificate profile** (Public Trust) on the validated identity. Its subject CN is
   `WIN_PUBLISHER_NAME`.
4. Microsoft Entra ID → _App registrations_ → **New registration**; under _Certificates &
   secrets_ add a client secret. Tenant ID, client (application) ID and the secret value are
   the three `AZURE_*` secrets. On the Trusted Signing account, give this app the _Trusted
   Signing Certificate Profile Signer_ role.
5. Set the four variables above. The next release signs the app, the installer and the
   uninstaller (electron-builder installs the `TrustedSigning` PowerShell module on the
   runner). Check with _Properties → Digital Signatures_ on the installer, or
   `Get-AuthenticodeSignature`.

The publisher name goes into `app-update.yml`, and electron-updater refuses an update
whose signer differs, so it must match the certificate exactly and stay the same from
release to release. Builds before Windows signing carry no publisher name, so they accept
the first signed update. SmartScreen warnings fade as signed builds gather reputation (no
certificate type skips that any more).

## Updates

`src/main/updater.ts` (ported from space-pixl) reads the GitHub releases through the
`app-update.yml` electron-builder writes from `publish`. It checks at launch and every four
hours, downloads in the background and installs on quit or on _Settings → Restart to update_.
The channel (Stable / Beta) is in _Settings_ and in `userData/settings.json`.

- **macOS updates need signing.** Squirrel.Mac refuses an unsigned update, so until the
  Apple secrets exist a Mac check ends in an error, which Settings shows.
- **From a checkout:** `PLAYROOM_FORCE_UPDATER=1 pnpm dev` reads `dev-app-update.yml`
  (the same GitHub feed). Without it the updater is off in development.

## Models and lens profiles (R2)

AI models and the lens catalogue are served from one Cloudflare R2 bucket behind
`https://models.pixlfoundation.com`, and apps fetch from it on their own: models when the
user downloads one (`src/main/ai/models.ts`), the lens catalogue a little after start and
every six hours (`src/main/lensprofiles.ts`). Nothing here is part of a release.

**Set up (done):** the bucket is `pixl-models`, with the custom domain
`models.pixlfoundation.com` attached (zone `pixlfoundation.com`). Wrangler reads
`CLOUDFLARE_API_TOKEN` from the project's `.env` (git-ignored); `npx wrangler whoami`
confirms it. The site's media is a separate bucket, `pixl-media`
(`media.pixlfoundation.com`).

**Models:** `pnpm publish-models --bucket pixl-models` when the engine's roster changes.

**Lens profiles:** `pnpm lens-profiles` converts Lensfun's current database into
`resources/lens-profiles/` (commit it: it is the catalogue the next release ships, and works
offline). `pnpm lens-profiles --publish-only --bucket pixl-models` uploads that committed
catalogue unchanged to `pixl-models/lens-profiles/v1/`, shards first and `index.json` last
(so the online and the bundled catalogue share a version); every installed app picks up a
newer one at its next check, downloading only the shards whose SHA-256 changed. Pin a Lensfun
commit with `--ref <sha>`. `PLAYROOM_LENS_PROFILES_URL=file:///…/lens-profiles/v1` points a
development build at a local copy of that layout.

## Third-party notices

`pnpm notices` writes `build/THIRD_PARTY_NOTICES.txt` (shipped via `extraResources`,
opened from _Settings_ and _Help_). It reads what the bundles contain
(`out/*/bundled-packages.json`, from `electron.vite.config.ts`), the production npm
packages, ONNX Runtime's own notices (from the engine's platform package), every AI model the
app can download (from the engine's model roster), and the hand-kept native
components in `build/third-party.json`, with licence texts from `build/licenses/`.
`release.yml` regenerates it after the build. When the engine's dependencies change,
update `build/third-party.json`. To refresh the copy on the website:
`node scripts/third-party-notices.mjs --web ../pixl-web`.

## Licences

Lemon Squeezy's licence API, called straight from the app (`src/shared/licence.ts`; no
API key needed): activate with the key and a device name, validate at most once a day at
launch, deactivate from _Settings_. `userData/licence.json` holds the record with the key
sealed by `safeStorage`. Nothing is enforced (`LICENCE_ENFORCED`), and the Licence section
only shows in development or with `PLAYROOM_LICENCE_UI=1`. `PLAYROOM_LICENCE_API` points the
app at another server, for testing or for routing through the pixl-web Worker later.

## Crash reports

Opt-in (asked once at first launch, then in _Settings_), stored as `crashReports` in
`userData/settings.json`. Native crashes go through Electron's `crashReporter` (minidumps),
JavaScript errors and processes that die abnormally as JSON (`src/main/crash.ts`,
`src/shared/crash.ts`), to `https://pixlfoundation.com/api/crash`. Problem reports the user
writes (_Settings → Report a problem_, or _Help → Report a Problem…_) go to
`https://pixlfoundation.com/api/report`, with the end of the log unless they untick it. The
pixl-web Worker keeps both in the `pixl-reports` R2 bucket (`crash/`, `minidump/`, `report/`, one
folder a day), each deleted after the period the privacy policy states; see its TODO.md and
`scripts/reports-bucket.sh`.

**Symbols.** The release workflow's _Crash symbols_ step runs `scripts/upload-symbols.mjs`: Breakpad
`.sym` files for the engine binding and its libraries go to `symbols/` in the same bucket, with
`symbols/releases/<version>/<platform>-<arch>.json` naming the Electron and engine versions. It
needs two repository secrets: `CLOUDFLARE_SYMBOLS_TOKEN` (an API token with R2 write on
`pixl-reports`) and `CLOUDFLARE_ACCOUNT_ID`; without them the step is skipped. Electron's own
symbols are served from `https://symbols.electronjs.org`. To read a minidump, unpack it from its
multipart body, sync `symbols/` locally, and run
`minidump-stackwalk --symbols-url https://symbols.electronjs.org --symbols-path <dir> <dump>`.
The engine's `.node` is built stripped, so its frames name little until the engine publishes debug
symbols (ENGINE-REQUESTS.md, E35).
