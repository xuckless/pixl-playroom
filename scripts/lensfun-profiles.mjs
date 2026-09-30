#!/usr/bin/env node
// Lens profiles from the Lensfun database (https://lensfun.github.io, data
// under CC BY-SA 3.0), as the app's catalogue: one JSON shard per Lensfun
// file and an index naming each shard's SHA-256, so the app downloads only
// what changed. The same layout is bundled (resources/lens-profiles, the
// offline catalogue) and served from the R2 bucket behind the models domain
// (<bucket>/lens-profiles/v1/…), which installed apps poll for updates
// (src/main/lensprofiles.ts).
//
//   node scripts/lensfun-profiles.mjs                          fetch Lensfun master, write resources/lens-profiles
//   node scripts/lensfun-profiles.mjs --lensfun ~/src/lensfun  from a checkout
//   node scripts/lensfun-profiles.mjs --ref <sha|tag>          a pinned Lensfun commit
//   node scripts/lensfun-profiles.mjs --out ./mirror/lens-profiles/v1 --bucket pixl-models
//                                                             …and upload to R2 (wrangler login or CLOUDFLARE_API_TOKEN)
//   node scripts/lensfun-profiles.mjs --publish-only --bucket pixl-models
//                                                             upload the catalogue as it is (the one the app
//                                                             bundles), checked against its index, unchanged
//
// What it keeps: every lens with a calibration, its names, mounts, focal
// range and the calibration camera's crop factor and aspect ratio (what the
// coefficients' r = 1 is measured on); distortion (ptlens, poly3, poly5) and
// TCA (linear, poly3) per focal length; vignetting (pa) per focal length,
// aperture and distance, with Lensfun's duplicated distances folded. Fisheye
// and other non-rectilinear lenses keep their TCA and vignetting only (their
// distortion assumes a projection change the engine does not make). Every
// camera with its crop factor, for photos whose EXIF gives no 35 mm focal.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const out = resolve(arg('out') ?? join(ROOT, 'resources', 'lens-profiles'))
const bucket = arg('bucket')
/** Where the catalogue sits in the bucket; the app's default URL names the same. */
const PREFIX = 'lens-profiles/v1'
const FORMAT = 1

/** Upload a catalogue to R2: shards first, the index last, so an app never sees an index naming a shard that is not there yet. */
function upload(shards) {
  const put = (file) =>
    execFileSync(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${bucket}/${PREFIX}/${file}`,
        '--file',
        join(out, file),
        '--content-type',
        'application/json',
        '--remote'
      ],
      { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, npm_config_yes: 'true' } }
    )
  for (const s of shards) {
    put(s.file)
    process.stdout.write('.')
  }
  put('index.json')
  console.log(`\nuploaded to ${bucket}/${PREFIX}/`)
}

// Publish what is built, as it is: the bundled catalogue and the online one
// then share a version, and installed apps download nothing.
if (process.argv.includes('--publish-only')) {
  if (!bucket) throw new Error('--publish-only needs --bucket <name>')
  const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'))
  for (const s of index.shards) {
    const sum = createHash('sha256')
      .update(readFileSync(join(out, s.file)))
      .digest('hex')
    if (sum !== s.sha256)
      throw new Error(`${s.file}: checksum differs from the index; rebuild first`)
  }
  console.log(`publishing ${index.lenses} lenses, version ${index.version}, from ${out}`)
  upload(index.shards)
  process.exit(0)
}

// ── Lensfun ──────────────────────────────────────────────────────────────────

let work = null
let lensfun = arg('lensfun') && resolve(arg('lensfun'))
if (!lensfun) {
  work = mkdtempSync(join(tmpdir(), 'lensfun-'))
  lensfun = join(work, 'lensfun')
  const ref = arg('ref')
  process.stdout.write(`fetching Lensfun${ref ? ` at ${ref}` : ''}… `)
  execFileSync('git', [
    'clone',
    '--quiet',
    '--depth',
    ref ? '50' : '1',
    'https://github.com/lensfun/lensfun.git',
    lensfun
  ])
  if (ref) execFileSync('git', ['-C', lensfun, 'checkout', '--quiet', ref])
  process.stdout.write('done\n')
}
const dbDir = join(lensfun, 'data', 'db')
if (!existsSync(dbDir)) throw new Error(`no Lensfun database at ${dbDir}`)
let commit = null
let committed = null
try {
  commit = execFileSync('git', ['-C', lensfun, 'rev-parse', 'HEAD']).toString().trim()
  committed = execFileSync('git', ['-C', lensfun, 'log', '-1', '--format=%cI']).toString().trim()
} catch {
  // a tarball: no history, the files' hash names the version
}

// ── A small reader for Lensfun's regular XML ─────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const decode = (s) =>
  s
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim()
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')
const blocks = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1])
/** Every `<tag attrs>text</tag>` (text elements only), with its attributes. */
const texts = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}(\\s[^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => ({
    attrs: attrsOf(m[1] ?? ''),
    text: decode(m[2])
  }))
const attrsOf = (s) =>
  Object.fromEntries([...s.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]))
/** Self-closing `<tag … />` elements' attributes. */
const empties = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}\\s([^>]*?)/>`, 'g'))].map((m) => attrsOf(m[1]))
const num = (v) => (v === undefined || v === '' ? undefined : Number(v))
const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d

/** "3:2" or "1.5" → 1.5 (Lensfun's default when a lens states none). */
function aspectOf(s) {
  if (!s) return 1.5
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s.trim())
  const v = m ? Number(m[1]) / Number(m[2]) : Number(s)
  return Number.isFinite(v) && v > 0 ? round(Math.max(v, 1 / v), 4) : 1.5
}

const slug = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// ── Convert ──────────────────────────────────────────────────────────────────

const ids = new Set()
const uniqueId = (base) => {
  let id = base
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
  ids.add(id)
  return id
}

function lensOf(body, file) {
  const makers = texts(body, 'maker')
  const models = texts(body, 'model')
  const maker = (makers.find((m) => !m.attrs.lang) ?? makers[0])?.text
  const model = (models.find((m) => !m.attrs.lang) ?? models[0])?.text
  if (!maker || !model) return null
  const cal = blocks(body, 'calibration').join('\n')
  if (!cal) return null
  const type = texts(body, 'type')[0]?.text ?? 'rectilinear'
  const rectilinear = type === 'rectilinear'
  const distortion = rectilinear
    ? empties(cal, 'distortion')
        .map((a) => {
          const focal = num(a.focal)
          if (!(focal > 0)) return null
          if (a.model === 'poly3') return { focal, model: 'poly3', k: [num(a.k1) ?? 0] }
          if (a.model === 'poly5')
            return { focal, model: 'poly5', k: [num(a.k1) ?? 0, num(a.k2) ?? 0] }
          if (a.model === 'ptlens')
            return { focal, model: 'ptlens', k: [num(a.a) ?? 0, num(a.b) ?? 0, num(a.c) ?? 0] }
          return null
        })
        .filter(Boolean)
    : []
  const tca = empties(cal, 'tca')
    .map((a) => {
      const focal = num(a.focal)
      if (!(focal > 0)) return null
      if (a.model === 'linear')
        return { focal, model: 'linear', red: [num(a.kr) ?? 1], blue: [num(a.kb) ?? 1] }
      if (a.model === 'poly3')
        return {
          focal,
          model: 'poly3',
          red: [num(a.vr) ?? 1, num(a.cr) ?? 0, num(a.br) ?? 0],
          blue: [num(a.vb) ?? 1, num(a.cb) ?? 0, num(a.bb) ?? 0]
        }
      return null
    })
    .filter(Boolean)
  // Lensfun repeats a sample at several distances with the same numbers:
  // fold those, keeping a distance only where it changes something.
  const seen = new Map()
  for (const a of empties(cal, 'vignetting')) {
    if (a.model !== 'pa') continue
    const focal = num(a.focal)
    const aperture = num(a.aperture)
    if (!(focal > 0) || !(aperture > 0)) continue
    const k = [num(a.k1) ?? 0, num(a.k2) ?? 0, num(a.k3) ?? 0]
    const key = `${focal}|${aperture}|${k.join(',')}`
    const distance = num(a.distance)
    const prev = seen.get(key)
    if (!prev) seen.set(key, { focal, aperture, distance, k })
    else if (distance !== undefined && (prev.distance === undefined || distance > prev.distance))
      prev.distance = distance
  }
  const byFocalAperture = new Map()
  for (const s of seen.values()) {
    const fa = `${s.focal}|${s.aperture}`
    byFocalAperture.set(fa, (byFocalAperture.get(fa) ?? 0) + 1)
  }
  const vignetting = [...seen.values()].map((s) =>
    // One sample per focal and aperture: the distance says nothing.
    byFocalAperture.get(`${s.focal}|${s.aperture}`) > 1 && s.distance !== undefined
      ? s
      : { focal: s.focal, aperture: s.aperture, k: s.k }
  )
  if (!distortion.length && !tca.length && !vignetting.length) return null
  const focalRange = empties(body, 'focal')[0]
  const apertureRange = empties(body, 'aperture')[0]
  const aliases = [...new Set(models.map((m) => m.text).filter((m) => m !== model))]
  const mounts = [...new Set(texts(body, 'mount').map((m) => m.text))]
  return {
    id: uniqueId(
      slug(`${model.toLowerCase().startsWith(maker.toLowerCase()) ? '' : maker + ' '}${model}`)
    ),
    maker,
    model,
    ...(aliases.length ? { aliases } : {}),
    ...(mounts.length ? { mount: mounts[0], mounts } : {}),
    ...(type !== 'rectilinear' ? { type } : {}),
    ...(focalRange
      ? { focal: [num(focalRange.min), num(focalRange.max ?? focalRange.min)].filter((v) => v > 0) }
      : {}),
    ...(apertureRange
      ? { aperture: [num(apertureRange.min), num(apertureRange.max)].filter((v) => v > 0) }
      : {}),
    source: `Lensfun (${file})`,
    unit: 'Lensfun',
    calibration: {
      crop: num(texts(body, 'cropfactor')[0]?.text) ?? 1,
      aspect: aspectOf(texts(body, 'aspect-ratio')[0]?.text)
    },
    ...(distortion.length ? { distortion } : {}),
    ...(tca.length ? { tca } : {}),
    ...(vignetting.length ? { vignetting } : {})
  }
}

function cameraOf(body) {
  const makers = texts(body, 'maker')
  const models = texts(body, 'model')
  const maker = (makers.find((m) => !m.attrs.lang) ?? makers[0])?.text
  const model = (models.find((m) => !m.attrs.lang) ?? models[0])?.text
  const crop = num(texts(body, 'cropfactor')[0]?.text)
  if (!maker || !model || !(crop > 0)) return null
  const aliases = [...new Set(models.map((m) => m.text).filter((m) => m !== model))]
  const variant = texts(body, 'variant')[0]?.text
  return {
    maker,
    model,
    ...(aliases.length ? { aliases } : {}),
    ...(variant ? { variant } : {}),
    mount: texts(body, 'mount')[0]?.text ?? null,
    crop
  }
}

function mountOf(body) {
  const name = texts(body, 'name')[0]?.text
  if (!name) return null
  const compat = texts(body, 'compat').map((c) => c.text)
  return compat.length ? { name, compat } : { name }
}

mkdirSync(out, { recursive: true })
for (const f of readdirSync(out)) if (f.endsWith('.json')) rmSync(join(out, f))
const files = readdirSync(dbDir)
  .filter((f) => f.endsWith('.xml'))
  .sort()
const shards = []
let lensCount = 0
let cameraCount = 0
for (const f of files) {
  const xml = stripComments(readFileSync(join(dbDir, f), 'utf8'))
  // A top-level <mount> has a <name>; a lens's or camera's is just text.
  const mounts = blocks(xml, 'mount')
    .filter((b) => b.includes('<name>'))
    .map(mountOf)
    .filter(Boolean)
  const lenses = blocks(xml, 'lens')
    .map((b) => lensOf(b, f))
    .filter(Boolean)
  const cameras = blocks(xml, 'camera').map(cameraOf).filter(Boolean)
  if (!lenses.length && !cameras.length && !mounts.length) continue
  const name = f.replace(/\.xml$/, '')
  const body = JSON.stringify({ lenses, cameras, mounts })
  const file = `${name}.json`
  writeFileSync(join(out, file), body)
  shards.push({
    name,
    file,
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: Buffer.byteLength(body),
    lenses: lenses.length,
    cameras: cameras.length
  })
  lensCount += lenses.length
  cameraCount += cameras.length
}

// The version is the data's own: the same shards always make the same one.
const version = createHash('sha256')
  .update(shards.map((s) => s.sha256).join(''))
  .digest('hex')
  .slice(0, 16)
const index = {
  format: FORMAT,
  version,
  generated: new Date().toISOString(),
  source: {
    name: 'Lensfun',
    url: 'https://lensfun.github.io',
    licence: 'CC BY-SA 3.0',
    ...(commit ? { commit, committed } : {})
  },
  lenses: lensCount,
  cameras: cameraCount,
  shards
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1))
const total = shards.reduce((s, x) => s + x.bytes, 0)
console.log(
  `${lensCount} lenses, ${cameraCount} cameras in ${shards.length} shards (${(total / 1e6).toFixed(1)} MB), version ${version} → ${out}`
)

// ── Upload ───────────────────────────────────────────────────────────────────

if (bucket) upload(shards)
if (work) rmSync(work, { recursive: true, force: true })
