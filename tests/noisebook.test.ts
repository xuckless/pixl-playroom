import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noiseOfPlanes, statedNoiseFor } from '../src/shared/rawnoise'

const fit = { bins: 25, r2: 0.9 }

test('a frame’s noise is the median of the planes the engine fitted', () => {
  const n = noiseOfPlanes([
    { plane: 'R', k: 3e-4, sigma2: 2e-6, fit },
    { plane: 'Gr', k: 4e-4, sigma2: 1e-5, fit },
    { plane: 'Gb', k: 5e-4, sigma2: 1.2e-5, fit },
    { plane: 'B', k: 9e-4, sigma2: 9e-5, fit: null }
  ])!
  assert.equal(n.k, 4e-4)
  assert.equal(n.sigma2, 1e-5)
  // A stated develop fitted nothing: nothing new to keep.
  assert.equal(noiseOfPlanes([{ plane: 'R', k: 3e-4, sigma2: 2e-6, fit: null }]), null)
})

test('stated noise: this camera at this ISO, else its nearest ISO scaled, else another camera’s', () => {
  const book = {
    'Canon EOS 200D': { '400': { k: 4e-4, sigma2: 1e-5 }, '3200': { k: 3.2e-3, sigma2: 6.4e-4 } },
    'Other Cam': { '100': { k: 1e-4, sigma2: 1e-6 } }
  }
  assert.deepEqual(statedNoiseFor({ camera: 'Canon EOS 200D', iso: 400 }, book)!.noise, {
    k: 4e-4,
    sigma2: 1e-5
  })
  // ISO 800 is nearer 400 than 3200 (in stops): k doubles, σ² four times.
  const s = statedNoiseFor({ camera: 'Canon EOS 200D', iso: 800 }, book)!
  assert.ok(Math.abs(s.noise.k - 8e-4) < 1e-12 && Math.abs(s.noise.sigma2 - 4e-5) < 1e-12)
  assert.match(s.source, /ISO 400, scaled to 800/)
  // A camera never measured: the nearest ISO of any, scaled, and said so.
  const a = statedNoiseFor({ camera: 'Unknown', iso: 200 }, book)!
  assert.match(a.source, /another camera/)
  assert.ok(Math.abs(a.noise.k - 2e-4) < 1e-12)
  // Nothing to go by.
  assert.equal(statedNoiseFor({ camera: 'Canon EOS 200D', iso: null }, book), null)
  assert.equal(statedNoiseFor({ camera: 'x', iso: 100 }, {}), null)
})
