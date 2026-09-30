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
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

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
    process.stdout.write('\n')
  }
  console.log(
    `${models.length} model${models.length === 1 ? '' : 's'} ${dry ? 'checked' : `in ${bucket}`}${out ? `, mirrored in ${out}` : ''}`
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
