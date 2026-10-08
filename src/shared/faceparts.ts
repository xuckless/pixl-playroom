/**
 * Face parts as masks (engine 0.19's `faces`: YuNet finds the faces, Face
 * Mesh v2 outlines each one's eyes, brows, lips and mouth). A part lands as
 * a lasso (`PolygonComponent`) whose rings are every face's outline of it,
 * filled even-odd (the lips' ring with the mouth inside cut out); each
 * face's own rings are kept with it (`found`), so the mask can be narrowed
 * to one face and widened again without running anything.
 *
 * - "Left" is the subject's left (the engine's `left_*`): nothing mirrored.
 * - Brows are beta: their outlines measured below the engine's bar.
 * - Teeth are the inside of the mouth: the closest outline there is.
 * - Small faces: the detector sees the frame fitted into 640², reliable
 *   down to 1/8 of its longer side; four overlapping quarters are looked at
 *   too (`faceTiles`), and what they find twice is kept once (`mergeFaces`).
 *
 * Pure, for tests/faceparts.test.ts.
 */

export type FacePart = 'eyes' | 'brows' | 'lips' | 'teeth'
export const FACE_PARTS: FacePart[] = ['eyes', 'brows', 'lips', 'teeth']

export const FACE_DETECTOR = 'yunet-2023mar'
export const FACE_LANDMARKER = 'face-mesh-v2'

export const isFacePart = (v: unknown): v is FacePart => FACE_PARTS.includes(v as FacePart)

export const FACE_PART_LABEL: Record<FacePart, string> = {
  eyes: 'Eyes',
  brows: 'Brows',
  lips: 'Lips',
  teeth: 'Teeth'
}

export interface Pt {
  x: number
  y: number
}

/** One face's outline of the part. */
export interface FaceOutline {
  /** `[x, y, width, height]`, fractions of the base frame. */
  bounds: [number, number, number, number]
  rings: Pt[][]
}

/** What a face-part mask was found as: every face's outline, and which it shows. */
export interface FaceFound {
  part: FacePart
  /** Left to right in the frame. */
  faces: FaceOutline[]
  /** The face it shows (an index into `faces`), or null for all of them. */
  face: number | null
}

/** The engine's outline of one part: `{ contours: [{ points }], fill_rule }`. */
type EnginePolygon = { contours: { points: Pt[] }[] }
type EngineOutlines = Record<string, EnginePolygon | undefined>

const RINGS: Record<FacePart, string[]> = {
  eyes: ['left_eye', 'right_eye'],
  brows: ['left_brow', 'right_brow'],
  lips: ['lips'],
  teeth: ['inner_mouth']
}

/** A face's rings of the part, from the engine's outlines (fractions of the frame it ran on). */
export function partRings(outlines: EngineOutlines, part: FacePart): Pt[][] {
  const out: Pt[][] = []
  for (const name of RINGS[part])
    for (const c of outlines[name]?.contours ?? [])
      if (c.points.length >= 3) out.push(c.points.map((p) => ({ x: p.x, y: p.y })))
  return out
}

/** The rings the mask shows: one face's, or every face's. */
export function shownRings(found: FaceFound): Pt[][] {
  if (found.face !== null && found.faces[found.face]) return found.faces[found.face].rings
  return found.faces.flatMap((f) => f.rings)
}

/** Faces in reading order: left to right by their centres. */
export function leftToRight<T extends { bounds: [number, number, number, number] }>(
  faces: T[]
): T[] {
  return [...faces].sort((a, b) => a.bounds[0] + a.bounds[2] / 2 - (b.bounds[0] + b.bounds[2] / 2))
}

/**
 * The quarters looked at again for small faces: four overlapping halves of
 * each side (a quarter more than half, so a face on a seam is whole in one),
 * frame pixels.
 */
export function faceTiles(
  w: number,
  h: number
): { x: number; y: number; width: number; height: number }[] {
  const tw = Math.round(w * 0.625)
  const th = Math.round(h * 0.625)
  return [
    { x: 0, y: 0, width: tw, height: th },
    { x: w - tw, y: 0, width: tw, height: th },
    { x: 0, y: h - th, width: tw, height: th },
    { x: w - tw, y: h - th, width: tw, height: th }
  ]
}

const iou = (a: number[], b: number[]): number => {
  const x0 = Math.max(a[0], b[0])
  const y0 = Math.max(a[1], b[1])
  const x1 = Math.min(a[0] + a[2], b[0] + b[2])
  const y1 = Math.min(a[1] + a[3], b[1] + b[3])
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const u = a[2] * a[3] + b[2] * b[3] - i
  return u > 0 ? i / u : 0
}

/**
 * The faces found on the whole frame, with those only a quarter found added
 * (one already known is the whole frame's: its landmarks saw all of it). A
 * face a quarter cut at its edge is left out: the quarter beside it, or the
 * whole frame, has it whole. Bounds in frame pixels.
 */
export function mergeFaces<T extends { bounds: number[] }>(
  whole: T[],
  tiles: { tile: { x: number; y: number; width: number; height: number }; faces: T[] }[],
  w: number,
  h: number
): T[] {
  const out = [...whole]
  const margin = 2
  for (const { tile, faces } of tiles)
    for (const f of faces) {
      const [x, y, fw, fh] = f.bounds
      const cut =
        (x <= tile.x + margin && tile.x > 0) ||
        (y <= tile.y + margin && tile.y > 0) ||
        (x + fw >= tile.x + tile.width - margin && tile.x + tile.width < w) ||
        (y + fh >= tile.y + tile.height - margin && tile.y + tile.height < h)
      if (cut) continue
      if (out.some((o) => iou(o.bounds, f.bounds) > 0.3)) continue
      out.push(f)
    }
  return out
}
