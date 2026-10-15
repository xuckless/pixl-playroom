import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  deltaRow,
  lookAt,
  lookLabel,
  needsModels,
  noteRecent,
  NUDGE_ROWS,
  nudgeLabel,
  nudgeRecipe,
  pickerRows,
  pickerSections,
  quickDeltaOf,
  readout,
  RECENT_LOOKS,
  targetsSummary,
  thirds
} from '../src/shared/quickdevelop'
import { mergeSteps, onTop, pushEntry, replaceTop, EMPTY_STACK } from '../src/shared/libraryundo'
import type { RecipeEntry } from '../src/shared/libraryundo'
import { SECTION_FIELDS } from '../src/shared/edits'
import { batchLabel, shownLabel } from '../src/shared/history'
import type { LibraryItem, Preset } from '../src/shared/ipc'
import { LOOKS } from '../src/shared/looks/catalog'
import { applyLook } from '../src/shared/looks/apply'
import { defaultRecipe, type Recipe } from '../src/shared/recipe'
import { writeBatch, type BatchServices } from '../src/main/batchcommit'
import { IndexService } from '../src/main/indexer/service'
import type { XmpIo } from '../src/main/indexer/xmp'

const RAW = { isRaw: true, asShot: { temperature_kelvin: 5000, tint: 0.002 } }
const JPEG = { isRaw: false, asShot: null }

// ── nudges ──

test('exposure goes in thirds of a stop, and holds at the slider’s end', () => {
  const r = defaultRecipe(false)
  assert.equal(nudgeRecipe(r, { exposure: 1 }, null).recipe.basic.exposure, 0.3333)
  assert.equal(nudgeRecipe(r, { exposure: 3 }, null).recipe.basic.exposure, 1)
  const high = structuredClone(r)
  high.basic.exposure = 4.9
  const out = nudgeRecipe(high, { exposure: 3 }, null)
  assert.equal(out.recipe.basic.exposure, 5)
  assert.ok(out.limited)
  assert.equal(nudgeRecipe(r, { exposure: -2 }, null).limited, false)
})

test('contrast, vibrance, clarity and saturation move each photo’s own value, clamped', () => {
  const r = defaultRecipe(false)
  r.basic.contrast = 90
  r.presence.vibrance = -10
  const out = nudgeRecipe(r, { contrast: 20, vibrance: 5, clarity: -5, saturation: 20 }, null)
  assert.equal(out.recipe.basic.contrast, 100)
  assert.equal(out.recipe.presence.vibrance, -5)
  assert.equal(out.recipe.presence.clarity, -5)
  assert.equal(out.recipe.presence.saturation, 20)
  assert.ok(out.limited)
  // The photo passed in is left as it was.
  assert.equal(r.basic.contrast, 90)
})

test('Temp on a RAW goes in mired from its own white; as shot becomes custom', () => {
  const r = defaultRecipe(true)
  assert.equal(r.wb.mode, 'as-shot')
  const warmer = nudgeRecipe(r, { temp: 20 }, RAW).recipe.wb
  assert.equal(warmer.mode, 'custom')
  // 1e6 / (1e6/5000 − 20) = 5555.6 K: warmer is a higher Kelvin.
  assert.equal(warmer.temperature, 5556)
  // Tint starts from the as-shot tint (0.002 duv = 6 units).
  assert.equal(warmer.tint, 6)
  const cooler = nudgeRecipe(r, { temp: -5 }, RAW).recipe.wb
  assert.ok(cooler.temperature < 5000)
  // At the warm end it holds.
  const hot = structuredClone(r)
  hot.wb = { mode: 'custom', temperature: 24000, tint: 0, preset: null }
  const out = nudgeRecipe(hot, { temp: 20 }, RAW)
  assert.equal(out.recipe.wb.temperature, 25000)
  assert.ok(out.limited)
})

test('Temp elsewhere goes in slider units; Tint in units on both', () => {
  const r = defaultRecipe(false)
  const wb = nudgeRecipe(r, { temp: 5, tint: -2 }, JPEG).recipe.wb
  assert.deepEqual(wb, { mode: 'custom', temperature: 5, tint: -2, preset: null })
  const edge = structuredClone(r)
  edge.wb = { mode: 'custom', temperature: 95, tint: 0, preset: 'auto' }
  const out = nudgeRecipe(edge, { temp: 20 }, JPEG)
  assert.equal(out.recipe.wb.temperature, 100)
  assert.equal(out.recipe.wb.preset, null)
  assert.ok(out.limited)
  // A white balance cannot be nudged without the photo's white.
  assert.throws(() => nudgeRecipe(r, { temp: 5 }, null))
})

test('a nudge on a section switched off turns it on again', () => {
  const r = defaultRecipe(false)
  const section = (Object.keys(SECTION_FIELDS) as (keyof typeof SECTION_FIELDS)[]).find((s) =>
    SECTION_FIELDS[s].some((p) => 'basic.exposure'.startsWith(p.join('.')))
  )
  assert.ok(section)
  r.off = { [section]: true }
  assert.equal(nudgeRecipe(r, { exposure: 1 }, null).recipe.off[section], undefined)
})

test('what a row shows, and what its step is called', () => {
  assert.equal(thirds(0), '0')
  assert.equal(thirds(2), '+2/3')
  assert.equal(thirds(3), '+1')
  assert.equal(thirds(4), '+1 1/3')
  assert.equal(thirds(-1), '−1/3')
  assert.equal(thirds(-7), '−2 1/3')
  assert.equal(readout('contrast', 15), '+15')
  assert.equal(readout('contrast', -5), '−5')
  assert.equal(readout('temp', 10, true), 'Warmer')
  assert.equal(readout('temp', -10, true), 'Cooler')
  assert.equal(readout('temp', 10), '+10')
  assert.equal(nudgeLabel('exposure', 2), 'Exposure: +2/3')
  assert.equal(nudgeLabel('temp', -5, true), 'Temp: Cooler')
  assert.equal(deltaRow({ exposure: 2 }), 'exposure')
  assert.equal(deltaRow({ exposure: 2, temp: 1 }), null)
})

test('a delta from the renderer is checked: known rows, whole numbers within reason', () => {
  assert.deepEqual(quickDeltaOf({ exposure: 2, temp: -5 }), { exposure: 2, temp: -5 })
  assert.deepEqual(
    quickDeltaOf({ exposure: 0.5, contrast: 1e9, nope: 3, vibrance: 0, tint: '2' }),
    {}
  )
  assert.deepEqual(quickDeltaOf(null), {})
  assert.deepEqual(
    NUDGE_ROWS.filter((r) => r.more).map((r) => r.id),
    ['clarity', 'saturation']
  )
})

// ── looks on a selection ──

const plain = LOOKS.find((p) => !p.smart && p.fields && p.fields.length > 2) as Preset

test('a look at an Amount: whole as applying it, none as the photo was, between blended', () => {
  const before = defaultRecipe(false)
  const ctx = { wb: JPEG, lensResolved: 'keep' as const }
  const whole = lookAt(before, plain, ctx, 100)
  assert.deepEqual(whole, applyLook(before, plain, ctx))
  const none = lookAt(before, plain, ctx, 0)
  assert.deepEqual(none.basic, before.basic)
  assert.deepEqual(none.presence, before.presence)
  // Some number the look moves sits between the two at half.
  const half = lookAt(before, plain, ctx, 50)
  const moved = JSON.stringify(half) !== JSON.stringify(whole)
  assert.ok(moved)
  assert.equal(lookLabel(plain, 100), `Look: ${plain.name}`)
  assert.equal(lookLabel(plain, 40), `Look: ${plain.name} · 40%`)
  assert.equal(lookLabel({ name: 'Mine' }, 100), 'Preset: Mine')
})

test('a smart look’s masks scale with its Amount; its model work is Develop’s', () => {
  const before = defaultRecipe(false)
  const ctx = { wb: JPEG, lensResolved: 'keep' as const }
  const layer = {
    ...structuredClone(before),
    id: 'm1',
    amount: 80
  } as unknown as Recipe['layers'][number]
  const half = lookAt(before, plain, ctx, 50, [layer])
  assert.equal(half.layers.length, 1)
  assert.equal(half.layers[0].amount, 40)
  const smart = LOOKS.filter((p) => p.smart)
  assert.ok(
    smart.some((p) => needsModels(p.smart!)),
    'some smart look runs a model'
  )
})

test('the picker: My Looks, presets, recent, then the collections; one list when searching', () => {
  const user: Preset = { ...plain, id: 'user-1', name: 'Mine', builtin: false, meta: undefined }
  const second = LOOKS.find((p) => p.id !== plain.id && !p.smart) as Preset
  const sections = pickerSections({
    catalog: LOOKS,
    user: [user],
    mine: [plain.id],
    recent: [second.id, 'gone'],
    query: '',
    usable: (p) => !p.smart
  })
  assert.deepEqual(
    sections.slice(0, 3).map((s) => s.id),
    ['mine', 'user', 'recent']
  )
  assert.deepEqual(
    sections[2].looks.map((p) => p.id),
    [second.id]
  )
  assert.ok(sections.slice(3).every((s) => s.looks.every((p) => !p.smart)))
  // The same look under two sections is two rows.
  const rows = pickerRows(sections)
  assert.equal(new Set(rows.map((r) => r.row)).size, rows.length)
  const found = pickerSections({
    catalog: LOOKS,
    user: [user],
    mine: [],
    recent: [],
    query: plain.name,
    usable: () => true
  })
  assert.equal(found.length, 1)
  assert.equal(found[0].looks[0].id, plain.id)
})

test('recent looks: the newest first, each once, a few kept', () => {
  let recent: string[] = []
  for (let i = 0; i < RECENT_LOOKS + 3; i++) recent = noteRecent(recent, `l${i}`)
  assert.equal(recent.length, RECENT_LOOKS)
  assert.equal(recent[0], `l${RECENT_LOOKS + 2}`)
  assert.deepEqual(noteRecent(['a', 'b', 'c'], 'c'), ['c', 'a', 'b'])
})

test('the targets counted: RAW, HDR, offline, collapsed stacks, a mixed selection', () => {
  const item = (key: string, o: Partial<LibraryItem> = {}): LibraryItem =>
    ({ key, isRaw: false, stack: null, ...o }) as LibraryItem
  const s = targetsSummary(
    [
      item('a', { isRaw: true }),
      item('b', { hdr: 'gainmap' }),
      item('c', { offline: true, stack: { id: 's1', position: 0, size: 3 } }),
      item('d', { stack: { id: 's2', position: 0, size: 2 } }),
      undefined
    ],
    new Set(['s2'])
  )
  assert.deepEqual(s, {
    count: 4,
    raw: 1,
    hdr: 1,
    offline: 1,
    unreadable: 0,
    stacks: 1,
    mixed: true
  })
  assert.equal(targetsSummary([item('a', { isRaw: true })], new Set()).mixed, false)
})

// ── a batch that grows ──

const entry = (id: string, steps: { key: string; seq: number }[]): RecipeEntry => ({
  kind: 'recipe',
  id,
  title: id,
  steps
})

test('a growing batch replaces its entry while it is the newest, and goes on top otherwise', () => {
  let s = pushEntry(EMPTY_STACK, entry('a', [{ key: '1', seq: 1 }]))
  s = pushEntry(s, entry('b', [{ key: '1', seq: 2 }]))
  assert.ok(onTop(s, 'b'))
  assert.ok(!onTop(s, 'a'))
  s = replaceTop(s, entry('b', [{ key: '1', seq: 3 }]))
  assert.equal(s.done.length, 2)
  assert.deepEqual(s.done[1].kind === 'recipe' && s.done[1].steps, [{ key: '1', seq: 3 }])
  // Back to where it started: the entry goes.
  s = replaceTop(s, entry('b', []))
  assert.deepEqual(
    s.done.map((e) => e.id),
    ['a']
  )
  // Not the newest any more: on top as a new one.
  s = replaceTop(s, entry('c', [{ key: '2', seq: 1 }]))
  assert.deepEqual(
    s.done.map((e) => e.id),
    ['a', 'c']
  )
  assert.deepEqual(
    mergeSteps(
      [
        { key: '1', seq: 4 },
        { key: '2', seq: 5 },
        { key: '3', seq: 6 }
      ],
      ['1', '2'],
      [{ key: '1', seq: 4 }]
    ),
    [
      { key: '3', seq: 6 },
      { key: '1', seq: 4 }
    ]
  )
})

const noXmp: XmpIo = {
  read: () => Promise.resolve(null),
  write: () => Promise.resolve(),
  end: () => Promise.resolve()
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
  await new Promise((r) => setTimeout(r, 50))
}

test('a batch step is rewritten from where the photo stood, only while it is the last', async () => {
  const root = mkdtempSync(join(tmpdir(), 'playroom-quick-'))
  const folder = join(root, 'photos')
  mkdirSync(folder)
  for (const f of ['a.jpg', 'b.jpg']) writeFileSync(join(folder, f), `photo ${f}`)
  const index = new IndexService({ userData: join(root, 'ud'), emit: () => {}, xmp: noXmp })
  try {
    const [a, b] = (await index.listFolder(folder))
      .filter((i) => i.copyId === null)
      .map((i) => i.key)
    const r = defaultRecipe(false)
    const label = batchLabel('Exposure: +1/3', 'q1')
    const one = nudgeRecipe(r, { exposure: 1 }, null).recipe
    const seqA = index.batchStep(a, label, r, one)!
    const seqB = index.batchStep(b, label, r, one)!
    assert.deepEqual(index.batchBase(a, seqA), r)
    // The burst's total so far, from where it stood: still one step.
    const two = nudgeRecipe(index.batchBase(a, seqA)!, { exposure: 2 }, null).recipe
    const again = index.amendBatchStep(a, seqA, batchLabel('Exposure: +2/3', 'q1'), two)
    assert.equal(again, seqA)
    assert.equal(index.recipe(a).basic.exposure, 0.6667)
    assert.deepEqual(
      index.history(a).steps.map((s) => shownLabel(s.label)),
      ['Exposure: +2/3']
    )
    // Back to where it started: the step goes.
    assert.equal(index.amendBatchStep(a, seqA, label, r), null)
    assert.equal(index.history(a).steps.length, 0)
    assert.equal(index.recipe(a).basic.exposure, 0)
    // Edited since: no longer rewritten.
    const edited = structuredClone(one)
    edited.basic.contrast = 10
    index.commitEdit(b, 'Contrast', edited, edited)
    assert.equal(index.batchBase(b, seqB), null)
    assert.equal(index.amendBatchStep(b, seqB, label, r), null)
    assert.equal(index.recipe(b).basic.contrast, 10)
  } finally {
    await settle()
    index.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('writeBatch rewrites the steps it has, writes new ones, and leaves photos edited since', async () => {
  const r = defaultRecipe(false)
  const amended: string[] = []
  const stepped: string[] = []
  const s = {
    index: {
      batchBase: async (key: string) => (key === 'edited' ? null : r),
      amendBatchStep: async (key: string, seq: number) => {
        amended.push(key)
        return seq
      },
      batchStep: async (key: string) => {
        stepped.push(key)
        return 9
      },
      recipes: async (keys: string[]) => keys.map((key) => ({ key, row: {}, recipe: r })),
      itemsFor: async (keys: string[]) => keys.map(() => undefined)
    },
    planes: { slim: (x: Recipe) => x, hydrate: async (x: Recipe) => x },
    library: { addVersion: async () => null, queueThumb: () => {} },
    sessions: { liveRecipe: () => undefined, update: () => {}, flush: async () => {} }
  } as unknown as BatchServices
  const out = await writeBatch(
    s,
    ['had', 'edited', 'new'],
    { id: 'q1', label: 'Exposure: +1', version: null },
    [
      { key: 'had', seq: 4 },
      { key: 'edited', seq: 5 }
    ],
    async (_key, before) => nudgeRecipe(before, { exposure: 3 }, null).recipe
  )
  assert.deepEqual(amended, ['had'])
  assert.deepEqual(stepped, ['new'])
  assert.deepEqual(out.steps, [
    { key: 'had', seq: 4 },
    { key: 'new', seq: 9 }
  ])
  assert.deepEqual(out.failed, [])
})

test('Quick develop’s keys are bound once each, and ⇧A is left to culling', async () => {
  const { readFileSync } = await import('fs')
  const src = readFileSync(join(import.meta.dirname, '../src/renderer/src/lib/commands.ts'), 'utf8')
  for (const chord of [
    'Shift+I',
    'Alt+ArrowUp',
    'Alt+ArrowDown',
    'Shift+Alt+ArrowUp',
    'Shift+Alt+ArrowDown',
    'Alt+ArrowRight',
    'Alt+ArrowLeft'
  ])
    assert.equal(src.split(`'${chord}'`).length - 1, 1, chord)
  // Auto tone on a selection has no key of its own (⇧A is Develop's, and culling's next).
  assert.match(src, /id: 'library\.autoTone',[\s\S]{0,200}?keys: \[\]/)
})
