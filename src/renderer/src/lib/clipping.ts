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
