// CoreML's compile cache (engine 0.21.0, OBS-4): a model of one file
// compiled once and kept; refused, it is left off; cleared when the models
// or the engine move on. Measured 2026-10-14 on an M2 Pro: the PIXL
// demosaic's session loads in 1.85 s compiling, 0.46–0.73 s from the cache
// (its 50 MB file hashed in 140–215 ms).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cacheTrouble,
  compilesKeptFor,
  compilesMoved,
  staticPlan,
  withCompileCache
} from '../src/shared/modelshape'
import type { ExecutionProvider } from '../src/shared/engine-types'

const coreml: ExecutionProvider = {
  CoreMl: { units: 'All', format: 'MlProgram', static_shapes: false, low_precision_gpu: false }
}
const one = [{ sha256: 'c31c'.padEnd(64, '0') }]

test('a model of one file on CoreML is compiled once, into the cache', () => {
  const p = withCompileCache(coreml, one, '/cache')
  assert.deepEqual(p, {
    CoreMl: {
      ...(coreml as { CoreMl: object }).CoreMl,
      cache: { dir: '/cache', sha256: one[0].sha256 }
    }
  })
  // With its shape fixed for the GPU (modelshape's static plan), the cache is kept.
  const plan = staticPlan('pixl-demosaic-v1-bayer', ['height', 'width'], coreml)!
  const fixed = withCompileCache(plan.provider, one, '/cache') as {
    CoreMl: { static_shapes: boolean; cache?: unknown }
  }
  assert.equal(fixed.CoreMl.static_shapes, true)
  assert.deepEqual(fixed.CoreMl.cache, { dir: '/cache', sha256: one[0].sha256 })
  // Two graphs (SAM 2.1's encoder and decoder) share one provider: no cache.
  assert.deepEqual(withCompileCache(coreml, [...one, { sha256: 'd'.repeat(64) }], '/cache'), coreml)
  // Not CoreML, or the cache off for the session.
  assert.equal(withCompileCache('Cpu', one, '/cache'), 'Cpu')
  assert.deepEqual(withCompileCache(coreml, one, null), coreml)
})

test('the cache’s own refusal is told from the accelerator’s', () => {
  assert.ok(cacheTrouble({ field: 'raw.demosaic.Model.model.provider.CoreMl.cache.sha256' }))
  assert.ok(
    cacheTrouble({
      message: 'invalid request field `enhance[0].model.provider.CoreMl.cache.dir`: not a directory'
    })
  )
  assert.ok(!cacheTrouble({ field: 'raw.demosaic.noise.noise' }))
  assert.ok(!cacheTrouble(new Error('load-model failed')))
})

test('the compiles go when the models or the engine move on, not before the engine is known', () => {
  const roster = [
    { id: 'pixl-demosaic-v1-bayer', version: '1.0.1' },
    { id: 'nafnet-sidd-w32', version: '1.0.0' }
  ]
  const now = compilesKeptFor(roster, '0.21.0')
  assert.equal(now.roster, 'nafnet-sidd-w32@1.0.0,pixl-demosaic-v1-bayer@1.0.1')
  assert.equal(compilesMoved(null, now).clear, true)
  assert.equal(compilesMoved(now, now).clear, false)
  const bumped = compilesKeptFor(
    roster.map((e) => (e.id === 'nafnet-sidd-w32' ? { ...e, version: '1.0.1' } : e)),
    '0.21.0'
  )
  assert.equal(compilesMoved(now, bumped).clear, true)
  assert.equal(compilesMoved(now, compilesKeptFor(roster, '0.22.0')).clear, true)
  // The engine not up yet: nothing moves, and what it was is kept.
  const early = compilesMoved(now, compilesKeptFor(roster, null))
  assert.equal(early.clear, false)
  assert.equal(early.keep.engine, '0.21.0')
})
