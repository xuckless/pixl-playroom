/**
 * Crash symbols for one packaged build: Breakpad `.sym` files for the native
 * code we ship that Electron doesn't (the engine binding and its libraries),
 * uploaded to the pixl-reports R2 bucket under `symbols/`, in the layout
 * `minidump-stackwalk --symbols-path` reads:
 *
 *   symbols/<debug file>/<debug id>/<debug file, .pdb → .sym>
 *
 * plus `symbols/releases/<version>/<platform>-<arch>.json`, naming the
 * Electron and engine versions and the modules uploaded. Electron's own
 * symbols are on https://symbols.electronjs.org and aren't copied.
 *
 *   node scripts/upload-symbols.mjs [--dry-run] [packaged dir]
 *
 * The packaged dir defaults to the one electron-builder left in dist/
 * (mac-arm64, mac, win-unpacked). Needs `dump_syms` on the PATH
 * (`cargo install dump_syms`), and for the upload CLOUDFLARE_API_TOKEN (R2
 * write) and CLOUDFLARE_ACCOUNT_ID. With --dry-run the files are written to
 * dist/symbols/ and nothing is uploaded. Run by the release workflow.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BUCKET = 'pixl-reports'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const given = args.find((a) => !a.startsWith('--'))

/** The packaged app's resources folder. */
function resourcesDir() {
  const dist = path.join(ROOT, 'dist')
  const dirs = given
    ? [path.resolve(given)]
    : ['mac-arm64', 'mac', 'win-unpacked'].map((d) => path.join(dist, d))
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const app = readdirSync(dir).find((f) => f.endsWith('.app'))
    const res = app ? path.join(dir, app, 'Contents', 'Resources') : path.join(dir, 'resources')
    if (existsSync(path.join(res, 'app.asar.unpacked'))) return res
  }
  throw new Error(
    `No packaged app found${given ? ` in ${given}` : ' under dist/'}: run electron-builder first.`
  )
}

/** Native files under `dir`. */
function nativeFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) nativeFiles(p, out)
    else if (/\.(node|dylib|dll)$/i.test(name)) out.push(p)
  }
  return out
}

/** `MODULE <os> <arch> <id> <debug file>`: the first line of a .sym. */
function moduleLine(sym) {
  const m = /^MODULE (\S+) (\S+) ([0-9A-F]+) (.+)$/m.exec(sym.slice(0, 512))
  if (!m) throw new Error('dump_syms gave no MODULE line')
  return { os: m[1], arch: m[2], id: m[3], file: m[4].trim() }
}

function upload(key, file, contentType) {
  if (dryRun) return
  execFileSync(
    'pnpm',
    [
      'dlx',
      'wrangler@4',
      'r2',
      'object',
      'put',
      `${BUCKET}/${key}`,
      '--file',
      file,
      '--content-type',
      contentType,
      '--remote'
    ],
    { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' }
  )
}

const res = resourcesDir()
const unpacked = path.join(res, 'app.asar.unpacked', 'node_modules', '@xuckless')
const files = nativeFiles(unpacked)
if (files.length === 0) throw new Error(`No native files under ${unpacked}`)
if (!dryRun && !process.env['CLOUDFLARE_API_TOKEN'])
  throw new Error('CLOUDFLARE_API_TOKEN is not set.')
try {
  execFileSync('dump_syms', ['--version'], { stdio: 'ignore' })
} catch {
  throw new Error('dump_syms is not on the PATH: cargo install dump_syms')
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const electron = JSON.parse(
  readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8')
).version
const out = path.join(ROOT, 'dist', 'symbols')
const modules = []
for (const file of files) {
  let sym
  try {
    sym = execFileSync('dump_syms', [file], { maxBuffer: 1 << 30 }).toString('utf8')
  } catch (err) {
    // A library built without debug information (or a DLL without its PDB) has little to give.
    console.warn(`::warning::no symbols for ${path.basename(file)}: ${err.message.split('\n')[0]}`)
    continue
  }
  const mod = moduleLine(sym)
  const name = mod.file.replace(/\.pdb$/i, '') + '.sym'
  const key = `symbols/${mod.file}/${mod.id}/${name}`
  const local = path.join(out, mod.file, mod.id, name)
  mkdirSync(path.dirname(local), { recursive: true })
  writeFileSync(local, sym)
  upload(key, local, 'text/plain')
  modules.push({ file: mod.file, id: mod.id, os: mod.os, arch: mod.arch, key })
  console.log(`${dryRun ? 'wrote' : 'uploaded'} ${key}`)
}

const engine = JSON.parse(
  readFileSync(path.join(unpacked, 'pixl-engine', 'package.json'), 'utf8')
).version
// The job packages only its own arch (electron-builder.yml, build/after-pack.mjs).
const platform = process.platform
const arch = process.arch
const manifest = { version: pkg.version, electron, engine, platform, arch, modules }
const manifestKey = `symbols/releases/${pkg.version}/${platform}-${arch}.json`
const manifestFile = path.join(out, 'releases', pkg.version, `${platform}-${arch}.json`)
mkdirSync(path.dirname(manifestFile), { recursive: true })
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
upload(manifestKey, manifestFile, 'application/json')
console.log(`${dryRun ? 'wrote' : 'uploaded'} ${manifestKey} (${modules.length} modules)`)
