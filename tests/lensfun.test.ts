import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ShotLens } from '../src/shared/engine-types'
import {
  findCamera,
  lensCorrection,
  defaultLens,
  lensfunUnits,
  matchProfile,
  resolveProfile,
  shotCrop,
  validateProfile,
  type CameraEntry,
  type LensProfile
} from '../src/shared/lens'

// The catalogue the app ships (scripts/lensfun-profiles.mjs).
const DIR = join(import.meta.dirname, '..', 'resources', 'lens-profiles')
const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as {
  format: number
  version: string
  lenses: number
  shards: { file: string; sha256: string; lenses: number }[]
}
const lenses: LensProfile[] = []
const cameras: CameraEntry[] = []
for (const s of index.shards) {
  const shard = JSON.parse(readFileSync(join(DIR, s.file), 'utf8'))
  for (const l of shard.lenses) {
    const p = validateProfile(l, l.id)
    assert.notEqual(typeof p, 'string', `${l.id}: ${p}`)
    lenses.push(p as LensProfile)
  }
  cameras.push(...shard.cameras)
}

const shot = (make: string | null, model: string, focal: number, f = 5.6): ShotLens => ({
  make,
  model,
  focal_mm: focal,
  focal_35mm: null,
  f_number: f,
  focus_distance_m: null
})

test('the bundled catalogue is whole: every shard its index names, with its checksum', () => {
  assert.equal(index.format, 1)
  assert.ok(index.lenses > 1000)
  assert.equal(lenses.length, index.lenses)
  for (const s of index.shards) {
    const body = readFileSync(join(DIR, s.file))
    assert.equal(createHash('sha256').update(body).digest('hex'), s.sha256, s.file)
  }
  assert.equal(new Set(lenses.map((l) => l.id)).size, lenses.length)
})

test('on its own camera, a Lensfun profile’s r = 1 is half the shorter side, and the corner for vignetting', () => {
  const u = lensfunUnits({ crop: 1.6, aspect: 1.5 }, { crop: 1.6, width: 6000, height: 4000 })
  // Fractions of the longer side: 2000 / 6000, and 3606 / 6000.
  assert.ok(Math.abs(u.geometry - 1 / 3) < 1e-6)
  assert.ok(Math.abs(u.vignetting - Math.hypot(6000, 4000) / 2 / 6000) < 1e-6)
  // Portrait: the same lengths.
  const p = lensfunUnits({ crop: 1.6, aspect: 1.5 }, { crop: 1.6, width: 4000, height: 6000 })
  assert.deepEqual(p, u)
})

test('a smaller sensor sees less of the lens: r = 1 lies further out, by the crop ratio', () => {
  const full = lensfunUnits({ crop: 1, aspect: 1.5 }, { crop: 1, width: 6000, height: 4000 })
  const aps = lensfunUnits({ crop: 1, aspect: 1.5 }, { crop: 1.6, width: 6000, height: 4000 })
  assert.ok(Math.abs(aps.geometry / full.geometry - 1.6) < 1e-5)
  // A 4:3 profile on a 3:2 frame of the same diagonal: the same half shorter side in mm.
  const four = lensfunUnits({ crop: 2, aspect: 4 / 3 }, { crop: 2, width: 4000, height: 3000 })
  assert.ok(Math.abs(four.geometry - 1500 / 4000) < 1e-6)
})

test('a file’s lens name finds its Lensfun profile, maker prefix and punctuation aside', () => {
  const efs = matchProfile(shot('Canon', 'EF-S 18-55mm f/4-5.6 IS STM', 18), lenses)
  assert.equal(efs?.model, 'EF-S18-55mm f/4-5.6 IS STM')
  const yn = matchProfile(shot('Yongnuo', 'YN 50mm f/1.8', 50, 1.8), lenses)
  assert.equal(yn?.model, 'Yongnuo YN 50mm f/1.8')
  // A shot outside a lens's focal range is not that lens.
  assert.equal(matchProfile(shot('Canon', 'EF-S 18-55mm f/4-5.6 IS STM', 200), lenses), null)
  assert.equal(matchProfile(shot(null, '50mm', 50), lenses), null)
})

test('among calibrations of one lens, the one made on a sensor like the photo’s wins', () => {
  const lens = shot('Canon', 'EF50mm f/1.8 STM', 50, 1.8)
  const onCrop = matchProfile(lens, lenses, { crop: 1.613 })
  const onFull = matchProfile(lens, lenses, { crop: 1 })
  assert.equal(onCrop?.calibration?.crop, 1.613)
  assert.equal(onFull?.calibration?.crop, 1)
})

test('a camera’s crop factor: from EXIF when it gives a 35 mm focal, else the catalogue', () => {
  const cam = findCamera({ make: 'Canon', model: 'Canon EOS 250D' }, cameras)
  assert.equal(cam?.crop, 1.613)
  assert.equal(findCamera({ make: 'Canon', model: 'EOS 250D' }, cameras)?.crop, 1.613)
  assert.equal(findCamera({ make: 'Canon', model: 'Canon EOS 99999' }, cameras), null)
  assert.deepEqual(shotCrop({ ...shot('Canon', 'x', 20), focal_35mm: 32 }, cam), {
    value: 1.6,
    from: 'exif'
  })
  assert.deepEqual(shotCrop(shot('Canon', 'x', 20), cam), { value: 1.613, from: 'camera' })
  assert.equal(shotCrop(shot('Canon', 'x', 20), null), null)
})

test('a resolved Lensfun profile places its models on the photo, and the correction uses them', () => {
  const p = matchProfile(shot('Canon', 'EF-S 18-55mm f/4-5.6 IS STM', 24), lenses)!
  const r = resolveProfile(p, shot('Canon', 'x', 24), {
    crop: { value: 1.613, from: 'camera' },
    width: 6000,
    height: 4000
  })
  assert.ok(r.distortion)
  assert.deepEqual(r.crop, { value: 1.613, from: 'camera' })
  const g = (r.geometryUnit as { Focal: { x: number } }).Focal.x
  assert.ok(Math.abs(g - (1 / 3) * (1.613 / p.calibration!.crop)) < 1e-4)
  const l = defaultLens()
  l.profile = { enabled: true, id: null, resolved: r, distortion: 100, vignetting: 100 }
  const c = lensCorrection(l)!
  assert.deepEqual(c.distortion!.geometry.unit, r.geometryUnit)
  if (r.vignetting) assert.deepEqual(c.vignetting!.geometry.unit, r.vignettingUnit)
  else assert.equal(c.vignetting, null)
  // Without the photo's crop factor it is taken to be the calibration camera's.
  const assumed = resolveProfile(p, shot('Canon', 'x', 24), {
    crop: null,
    width: 6000,
    height: 4000
  })
  assert.equal(assumed.crop?.from, 'calibration')
})

test('a lens’s focal range comes from its name when the profile gives none', async () => {
  const { focalRange } = await import('../src/shared/lens')
  assert.deepEqual(focalRange({ model: 'EF-S18-55mm f/4-5.6 IS STM' }), [18, 55])
  assert.deepEqual(focalRange({ model: 'YN 50mm f/1.8' }), [50, 50])
  assert.deepEqual(focalRange({ model: 'Zoom 12 - 24 mm' }), [12, 24])
  assert.equal(focalRange({ model: 'Pancake' }), null)
  assert.deepEqual(focalRange({ model: 'X 18-55mm', focal: [17, 56] }), [17, 56])
})

test('vignetting takes the samples at the focus distance where Lensfun has several', () => {
  const p: LensProfile = {
    id: 'x',
    maker: 'X',
    model: 'X 50mm',
    unit: 'Lensfun',
    calibration: { crop: 1, aspect: 1.5 },
    vignetting: [
      { focal: 50, aperture: 2, distance: 0.5, k: [-0.5, 0, 0] },
      { focal: 50, aperture: 2, distance: 1000, k: [-0.2, 0, 0] }
    ]
  }
  const near = resolveProfile(p, { ...shot('X', 'X 50mm', 50, 2), focus_distance_m: 0.6 })
  const far = resolveProfile(p, { ...shot('X', 'X 50mm', 50, 2), focus_distance_m: 30 })
  const none = resolveProfile(p, shot('X', 'X 50mm', 50, 2))
  assert.deepEqual(near.vignetting, [-0.5, 0, 0])
  assert.deepEqual(far.vignetting, [-0.2, 0, 0])
  assert.deepEqual(none.vignetting, [-0.2, 0, 0])
})

test('a Lensfun profile without its calibration camera is refused', () => {
  const bad = validateProfile(
    {
      maker: 'X',
      model: 'Y',
      unit: 'Lensfun',
      distortion: [{ focal: 20, model: 'poly3', k: [0.01] }]
    },
    'y'
  )
  assert.match(bad as string, /calibration/)
})

test('a fisheye keeps its own polynomial apart from a rectilinear distortion', () => {
  const fish = lenses.filter((l) => (l as { fisheye?: unknown }).fisheye !== undefined)
  assert.ok(fish.length > 10, `${fish.length} fisheyes`)
  for (const l of fish) {
    // An app before 0.16 would apply `distortion` as a rectilinear lens's.
    assert.equal(l.distortion?.length ?? 0, 0, l.model)
    assert.ok(
      ['fisheye', 'equisolid', 'orthographic', 'stereographic', 'fisheye_thoby'].includes(l.type!),
      l.model
    )
  }
  // A rectilinear lens's samples carry nothing of a fisheye's.
  for (const l of lenses)
    for (const s of l.distortion ?? []) assert.equal('realFocal' in s, false, l.model)
})

test('the Samyang 8 mm defishes stereographically at its real focal length, in Lensfun units', () => {
  const raw = lenses.find((l) => l.model === 'Samyang 8mm f/2.8 UMC Fish-eye')!
  const p = validateProfile(raw, raw.id)
  assert.ok(typeof p !== 'string')
  if (typeof p === 'string') return
  const r = resolveProfile(
    p,
    {
      make: 'Samyang',
      model: p.model,
      focal_mm: 8,
      focal_35mm: 12,
      f_number: 4,
      focus_distance_m: null
    },
    { crop: { value: 1.534, from: 'camera' }, width: 6000, height: 4000 }
  )
  assert.equal(r.fisheye?.projection, 'Stereographic')
  // 8.405 mm × 1.534 × √(1.5² + 1) / 21.633 (half a full frame's diagonal).
  assert.ok(Math.abs(r.fisheye!.focal - 1.0744) < 1e-3, `${r.fisheye!.focal}`)
  assert.deepEqual(r.fisheye?.polynomial, { PtLens: { a: 0.02036, b: -0.08028, c: 0.01446 } })
  // Off, only its TCA and vignetting; on, the engine's Fisheye, Field as its scale.
  const l = defaultLens()
  l.profile = { ...l.profile, enabled: true, resolved: r }
  assert.equal(lensCorrection(l)?.distortion, null)
  l.profile.defish = true
  l.profile.field = 80
  const d = lensCorrection(l)!.distortion!
  assert.ok('Fisheye' in d.model)
  assert.equal(d.scale, 0.8)
  assert.equal(lensCorrection(l)!.outside, 'Crop')
})

test('a rectilinear correction keeps the scale it always had', () => {
  const l = defaultLens()
  l.distortion = 40
  assert.equal(lensCorrection(l)!.distortion!.scale, 1)
  // An old recipe without the new settings: off, the whole field.
  assert.equal(defaultLens().profile.defish, false)
  assert.equal(defaultLens().profile.field, 100)
})
