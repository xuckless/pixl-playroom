import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STROKE_CLICKS,
  strokeObject,
  strokePrompt,
  addPart,
  boxAround,
  enginePrompt,
  insidePolygon,
  lassoPrompt,
  MAX_PROMPT_POINTS,
  normalisePrompt,
  promptSteps,
  STROKE_POINTS,
  strokePoints
} from '../src/shared/prompt'
import { toStart } from '../src/shared/ai'
import { normaliseComponent } from '../src/shared/recipe'

test('a prompt read from anywhere is held to the frame and the decoder’s limits', () => {
  const many = Array.from({ length: 70 }, (_, i) => ({ x: i / 70, y: 0.5, fg: i % 2 === 0 }))
  const g = normalisePrompt({ rect: { x: 0.8, y: -0.2, width: 0.5, height: 0.5 }, points: many })!
  // A box reaching past the frame is cut to it.
  assert.deepEqual(g.rect, { x: 0.8, y: 0, width: 0.2, height: 0.5 })
  assert.equal(g.points.length, MAX_PROMPT_POINTS)
  assert.equal(g.points[1].fg, false)
  // Nothing to point with is no prompt.
  assert.equal(
    normalisePrompt({ rect: { x: 0.5, y: 0.5, width: 0, height: 0.2 }, points: [] }),
    null
  )
  assert.equal(normalisePrompt('nope'), null)
  // Steps that do not rise, or count past the points, are dropped.
  const p = {
    rect: null,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 }
    ]
  }
  assert.deepEqual(normalisePrompt({ ...p, parts: [1, 2] })!.parts, [1, 2])
  assert.equal(normalisePrompt({ ...p, parts: [2, 1] })!.parts, undefined)
  assert.equal(normalisePrompt({ ...p, parts: [1, 5] })!.parts, undefined)
})

test('the engine is fed the box and the clicks, foreground and background', () => {
  const e = enginePrompt({
    rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    points: [
      { x: 0.2, y: 0.3, fg: true },
      { x: 0.25, y: 0.35, fg: false }
    ]
  })
  assert.deepEqual(e.points, [
    { at: { x: 0.2, y: 0.3 }, label: 'Foreground' },
    { at: { x: 0.25, y: 0.35 }, label: 'Background' }
  ])
  assert.equal(enginePrompt({ rect: null, points: [{ x: 0, y: 0, fg: true }] }, 0).points.length, 0)
})

test('parts added to a selection replay in the same steps', () => {
  const first = { rect: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }, points: [] }
  assert.deepEqual(promptSteps(first), [0])
  const second = addPart(first, { rect: null, points: [{ x: 0.3, y: 0.3, fg: true }] })
  assert.deepEqual(second.parts, [0, 1])
  assert.deepEqual(second.rect, first.rect)
  const third = addPart(second, {
    rect: null,
    points: [
      { x: 0.5, y: 0.5, fg: false },
      { x: 0.55, y: 0.5, fg: false }
    ]
  })
  assert.deepEqual(third.parts, [0, 1, 3])
  assert.deepEqual(promptSteps(third), [0, 1, 3])
  // A stored prompt without steps is one decode of everything.
  assert.deepEqual(promptSteps({ rect: null, points: third.points }), [3])
})

test('a drag’s corners make the box around them; a tiny one is a click', () => {
  assert.deepEqual(
    boxAround([
      { x: 0.4, y: 0.6 },
      { x: 0.2, y: 0.3 },
      { x: 0.45, y: 0.25 },
      { x: 0.1, y: 0.55 }
    ]),
    { x: 0.1, y: 0.25, width: 0.35, height: 0.35 }
  )
  assert.equal(
    boxAround([
      { x: 0.5, y: 0.5 },
      { x: 0.5005, y: 0.5005 }
    ]),
    null
  )
})

test('a brush stroke becomes evenly spaced clicks along it, ends included, never too many', () => {
  const stroke = Array.from({ length: 200 }, (_, i) => ({ x: 0.1 + (0.8 * i) / 199, y: 0.5 }))
  const pts = strokePoints(stroke, 1.5)
  assert.equal(pts.length, STROKE_POINTS)
  assert.deepEqual(pts[0], { x: 0.1, y: 0.5 })
  assert.deepEqual(pts.at(-1), { x: 0.9, y: 0.5 })
  const gaps = pts.slice(1).map((p, i) => p.x - pts[i].x)
  for (const g of gaps) assert.ok(Math.abs(g - gaps[0]) < 1e-4)
  // A short dab is a click or two.
  assert.ok(
    strokePoints(
      [
        { x: 0.5, y: 0.5 },
        { x: 0.51, y: 0.5 }
      ],
      1.5
    ).length <= 2
  )
  assert.equal(strokePoints([{ x: 0.5, y: 0.5 }], 1.5).length, 1)
})

test('a rough lasso becomes a box and clicks well inside it', () => {
  // An L shape: its corner region is inside, its notch is not.
  const outline = [
    { x: 0.2, y: 0.2 },
    { x: 0.4, y: 0.2 },
    { x: 0.4, y: 0.6 },
    { x: 0.8, y: 0.6 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 }
  ]
  const g = lassoPrompt(outline, 1.5)!
  assert.deepEqual(g.rect, { x: 0.2, y: 0.2, width: 0.6, height: 0.6 })
  assert.ok(g.points.length >= 2)
  for (const p of g.points) {
    assert.equal(p.fg, true)
    assert.ok(insidePolygon(p, outline), `${p.x},${p.y} inside`)
  }
  assert.equal(lassoPrompt(outline.slice(0, 2), 1.5), null)
})

test('a prompt waits only behind its own lane: a click never waits for a denoise', () => {
  const jobs = [
    { id: 'denoise', lane: 'model', phase: 'running' as const, at: 1 },
    { id: 'enhance', lane: 'model', phase: 'queued' as const, at: 2 },
    { id: 'sky', lane: 'select', phase: 'queued' as const, at: 3 },
    { id: 'car', lane: 'select', phase: 'queued' as const, at: 4 }
  ]
  const start = toStart(jobs, new Set(['model']), (j) => j.lane)
  assert.deepEqual(
    start.map((j) => j.id),
    ['sky']
  )
  assert.deepEqual(
    toStart(jobs, new Set(), (j) => j.lane).map((j) => j.id),
    ['enhance', 'sky']
  )
})

test('an object mask keeps the prompt it was made from, and how it was asked', () => {
  const c = normaliseComponent({
    id: 'o',
    kind: 'brush',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    width: 4,
    height: 4,
    png: '',
    ref: 'r',
    source: {
      kind: 'prompt',
      label: 'Dog',
      via: 'box',
      prompt: { rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, points: [], parts: [0] }
    }
  })
  assert.ok(c?.kind === 'brush' && c.source?.kind === 'prompt')
  if (c?.kind !== 'brush' || c.source?.kind !== 'prompt') return
  assert.equal(c.source.label, 'Dog')
  assert.equal(c.source.via, 'box')
  assert.deepEqual(c.source.prompt?.parts, [0])
  // An unknown way of asking is dropped; the mask stays.
  const odd = normaliseComponent({ ...c, source: { kind: 'prompt', via: 'telepathy' } })
  assert.ok(odd?.kind === 'brush' && odd.source?.kind === 'prompt' && !('via' in odd.source))
})

test("a stroke's prompt clicks along its core, spread out, and nothing for no stroke", () => {
  const w = 256
  const h = 128
  const plane = new Uint8Array(w * h)
  // A horizontal stroke, strong along y 60…68 from x 20 to 236, faint around it.
  for (let y = 50; y < 78; y++)
    for (let x = 10; x < 246; x++)
      plane[y * w + x] = y >= 60 && y < 68 && x >= 20 && x < 236 ? 240 : 60
  const p = strokePrompt(plane, w, h)!
  assert.equal(p.rect, null)
  assert.ok(p.points.length >= 3 && p.points.length <= STROKE_CLICKS)
  for (const q of p.points) {
    assert.equal(q.fg, true)
    // On the core, not the faint rim.
    assert.ok(q.y > 60 / h && q.y < 68 / h, `y ${q.y}`)
    assert.ok(q.x > 20 / w && q.x < 236 / w, `x ${q.x}`)
  }
  // Both ends asked about, not just the middle.
  const xs = p.points.map((q) => q.x)
  assert.ok(Math.min(...xs) < 0.2 && Math.max(...xs) > 0.8)
  assert.equal(strokePrompt(new Uint8Array(w * h), w, h), null)
  assert.equal(strokePrompt(new Uint8Array(w * h).fill(40), w, h), null)
})

test('the object a stroke was on is the smallest answer holding its core', () => {
  // A face (small, holds all), the person (large, holds all), a cheek (holds half).
  assert.equal(strokeObject([1, 1, 0.5], [0.1, 0.4, 0.02]), 0)
  assert.equal(strokeObject([0.9, 1, 0.5], [0.3, 0.1, 0.02]), 1)
  // None holds enough: the one holding most.
  assert.equal(strokeObject([0.4, 0.7, 0.5], [0.1, 0.4, 0.02]), 1)
  assert.equal(strokeObject([], []), -1)
})
