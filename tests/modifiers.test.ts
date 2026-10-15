import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isFine, isReset, keyStep, stepScale } from '../src/renderer/src/lib/sliderDrag'
import {
  atDisc,
  discPoint,
  neutralOf,
  nudgeChannel,
  nudgeDisc,
  typedChannel,
  type WheelScale
} from '../src/renderer/src/lib/wheel'
import { addPoint, nudgePoint, placePoint, resetPoint } from '../src/renderer/src/lib/curveEdit'

const SRC = join(import.meta.dirname, '..', 'src', 'renderer', 'src')
const src = (f: string): string => readFileSync(join(SRC, f), 'utf8')

test('one rule: Shift is fine, Alt resets', () => {
  assert.equal(isFine({ shiftKey: true, altKey: false }), true)
  assert.equal(isFine({ shiftKey: false, altKey: true }), false)
  assert.equal(isReset({ shiftKey: false, altKey: true }), true)
  assert.equal(isReset({ shiftKey: true, altKey: false }), false)
})

test('arrows step, Shift a tenth, Page keys ten; other keys are not steps', () => {
  assert.deepEqual(keyStep({ key: 'ArrowUp', shiftKey: false }), { dir: 1, mod: 'none' })
  assert.deepEqual(keyStep({ key: 'ArrowLeft', shiftKey: true }), { dir: -1, mod: 'fine' })
  assert.deepEqual(keyStep({ key: 'PageDown', shiftKey: false }), { dir: -1, mod: 'coarse' })
  assert.equal(keyStep({ key: 'Home', shiftKey: false }), null)
  assert.equal(keyStep({ key: 'a', shiftKey: false }), null)
  assert.equal(stepScale('fine'), 0.1)
  assert.equal(stepScale('coarse'), 10)
})

test('every dragged control reads the rule from one place, not its own modifiers', () => {
  for (const f of [
    'components/ui.tsx',
    'components/editors.tsx',
    'components/grading/GradeWheel.tsx'
  ]) {
    const code = src(f)
    assert.doesNotMatch(code, /e\.(altKey|shiftKey)\s*\?\s*[\d'.]/, `${f} picks a speed by hand`)
    assert.match(code, /isFine\(e\)/, `${f} drags finely with Shift`)
    assert.match(code, /isReset\(e\)/, `${f} resets with Alt`)
    assert.match(code, /useEscapeWhile\(/, `${f} takes a drag back on Escape`)
  }
})

const LIFT: WheelScale = { neutral: 0, reach: 0.25, ringStep: 0.004, min: -1, max: 1 }
const GAIN: WheelScale = { neutral: 1, reach: 0.35, ringStep: 0.008, min: 0, max: 4 }

test('a wheel’s disc: a place on it and back, inside the circle, the master kept', () => {
  const v = atDisc({ y: 0.3, r: 0, g: 0, b: 0 }, LIFT, 0.5, -0.25)
  assert.equal(v.y, 0.3)
  const p = discPoint(v, LIFT)
  assert.ok(Math.abs(p.x - 0.5) < 1e-9 && Math.abs(p.y + 0.25) < 1e-9)
  // Past the edge: on it.
  const edge = discPoint(atDisc(neutralOf(GAIN), GAIN, 3, 4), GAIN)
  assert.ok(Math.abs(Math.hypot(edge.x, edge.y) - 1) < 1e-9)
  assert.deepEqual(neutralOf(GAIN), { y: 1, r: 1, g: 1, b: 1 })
})

test('keys nudge the puck along one axis, Shift a tenth as far', () => {
  const start = neutralOf(LIFT)
  const right = discPoint(nudgeDisc(start, LIFT, 'x', 1, 'none'), LIFT)
  assert.ok(Math.abs(right.x - 0.02) < 1e-9 && Math.abs(right.y) < 1e-9)
  const fineDown = discPoint(nudgeDisc(start, LIFT, 'y', -1, 'fine'), LIFT)
  assert.ok(Math.abs(fineDown.y + 0.002) < 1e-9)
})

test('the ring and the numbers step by the drag’s step, inside the range', () => {
  assert.equal(nudgeChannel(0, LIFT, 1, 'none'), 0.01)
  assert.equal(nudgeChannel(0, LIFT, -1, 'fine'), -0.001)
  assert.equal(nudgeChannel(0.99, LIFT, 1, 'coarse'), 1)
})

test('a number field sets only what was typed: tabbing through or stepping never rounds it', () => {
  // Stepped by a key to 0.005: shown as 0.01 (or 0.00), and left as it is on the way out.
  assert.equal(typedChannel('0.01', 0.005, LIFT), null)
  assert.equal(typedChannel(' 1.00 ', 1.002, GAIN), null)
  // Typed: set, inside the range; a comma is a decimal point.
  assert.equal(typedChannel('0,25', 0, LIFT), 0.25)
  assert.equal(typedChannel('9', 1, GAIN), 4)
  // Cleared, or not a number: nothing (never 0).
  assert.equal(typedChannel('', 0.3, LIFT), null)
  assert.equal(typedChannel('abc', 0.3, LIFT), null)
  // Offset shows 25 + 100·o and reads it back.
  const OFFSET: WheelScale = {
    ...LIFT,
    show: (v) => 25 + 100 * v,
    read: (n) => (n - 25) / 100
  }
  assert.equal(typedChannel('25.00', 0, OFFSET), null)
  assert.equal(typedChannel('35', 0, OFFSET), 0.1)
})

const TONE = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.6 },
  { x: 1, y: 1 }
]

test('a curve point stays between its neighbours; a tone curve’s ends keep their side', () => {
  assert.deepEqual(placePoint(TONE, 1, 0.995, 0.7, false)[1], { x: 0.99, y: 0.7 })
  assert.deepEqual(placePoint(TONE, 0, 0.3, 0.1, false)[0], { x: 0, y: 0.1 })
  // A vs curve's points all move.
  assert.deepEqual(placePoint(TONE, 0, 0.3, 0.1, true)[0], { x: 0.3, y: 0.1 })
  assert.deepEqual(placePoint(TONE, 1, 0.4, 1.5, false)[1], { x: 0.4, y: 1 })
})

test('keys move a point (Shift finely); putting one back removes it, or sends an end home', () => {
  assert.deepEqual(nudgePoint(TONE, 1, 'y', 1, 'none', false)[1], { x: 0.5, y: 0.61 })
  assert.deepEqual(nudgePoint(TONE, 1, 'x', -1, 'fine', false)[1], { x: 0.499, y: 0.6 })
  assert.equal(resetPoint(TONE, 1, false).length, 2)
  const lifted = [{ x: 0, y: 0.2 }, ...TONE.slice(1)]
  assert.deepEqual(resetPoint(lifted, 0, false)[0], { x: 0, y: 0 })
  assert.equal(resetPoint(TONE, 0, true).length, 2)
})

test('a point added from the keys lands in the widest gap, on the line', () => {
  const { points, index } = addPoint(TONE, (x) => x)
  assert.equal(points.length, 4)
  assert.deepEqual(points[index], { x: 0.25, y: 0.25 })
  const empty = addPoint([], () => 0.5)
  assert.deepEqual(empty.points, [{ x: 0.5, y: 0.5 }])
})

test('a qualifier’s sliders reset to where the pick keyed them, not to where they are', async () => {
  const { qualifierFromSample, qualifierRest, normaliseQualifiers } =
    await import('../src/shared/resolve')
  const q = qualifierFromSample('q1', { hue: 210, saturation: 0.5, luminance: 0.6 })
  const keyed = structuredClone(q.keyHue)
  q.keyHue.centre = 250
  q.keyHue.width = 80
  assert.deepEqual(qualifierRest(q).keyHue, keyed)
  // Saved and opened again, the pick is kept; one keyed before it was kept rests on a new band's.
  assert.deepEqual(normaliseQualifiers([q])[0].picked, q.picked)
  const old = normaliseQualifiers([{ ...q, picked: undefined }])[0]
  assert.equal(old.picked, undefined)
  assert.equal(qualifierRest(old).keyLum.centre, 0.5)
  // The panel passes the rest as each slider's default, never the live value.
  assert.doesNotMatch(src('panels/resolve.tsx'), /def=\{q\[b\.key\]/)
})
