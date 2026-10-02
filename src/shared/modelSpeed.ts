/**
 * How long an AI model takes on this computer, for Settings → AI models,
 * as time for one photo. The best figure first:
 *
 * 1. `runs`: what the model actually took here, remembered from earlier
 *    runs (AI denoise and Enhance keep their speed per megapixel);
 * 2. `test`: the roster's reference time scaled by this computer's speed
 *    test (the test times one model; every model is assumed to keep the
 *    same ratio to its reference);
 * 3. `typical`: the roster's reference time alone (8 CPU threads), until
 *    the test has run.
 */

/** The photo the times are given for: a 24-megapixel camera's. */
export const TYPICAL_MP = 24

/** Reference tiles are 256 × 256 pixels. */
const TILE_MP = (256 * 256) / 1e6

export interface ModelSpeed {
  /** Milliseconds for one photo of `TYPICAL_MP` (one subject mask, for a segmenter). */
  msPerPhoto: number
  basis: 'runs' | 'test' | 'typical'
}

/** The roster's reference time: per 256² tile, or per whole frame (a segmenter). */
export interface Reference {
  tileMs: number | null
  frameMs: number | null
}

/** The time in a roster entry's `measured` note ("… 392 ms per 256² tile …", "180 ms per frame"). */
export function referenceOf(measured: string | undefined): Reference {
  const tile = /(\d+(?:\.\d+)?)\s*ms per 256² tile/.exec(measured ?? '')
  const frame = /(\d+(?:\.\d+)?)\s*ms per frame/.exec(measured ?? '')
  return { tileMs: tile ? Number(tile[1]) : null, frameMs: frame ? Number(frame[1]) : null }
}

/** One reference unit's time: a tile's, else a frame's. */
const unitMs = (r: Reference): number | null => r.tileMs ?? r.frameMs

/**
 * How much slower (above 1) or faster than the reference this computer ran
 * the speed test's model, on the provider it chose; null without a test.
 */
export function testFactor(testMs: number | null, reference: Reference): number | null {
  const ref = unitMs(reference)
  return testMs !== null && testMs > 0 && ref ? testMs / ref : null
}

export function modelSpeed(opts: {
  reference: Reference
  /** Remembered from runs here, ms per megapixel. */
  learnedMsPerMp?: number | null
  /** A first guess in ms per megapixel, for a model the roster has no time for. */
  guessMsPerMp?: number | null
  factor: number | null
}): ModelSpeed | null {
  const { reference: r, learnedMsPerMp, guessMsPerMp, factor } = opts
  if (learnedMsPerMp && learnedMsPerMp > 0)
    return { msPerPhoto: learnedMsPerMp * TYPICAL_MP, basis: 'runs' }
  const k = factor ?? 1
  const basis = factor !== null ? 'test' : 'typical'
  if (r.frameMs !== null) return { msPerPhoto: r.frameMs * k, basis }
  if (r.tileMs !== null) return { msPerPhoto: (r.tileMs / TILE_MP) * TYPICAL_MP * k, basis }
  if (guessMsPerMp && guessMsPerMp > 0) return { msPerPhoto: guessMsPerMp * TYPICAL_MP * k, basis }
  return null
}
