/**
 * Scope maths shared by the renderer's charts and the tests.
 *
 * An HDR measurement comes back as linear-light bins over `0…range_max`
 * (1.0 is reference white). Drawn as is, everything below mid grey crowds
 * into the first few percent of the axis; drawn in stops, shadows, midtones
 * and the headroom above white each get room.
 */

/** The darkest stop the HDR histogram shows, relative to reference white. */
export const HDR_FLOOR_STOPS = -8

/** Where `v` (linear, 1.0 = reference white) sits on a stops axis, 0…1. */
export function stopsX(v: number, rangeMax: number, floor = HDR_FLOOR_STOPS): number {
  const top = Math.log2(Math.max(rangeMax, 1))
  if (v <= 0 || top <= floor) return 0
  return Math.min(1, Math.max(0, (Math.log2(v) - floor) / (top - floor)))
}

/**
 * Re-bin linear counts over `0…rangeMax` onto `out` bins spaced in stops from
 * `floor` up to `log2(rangeMax)`. Each source bin's count is spread over the
 * display bins its range covers, so the total is kept; everything at or
 * below the floor lands in the first bin.
 */
export function stopsBins(
  counts: number[],
  rangeMax: number,
  out = 256,
  floor = HDR_FLOOR_STOPS
): number[] {
  const bins = new Array<number>(out).fill(0)
  const n = counts.length
  if (n === 0) return bins
  for (let i = 0; i < n; i++) {
    const c = counts[i]
    if (c === 0) continue
    const lo = stopsX((i / n) * rangeMax, rangeMax, floor) * out
    const hi = stopsX(((i + 1) / n) * rangeMax, rangeMax, floor) * out
    if (hi - lo < 1e-9) {
      bins[Math.min(out - 1, Math.floor(lo))] += c
      continue
    }
    // Spread evenly over [lo, hi), in proportion to the overlap with each bin.
    const per = c / (hi - lo)
    for (let b = Math.floor(lo); b < Math.min(out, Math.ceil(hi)); b++) {
      const overlap = Math.min(hi, b + 1) - Math.max(lo, b)
      if (overlap > 0) bins[b] += per * overlap
    }
  }
  return bins
}
