/** A half float (IEEE 754 binary16) as a number. */
export function halfToFloat(h: number): number {
  const e = (h >> 10) & 31
  const m = h & 1023
  const v =
    e === 0
      ? (m / 1024) * 2 ** -14
      : e === 31
        ? m
          ? NaN
          : Infinity
        : 2 ** (e - 15) * (1 + m / 1024)
  return h & 0x8000 ? -v : v
}

/**
 * Of a Full HDR frame (RGBA half floats, linear Display P3, 1.0 = SDR white),
 * how close to the display's ceiling counts as blown: the master rolls light
 * off into the ceiling, and what reaches it has lost its detail.
 */
export const CEILING_BLOWN = 0.99
/** Linear light at or under which a pixel is crushed: 8-bit sRGB's 1.5 / 255. */
export const FLOAT_CRUSHED = 0.00046

/**
 * Clipping in a Full HDR frame, marked as `markClipping` marks it: blown at
 * the display's ceiling (`ceiling`× SDR white), not at SDR white, so light
 * above white that still holds detail stays clear.
 */
export function markClippingFloat(f16: Uint16Array, ceiling: number, out: Uint8ClampedArray): void {
  const blown = ceiling * CEILING_BLOWN
  for (let i = 0; i < f16.length; i += 4) {
    const hi = Math.max(halfToFloat(f16[i]), halfToFloat(f16[i + 1]), halfToFloat(f16[i + 2]))
    if (hi >= blown) {
      out[i] = 255
      out[i + 1] = 60
      out[i + 2] = 90
      out[i + 3] = 220
    } else if (hi <= FLOAT_CRUSHED) {
      out[i] = 90
      out[i + 1] = 120
      out[i + 2] = 255
      out[i + 3] = 220
    } else out[i + 3] = 0
  }
}

/** Mark clipped pixels in RGBA data: blown highlights warm, crushed shadows cool, the rest clear. */
export function markClipping(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const hi = Math.max(d[i], d[i + 1], d[i + 2])
    if (hi >= 254) {
      d[i] = 255
      d[i + 1] = 60
      d[i + 2] = 90
      d[i + 3] = 220
    } else if (hi <= 1) {
      d[i] = 90
      d[i + 1] = 120
      d[i + 2] = 255
      d[i + 3] = 220
    } else d[i + 3] = 0
  }
}
