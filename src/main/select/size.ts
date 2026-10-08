/**
 * When a kept SAM mask takes the guided edge. Pure, for tests/samsize.test.ts.
 */

/** SAM 2.1's encoder sees the frame fitted into a square this many pixels on a side. */
export const SAM_GRID = 1024

/**
 * The guided edge averages a plane over a box of its radius, so it erases an
 * object smaller than that box (engine 0.18, integration guide §7: IoU 0.00
 * at 32 SAM-grid pixels or less, level with bilinear from 128 up). Below 128
 * grid pixels either way a kept mask is resampled instead.
 */
export const GUIDED_MIN_GRID = 128
/** Whether an object `size` frame pixels across keeps through the guided edge; null (nothing found): no. */
export function guidedKeeps(
  size: { width: number; height: number } | null,
  frameLong: number
): boolean {
  if (!size) return false
  const grid = SAM_GRID / frameLong
  return size.width * grid >= GUIDED_MIN_GRID && size.height * grid >= GUIDED_MIN_GRID
}
