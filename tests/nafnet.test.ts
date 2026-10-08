// Engine 0.19: NAFNet SIDD takes SCUNet's place, on CoreML with static shapes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as pixlModels from '@xuckless/pixl-models'
import { retiredModelDirs } from '../src/main/ai/carryover'

const COREML = {
  CoreMl: { units: 'All', format: 'MlProgram', static_shapes: false, low_precision_gpu: false }
} as const

test('on CoreML, NAFNet runs with H × W fixed to a 512 tile, on the GPU', async () => {
  const { staticPlan } = await import('../src/shared/modelshape')
  const dims = pixlModels.manifest().find((m) => m.id === 'nafnet-sidd-w32')?.files[0].dimensions
  assert.deepEqual(dims, ['height', 'width'], 'the roster names its free dimensions')
  const plan = staticPlan('nafnet-sidd-w32', dims ?? [], COREML)
  assert.deepEqual(plan, {
    provider: {
      CoreMl: {
        units: 'CpuAndGpu',
        format: 'MlProgram',
        static_shapes: true,
        low_precision_gpu: false
      }
    },
    dimensions: [
      { name: 'height', value: 512 },
      { name: 'width', value: 512 }
    ],
    tiling: { Fixed: { width: 512, height: 512, overlap: 32 } }
  })
})

test('the CPU, another model, or another free dimension runs as it is', async () => {
  const { staticPlan } = await import('../src/shared/modelshape')
  assert.equal(staticPlan('nafnet-sidd-w32', ['height', 'width'], 'Cpu'), null)
  assert.equal(
    staticPlan('nafnet-sidd-w32', ['height', 'width'], { DirectMl: { device: 0 } }),
    null
  )
  assert.equal(staticPlan('drunet-color', ['b', 'h', 'w'], COREML), null)
  assert.equal(staticPlan('nafnet-sidd-w32', ['batch', 'height', 'width'], COREML), null)
  assert.equal(staticPlan('nafnet-sidd-w32', [], COREML), null)
})

test('SCUNet, saved anywhere, runs the blind denoiser there is; DRUNet stays', async () => {
  const { aiDenoiseModel, normaliseRecipe, defaultRecipe, NAFNET_DENOISE } =
    await import('../src/shared/recipe')
  // NAFNet SIDD is held back until its fixed export (E55): meanwhile DRUNet.
  const blind = NAFNET_DENOISE ? 'nafnet-sidd-w32' : 'drunet-color'
  assert.equal(aiDenoiseModel('scunet-color-real'), blind)
  assert.equal(aiDenoiseModel('nafnet-sidd-w32'), blind)
  assert.equal(aiDenoiseModel('drunet-color'), 'drunet-color')
  assert.equal(aiDenoiseModel(undefined), blind)
  assert.equal(defaultRecipe(true).detail.ai.model, blind)
  const saved = defaultRecipe(false) as unknown as { detail: { ai: { model: string } } }
  saved.detail.ai.model = 'scunet-color-real'
  assert.equal(normaliseRecipe(saved, false).detail.ai.model, blind)
})

test('SCUNet’s files go from every disk when the update first runs', () => {
  const ids = pixlModels.manifest().map((m) => m.id)
  assert.ok(!ids.includes('scunet-color-real'), 'the roster no longer lists it')
  const r = mkdtempSync(join(tmpdir(), 'scunet-'))
  for (const p of [
    'scunet-color-real/1.0.0/scunet.onnx',
    'nafnet-sidd-w32/1.0.0/nafnet_sidd_w32.onnx'
  ]) {
    mkdirSync(join(r, p, '..'), { recursive: true })
    writeFileSync(join(r, p), 'x')
  }
  return retiredModelDirs(
    r,
    new Map(pixlModels.manifest().map((m) => [m.id, m.version])),
    new Set(pixlModels.onDemand().map((m) => m.id))
  ).then((gone) => assert.deepEqual(gone, ['scunet-color-real']))
})
