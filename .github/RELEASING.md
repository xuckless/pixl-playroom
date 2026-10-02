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
3. Merging that PR tags `vX.Y.Z` and creates the GitHub release. `release.yml` then builds
   macOS arm64, macOS x64 and Windows x64 on GitHub-hosted runners:
   - `electron-vite build`, then `electron-builder --publish always`, which signs, and
     notarizes macOS, when the secrets exist;
   - each job uploads its installers, zips and blockmaps to updates.pixlfoundation.com,
     under `playroom/<version>/`;
   - Windows then puts up its feeds (`latest.yml`, `beta.yml`);
   - a final `mac-channel` job merges the two arches' macOS feeds and puts them up last.

   The feeds are rewritten to point into the version's folder (`build/prefix-feed.mjs`).

**One arch per job.** The engine binding is a platform package that pnpm installs for the
runner it runs on, so a job can only package its own architecture. `mac.target` in
`electron-builder.yml` carries no `arch` list (one would override the CLI flag and package
both), `build/after-pack.mjs` fails the build if the app and its binding disagree, and
`build/merge-mac-channel.mjs` stitches the two single-arch `latest-mac.yml` files into one
feed.

**The update bucket.** `pixl-updates` (R2) behind `https://updates.pixlfoundation.com`:
- `playroom/<version>/` holds that version's files, cached for a year (immutable);
- `playroom/<channel>.yml` and `playroom/<channel>-mac.yml` are the feeds (`no-cache`).

A folder per version keeps a beta release from overwriting the stable one's files (the asset
names carry no version), and lets differential updates find the old version's blockmap.

`release.yml` needs the secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, from an R2 API
token with Object Read & Write on `pixl-updates`, and the variable `R2_ENDPOINT`
(`https://<account id>.r2.cloudflarestorage.com`). Without them the release fails before any
feed changes.

A rerun of a failed release uploads the files again, as long as no feed names that version
yet. Once one does, the version is live and its files are never replaced: fix a bad release
by releasing again.

**The GitHub bridge.** Apps up to 0.1.1-beta read GitHub's feed, so the next release also
goes to the tag's GitHub release (the `github` entry in `publish`, its feeds in
`dist/github/`), and its own `app-update.yml` points at the bucket. After that release, the
`github` entry and the bridge steps in `release.yml` go.
- Windows installs of 0.1.1-beta refuse that release whatever we do (their `publisherName`
  was `xuckless`). Their users reinstall once, and the release notes and the beta page say
  so.

**Staged rollouts.** _Actions → Release → Run workflow_ takes `rollout`, the percentage of
the channel offered the release (100 by default; release-please's runs use 100). Below 100,
the feeds carry `stagingPercentage`. electron-updater gives each install a stable random id,
and an install outside the percentage hears "no update".
- `node scripts/rollout.mjs <latest|beta>` shows each feed's version and percentage.
- `node scripts/rollout.mjs <latest|beta> <percent>` changes it. 100 offers the release to
  everyone; 0 stops it reaching anyone else.
- A downgrade is never offered (`allowDowngrade` is false). A bad release is stopped with
  0 and fixed by releasing again; installs that already have it keep it until then.

**The release policy.** `playroom/policy.json`, `{ minVersion, betaOpen, message }`, is read
by every install at launch and every four hours, and kept for offline launches
(`src/main/policy.ts`).
- Below `minVersion`, the window shows only _Update required_: the update downloading,
  _Restart to update_, and a download link. Use it for a release that must not stay out (a
  data-losing bug, a security fix), and only once the fixed version is in the feeds.
- `betaOpen: false` tells beta builds the beta has ended (Pass 26a).
- `node scripts/policy.mjs` shows it. `node scripts/policy.mjs set --min 0.2.3 --message "…"`
  changes it, and so do `--no-min` and `--beta-open false`.
- Development builds never block on it.

`scripts/rollout.mjs` and `scripts/policy.mjs` talk to the bucket through `scripts/r2.mjs`, with
the same `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_ENDPOINT` the workflow uses (an
R2 API token with write access to `pixl-updates`). `--prefix staging/playroom` works on the
staging folder instead.

**Asset names carry no version** (`artifactName` in `electron-builder.yml`), so the website's
download links can name a file and a version folder without guessing.

**Channels.** Derived from the version: `0.3.0` → `latest`, `0.3.0-beta.1` → `beta`. A
stable release also writes the `beta` feeds (`generateUpdatesFilesForAllChannels`), so the
beta channel is offered a stable release newer than its last beta.

**Betas (now).** `release-please-config.json` sets `"prerelease": true`, `"versioning":
"prerelease"` and `"prerelease-type": "beta"`: release PRs propose beta versions
(`0.1.1-beta`, then `0.1.1-beta.1`…), and each GitHub release is flagged _Pre-release_, so it
publishes only the `beta` feed and `releases/latest` (stable updates, the website's download
links) never points at it. To cut a stable release, remove those three settings (or set
`"prerelease": false` and drop `versioning`) in the PR before merging the release PR, or pin
a version with a `Release-As: X.Y.Z` commit footer.

**Engine updates.** `bump-engine.yml` opens a `fix(engine): bump pixl-engine to X` PR
(`@xuckless/pixl-engine` and `@xuckless/pixl-models` together), on a
`pixl-engine-released` repository dispatch or by hand (_Actions → Bump engine → Run
workflow_ with the version). Read the engine's `docs/playroom/<version>.md` first: it says
what Playroom must change. The engine's platform package carries, beside the `.node`,
`pixl_libraw` (LibRaw), the libheif and libde265 libraries with their complete sources,
the licence texts and `THIRD-PARTY-NOTICES.txt`: all of it ships unmodified
(`asarUnpack`), and `build/after-pack.mjs` refuses a package without them.

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

`src/main/updater.ts` (ported from space-pixl) reads updates.pixlfoundation.com through
the `app-update.yml` electron-builder writes from `publish`. It checks at launch and every four
hours, downloads in the background and installs on quit or on _Settings → Restart to update_.
The channel (Stable / Beta) is in _Settings_ and in `userData/settings.json`.

- **macOS updates need signing.** Squirrel.Mac refuses an unsigned update, so until the
  Apple secrets exist a Mac check ends in an error, which Settings shows.
- **From a checkout:** `PLAYROOM_FORCE_UPDATER=1 pnpm dev` reads `dev-app-update.yml`
  (the same feed). Without it the updater is off in development.
- **Another feed:** `PLAYROOM_UPDATE_URL=<base>` (for example a staging folder,
  `https://updates.pixlfoundation.com/staging/playroom`) reads `<base>/latest-mac.yml` and
  the rest from there. It works in a signed build too, and the update is still checked
  against the app's signature.

### Before a release goes out: test one real update

Do this before the first release from the bucket, and again whenever the updater, signing or
`release.yml` change. It uses the staging folder (`staging/playroom/`), which no install reads
unless told to.

1. Build N to staging: _Actions → Release → Run workflow_ with any ref, `target: staging` and
   `version: <N>`, a version below what you're about to release (for example `0.2.0-beta.90`).
   Install it from `https://updates.pixlfoundation.com/staging/playroom/<N>/…` on a Mac (Apple
   Silicon, and Intel if one is at hand) and on Windows.
2. Build N+1 to staging the same way (`version: <N+1>`, for example `0.2.0-beta.91`).
3. Start N reading the staging feed:
   - macOS: `PLAYROOM_UPDATE_URL=https://updates.pixlfoundation.com/staging/playroom "/Applications/Pixl Playroom.app/Contents/MacOS/Pixl Playroom"`
   - Windows: `set PLAYROOM_UPDATE_URL=https://updates.pixlfoundation.com/staging/playroom` and
     then `"%LOCALAPPDATA%\Programs\pixl-playroom\Pixl Playroom.exe"`

   Set _Settings → Updates_ to the channel N+1 is in.
4. Check, on each machine:
   - _Settings_ shows N+1 downloading, then ready, and the log
     (`~/Library/Logs/pixl-playroom/main.log`, `%APPDATA%\pixl-playroom\logs\main.log`) shows a
     differential download from N's blockmap, not a full one. A first update after a fresh
     install may download in full on macOS.
   - _Restart to update_ comes back as N+1 with the library and edits as they were.
   - Quitting with N+1 downloaded (on a fresh N) installs it on quit.
   - A floor: `node scripts/policy.mjs set --prefix staging/playroom --min <N+1>`. N then shows
     only _Update required_ and updates from there. Clear it after with `--no-min`.
   - A staged rollout: `node scripts/rollout.mjs <channel> 0 --prefix staging/playroom` makes N
     say it's up to date. Restore it with 100.
   - Tampered or unsigned updates are refused. Replace N+1's zip (macOS) or installer (Windows)
     in the staging folder with an unsigned build of the same version, and fix the feed's
     sha512 to match. N must refuse it: on Windows "not signed by the application owner", and
     on macOS Squirrel's code-signature check.
5. Empty `staging/playroom/` afterwards.

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
packages, the engine's own `THIRD-PARTY-NOTICES.txt` (from its platform package, embedded
whole: every library beside the addon and compiled into it, ONNX Runtime included), every
AI model the app can download (from the engine's model roster), and Playroom's other
native components in `build/third-party.json` (ExifTool, Electron, the Lensfun data), with
licence texts from `build/licenses/`. `release.yml` regenerates it after the build;
`build/after-pack.mjs` checks it holds the engine's notices. To refresh the copy on the website:
`node scripts/third-party-notices.mjs --web ../pixl-web`.

## The PIXL account

Signing in (_Settings → PIXL account_) is OAuth 2.1 with PKCE against Supabase Auth on
pixl-core, as the public client "Pixl Playroom" (`src/shared/account.ts`). The browser
comes back to `http://127.0.0.1:47823/callback`, a fixed port because Supabase matches
redirect URIs exactly. Everything runs in the main process (`src/main/account/`), and the
renderer never sees a token. `userData/account.json` holds who is signed in, plus the refresh
token sealed by `safeStorage`. Without the keychain nothing is written, and the session lasts
that launch only. A launch refreshes the session, so one revoked from the account page signs
out. The section shows where the Licence section does.

To work on it without pixl-web, run `node scripts/mock-account.mjs`, then start the app
with `PLAYROOM_AUTH_URL=http://127.0.0.1:54321/auth/v1`. The mock approves every sign-in at
once; `POST /mock/revoke` ends every session.

## The beta gate

A beta build (a version with `-beta`) opens only for an account with beta access
(`src/shared/gate.ts`, `src/main/gate.ts`). Until then the window shows one of these: sign
in, join the beta (it opens playroom.pixlfoundation.com/beta/, and coming back to the
window checks again), checking or offline, free a device, or the beta has ended. The main
process refuses everything but signing in, access, updates and settings meanwhile. The
renderer's launch waits for the gate to open.

The beta ends for every beta build when `node scripts/policy.mjs set --beta-open false` runs,
or when the Worker answers `beta_ended`. Those builds then show the update to the release:
a stable release writes the beta feeds too, so it's offered. Development and automation skip
the gate, and `PLAYROOM_BETA_GATE=1` brings it back to try it out.

From 1.0.0 (a version with no prerelease), licences are enforced (`licenceEnforced`) and the
beta gate is off.

## Licences

Access comes from the PIXL account, not keys. pixlfoundation.com's Worker answers
`/api/entitlements` (and `/api/trials`) with an entitlement token for this account, app
and device: beta access, the trial, the licence. The token is an Ed25519 JWS that lasts up
to 30 days offline. The app checks it itself (`src/main/account/entitlement.ts`,
`access.ts`), so editing `userData/licence.json` grants nothing, and turning the clock back
doesn't stretch the month. Enforced from 1.0.0 (`licenceEnforced`); the Licence and
Account sections show in development, in beta builds, with `PLAYROOM_LICENCE_UI=1`, and
once enforced. Buying (Lemon Squeezy)
happens on the website; the app only opens the pricing page and sees the licence on the
account.

The Worker's signing keys can change without a release. The app ships only root public
keys (`ROOT_KEYS` in `src/shared/account.ts`; `root-2` is a spare). Each answer brings a
key set, the signing keys valid now, signed by a root. The app keeps only the newest key
set it has seen.
- **Rotate a signing key.** Sign a key set holding the old and new keys, switch the Worker
  to the new key, then later sign one without the old key.
- **Revoke a leaked key.** Sign a key set without it. Apps stop accepting it at their next
  refresh. A copy offline can still use the last token it had until that token expires.
- **Sign a key set.** Run `node scripts/entitlement-keys.mjs sign-keyset root-1 <kid>=<public>`
  on the machine holding `~/.pixl-secrets/entitlement-root-1.pem`, and put the output in
  the Worker's `ENTITLEMENT_KEYSET` secret. `verify <jws>` checks a key set.
- **Changing a root is the only key change that needs a release.**

To work on it locally, run `scripts/mock-account.mjs`, then start the app with
`PLAYROOM_ACCOUNT_URL=http://127.0.0.1:54321/api` as well as `PLAYROOM_AUTH_URL`. The mock
signs its key sets with the development root (`scripts/dev-entitlement-root.mjs`), which
only unpackaged builds trust. Its `/mock/grant` and `/mock/policy` routes set what an
account holds.

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
