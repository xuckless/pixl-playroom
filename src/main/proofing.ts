/**
 * The renders behind the Metrics tab's gamut coverage (E76's
 * chromaticity): beside the picture, from the same grade, made only to be
 * measured. Built here, apart from the session (render.ts), so the tests
 * can send them to the engine.
 */
import type { ConvertRequest, Measure, SourceInfo } from '../shared/engine-types'
import type { Compiled } from '../shared/compile'
import { blankRequest, displayPolicy } from './source'
import type { ProxyFile } from './proxy'

type Graded = Pick<Compiled, 'grade' | 'framing' | 'lens' | 'retouch'>

/** The gamut coverage's u′v′ density, cells a side (0.0025 each over the engine's 0…0.65). */
export const COVERAGE_SIZE = 256

/**
 * The gamut coverage's render: the SDR picture's grade, its float buffer
 * measured before the egress (`at: 'Working'`, linear PixlRGB) for its u′v′
 * density, so colours past the screen's gamut count where they really are.
 * Its pixels are only a byproduct: a small frame, left in the engine's
 * host. A warp's empty corners are left out. A photo with no grade has no
 * float buffer (the engine refuses by `measure.at`): its proxy, the picture
 * then, is measured as it is instead (render.ts `gamutCoverage`).
 */
export function coverageRequest(
  src: Pick<ProxyFile, 'path' | 'input'>,
  info: SourceInfo,
  graded: Graded,
  transparent: boolean,
  threads: number
): ConvertRequest {
  const measure: Measure = {
    at: 'Working',
    domain: 'Linear',
    bins: 16,
    percentiles: [],
    clip_low: 0,
    clip_high: 1,
    hue_bins: 1,
    stride: 1,
    transparent: 'Exclude',
    noise: false,
    scopes: { chromaticity: { size: COVERAGE_SIZE } }
  }
  return {
    ...blankRequest(src.path, '', src.input),
    sink: 'Bytes',
    pixel: { depth: 'Eight', channels: transparent ? 4 : 3 },
    encode: { Pixels: { sample: 'U8' } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: displayPolicy(info, 'DisplayP3'),
    grade: graded.grade,
    framing: graded.framing,
    lens: graded.lens,
    retouch: graded.retouch,
    threads,
    measure
  }
}
