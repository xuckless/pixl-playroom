import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, type CompileContext } from '../src/shared/compile'
import { defaultRecipe } from '../src/shared/recipe'
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

/** Today's published build: U²-Net, DRUNet and Enhance; no sky, people, SAM2, detector or NAFNet. */
const TODAY: SmartBuild = {
  models: true,
  subjectModel: true,
  drunetModel: true,
  enhance: true,
  engine: { sky: false, people: false, sam2: false, detector: false, nafnet: false }
}
const NEXT: SmartBuild = {
  ...TODAY,
  engine: { sky: true, people: true, sam2: true, detector: true, nafnet: true }
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

test('today: what needs the next engine is skipped and said; the rest is planned', () => {
  const plan = planSmart(moody(), smartReadiness(TODAY), photo)
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
  assert.deepEqual(smartBlockers(moody(), smartReadiness(TODAY)), [
    'Sky: needs the next engine update'
  ])
  assert.deepEqual(smartBlockers(moody(), smartReadiness(NEXT)), [])
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
  const today = planSmart(moody(), smartReadiness(TODAY), {
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
  const none = planSmart(s, smartReadiness(TODAY), photo)
  assert.equal(none.ops.length, 0)
  assert.equal(none.skipped[0].name, 'Car')
})

test('without its mask a scoped step is skipped; without a model a step says which', () => {
  const s = smartOf(mask('skin', 'Skin', [part.person('skin')], {}), denoise(50, { scope: 'skin' }))
  const plan = planSmart(s, smartReadiness(TODAY), photo)
  assert.deepEqual(plan.skipped, [
    { name: 'Skin', why: 'needs the next engine update' },
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
  const today = smartReadiness(TODAY)
  assert.equal(today.sky, 'needs-engine')
  assert.equal(today.pick, 'needs-engine')
  const next = smartReadiness(NEXT)
  for (const k of ['sky', 'person', 'object', 'pick', 'nafnet'] as const)
    assert.equal(next[k], 'ready')
})

test('the smart catalog: every look reads back whole, and today only sky, people and objects wait', async () => {
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
  assert.deepEqual(waiting.sort(), [
    'Blue Sky Pop',
    'Bright Eyes',
    'Car Shine',
    'Golden Hour Skin',
    'Moody Sky',
    'Portrait Polish',
    'Rain City Noir Lift'
  ])
  // Everything else plans whole today, and nothing waits once the next engine is here.
  for (const l of smart) {
    if (waiting.includes(l.name)) continue
    const plan = planSmart(l.smart!, today, photo)
    assert.deepEqual(plan.skipped, [], l.name)
  }
  for (const l of smart) assert.deepEqual(smartBlockers(l.smart!, smartReadiness(NEXT)), [], l.name)
})
