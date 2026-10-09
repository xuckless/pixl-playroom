// Cull suggestions (shared/cullsuggest.ts): reasons from the signals, the
// user's word winning, and thresholds learnt from their keeps and rejects.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CullSignals } from '../src/shared/cull'
import type { CullInput } from '../src/shared/cullsuggest'

const sig = (o: {
  lap?: number
  subject?: number | null
  coherence?: number
  p50?: number
  clipLow?: number
  clipHigh?: number
  phash?: string | null
  blink?: [number, number][]
}): CullSignals => ({
  v: 1,
  at: 'T',
  exposure: {
    mean: o.p50 ?? 0.4,
    p1: 0.02,
    p5: 0.05,
    p50: o.p50 ?? 0.4,
    p95: 0.9,
    p99: 0.97,
    clipLow: o.clipLow ?? 0.001,
    clipHigh: o.clipHigh ?? 0.005
  },
  focus: {
    whole: { laplacian: o.lap ?? 0.05, energy: 0.005, coherence: o.coherence ?? 0.1, angle: 0 },
    subject:
      o.subject === undefined || o.subject === null
        ? null
        : { laplacian: o.subject, energy: 0.005, coherence: o.coherence ?? 0.1, angle: 0 },
    subjectShare: o.subject == null ? null : 0.3
  },
  faces: o.blink
    ? o.blink.map(([l, r]) => ({ bounds: [0, 0, 0.1, 0.1], blinkLeft: l, blinkRight: r }))
    : null,
  phash: o.phash === undefined ? null : o.phash,
  ms: 1
})

let next = 1
const photo = (signals: CullSignals | null, o: Partial<CullInput> = {}): CullInput => ({
  photoId: next++,
  name: `IMG_${next}.jpg`,
  rating: 0,
  flag: null,
  keep: false,
  signals,
  ...o
})

test('in a burst: the soft frames and the duplicates of the best, by its words', async () => {
  const { suggestRejects } = await import('../src/shared/cullsuggest')
  const best = photo(sig({ lap: 0.1, subject: 0.1, phash: '0000000000000000' }))
  const soft = photo(sig({ lap: 0.1, subject: 0.018, phash: '0000000000000003' }))
  const shaken = photo(sig({ lap: 0.05, subject: 0.05, coherence: 0.8, phash: '000000000000000f' }))
  const twin = photo(sig({ lap: 0.1, subject: 0.095, phash: '0000000000000001' }))
  const other = photo(sig({ lap: 0.001, phash: 'ffffffffffffffff' }))
  const s = suggestRejects([best, soft, shaken, twin, other])
  assert.equal(s.get(best.photoId), undefined, 'the best of the burst stays')
  assert.deepEqual(s.get(soft.photoId), [
    { kind: 'soft', text: 'Subject soft · focus 18% of the burst’s best' }
  ])
  assert.equal(s.get(shaken.photoId)?.[0].kind, 'motion')
  assert.deepEqual(s.get(twin.photoId), [{ kind: 'duplicate', text: `Duplicate of ${best.name}` }])
  assert.equal(s.get(other.photoId), undefined, 'a soft photo with no burst says nothing on focus')
})

test('the user’s word wins: a star, a pick, Keep or a reject is never suggested', async () => {
  const { suggestRejects } = await import('../src/shared/cullsuggest')
  const dark = (o: Partial<CullInput>): CullInput => photo(sig({ p50: 0.01, clipLow: 0.5 }), o)
  const all = [
    dark({}),
    dark({ rating: 3 }),
    dark({ rating: 1 }),
    dark({ flag: 'pick' }),
    dark({ keep: true }),
    dark({ flag: 'reject' })
  ]
  const s = suggestRejects(all)
  assert.deepEqual([...s.keys()], [all[0].photoId])
  assert.deepEqual(s.get(all[0].photoId), [{ kind: 'dark', text: 'Too dark · 50% crushed' }])
  // In a burst, the marked one is the best even if softer.
  const marked = photo(sig({ lap: 0.01, phash: '0000000000000000' }), { rating: 4 })
  const sharp = photo(sig({ lap: 0.1, phash: '0000000000000001' }))
  const b = suggestRejects([marked, sharp])
  assert.equal(b.get(marked.photoId), undefined)
  assert.deepEqual(
    b.get(sharp.photoId),
    [{ kind: 'duplicate', text: `Duplicate of ${marked.name}` }],
    'sharper, but the user chose the other: a duplicate of it, not soft'
  )
})

test('Keep on a soft frame keeps it, and makes no other frame its duplicate', async () => {
  const { suggestRejects } = await import('../src/shared/cullsuggest')
  const sharp = photo(sig({ lap: 0.1, phash: '0000000000000000' }))
  const kept = photo(sig({ lap: 0.02, phash: '0000000000000000' }), { keep: true })
  const s = suggestRejects([sharp, kept])
  assert.equal(s.size, 0)
})

test('any photo: the subject against its background, exposure, and eyes as a hint', async () => {
  const { suggestRejects } = await import('../src/shared/cullsuggest')
  const backfocus = photo(sig({ lap: 0.1, subject: 0.01 }))
  const blown = photo(sig({ clipHigh: 0.4 }))
  const blink = photo(
    sig({
      blink: [
        [0.1, 0.1],
        [0.91, 0.88]
      ]
    })
  )
  const fine = photo(sig({ lap: 0.1, subject: 0.08, blink: [[0.9, 0.1]] }))
  const unmeasured = photo(null)
  const s = suggestRejects([backfocus, blown, blink, fine, unmeasured])
  assert.equal(s.get(backfocus.photoId)?.[0].text, 'Subject soft · the background is sharper')
  assert.equal(s.get(blown.photoId)?.[0].text, 'Too bright · 40% blown')
  assert.equal(s.get(blink.photoId)?.[0].text, 'Eyes closed? (0.88)')
  assert.equal(s.get(fine.photoId), undefined, 'one eye shut is a wink, not a blink')
  assert.equal(s.get(unmeasured.photoId), undefined)
})

test('thresholds learn from the user’s keeps and rejects, within bounds, once there are enough', async () => {
  const { learnThresholds, samplesOf, fitThreshold, DEFAULT_THRESHOLDS, THRESHOLD_BOUNDS } =
    await import('../src/shared/cullsuggest')
  assert.equal(fitThreshold([1, 2, 3, 4], [0, 0, 0, 0, 0], true, [0, 10]), null, 'too few')
  assert.equal(fitThreshold([5, 6, 7, 8, 9], [1, 2, 3, 4, 4.5], true, [0, 10]), 4.75)
  assert.equal(fitThreshold([5, 6, 7, 8, 9], [1, 2, 3, 4, 4.5], true, [0, 3]), 3, 'bounded')
  // This user keeps darker photos than the default allows, and rejects the very darkest.
  const kept = [0.06, 0.07, 0.08, 0.09, 0.1].map((p50) => photo(sig({ p50 }), { rating: 2 }))
  const rejected = [0.01, 0.015, 0.02, 0.025, 0.03].map((p50) =>
    photo(sig({ p50 }), { flag: 'reject' })
  )
  const t = learnThresholds(samplesOf([...kept, ...rejected, photo(sig({ p50: 0.001 }))]))
  assert.equal(t.darkMedian, 0.045)
  assert.ok(t.darkMedian >= THRESHOLD_BOUNDS.darkMedian[0])
  assert.equal(t.brightBlown, DEFAULT_THRESHOLDS.brightBlown, 'nothing said about it: unchanged')
  assert.deepEqual(learnThresholds([]), DEFAULT_THRESHOLDS)
})
