import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONCEPTS, conceptOf, finderFor, pickBySize, type Finders } from '../src/shared/concepts'
import { PERSON_PARTS } from '../src/shared/looks/smart'
import { newLocalLayer, normaliseComponent, type BrushComponent } from '../src/shared/recipe'
import { toInstructions } from '../src/shared/looks/smart'

const TODAY: Finders = { click: true, text: false, parts: false, 'sky-model': false }

test('every class is the sky or a part smart looks name, once each', () => {
  const ids = CONCEPTS.map((c) => c.id)
  assert.deepEqual([...ids].sort(), ['sky', ...PERSON_PARTS].sort())
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(conceptOf('hair')?.label, 'Hair')
  assert.equal(conceptOf('ears'), null)
  assert.equal(conceptOf(3), null)
})

test('a class is found by a click today, and by name first once a finder knows it', () => {
  for (const c of CONCEPTS) assert.equal(finderFor(c, TODAY), 'click', c.id)
  assert.equal(finderFor(conceptOf('hair')!, { ...TODAY, parts: true }), 'parts')
  assert.equal(finderFor(conceptOf('hair')!, { ...TODAY, text: true }), 'text')
  assert.equal(
    finderFor(conceptOf('sky')!, { ...TODAY, 'sky-model': true, text: true }),
    'sky-model'
  )
  assert.equal(finderFor(conceptOf('sky')!, { ...TODAY, click: false }), null)
})

test("a class keeps SAM's answer of its size, of those SAM is fairly sure of", () => {
  // The person (unsure), the face, the head and shoulders: as SAM answered a cheek.
  const area = [0.093, 0.0045, 0.0099]
  const iou = [0.08, 0.62, 0.62]
  assert.equal(pickBySize('small', area, iou), 1)
  assert.equal(pickBySize('large', area, iou), 2)
  assert.equal(pickBySize('best', area, [0.08, 0.62, 0.65]), 2)
  // Unsure of all: still the smallest.
  assert.equal(pickBySize('small', area, [0.1, 0.2, 0.3]), 1)
  assert.equal(pickBySize('small', [], []), -1)
})

test('a mask pointed at as a class keeps its class, and a look saves it as that class', () => {
  const brush = (source: unknown): BrushComponent =>
    normaliseComponent({
      id: 'c',
      kind: 'brush',
      mode: 'Add',
      opacity: 100,
      invert: false,
      feather: 0,
      width: 4,
      height: 4,
      png: 'x',
      source
    }) as BrushComponent
  const hair = brush({ kind: 'prompt', label: 'Hair', via: 'click', concept: 'hair' })
  assert.deepEqual(hair.source, { kind: 'prompt', label: 'Hair', via: 'click', concept: 'hair' })
  assert.deepEqual(brush({ kind: 'prompt', via: 'click', concept: 'ears' }).source, {
    kind: 'prompt',
    via: 'click'
  })
  const l = newLocalLayer('Hair')
  l.components = [hair]
  const sky = newLocalLayer('Sky')
  sky.components = [brush({ kind: 'prompt', label: 'Sky', via: 'click', concept: 'sky' })]
  const out = toInstructions([l, sky], [])
  assert.deepEqual(
    out.smart!.masks.map((m) => m.parts.map((p) => p.target)),
    [[{ kind: 'person', part: 'hair' }], [{ kind: 'sky' }]]
  )
})
