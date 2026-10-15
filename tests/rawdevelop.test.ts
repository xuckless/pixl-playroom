// A RAW's full-size develop (engine 0.19): DemosaicNet once downloaded, else
// AHD on Bayer, the classic otherwise; PMRID when the edit asks; binned
// thumbnails. With an engine development kit's roster, the PIXL demosaic
// (shared/pixldemosaic.ts): alone, under its own tag, the released develop
// standing in when it is refused.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RawModels } from '../src/main/ai/rawdevelop'

interface Fake {
  m: RawModels
  fetched: string[]
  refs: { id: string; provider: unknown }[]
}

function fakeModels(
  have: string[],
  opts: {
    runs?: boolean
    /** The roster's ids besides the released ones (a development kit's PIXL demosaic). */
    offers?: string[]
    /** "Use PIXL demosaic (development)": read at every plan. */
    pixl?: () => boolean
  } = {}
): Fake {
  const fetched: string[] = []
  const refs: { id: string; provider: unknown }[] = []
  const m: RawModels = {
    offered: (id) => (opts.offers ?? []).includes(id),
    pixlDemosaic: async () => (opts.pixl ? opts.pixl() : true),
    installed: async (id) => have.includes(id),
    ref: async (id, provider) => {
      refs.push({ id, provider })
      return { id, provider: provider ?? 'accelerated' }
    },
    withCpuFallback: async (ids, make) => make(new Set()),
    canRun: async () => opts.runs ?? true,
    fetch: (id) => void fetched.push(id)
  }
  return { m, fetched, refs }
}

test('the demosaic: the sensor’s model when there, else AHD on Bayer, else the classic', async () => {
  const { demosaicFor, developTag } = await import('../src/main/ai/rawdevelop')
  assert.equal(demosaicFor('Bayer', true), 'model')
  assert.equal(demosaicFor('Bayer', false), 'ahd')
  assert.equal(demosaicFor('XTrans', true), 'model')
  assert.equal(demosaicFor('XTrans', false), 'classic')
  assert.equal(demosaicFor(null, true), 'classic')
  assert.equal(developTag('model', false), 'dn')
  assert.equal(developTag('ahd', true), 'ahd-pm')
  assert.equal(developTag('classic', false), 'ppg')
})

test('the plan follows what is downloaded and what the edit asks', async () => {
  const { scenePlan, setRawModels } = await import('../src/main/ai/rawdevelop')
  const a = fakeModels(['demosaicnet-bayer'])
  setRawModels(a.m)
  assert.equal((await scenePlan('Bayer')).tag, 'dn')
  // PMRID asked but not downloaded: not in the plan, nor in the file's name.
  assert.equal((await scenePlan('Bayer', { pmrid: true })).tag, 'dn')

  const b = fakeModels(['pmrid'])
  setRawModels(b.m)
  assert.equal((await scenePlan('Bayer', { pmrid: true })).tag, 'ahd-pm')
  // Bayer only: an X-Trans mosaic is refused by the engine.
  assert.equal((await scenePlan('XTrans', { pmrid: true })).tag, 'ppg')
  // The X-Trans model is fetched the first time one opens.
  assert.deepEqual(b.fetched, ['demosaicnet-xtrans'])
  assert.equal((await scenePlan(undefined)).tag, 'ppg')
})

test('without the engine’s model build, nothing learned runs', async () => {
  const { scenePlan, setRawModels } = await import('../src/main/ai/rawdevelop')
  const a = fakeModels(['demosaicnet-bayer', 'pmrid'], { runs: false })
  setRawModels(a.m)
  const p = await scenePlan('Bayer', { pmrid: true })
  assert.equal(p.demosaic, 'ahd')
  assert.equal(p.pmrid, false)
  assert.deepEqual(a.fetched, [])
})

test('a develop runs with the plan’s models, and classic when they are refused', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  const a = fakeModels(['demosaicnet-bayer', 'pmrid'])
  setRawModels(a.m)
  const plan = await scenePlan('Bayer', { pmrid: true })
  const seen: unknown[] = []
  const ok = await withScene(plan, async (scene) => {
    seen.push(scene)
    return 1
  })
  assert.deepEqual(ok, { value: 1, classic: false, ran: 'dn-pm' })
  const first = seen[0] as {
    demosaic: { Model: { id: string } }
    mosaic_denoise: { noise: string }
  }
  assert.equal(first.demosaic.Model.id, 'demosaicnet-bayer')
  assert.equal(first.mosaic_denoise.noise, 'Measured')

  // The engine refuses the model demosaic: the classic develop stands in.
  const scenes: unknown[] = []
  const r = await withScene(plan, async (scene) => {
    scenes.push(scene)
    if (scene.demosaic !== 'Classic')
      throw new Error('raw.demosaic.cfa: the model is for another filter')
    return 2
  })
  assert.deepEqual(r, { value: 2, classic: true, ran: 'ppg' })
  assert.deepEqual(scenes[1], { demosaic: 'Classic', mosaic_denoise: null })

  // Anything else (the file's own trouble) is not hidden by a second try.
  await assert.rejects(
    withScene(plan, async () => {
      throw new Error('ENOSPC: no space left on device')
    }),
    /ENOSPC/
  )
})

test('a model the accelerator won’t load runs on the CPU', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  const a = fakeModels(['demosaicnet-bayer'])
  a.m.withCpuFallback = async (ids, make) => make(new Set(ids))
  setRawModels(a.m)
  await withScene(await scenePlan('Bayer'), async () => 0)
  assert.deepEqual(a.refs.at(-1), { id: 'demosaicnet-bayer', provider: 'Cpu' })
})

test('AHD needs no model, and the classic plan runs plain', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  const a = fakeModels([])
  setRawModels(a.m)
  const scenes: unknown[] = []
  await withScene(await scenePlan('Bayer'), async (s) => void scenes.push(s))
  await withScene(await scenePlan(null), async (s) => void scenes.push(s))
  assert.deepEqual(scenes, [
    { demosaic: 'Ahd', mosaic_denoise: null },
    { demosaic: 'Classic', mosaic_denoise: null }
  ])
  assert.deepEqual(a.refs, [])
})

test('the master carries the chosen demosaic; proxies stay classic', async () => {
  const { rawMaster, rawProxyMaster, rawBinnedMaster } = await import('../src/main/source')
  const plain = rawMaster('container') as { Scene: Record<string, unknown> }
  assert.equal(plain.Scene.demosaic, 'Classic')
  assert.equal(plain.Scene.mosaic_denoise, null)
  const ahd = rawMaster('container', { demosaic: 'Ahd', mosaic_denoise: null }) as {
    Scene: Record<string, unknown>
  }
  assert.equal(ahd.Scene.demosaic, 'Ahd')
  assert.equal(ahd.Scene.resolution, 'Full')
  const cell = rawProxyMaster('container') as { Scene: Record<string, unknown> }
  assert.equal(cell.Scene.demosaic, 'Classic')
  const binned = rawBinnedMaster('container', 4) as { Scene: Record<string, unknown> }
  assert.deepEqual(binned.Scene.resolution, { Binned: { factor: 4 } })
  assert.equal(binned.Scene.demosaic, 'Classic')
})

test('a thumbnail’s bin: the largest multiple of the cell that keeps the edge', async () => {
  const { binFactor } = await import('../src/main/source')
  // A 24 MP Canon (6288 across) for a 1280 frame: 4 (1572).
  assert.equal(binFactor(6288, 2, 1280), 4)
  // X-Trans bins in threes: 3 (2080).
  assert.equal(binFactor(6240, 3, 1280), 3)
  // 102 MP: 8.
  assert.equal(binFactor(11648, 2, 1280), 8)
  // Small sensors: never under the cell.
  assert.equal(binFactor(2000, 2, 1280), 2)
  // Within the engine's 64.
  assert.equal(binFactor(200_000, 3, 1280), 63)
})

test('a linear DNG (Apple ProRAW) is developed with Develop, a mosaic with Scene', async () => {
  const { isLinearRaw, rawMaster } = await import('../src/main/source')
  const dng = (linear: boolean): { input: 'Raw'; dng: { linear: boolean } } =>
    ({ input: 'Raw', dng: { linear } }) as never
  assert.equal(isLinearRaw(dng(true)), true)
  assert.equal(isLinearRaw(dng(false)), false)
  // A CR2 has no DNG description; a TIFF is no RAW, whatever it says.
  assert.equal(isLinearRaw({ input: 'Raw', dng: null }), false)
  assert.equal(isLinearRaw({ input: 'Tiff', dng: { linear: true } } as never), false)
  const scene = { demosaic: 'Classic', mosaic_denoise: null } as const
  assert.ok('Scene' in (rawMaster('container', scene) as object))
  const linear = rawMaster('container', scene, true) as { Develop?: { resolution: unknown } }
  assert.equal(linear.Develop?.resolution, 'Full')
})

test('DemosaicNet runs on CoreML with tiles on the filter’s period', async () => {
  const { staticPlan } = await import('../src/shared/modelshape')
  const coreml = {
    CoreMl: { units: 'All', format: 'MlProgram', static_shapes: false, low_precision_gpu: false }
  } as const
  const bayer = staticPlan('demosaicnet-bayer', ['height', 'width'], coreml)
  assert.deepEqual(bayer?.tiling, { Fixed: { width: 512, height: 512, overlap: 32 } })
  const xtrans = staticPlan('demosaicnet-xtrans', ['height', 'width'], coreml)
  assert.deepEqual(xtrans?.tiling, { Fixed: { width: 516, height: 516, overlap: 36 } })
  assert.deepEqual(xtrans?.dimensions, [
    { name: 'height', value: 516 },
    { name: 'width', value: 516 }
  ])
  assert.equal(staticPlan('demosaicnet-bayer', ['height', 'width'], 'Cpu'), null)
})

test('the RAW data denoise is off unless chosen, and travels with the noise settings', async () => {
  const { defaultRecipe, normaliseRecipe, applyGroups } = await import('../src/shared/recipe')
  assert.equal(defaultRecipe(true).detail.rawDenoise, false)
  const old = { ...defaultRecipe(true), detail: { ...defaultRecipe(true).detail } } as Record<
    string,
    unknown
  >
  delete (old.detail as Record<string, unknown>).rawDenoise
  assert.equal(normaliseRecipe(old, true).detail.rawDenoise, false)
  const from = defaultRecipe(true)
  from.detail.rawDenoise = true
  assert.equal(applyGroups(defaultRecipe(true), from, ['detailNoise']).detail.rawDenoise, true)
  assert.equal(applyGroups(defaultRecipe(true), from, ['detailSharpen']).detail.rawDenoise, false)
})

// ── The PIXL demosaic (an engine development kit's roster) ───────────────────

const PIXL = ['pixl-demosaic-v1-bayer', 'pixl-demosaic-v1-xtrans']

/** `console.error` kept aside while `run` runs: a refusal is said there, once. */
async function errorsOf<T>(run: () => Promise<T>): Promise<{ said: string[]; value: T }> {
  const said: string[] = []
  const was = console.error
  console.error = (...args: unknown[]): void => void said.push(args.map(String).join(' '))
  try {
    return { said, value: await run() }
  } finally {
    console.error = was
  }
}

test('the PIXL demosaic is the plan where it is offered, downloaded and switched on', async () => {
  const { developTag, scenePlan, setRawModels } = await import('../src/main/ai/rawdevelop')
  assert.equal(developTag('pixl', false), 'pd')
  // Never a `-pm` variant: the model denoises as it develops.
  assert.equal(developTag('pixl', true), 'pd')
  // Engine 0.21.0 (E64): a Bayer master moved (red and blue told the greens'
  // line), so it is named anew and 0.20's is made again; X-Trans did not.
  assert.equal(developTag('pixl', false, 'Bayer'), 'pdg')
  assert.equal(developTag('pixl', false, 'XTrans'), 'pd')

  // The released roster (no kit): today's plan, whatever is on disk.
  const released = fakeModels(['demosaicnet-bayer', 'pmrid', ...PIXL])
  setRawModels(released.m)
  assert.equal((await scenePlan('Bayer', { pmrid: true })).tag, 'dn-pm')

  // Offered and downloaded: its own tag, PMRID not stacked even when the edit asks.
  const a = fakeModels(['demosaicnet-bayer', 'demosaicnet-xtrans', 'pmrid', ...PIXL], {
    offers: PIXL
  })
  setRawModels(a.m)
  const p = await scenePlan('Bayer', { pmrid: true })
  assert.equal(p.demosaic, 'pixl')
  assert.equal(p.pmrid, false)
  assert.equal(p.tag, 'pdg')
  // What stands in if it is refused: the plan without it.
  assert.deepEqual(p.then, { cfa: 'Bayer', demosaic: 'model', pmrid: true, tag: 'dn-pm' })
  assert.equal((await scenePlan('XTrans')).tag, 'pd')
  assert.equal((await scenePlan(null)).tag, 'ppg')
  assert.deepEqual(a.fetched, [])

  // Offered, not downloaded yet: today's plan meanwhile, the model asked for once a run.
  const b = fakeModels(['demosaicnet-bayer'], { offers: PIXL })
  setRawModels(b.m)
  assert.equal((await scenePlan('Bayer')).tag, 'dn')
  assert.equal((await scenePlan('Bayer')).tag, 'dn')
  assert.deepEqual(b.fetched, ['pixl-demosaic-v1-bayer'])
  // Its X-Trans one beside DemosaicNet's, each when a Fujifilm RAW first opens.
  assert.equal((await scenePlan('XTrans')).tag, 'ppg')
  assert.deepEqual(b.fetched, [
    'pixl-demosaic-v1-bayer',
    'demosaicnet-xtrans',
    'pixl-demosaic-v1-xtrans'
  ])

  // The engine without its model build: nothing learned, the PIXL demosaic included.
  const c = fakeModels(['demosaicnet-bayer', ...PIXL], { offers: PIXL, runs: false })
  setRawModels(c.m)
  assert.equal((await scenePlan('Bayer')).tag, 'ahd')
})

test('the PIXL demosaic’s switch off is today’s develop', async () => {
  const { scenePlan, setRawModels } = await import('../src/main/ai/rawdevelop')
  let on = false
  const a = fakeModels(['demosaicnet-bayer', 'pmrid', ...PIXL], { offers: PIXL, pixl: () => on })
  setRawModels(a.m)
  assert.equal((await scenePlan('Bayer')).tag, 'dn')
  assert.equal((await scenePlan('Bayer', { pmrid: true })).tag, 'dn-pm')
  assert.equal((await scenePlan('XTrans')).demosaic, 'classic')
  on = true
  assert.equal((await scenePlan('Bayer', { pmrid: true })).tag, 'pdg')
})

test('a PIXL demosaic develop runs its model alone, PMRID never before it', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  for (const [cfa, id] of [
    ['Bayer', 'pixl-demosaic-v1-bayer'],
    ['XTrans', 'pixl-demosaic-v1-xtrans']
  ] as const) {
    const a = fakeModels(['demosaicnet-bayer', 'demosaicnet-xtrans', 'pmrid', ...PIXL], {
      offers: PIXL
    })
    setRawModels(a.m)
    const seen: unknown[] = []
    const done = await withScene(await scenePlan(cfa, { pmrid: true }), async (scene) => {
      seen.push(scene)
      return cfa
    })
    assert.deepEqual(done, { value: cfa, classic: false, ran: cfa === 'Bayer' ? 'pdg' : 'pd' })
    assert.deepEqual(seen, [
      { demosaic: { Model: { id, provider: 'accelerated' } }, mosaic_denoise: null }
    ])
    assert.deepEqual(
      a.refs.map((r) => r.id),
      [id]
    )
  }
})

test('a refused PIXL demosaic says so, and the released develop stands in', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  let on = true
  const a = fakeModels(['demosaicnet-bayer', 'pmrid', ...PIXL], { offers: PIXL, pixl: () => on })
  setRawModels(a.m)
  const plan = await scenePlan('Bayer', { pmrid: true })
  assert.equal(plan.tag, 'pdg')
  const scenes: { demosaic: unknown; mosaic_denoise: unknown }[] = []
  const { said, value: done } = await errorsOf(() =>
    withScene(plan, async (scene) => {
      scenes.push(scene)
      const model = (scene.demosaic as { Model?: { id: string } }).Model?.id
      // The model's own trouble (the engine's `Model` error): planned around for the run.
      if (model === 'pixl-demosaic-v1-bayer')
        throw Object.assign(new Error('model pixl-demosaic-v1-bayer: the session failed to load'), {
          code: 'Model'
        })
      return 7
    })
  )
  // Today's learned develop, PMRID with it as the edit asked: not the plan's, so not kept as it.
  assert.equal(done.value, 7)
  assert.equal(done.classic, true)
  assert.equal(done.ran, 'dn-pm')
  assert.match(done.refused ?? '', /session failed to load.*\[Model\]/)
  assert.equal(scenes.length, 2)
  assert.equal((scenes[1].demosaic as { Model: { id: string } }).Model.id, 'demosaicnet-bayer')
  assert.notEqual(scenes[1].mosaic_denoise, null)
  // One line, with the model, the engine's message and its code.
  assert.equal(said.length, 1)
  assert.match(said[0], /pixl-demosaic-v1-bayer/)
  assert.match(said[0], /session failed to load/)
  assert.match(said[0], /\[Model\]/)

  // Planned around from then on (a 1:1 view would develop it again each time)…
  assert.equal((await scenePlan('Bayer', { pmrid: true })).tag, 'dn-pm')
  // …the other sensor's model untouched…
  assert.equal((await scenePlan('XTrans')).tag, 'pd')
  // …until its switch goes off and on.
  on = false
  assert.equal((await scenePlan('Bayer')).tag, 'dn')
  on = true
  assert.equal((await scenePlan('Bayer')).tag, 'pdg')
})

test('X-Trans: the PIXL demosaic is refused for its noise, DemosaicNet develops', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  const { acceleratorTrouble } = await import('../src/shared/modelshape')
  // The engine's refusal as Playroom gets it (an EngineError: message, code, the field named),
  // in 20 ms, until the addon reads an X-Trans mosaic's noise.
  const refusal = Object.assign(
    new Error(
      'invalid request field `raw.demosaic.noise.noise`: MosaicNoise::Measured reads a Bayer mosaic’s four planes, and this sensor’s filter is `XTrans` — state the noise (MosaicNoise::Stated), or use a DNG’s NoiseProfile'
    ),
    { code: 'InvalidRequest', field: 'raw.demosaic.noise.noise' }
  )
  // Not the accelerator's trouble: the CPU is not tried. A model CoreML won't load still is.
  assert.equal(acceleratorTrouble(refusal), false)
  assert.equal(acceleratorTrouble(new Error('load-model: /m/pixl-demosaic-v1-xtrans/x.onnx')), true)
  assert.equal(acceleratorTrouble(new Error('the CoreML provider is not in this build')), true)
  const static576 = Object.assign(new Error('provider: static shapes'), {
    code: 'InvalidRequest',
    field: 'raw.demosaic.model.provider'
  })
  assert.equal(acceleratorTrouble(static576), true)

  const a = fakeModels(['demosaicnet-xtrans', 'pmrid', ...PIXL], { offers: PIXL })
  // The store's fallback, as it decides: to the CPU only for the accelerator's trouble.
  const movedToCpu: string[] = []
  a.m.withCpuFallback = async (ids, make) => {
    const onCpu = new Set<string>()
    for (;;) {
      try {
        return await make(onCpu)
      } catch (err) {
        const left = ids.filter((id) => !onCpu.has(id))
        if (!acceleratorTrouble(err) || left.length === 0) throw err
        for (const id of left) {
          onCpu.add(id)
          movedToCpu.push(id)
        }
      }
    }
  }
  setRawModels(a.m)
  // PMRID is Bayer's: asked or not, an X-Trans plan has none.
  const plan = await scenePlan('XTrans', { pmrid: true })
  assert.equal(plan.tag, 'pd')
  assert.deepEqual(plan.then, { cfa: 'XTrans', demosaic: 'model', pmrid: false, tag: 'dn' })

  const ran: string[] = []
  const { said, value: done } = await errorsOf(() =>
    withScene(plan, async (scene) => {
      const id = (scene.demosaic as { Model: { id: string } }).Model.id
      ran.push(id)
      assert.equal(scene.mosaic_denoise, null)
      if (id === 'pixl-demosaic-v1-xtrans') throw refusal
      return id
    })
  )
  // Asked once, on the accelerator; then today's learned develop, once.
  assert.deepEqual(ran, ['pixl-demosaic-v1-xtrans', 'demosaicnet-xtrans'])
  assert.deepEqual(movedToCpu, [])
  assert.deepEqual(
    a.refs.map((r) => r.provider),
    [undefined, undefined]
  )
  // DemosaicNet's picture, said to be a stand-in: `ensureMaster` keeps no record of it as the
  // `pd` master (it writes one only when `classic` is false), so it is never read back as one.
  assert.equal(done.value, 'demosaicnet-xtrans')
  assert.equal(done.classic, true)
  assert.equal(done.ran, 'dn')
  // The one line: the model, that it was refused, and the engine's reason and code.
  assert.equal(said.length, 1)
  assert.match(said[0], /pixl-demosaic-v1-xtrans/)
  assert.match(said[0], /refused/)
  assert.match(said[0], /raw\.demosaic\.noise\.noise/)
  assert.match(said[0], /MosaicNoise::Measured reads a Bayer mosaic/)
  assert.match(said[0], /\[InvalidRequest\]/)

  assert.equal(done.photoOnly, true)
  // The frame's noise is that photo's trouble, by the field the engine named (the 0.20.0
  // audit's B1): the next Fujifilm RAW is still the PIXL demosaic's, as a Bayer RAW is
  // (ensureMaster keeps the stand-in for the run, so the 1:1 view does not ask again).
  assert.equal((await scenePlan('XTrans')).tag, 'pd')
  assert.equal((await scenePlan('Bayer')).tag, 'pdg')
})

test('a refusal is the model’s or the file’s by the engine’s code and field, not its words', async () => {
  const { modelTrouble, noiseUnread } = await import('../src/main/ai/rawdevelop')
  const { CpuDeclined } = await import('../src/shared/pixlcpu')
  const err = (message: string, extra: object): Error => Object.assign(new Error(message), extra)
  assert.equal(modelTrouble(err('the model file is damaged', { code: 'Model' })), true)
  assert.equal(
    modelTrouble(err('bad tile', { code: 'InvalidRequest', field: 'raw.demosaic.input' })),
    true
  )
  assert.equal(
    modelTrouble(
      err('x', {
        code: 'InvalidRequest',
        detail: { InvalidRequest: { field: 'raw.mosaic_denoise' } }
      })
    ),
    true
  )
  // A decode that mentions a model is still the file's.
  assert.equal(modelTrouble(err('the camera model is not supported', { code: 'Decode' })), false)
  assert.equal(modelTrouble(err('bad', { code: 'InvalidRequest', field: 'raw.white' })), false)
  assert.equal(modelTrouble(new CpuDeclined()), true)
  assert.equal(
    noiseUnread(err('x', { code: 'InvalidRequest', field: 'raw.demosaic.noise.noise' })),
    true
  )
  assert.equal(
    noiseUnread(err('x', { code: 'InvalidRequest', field: 'raw.demosaic.input' })),
    false
  )
  // Engine 0.21's words, for an error without a field (E64): the greens have no line, or a
  // filter that is neither Bayer nor X-Trans.
  assert.equal(
    noiseUnread(
      err(
        "the frame's noise cannot be read: the green planes have too few flat tiles — state it with MosaicNoise::Stated",
        {}
      )
    ),
    true
  )
  assert.equal(
    noiseUnread(
      err(
        'a measured noise (MosaicNoise::Measured, MeasuredFloor, MeasuredGreenFloor) reads a Bayer mosaic’s four planes or an X-Trans mosaic’s green blocks, and this sensor’s filter is `Other` — state the noise (MosaicNoise::Stated), or use a DNG’s NoiseProfile',
        {}
      )
    ),
    true
  )
})

test('under 0.21’s MeasuredGreenFloor the frame’s noise is the greens’ line', async () => {
  const { noiseOfPlanes } = await import('../src/shared/rawnoise')
  // A Bayer develop's noise_planes: Gr and Gb carry the fit, R and B were told green's line.
  const fit = { tiles: 40 }
  const n = noiseOfPlanes([
    { plane: 'R', k: 9e-4, sigma2: 8e-6, fit: null },
    { plane: 'Gr', k: 3e-4, sigma2: 2e-6, fit },
    { plane: 'Gb', k: 5e-4, sigma2: 4e-6, fit },
    { plane: 'B', k: 9e-4, sigma2: 8e-6, fit: null }
  ])
  assert.ok(n)
  assert.ok(Math.abs(n.k - 4e-4) < 1e-12)
  assert.ok(Math.abs(n.sigma2 - 3e-6) < 1e-15)
})

test('a "no" to the processor: the develop of before, by choice, and PIXL planned around', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  const { CpuDeclined } = await import('../src/shared/pixlcpu')
  let declined = false
  const a = fakeModels(['demosaicnet-bayer', ...PIXL], { offers: PIXL })
  a.m.pixlDeclined = async () => declined
  setRawModels(a.m)
  const plan = await scenePlan('Bayer')
  assert.equal(plan.tag, 'pdg')
  const { said, value: done } = await errorsOf(() =>
    withScene(plan, async (scene) => {
      const id = (scene.demosaic as { Model?: { id: string } }).Model?.id
      if (id === 'pixl-demosaic-v1-bayer') throw new CpuDeclined()
      return id
    })
  )
  assert.equal(done.value, 'demosaicnet-bayer')
  assert.equal(done.declined, true)
  assert.equal(done.refused, undefined)
  assert.deepEqual(said, [], 'a choice, not a refusal: nothing on the console')
  declined = true
  assert.equal((await scenePlan('Bayer')).tag, 'dn')
})

test('a PIXL demosaic refused, then DemosaicNet refused: the classic, as before', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  const a = fakeModels(['demosaicnet-bayer', ...PIXL], { offers: PIXL })
  setRawModels(a.m)
  const plan = await scenePlan('Bayer')
  const order: unknown[] = []
  const { said, value: done } = await errorsOf(() =>
    withScene(plan, async (scene) => {
      order.push(scene.demosaic === 'Classic' ? 'Classic' : 'Model')
      if (scene.demosaic !== 'Classic') throw new Error('raw.demosaic.cfa: another filter')
      return 0
    })
  )
  assert.deepEqual(order, ['Model', 'Model', 'Classic'])
  assert.equal(done.classic, true)
  assert.equal(done.ran, 'ppg')
  assert.equal(said.length, 1)

  // The file's own trouble is not hidden by a second try, and is said too.
  setRawModels(a.m)
  const again = await scenePlan('Bayer')
  const failed = await errorsOf(() =>
    assert.rejects(
      withScene(again, async () => {
        throw new Error('ENOSPC: no space left on device')
      }),
      /ENOSPC/
    )
  )
  assert.equal(failed.said.length, 1)
  assert.match(failed.said[0], /ENOSPC/)
  assert.equal((await scenePlan('Bayer')).tag, 'pdg')
})

test('with a development kit the PIXL and DemosaicNet masters stay side by side', async () => {
  const { keptMasterTags } = await import('../src/main/ai/rawdevelop')
  // As released: a develop's own masters, with and without PMRID.
  assert.deepEqual(keptMasterTags('dn', false), ['dn', 'dn-pm'])
  assert.deepEqual(keptMasterTags('dn-pm', false), ['dn', 'dn-pm'])
  assert.deepEqual(keptMasterTags('pd', false), ['pd', 'pd-pm'])
  assert.deepEqual(keptMasterTags('ahd-pm', false), ['ahd', 'ahd-pm'])
  // A Bayer PIXL develop's own; 0.20's `pd` beside it goes (made again).
  assert.deepEqual(keptMasterTags('pdg', false), ['pdg', 'pdg-pm'])
  // With a kit: flipping the switch develops nothing again; the quick `ppg` still goes.
  for (const tag of ['pd', 'pdg', 'dn', 'dn-pm']) {
    const kept = keptMasterTags(tag, true)
    for (const k of ['pd', 'pdg', 'dn', 'dn-pm']) assert.ok(kept.includes(k), `${tag} keeps ${k}`)
    assert.ok(!kept.includes('ppg'))
  }
  assert.ok(keptMasterTags('ahd', true).includes('pd'))
})

test('the PIXL demosaic runs on CoreML with its roster’s 576 tiles', async () => {
  const { staticPlan } = await import('../src/shared/modelshape')
  const coreml = {
    CoreMl: { units: 'All', format: 'MlProgram', static_shapes: false, low_precision_gpu: false }
  } as const
  const bayer = staticPlan('pixl-demosaic-v1-bayer', ['height', 'width'], coreml)
  assert.deepEqual(bayer?.tiling, { Fixed: { width: 576, height: 576, overlap: 32 } })
  // The graphics chip, with its shape fixed.
  const onGpu = { units: 'CpuAndGpu', format: 'MlProgram', static_shapes: true }
  assert.deepEqual(bayer?.provider, { CoreMl: { ...onGpu, low_precision_gpu: false } })
  const xtrans = staticPlan('pixl-demosaic-v1-xtrans', ['height', 'width'], coreml)
  assert.deepEqual(xtrans?.tiling, { Fixed: { width: 576, height: 576, overlap: 48 } })
  assert.deepEqual(xtrans?.dimensions, [
    { name: 'height', value: 576 },
    { name: 'width', value: 576 }
  ])
  // A window starts on the filter's period: the core (the side less twice the overlap) and
  // the overlap are multiples of 2 (Bayer) and 6 (X-Trans).
  assert.equal((576 - 2 * 32) % 2, 0)
  assert.equal((576 - 2 * 48) % 6, 0)
  assert.equal(48 % 6, 0)
  assert.equal(staticPlan('pixl-demosaic-v1-bayer', ['height', 'width'], 'Cpu'), null)
})

test('the panels know when the PIXL demosaic is a photo’s develop', async () => {
  const { offersPixlDemosaic, pixlDemosaicActive } = await import('../src/shared/pixldemosaic')
  const { DEFAULT_SWITCHES, readSwitches } = await import('../src/shared/heavy')
  const kit = [
    { id: 'demosaicnet-bayer', installed: true },
    { id: 'pixl-demosaic-v1-bayer', installed: true },
    { id: 'pixl-demosaic-v1-xtrans', installed: false }
  ]
  assert.equal(offersPixlDemosaic(kit), true)
  assert.equal(offersPixlDemosaic([{ id: 'demosaicnet-bayer' }]), false)
  // "Denoise the RAW data" is hidden exactly then: offered, downloaded, switched on.
  assert.equal(pixlDemosaicActive('Bayer', kit, true), true)
  assert.equal(pixlDemosaicActive('Bayer', kit, false), false)
  assert.equal(pixlDemosaicActive('XTrans', kit, true), false)
  assert.equal(pixlDemosaicActive(null, kit, true), false)
  const releasedList = [{ id: 'demosaicnet-bayer', installed: true }]
  assert.equal(pixlDemosaicActive('Bayer', releasedList, true), false)
  // The switch is on unless turned off.
  assert.equal(DEFAULT_SWITCHES.pixlDemosaic, true)
  assert.equal(readSwitches({}).pixlDemosaic, true)
  assert.equal(readSwitches({ pixlDemosaic: false }).pixlDemosaic, false)
})

test('a development kit’s run says what developed a master, where and how long', async () => {
  const { developedConsoleLine, developedNote, providerName } = await import('../src/main/devkit')
  const gpu = providerName({
    CoreMl: {
      units: 'CpuAndGpu',
      format: 'MlProgram',
      static_shapes: true,
      low_precision_gpu: false
    }
  })
  assert.equal(gpu, 'CoreMl (CpuAndGpu, static shapes)')
  assert.equal(providerName('Cpu'), 'Cpu')
  assert.equal(providerName(null), 'no model')
  const ok = { planned: 'pd', ran: 'pd', provider: gpu, ms: 8412 }
  assert.equal(developedConsoleLine(ok), `[dev kit] RAW master pd · ${gpu} · 8412 ms`)
  assert.equal(developedNote(ok), 'PIXL demosaic · 8.4 s')
  const stood = { ...ok, ran: 'dn', ms: 5200, refused: 'no [InvalidRequest]' }
  assert.match(developedConsoleLine(stood), /RAW master dn \(planned pd: no \[InvalidRequest\]\)/)
  // The user is told in the engine's words.
  assert.equal(
    developedNote(stood),
    'PIXL demosaic was refused for this photo, so DemosaicNet developed it: no [InvalidRequest]'
  )
  assert.match(developedNote({ ...stood, declined: true }), /kept off the processor/)
})

test('a frame whose noise cannot be read is told its camera’s measured noise; the model stays planned', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  setRawModels(fakeModels(['demosaicnet-bayer', 'pmrid', ...PIXL], { offers: PIXL }).m)
  const plan = await scenePlan('Bayer')
  assert.equal(plan.tag, 'pdg')
  const unread = Object.assign(
    new Error(
      'invalid request field `raw.demosaic.noise.noise`: the frame’s noise cannot be read: the B plane has 2 brightness levels with enough flat area — state it with MosaicNoise::Stated'
    ),
    { code: 'InvalidRequest' }
  )
  type Told = { Model?: { id: string; noise?: { Map: { noise: unknown } } } }
  const stated = (scene: { demosaic: unknown }): { k: number; sigma2: number } | null =>
    ((scene.demosaic as Told).Model?.noise?.Map.noise as { Stated?: { k: number; sigma2: number } })
      ?.Stated ?? null
  // Frames it reads: their planes are kept for the camera at ISO 400 and 3200
  // (0.21.0's MeasuredGreenFloor: red and blue carry no fit of their own).
  const fit = { bins: 25, r2: 0.9 }
  const readAt = async (iso: number, k: number, sigma2: number): Promise<boolean> =>
    (
      await withScene(
        plan,
        async () => ({
          raw: {
            demosaic_model: {
              noise_planes: [
                { plane: 'R', k, sigma2, fit: null },
                { plane: 'Gr', k, sigma2, fit },
                { plane: 'Gb', k, sigma2, fit },
                { plane: 'B', k, sigma2, fit: null }
              ]
            }
          }
        }),
        undefined,
        { camera: 'Canon Test', iso }
      )
    ).classic
  assert.equal(await readAt(400, 4e-4, 1e-5), false)
  // One ISO alone is not enough for a sibling at another: the released develop, and why.
  const { said: early, value: alone } = await errorsOf(() =>
    withScene(
      plan,
      async (scene) => {
        if ((scene.demosaic as Told).Model?.id?.startsWith('pixl-')) throw unread
        return 'dn'
      },
      undefined,
      { camera: 'Canon Test', iso: 800 }
    )
  )
  assert.equal(alone.classic, true)
  assert.equal(alone.photoOnly, true)
  assert.match(alone.refused ?? '', /no noise measured here at ISO 800.*not borrowed/)
  assert.equal(early.length, 1)
  assert.equal(await readAt(3200, 3.2e-3, 3e-4), false)
  // A sibling at ISO 800 it cannot read: developed again with the noise stated, fitted.
  const told: ({ k: number; sigma2: number } | null)[] = []
  const done = await withScene(
    plan,
    async (scene) => {
      const s = stated(scene)
      told.push(s)
      if (!s) throw unread
      return 'pd'
    },
    undefined,
    { camera: 'Canon Test', iso: 800 }
  )
  assert.equal(done.value, 'pd')
  assert.equal(done.classic, false)
  assert.equal(done.ran, 'pdg')
  assert.equal(done.statedFrom, 'Canon Test, fitted over ISO 400, 3200')
  assert.equal(told.length, 2)
  const a = (3e-4 - 1e-5) / (3200 ** 2 - 400 ** 2)
  const b = 1e-5 - a * 400 ** 2
  assert.ok(Math.abs(told[1]!.k - 8e-4) < 1e-12)
  assert.ok(Math.abs(told[1]!.sigma2 - (a * 800 ** 2 + b)) < 1e-12)
  // Another camera's measurements are never borrowed.
  const other = await errorsOf(() =>
    withScene(
      plan,
      async (scene) => {
        if ((scene.demosaic as Told).Model?.id?.startsWith('pixl-')) throw unread
        return 'dn'
      },
      undefined,
      { camera: 'Never Seen', iso: 400 }
    )
  )
  assert.equal(other.value.classic, true)
  assert.equal(other.value.statedFrom, undefined)

  // Nothing to state (no ISO): this photo falls back, said once…
  const { said, value: fell } = await errorsOf(() =>
    withScene(
      plan,
      async (scene) => {
        if ((scene.demosaic as Told).Model?.id?.startsWith('pixl-')) throw unread
        return 'dn'
      },
      undefined,
      { camera: 'Canon Test', iso: null }
    )
  )
  assert.equal(fell.classic, true)
  assert.match(said[0], /for this photo/)
  // …and every other photo still gets the PIXL demosaic.
  assert.equal((await scenePlan('Bayer')).tag, 'pdg')
})
