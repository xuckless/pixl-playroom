import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, isP3Floor, type CompileContext } from '../src/shared/compile'
import type { ShotLens } from '../src/shared/engine-types'
import {
  defaultLens,
  defringeOp,
  describeLens,
  lensCorrection,
  matchProfile,
  resolveProfile,
  validateProfile,
  type LensProfile
} from '../src/shared/lens'
import { defaultRecipe } from '../src/shared/recipe'

const shot = (model: string, focal: number, f: number): ShotLens => ({
  make: 'Canon',
  model,
  focal_mm: focal,
  focal_35mm: null,
  f_number: f,
  focus_distance_m: null
})

const RAW_PROFILE = {
  maker: 'Canon',
  model: 'EF-S 18-55mm f/4-5.6 IS STM',
  unit: 'HalfDiagonal',
  distortion: [
    { focal: 18, model: 'ptlens', k: [0.02, -0.06, 0] },
    { focal: 55, model: 'ptlens', k: [0, 0.01, 0] }
  ],
  tca: [{ focal: 18, model: 'linear', red: [1.0003], blue: [0.9998] }],
  vignetting: [
    { focal: 18, aperture: 4, k: [-0.5, 0.2, 0] },
    { focal: 18, aperture: 8, k: [-0.2, 0.05, 0] },
    { focal: 55, aperture: 8, k: [-0.1, 0, 0] }
  ]
}

const profile = (): LensProfile => {
  const p = validateProfile(RAW_PROFILE, 'canon-18-55')
  assert.ok(typeof p !== 'string', p as string)
  return p
}

const ctx: CompileContext = {
  isRaw: false,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: 6000,
  frameHeight: 4000,
  scale: 0.4,
  seed: 7,
  brushPaths: {},
  applyCrop: true
}

test('a profile that says nothing, or says it wrongly, is refused with the reason', () => {
  assert.equal(
    typeof validateProfile({ maker: 'X', model: 'Y', unit: 'HalfDiagonal' }, 'x'),
    'string'
  )
  assert.match(validateProfile({ ...RAW_PROFILE, unit: 'Inches' }, 'x') as string, /unit/)
  assert.match(
    validateProfile(
      { ...RAW_PROFILE, distortion: [{ focal: 18, model: 'poly3', k: [1, 2] }] },
      'x'
    ) as string,
    /distortion/
  )
})

test('the file’s lens finds its profile, whatever the punctuation', () => {
  const p = profile()
  assert.equal(matchProfile(shot('EF-S 18-55mm f/4-5.6 IS STM', 18, 8), [p]), p)
  assert.equal(matchProfile(shot('EF-S18-55mm f/4-5.6 IS STM', 18, 8), [p]), p)
  assert.equal(matchProfile(shot('EF 50mm f/1.8 STM', 50, 2), [p]), null)
  assert.equal(matchProfile(null, [p]), null)
})

test('a zoom’s profile interpolates between focal lengths; vignetting takes the nearest aperture', () => {
  const r = resolveProfile(profile(), shot('EF-S 18-55mm f/4-5.6 IS STM', 36.5, 7.1))
  assert.ok(r.distortion && 'PtLens' in r.distortion)
  // Halfway from 18 to 55 mm.
  assert.ok(Math.abs(r.distortion.PtLens.a - 0.01) < 1e-9)
  assert.ok(Math.abs(r.distortion.PtLens.b + 0.025) < 1e-9)
  // f/7.1 is nearest f/8 (in stops); halfway between 18 and 55 mm at f/8.
  assert.ok(r.vignetting)
  assert.ok(Math.abs(r.vignetting[0] + 0.15) < 1e-9)
  assert.deepEqual(r.tca, { Scale: { red: 1.0003, blue: 0.9998 } })
})

test('a manual lens (f-number and focal length 0) resolves, not throws', () => {
  const r = resolveProfile(profile(), shot('EF-S 18-55mm f/4-5.6 IS STM', 0, 0))
  assert.equal(r.aperture, null)
  assert.equal(r.focal, null)
  assert.ok(r.vignetting && r.vignetting.every(Number.isFinite))
  assert.ok(r.distortion)
})

test('untouched lens settings correct nothing', () => {
  assert.equal(lensCorrection(defaultLens()), null)
  assert.equal(defringeOp(defaultLens()), null)
  assert.equal(compile(defaultRecipe(false), ctx).lens, null)
})

test('manual distortion is a poly3 about the centre, and a warp crops its empty edges', () => {
  const l = defaultLens()
  l.distortion = 100
  const c = lensCorrection(l)!
  assert.ok(c.distortion && 'Poly3' in c.distortion.model)
  // Pulling barrel in is a negative Lensfun k1.
  assert.ok(c.distortion.model.Poly3.k1 < 0)
  assert.equal(c.outside, 'Crop')
  assert.equal(c.resampler, 'Lanczos3')
  // Vignetting alone warps nothing: no outside, no resampler.
  const v = defaultLens()
  v.vignetting = 50
  const cv = lensCorrection(v)!
  assert.equal(cv.distortion, null)
  assert.equal(cv.outside, null)
  assert.equal(cv.resampler, null)
  assert.equal(cv.vignetting!.apply, 'Divide')
})

test('the profile’s distortion wins over the manual slider; the vignettings multiply', () => {
  const l = defaultLens()
  l.profile = {
    enabled: true,
    id: null,
    resolved: resolveProfile(profile(), shot('x', 18, 4)),
    distortion: 50,
    vignetting: 100
  }
  l.distortion = 80
  l.vignetting = 40
  const c = lensCorrection(l)!
  assert.ok(c.distortion && 'PtLens' in c.distortion.model)
  assert.equal(c.distortion.amount, 0.5)
  // (1 − 0.5 r² + 0.2 r⁴ + 0 r⁶)(1 + m1 r² + m2 r⁴): five coefficients.
  assert.equal(c.vignetting!.k.length, 5)
  assert.equal(c.vignetting!.geometry.unit, 'HalfDiagonal')
})

test('removing CA uses the measurement, else the profile’s', () => {
  const l = defaultLens()
  l.removeCa = true
  assert.equal(lensCorrection(l), null)
  l.ca = {
    model: { Scale: { red: 1.0004, blue: 0.9997 } },
    geometry: { centre: { x: 0.5, y: 0.5 }, unit: 'HalfDiagonal' },
    amount: 1
  }
  assert.deepEqual(lensCorrection(l)!.lateral_ca!.model, l.ca.model)
  l.ca = null
  l.profile = {
    enabled: true,
    id: null,
    resolved: resolveProfile(profile(), shot('x', 18, 8)),
    distortion: 0,
    vignetting: 0
  }
  assert.deepEqual(lensCorrection(l)!.lateral_ca!.model, { Scale: { red: 1.0003, blue: 0.9998 } })
})

test('defringe keys its bands on edges and runs before the look is graded', () => {
  const r = defaultRecipe(false)
  r.lens.defringe.purpleAmount = 60
  r.basic.contrast = 20
  const op = defringeOp(r.lens)!
  assert.equal(op.Defringe.purple.amount, 0.6)
  assert.equal(op.Defringe.purple.hue.centre, 300)
  assert.equal(op.Defringe.green.amount, 0)
  const look = compile(r, ctx).grade!.layers[0].stages.at(-1)!
  // First after the look stage's floor (isP3Floor).
  assert.ok(isP3Floor(look.ops[0]))
  assert.equal(Object.keys(look.ops[1])[0], 'Defringe')
})

test('the lens reads as one line', () => {
  assert.equal(describeLens(shot('EF-S 18-55mm', 18, 11)), 'Canon EF-S 18-55mm · 18 mm · f/11')
  assert.equal(describeLens(null), null)
})
