// CoreML's compile cache (engine 0.21.0, OBS-4): a model of one file
// compiled once and kept; refused, it is left off; cleared when the models
// or the engine move on. Measured 2026-10-14 on an M2 Pro: the PIXL
// demosaic's session loads in 1.85 s compiling, 0.46–0.73 s from the cache
// (its 50 MB file hashed in 140–215 ms).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acceleratorTrouble,
  brokenCompile,
  cacheTrouble,
  compilesKeptFor,
  compilesMoved,
  staticPlan,
  withCompileCache
} from '../src/shared/modelshape'
import type { ExecutionProvider } from '../src/shared/engine-types'
import { cpuDetail } from '../src/shared/pixlcpu'

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

// Seen 2026-10-15: two loads of the PIXL demosaic compiling at once, one
// reading the other's package before its Manifest.json was written. It
// raised the CPU question; it is the cache's trouble, tried again instead.
const T = '/var/folders/w2/jy/T/pr-sph-PgmgHn'
const halfWritten = new Error(
  `model failed (load-model): ${T}/models/pixl-demosaic-v1-bayer/1.0.1/pixl_demosaic_v1_bayer.onnx: ` +
    `Error compiling model: Failed to read model package at file://${T}/coreml-cache/` +
    'c31ca11b71f43f8a3a212229bcc1d0f9d63cd157879c8a68dc3bd3db6be99945-8beae5ef962b7d4b/8592514899454107509/0_static_mlprogram/model/. ' +
    `Error: A valid manifest does not exist at path: ${T}/coreml-cache/` +
    'c31ca11b71f43f8a3a212229bcc1d0f9d63cd157879c8a68dc3bd3db6be99945-8beae5ef962b7d4b/8592514899454107509/0_static_mlprogram/model/Manifest.json'
)

test('a compile the cache could not read is named, before the accelerator is blamed', () => {
  assert.equal(
    brokenCompile(halfWritten),
    'c31ca11b71f43f8a3a212229bcc1d0f9d63cd157879c8a68dc3bd3db6be99945-8beae5ef962b7d4b'
  )
  // The same words would otherwise read as the accelerator refusing the model.
  assert.ok(acceleratorTrouble(halfWritten))
  assert.equal(brokenCompile(new Error('load-model: /m/pixl-demosaic-v1-bayer/x.onnx')), null)
  assert.equal(brokenCompile(new Error('could not write /x/coreml-cache/kept-for.json/')), null)
  assert.equal(brokenCompile(null), null)
})

test('the engine’s words in the CPU question lose the app’s folders', () => {
  const s = cpuDetail(halfWritten.message, [T], '/Users/someone')
  assert.ok(!s.includes('/var/folders'))
  assert.ok(!s.includes('file://'))
  assert.ok(s.startsWith('model failed (load-model): …/models/pixl-demosaic-v1-bayer/1.0.1/'))
  assert.ok(s.includes('…/coreml-cache/c31ca11b'))
  assert.equal(
    cpuDetail(
      '/Users/someone/Pictures/a.onnx: refused',
      ['/Users/someone/Library/Application Support/Playroom/'],
      '/Users/someone'
    ),
    '~/Pictures/a.onnx: refused'
  )
  assert.equal(
    cpuDetail(
      '/Users/someone/Library/Application Support/Playroom/models/x.onnx',
      ['/Users/someone/Library/Application Support/Playroom'],
      '/Users/someone'
    ),
    '…/models/x.onnx'
  )
})
