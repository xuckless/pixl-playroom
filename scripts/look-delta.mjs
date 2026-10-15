#!/usr/bin/env node
/**
 * How far each built-in look moved: every look as a git ref had it against
 * the working tree's, both rendered on one RAW by the installed engine, the
 * mean ΔE (CIELAB, sRGB out) per look. For retuning the catalog when the
 * colour tools or the engine change (TODO.md Pass 121).
 *
 *   RAW=/path/to/photo.CR2 node scripts/look-delta.mjs [--ref HEAD~1] [--only regex] [--top 25]
 *   RAW=/path/to/photo.CR2 node scripts/look-delta.mjs --maths [--only regex] [--top 25]
 *
 * The ref's look files are copied into `tests/.look-delta/` (their imports
 * pointed at today's `src/`, their DSL the ref's own) and a throwaway test
 * renders both; the folder is removed afterwards. Nothing of the photo is
 * written into the repository.
 *
 * `--maths`: the same looks (the working tree's), every one, compiled with
 * engine 0.20's colour maths (`colourForm: 'v0'`, shared/colourv0.ts) and
 * with today's, for a change in the compile rather than in the looks.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const ref = arg('ref', 'HEAD')
const maths = process.argv.includes('--maths')
if (!process.env.RAW) {
  console.error('Set RAW to a RAW photo to render the looks on.')
  process.exit(2)
}

const dir = 'tests/.look-delta'
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' })
const files = maths
  ? []
  : git('ls-tree', '--name-only', ref, 'src/shared/looks/')
      .split('\n')
      .filter((f) => f.endsWith('.ts'))
const KEEP = new Set(['dsl.ts']) // the ref's own words; everything else is today's
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
for (const f of files) {
  const name = f.split('/').pop()
  const text = git('show', `${ref}:${f}`)
    .replace(/from '\.\.\//g, "from '../../src/shared/")
    .replace(/from '\.\/([a-z-]+)'/g, (m, mod) =>
      KEEP.has(`${mod}.ts`) || mod === 'catalog' || isCollection(mod)
        ? m
        : `from '../../src/shared/looks/${mod}'`
    )
  writeFileSync(join(dir, name), text)
}
function isCollection(mod) {
  return (
    !['collections', 'smart', 'types', 'apply', 'schema', 'ranges', 'search', 'amount'].includes(
      mod
    ) && files.some((f) => f.endsWith(`/${mod}.ts`))
  )
}

const out = mkdtempSync(join(tmpdir(), 'look-delta-'))
writeFileSync(
  join(dir, 'delta.test.ts'),
  `import { test } from 'node:test'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { compile } from '../../src/shared/compile'
import { defaultRecipe } from '../../src/shared/recipe'
import { applyLook } from '../../src/shared/looks/apply'
import { LOOKS } from '../../src/shared/looks/catalog'
${maths ? 'const OLD = LOOKS' : "import { LOOKS as OLD } from './catalog'"}

const lab = (r: number, g: number, b: number): number[] => {
  const l = (v: number): number => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const [R, G, B] = [l(r), l(g), l(b)]
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}

test('look delta', async () => {
  const engine = createRequire(import.meta.url)('@xuckless/pixl-engine')
  const { blankRequest, rawProxyMaster } = await import('../../src/main/source')
  const raw = process.env.RAW!
  const info = await engine.probe(raw)
  const proxy = join(${JSON.stringify(out)}, 'proxy.tiff')
  await engine.convert({ ...blankRequest(raw, proxy, 'Raw'), raw: rawProxyMaster('pixl:1'), resize: { Scale: { factor: 0.12 } }, resampler: 'Lanczos3', linear_resample: true, pixel: { depth: 'F32', channels: 3 }, encode: { Tiff: { compression: 'None' } }, metadata: { exif: false, icc: true, xmp: false, iptc: false }, color: 'Preserve', threads: 6 })
  const asShot = info.camera_colour.as_shot_white
  const ctx = { wb: { isRaw: true, asShot } as never, lensResolved: 'keep' as const }
  const render = async (look: (typeof LOOKS)[number], before = false): Promise<Buffer> => {
    const r = applyLook(defaultRecipe(true), { ...look, smart: undefined }, ctx)
    const c = compile(r, { isRaw: true, asShot, sourceOrientation: 'Normal', frameWidth: info.width, frameHeight: info.height, scale: 0.12, seed: 1, brushPaths: {}, applyCrop: false, ...(before ? { colourForm: 'v0' } : {}) } as never)
    const o = await engine.convert({ ...blankRequest(proxy, '', 'Tiff'), sink: 'Bytes', pixel: { depth: 'Eight', channels: 3 }, encode: { Pixels: { sample: 'U8' } }, metadata: { exif: false, icc: true, xmp: false, iptc: false }, color: { ConvertTo: { to: 'Srgb', intent: 'RelativeColorimetric', black_point_compensation: false } }, grade: c.grade, framing: null, threads: 6 })
    return o.output as Buffer
  }
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null
  const rows: [number, string][] = []
  for (const a of OLD) {
    const b = LOOKS.find((l) => l.id === a.id)
    if (!b || (only && !only.test(a.id))) continue
    if (!${maths} && JSON.stringify(a.recipe) === JSON.stringify(b.recipe)) continue
    const x = await render(a, ${maths})
    const y = await render(b)
    let de = 0
    let n = 0
    for (let i = 0; i < x.length; i += 21) {
      const p = lab(x[i], x[i + 1], x[i + 2])
      const q = lab(y[i], y[i + 1], y[i + 2])
      de += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
      n++
    }
    rows.push([de / n, b.meta.collection + ' ' + b.id.slice(8)])
  }
  rows.sort((p, q) => q[0] - p[0])
  const mean = rows.reduce((s, r) => s + r[0], 0) / Math.max(1, rows.length)
  console.log('changed ' + rows.length + ', mean ΔE ' + mean.toFixed(2) + ', above 3: ' + rows.filter((r) => r[0] > 3).length)
  for (const [d, name] of rows.slice(0, Number(process.env.TOP))) console.log(d.toFixed(1).padStart(6) + '  ' + name)
})
`
)
const run = spawnSync(
  process.execPath,
  [
    '--import',
    './tests/register.mjs',
    '--experimental-strip-types',
    '--no-warnings',
    '--test',
    '--test-reporter=spec',
    join(dir, 'delta.test.ts')
  ],
  {
    env: { ...process.env, ONLY: arg('only', ''), TOP: arg('top', '25') },
    encoding: 'utf8'
  }
)
process.stdout.write(
  (run.stdout + run.stderr)
    .split('\n')
    .filter((l) => !/^(ℹ|✔|▶)/.test(l))
    .join('\n')
)
rmSync(dir, { recursive: true, force: true })
rmSync(out, { recursive: true, force: true })
process.exit(run.status ?? 1)
