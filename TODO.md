# TODO — Pixl Playroom

Everything still open in Playroom, as numbered **passes**: small, ordered
batches of related work a model (or you) can take one at a time. Work the
engine has to do is in [ENGINE-REQUESTS.md](ENGINE-REQUESTS.md) (E1, E2…);
Playroom work that waits on it is under "Waiting on the engine". Things only
you can do (accounts, certificates, lawyers, decisions) are under "Owner
tasks". What is finished is under "Done" at the end. Re-planned 2026-10-01
from the old TODO and a full performance and bug sweep.

## How to read this

| Size            | Points   | Roughly                                                 |
| --------------- | -------- | ------------------------------------------------------- |
| S               | 1        | a local fix in one or two files                         |
| M               | 2        | a few files, or one with a test to write                |
| L               | 3        | a feature or refactor across several modules            |
| XL              | 4        | a large feature, several days                           |
| XXL             | 5        | the largest that still fits one pass                    |
| XXXL, 4XL, 5XL… | 6, 7, 8… | each extra X adds a point: an epic, split across passes |

- A pass is at most **5 points**. An item over 5 points is an epic, and its
  parts are graded and spread over consecutive passes (marked "1/3", "2/3"…).
- Passes are in order. "After" names the passes (or engine requests) a pass
  depends on; otherwise passes in the same phase can be taken in any order.
- Each pass is tested and committed before the next.
- File references are where the 2026-10-01 sweep found the problem; check
  they still hold before changing anything.

---

## Top priority — Phase C: updates, the PIXL account and the beta (passes 23–26b)

**Top priority (2026-10-01)**: this phase comes before everything else
still open below. It is listed first, out of number order.

Next up, in order:

1. Owner: verify the Gmail destination in Cloudflare Email Routing (the
   `support@` and `hello@` rules go in after that); add `support@` to
   Gmail's "Send mail as"; create the Lemon Squeezy store; create the R2
   API token for release.yml.
2. pixl-web: the redirect-URI spike, then the schema, the sign-in and
   consent pages, and `/api/entitlements` (its "PIXL account" section).
3. Here: Pass 23, 23a, 25, 26 and 26a, in that order. Pass 23 and 23a don't
   wait on pixl-web, so they can start now; nor do the token check, the
   device hash and the sign-in flow against a local mock (Pass 25 and 26).

The app↔web contract (endpoints, the token's claims, the device hash, error
codes, the redirect URI) was agreed with the pixl-web session on 2026-10-01
and lives in pixl-web's TODO ("PIXL account" → "Contract with the apps");
`src/shared/account.ts` will mirror it.

Already set up: code signing on both platforms; the `pixl-updates`
bucket on updates.pixlfoundation.com; Supabase `pixl-core` with the
OAuth server, email codes through Resend, Turnstile, and Google and Apple
sign-in.

What has to work before builds go out: updates served from our own bucket,
signing in with a PIXL account, and access (beta, trial, licence, add-ons)
read from that account instead of licence keys. **Nothing is published
until this phase is done.** Linux comes later. The website half is in
pixl-web's TODO ("PIXL account", "Open beta", "Billing", "Updates").

How it fits together (decided 2026-10-01):

- **One PIXL account for every app**, as JetBrains does: Supabase Auth is the
  identity provider and an OAuth 2.1 server. Each app (Playroom, later Space
  Pixl) is a public OAuth client that signs in through the browser.
- **Access lives on the account**: beta access, the trial, the licence and
  add-on subscriptions are entitlements in Supabase Postgres. Nobody types a
  key. The Worker signs an entitlement token per account, product and
  device; the app checks it offline against a public key built into it.
- **Lemon Squeezy handles checkout, billing, tax and refunds only.** Its
  webhooks grant and revoke entitlements. Pay once, US$69.99, 3 devices.
- **The trial needs an account**: 14 days, no card, one per account _and_
  one per device (a hashed machine id), so new accounts on one machine get
  no new trial.
- **The beta locks the whole app** until the user signs in with a beta
  account. When 1.0 ships, beta access ends; testers get the normal trial
  plus a one-use discount code on their account.
- **Updates move from GitHub Releases to R2** (updates.pixlfoundation.com).

### Pass 23 — Updates from updates.pixlfoundation.com · 5 pts

After: Owner task "Updates bucket". The bucket and its cache rules are pixl-web's.

- [x] **L** · Publish to R2 instead of GitHub Releases: `publish` becomes
      the `generic` provider at `https://updates.pixlfoundation.com/playroom/`
      (the `latest` and `beta` feeds side by side, as now), and
      `dev-app-update.yml` matches it. release.yml uploads the installers,
      zips and blockmaps through R2's S3 API, then the merged feeds
      (`build/merge-mac-channel.mjs`) last, so no install sees a feed before
      its files exist. GitHub Releases keeps only release-please's notes.
      _Done: files in `playroom/<version>/` (so a beta never overwrites
      stable's files, and differential updates find the old blockmap),
      feeds rewritten to point there (`build/prefix-feed.mjs`), the
      `mac-channel` job merging and uploading both channels' macOS feeds.
      A stable release also writes the beta feeds
      (`generateUpdatesFilesForAllChannels`). `PLAYROOM_UPDATE_URL` reads
      another feed. Checked locally: a stable-version build writes the
      feeds expected; merge and prefix give correct feeds; electron-updater
      (as 0.1.1-beta) read such a feed from a local copy of the layout,
      found 0.2.0 and downloaded it from `0.2.0/` with its sha512
      checked. Not run in CI yet: it needs the R2 token (owner task), and
      nothing gets released until Phase C is done._
- [x] **M** · Move the installs already out to R2: v0.1.1-beta reads
      GitHub's feed, so the next release goes to GitHub and R2 both, and the
      `app-update.yml` it carries points at R2. Windows installs of 0.1.1-beta
      will refuse that release whatever we do (their `publisherName` is
      `xuckless`); their users must reinstall once, which the release notes
      and the beta page must say. Also check: 0.1.1-beta's release has only
      `latest*.yml`, no `beta*.yml`, so the Beta channel saw nothing.
      _Done: `publish` lists generic (R2) first and GitHub second, so the
      next release's `app-update.yml` points at R2 while its files and
      feeds still go to the GitHub release (`dist/github/`, and the merged
      macOS feed for the release's channel). RELEASING.md says when to take
      the GitHub entry out, and about the Windows reinstall. 0.1.1-beta's
      missing `beta*.yml`: GitHub's provider follows the release's own
      channel, which the bridge release uploads._
- [ ] **S** · After the bridge release is out: remove the `github` entry
      from `publish` and the bridge steps from `release.yml`.
      _0.1.1-beta.1 (2026-10-01, the first release from the bucket) is the
      bridge release. Its macOS feed job failed on the bridge part:
      electron-builder's GitHub publisher writes `latest-mac.yml` whatever
      the channel, and the job asked for `beta-mac.yml`. The R2 feed and the
      GitHub feeds were then put up by hand from the run's artifacts, with
      the same scripts. release.yml is fixed: the bridge is its own
      best-effort step, merges `latest-mac.yml`, and attaches it as
      `beta-mac.yml` too._
- [x] **S** · A beta build follows the beta channel, always.
      _Done 2026-10-01: it used to default to Stable, whose feed holds no
      betas, so beta testers would never have heard of the next beta.
      `updater.ts` now uses `beta` in any `-beta` build, and Settings says so
      instead of offering the choice. Checked: the app reads `beta-mac.yml`.
      The same default limits the bridge. A 0.1.1-beta still on Stable
      (the default then) asks GitHub for the latest non-prerelease release,
      and there is none, so only testers who chose Beta get the bridge
      release. The rest need the download link from the beta page or an
      email; the release notes should say so._

### Pass 23a — Rollouts, an update floor, a tested update · 5 pts

After: Pass 23.

- [x] **S** · Staged rollouts: a `stagingPercentage` input on release.yml
      that goes into the feed (electron-updater gives each install a stable
      id), and a script that raises it or stops a bad release. A downgrade is
      never offered (`allowDowngrade` false), so a bad release is fixed by
      releasing again, not by rolling back. RELEASING.md says so.
      _Done: the `rollout` input (default 100, kept at 0 when given 0),
      written by `build/prefix-feed.mjs`; `scripts/rollout.mjs` shows and
      changes it on the live feeds, through `scripts/r2.mjs` (Signature V4,
      with no AWS CLI needed). Tried against the real bucket on a throwaway
      prefix: set to 25, served with caching off, cleared at 100._
- [x] **M** · An update floor: the app reads
      `updates.pixlfoundation.com/playroom/policy.json` at launch
      (`minVersion`, `betaOpen`, a message). Below `minVersion` it says an
      update is required and installs it. Pass 26a reads the same file to
      know the beta has ended.
      _Done: `src/shared/policy.ts` (parsing, semver order, the floor),
      `src/main/policy.ts` (launch, every 4 hours, kept for offline
      launches), the full-window _Update required_ screen
      (`src/renderer/src/views/Gate.tsx`, which the beta gate will reuse) with
      progress, Restart to update and a download link, and
      `scripts/policy.mjs` to set it. Checked in the app with a local
      policy at 9.9.9. That check found an unreleased bug from the lazy
      updater import (`3520e30`): `autoUpdater` came back undefined from
      `import()`, so the updater never started. It's fixed, and 0.1.1-beta
      (static import) never had it. The screen blocks the window and its
      shortcuts; refusing IPC in main comes with the beta gate (Pass 26a)._
- [ ] **M** · Test one real update before any release goes out: install a
      signed N on a Mac and on Windows, publish N+1 to a staging prefix (a
      test build reads `PLAYROOM_UPDATE_URL`), and check the download, the
      differential download (blockmap), "Restart to update", installing on
      quit, and that an unsigned or tampered N+1 is refused on both. Write it
      into RELEASING.md as the pre-release checklist.
      _Ready: the checklist is in RELEASING.md ("Before a release goes out"),
      and release.yml takes `target: staging` (into `staging/playroom/`, no
      GitHub release) with a `version` to build as._
      _2026-10-01: staging builds 0.2.0-beta.90 and .91 ran green on all
      three runners. Uploads, the merged macOS feed, Azure signing (app,
      installer, uninstaller, helpers) and macOS notarization with fuses all
      worked. On this Mac (Apple Silicon): .90 read the staging feed,
      downloaded .91 (in full, since it was a first update), and installed
      it on quit in about 4 s; the updated app is valid and notarized.
      macOS asked for an administrator password at that install: Squirrel
      does when it can't write to the app's folder (the test ran from
      /private/tmp, root-owned). Repeat from /Applications, where an admin
      user's install shouldn't ask, and check a standard (non-admin) user.
      Still to do: Windows (an install of .90, update to .91,
      `publisherName` check), Intel Mac, a differential download (needs a
      third build), the floor and rollout checks, a tampered update refused.
      The staging folder is kept for that._
- [x] **S** · The beta terms ship inside the app: `build/legal/beta-terms.txt`
      (plain text made from pixl-web's `src/legal/beta.md` by
      `scripts/legal-copy.mjs`; `--check` says whether it's stale), packaged
      to `legal/beta-terms.txt`, opened from Help → Beta Terms and Settings →
      About in beta builds, and from the beta gate's sign-in and join
      screens. Re-sync it before a release whenever the terms change.
- [ ] **S** · Sign and notarize the DMG itself, not only the app in it:
      `spctl -t open` rejects the DMG ("no usable signature"), though the
      app inside is notarized and opens. electron-builder can sign it
      (`dmg.sign: true`); notarizing it takes a `notarytool` step in
      release.yml, as `friends-dmg.sh` did by hand.

### Pass 24 — Crash reports kept · 5 pts

After: Owner task "Where crash reports live". Partly in pixl-web.

- [x] **L** · Store crash reports: R2 with the retention period (the Worker
      only logs a summary today), or Sentry's Electron SDK taking over from
      `crashReporter` (`src/main/crash.ts`).
      _Done: R2 (pixl-web `worker/api.ts`, bucket `pixl-reports`, 90 days
      until confirmed; `scripts/reports-bucket.sh` there), rate limited.
      Also new: Settings → Report a problem (and Help → Report a Problem…)
      sends the user's words, an optional email and the scrubbed end of the
      log to `/api/report`, kept a year._
- [x] **M** · Symbol files for minidumps, uploaded by the release build.
      _Done: `scripts/upload-symbols.mjs`, the release workflow's Crash
      symbols step (needs the `CLOUDFLARE_SYMBOLS_TOKEN` and
      `CLOUDFLARE_ACCOUNT_ID` secrets). The engine's frames wait on E35._

### Pass 24a — Reports become GitHub issues (app side) · 5 pts · deferred

**Deferred (owner, 2026-10-01): not being done now.** Kept here as the plan
for when it is picked up.

After: Pass 24. The watcher that files the issues is pixl-web's ("Reports
become GitHub issues"); this pass makes the reports worth filing. Not part of
Phase C's gate: take it once builds are out and reports start arriving.

Owner decision first: the issues go to a **private** triage repository
(e.g. `xuckless/pixl-triage`), never to this public one. Reports carry users'
words, log tails and memory fragments.

- [ ] **S** · What each report carries, for grouping and for starting a fix:
  - the commit the build came from, the channel (beta or stable), and the
    app version;
  - for JSON crashes, the stack as it was thrown. The Worker takes the
    fingerprint from it, so the app sends no fingerprint of its own.
  - This goes in `src/shared/crash.ts` (`ErrorPayload`), in the same
    scrubbing as now; `tests/crash.test.ts`.
- [ ] **M** · Readable renderer stacks: the release build uploads its source
      maps next to `symbols/`, under `sourcemaps/<version>/`, through
      `scripts/upload-symbols.mjs`. The issue then shows `File.tsx:123`, not
      a bundle offset. The maps are not shipped in the app.
- [ ] **L** · Minidump triage workflow, in the triage repository, triggered
      by pixl-web's `repository_dispatch`:
  - fetch the dump from R2 and unpack Crashpad's multipart and gzip;
  - run `minidump-stackwalk` with `symbols/` and
    https://symbols.electronjs.org (engine frames after E35);
  - send the crashing thread's top frames to pixl-web's
    `/api/triage/issue`, which groups them and files or updates the issue.
- [ ] **S** · Releases close the loop:
  - Fix commits name the triage issue ("fixes pixl-triage#12"). The
    release workflow closes those issues with "Fixed in <version>".
  - A report from that version or later then reopens the issue as a
    regression (pixl-web).

### Pass 25 — Signing in with a PIXL account · 5 pts

After: pixl-web "PIXL account" (the Supabase project, the OAuth server and
the sign-in and consent pages), and its redirect-URI spike.

- [x] **L** · "Sign in" (Settings → Account, and the beta gate) runs OAuth
      2.1 authorization code with PKCE against Supabase Auth as a public
      client: the system browser opens at `/oauth/authorize`, the code comes
      back on `http://127.0.0.1:47823/callback` (a fixed port, as Supabase
      matches redirect URIs exactly; `pixlplayroom://auth/callback` is the
      fallback if pixl-web's spike shows loopback refused), `state` is
      checked, and the code is
      exchanged at `/oauth/token`. All of it runs in the main process; the
      renderer never sees a token.
      _Done: `src/main/account/` (`oauth.ts`, `session.ts`, `index.ts`),
      `src/shared/account.ts` (client `83eab600-…`, from pixl-web's spike),
      Settings → PIXL account (Sign in… / Cancel / Sign out),
      `scripts/mock-account.mjs`. Checked end to end against the mock
      (sign in, sealed on disk, kept across a relaunch, sign out ends the
      server session), and the real pixl-core accepts the authorize request.
      Real sign-in checked 2026-10-01 against production (pixl-web's
      sign-in and consent pages): the code came back to the loopback, and
      the session was kept sealed._
- [x] **S** · Tokens at rest: the refresh token is encrypted with Electron's
      `safeStorage` (Keychain or DPAPI), the rotated token is saved on every
      refresh, and "Sign out" forgets the tokens and the entitlement. A grant
      revoked from the account page ("Signed-in apps") signs the app out at
      its next refresh.
      _Done: refreshes are single-flight (pixl-core doesn't catch a refresh
      token used twice); only a 400/401 signs out, so a rate limit or an
      outage keeps the session; without the keychain nothing is written.
      Sign out also calls Supabase's `/logout?scope=local`, best effort.
      That call is only tested against the mock; check it on pixl-core once
      a real sign-in works. The entitlement isn't wired up yet (Pass 26)._
- [x] **S** · Device identity: the app sends an HMAC-SHA256 of the OS machine
      id (IOPlatformUUID on macOS, MachineGuid on Windows), keyed per
      product, never the raw id, plus a name for the account page ("Studio
      (macOS)").
      _Done: `src/main/account/device.ts`, keyed `pixl:<product>:device:v1`
      as agreed, with the ids read through absolute paths; `deviceName`
      moved there from `licence.ts`. Not yet sent: Pass 26 sends it._

### Pass 26 — Access from the account replaces licence keys · 5 pts

After: Pass 25, and pixl-web's entitlement API.

- [x] **L** · Replace Lemon Squeezy's licence API in `src/main/licence.ts`
      with pixl-web's `/api/entitlements`. It returns a signed token (Ed25519,
      with a key id; the public keys are built into the app) for this
      account, product and device: what it holds (beta, trial, licence,
      add-ons), until when, and when to refresh. The app checks the token
      offline, so editing `licence.json` no longer grants anything. The
      offline grace is the token's lifetime (30 days, as now). The app
      refreshes at launch and daily. `LS_PRODUCT` and the key field go;
      update `tests/licence.test.ts`.
      _Done: `src/main/account/access.ts` (fetch, keep and check the token),
      `api.ts` (the Worker's API, a 401 refreshed once), `entitlement.ts`
      (the token and the key set), `src/shared/licence.ts` (the states:
      signed out, checking, no trial, trial, trial ended, licensed, beta,
      revalidate, device limit), Settings → Licence, `src/main/licence.ts`
      (refresh at launch when due, after signing in, hourly when due, on
      focus after 10 minutes; forgotten on sign-out). Lemon Squeezy is
      gone from the app; buying is the website's. Signing keys are
      hot-swappable: the app ships only roots (`ROOT_KEYS`, root-1 plus a
      spare root-2), and each answer brings a key set signed by a root
      (`scripts/entitlement-keys.mjs`; agreed with pixl-web). Checked end to
      end against the mock (beta, no_beta, licence, the device limit and
      freeing a device, a hand-edited licence.json refused, sign-out).
      Limit: a copy that's offline can restore an older token of its own
      from a backup and keep it until that token's month runs out._
      _Checked 2026-10-01 against the real Worker: before joining the beta
      it answered `no_beta`; after joining through playroom.pixlfoundation.com/beta/
      the app got a token signed by `ent-2026-10`, in a key set signed by
      root-1, for this Mac's device hash (beta, 30 days, refresh after 24 h),
      and it checks out offline against the production roots alone.
      The licence actions now log their outcome (`licence: check done
      (beta)`), which the test showed was missing._
- [x] **S** · "Start 14-day trial" asks the server. It refuses a second
      trial on the account, or on this device under any account, and the app
      says which. The local trial (`trialStartedAt`) goes.
      _Done: Settings → Licence "Start free trial"; `trial_used_account`
      and `trial_used_device` show their own message._
- [x] **S** · The fourth device: the server refuses it, and the app links to
      the account page to free one (that page is pixl-web's).
      _Done: the app lists the account's devices with Free beside each
      (`DELETE /api/devices/:id`), and links to the account page as well._
- [x] **M** · Gate what an ended trial and an unconfirmed licence lock with
      `allows()`.
      _Done (behind `LICENCE_ENFORCED`, still off): a lapsed licence locks
      exporting only (`LICENSED`); `requireLicence('export')` refuses
      `export:start`, and the Export dialog says why, with Open Settings… /
      Buy._

### Pass 26a — The beta gate, and the switch to 1.0 · 5 pts

After: Pass 26 and Pass 23a (`policy.json`).

- [x] **M** · A beta build (a version with `-beta`) needs beta access: until
      the user signs in with an account that has it, the window shows only
      "Sign in" and "Join the beta" (which opens the beta page). The main
      process enforces it too: `handle()` refuses every channel but account,
      updates, prefs and app info, so a patched renderer opens nothing.
      Development and automation (`PLAYROOM_HIDDEN`) skip the gate.
      _Done: `src/shared/gate.ts` (`gateFor`, `allowedWhileGated`),
      `src/main/gate.ts` (fed by the account, access and policy, told to
      the window on `app:gate-changed`, refusing other IPC with `Gated`),
      `views/Gate.tsx` (sign in, join, checking or offline, free a device,
      beta ended). The renderer's launch waits until the gate first opens.
      Coming back to the window while gated asks the account again, so
      joining in the browser opens the app. `PLAYROOM_BETA_GATE=1` brings
      it back in development. Checked end to end against the mock: signed
      out → sign-in (library refused); no beta → join (refused); joined →
      open, the library starts; `betaOpen: false` → beta ended (refused)._
- [x] **M** · Say why there's no access: today a `no_beta` or `beta_ended`
      refusal forgets the token and Settings shows "Checking your account…".
      Keep the refusal in `Access` (as the device limit is), so the gate
      can say "not in the beta" or "the beta has ended".
      _Done: the `no-beta` and `beta-ended` states._
- [x] **M** · The beta ends: once `policy.json` or the entitlement says so,
      a beta build shows "The beta has ended" with the update to 1.0. 1.0
      ignores beta access, offers the trial, and shows the tester's discount
      code on the trial and Buy screens.
      _Done: `betaOpen: false` (scripts/policy.mjs) or `beta_ended` from
      the Worker shows it, with the update (a stable release writes the
      beta feeds, so beta builds are offered 1.0) and the download link.
      In 1.0 the beta gate is off, and Settings → Licence offers the trial
      and shows the discount from the token._
- [x] **S** · For 1.0: turn on `LICENCE_ENFORCED`, and show Settings →
      Account in production.
      _Done: automatic. `licenceEnforced(version)` is true from 1.0.0 (not
      in betas or 0.x), and the Account and Licence sections show in beta
      builds and once enforced._

- [ ] **S** · A flaky test, found 2026-10-01: `tests/indexer.test.ts`, "a listing
      answers from the index, and a rescan with nothing new says nothing",
      fails under load (3 of 8 runs with four suites at once; about 1 in 15
      alone). `settle()` waits a fixed 50 ms, and the first scan's `changed`
      event can come after it. Wait for that event instead of a time.

### Pass 26b — Hardening, so the gate means something · 3 pts

After: nothing.

- [x] **S** · Only the app's own page may call the main process: `handle()`
      refuses a frame whose URL isn't the packaged `index.html` (or the dev
      server under `pnpm dev`), and logs it.
      _Done: `src/main/guard.ts` (`appPage`), `tests/guard.test.ts`; checked
      with a second window on the same preload, which is refused._
- [x] **S** · The window never leaves the app: `will-navigate` and
      `will-attach-webview` are denied, and links open in the browser only to
      pixlfoundation.com (and its subdomains) and lemonsqueezy.com, over
      https (`externalAllowed`).
- [x] **S** · The renderer runs sandboxed (`sandbox: true`); the preload
      needs only `contextBridge`, `ipcRenderer` and `webUtils`.
      _Done: library, develop and previews checked with `scripts/drive.mjs`._
- [x] **S** · Electron fuses in `electron-builder.yml`: no run-as-node, no
      `NODE_OPTIONS`, no `--inspect`, the app only from `app.asar`, and
      asar integrity checked. An edited `app.asar` refuses to start
      ("ASAR Integrity Violation").
      _Done: checked on a local unsigned macOS arm64 package (ad-hoc signed
      for the run). The fuses break Playwright on a packaged build, so
      `scripts/drive.mjs` drives only `out/`, as it always has._
- [ ] **S** · Check the same on a signed Windows build: the fuses read back,
      the app starts, and an edited `app.asar` is refused.

---

## Phase A — Bugs: lost edits and wrong output (passes 1–11)

### Pass 1 — Lost and misdirected edits · 5 pts

- [x] **S** · **An Upright-only edit is lost on save.** `geometry.upright` is
      in no recipe group (`shared/recipe.ts:707-831`), so `isEdited` is false
      and `saveRecipe` stores `null` (`indexer/service.ts:1608`); Upright also
      can't be pasted, synced or put in a preset. Add it to the `crop` group
      (or its own) and test.
- [x] **M** · **Switching photos quickly can open the wrong one.**
      `develop.open` (`state/develop.ts:287-334`) has no generation check after
      its awaits, and `session` keeps the old photo while loading; main's
      `DevelopSessions.open` (`render.ts:1467-1491`) closes other sessions
      before its own awaits, so two can stay live. Arrowing through the
      filmstrip can show B while C is selected, and edits go to the wrong
      photo. Add an open token on both sides; clear `session` at the start.
- [x] **S** · **Undo can hide the wrong step.** `commit` fires
      `historyAppend` without awaiting it (`develop.ts:369`); `undo` waits only
      for `landing`, so a quick Cmd+Z hides the previous step and the commit's
      `.then` clears `redo`. Chain the append through `queueHistoryOp`.
- [x] **S** · **Paste and Sync in Develop skip history.**
      `commands.ts:438-441` and `Dialogs.tsx:752-755` set the recipe with no
      step, so Cmd+Z undoes the edit before the paste. Use
      `replace(recipe, 'Paste settings')`; add a `.catch` (errors are
      swallowed).

### Pass 2 — Saves, exports and thumbnails · 5 pts

After: Pass 1.

- [x] **M** · **A crash can silently revert the last edits.** The recipe is
      saved 600 ms after its history step and a failed `persist` is only logged
      (`render.ts:488-491`); on the next open the stale recipe is recorded as
      "Opened as saved" (`develop.ts:316-322`). Write the history step and the
      recipe in one project transaction; tell the user when a save fails.
- [x] **S** · **Export can overwrite the original on a case-insensitive
      disk.** The guard is `out === row.path` (`exporter.ts:223`), so
      `IMG_1.jpg` passes for `IMG_1.JPG` with collision "overwrite". Compare
      `realpath` or dev+inode (or case-fold on darwin/win32), before the
      collision branch.
- [x] **S** · **Stale thumbnail and preview after an edit.** `queueThumb`
      skips a key still in `queued` (`library.ts:259-263, 279-283`), so an
      edit saved while that photo's thumbnail renders never re-queues. Mark it
      dirty and render again after.
- [x] **S** · **Two thumbnail renders can write the same file.**
      `hashPicture` calls `this.thumb()` directly (`library.ts:183`), bypassing
      the queue; same stamp, same output name (`library.ts:309-312`). Route it
      through the queue.

### Pass 3 — Render file races · 5 pts

- [x] **M** · **Two builds of the same working set at once.** The in-flight
      key includes `m`/`p` (`pixels/working.ts:286`), so after a heal stroke
      `bakeSpot` (`render.ts:1411`) and `refreshWorking` both write
      `proxy.tiff`/`draft.tiff` in place; a render can read a half-written
      file, and `set.json` (last writer wins) can lose `master`. One in-flight
      build per key, master chained after proxies; write to a temp name and
      rename (see E5).
- [x] **M** · **A recycled preview slot can show the wrong picture.**
      `lastEvent[kind]` keeps `view-<slot>`, but the 6 slots are shared with
      mask and headroom (`render.ts:563-593`); a full render matching an
      earlier signature re-sends a file that now holds another draft. Masked
      stats and pickers read it too. Name each render's file uniquely and
      prune, or drop `lastEvent` when its slot is reused.
- [x] **S** · **One failed lens bake degrades the session until the next
      edit.** `bakePending()` stays true (`render.ts:458-461, 526, 558`), so
      settled renders use the draft and mask/before/headroom never run.
      Remember the failed key, treat it as not pending, schedule a full render.

### Pass 4 — Denoise, virtual copies, AI jobs · 5 pts

- [x] **M** · **Denoise can drop heals, then flashes the original.** The
      denoise step is computed on the steps that existed when it started and
      appended on top of heals made meanwhile (`ai/denoise.ts:166-201`);
      `addPixelStep` doesn't wait for the working pixels (`steps.ts:18-19`) and
      `finally` clears the preview (`denoise.ts:325`), and the preview TIFF is
      deleted while a queued render may read it. Insert at the computed
      position (or serialise the jobs); await `refreshWorking`, then delete.
- [x] **S** · **Closing one virtual copy deletes the others' lens-corrected
      proxies.** `pruneLensed` keeps only the closing copy's set
      (`render.ts:1443`, `proxy.ts:291-297`); keep every copy's current set.
- [x] **S** · **Partial lens map; colliding freeze names.**
      `pixels/lensmap.ts:49` can return a partially written map;
      `freeze.ts:72` names files by `Date.now()` alone.
- [x] **S** · **An AI job says "Cancelled" after it applied.** Enhance adds the
      step inside `run()`; Cancel in the save stage throws `Cancelled`
      (`ai/jobs.ts:169`) and skips `onResult`. Check the signal before
      committing, finish as done once committed; give the JXL convert in
      `enhance.ts` (~268) the signal.

### Pass 5 — Crop and orientation · 5 pts

- [x] **M** · **A crop collapses to 0×0 under Upright.** `dragCrop` calls
      `cropFits` without `g.transform` (`crop.ts:45`), so crops reach the empty
      wedges; `fitCrop` (`compile.ts:436-461`) only shrinks about the centre and
      ends at width 0, which the engine refuses. Pass the transform; in
      `fitCrop` move the centre in when it doesn't fit, with a minimum size.
      (Reproduced: Upright Scale 75, crop {0.8, 0.8, 0.2, 0.2}.)
- [x] **M** · **Flip and Rotate leave geometry in the old frame.** Flip keeps
      the crop and straighten unmirrored (`renderer/lib/geometry.ts:17`), so the
      other half shows and a level horizon is 6° off; Rotate keeps the aspect
      lock (a 3:2 crop cuts 56% after rotating) and Upright's `suggested` and
      guides in the old orientation (`geometry.ts:14-16`, `render.ts:1296`).
      Mirror `crop.x` and negate straighten and Upright on flip; invert the
      aspect and clear or remap Upright on an odd turn.
- [x] **S** · **A tiny straighten is refused.** Under 5e-5 it rounds to
      `rotate_degrees: 0` but still sets `outside: 'Crop'`
      (`compile.ts:1196`). Test the rounded value.

### Pass 6 — Mask and heal precision · 5 pts

- [x] **S** · **A Subtract component becomes Add** when the one before it is
      dropped (a brush whose plane didn't hydrate, a one-point lasso):
      `compile.ts:725-730` promotes it. Drop leading non-Add components.
- [x] **S** · **Heal lens map read with the wrong pixel convention**:
      written as i/(mw−1), read as a fraction by `toSource` and as v·(w−1) by
      `unwarpMask` (`pixels/heal.ts:58-70`, `ops.ts:93`); ±2.8 px at the edges
      of 6000 px. Use (v·(mw−1)+0.5)/mw.
- [x] **S** · **Heal radius not mapped through the lens correction.**
- [x] **S** · **Proxy heal patches snap to whole pixels** (a 15.8 px patch is
      drawn at 17 px).
- [x] **S** · **Mask overlay draws gradients compile drops** (no plane file
      yet), so the overlay shows a mask that isn't applied.

### Pass 7 — Lens, presets and paste · 5 pts

- [x] **S** · **Lens profile resolve throws at f-number 0** (manual or adapted
      lenses): `stops(0)` is −Infinity, the aperture filter returns `[]`, and
      `interpolate([])` crashes (`lens.ts:446-453`, `lensprofiles.ts:355`).
      Treat ≤ 0 or non-finite as null; guard the empty list.
- [x] **S** · **Lens paste carries the source's measured CA** to every target
      (`main/ipc.ts:206-214`); a failed re-resolve keeps the source's profile;
      Develop presets re-resolve nothing. Clear or re-measure `ca`; set
      `resolved = null` in the catch.
- [x] **S** · **Old saved presets are never normalised** (`db.ts:815`,
      `left.tsx:41`); one saved before `colorGrade.add`/`effects.wash` makes
      compile throw. Normalise when listing.
- [x] **S** · **Sync and Save Preset on an untouched RAW pre-tick profile,
      sharpening and noise** (`Dialogs.tsx:722, 853` compare against
      `defaultRecipe(false)`); syncing to JPEGs gives them the Standard
      profile, sharpening 40 and colour NR 25. Use `defaultRecipe(isRaw)`.
- [x] **S** · **A pasted crop isn't rebuilt to the locked aspect** on a
      differently shaped photo.

### Pass 8 — Recipe hardening · 5 pts

- [x] **M** · **`normaliseRecipe` doesn't validate inside arrays**
      (`recipe.ts:568-607`): `layers: [null]` throws; a layer without
      `enabled`/`opacity`/`blend` compiles to `opacity: null`; `splits: [25]`
      gives null curve values; a null curve point throws; a one-point curve
      reaches the engine; a non-object crop compiles to NaN. Normalise layer
      fields, splits, curve points and the crop rectangle; add fuzz cases.
- [x] **S** · **`curve()` dedupes before `round4`**, so 0.50001 and 0.50004
      both become 0.5 (not strictly increasing).
- [x] **S** · **`changedGroups`/`isNeutral` compare with `JSON.stringify`**,
      so the same values in another key order count as changed.
- [x] **S** · **Vignette rotation is clamped to ±45 after Upright's rotate is
      subtracted.**

### Pass 9 — App-level bugs · 5 pts

- [x] **S** · **Shortcuts leak through the confirm dialog.** `App.tsx:333`
      checks only `lib.dialog`; Esc on a confirm also runs `develop.escape`
      (can jump to the Library), Delete removes the selected mask, digits rate.
      Also return when `useConfirm.getState().open`.
- [x] **S** · **The updater loses a downloaded update.** The 4-hour re-check
      after a download sets `checking`, then `error` offline
      (`updater.ts:51`); `installUpdate` (`updater.ts:63`) then refuses. Skip
      checks once downloaded, or keep a `downloaded` flag.
- [x] **S** · **A finished model `.part` never resumes**: quitting during the
      checksum makes the next try send `Range: bytes=<size>-` → HTTP 416,
      forever (`ai/models.ts` `fetchFile`). If `from === bytes`, verify and
      rename; on 416, delete the part and restart.
- [x] **S** · **ImageBitmaps are never closed** (`MaskCanvas.tsx:159, 172,
    226-227`): drafts arrive per frame and hold tens of MB until GC. Close
      on replace and eviction.
- [x] **S** · **exifr leaks a FileHandle on Node 26**
      (`exifr/src/file-readers/FsReader.mjs:27-28`: `fh.stat(path)` is refused
      and the handle is garbage-collected; a truncated JPEG kills the
      process). Electron 44 (Node 24) is fine today. Read the head ourselves
      (as `headOf` does) and pass exifr a Buffer (`camera.ts:56`); add a real
      JPEG fixture. Replaces the old "indexer test fails on Node 26" item,
      which passes now.

### Pass 10 — Projects and durability · 5 pts

- [x] **L** · **Projects are linked to photos by name only**
      (`service.ts:399-408`). A new `IMG_0001.JPG` after a counter reset
      inherits an old project (recipe, history, embedded original); a renamed
      photo detaches and its project shows as a stand-in. Check size and SHA-1
      from `origin`; follow a rename by hash.
- [x] **M** · **Quit and create can leave a torn project.** `stop()` kills the
      index host after 2 s (`indexer/client.ts:79-82`), mid-transaction during
      an embed or scan, leaving a hot `.pixl-journal` beside the photo;
      `createProject` renames into place without a directory fsync, then
      deletes the sidecar and index history (`service.ts:516-521`,
      `pixlfile.ts:234`). Ask the host to finish its transaction and close;
      fsync the directory before deleting the old copies.

### Pass 11 — Behaviour calls (needs your decision first) · 4 pts

- [x] **M** · **On a B&W photo a mask's Temp/Tint adds colour**: mask layers
      run after the base layer's saturation 0 (`compile.ts:1044`). Decide:
      keep (it's a tint tool) or run masks before B&W.
- [x] **M** · **Built-in presets replace whole groups**: "Soft portrait"
      resets exposure and whites to 0; "Warm film" deletes point colours.
      Decide: partial presets (only the fields they set) or keep.

---

## Phase B — Performance: quick wins (passes 12–22)

Biggest felt lag first: slider jank, save cost, background contention.

### Pass 12 — Slider jank · 5 pts

- [x] **M** · **`edit()` deep-clones the whole recipe on every input event**
      (`state/develop.ts:354`: `structuredClone`), so every subscriber to any
      slice re-renders per tick: the Loupe, both `MasksWindow`s, every slider
      in the open panel, the presets rail. Use structural sharing (immer
      `produce`) so untouched slices keep their identity; have `RS`
      (`global.tsx:63`) select its own number.
- [x] **S** · **Loupe geometry and mask redraw per tick.** Memoise
      `viewGeometry` (`Loupe.tsx:131`) on the geometry/lens slices so
      `SharpTile`, `BrushLayer`, `GradientTools`, `LassoEditor` keep `memo`;
      `MaskCanvas` compares `layer.components` by identity instead of a global
      subscribe with `JSON.stringify` (`MaskCanvas.tsx:122-123`) and stops the
      GL `compose()` per tick (`:308`).
- [x] **S** · **`edit()` + `commit()` send two identical updates** (hydrate,
      normalise and compile twice; the first render aborted):
      `masks/model.ts:280-302`, `BrushTool.tsx:226-250`, `ui.tsx:140-153`.
- [x] **S** · **Listener and poll churn**: `Slider`'s effect has no deps and
      re-adds two window listeners every render (`ui.tsx:131`); `ProjectRows`
      polls IPC every 4 s forever (`left.tsx:321`); `usePresets(4000)`
      (`hooks.ts:13`) re-sets the list every 4 s; `BrushLayer` sets state per
      pointermove for the cursor (`BrushTool.tsx:269-270`).

### Pass 13 — History and save cost · 5 pts

- [x] **S** · **History replay clones the whole recipe per step**
      (`history.ts:144`), and `append` reads the whole history three times
      (`historytable.ts:130-152`): ~20 ms at 200 steps, linear, in the index
      process every commit and on the renderer's main thread every undo.
      Clone once, apply ops in place (measured ~18 ms → ~0.3 ms); build the
      log in memory.
- [x] **S** · **Reading history takes a write lock and records a write**:
      `BEGIN IMMEDIATE` (`historytable.ts:90`, `pixlfile.ts:298`) and
      `noteProjectWrite` (`service.ts:1758-1768`) on a read. Drop both.
- [x] **S** · **Every save rewrites every item and snapshot**
      (`service.ts:1586-1590`, `pixlfile.ts:406-442`). Update the changed row
      only; skip `putPlane` for refs already stored.
- [x] **S** · **Thumbnail jobs read and hash whole hydrated projects**
      (`service.ts:1694-1714`): read one item, keep it slim, hash the slim
      recipe.
- [x] **S** · **The origin cache misses after our own writes** (keyed on the
      file stamp, `service.ts:300-308`), opening a second connection per edit.
      Invalidate on `setOrigin` or a foreign change only.

### Pass 14 — Index plumbing · 5 pts

After: Pass 13.

- [x] **S** · **The open photo's project closes after 2 s idle**
      (`pixlfile.ts:665`), dropping its statement cache. Keep the Develop
      photo's project open until its session closes.
- [x] **S** · **No busy timeout, loose transactions, a missing index**: set
      `busy_timeout` 2–5 s; wrap `mirror` and `openData`'s plane copies in a
      transaction; `CREATE INDEX photos_project ON photos(project_path)`.
- [x] **S** · **Opening a photo waits on sequential calls**
      (`develop.ts:311-322`): run `open` and `historyList` together; compare
      recipes with a deep-equal, not `JSON.stringify` (key order makes a
      spurious "Opened as saved").
- [x] **S** · **`isEdited` does ~76 deep clones per call** (19 groups × 2
      `applyGroups`), per photo in the indexer (`service.ts:703, 713, 1608,
    1710`). Compare each group's fields directly; stop at the first change.
- [x] **S** · **A thumbnail render and preview write at every 600 ms pause**
      (`render.ts:479, 489`; `library.ts:353-418`): a full graded render on the
      background engine that warps the lens live. Queue them on session close
      or after a few seconds idle.

### Pass 15 — Background work stops competing with editing · 5 pts

- [x] **M** · **Background engine work uses every core.** `blankRequest`
      defaults to `INTERACTIVE_THREADS` (`source.ts:216`) and `proxy.ts` never
      overrides it: proxy builds, the bake after every lens/heal edit
      (`render.ts:435-462`), `ensureMaster`, export encode (`exporter.ts:199`),
      Auto WB analyze (`autowb.ts:51`). Pass `BACKGROUND_THREADS` from
      background callers.
- [x] **S** · **No process is niced.** `os.setPriority(pid, 10)` for the
      background and AI engines and the index host.
- [x] **M** · **Batches that can't be stopped or bounded.** Auto WB queues
      every photo at once with `Promise.all` (`autowb.ts:269`); 500 RAWs = 500
      proxy builds, no cancel. Whole-library duplicates (dHash renders) keep
      going after you navigate away (`library.ts:161-179`). Limit Auto WB to 2
      at a time with Cancel; tie duplicates to an AbortSignal.

### Pass 16 — The settled-render chain · 5 pts

Each release runs picture → mask → before → headroom → mask thumbnails
(`render.ts:526-531`), each decoding and grading again.

- [x] **S** · **The mask plane re-renders after every slider change**: its
      key includes `lastFull`, a rotating file name (`render.ts:795`), then
      `analyze` decodes the JPEG and plane again (`:830`). Give the plane its
      own key; re-analyze only when the picture changed.
- [x] **S** · **Mask thumbnails render at 1280 for ~64 px tiles**, and range
      masks' keys include the grade (`render.ts:859, 896`). Render at ~256.
- [x] **S** · **"Before" is a 2560 PNG even without alpha**
      (`render.ts:977-983`). JPEG when there is no transparency.
- [x] **S** · **Previews are JPEG q95 with no chroma subsampling**
      (`render.ts:606`). Use 4:2:0 for full renders.
- [x] **S** · **The plane store LRU holds 48** (`planestore.ts:12`): a photo
      with more brush components misses on every update. Size it by bytes.

### Pass 17 — Compile hot path and opening a photo · 5 pts

- [x] **M** · **Per-frame hashing on the main process**: `brushPlanes`
      re-hashes each brush PNG per compile (`brushes.ts:56`) though the key
      equals `planeRef`; `lensKey()` runs 4–6 times per update
      (`render.ts:407, 424, 502, 554, 558`); the cache key stringifies a
      ~28 KB `.cube` whenever exposure > 0 (`compile.ts:959`). Key brushes by
      ref; memoise `lensKey` on lens/retouch identity; key the cube by hash.
- [x] **M** · **Opening a photo is one long serial path**
      (`render.ts:1475-1490`): `probe` runs on the background engine
      (`library.ts:95`) behind thumbnails and exports, its cache is in memory
      only, and the first render is a full 2560 render plus a 2560 before.
      Probe on the interactive engine and persist probes; render a draft
      first.
- [x] **S** · **An untouched framing misses the engine's fast path**: an
      aspect equal to the frame's emits a `{0,0,1,1}` crop.

### Pass 18 — Glass and UI loops · 5 pts

- [x] **S** · **The liquid-glass filter re-filters every frame during pan,
      zoom, brush and window drags**: only `edit()` sets `data-interacting`
      (`develop.ts:359`; `primitives.css:747-751`). Call `touchInteracting()`
      in `Loupe.tsx:186` `preview`, the brush pointermove and `startDrag`.
- [x] **S** · **A WebGL gradient renders at 30 fps behind every dialog**
      (`fx/AmbientGradient.tsx:71`, `DialogBackdrop.tsx:14`) under refracting
      glass. Stop its clock after one frame there; flat glass for modals.
- [x] **S** · **An open Popover runs a layout-forcing rAF loop**
      (`Popover.tsx:79-100`). ResizeObserver plus scroll/resize listeners.
- [x] **S** · **Range masks re-decode the full preview on every draft**
      (`MaskCanvas.tsx:167-177, 308`). Decode downscaled; refresh on settled
      renders only.
- [x] **S** · **Dragging the masks window writes localStorage per pointer
      move** (`MasksWindow.tsx:695` → `ui.ts:177`, no `partialize`). Move it by
      transform, commit on pointer-up; `partialize` and throttle storage.

### Pass 19 — Library responsiveness and the startup chain · 5 pts

- [x] **M** · **The library re-sorts everything on every thumbnail.**
      `onThumb` does `items.find` + `patchItems` over all items
      (`App.tsx:360-367` → `library.ts:265-276`): O(n²) while a folder fills.
      `useVisible()` filters and sorts 3–5 times per change; the inline
      `onOpen`/`onPick` defeat `memo` (`Library.tsx:468`, `Filmstrip.tsx:38`);
      `selection.includes` per tile (`Library.tsx:49`); `MetadataEditor.tsx:236`
      is O(N·K); search filters per keystroke. Batch thumbnail events per frame
      with a key→index map; compute `visible` once; stable callbacks by key; a
      `Set` selection; `Intl.Collator`; `useDeferredValue` on the search.
- [x] **S** · **The startup chain is serial**: the index host runs
      `prunePlanes` (a regex over all history JSON, 3.5 MB and growing) before
      hello (`indexer/host.ts:31-38`); the renderer loads recents,
      collections and keywords before opening the last folder
      (`App.tsx:410-422`). Say hello first and prune when idle; open the last
      source alongside.
- [x] **S** · **Startup does work it could defer**: both lens catalogues are
      parsed, hashed and validated (`lensprofiles.ts:207-210`, and again in
      `check()` at `:266`) — compare `generated` dates and parse the newer;
      `bgEngine.start()` is eager (`index.ts:192`); `sysctl` via
      `execFileSync` at module load (`source.ts:146`).
- [x] **S** · **Unreadable files are retried every launch** (failures in
      memory only, `service.ts:174`). Persist them with the version key.

### Pass 20 — Startup relaunch and folder open · 4 pts

- [x] **M** · **A packaged launch on a Retina Mac starts twice**, after
      loading every static import (electron-updater ~65 ms, exiftool-vendored
      ~36 ms): `bootScale` relaunches when the scale switch is missing
      (`display.ts:38, 92-101`; `index.ts:55-59`). A tiny entry that runs
      `bootScale` first, then imports the app; load the updater only when
      packaged and exiftool only for export and metadata.
- [x] **M** · **Opening a folder redoes all per-item work.** A full rescan
      every time (`service.ts:217-222`), an unchunked `statSync` loop in
      `fillXmp` (`:757-765`), a thumbnail job per item (`library.ts:136, 151`)
      whose `recipe()` opens each sidecar or `.pixl`, and `fillCameras`
      triggering a second full `refresh()`. Store the recipe hash in the row so
      a thumbnail job compares stamps without reading files; skip a rescan done
      seconds ago; chunk `fillXmp`.

### Pass 21 — Disk cache hygiene · 4 pts

- [x] **M** · **Caches grow without limit** (12 GB in `cache/photos` on the
      dev machine; 158 `lens-*` files ≈ 1.6 GB for one photo; 2,623 thumbnails
      on disk, 646 referenced). Delete the previous lens set when a new one is
      installed (keep current + one; today only on close, fire-and-forget,
      `render.ts:1443`); unlink the old thumbnail in `setThumb` (`db.ts:680`,
      `library.ts:309`); prune `before-*.png`, `mthumb-*`, `brush-*`, `heal-*`
      and `freeze-*`.
- [x] **M** · **The frozen-mask cache misses on every stroke**: keyed on
      `master.path`, which changes per stroke, so a stroke inside a mask
      re-freezes it at full resolution; when it hits, it ignores the grade a
      colour-range mask depends on. Key on the steps' content and the grade.

### Pass 22 — HDR and pixel-step formats · 5 pts

- [x] **M** · **HDR paths inflate 16-bit PNGs per render**: PQ/HLG proxies
      are 16-bit PNG (`proxy.ts:117-122`); `measureHdr` runs a second graded
      pass written as a 16-bit PNG only to measure it (`render.ts:597, 666`);
      the gain-map master is a 16-bit PNG (`hdrsource.ts:95-110`, 1–2 s to
      inflate per 1:1 tile); 1:1 tiles are PNG at device size
      (`render.ts:1017-1072`). Uncompressed TIFF where cICP isn't needed, a
      cheap encoder for the stats pass, JPEG tiles.
      _Done: the stats pass is an uncompressed TIFF, 1:1 tiles are JPEG.
      Left for E34: the PQ/HLG proxies and the gain-map master need cICP._
- [x] **S** · **Pixel steps**: `layOn` runs proxy then draft in sequence
      (`working.ts:344-357`), and `stepImage`/`sized()` write full-resolution
      16-bit PNG caches (`working.ts:113-172`). `Promise.all`; TIFF.
      _Done: proxy and draft are laid on together. Left for E33: overlays
      take only PNG._
- [x] **M** · **HeadroomOverlay is a full-preview CPU pass**
      (`HeadroomOverlay.tsx:49-58`: `getImageData` + LUT + `putImageData`, ~5 MP
      per settled HDR render). A GPU LUT, as `ClippingOverlay` does.

---

## Phase D — Performance: architecture (passes 27–35)

### Pass 27 — History keyframes · 3 pts

After: Passes 2, 13.

- [x] **L** · Store a full recipe every K steps (or a cached head) so
      appending is O(1) and hide/show replays from the nearest keyframe; make
      `items.recipe` the history head, written in the same transaction.
      _Done: a keyframe every 25 steps (`historytable.ts`); an append reads
      at most 25 rows and returns only what changed (`HistoryAppend`,
      `appendToLog`); hide/show/delete rebuild keyframes and send the head,
      so the renderer doesn't replay. The recipe and step were already one
      transaction (`commitEdit`, Pass 2)._

### Pass 28 — One write-behind queue per project · 4 pts

After: Pass 27.

- [x] **L** · Merge recipe, history and preview writes within ~250 ms into
      one transaction; flush on idle, session close and quit.
      _Done: `ProjectPool.write` opens a batch committed after 250 ms (or on
      leaving Develop, idle close, drop and quit); `tx` inside it is a
      savepoint; the index notes each commit's mtime (`projectCommitted`)._
- [x] **S** · Then `PRAGMA fullfsync` on macOS: `synchronous=FULL` alone
      doesn't reach stable storage, so the "every commit on disk" comment
      (`pixlfile.ts:190`) is false today. Measured 15.6 ms per commit,
      affordable once batched.

### Pass 29 — Mask planes as content-addressed blobs · 4 pts

After: Pass 28. A `.pixl` format version bump (docs/pixl-format.md).

- [x] **XL** · Store planes as binary BLOBs keyed by SHA-256 in the existing
      `blobs` table instead of base64 TEXT (a third larger); only refs cross
      IPC (today `saveRecipe`, `thumbJob`, `openData` and `slim` ship PNGs
      between processes, ~800 KB with two brush masks). Retires the 32-bit
      `hash32` + length ref, where a collision under `INSERT OR IGNORE` could
      silently swap masks. Migrate existing projects.
      _Done: planes are SHA-256-named binary blobs (`planeref.ts`; the
      project's `blobs`, kind `plane`; the index's `plane_blobs`, migration
      9); format 2, version-1 projects upgrade on open, renaming every ref.
      Recipes cross between main and the index by reference only (`Library`
      slims and hydrates; the index hydrates only sidecar files)._

### Pass 30 — Off the index request loop · 5 pts

- [x] **L** · Embedding the original (`putBlobFile`, `pixlfile.ts:507`: a
      SHA-256 of the whole file, synchronous) and `gc` block every index
      request, saves included. Move them to a worker with its own connection,
      or chunk them in small transactions with `state=pending`.
      _Done: `putBlobFileInPieces` hashes as a stream and writes a chunk per
      turn, the `blobs` row last (originals and pixel steps); `gc` runs a
      moment later (`gcLater`) and vacuums 4 MB a step; orphaned chunks go._
- [x] **M** · Take the library thumbnail from the picture Develop already
      rendered instead of a second background render.
      _Done: the session offers its last whole settled JPEG when it shows the
      saved recipe; the library shrinks it to sRGB, else grades as before._

### Pass 31 — One engine scheduler · 5 pts

After: Pass 15.

- [x] **L** · Hold background requests while interactive renders are in
      flight; don't start the next render until a cancelled one has stopped
      (`client.ts:258-263` settles at once; better with E6). The libuv pools
      (8/4) aren't the bottleneck; too many engine threads are.
      _Done: the client tracks calls the host is still on (cancelled ones
      too); background and AI calls wait up to 1.5 s behind interactive work
      (`holdFor`), a cancellable call up to 250 ms for cancelled ones._
- [x] **M** · A ~1920 px proxy between the draft and the 2560: on a Retina
      loupe `targetEdge` is box × DPR, so nearly every settled render uses
      2560 (`render.ts:559-560`); ~44% fewer pixels on a 1200 pt loupe.
      _Done: `mid` (1920) beside the plain and lens-corrected proxies, used
      for a view up to 1.25× its size (`MID_SHORTFALL`); pixel-step and HDR
      sets have none and use the 2560._

### Pass 32 — The preview as pixels, not a file · 4 pts

After: Pass 31.

- [x] **XL** · Each settled render writes a 2–4 MB JPEG, streams it back
      through `protocol.handle` in main-process JS (`protocol.ts:43-48`), and
      the loupe decodes it (~30–50 ms). Hand the renderer raw pixels
      (`Encode::Pixels`, engine 0.15) over a transferred `MessagePort` into a
      canvas; no file, no decode. The histogram already comes from `measure`.
      _Done for drafts (the renders while a slider moves): RGBA pixels from
      the engine host straight to the window on their own port
      (`sendPreviewsTo`, `lib/frames.ts`), drawn on a canvas; main relays if
      no port is up. The settled picture stays a JPEG: main measures masks
      through it (`measureMask`) and thumbnails shrink it, and the engine
      cannot analyse from memory._

### Pass 33 — A virtualised library · 5 pts

After: Pass 19.

- [x] **L** · Virtualise the grid and the filmstrip (today only
      `content-visibility: auto`, `library.css:101`, which still pays React and
      DOM cost for N nodes).
      _Done with @tanstack/react-virtual: the grid by rows (columns as
      `auto-fill` worked them out; duplicate headings are rows), the
      filmstrip by tile; focus scrolls into view; tiles fly in only as a
      folder or the strip opens._
- [x] **M** · Near-duplicate grouping compares every pair, synchronously in
      the index host (`dupes.ts:74-83`). A BK-tree or multi-index hash.
      _Done: equal hashes joined first, then multi-index hashing (threshold
      + 1 blocks); tested equal to all pairs._

### Pass 34 — Folders as a tree; warm neighbours · 5 pts

- [x] **L** · Recursive folders and a folder tree in the sources sidebar.
      _Done: folder rows open out into their subfolders (read a level at a
      time); a Subfolders toggle (off by default, remembered) lists the
      photos below too (`deep`, up to 300 folders, 8 deep, no packages or
      links followed)._
- [x] **M** · Build proxies for the filmstrip neighbours of the open photo
      ahead of time, on the background engine.
      _Done: opening a photo asks for the next, previous and next-but-one
      (`develop:warm`); one at a time, newest request first._

### Pass 35 — Watching folders · 3 pts

After: Pass 34.

- [x] **L** · Watch open folders (FSEvents / `fs.watch`) in the index host
      instead of rescanning on open or refresh; changes made outside the app
      appear as they happen.
      _Done: the folder shown is watched (recursively with Subfolders); a
      change settles 400 ms, then its folder is rescanned and announced; a
      folder watched since its last scan is not walked again on open._

---

## Phase E — Masks, retouch and geometry (passes 36–39)

**Epic — AI subject and lasso masks bloom past their edge · XXXL (6):
passes 36–37.** The AI plane is soft (model probabilities) and low resolution
(1024 px, `ai/segment.ts`), upsampled over the photo; a lasso's feather is
symmetric about its edge, so half falls outside. The engine has only
`feather { radius, edge }` (an optional engine route is E14).

### Pass 36 — Mask edges 1/2 · 4 pts

- [x] **M** · Add `edge: { shift: −100…100, harden: 0…100 }` to
      `ComponentBase` and apply it where raster planes are written
      (`planes.ts` `writeBrushPlane`, in the pixels worker): a min/max filter
      of `shift` pixels contracts or expands; a levels curve around 50%
      hardens. Covers AI masks, brushes and gradients. Default new AI masks to
      a small contract and some harden (`ai/apply.ts`).
      _Done (`shared/maskedge.ts`): 100 = 3% of the shorter side, through an
      octagon (round, linear time); harden up to 10× steeper; new AI masks
      start at −15 / 35. The plane's file name carries the edge._
- [x] **S** · A lasso "inside" feather: offset the polygon inward by the
      feather radius before it reaches the engine (`compile.ts`
      `maskComponent`).
      _Done: `edge.inside` (on for new lassos; older ones keep their look),
      and a lasso's Shift offsets its polygon._
- [x] **S** · Shift and Harden on the component card (`MaskTool.tsx`
      `ComponentCard`).
      _Done, with "Feather inside the line" for a lasso._

### Pass 37 — Mask edges 2/2; intersect brushes · 4 pts

After: Pass 36.

- [x] **M** · The loupe's live mask preview applies the same shift and harden
      (`maskgl` shaders).
      _Done: a min/max shader runs the octagon's passes and hardens
      (`MORPH_FS`); lassos are offset as compiled._
- [x] **M** · Brush: intersect-with brushes.
      _Already worked (masks window: Intersect, then Brush paints a new
      intersecting brush component); checked end to end in the app._

### Pass 38 — Mask overlays and spots · 5 pts

- [x] **L** · A per-component overlay colour: needs a rendered plane per
      component (the overlay is one plane per mask today).
      _Done on the GPU preview, which has a plane per component: "Colour
      each component" (overlay settings) draws each in its own hue, a
      subtracting one hatched._
- [x] **M** · Visualise spots for the Heal tool (show dust and spots on a
      high-contrast view).
      _Done: Heal → Visualise spots, a local-contrast map on the GPU with a
      Level. Also fixed: the clipping and headroom overlays were drawn upside
      down (Chromium does not flip an ImageBitmap on upload)._

### Pass 39 — Geometry follow-ups · 5 pts

- [x] **M** · Heal spots under an Upright warp are placed round on the
      unwarped frame and show as circles on the warped one (close, not exact).
      _Done: the brush and the spot being placed draw the base circle carried
      through the warp (`spotOutline`), the shape that is healed._
- [x] **S** · Upright's focal length comes from the 35 mm equivalent only; a
      file stating only the real focal length and no crop factor gets 35 mm.
      Use the camera list's crop factor.
      _Done: `equivalentFocal`, with the lens catalogue's crop (`crop()`),
      sent with the session (`focal35`)._
- [x] **M** · Portrait RAWs: IMG_3086.CR2 (EXIF "Rotate 270 CW") shows and
      exports landscape. `source.ts:82-84` assumes a developed RAW comes out
      upright; check what rawler returns and fix here, or raise E25.
      _Checked 2026-10-01: engine 0.15 develops it upright (6288×4056 sensor,
      orientation 8 → 4000×6000 out, no framing asked), so `source.ts` is
      right and the app shows it portrait; E25 is not needed._

---

## Phase F — Develop features and phase leftovers (passes 40–52)

### Pass 40 — Tone and detail · 5 pts

- [ ] **L** · Tone curve: per-channel parametric (the region sliders are
      master only).
- [ ] **M** · Sharpening/NR previews at fit size (today sharpening shows only
      when its radius is ≥ half a proxy pixel, i.e. at 1:1).

### Pass 41 — Denoise and Enhance limits · 5 pts

- [ ] **M** · DRUNet's `MeasuredNoise` gain (1.33) under-states synthetic
      per-channel noise (halves σ 7 rather than removing it): check on
      high-ISO RAWs; add a Noise level override if needed.
- [ ] **M** · Virtual copies share the photo's denoise sets; pruning keeps the
      newest three, which a copy with other settings may lose (it rebuilds).
      Keep each live copy's set.
- [ ] **S** · A long-edge limit for Enhance ×4 (the request's `resize` after
      the chain).

### Pass 42 — Enhance previews and HDR · 4 pts

- [ ] **M** · A before/after preview of a crop before running Enhance: crop to
      a temp file first (the engine refuses `region` with a chain, E4; a JPEG
      rebuild needs the whole file).
- [ ] **M** · Enhance on HDR by tone mapping to SDR first, then upscaling as
      a second conversion (output SDR). Refused up front today.

### Pass 43 — HDR follow-ups · 4 pts

- [ ] **M** · Exporting an SDR-edited gain-map photo drops its map; carry the
      original map (or remake it) so the export stays HDR-capable.
- [ ] **M** · A LUT profile flattens an HDR photo's highlights: apply the
      table to the SDR range only, until E20.

### Pass 44 — One-time migrations and merges · 4 pts

- [ ] **M** · Existing edits on HEIC photos were placed on the sideways frame
      (crops, masks) and now land turned: offer to rotate them once.
- [ ] **M** · Importing collections adds copies; offer merging into existing
      collections of the same name.

### Pass 45 — Watermarks · 4 pts

- [ ] **M** · Text watermarks: a copyright line typed in the dialog, rendered
      to a PNG in the renderer (canvas) and handed over as a file.
- [ ] **M** · A watermark per preset folder of logos (light and dark
      versions, chosen by the picture's brightness under the mark).

### Pass 46 — Lens data · 5 pts

- [ ] **M** · Lensfun lens-centre offsets (`<center>`, unused in today's data)
      and its focal-spline interpolation (we interpolate linearly).
- [ ] **L** · Adobe LCP import (the user's own, not redistributable): LCP's
      perspective model and `Focal` unit map directly.

**Epic — Lens corrections the file carries · 8XL (11): passes 47–49.** Read
with ExifTool. Needs sample files (Owner tasks).

### Pass 47 — Corrections from the file 1/3 · 5 pts

- [ ] **L** · DNG `OpcodeList3`: WarpRectilinear → the engine's
      `Rectilinear`, `FarthestCorner`; FixVignetteRadial → `Multiply` at
      `Corrected`.
- [ ] **M** · Sony maker-note distortion and vignetting.

### Pass 48 — Corrections from the file 2/3 · 4 pts

- [ ] **M** · Fujifilm maker-note distortion and vignetting.
- [ ] **M** · Olympus/OM maker-note distortion and vignetting.

### Pass 49 — Corrections from the file 3/3; Constrain Crop off · 5 pts

- [ ] **M** · Panasonic maker-note distortion and vignetting.
- [ ] **L** · Constrain Crop off: keep a warped frame's empty corners as
      transparent (needs an alpha preview path; today a warp always crops).

### Pass 50 — Profile browser · 3 pts

- [ ] **L** · A profile browser with previews (camera-matching DCP and Adobe
      `.xmp` profiles wait on E21).

### Pass 51 — Soft proofing · 3 pts

- [ ] **L** · Soft proofing: preview through the output profile (the gamut
      warning waits on E22).

### Pass 52 — HDR on HDR displays · 3 pts

After: Pass 32.

- [ ] **L** · Show HDR photos as HDR on HDR displays (render PQ AVIF / PNG
      cICP to the loupe); today they are tone mapped for SDR.

---

## Phase G — Library, output and design (passes 53–64)

### Pass 53 — Compare and survey · 5 pts

- [ ] **L** · Compare view (two photos side by side).
- [ ] **M** · Survey view.

### Pass 54 — File operations · 4 pts

- [ ] **M** · Batch rename.
- [ ] **M** · Move, copy, and delete to trash.

### Pass 55 — Map; history that travels · 4 pts

- [ ] **L** · Catalog: map/GPS.
- [ ] **S** · History travels with a `.pixl` now; check what a sidecar-only
      photo keeps when its folder moves to another machine (the old item:
      snapshots but not history), and close or fix.

**Epic — Lightroom `crs:` interop · XXXL (6): passes 56–57.**

### Pass 56 — XMP interop 1/2 · 3 pts

- [ ] **L** · Read Lightroom `crs:` settings from `.xmp` where they map.

### Pass 57 — XMP interop 2/2 · 3 pts

- [ ] **L** · Write `crs:` settings where they map.

### Pass 58 — Slideshow · 3 pts

- [ ] **L** · Slideshow.

### Pass 59 — Print · 4 pts

- [ ] **XL** · Print module.

### Pass 60 — Web gallery · 4 pts

- [ ] **XL** · Web gallery.

**Epic — Book · XXXL (6): passes 61–62.**

### Pass 61 — Book 1/2 · 3 pts

- [ ] **L** · Page layout model and templates.

### Pass 62 — Book 2/2 · 3 pts

- [ ] **L** · Book editor and export.

### Pass 63 — Tethered capture · 5 pts

- [ ] **XXL** · Tethered capture.

### Pass 64 — Design polish · 5 pts

- [ ] **L** · A light theme.
- [ ] **M** · User-reorderable tools on the wheel.

---

## Phase H — Epics (passes 65–71)

**Epic — Layer-based editing · 15XL (18): passes 65–68.** Every manipulation
can be its own layer (exposure, a curve, an HSL move, a colour grade, a LUT…),
each with a name, visibility, opacity, blend mode, optional mask and a place in
an ordered stack. Today the global panels are one flat set of sliders per
recipe, and only masked local adjustments (`LocalLayer`) are layers.
After: Passes 8, 27.

### Pass 65 — Layers 1/4 · 5 pts

- [ ] **L** · A layer stack in the recipe (name, visibility, opacity, blend,
      mask ref, order).
- [ ] **M** · Migrate today's global settings to a base layer (recipes,
      presets, history bases).

### Pass 66 — Layers 2/4 · 5 pts

- [ ] **L** · The compiler emits one engine stage per layer, in stack order.
- [ ] **M** · Optional masks per layer, reusing the mask components.

### Pass 67 — Layers 3/4 · 5 pts

- [ ] **L** · A layers panel in Develop: add, rename, show/hide, opacity,
      blend, reorder, duplicate, delete.
- [ ] **M** · Layer groups.

### Pass 68 — Layers 4/4 · 3 pts

- [ ] **L** · Per-layer copy/paste, sync and presets.

**Epic — AI harness, cloud tiers and credits · 12XL (15): passes 69–71.**
MCP, bring your own agent; every agent action a history step tagged with actor
and run ID. After: Pass 27; Owner task "Tiers and credits".

### Pass 69 — AI harness 1/3 · 5 pts

- [ ] **M** · History steps carry an actor and a run ID.
- [ ] **L** · An MCP server with read-only tools (library, photo, recipe,
      history).

### Pass 70 — AI harness 2/3 · 5 pts

- [ ] **L** · MCP edit tools, each action a tagged history step.
- [ ] **M** · Review an agent's run: list, accept or undo its steps.

### Pass 71 — AI harness 3/3 · 5 pts

- [ ] **L** · A credits ledger (pixl-web).
- [ ] **M** · Cloud tiers gated in the app.

---

## Phase L — Looks catalog and smart looks (passes 72–76)

The Presets rail became a catalog: 284 looks made with Playroom's own
sliders (no bundled LUTs), camera colour first, then cinema, film stocks,
movies and TV, black and white, creative and essentials. Names are our own;
a camera, stock or film appears only as "Inspired by …" (`inspiredBy`), with
a no-affiliation line in the browser. Code: `src/shared/looks/`; the browser
in `src/renderer/src/views/looks/`. Done so far (the catalog, My Looks, the
browser, tuning, hover and Amount) is under "Done" → "Looks catalog".

**Smart looks** are looks that carry instructions as well as sliders: "mask
the sky and apply this", "mask skin", "mask this colour range", "mask this
object (by label)", "AI denoise". What works today runs now (range and
gradient masks, Subject/Background, DRUNet); sky, people parts, SAM2
objects, the open-vocabulary detector and NAFNet ship in the next engine
release and are gated at runtime on its capabilities (E28, E30, E45), never
faked. The result is ordinary masks and pixel steps.

### Pass 72 — Smart looks 1/4: instructions and the planner · 5 pts

- [x] **L** · `src/shared/looks/smart.ts`: `MaskTarget` (range, linear,
      radial, subject, background, sky, person part, object by label),
      `MaskInstruction` (parts with Add/Subtract/Intersect, feather, settings,
      amount, required), `StepInstruction` (denoise, deblur, scoped to a
      mask); `smart?` on `Preset`; `mask()`/`step()` in the DSL; `smart` in
      `LookFile` (`schema.ts`).
- [x] **M** · `AiCapabilities.targets` (ready / needs model / needs engine)
      and `pick`; `planSmart(look, caps, photo)` → immediate layers, ordered
      jobs (segments before the steps scoped to them), picks, skipped, ETA
      from the learned per-model rates. Tests: `tests/smartlooks.test.ts`.
      _Done: readiness is `AiCapabilities.smart` (`smartReadiness`); the next
      engine's flags are off in `main/ipc.ts` until its binding lands._

### Pass 73 — Smart looks 2/4: the runner · 5 pts

After: Pass 72.

- [x] **L** · `src/main/looks/runner.ts`: one run per photo, its jobs grouped
      (`group` on the job queue) under one progress bar; each starts when the
      one before lands; cancel stops the run. Lands on its photo when the
      user has moved on.
- [x] **M** · Each mask or step that lands amends the look's history step
      while it is the newest (Phase 5's amend), else adds "Look: X · Sky".
      Amount also scales the look's layers (`LocalLayer.amount`) and the
      denoise step's strength; swapping removes them and cancels the run.
      _Done: `LookRuns` in `main/looks/runner.ts` (tests:
      `tests/lookrunner.test.ts`), the protocol in `shared/looks/run.ts`, the
      renderer's side in `lib/applyLook.ts`. A mask that cannot be made is
      taken off and its scoped steps skipped. `promptJob` and `personJob`
      are wired when the engine has SAM2, the detector and people (E30, E45)._

### Pass 74 — Smart looks 3/4: picking, progress and the smart catalog · 5 pts

After: Pass 73.

- [x] **M** · Pick flow: an object with no detector, or no or several
      equally likely boxes, puts the loupe in a pick tool ("Click the car for
      Rain City Noir · drag for a box · Esc to skip"); the click or box is
      SAM2's prompt. Shared with "Objects by brush or box" (E30).
- [x] **M** · Progress in the Applied bar and the browser's detail: what the
      look includes, the time estimate, stage labels, Cancel. Cards get a
      Smart badge; the browser a "Smart" shelf and a "Works now" toggle.
- [x] **M** · `smart-catalog.ts`: 15–25 smart looks (Moody Sky, Portrait
      Polish, Night City Clean, Golden Subject, Product Pop, Foliage Autumn,
      Teal Water…) and smart variants of movie looks; catalog tests cover
      targets, scopes and ranges.
      _Done: 22 looks, 15 working today (ranges, gradients, subject and
      background, DRUNet, deblur); the pick tool is `views/loupe/LookPick.tsx`._

### Pass 75 — Smart looks 4/4: user presets as instructions · 4 pts

After: Pass 74.

- [x] **M** · `source` on `BrushComponent` (a model's target, or SAM2's
      prompt and label), set where AI masks land; `toInstructions()` turns a
      photo's masks and denoise steps into instructions (hand-painted brushes
      dropped with a warning).
- [x] **M** · The Save Preset dialog lists the converted instructions and
      warnings; a `smart` column in `presets`; saved presets run through the
      same planner and runner.
      _Done: `BrushSource` on `BrushComponent` (set where a segment lands),
      `toInstructions` in `shared/looks/smart.ts`, db migration 11
      (`presets.smart`, read back through `readSmart`). Painted strokes,
      drawn outlines, heals, upscales and JPEG restores are listed as left
      out; a SAM2 object without a name too._

### Pass 76 — Looks leftovers · 3 pts

- [ ] **S** · A "Previewing: X" note on the loupe while a rail look is
      hovered.
- [ ] **M** · Retune the looks marked ≈ when E41–E44 land: replace
      `halationApprox`/`bloomApprox` with the engine's, add chroma grain and
      density, bump each changed look's `version`.
- [ ] **S** · Import and export a look as a file (`lookToFile`,
      `lookFromFile` exist; no UI yet). The marketplace itself (sharing,
      browsing others' looks) is a later epic.

---

## After engine 0.16 (2026-10-02)

What the 0.16 integration (branch `feat/engine-0.16`) left open.

- [ ] **S** · Owner: mirror SAM 2.1 to the model server
      (`node scripts/publish-models.mjs --only sam2-1-hiera-tiny --bucket pixl-models`):
      the roster gives it no public upstream, so until then its download fails.
- [ ] **S** · Owner: publish the regenerated lens catalogue (the fisheyes'
      `fisheye` data): `pnpm lens-profiles --publish-only --bucket pixl-models`.
- [ ] **M** · A Linear DNG export (`Encode::LinearDng`): the rendered frame,
      edits baked in, for another raw editor.
- [ ] **M** · Flat-field correction (`LensCorrection.flat_field`) from a
      flat shot the user picks.
- [ ] **M** · Make a model's or an object's mask again when the photo's
      lens correction changes (its prompt is kept now, `BrushSource.prompt`).
- [ ] **S** · Keep SAM embeddings on disk (16–30 MB each) if the encoder
      is slow on 4-core machines (about a second on 8 performance cores).
- [ ] **S** · Redo a RAW's pixel steps made on rawler's develop from their
      panel (today a note says to; `staleRawStep`).
- [ ] **S** · Snap to edges on a colour or luminance range (E13's other half).

## Waiting on the engine

Playroom work that starts once the engine request lands
([ENGINE-REQUESTS.md](ENGINE-REQUESTS.md)). Becomes a pass then.

- [ ] **S** · Drop `repairJpegExif` once JPEG EXIF is written correctly (E1).
      _Unblocked: 0.16.1 writes it once._
- [ ] **S** · HEIC export and HEIC gain-map export (E2).
- [x] **M** · Sharp 1:1 zoom and 1:1 tiles on straightened, Upright and
      lens-warped photos (E3).
      _Done 2026-10-02 (engine 0.16): the tile is asked for in fractions of the picture as shown
      and rendered framed (`render.ts` `region`, `framedSize`)._
- [ ] **S** · Enhance crop preview by `region` instead of a temp file (E4).
      _The engine side landed in 0.16 (a region through the enhance chain):
      Pass 42 can do it now._
- [ ] **S** · Drop the host's temp-and-rename around engine writes (E5).
- [ ] **S** · The scheduler waits for a cancel to finish (E6).
- [ ] **M** · Fast 1:1 pans from a cached or tiled source (E7).
- [x] **M** · Retire the 512 px gradient planes and their cache for native
      linear and radial shapes (E11).
      _Done 2026-10-02 (engine 0.16): native Linear/Radial gradients (`gradients.ts`
      `gradientShape`), and a bidirectional gradient tool; only a gradient
      an older version gave an edge still goes as a plane._
- [ ] **M** · Depth range mask (its picker entry is disabled) (E12).
      _0.16 has the `DepthRange` shape; it waits on a depth map: a depth
      model in the roster, or iPhone/ProRAW auxiliary depth images._
- [ ] **M** · Smoothed range masks and an edge-aware brush in the tools (E13).
      _Half done in 0.16: Snap to edges (the engine's refine) on brushes,
      lassos and AI masks. Left: offer it on a colour/luminance range._
- [x] **S** · Move mask shift/harden to the engine, if E14 lands.
      _Done 2026-10-02 (engine 0.16): a snapped AI mask's Shift edge is the refine's `contract`,
      resolution-free; the snap replaces the harden for new AI masks._
- [ ] **M** · Brush and AI mask planes (and gradients until E11) at the
      photo's resolution, or brush strokes sent as vectors (E36).
      _Eased in 0.16: gradients are shapes, and Snap to edges pulls a 1024 px
      plane onto the photo's edges at full size. Planes are still 1024 px._
- [ ] **M** · A live brush effect while painting, the adjustment itself under
      the brush and not only a tint (E37).
- [ ] **S** · The mask overlay from the render instead of a second
      `convert` (E38).
- [ ] **S** · An HDR photo's range masks overlaid from the engine's plane
      again, not the loupe's preview, once the plane can be had under a tone
      map (E39).
- [ ] **M** · The develop view of an HDR edit graded as its HDR export is,
      tone mapped after the grade (E40); compile it with `hdr` then.
- [ ] **S** · Highlight recovery on RAW, in the develop (E15).
- [ ] **S** · Raw-domain noise reduction controls (E16).
- [ ] **S** · Pixel steps' image caches as uncompressed TIFF overlays (E33).
- [ ] **S** · PQ/HLG proxies and the gain-map master as uncompressed TIFF (E34).
- [ ] **S** · Engine frames in crash reports: feed the binding's published
      debug symbols to `scripts/upload-symbols.mjs` (E35).
- [ ] **S** · ProRAW and DNG gain maps (E17).
- [x] **S** · Fisheye distortion from Lensfun profiles (E18).
      _Done 2026-10-02 (engine 0.16): Defish and Field in the Lens panel; the catalogue keeps a
      fisheye's polynomial under `fisheye` (publish it: owner task)._
- [ ] **M** · Native `ParametricCurve`, with a recipe migration that
      rescales the region sliders (E19).
- [x] **S** · HDR-aware LUT profiles replace the SDR-range fallback (E20).
      _Done 2026-10-02 (engine 0.16): a LUT profile on an HDR pipeline is `ScaleHeadroom`._
- [ ] **M** · Camera-matching DCP and Adobe `.xmp` profiles (E21).
- [ ] **M** · Gamut warning in soft proofing (E22).
- [ ] **XL** · Merge to HDR, panorama, HDR panorama, focus stacking (E23).
- [ ] **S** · AI denoise (SCUNet) and Enhance (FBCNN) on the accelerator
      (E26, E27).
- [ ] **M** · Select Sky in one click (E28). _Since 0.16 the Sky tool asks
      for a click on the sky and SAM 2.1 selects it (`SKY_BY_CLICK` in
      `shared/ai.ts`); turn the flag off when a sky model ships._
- [ ] **L** · AI Remove (generative remove) in the Heal tool (E29).
- [ ] **L** · Select People: face, skin, hair, eyes, lips, teeth, clothes
      (E30). _Since 2026-10-02 they are classes (`shared/concepts.ts`): the
      masks menu's People group asks for a click on each and SAM 2.1 keeps
      the answer of the class's size, the mask remembering its class. A
      finder that knows names (a parts model, SAM 3, a detector boxing for
      SAM) goes first in each class's `finders` and turns on in
      `AiCapabilities.finders`; then masks with a class can be made again by
      name, and smart looks' people parts stop waiting. Eyes, lips and teeth
      answer on close-ups only with SAM 2.1._
- [x] **L** · Objects by brush or box, on SAM2 (E30).
      _Done 2026-10-02 (engine 0.16): the Objects tool (Auto hover-and-click, Box, Brush; Shift/Alt
      parts), on its own engine host (`main/select/service.ts`)._
- [x] **M** · "Snap to edges" on a lasso: its polygon as SAM2's prompt (E30).
      _Done 2026-10-02 (engine 0.16): the lasso card's Snap to edges (refine) and Find object
      (the lasso as SAM's prompt)._
- [ ] **L** · Catalog: people (E30).
- [ ] **M** · Learned auto white balance beside the grey-pixel estimate (E31).
- [ ] **M** · An adaptive/learned auto tone (E31).
- [ ] **S** · DirectML on Windows (E32).
- [ ] **M** · Real halation, bloom, chroma grain and slide density in the
      looks marked ≈ (E41–E44; Pass 76).
- [ ] **M** · Smart looks' sky, people-part and object masks, NAFNet denoise:
      turn their gates on when the binding with E28, E30 and E45 lands
      (Passes 72–75 build against them now). _0.16 brought SAM 2.1 only: a
      look's objects are pointed at (no detector yet, E45) and its sky is
      clicked (`SKY_BY_CLICK`); people's parts (E30) and NAFNet denoise
      still wait._

## Owner tasks (not model passes)

- [x] **L** · **Code signing**: a Developer ID Application certificate and an
      App Store Connect API key (macOS); Azure Trusted Signing with identity
      validation (Windows). Steps and the secrets/variables to add in
      `.github/RELEASING.md`; `release.yml` signs with whatever exists.
      _Done 2026-10-01: all secrets and variables are set; macOS signing and
      notarization tested locally, Windows signing tested against Azure. The
      service principal's secret (`rbac`) expires 2028-10-01._
- [ ] **M** · **Legal pages**: fill in the [bracketed] parts of the licence
      agreement and privacy policy on pixlfoundation.com/legal/ (pixl-web
      `src/legal/`: legal entity, jurisdiction, address, refunds, what a
      finished trial does, crash-report retention); have a lawyer review both.
- [ ] **S** · **Licensing view**: before the first paid release. _Since
      engine 0.16 jpegxl-sys (GPL) and rawler (LGPL, static) are gone (E8,
      E9): RAW is LibRaw under the CDDL in a replaceable shared library, its
      source shipped beside it. Left: the EULA must allow modification and
      reverse engineering for debugging the LGPL-3.0 libraries (libheif,
      libde265; LGPL-3.0 §4), whose complete sources ship in the app._
- [ ] **S** · **Back up the entitlement roots**: `~/.pixl-secrets/entitlement-root-1.pem`
      and `entitlement-root-2.pem` (made 2026-10-01; their public halves are
      `ROOT_KEYS` in `src/shared/account.ts`). Keep a copy offline (a password
      manager, or an encrypted USB key) and never on a server. If both are
      lost, rotating the Worker's signing key takes a release with new roots.
- [x] **S** · **Sign the Worker's key set** when pixl-web generates its
      signing key (handoff (c)): `node scripts/entitlement-keys.mjs
      sign-keyset root-1 <kid>=<public>`, into the Worker's
      `ENTITLEMENT_KEYSET` secret (RELEASING.md "Licences").
      _Done 2026-10-01: the Worker sends a key set signed by root-1 holding
      `ent-2026-10`, verified from the app against production._
- [ ] **S** · **Lemon Squeezy store**: create it and the Playroom product
      (US$69.99, pay once; no licence keys needed, since access lives on the
      account), the webhook, and an API key for the Worker (discount codes,
      nightly checks). Hand over the store and product ids (pixl-web "Billing").
- [x] **S** · **Supabase project for PIXL accounts**: `pixl-core` (ref
      `lskosagqyekwklxyuczi`, "pixl" org on Pro, ca-central-1). Its OAuth 2.1
      server is on (consent at `/oauth/consent`) and it signs with ES256.
      Mail, CAPTCHA and URLs are set (pixl-web TODO). For now it uses
      Supabase's own domain, with no custom auth domain. The OAuth server is
      in beta at Supabase.
- [x] **S** · **Email sender for sign-in mail**: Resend, on
      pixlfoundation.com (2026-10-01).
- [x] **S** · **Updates bucket**: R2 bucket `pixl-updates` on
      updates.pixlfoundation.com, plus an R2 API token (S3 access key) as
      playroom repository secrets for release.yml (Pass 23).
      _Done 2026-10-01: the bucket and domain, and on the repository the
      secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` plus the variable
      `R2_ENDPOINT`, from the account's existing R2 key (the `.env`
      `CLOUDFLARE_ACCESS_KEY_ID`). Tested: write, read through
      updates.pixlfoundation.com, delete._
- [ ] **S** · **A narrower key for CI**: the R2 key in the repository's
      secrets is account-wide (it can also write `pixl-reports` and
      `pixl-models`). Make one with Object Read & Write on `pixl-updates`
      only (R2 → Manage API tokens), and swap it into `R2_ACCESS_KEY_ID` and
      `R2_SECRET_ACCESS_KEY`. The `r2-pixl-token` made 2026-10-01 can't be
      used: its permissions are on the pixlfoundation.com zone, so R2
      refuses it. Delete it.
- [x] **M** · **Beta and account decisions** (2026-10-01): sign in with an
      email code, Google or Apple; the beta is open to anyone; testers get 3
      devices, like a licence; the tester discount must be redeemed within 90
      days of 1.0; refunds follow each country's legal minimum (Lemon Squeezy,
      as merchant of record, applies it; the lawyer confirms the EULA's
      wording). The Supabase org is "pixl", on Pro, with a custom auth domain.
- [x] **S** · **Google and Apple sign-in** (2026-10-01): Google Cloud
      project `pixl-core`, web client `135859589278-siu6…`; Apple Services ID
      `com.pixlfoundation.signin.web` (App ID `com.pixlfoundation.signin`,
      key `37K7A3NV3J`). Both are on in Supabase. The credentials are in
      `~/.pixl-secrets/` and `~/.apple-signing/`.
- [ ] **S** · **Renew Apple's client secret before 2027-03-30**: run
      `node scripts/apple-client-secret.mts --apply` in pixl-web. It lasts
      six months; if it lapses, Apple sign-in stops.
- [ ] **M** · **Legal for accounts**: beta terms, and the privacy policy's
      account, hashed device id and entitlement checks, go to the lawyer
      with the other legal pages.
- [x] **S** · **What a lapsed licence locks**: exports only (2026-10-01).
      Trials: on the server, against the account and the device (Pass 26).
- [ ] **S** · **Update policy in writing**: 1.x updates included, major
      versions a discounted paid upgrade (the EULA draft says so).
- [x] **S** · **Where crash reports live**: R2 (2026-10-01).
- [ ] **S** · **Reports bucket and retention**: confirm 90 days for crash
      reports and a year for problem reports (the privacy policy has both in
      brackets), run pixl-web's `scripts/reports-bucket.sh` before deploying
      the Worker, and add the `CLOUDFLARE_SYMBOLS_TOKEN` and
      `CLOUDFLARE_ACCOUNT_ID` secrets to the playroom repository (Pass 24).
- [ ] **M** · **Tiers and credits**: what the cloud tiers include and cost
      (Pass 71).
- [ ] **S** · **Windows "Open with"**: `build/installer.nsh`
      (OpenWithProgids, never the default) has never been compiled or run;
      check it on a Windows machine (see `.github/RELEASING.md`).
- [ ] **S** · **Sample files** for Passes 47–49: a DNG carrying
      `OpcodeList3` (the local one from Adobe DNG Converter has none), and
      Sony, Fujifilm, OM and Panasonic RAWs with lens corrections in the maker
      notes.
- [ ] **S** · **Windows installer art**: the kit's sidebar (164×314) and
      banner (150×57) need rendering to BMP only if the installer becomes
      assisted (`oneClick: false`).
- [ ] **S** · **Behaviour calls** for Pass 11 (B&W mask colour; partial
      presets).

---

## Done

Kept for reference: what was built, and where.

### Looks catalog (Phase L, 2026-10-02)

- [x] The catalog (`src/shared/looks/`): a builder language for looks
      (`dsl.ts`), 284 looks in 17 collections, the original nine starters
      kept, search with typo tolerance (`search.ts`), slider ranges and
      brand-word checks (`ranges.ts`). Tests: `tests/looks.test.ts`.
- [x] My Looks in the rail (app setting `looks.mine`), the user's presets
      beside them; drag to reorder. Tests: `tests/looks-mine.test.ts`.
- [x] The Looks browser: shelves by family and camera brand, cards that
      render the open photo with each look on the background engine
      (`src/main/lookthumbs.ts`), detail and Add to My Looks.
- [x] Tuning: every look measured on reference photos; the S-curve step
      strengthened, `foliage()` (green with yellow, where leaves are), the
      faint and duplicate looks retuned.
- [x] Hover a look in the rail to see it (never saved); the Applied bar's
      Amount scales only what the look moved (`amount.ts`); another look
      swaps in the same history step (Alt stacks), through the history's
      amend (`HistoryTable.amendLast`).
- [x] The look file format (`schema.ts`, `LookFile`) and its tests
      (`tests/looks-schema.test.ts`); engine requests E41–E45.

### Closed in the 2026-10-01 re-plan

- [x] **Enhance in the published engine**: the 0.15.0 binding reports
      `hasEnhance()` true; Enhance runs on the engine's bundled ONNX Runtime.
- [x] Red-eye / pet-eye correction: done in Phase 6 (dragged ellipses).
- [x] Healing / clone / content-aware fill: done in Phase 6. Generative remove
      waits on E29; visualise spots is Pass 38.
- [x] Lens corrections (profiles, manual, defringe): Phases 4 and 12. File
      corrections are Passes 47–49; fisheye waits on E18.
- [x] Transform/Upright: Phase 5. Spots under a warp are Pass 39.
- [x] Re-check the engine hosts' libuv pools: the sweep found the pools (8
      interactive, 4 background) aren't the bottleneck; thread
      oversubscription is (Passes 15, 31).
- [x] `tests/indexer.test.ts` on Node 26: passes now (19/19, five runs); the
      underlying exifr FileHandle leak is Pass 9.

### Before a first release

- [x] **In-app updates**: electron-updater against the GitHub releases
      (`src/main/updater.ts`), Stable/Beta in Settings. macOS updates start
      working once the builds are signed.
- [x] **Settings** (⌘, / Ctrl+,): updates, crash reports, legal links
      (`src/renderer/src/views/Preferences.tsx`); Help menu with the legal pages.
- [x] **Opt-in crash reporting** (`src/main/crash.ts`): asked once at first
      launch. Minidumps and scrubbed JSON reports to
      `pixlfoundation.com/api/crash`.
- [x] **Third-party notices** (`pnpm notices` → `build/THIRD_PARTY_NOTICES.txt`,
      shipped and opened from Settings/Help, copied to
      pixlfoundation.com/legal/third-party/).
- [x] CI, release-please and the release builds (GitHub-hosted, per-arch) are
      set up as in space-pixl; unsigned until the signing secrets exist.

### Business: licensing and accounts

- [x] Licence keys, 3-device activation, a 14-day trial and a 30-day offline
      grace, against Lemon Squeezy's licence API (`src/shared/licence.ts`,
      `src/main/licence.ts`, Settings → Licence; tests in
      `tests/licence.test.ts`). **Not enforced**: `LICENCE_ENFORCED` is false,
      and the Licence section only shows in development or with
      `PLAYROOM_LICENCE_UI=1`.
- [x] Remembering the wheel's tool per photo (index setting
      `wheel.byPhoto`, `src/renderer/src/develop/wheelMemory.ts`; Crop is
      never restored). Keyboard focus in the glass popovers: focus moves in
      on open and back on close, menus take arrow keys, Home and End.

### Masks and local tools

- [x] Auto Mask off the main thread: it runs on the brush worker
      (`src/renderer/src/workers/brush.worker.ts`), on the GPU with a CPU
      fallback.
- [x] Mask presets (a mask's sliders and Amount, index setting
      `mask.presets`); renaming components; an overlay colour per mask.
- [x] Brush planes by reference: `src/main/planestore.ts` swaps PNGs for
      refs across IPC; the index keeps them in its `planes` table.
- [x] AI masks, Select Subject and Background: U²-Net(p) through the
      engine's `segment` (Phase 7); the job side (`main/ai/segment.ts`:
      stages, progress, cancel, the plane into the plane store) is built, and
      `PLAYROOM_FAKE_AI=1` runs it with a stand-in plane.

### Develop

- [x] Per-photo auto WB across a batch (`library.autoWb`,
      `src/main/autowb.ts`; Cmd/Ctrl+Shift+U, the Library's Auto WB, or
      "Auto per photo" in Sync), with history per photo and Undo.
- [x] White balances across kinds: saved WB presets and develop presets keep
      the engine's white (`src/shared/wbconvert.ts`) and convert between a
      RAW's absolute Kelvin and relative sliders.
- [x] Auto tone tuned: gentler and scene-aware (flat vs hot frames, low- and
      high-key targets; `src/shared/auto.ts`, `tests/auto.test.ts`).
- [x] Colour mixer "point colour": the HSL panel's Point tab, up to 8
      picked colours compiled to engine `Qualifier` ops.
- [x] Targeted adjustment tool (T): drag on the photo to move the HSL band
      or the curve under the pointer (`src/shared/tat.ts`).
- [x] Tone curve presets (built-in and saved, `src/shared/curves.ts`).
- [x] Output sharpening on export, after the resize, in the same engine
      pass (`output_sharpen`; Screen / Matte / Glossy × Low / Standard / High).
- [x] Cancellation of an in-flight render: a newer edit stops a settled
      render and what follows it, a newer 1:1 region the last one, Cancel
      the file being exported, and Enhance between model tiles (engine
      0.15's signal, checked between stages — a RAW decode still finishes).
- [x] The histogram comes from the render itself (`measure`, engine 0.15).
- [x] **Interactive edit history.** Every step can be hidden, shown or
      deleted from any position (`src/shared/history.ts`, the History pane);
      hiding or deleting a step that made a mask takes the steps that use it
      along, after asking; Undo hides the newest visible step and Redo shows
      it again.
- [x] Edit history stored as diffs: the index keeps a base recipe and a
      patch per step; older whole-recipe rows convert when first read.
- [x] `.pixl` projects: one photo's edits in one SQLite file (recipe, virtual
      copies, snapshots, history, mask planes, preview; embedding the
      original), documented in `docs/pixl-format.md`.

### Library and workflow

- [x] Catalog: a sources sidebar (folders, pinned folders, collections,
      keywords, duplicates); manual collections, smart collections with
      nested rules (`src/shared/smart.ts`) and sets, exported and imported as
      JSON; hierarchical keywords; search and filters by metadata; stacks
      (kept in the sidecar); exact and near duplicates (SHA-1, dHash).
- [x] Metadata editing: title, caption, copyright and keywords written to
      `.xmp` sidecars through ExifTool (`IMG.xmp` for a RAW, `IMG.jpg.xmp`
      otherwise; originals are never written), in the Library's Info drawer
      and Develop's Info pane; embedded into exports, with "copyright only"
      and "remove location".
- [x] **Open with Pixl Playroom**: `fileAssociations` on macOS
      (`LSHandlerRank: Alternate`), `open-file` and a second instance's argv
      (`src/main/open.ts`), surviving the display-scale relaunch; the photo
      opens in Develop.
- [x] Watermarks on export (Phase 11).

### Branding

The PIXL Brand Kit design canvas holds the source for all of this; the SVG
masters are in `build/brand/`.

- [x] Document icons from the kit's "Files Playroom opens" board, for RAW,
      DNG, JXL, HEIC, TIFF, JPEG, PNG, WebP and AVIF (`pnpm doc-icons` →
      `build/doc-icons/`), handed to `fileAssociations`.
- [x] Website: playroom.pixlfoundation.com, in the pixl-web repo (one
      Cloudflare Worker for every PIXL site); media rebuilt from here by
      `scripts/site-media.sh`, tool screenshots by `scripts/site-tools.mjs`.
      `site/` is only a redirect from the old GitHub Pages address. Downloads
      say "Soon" until the first release.

### Upgrade to pixl-engine 0.17.0 (branch `claude/dazzling-noether-nssfax`, 2026-10-04)

Roadmap: PixlRGB working space, `ColorPolicy::Master`, new required request
fields, AVIF `threads`/`tune`/`tiling`, `limits`, retired models, no HEIC
sink. Decisions: export wizard (stepped), Master on export only, MaskPins
removed (gradient/lasso/heal handles stay), export guards block and warn but
never auto-fix, an export preview, existing edits kept with an update notice
and a before/after on each project's first open.

- [x] Phase 0 — mirror types (`engine-types.ts`): `colour` + `dng_opcodes`
      on RAW develops (`Container`, both lists `Apply`), `planes: 'Frame'` on
      lateral CA / flat field (0.16.0's, valid for every source), tone-map
      `mode: 'PerChannel'` (0.16.0), `AnalyzeRequest` orientation/lens/limits,
      AVIF `threads`/`tune: 'Ssim'`/`tiling`, `PetEye.catchlights`, `Master`
      policy, PixlRGB spaces; `limits` (`READ_LIMITS`) on every request that
      reads a user's file; `Heic` sink gone (saved `heic` settings read as
      AVIF); U²-Net and FBCNN-with-QF retired (a saved `fbcnn-qf` reads as
      `fbcnn`); edited-photo thumbnails named by `ENGINE_RENDER_REV` so they
      are made again. `RAW_DEVELOP_REV` stays `l`: `Container` is 0.16.0's
      pixels, so pixel steps on RAWs stand (DNGs with ForwardMatrix tags move).
- [ ] The lockfile: `pnpm install` with a PAT that has `read:packages` (the
      container this was written in had none), to take 0.17.0 into
      `pnpm-lock.yaml`.
- [ ] Phase 1 — migration notice, per-project before/after on first open.
- [ ] Phase 2 — `Master` on export; HDR/gain-map branches rewritten.
- [ ] Phase 3 — export wizard, guards, preview, receipt, sliders, size W×H,
      Intent (i).
- [ ] Phase 4 — expanded scopes (histogram parade, hue chart, metrics).
- [ ] Phase 5 — masks: Objects button, crisp outline, MaskPins removed.
- [ ] RAW colour: `{ Pixl: { version: 1 } }` where `camera_colour.pixl_versions`
      holds it (46 bodies), named in saved recipes; start the temperature UI
      from `camera_colour.as_shot_white`. Moves pixels: needs a recipe/RAW rev.

#### ENGINE REQUEST: need u'v' and gamut coverage metrics

The expanded scope's CIE 1976 u'v' chart (the image's chromaticity cloud and
hull, before/after) and gamut coverage need them from `analyze`/`measure`,
which today return RGB/luma histograms and a hue histogram only:

- [ ] `ImageStats.chromaticity`: a 2-D histogram of CIE 1976 u'v' (say 256 ×
      256 over the visible range, plus the pixel count, the domain's white
      point and `Y` weighting), measured in the stats' domain (HDR in stops).
- [ ] `ImageStats.gamut_coverage`: the fraction of measured pixels inside
      sRGB, Display P3, Adobe RGB, Rec.2020 and PixlRGB, and the fraction
      outside the visible range (what the guard would pull back).
- [ ] The same for `ConvertRequest::measure` so before/after come from one
      render each. Until then the CIE tab is a shell, with no renderer-side
      approximation.

### Upgrade to pixl-engine 0.16.0 (branch `feat/engine-0.16`, 2026-10-02)

- [x] Phase 1 — at parity: engine and models 0.16.0; every `Lut` states
      `out_of_domain` (Clamp, ScaleHeadroom on HDR), `Distortion.scale`,
      `MaskComponent.refine`, `RawMode.resolution`; RAW caches named by the
      develop (`-l`), RAWs 0.15 could not read retried (migration 12), RAWs
      refused by name said plainly, pixel steps on rawler's develop marked;
      rawler and jpegxl-sys gone; the engine's THIRD-PARTY-NOTICES.txt
      embedded, after-pack checks the LGPL and LibRaw sources ship.
- [x] Phase 2 — native linear, radial and bidirectional gradients; Snap to
      edges (refine) on brushes, lassos and AI masks, on by default for new
      AI masks; Select Subject cancels through the engine's signal.
- [x] Phase 3 — SAM 2.1 on its own engine host (sessions, embeddings,
      decodes named by id in the host), a 'prompt' AI job on its own lane,
      smart looks pointing at objects, the sky by click (`SKY_BY_CLICK`).
- [x] Phase 4 — the Objects tool (Auto, Box, Brush; Shift/Alt parts), Sky
      by click, a lasso's Find object, and the Model needed popup.
- [x] Phase 5 — sharp 1:1 on framed photos (E3); half-size RAW proxies
      (`Cell`); fisheye defish (E18).
- [x] 0.16.1, a patch: a HEIF that libheif turns by `irot`/`imir` probes as
      orientation 1 (its tag is `exif_orientation`) and is written with the
      tag reset (`ConvertReport.exif_orientation_reset`); JPEG EXIF written
      once (E1). Found on the way: LibRaw turns a RAW's embedded preview
      upright (since 0.16.0), so an unedited RAW's thumbnail no longer turns
      it a second time.

### Upgrade to pixl-engine 0.15.0

- [x] Phase 1 — the port, no change in output: request shapes brought up to
      0.15 (`Framing.outside` with a straighten, `Vignette.style`,
      `Curves.refine_saturation`, HDR `limit: 'Clip'`, `AnalyzeRequest.hdr`
      as an `HdrSignal`, `gain_map: 'Base'` for iPhone HEIC and UltraHDR
      originals, HEIF `matrix` — BT.601 as libheif assumed, BT.2020 wide or
      HDR, Identity lossless); Screen, Overlay, Soft and Hard Light blend on
      the PQ signal in an HDR pipeline (0.14 refuses them above white);
      Enhance on the engine's bundled ONNX Runtime and the new `UpscalerRef`
      (fetch-ai fetches only the model now); the Engine tool left the wheel
      for View ▸ Engine Report… (Ctrl+Alt+E).
- [x] Phase 2 — cancel in-flight renders, 1:1 regions, exports and
      Enhance; the histogram, hue chart, "before" ghosts, auto tone and HDR
      histogram measured by the render itself (`measure`); one-pass
      `output_sharpen`; the eyedropper and Auto WB take the engine's own
      neutral white (`whiteBalanceFromPixel`).
- [x] Phase 3 — Refine Saturation under the RGB point curve; the vignette's
      paint-overlay style (HDR photos keep highlight priority: the engine
      refuses paint over white); Additive Colour — light in Colour grading
      and masks (linear sRGB, in the linear stage), a wash in Effects
      (Display P3 code values, before the grain) — with Neutralise and
      Match pickers that sample the shown picture in Display P3 and add
      onto what is there (`src/shared/addcolor.ts`).
- [x] Native `ParametricCurve`: not adopted (see E19 and "Waiting on the
      engine").
- [x] Phase 4 — the Lens tool (after Detail): lens profiles
      (`src/shared/lens.ts`: JSON, Lensfun's poly3/poly5/ptlens distortion,
      linear/poly3 TCA and `pa` vignetting, matched on the file's lens model,
      interpolated by focal length, vignetting at the nearest aperture;
      imported into `userData/lens-profiles/`, the resolved correction kept
      in the recipe), Remove CA measured on the original
      (`suggestLateralCa`, radial scale about the centre), manual
      distortion and vignetting (profile and manual vignetting multiply into
      one polynomial), defringe with a fringe picker. A warp crops its empty
      edges (`Outside::Crop`), keeping the frame's shape, so crops and masks
      stay fractions of it; 1:1 regions and the eyedropper are mapped into
      the corrected frame (`lensFrame`). Match in Additive Colour takes its
      target from a wheel or a hex too.
- [x] Phase 5 — Upright in Crop & Rotate (`src/shared/upright.ts`): Off /
      Auto (Full, else Vertical, else Level) / Level / Vertical / Full from
      `suggestUpright` on the large proxy, Guided from two to four lines
      (`uprightFromLines`, drawn on the frame before the warp), and the
      Transform sliders on top. The engine's homography is reproduced
      exactly, so masks, pins and pickers map through it, and the crop is
      fitted to the corrected picture as the engine would; the photo's
      centre is kept at the canvas centre (a re-aimed camera slides it). A
      suggestion that keeps under a quarter of the frame, or tilts past 40°,
      is refused and Auto tries the next. The crop tool shows the warp whole,
      its empty corners transparent (a PNG preview with alpha; mask planes
      wait while it is open).
- [x] Preview speed with lens corrections: a lens warp (distortion, CA,
      vignetting) cost ~1 s per settled 2.5K render and again for "before"
      and the mask renders (IMG_1750.CR2: 2.0 s). The correction is now
      baked once into lens-corrected proxies (`ensureLensedProxies`, per
      correction, beside the plain ones) and previews grade those; while a
      lens slider moves the draft corrects live, and a settled change bakes
      in the background. Same photo: 0.57–0.88 s settled, ~0.17 s drafts.
      Graded thumbnails render from the draft proxy. Engine 0.15 itself is
      as fast as 0.13 for the same work.
- [x] Phase 6 — the Heal tool (after Masks; Q): heal, clone and
      content-aware fill as round spots or painted strokes, Photoshop's way:
      a heal or clone starts with its source on the spot and is dragged to
      where it copies from (live), or Alt-click sets the source first and
      later spots keep the offset (aligned); outlines go once a spot is set
      (hover or H shows them); "Find a source automatically" asks
      `suggestHealSource`. Red eye and pet eye as dragged ellipses. Spots are
      stored in the base frame like masks (`src/shared/retouch.ts`), a source
      that would read outside the frame is pulled back inside, and spots are
      baked into the prepared proxies with the lens correction, so they cost
      nothing per render once placed. Not in Sync or presets by default.
- [x] Phase 7 — AI models on demand: the engine's roster
      (`@xuckless/pixl-models`), downloaded into `userData/models` from
      `models.pixlfoundation.com/<id>/<version>/<file>` (resumable, checked
      against the roster's SHA-256), listed in Settings → AI models with
      size, licence and training-data caveat; the provider test (engine
      `benchmark`) picks CoreML/DirectML or the CPU. Select Subject and
      Background run U²-Net(p) through the engine's `segment` on the
      lens-corrected proxy (CPU: faster than compiling for CoreML for one
      run). Enhance ×2 takes its model from the store; `fetch-ai`,
      `resources/ai` and the release step are gone; every model is credited
      in the notices from the roster.
  - [x] **Before release:** the models are mirrored in R2 (`pixl-models`,
        `models.pixlfoundation.com`), including NAFNet, the two FBCNNs and
        Real-ESRGAN general WDN, which have no public upstream.
        `PLAYROOM_MODELS_URL` points at another mirror (`file://` works) for
        development.
- [x] Phase 8 — AI denoise in Detail (a cached denoised master). Classic | AI
      in Noise reduction; SCUNet or DRUNet with strength; an AI job makes a
      denoised draft (the loupe switches at once) then a 16-bit master and
      proxies from it (`src/main/ai/denoise.ts`), kept per photo, model and
      strength (three sets per photo). Develop, the 1:1 region, thumbnails and
      export use it; the renderer (`lib/denoise.ts`) starts or restarts the
      job when the settings ask for something not made. SCUNet cannot load
      under CoreML (ONNX Runtime refuses a reshape) and falls back to the CPU.
- [x] Phase 9 — Enhance on the wheel (JPEG restore, deblur, upscale ×2/×4).
      `panels/enhance.tsx` replaces the dialog; `shared/enhance.ts` plans the
      chain (JpegReconstruct → FBCNN → NAFNet → Upscale), sizes and times it
      (per-step ms/MP, learned); `main/enhance.ts` runs it into
      `<stem>-Enhanced.tif`. A model the accelerator cannot load moves to the
      CPU alone (`ModelStore.withCpuFallback`, per model).
- [x] Phase 10 — HDR gain maps: read, grade and write. The grid's HDR badge
      (probe kind, kept per file version: migration 3); SDR | HDR for
      gain-map photos (recipe `gainMap`, a PQ master of the applied map,
      `hdrsource.ts`; switching reopens the session); the Headroom overlay
      (`Inspect::Headroom`); export mode SDR + gain map (`sdr` rendition +
      `encode.gain_map`) and a Clip / Roll-off limit with its knee.
      Fixed on the way: HDR grades flattened everything above white (the
      exposure shoulder and tone curves ending at 1), and HEIF/AVIF photos
      were turned twice (libheif applies `irot`; the EXIF tag is now ignored,
      and older sideways working copies are remade).
- [x] Phase 11 — export watermark. `shared/watermark.ts` places a PNG
      (anchor, inset and size as shares of the shorter edge, opacity, blend)
      in whole output pixels and hands the engine an `overlays` entry; the
      export dialog's Watermark section previews it on the first photo; it is
      kept in the last settings and in export presets. SDR files blend in
      sRGB, HDR ones (Keep, Expand, SDR + gain map) on the PQ signal.
- [x] Phase 12 — real lens profiles. Lensfun's database (1557 lenses, 1057
      cameras) converted by `scripts/lensfun-profiles.mjs` into
      `resources/lens-profiles` (bundled, works offline) and, with `--bucket`,
      uploaded to R2 (`lens-profiles/v1/`); `main/lensprofiles.ts` loads the
      newer of the bundled and the downloaded catalogue, checks the server at
      start and every 6 h, downloads only changed shards (SHA-256), swaps the
      set in whole and tells the renderer, which re-resolves photos on a
      profile. Matching (maker prefix and punctuation aside, focal range,
      mount, the calibration closest to the photo's crop) and resolving are
      in main; Lensfun's coefficients stay as calibrated, placed on each
      photo by the engine's `Focal` unit from the two crop factors (EXIF's
      35 mm focal, else the camera list) and aspects. Paste, sync and presets
      re-resolve each target at its own lens and focal length. Credit and
      CC BY-SA 3.0 text in the notices.
  - [x] **R2**: bucket `pixl-models` with `models.pixlfoundation.com`
        attached; the lens catalogue (version 9f8904d4) and the models are
        published there. See `.github/RELEASING.md`.

### Upgrade to pixl-engine 0.13.0

- [x] Pinned 0.13.0; `AnalyzeRequest.hdr`, `ImageStats.range_max` and
      `bindingVersion()` mirrored in `src/shared/engine-types.ts`.
- [x] Version guard: a `VersionMismatch` at load reaches the engine banner
      by name; `build/after-pack.mjs` fails a build whose platform package
      version differs from the base package's.
- [x] Qualifier blur: `smoothnessRadius` already clamps against the full
      frame, so region renders are unaffected; an oversize radius in an
      Advanced layer shows the engine's field in the render error.
- [x] HDR: auto white balance works on PQ/HLG photos (linear analysis with
      `hdr`; before, the fallback would have been refused by 0.13), and a
      settled render of an HDR photo carries an HDR histogram (the graded
      draft as an HDR export holds it, drawn in stops, reference white
      marked, headroom shaded; the HDR chip switches views).
- [x] Enhance on HDR: refused up front with a reason per photo; the dialog
      lists every failure.

### Engine gaps fixed upstream

- [x] Grading a single-channel source: fixed in engine 0.13.0 (grey
      sources are graded through a grey profile). Playroom has no grey
      export yet; check one when it gets one.
- [x] Qualifier blur edges inside a region: fixed in engine 0.13.0 (the
      key's blur is exact inside a region, at any thread count).
