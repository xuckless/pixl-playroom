// A RAW's full-size develop (engine 0.19): DemosaicNet once downloaded, else
// AHD on Bayer, the classic otherwise; PMRID when the edit asks; binned
// thumbnails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RawModels } from '../src/main/ai/rawdevelop'

interface Fake {
  m: RawModels
  fetched: string[]
  refs: { id: string; provider: unknown }[]
}

function fakeModels(have: string[], opts: { runs?: boolean } = {}): Fake {
  const fetched: string[] = []
  const refs: { id: string; provider: unknown }[] = []
  const m: RawModels = {
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
  assert.deepEqual(ok, { value: 1, classic: false })
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
  assert.deepEqual(r, { value: 2, classic: true })
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
