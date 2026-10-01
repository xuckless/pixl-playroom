/**
 * Turning and mirroring a photo's framing. The crop, straighten, aspect lock
 * and Upright live in the frame as the user has turned it, so a flip or a
 * quarter turn carries them with the picture: what was framed stays framed.
 * (Masks and spots are on the photo's own frame, before any turn: they move
 * with it as they are.)
 */
import type { CropRect, Transform } from './engine-types'
import { transformPoint } from './orientation'
import type { Recipe } from './recipe'
import type { GuideLine, UprightSetting } from './upright'

type Geometry = Recipe['geometry']

// ── Flip: a mirror across the vertical axis of what is shown ─────────────────

/**
 * A mirror turns the camera the other way about the vertical axis and the
 * picture the other way round; the tilt about the horizontal axis and the
 * stretch are unchanged. Exact (see `homography`).
 */
function mirrorTransform(t: Transform): Transform {
  return {
    ...t,
    horizontal: -t.horizontal,
    rotate: -t.rotate,
    offset: { x: -t.offset.x, y: t.offset.y }
  }
}

const mirrorGuide = (g: GuideLine): GuideLine => ({
  from: { x: 1 - g.from.x, y: g.from.y },
  to: { x: 1 - g.to.x, y: g.to.y }
})

function mirrorUpright(u: UprightSetting): UprightSetting {
  return {
    ...u,
    suggested: u.suggested && mirrorTransform(u.suggested),
    guides: u.guides.map(mirrorGuide),
    horizontal: -u.horizontal,
    rotate: -u.rotate,
    offsetX: -u.offsetX
  }
}

/** The geometry with the photo mirrored left to right as shown. */
export function flipGeometry(g: Geometry): Geometry {
  return {
    ...g,
    flipHorizontal: !g.flipHorizontal,
    straighten: -g.straighten,
    crop: g.crop && { ...g.crop, x: 1 - g.crop.x - g.crop.width },
    upright: mirrorUpright(g.upright)
  }
}

// ── A quarter turn clockwise of what is shown ────────────────────────────────

/**
 * A clockwise quarter turn of the frame takes the tilt about the horizontal
 * axis to the vertical one and the tilt about the vertical axis, reversed, to
 * the horizontal one; the stretch swaps axes and the offsets turn with the
 * picture. Exact when one of the tilts is zero (the usual Upright); with both
 * the two tilts' order changes, a second-order difference.
 */
function turnTransform(t: Transform): Transform {
  return {
    ...t,
    vertical: -t.horizontal,
    horizontal: t.vertical,
    aspect: -t.aspect,
    offset: { x: -t.offset.y, y: t.offset.x }
  }
}

const turnPoint = (p: { x: number; y: number }): { x: number; y: number } =>
  transformPoint('Rotate90', p)

function turnUpright(u: UprightSetting): UprightSetting {
  return {
    ...u,
    suggested: u.suggested && turnTransform(u.suggested),
    guides: u.guides.map((g) => ({ from: turnPoint(g.from), to: turnPoint(g.to) })),
    vertical: -u.horizontal,
    horizontal: u.vertical,
    aspect: -u.aspect,
    offsetX: -u.offsetY,
    offsetY: u.offsetX
  }
}

/** A crop, normalised to its frame, on the frame turned a quarter clockwise. */
function turnCrop(c: CropRect): CropRect {
  return { x: 1 - c.y - c.height, y: c.x, width: c.height, height: c.width }
}

function turnOnce(g: Geometry): Geometry {
  // The flip is applied after the turns: on a mirrored photo a clockwise turn
  // of what is shown is one turn fewer.
  const step = g.flipHorizontal ? 3 : 1
  return {
    ...g,
    quarterTurns: (g.quarterTurns + step) % 4,
    // A turn of the canvas leaves the straighten's angle as it was.
    crop: g.crop && turnCrop(g.crop),
    aspect: g.aspect && 1 / g.aspect,
    upright: turnUpright(g.upright)
  }
}

/** The geometry with the photo turned a quarter clockwise (`1`) or counter-clockwise (`-1`) as shown. */
export function turnGeometry(g: Geometry, dir: 1 | -1): Geometry {
  const n = dir === 1 ? 1 : 3
  let out = g
  for (let i = 0; i < n; i++) out = turnOnce(out)
  return out
}
