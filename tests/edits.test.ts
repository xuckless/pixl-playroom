import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, type CompileContext } from '../src/shared/compile'
import { effective, sectionsOff, SECTION_FIELDS } from '../src/shared/edits'
import { activeSteps, type PixelStep } from '../src/shared/pixels'
import { defaultRecipe, editsInHdr, normaliseRecipe, EDIT_SECTIONS } from '../src/shared/recipe'
import { CARD_IDS } from '../src/shared/cards'
import { viewGeometry } from '../src/shared/view'

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

const step = (id: string, off?: true): PixelStep => ({
  id,
  kind: 'enhance',
  label: 'Enhance',
  blob: 'a'.repeat(64),
  alpha: null,
  scope: null,
  opacity: 100,
  width: 6000,
  height: 4000,
  rect: null,
  params: {},
  ...(off ? { off } : {})
})

test('every card is a section that can be switched off', () => {
  for (const id of CARD_IDS) assert.ok(EDIT_SECTIONS.includes(id), id)
  for (const s of EDIT_SECTIONS) assert.ok(SECTION_FIELDS[s].length > 0, s)
})

test('nothing switched off: the recipe itself is rendered', () => {
  const r = defaultRecipe(false)
  r.basic.exposure = 0.6
  r.pixels = [step('a')]
  assert.equal(effective(r, false), r)
  assert.equal(activeSteps(r.pixels), r.pixels)
})

test('a section switched off renders at the defaults, its values kept and the rest shared', () => {
  const r = defaultRecipe(false)
  r.basic.exposure = 0.6
  r.toneBase = 'texture'
  r.presence.clarity = 30
  r.off = { light: true }
  const e = effective(r, false)
  assert.equal(e.basic.exposure, 0)
  assert.equal(e.toneBase, 'none')
  assert.deepEqual(e.off, {})
  // Kept in the recipe, to come back when switched on.
  assert.equal(r.basic.exposure, 0.6)
  // What is not switched off is the recipe's own, not a copy.
  assert.equal(e.wb, r.wb)
  assert.equal(e.presence, r.presence)
  // Made once per recipe.
  assert.equal(effective(r, false), e)
})

test('Colour joined Presence: an older photo with Colour off has Presence off', async () => {
  const { normaliseRecipe } = await import('../src/shared/recipe')
  const r = defaultRecipe(false)
  r.presence.clarity = 30
  r.presence.vibrance = 20
  ;(r.off as Record<string, true>) = { colour: true }
  const n = normaliseRecipe(r, false)
  assert.deepEqual(n.off, { presence: true })
  const e = effective(n, false)
  assert.equal(e.presence.vibrance, 0)
  assert.equal(n.presence.vibrance, 20)
})

test('a section switched off compiles as if it had never been edited', () => {
  const plain = defaultRecipe(false)
  const curved = defaultRecipe(false)
  curved.toneCurve.master = [
    { x: 0, y: 0.1 },
    { x: 0.5, y: 0.6 },
    { x: 1, y: 1 }
  ]
  curved.off = { curve: true }
  assert.deepEqual(compile(curved, ctx).grade, compile(plain, ctx).grade)
})

test('a RAW goes back to its own defaults (its profile and sharpening), not a JPEG’s', () => {
  const r = defaultRecipe(true)
  r.detail.sharpenAmount = 90
  r.profile = { kind: 'neutral' }
  r.off = { detail: true, profile: true }
  const e = effective(r, true)
  assert.equal(e.detail.sharpenAmount, defaultRecipe(true).detail.sharpenAmount)
  assert.deepEqual(e.profile, defaultRecipe(true).profile)
})

test('a pixel step switched off is not laid on, and stays in the list', () => {
  const r = defaultRecipe(false)
  r.pixels = [step('a'), step('b', true), step('c')]
  assert.deepEqual(
    effective(r, false).pixels.map((s) => s.id),
    ['a', 'c']
  )
  assert.equal(r.pixels.length, 3)
  // Switching a step off never flips a gain-map photo's editing space.
  assert.equal(editsInHdr({ ...r, gainMap: 'hdr' }, true), false)
})

test('crop and heal switched off: the full frame and no spots', () => {
  const r = defaultRecipe(false)
  r.geometry.crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }
  r.geometry.straighten = 3
  r.geometry.quarterTurns = 1
  r.retouch = [{ id: 's', kind: 'heal', points: [], radius: 10 } as never]
  r.off = { crop: true, heal: true }
  const e = effective(r, false)
  assert.equal(e.geometry.crop, null)
  assert.equal(e.geometry.straighten, 0)
  // The turns are never switched off: everything is placed by them.
  assert.equal(e.geometry.quarterTurns, 1)
  assert.deepEqual(e.retouch, [])
  // The loupe lays out what is rendered.
  const g = viewGeometry(r, 6000, 4000, false)
  assert.equal(g.crop, null)
  assert.equal(g.straighten, 0)
})

test('a recipe read back keeps only real sections, switched off by true', () => {
  const old = normaliseRecipe({ version: 5, basic: { exposure: 1 } }, false)
  assert.deepEqual(old.off, {})
  const r = normaliseRecipe(
    { version: 5, off: { light: true, curve: false, bogus: true, wb: 'yes' } },
    false
  )
  assert.deepEqual(r.off, { light: true })
  assert.deepEqual(sectionsOff(r), ['light'])
})

test('switching a section or a step off and on is a small patch that replays', async () => {
  const { diffRecipe, applyPatch } = await import('../src/shared/history')
  const on = defaultRecipe(false)
  on.basic.exposure = 0.6
  on.pixels = [step('a')]
  const off = structuredClone(on)
  off.off = { light: true }
  off.pixels = [step('a', true)]
  const patch = diffRecipe(on, off)
  // The section's own values are not in it: only the switch, and the step.
  assert.ok(!JSON.stringify(patch).includes('exposure'))
  assert.deepEqual(applyPatch(structuredClone(on), patch), off)
  assert.deepEqual(applyPatch(structuredClone(off), diffRecipe(off, on)), on)
})

test('the Edits list: a row per section changed, mask, layer and step, with its net change', async () => {
  const { editRows } = await import('../src/shared/edits')
  const { newLocalLayer } = await import('../src/shared/recipe')
  const r = defaultRecipe(false)
  assert.deepEqual(editRows(r, false), [], 'an untouched photo has nothing to list')
  r.basic.exposure = 0.6
  r.basic.contrast = 12
  r.toneCurve.master = [
    { x: 0, y: 0.1 },
    { x: 1, y: 1 }
  ]
  r.off = { curve: true }
  r.retouch = [{ id: 's', kind: 'heal', points: [], radius: 10 } as never]
  const mask = newLocalLayer('Sky')
  mask.settings.basic.exposure = -0.4
  r.layers = [mask]
  r.pixels = [step('e', true)]
  const rows = editRows(r, false)
  assert.deepEqual(
    rows.map((x) => [x.id, x.on]),
    [
      ['section:light', true],
      ['section:curve', false],
      ['section:heal', true],
      [`mask:${mask.id}`, true],
      ['step:e', false]
    ]
  )
  assert.deepEqual(rows[0].changes, [
    { label: 'Exposure', value: 0.6 },
    { label: 'Contrast', value: 12 }
  ])
  // A curve has no one value to name: it counts.
  assert.ok(rows[1].more > 0)
  assert.equal(rows[2].count, 1)
  assert.deepEqual(rows[3].changes, [{ label: 'Exposure', value: -0.4 }])
  // A RAW's own defaults (its profile, its sharpening) are not edits.
  assert.deepEqual(editRows(defaultRecipe(true), true), [])
})

test('a look or a paste that writes a switched-off section switches it on', async () => {
  const { keepWrittenOn, setSectionOff } = await import('../src/shared/edits')
  const before = defaultRecipe(false)
  before.basic.exposure = 0.6
  setSectionOff(before, 'light', true)
  setSectionOff(before, 'curve', true)
  const after = structuredClone(before)
  after.basic.exposure = 1
  const kept = keepWrittenOn(before, after)
  assert.deepEqual(kept.off, { curve: true }, 'what it did not write stays off')
  // Nothing written: the same recipe back.
  assert.equal(keepWrittenOn(before, before), before)
  setSectionOff(after, 'curve', false)
  assert.deepEqual(after.off, { light: true })
})

test('Before is the photo as it came on the Neutral profile, RAW or not', async () => {
  const { beforeRecipe } = await import('../src/shared/recipe')
  for (const raw of [true, false]) {
    const b = beforeRecipe(raw)
    assert.deepEqual(b.profile, { kind: 'neutral' })
    assert.equal(b.profileAmount, 100)
    // Everything else is the photo's defaults (a RAW's sharpening included).
    assert.deepEqual({ ...b, profile: null }, { ...defaultRecipe(raw), profile: null })
  }
})
