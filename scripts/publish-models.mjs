#!/usr/bin/env node
// Mirror the engine's AI models to the R2 bucket behind models.pixlfoundation.com,
// where the app downloads them from (src/main/ai/models.ts):
//   <bucket>/<id>/<version>/<file>
//
// Each shipped model in the roster (@xuckless/pixl-models) is fetched as its
// published package (@xuckless/pixl-model-<id>, GitHub Packages, with your
// token), every file checked against the roster's SHA-256 and size, then
// uploaded with wrangler. Run once per engine release that changes a model.
//
//   node scripts/publish-models.mjs --bucket pixl-models            fetch, check, upload
//   node scripts/publish-models.mjs --out ./models-mirror --dry-run fetch and check only
//   node scripts/publish-models.mjs --only u2netp,real-esrgan-x2plus --bucket pixl-models
//
// Needs: the GitHub Packages token pnpm uses (pnpm config get
// //npm.pkg.github.com/:_authToken, or NODE_AUTH_TOKEN), and for uploads
// `wrangler login` (or CLOUDFLARE_API_TOKEN) with access to the bucket.
// `--out` keeps the files in the bucket's layout, which also serves as a
// local mirror for development: PLAYROOM_MODELS_URL=file:///…/models-mirror.
//
// The on-demand models (`onDemand()`: BiRefNet lite, EfficientSAM3, SAM 3)
// have no package: each file the app doesn't fetch from its `hosted` copy
// (Hugging Face at a pinned commit) is fetched from its pinned upstream
// `url`, checked the same way, and mirrored. SAM 3 is held out of the app
// (shared/ai.ts SAM3_PHRASE) and is mirrored only when named in --only.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const has = (name) => process.argv.includes(`--${name}`)

const bucket = arg('bucket')
const out = arg('out') ? resolve(arg('out')) : null
const dry = has('dry-run')
const only = arg('only')?.split(',')

// `--check`: is every file the app offers served by the live mirror (or its
// Hugging Face copy), at the size the roster pins? Nothing is fetched whole.
//   node scripts/publish-models.mjs --check
if (has('check')) {
  const BASE = (process.env.PLAYROOM_MODELS_URL ?? 'https://models.pixlfoundation.com').replace(
    /\/+$/,
    ''
  )
  const mod = await import(
    pathToFileURL(join(ROOT, 'node_modules', '@xuckless', 'pixl-models', 'index.js')).href
  ).then((x) => x.default ?? x)
  const HELD_IN_APP = new Set(['sam3', 'nafnet-sidd-w32'])
  const list = [...mod.manifest().filter((m) => m.ship), ...mod.onDemand()].filter((m) =>
    only ? only.includes(m.id) : !HELD_IN_APP.has(m.id)
  )
  let missing = 0
  for (const m of list)
    for (const f of m.files) {
      const url = f.hosted ?? `${BASE}/${m.id}/${m.version}/${f.name}`
      let status
      let len = 0
      try {
        const r = await fetch(url, { method: 'HEAD', redirect: 'follow' })
        status = r.status
        len = Number(r.headers.get('content-length') ?? 0)
      } catch (err) {
        status = err.message
      }
      const ok = status === 200 && (!len || len === f.bytes)
      if (!ok) missing++
      console.log(
        `${ok ? 'ok     ' : 'MISSING'} ${m.id}/${m.version}/${f.name}${f.hosted ? ' (Hugging Face)' : ''}${ok ? '' : ` → ${status}${len && len !== f.bytes ? `, ${len} bytes not ${f.bytes}` : ''}`}`
      )
    }
  console.log(missing ? `${missing} file(s) not served` : 'every file the app offers is served')
  process.exit(missing ? 1 : 0)
}

if (!bucket && !dry) {
  console.error('publish-models: name the R2 bucket (--bucket <name>), or pass --dry-run')
  process.exit(1)
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const token =
  process.env.NODE_AUTH_TOKEN ||
  execFileSync(pnpm, ['config', 'get', '//npm.pkg.github.com/:_authToken'], { cwd: ROOT })
    .toString()
    .trim()
if (!token || token === 'undefined') {
  console.error('publish-models: no GitHub Packages token (pnpm config or NODE_AUTH_TOKEN)')
  process.exit(1)
}

const roster = JSON.parse(
  readFileSync(join(ROOT, 'node_modules', '@xuckless', 'pixl-models', 'roster.json'), 'utf8')
)
const models = roster.models.filter((m) => m.ship && (!only || only.includes(m.id)))
const HELD = new Set(['sam3'])
const { onDemand } = await import(
  pathToFileURL(join(ROOT, 'node_modules', '@xuckless', 'pixl-models', 'index.js')).href
).then((mod) => mod.default ?? mod)
const onDemandModels = onDemand().filter((m) => (only ? only.includes(m.id) : !HELD.has(m.id)))
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** A checked file into the mirror folder and the bucket, at `<id>/<version>/<name>`. */
function place(m, f, file) {
  const key = `${m.id}/${m.version}/${f.name}`
  if (out) {
    mkdirSync(join(out, m.id, m.version), { recursive: true })
    copyFileSync(file, join(out, key))
  }
  if (!dry)
    execFileSync(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${bucket}/${key}`,
        '--file',
        file,
        '--content-type',
        'application/octet-stream',
        '--remote'
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] }
    )
  process.stdout.write(
    `${f.name} (${(f.bytes / 1e6).toFixed(1)} MB) ${dry ? 'checked' : 'uploaded'}  `
  )
}

const work = mkdtempSync(join(tmpdir(), 'pixl-models-'))
try {
  for (const m of models) {
    const pkg = `@xuckless/pixl-model-${m.id}@${m.version}`
    process.stdout.write(`${m.id} ${m.version}: `)
    const tarball = execFileSync(pnpm, ['view', pkg, 'dist.tarball'], { cwd: ROOT })
      .toString()
      .trim()
    const res = await fetch(tarball, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`${pkg}: HTTP ${res.status}`)
    const tgz = join(work, `${m.id}.tgz`)
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()))
    const dir = join(work, m.id)
    mkdirSync(dir)
    execFileSync('tar', ['-xzf', tgz, '-C', dir])
    for (const f of m.files) {
      const file = join(dir, 'package', f.name)
      if (!existsSync(file)) throw new Error(`${pkg} has no ${f.name}`)
      if (statSync(file).size !== f.bytes)
        throw new Error(`${f.name}: size differs from the roster`)
      if (sha256(file) !== f.sha256) throw new Error(`${f.name}: checksum differs from the roster`)
      place(m, f, file)
    }
    process.stdout.write('\n')
  }
  // The on-demand models: their own upstream files, pinned and checked.
  for (const m of onDemandModels) {
    process.stdout.write(`${m.id} ${m.version} (on demand): `)
    for (const f of m.files) {
      if (f.hosted) {
        process.stdout.write(`${f.name} on Hugging Face  `)
        continue
      }
      const res = await fetch(f.url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`)
      const file = join(work, `${m.id}-${f.name}`)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      if (statSync(file).size !== f.bytes)
        throw new Error(`${f.name}: size differs from the roster`)
      if (sha256(file) !== f.sha256) throw new Error(`${f.name}: checksum differs from the roster`)
      place(m, f, file)
    }
    process.stdout.write('\n')
  }
  const n = models.length + onDemandModels.length
  console.log(
    `${n} model${n === 1 ? '' : 's'} ${dry ? 'checked' : `in ${bucket}`}${out ? `, mirrored in ${out}` : ''}`
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
