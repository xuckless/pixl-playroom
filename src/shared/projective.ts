/**
 * A plane-to-plane map as one 3 × 3 matrix, row by row: `x' = (m0·x + m1·y +
 * m2) / (m6·x + m7·y + m8)`, `y'` likewise with m3…m5. An affine map is one
 * whose last row is 0, 0, 1; Upright's warp needs the rest. Small and free
 * of the rest of `shared/` so a worker can take it (view.ts makes the
 * display ↔ base ones and re-exports these).
 */
export type Projective = [number, number, number, number, number, number, number, number, number]

/** A point through a projective map (no horizon test: the caller's points have picture behind them). */
export function applyProjective(
  m: Projective,
  p: { x: number; y: number }
): { x: number; y: number } {
  const w = m[6] * p.x + m[7] * p.y + m[8]
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w }
}

/** A projective map as GLSL's `mat3` takes it: column by column. */
export function glMat3(m: Projective): Float32Array {
  return new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
}
