// Writes build/THIRD_PARTY_NOTICES.txt: every third-party component Playroom
// ships, with its licence. electron-builder bundles it (extraResources) and the
// app opens it from Settings and Help.
//   node scripts/third-party-notices.mjs [--web <pixl-web dir>]
// Three sources:
//   - the native components npm can't see (build/third-party.json), with
//     licence texts from build/licenses/ and, when fetched, ONNX Runtime's own
//     notices (resources/ai/*/onnxruntime*/);
//   - the production npm packages (pnpm licenses), which ship in node_modules;
//   - the packages bundled into the app's JavaScript (out/*/bundled-packages.json,
//     written by electron.vite.config.ts), so run `electron-vite build` first.
// --web also copies the file into pixl-web, for the /legal/third-party/ pages
// on pixlfoundation.com and playroom.pixlfoundation.com.
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'build', 'THIRD_PARTY_NOTICES.txt')
const LICENSES = path.join(ROOT, 'build', 'licenses')
const RULE = '-'.repeat(78)
const own = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const webAt = process.argv.indexOf('--web')
const web = webAt > 0 ? path.resolve(process.argv[webAt + 1] ?? '') : null

/** The licence file a package ships, if any. */
function licenseText(dir) {
  let files
  try {
    files = fs.readdirSync(dir)
  } catch {
    return null
  }
  const f = files.find((n) => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(n))
  return f ? fs.readFileSync(path.join(dir, f), 'utf8').trim() : null
}

function spdxText(id) {
  const f = path.join(LICENSES, `${id}.txt`)
  if (!fs.existsSync(f)) throw new Error(`no licence text for ${id} in build/licenses/`)
  return fs.readFileSync(f, 'utf8').trim()
}

// ── npm: production dependencies and bundled packages ─────────────────────────
/** name@version → { name, version, license, text } */
const npm = new Map()
function addPackage(dir, fallbackLicense) {
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  } catch {
    return
  }
  if (!pkg.name || pkg.name.startsWith('@xuckless/')) return
  const key = `${pkg.name}@${pkg.version}`
  if (npm.has(key)) return
  const license =
    typeof pkg.license === 'string'
      ? pkg.license
      : (pkg.license?.type ?? fallbackLicense ?? 'UNKNOWN')
  npm.set(key, { name: pkg.name, version: pkg.version, license, text: licenseText(dir) })
}

const listed = JSON.parse(
  execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { cwd: ROOT, encoding: 'utf8' })
)
for (const [license, pkgs] of Object.entries(listed))
  for (const p of pkgs) for (const dir of p.paths ?? []) addPackage(dir, license)

// ExifTool itself comes in an optional, per-platform package pnpm doesn't
// list (electron-builder.yml unpacks whichever is installed).
const store = path.join(ROOT, 'node_modules', '.pnpm')
for (const d of fs.existsSync(store) ? fs.readdirSync(store) : []) {
  const m = /^(exiftool-vendored\.(?:pl|exe))@/.exec(d)
  if (m) addPackage(path.join(store, d, 'node_modules', m[1]))
}

let bundled = 0
for (const target of ['main', 'preload', 'renderer']) {
  const f = path.join(ROOT, 'out', target, 'bundled-packages.json')
  if (!fs.existsSync(f)) {
    console.warn(
      `third-party-notices: ${path.relative(ROOT, f)} missing; run electron-vite build first`
    )
    continue
  }
  for (const dir of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    addPackage(dir)
    bundled++
  }
}

// ── native components ─────────────────────────────────────────────────────────
const { components } = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'build', 'third-party.json'), 'utf8')
)
const ids = new Set()
/** ONNX Runtime's own LICENSE and ThirdPartyNotices.txt, from the first fetched runtime. */
function ortNotices() {
  const ai = path.join(ROOT, 'resources', 'ai')
  for (const target of fs.existsSync(ai) ? fs.readdirSync(ai).sort() : []) {
    const dir = path.join(ai, target)
    const ort = fs.readdirSync(dir).find((n) => n.toLowerCase().startsWith('onnxruntime'))
    if (!ort) continue
    const base = path.join(dir, ort)
    const texts = ['LICENSE', 'ThirdPartyNotices.txt']
      .map((n) => path.join(base, n))
      .filter((f) => fs.existsSync(f))
      .map((f) => fs.readFileSync(f, 'utf8').trim())
    if (texts.length) return texts.join(`\n\n${RULE}\n\n`)
  }
  return null
}

const out = []
const say = (...lines) => out.push(...lines)
say(
  'PIXL PLAYROOM: THIRD-PARTY NOTICES',
  '',
  `Pixl Playroom ${own.version} includes the third-party software listed below. Each`,
  'component is used under its own licence, reproduced here or in section 3. Pixl',
  'Playroom itself is proprietary software; these licences cover only the components',
  'they name.',
  '',
  'Components under the GNU LGPL are shipped as separate shared libraries inside the',
  'application, which you may replace with your own builds. Their source code is',
  'available from the addresses given; we will also provide it on request, for three',
  'years from when you received this copy, from hello@pixlfoundation.com.',
  '',
  '  1. Native components and the AI model',
  '  2. npm packages',
  '  3. Licence texts',
  '',
  RULE,
  '1. NATIVE COMPONENTS AND THE AI MODEL',
  RULE
)
for (const c of components) {
  const lic = [c.license].flat()
  lic.forEach((id) => ids.add(id))
  say(
    '',
    c.name,
    `  Used for:  ${c.use}`,
    `  Licence:   ${c.licenseName ?? lic.join(' and ')} (section 3)`,
    `  Source:    ${c.source}`,
    `  ${c.copyright}`
  )
  if (c.dynamic) say('  Shipped as a separate shared library, loaded at run time.')
  if (c.note) say(`  Note: ${c.note}`)
  if (c.ortNotices) {
    const t = ortNotices()
    if (t)
      say(
        '',
        t
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n')
      )
    else
      console.warn('third-party-notices: no ONNX Runtime found under resources/ai (pnpm fetch-ai)')
  }
}

say('', RULE, '2. NPM PACKAGES', RULE)
for (const p of [...npm.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  say('', `${p.name} ${p.version}`, `  Licence: ${p.license}`)
  if (p.text)
    say(
      '',
      p.text
        .split('\n')
        .map((l) => (l ? `    ${l}` : ''))
        .join('\n')
    )
  else if (
    /^[A-Za-z0-9.+-]+$/.test(p.license) &&
    fs.existsSync(path.join(LICENSES, `${p.license}.txt`))
  ) {
    ids.add(p.license)
    say('  (No licence file shipped; the licence text is in section 3.)')
  }
}

say('', RULE, '3. LICENCE TEXTS', RULE)
for (const id of [...ids].sort()) say('', `== ${id} ==`, '', spdxText(id))

const text = out.join('\n').replace(/[ \t]+$/gm, '') + '\n'
fs.writeFileSync(OUT, text)
console.log(
  `third-party-notices: ${path.relative(ROOT, OUT)}: ${components.length} native components, ${npm.size} npm packages (${bundled} bundled), ${ids.size} licence texts`
)
if (web) {
  // /shared/ is served on every host: playroom.… and pixlfoundation.com both link to it.
  const dest = path.join(web, 'public', 'shared', 'legal', 'playroom-third-party-notices.txt')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(OUT, dest)
  console.log(`third-party-notices: copied to ${dest}`)
}
