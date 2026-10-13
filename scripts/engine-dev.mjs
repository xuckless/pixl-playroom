#!/usr/bin/env node
/**
 * Run Playroom against an engine development kit: an engine built from a
 * branch, and PIXL's own unreleased models, for a development run on this
 * computer. Not a release, and nothing here changes package.json or the
 * lockfile: the kit's files are laid over the installed packages, and
 * `--restore` takes them off again.
 *
 *   node scripts/engine-dev.mjs             install the kit            (pnpm engine:dev)
 *   node scripts/engine-dev.mjs --check     say what is installed; exit 1 unless it is the kit
 *   node scripts/engine-dev.mjs --restore   put the released files back
 *   node scripts/engine-dev.mjs --run […]   install, then the app's `dev` script with
 *                                           PLAYROOM_DEV_KIT set   (pnpm dev:kit -- photo.CR2)
 *
 * The kit is a folder: `--kit <dir>`, else `PLAYROOM_DEV_KIT`, else
 * `~/Public/pixl-weights`. The app checkout is the current directory, or
 * `--app <dir>`. `--no-load` skips loading the engine once after installing.
 *
 *   kit.json                      { schema: 1, made, engine: { commit, version, platforms },
 *                                   models: [{ id, version, files }], files: { path: { bytes, sha256 } } }
 *   pixl-models/                  @xuckless/pixl-models' files, its roster with the kit's models
 *   models/<id>/<version>/<file>  their weights (the app copies them in: main/ai/models.ts)
 *   engine/<platform>/            pixl-engine.<platform>.node and what it loads beside it
 *
 * How it works: `@xuckless/pixl-engine`'s loader tries a
 * `pixl-engine.<platform>.node` beside its own `index.js` before the
 * installed platform package, so the kit's addon is copied there (the
 * package refuses an addon of another version, so the kit's must be the
 * installed one's). The models package's roster, `index.js`, `index.d.ts`
 * and licences are replaced by the kit's. Only files kit.json lists are
 * installed (what else sits in the folder, a Mac's `.DS_Store` above all, is
 * passed over), and each is checked against kit.json's size and SHA-256
 * before anything is touched.
 *
 * pnpm hard-links a package's files from its store, so nothing is ever
 * written into an existing file: a released file is renamed to
 * `<name>.released` (the store's copy untouched), the kit's copied in as a
 * new file, and `.pixl-dev-kit.json` in the engine package records what was
 * put where.
 *
 * The kit's engine is not a self-contained release build: on a Mac it loads
 * Homebrew's `libheif` and `jpeg-xl`.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ME = 'engine-dev'
/** In the engine package: what was installed, from which kit. */
export const MARKER = '.pixl-dev-kit.json'
/** Beside a file the kit replaced: the released one. */
export const RELEASED = '.released'
/** What the kit replaces in the models package (and its `licences/`). */
const MODELS_FILES = ['roster.json', 'index.js', 'index.d.ts']

/** A kit that can't be used, or an install that can't be done: said, never a stack. */
export class KitError extends Error {}

/** This computer, as the kit names its engine folders. */
export const platformOf = (p = process) => `${p.platform}-${p.arch}`

/**
 * The script's own flags, then whatever follows for the app's `dev` script
 * (`rest`, kept as it came: a `--` included, so `pnpm dev:kit -- x` hands
 * on what `pnpm dev -- x` would).
 */
export function parseArgs(argv) {
  const out = { action: 'install', kit: null, app: null, load: true, help: false, rest: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--kit' || a === '--app') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new KitError(`${a} needs a folder`)
      out[a.slice(2)] = v
    } else if (a === '--restore' || a === '--check' || a === '--run') {
      if (out.action !== 'install') throw new KitError(`--${out.action} and ${a}: one at a time`)
      out.action = a.slice(2)
    } else if (a === '--no-load') out.load = false
    else if (a === '--help' || a === '-h') out.help = true
    else {
      out.rest = argv.slice(i)
      break
    }
  }
  if (out.rest.length && out.action !== 'run')
    throw new KitError(`unknown argument ${out.rest[0]} (see --help)`)
  return out
}

/** The kit's folder: `--kit`, else PLAYROOM_DEV_KIT, else ~/Public/pixl-weights. */
export function kitDirOf(kit, env = process.env, home = homedir()) {
  return resolve(kit ?? (env.PLAYROOM_DEV_KIT || join(home, 'Public', 'pixl-weights')))
}

/** kit.json, read and held to the layout this script knows. */
export function readKit(dir) {
  const file = join(dir, 'kit.json')
  if (!existsSync(file))
    throw new KitError(
      `no development kit at ${dir} (no kit.json): pass --kit <dir> or set PLAYROOM_DEV_KIT`
    )
  let kit
  try {
    kit = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new KitError(`${file} is not JSON (${err.message}); is the kit still being copied?`)
  }
  if (kit?.schema !== 1)
    throw new KitError(
      `${file} is schema ${JSON.stringify(kit?.schema)}; this script reads schema 1 (update Playroom or the kit)`
    )
  if (typeof kit.engine?.version !== 'string' || !kit.files || typeof kit.files !== 'object')
    throw new KitError(`${file} names no engine version or no files`)
  return kit
}

/**
 * The kit fits this checkout and this computer, or why not: its engine is
 * the installed package's version (the package refuses an addon of another),
 * and it holds an addon built for here.
 */
export function checkKit(kit, kitDir, { installedVersion, platform }) {
  if (kit.engine.version !== installedVersion)
    throw new KitError(
      `the kit's engine is ${kit.engine.version}, but @xuckless/pixl-engine ${installedVersion} is installed: ` +
        `the package would refuse its addon. Use a kit made for ${installedVersion}, or install ${kit.engine.version}`
    )
  const dir = join(kitDir, 'engine', platform)
  const listed = Object.keys(kit.files).some(
    (f) => f.startsWith(`engine/${platform}/`) && f.endsWith('.node')
  )
  if (!existsSync(dir) || !listed) {
    const has = kitPlatforms(kit, kitDir)
    throw new KitError(
      `this kit has no addon for ${platform} (it has ${has.length ? has.join(', ') : 'none yet'}): ` +
        `build the engine on this computer into ${dir} and make the kit again`
    )
  }
}

/** The platforms a kit holds an addon for: kit.json's, and the folders there. */
export function kitPlatforms(kit, kitDir) {
  const named = Array.isArray(kit.engine?.platforms) ? kit.engine.platforms : []
  let dirs = []
  try {
    dirs = readdirSync(join(kitDir, 'engine'), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    // No engine folder at all.
  }
  return [...new Set([...named, ...dirs])].sort()
}

/**
 * What an install copies, from kit.json's list (a stray `.DS_Store` in the
 * folder is not the kit's): every file of `engine/<platform>/` beside the
 * engine's `index.js`, and the models package's roster, `index.js`,
 * `index.d.ts` and licences over the installed ones.
 */
export function installPlan(kit, platform) {
  const plan = []
  const engine = `engine/${platform}/`
  for (const from of Object.keys(kit.files).sort()) {
    if (from.startsWith(engine)) plan.push({ from, pkg: 'engine', path: from.slice(engine.length) })
    else if (from.startsWith('pixl-models/')) {
      const path = from.slice('pixl-models/'.length)
      if (MODELS_FILES.includes(path) || path.startsWith('licences/'))
        plan.push({ from, pkg: 'models', path })
    }
  }
  for (const p of plan)
    if (p.path.split('/').some((s) => s === '..' || s === '') || p.path.startsWith('/'))
      throw new KitError(`kit.json lists a path this script will not write: ${p.from}`)
  for (const need of MODELS_FILES)
    if (!plan.some((p) => p.pkg === 'models' && p.path === need))
      throw new KitError(`kit.json lists no pixl-models/${need}`)
  return plan
}

/** The weights the kit's roster names, for the app to copy in (checked here, not copied). */
export function weightFiles(kit) {
  return Object.keys(kit.files)
    .filter((f) => f.startsWith('models/'))
    .sort()
}

export function sha256Of(file) {
  const h = createHash('sha256')
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.allocUnsafe(1 << 20)
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0; ) h.update(buf.subarray(0, n))
  } finally {
    closeSync(fd)
  }
  return h.digest('hex')
}

/** A kit's file is what kit.json says (size, then SHA-256), or why not. */
export function verifyFile(kit, kitDir, from) {
  const want = kit.files[from]
  const file = join(kitDir, from)
  const s = statSync(file, { throwIfNoEntry: false })
  if (!s?.isFile())
    throw new KitError(`the kit lacks ${from} (kit.json lists it): is it still being copied?`)
  if (s.size !== want.bytes)
    throw new KitError(
      `${from} is ${s.size} bytes, kit.json says ${want.bytes}: is it still being copied?`
    )
  const got = sha256Of(file)
  if (got !== want.sha256)
    throw new KitError(`${from} is not the file kit.json names (SHA-256 ${got.slice(0, 12)}…)`)
}

/** Where the two packages really are (pnpm links them into node_modules/.pnpm). */
export function installedPackages(appDir) {
  const require = createRequire(join(appDir, 'package.json'))
  const dirOf = (name) => {
    try {
      return dirname(realpathSync(require.resolve(`${name}/package.json`)))
    } catch {
      throw new KitError(`${name} is not installed in ${appDir}: run \`pnpm install\` first`)
    }
  }
  const engine = dirOf('@xuckless/pixl-engine')
  const models = dirOf('@xuckless/pixl-models')
  const version = JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8')).version
  return { engine, models, version }
}

export function readMarker(dirs) {
  try {
    return JSON.parse(readFileSync(join(dirs.engine, MARKER), 'utf8'))
  } catch {
    return null
  }
}

/** A new file, never a write into one that is there (it may be the store's, hard-linked). */
function writeNew(file, text) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, { flag: 'wx' })
  renameSync(tmp, file)
}

/**
 * What is installed now: the kit's files as the marker lists them, each
 * still the file that was copied (`changed` names the ones that are not: a
 * `pnpm install` since, most likely).
 */
export function status(dirs) {
  const marker = readMarker(dirs)
  if (!marker) return { installed: false, marker: null, changed: [] }
  const changed = marker.files
    .filter((f) => {
      const file = join(dirs[f.pkg], f.path)
      const s = statSync(file, { throwIfNoEntry: false })
      return !s?.isFile() || s.size !== f.bytes || sha256Of(file) !== f.sha256
    })
    .map((f) => `${f.pkg === 'engine' ? '@xuckless/pixl-engine' : '@xuckless/pixl-models'}/${f.path}`)
  return { installed: changed.length === 0, marker, changed }
}

/**
 * Lay the kit over the installed packages. Everything is checked first; then
 * each file is put in as a new one, and the marker says how it got there:
 *
 * - `replaced`: a released file stood there, now `<name>.released` beside it;
 * - `added`: nothing stood there (the addon), so restoring removes it;
 * - `same`: the released file already is the kit's, byte for byte, and is
 *   left alone (it is the store's own, hard-linked).
 *
 * A file an earlier kit put in is removed first, never written into, and the
 * copy must not find a file in its place.
 */
export function install(kit, kitDir, platform, dirs, say = () => undefined) {
  checkKit(kit, kitDir, { installedVersion: dirs.version, platform })
  const plan = installPlan(kit, platform)
  const weights = weightFiles(kit)
  for (const f of [...plan.map((p) => p.from), ...weights]) verifyFile(kit, kitDir, f)
  say(`the kit is whole: ${plan.length} files to install, ${weights.length} model files beside`)

  const was = readMarker(dirs)
  const files = []
  for (const p of plan) {
    const dest = join(dirs[p.pkg], p.path)
    const want = kit.files[p.from]
    const have = statSync(dest, { throwIfNoEntry: false })
    const kept = existsSync(dest + RELEASED)
    // How an earlier kit's install left this file, if one did.
    const before = was?.files.find((f) => f.pkg === p.pkg && f.path === p.path)?.state ?? null
    const entry = { pkg: p.pkg, path: p.path, from: p.from, bytes: want.bytes, sha256: want.sha256 }
    if (have?.isFile() && have.size === want.bytes && sha256Of(dest) === want.sha256) {
      // The kit's bytes already: an earlier install's copy, or the released file itself.
      files.push({ ...entry, state: kept ? 'replaced' : (before ?? 'same') })
      continue
    }
    let state
    if (!have) state = kept ? 'replaced' : 'added'
    else if (kept || before === 'added' || before === 'replaced') {
      // An earlier kit's copy: removed. The released file, if there was one, is kept already.
      rmSync(dest)
      state = kept || before === 'replaced' ? 'replaced' : 'added'
    } else {
      // The released file (untouched until now): kept beside, under its other name.
      renameSync(dest, dest + RELEASED)
      state = 'replaced'
    }
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(join(kitDir, p.from), dest, constants.COPYFILE_EXCL)
    files.push({ ...entry, state })
    say(`  ${state.padEnd(8)} ${p.pkg}: ${p.path}`)
  }
  // What an earlier kit put in and this one does not have: off again.
  for (const f of was?.files ?? [])
    if (!files.some((n) => n.pkg === f.pkg && n.path === f.path)) putBack(dirs, f, say)
  const marker = {
    $comment:
      'An engine development kit is installed over this package (pixl-playroom scripts/engine-dev.mjs); --restore removes it.',
    schema: 1,
    kit: kitDir,
    installed: new Date().toISOString(),
    made: kit.made ?? null,
    engine: { commit: kit.engine.commit ?? null, version: kit.engine.version, platform },
    models: (kit.models ?? []).map((m) => ({ id: m.id, version: m.version })),
    files
  }
  rmSync(join(dirs.engine, MARKER), { force: true })
  writeNew(join(dirs.engine, MARKER), JSON.stringify(marker, null, 2) + '\n')
  return marker
}

/**
 * One installed file off again: the released one renamed back over the kit's
 * copy, or the kit's own (`added`) removed. A `same` file was never touched.
 * False when a released file's kept copy is gone.
 */
function putBack(dirs, f, say) {
  const dest = join(dirs[f.pkg], f.path)
  if (existsSync(dest + RELEASED)) {
    rmSync(dest, { force: true })
    renameSync(dest + RELEASED, dest)
    say(`  released ${f.pkg}: ${f.path}`)
    return true
  }
  if (f.state === 'same') return true
  if (f.state === 'added') {
    rmSync(dest, { force: true })
    say(`  removed  ${f.pkg}: ${f.path}`)
    return true
  }
  say(`  LOST     ${f.pkg}: ${f.path} (its ${RELEASED} copy is gone)`)
  return false
}

/** The released files back, the kit's removed; false when one could not be put back. */
export function restore(dirs, say = () => undefined) {
  const marker = readMarker(dirs)
  if (!marker) return { restored: false, lost: [] }
  const lost = []
  for (const f of [...marker.files].reverse()) if (!putBack(dirs, f, say)) lost.push(f.path)
  rmSync(join(dirs.engine, MARKER), { force: true })
  return { restored: true, lost }
}

// ── The command ──────────────────────────────────────────────────────────────

const say = (text) => console.log(text.startsWith('  ') ? text : `${ME}: ${text}`)

const HELP = `Run Playroom against an engine development kit (README, "Running against a development kit").

  pnpm engine:dev               install the kit over the installed engine and models packages
  pnpm engine:dev --check       say what is installed; exit 1 unless it is the kit
  pnpm engine:dev --restore     put the released files back
  pnpm dev:kit [-- photo.CR2]   install, then \`pnpm dev\` with PLAYROOM_DEV_KIT set

  --kit <dir>   the kit (else PLAYROOM_DEV_KIT, else ~/Public/pixl-weights)
  --app <dir>   the Playroom checkout (else the current directory)
  --no-load     do not load the engine once after installing`

/** Load the engine once in plain Node (Electron shares its Node-API): a missing library is said here. */
function loadCheck(appDir) {
  const r = spawnSync(
    process.execPath,
    ['-e', "console.log(require('@xuckless/pixl-engine').engineVersion())"],
    { cwd: appDir, encoding: 'utf8' }
  )
  if (r.status === 0) return say(`the kit's engine loads: it reports ${r.stdout.trim()}`)
  console.error(`${ME}: the kit's engine did not load:\n${(r.stderr || r.stdout || '').trim()}`)
  console.error(
    `${ME}: it is not a self-contained build; on a Mac it needs Homebrew's libraries ` +
      '(`brew install libheif jpeg-xl`). `pnpm engine:dev --restore` puts the released engine back.'
  )
  process.exit(1)
}

/** The app's own `dev` script, by its package manager, with the kit named in the environment. */
function runDev(appDir, kitDir, rest) {
  const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  if (!pkg.scripts?.dev) throw new KitError(`${appDir}/package.json has no "dev" script`)
  // The package manager that started this (pnpm dev:kit), else pnpm from the PATH.
  const exec = process.env.npm_execpath
  const viaNode = exec && /\.[cm]?js$/.test(exec)
  const cmd = viaNode ? process.execPath : exec || 'pnpm'
  const args = [...(viaNode ? [exec] : []), 'run', 'dev', ...rest]
  say(`the app's dev script (${pkg.scripts.dev}) with PLAYROOM_DEV_KIT=${kitDir}`)
  const child = spawn(cmd, args, {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, PLAYROOM_DEV_KIT: kitDir },
    shell: process.platform === 'win32' && !viaNode
  })
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
  child.on('error', (err) => {
    console.error(`${ME}: could not start \`${cmd} run dev\`: ${err.message}`)
    process.exit(1)
  })
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
}

function main(argv) {
  const args = parseArgs(argv)
  if (args.help) return console.log(HELP)
  const appDir = resolve(args.app ?? process.cwd())
  if (!existsSync(join(appDir, 'package.json')))
    throw new KitError(`${appDir} is not a checkout (no package.json): run from Playroom, or --app`)
  const dirs = installedPackages(appDir)
  const platform = platformOf()

  if (args.action === 'check') {
    const s = status(dirs)
    say(`@xuckless/pixl-engine ${dirs.version} at ${dirs.engine}`)
    if (!s.marker) {
      say('the released engine and models are installed (no development kit)')
      process.exit(1)
    }
    const m = s.marker
    say(
      `a development kit is installed: engine ${m.engine.version} at commit ${m.engine.commit} ` +
        `(${m.engine.platform}), from ${m.kit}, ${m.installed}`
    )
    for (const model of m.models ?? []) say(`  model ${model.id} ${model.version}`)
    if (s.installed) return say(`all ${m.files.length} of its files are in place`)
    say(`but ${s.changed.length} of its files changed since (a pnpm install?): install it again`)
    for (const f of s.changed) say(`  changed ${f}`)
    process.exit(1)
  }

  if (args.action === 'restore') {
    const r = restore(dirs, say)
    if (!r.restored) return say('no development kit is installed: nothing to put back')
    if (r.lost.length) {
      console.error(
        `${ME}: ${r.lost.length} released files could not be put back: run \`pnpm install --force\``
      )
      process.exit(1)
    }
    return say('the released engine and models are back')
  }

  const kitDir = kitDirOf(args.kit)
  const kit = readKit(kitDir)
  say(`kit ${kitDir}: engine ${kit.engine.version} at commit ${kit.engine.commit}, made ${kit.made}`)
  const marker = install(kit, kitDir, platform, dirs, say)
  say(`installed for ${platform} (${marker.files.length} files); \`--restore\` takes it off`)
  if (args.load) loadCheck(appDir)
  if (args.action === 'run') runDev(appDir, kitDir, args.rest)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    if (!(err instanceof KitError)) throw err
    console.error(`${ME}: ${err.message}`)
    process.exit(1)
  }
}
