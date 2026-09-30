import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addColorOp,
  addVector,
  afterPick,
  complementTo,
  complementToWhite,
  hsvToRgb,
  NO_ADD,
  rgbToHsv,
  sampleIn,
  settingFromVector,
  type Vec3
} from '../src/shared/addcolor'

const near = (a: number[], b: number[], eps = 1e-3): void =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} ≉ ${b}`))

test('hue and saturation round-trip through RGB', () => {
  for (const [h, s] of [
    [0, 1],
    [30, 0.6],
    [200, 0.5],
    [300, 0.2]
  ]) {
    const back = rgbToHsv(hsvToRgb(h, s))
    assert.ok(Math.abs(back.hue - h) < 1e-6 && Math.abs(back.saturation - s) < 1e-6)
    assert.equal(back.value, 1)
  }
})

test('the complement to white makes a colour neutral at its brightest channel', () => {
  const a: Vec3 = [0.5, 0.35, 0.3]
  const c = complementToWhite(a)
  near(c, [0, 0.15, 0.2])
  near([a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0.5, 0.5, 0.5])
})

test('matching adds the difference, lifted by grey where light would have to go', () => {
  near(complementTo([0.2, 0.2, 0.2], [0.3, 0.25, 0.2]), [0.1, 0.05, 0])
  // b is darker in red: everything is lifted by 0.1 so nothing is negative.
  const c = complementTo([0.4, 0.2, 0.2], [0.3, 0.3, 0.2])
  near(c, [0, 0.2, 0.1])
  assert.ok(c.every((v) => v >= 0))
})

test('a setting says back the vector it was made from', () => {
  const v: Vec3 = [0, 0.15, 0.2]
  const s = settingFromVector(v, 'light')
  assert.equal(s.clamped, false)
  near(addVector(s, 'light'), v, 2e-3)
})

test('a second pick adds to the first', () => {
  const first = afterPick(NO_ADD, [0, 0.1, 0.1], 'wash')
  const second = afterPick(first, [0, 0.05, 0], 'wash')
  near(addVector(second, 'wash'), [0, 0.15, 0.1], 2e-3)
})

test('too much light is clamped at the slider end and says so', () => {
  const s = settingFromVector([0, 0, 2], 'light')
  assert.equal(s.amount, 100)
  assert.equal(s.clamped, true)
})

test('nothing is added at amount 0; light is linear sRGB, a wash Display P3', () => {
  assert.equal(addColorOp(NO_ADD, 'light'), null)
  const light = addColorOp({ hue: 30, saturation: 60, amount: 20 }, 'light')
  assert.ok(light && 'AddColor' in light)
  assert.equal(light.AddColor.space, 'LinearSrgb')
  assert.equal(light.AddColor.amount, 0.1)
  const wash = addColorOp({ hue: 30, saturation: 60, amount: 20 }, 'wash')
  assert.ok(wash && 'AddColor' in wash && wash.AddColor.space === 'DisplayP3')
})

test('a sample is linearised for light and left as code values for a wash', () => {
  near(sampleIn([1, 1, 1], 'light'), [1, 1, 1], 2e-3)
  near(sampleIn([0.5, 0.5, 0.5], 'light'), [0.214, 0.214, 0.214], 2e-3)
  assert.deepEqual(sampleIn([0.5, 0.4, 0.3], 'wash'), [0.5, 0.4, 0.3])
})
