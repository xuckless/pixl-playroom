import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, type CompileContext } from '../src/shared/compile'
import { defaultRecipe, type BrushComponent } from '../src/shared/recipe'
import type { PixelStep } from '../src/shared/pixels'
import {
  collection,
  deblur,
  denoise,
  inverted,
  look,
  mask,
  minus,
  part,
  tone,
  within
} from '../src/shared/looks/dsl'
import { lookFromFile, lookToFile } from '../src/shared/looks/schema'
import {
  planSmart,
  readSmart,
  smartBlockers,
  smartReadiness,
  SMART_RATES,
  type SmartBuild,
  type SmartPart
} from '../src/shared/looks/smart'

/** Engine 0.15's build: U²-Net, DRUNet and Enhance; no sky, people, SAM2, detector or NAFNet. */
const BEFORE: SmartBuild = {
  models: true,
  subjectModel: true,
  drunetModel: true,
  enhance: true,
  engine: { sky: false, people: false, sam2: false, detector: false, nafnet: false }
}
/** Today's (engine 0.19): SAM 2.1, and the scene and people-parts models with theirs. */
const TODAY: SmartBuild = {
  ...BEFORE,
  samModel: true,
  sceneModel: true,
  partsModel: true,
  engine: { ...BEFORE.engine, sam2: true, sky: true, people: true }
}
const NEXT: SmartBuild = {
  ...TODAY,
  nafnetModel: true,
  engine: { sky: true, people: true, sam2: true, detector: true, nafnet: true, faces: true }
}
const photo = { frameWidth: 6000, frameHeight: 4000 }

/** A smart look written with the words, as the catalog will be. */
function smartOf(...steps: Parameters<typeof look>[3][]): SmartPart {
  const [l] = collection('creative', [
    look('t', 'T', { tags: ['t'] }, tone({ contrast: 5 }), ...steps)
  ])
  return l.smart!
}

const moody = (): SmartPart =>
  smartOf(
    mask(
      'sky',
      'Sky',
      [part.sky(), minus(part.subject())],
      { 'basic.exposure': -0.5 },
      { required: true }
    ),
    mask('warm', 'Warm subject', [part.subject()], { 'wb.temperature': 12 }),
    mask('vignette', 'Edge', [inverted(part.radial([0.5, 0.5], 0.6))], { 'basic.exposure': -0.3 }),
    denoise(40, { scope: 'warm' }),
    denoise(30)
  )

test('before SAM2: what needs the next engine is skipped and said; the rest is planned', () => {
  const plan = planSmart(moody(), smartReadiness(BEFORE), photo)
  assert.equal(plan.complete, false, 'the sky mask is required')
  assert.deepEqual(plan.skipped, [{ name: 'Sky', why: 'needs the next engine update' }])
  assert.deepEqual(
    plan.layers.map((l) => [l.name, l.enabled, l.components.length]),
    [
      ['Warm subject', false, 0],
      ['Edge', true, 1]
    ]
  )
  assert.deepEqual(
    plan.ops.map((o) => o.kind),
    ['segment', 'enable', 'denoise', 'denoise']
  )
  assert.deepEqual(smartBlockers(moody(), smartReadiness(BEFORE)), [
    'Sky: needs the next engine update'
  ])
  assert.deepEqual(smartBlockers(moody(), smartReadiness(NEXT)), [])
})

test('today the scene model finds the sky: planned, no question to the user', () => {
  const plan = planSmart(moody(), smartReadiness(TODAY), photo)
  assert.equal(plan.complete, true)
  assert.deepEqual(plan.skipped, [])
  assert.equal(plan.picks, 0)
  assert.equal(plan.ops[0].kind === 'segment' && plan.ops[0].target, 'sky')
  // Without its model, the sky says what to download; vegetation and water too.
  const missing = smartReadiness({ ...TODAY, sceneModel: false })
  assert.equal(missing.sky, 'needs-model')
  assert.equal(missing.vegetation, 'needs-model')
  assert.equal(missing.water, 'needs-model')
  // Pointing at an object still needs SAM 2.1's.
  assert.equal(smartReadiness({ ...TODAY, samModel: false }).pick, 'needs-model')
})

test('every model part lands before a step scoped to its mask; parts keep their order and joins', () => {
  const plan = planSmart(moody(), smartReadiness(NEXT), photo)
  assert.equal(plan.complete, true)
  assert.deepEqual(plan.skipped, [])
  const kinds = plan.ops.map((o) =>
    o.kind === 'segment' ? `segment:${o.target}:${o.mode}` : o.kind
  )
  assert.deepEqual(kinds, [
    'segment:sky:Add',
    'segment:subject:Subtract',
    'enable',
    'segment:subject:Add',
    'enable',
    'denoise',
    'denoise'
  ])
  const warm = plan.layers.find((l) => l.name === 'Warm subject')!
  const scoped = plan.ops.find((o) => o.kind === 'denoise' && o.layerId !== null)
  assert.ok(scoped && scoped.kind === 'denoise')
  assert.equal(scoped.layerId, warm.id)
  assert.equal(scoped.model, 'nafnet', 'auto takes the quickest model there is')
  // The mask's white is relative, and on.
  assert.equal(warm.settings.wb.mode, 'custom')
  assert.equal(warm.settings.wb.temperature, 12)
})

test('the time estimate counts each model run and the denoise per megapixel', () => {
  const today = planSmart(moody(), smartReadiness(BEFORE), {
    ...photo,
    rates: { drunetMsPerMp: 5000 }
  })
  // One subject segment; two DRUNet denoises over 24 MP at the measured 5 s/MP.
  assert.equal(today.etaMs, SMART_RATES.segmentMs + 2 * 24 * 5000)
  assert.deepEqual(today.summary, [
    'Warm subject mask',
    'Edge mask',
    'AI denoise (DRUNet)',
    'AI denoise (DRUNet)'
  ])
})

test('an object is found by its label, or pointed at without a detector, or skipped without SAM2', () => {
  const s = smartOf(mask('car', 'Car', [part.object('car')], { 'presence.clarity': 20 }))
  const found = planSmart(s, smartReadiness(NEXT), photo)
  assert.deepEqual(
    found.ops.map((o) => (o.kind === 'object' ? `${o.label}:${o.detect}` : o.kind)),
    ['car:true', 'enable']
  )
  assert.equal(found.picks, 0)
  const pick = planSmart(
    s,
    smartReadiness({ ...NEXT, engine: { ...NEXT.engine, detector: false } }),
    photo
  )
  assert.equal(pick.picks, 1)
  assert.equal(pick.ops[0].kind === 'object' && pick.ops[0].detect, false)
  // Today: no detector, so the user points at it.
  const today = planSmart(s, smartReadiness(TODAY), photo)
  assert.equal(today.picks, 1)
  const none = planSmart(s, smartReadiness(BEFORE), photo)
  assert.equal(none.ops.length, 0)
  assert.equal(none.skipped[0].name, 'Car')
})

test('without its mask a scoped step is skipped; without a model a step says which', () => {
  const s = smartOf(mask('eyes', 'Eyes', [part.person('eyes')], {}), denoise(50, { scope: 'eyes' }))
  const plan = planSmart(s, smartReadiness(TODAY), photo)
  assert.deepEqual(plan.skipped, [
    { name: 'Eyes', why: 'needs the next engine update' },
    { name: 'AI denoise', why: 'its mask could not be made' }
  ])
  const noModel = planSmart(
    smartOf(denoise(50, { model: 'drunet' }), deblur(40)),
    smartReadiness({ ...TODAY, drunetModel: false, enhance: false }),
    photo
  )
  assert.deepEqual(
    noModel.skipped.map((x) => x.why),
    ['needs a model: download it in Settings → AI models', 'needs the next engine update']
  )
})

test('ranges and gradients are whole masks at once, and compile', () => {
  const s = smartOf(
    mask(
      'teal',
      'Teal water',
      [
        part.range({ hue: { centre: 190, width: 40, softness: 20 }, smoothness: 20 }),
        within(part.linear([0.5, 1], [0.5, 0.4]))
      ],
      { 'hsl.aqua.saturation': 30, 'colorGrade.shadows.hue': 190, 'detail.noiseLuminance': 40 }
    )
  )
  const plan = planSmart(s, smartReadiness({ ...TODAY, models: false }), photo)
  assert.equal(plan.ops.length, 0)
  const [layer] = plan.layers
  assert.deepEqual(
    layer.components.map((c) => [c.kind, c.mode]),
    [
      ['range', 'Add'],
      ['linear', 'Intersect']
    ]
  )
  assert.equal(layer.settings.hsl.aqua.saturation, 30)
  assert.equal(layer.settings.detail.noiseLuminance, 0, 'noise is not a look’s to set in a mask')
  const recipe = defaultRecipe(false)
  recipe.layers = plan.layers
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
  assert.ok(compile(recipe, ctx).grade)
})

test('a smart look survives a look file; what is not understood is dropped', () => {
  const [l] = collection('creative', [
    look(
      'moody',
      'Moody',
      { tags: ['sky'] },
      tone({ contrast: 10 }),
      mask('sky', 'Sky', [part.sky(), minus(part.subject())], { 'basic.exposure': -0.5 }),
      denoise(40, { scope: 'sky' })
    )
  ])
  const back = lookFromFile(JSON.parse(JSON.stringify(lookToFile(l))), { trusted: true })
  assert.deepEqual(back.look.smart, l.smart)
  assert.deepEqual(back.dropped, [])

  const read = readSmart({
    masks: [
      {
        id: 'a',
        name: 'A',
        parts: [
          { target: { kind: 'sky' }, mode: 'Subtract' },
          { target: { kind: 'teleport' } },
          { target: { kind: 'object', label: '  Car ' }, mode: 'Intersect' }
        ],
        adjust: { 'basic.exposure': -9, 'geometry.crop': 1, 'lens.ca': 2 }
      },
      { id: 'b', name: 'B', parts: [] }
    ],
    steps: [
      { kind: 'denoise', model: 'scunet', strength: 500, scope: 'a' },
      { kind: 'denoise', strength: 20, scope: 'nowhere' },
      { kind: 'upscale', strength: 20 }
    ]
  })
  assert.deepEqual(read.smart, {
    masks: [
      {
        id: 'a',
        name: 'A',
        parts: [
          { target: { kind: 'sky' }, mode: 'Add' },
          { target: { kind: 'object', label: 'car' }, mode: 'Intersect' }
        ],
        adjust: { 'basic.exposure': -5 }
      }
    ],
    steps: [{ kind: 'denoise', model: 'auto', strength: 100, scope: 'a' }]
  })
  assert.deepEqual(read.dropped, [
    'masks.0.parts.1',
    'masks.0.adjust.geometry.crop',
    'masks.0.adjust.lens.ca',
    'masks.1',
    'steps.1',
    'steps.2'
  ])
})

test('readiness follows the build: no models, a missing model, the next engine', () => {
  const none = smartReadiness({ ...TODAY, models: false, enhance: false })
  assert.equal(none.subject, 'needs-engine')
  assert.equal(none.range, 'ready')
  const missing = smartReadiness({ ...TODAY, subjectModel: false })
  assert.equal(missing.subject, 'needs-model')
  assert.equal(missing.background, 'needs-model')
  const before = smartReadiness(BEFORE)
  assert.equal(before.sky, 'needs-engine')
  assert.equal(before.pick, 'needs-engine')
  const today = smartReadiness(TODAY)
  assert.equal(today.sky, 'ready')
  assert.equal(today.pick, 'ready')
  assert.equal(today.object, 'needs-engine')
  assert.equal(today.person, 'ready')
  assert.equal(today.personDetail, 'needs-engine')
  assert.equal(smartReadiness({ ...TODAY, partsModel: false }).person, 'needs-model')
  const next = smartReadiness(NEXT)
  for (const k of ['sky', 'person', 'object', 'pick', 'nafnet'] as const)
    assert.equal(next[k], 'ready')
})

test('the smart catalog: every look reads back whole, and today only the eyes wait', async () => {
  const { LOOKS } = await import('../src/shared/looks/catalog')
  const smart = LOOKS.filter((l) => l.smart)
  assert.ok(smart.length >= 15, `${smart.length} smart looks`)
  for (const l of smart) {
    const back = readSmart(JSON.parse(JSON.stringify(l.smart)))
    assert.deepEqual(back.dropped, [], l.name)
    assert.deepEqual(back.smart, l.smart, l.name)
  }
  const today = smartReadiness(TODAY)
  const waiting = smart.filter((l) => smartBlockers(l.smart!, today).length > 0).map((l) => l.name)
  // Eyes, lips and teeth wait for face parts (Pass 110); skin, hair and clothes are found today.
  assert.deepEqual(waiting.sort(), ['Bright Eyes'])
  // Everything else plans whole today, and nothing waits once the next engine is here.
  for (const l of smart) {
    if (waiting.includes(l.name)) continue
    const plan = planSmart(l.smart!, today, photo)
    // An optional mask of the eyes is left out until face parts; nothing required is.
    const optional = new Set(l.smart!.masks.filter((m) => !m.required).map((m) => m.name))
    assert.deepEqual(
      plan.skipped.filter((x) => !optional.has(x.name)),
      [],
      l.name
    )
  }
  for (const l of smart) assert.deepEqual(smartBlockers(l.smart!, smartReadiness(NEXT)), [], l.name)
})

test('a photo’s masks and AI steps become instructions; what is the photo’s alone is said and left out', async () => {
  const { newLocalLayer, newId } = await import('../src/shared/recipe')
  const { toInstructions } = await import('../src/shared/looks/smart')
  const brush = (source?: unknown): BrushComponent => ({
    id: newId(),
    kind: 'brush' as const,
    mode: 'Add' as const,
    opacity: 100,
    invert: false,
    feather: 0,
    width: 10,
    height: 10,
    png: '',
    ...(source ? { source: source as never } : {})
  })
  const sky = newLocalLayer('Sky')
  sky.components = [
    brush({ kind: 'segment', target: 'sky' }),
    { ...brush({ kind: 'segment', target: 'subject' }), mode: 'Subtract' }
  ]
  sky.settings.basic.exposure = -0.4
  sky.settings.presence.dehaze = 15
  sky.settings.detail.noiseLuminance = 30
  const water = newLocalLayer('Water')
  water.amount = 80
  water.components = [
    {
      id: 'r',
      kind: 'range',
      mode: 'Add',
      opacity: 100,
      invert: false,
      feather: 8,
      hue: { centre: 190, width: 40, softness: 20 },
      saturation: null,
      luma: null,
      smoothness: 10
    },
    {
      id: 'g',
      kind: 'linear',
      mode: 'Intersect',
      opacity: 100,
      invert: false,
      feather: 0,
      start: { x: 0.5, y: 1 },
      end: { x: 0.5, y: 0.5 },
      width: 512,
      height: 341
    }
  ]
  water.settings.wb = { mode: 'custom', temperature: -12, tint: 0, preset: null }
  const painted = newLocalLayer('Dodge')
  painted.components = [brush(), { ...brush({ kind: 'prompt' }), mode: 'Add' }]
  const car = newLocalLayer('Car')
  car.invert = true
  car.components = [brush({ kind: 'prompt', label: 'car' })]
  const off = newLocalLayer('Off')
  off.enabled = false
  off.components = [brush({ kind: 'segment', target: 'subject' })]
  const step = (
    kind: 'denoise' | 'enhance' | 'retouch',
    scope: string | null,
    params: Record<string, string>
  ): PixelStep => ({
    id: newId(),
    kind,
    label: kind,
    blob: 'a'.repeat(64),
    alpha: null,
    scope,
    opacity: 45,
    width: 10,
    height: 10,
    rect: null,
    params
  })
  const out = toInstructions(
    [sky, water, painted, car, off],
    [
      step('denoise', 'Sky', { model: 'drunet-color' }),
      step('denoise', null, { model: 'scunet-color-real' }),
      step('enhance', 'Water', { chain: 'Deblur' }),
      step('enhance', null, { chain: '×2' }),
      step('retouch', null, {}),
      step('denoise', 'Dodge', { model: 'drunet-color' })
    ]
  )
  assert.deepEqual(out.smart!.masks, [
    {
      id: 'm1',
      name: 'Sky',
      parts: [
        { target: { kind: 'sky' }, mode: 'Add' },
        { target: { kind: 'subject' }, mode: 'Subtract' }
      ],
      adjust: { 'basic.exposure': -0.4, 'presence.dehaze': 15 }
    },
    {
      id: 'm2',
      name: 'Water',
      parts: [
        {
          target: { kind: 'range', smoothness: 10, hue: { centre: 190, width: 40, softness: 20 } },
          mode: 'Add'
        },
        {
          target: { kind: 'linear', start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 0.5 } },
          mode: 'Intersect'
        }
      ],
      adjust: { 'wb.temperature': -12 },
      feather: 8,
      amount: 80
    },
    {
      id: 'm3',
      name: 'Car',
      parts: [{ target: { kind: 'object', label: 'car' }, mode: 'Add', invert: true }],
      adjust: {}
    }
  ])
  assert.deepEqual(out.smart!.steps, [
    { kind: 'denoise', model: 'drunet', strength: 45, scope: 'm1' },
    { kind: 'denoise', model: 'auto', strength: 45 },
    { kind: 'deblur', strength: 45, scope: 'm2' }
  ])
  assert.deepEqual(out.kept, [
    'Sky: the sky minus the subject',
    'Water: a colour range within a linear gradient',
    'Car: all but the car',
    'AI denoise in Sky at 45%',
    'AI denoise at 45%',
    'AI deblur in Water'
  ])
  assert.equal(out.warnings.length, 7)
  assert.ok(out.warnings.some((w) => w.startsWith('Sky: 1 setting')))
  assert.ok(out.warnings.some((w) => w === 'Dodge: painted strokes belong to this photo, left out'))
  assert.ok(out.warnings.some((w) => w.includes('has no name to look for')))
  assert.ok(out.warnings.some((w) => w.startsWith('AI denoise in Dodge')))
  // What it made reads back whole, as a look file would carry it.
  assert.deepEqual(readSmart(JSON.parse(JSON.stringify(out.smart))).smart, out.smart)
  assert.deepEqual(toInstructions([], []), { smart: null, kept: [], warnings: [] })
})
