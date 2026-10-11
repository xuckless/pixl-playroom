/**
 * Snap to edges: a mask component's edge pulled onto the picture's own by
 * the engine's refine (0.16, `MaskComponent.refine`), a guided filter of its
 * plane by the luminance, after its feather. A model's coarse plane or a
 * rough brush stroke takes the photo's outline at whatever resolution the
 * engine renders, so a 1024 px plane stays crisp on a 45 MP export. It is a
 * smoothing that follows edges, not a segmentation: the radius should be
 * about three times how far off the plane is.
 *
 * Offered on a brush, a lasso and a model's mask (`refinable`), and on by
 * default for a model's (`MODEL_REFINE`). On a model's mask the panel's Shift
 * edge moves the snapped edge (the refine's `contract`, resolution-free)
 * rather than the plane, which is then drawn without it (`planeEdge`).
 *
 * A painted stroke snaps further (`snapsToObject`): a luminance filter
 * cannot tell which side of an edge a stroke meant (skin against skin, or
 * against a wall as bright, barely is an edge to it), so the stroke is first
 * kept to the object SAM finds under it (main/brushes.ts), and the refine
 * then only smooths that object's last pixels.
 */
import type { Refine } from './engine-types'
import { tk } from './i18n'
import { EDGE_SHIFT_SPAN, isPlainEdge, type MaskEdge } from './maskedge'
import type { MaskComponentSetting, MaskRefine, RefineKind } from './recipe'

/** The Edge radius slider's ends, % of the frame's shorter side (the engine's 0.0005…0.05). */
export const EDGE_RADIUS_MIN = 0.05
export const EDGE_RADIUS_MAX = 5
/**
 * An older model mask's plane (before its edge was made crisp): 1024 px on
 * its long side and soft, a texel or so off on a 24 MP frame (0.15% of the
 * shorter side).
 */
export const AI_EDGE_RADIUS = 0.4
/**
 * A model's plane now (SAM's, and the subject model's hardened one) is
 * already crisp and on the photo's edges at the proxy's size: only its last
 * pixel or two is snapped. Where the ground beside an edge is flat the
 * refine blurs it over its radius, so a wider one would put a halo back
 * around the subject (measured: 0.2% starts tracing noise as well).
 */
export const MODEL_EDGE_RADIUS = 0.1
/** A hand-drawn edge is further off than a model's. */
export const DRAWN_EDGE_RADIUS = 0.6
/** How strong a luminance step must be to hold the selection (steps from about 0.1 do). */
export const REFINE_EPSILON = 1e-3

/** A model's new mask (Subject, Background, Objects, Sky, Find object, a look's pick). */
export const MODEL_REFINE: MaskRefine = { on: true, radius: MODEL_EDGE_RADIUS }

/** The snap a model's new mask starts with. */
export function modelRefine(): MaskRefine {
  return { ...MODEL_REFINE }
}

/**
 * A soft model plane made crisp, in place: its values about `at` (0…1)
 * stretched `times` times, what is well inside and outside kept.
 */
export function hardenPlane(grey: Uint8Array, at: number, times: number): void {
  const mid = at * 255
  for (let i = 0; i < grey.length; i++)
    grey[i] = Math.max(0, Math.min(255, Math.round((grey[i] - mid) * times + 127.5)))
}

/** The Edge radius a component's snap starts at, and resets to. */
export function defaultEdgeRadius(c: MaskComponentSetting): number {
  if (c.kind !== 'brush') return DRAWN_EDGE_RADIUS
  // A model's plane, or a stroke kept to its object: both already on the photo's edges.
  if (c.source || !(c.edge?.harden ?? 0)) return MODEL_EDGE_RADIUS
  // An older recipe's model mask: no source, a hardened soft plane.
  return AI_EDGE_RADIUS
}

/** A painted stroke snapped: kept to the object SAM finds under it, then refined. */
export function snapsToObject(c: MaskComponentSetting): boolean {
  return c.kind === 'brush' && !c.source && c.refine?.on === true
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6
/** Six significant digits: a threshold of 1e-7 is not rounded away, as six decimals would. */
const sig6 = (v: number): number => Number(v.toPrecision(6))

/** Whether a component can be snapped: its edge is drawn or found, not computed. */
export function refinable(c: MaskComponentSetting): boolean {
  return c.kind === 'brush' || c.kind === 'polygon'
}

/** Whether it is snapped. */
export function refining(c: MaskComponentSetting): boolean {
  return refinable(c) && c.refine?.on === true
}

// ── The methods (engine 0.19.2, Phase A §4.2) ────────────────────────────────

/** One of a method's parameters, in the engine's own units, for the Advanced settings. */
export interface RefineParam {
  /** The engine's field name. */
  key: string
  label: string
  min: number
  max: number
  step: number
  def: number
  /** Shown as a percentage of the shorter side (a length), or as the number itself. */
  unit: 'short' | 'plain'
}

export interface RefineMethodInfo {
  kind: RefineKind
  label: string
  /** The (i): what it does, and what to expect. */
  what: string
  expect: string
  /**
   * The one parameter the Strength slider drives (0…100 across its range);
   * absent for Guided, whose strength is the Edge radius.
   */
  strength?: string
  params: RefineParam[]
  /** It reads the whole frame: applied on release, never on a drag frame. */
  whole: boolean
}

/**
 * The methods, cheapest first. Each range lies inside what engine 0.19.2
 * takes (its `src/color/mask.rs`: Guided's epsilon 1e-6…1, EdgeSnap's
 * distance 0.0005…0.05, the solver's sigmas 0.001…0.05 and 0.005…1, its
 * lambda 0.001…1000 and 1…500 rounds, Matting's band 0.0005…0.05, epsilon
 * 1e-7…0.1 and 1…1000 rounds); lengths are fractions of the shorter side.
 * The defaults are Playroom's own: the engine names none. A value the
 * engine refuses names its field (`….refine.EdgeSnap.distance`).
 */
export const REFINE_METHODS: RefineMethodInfo[] = [
  {
    kind: 'guided',
    label: tk('Guided'),
    what: tk('Pulls the edge onto the photo’s brightness edges. The quickest.'),
    expect: tk('Smooth, slightly soft edges. Good for most masks, and live while you drag.'),
    params: [
      {
        key: 'epsilon',
        label: tk('Edge threshold'),
        min: 1e-6,
        max: 1,
        step: 1e-4,
        def: REFINE_EPSILON,
        unit: 'plain'
      }
    ],
    whole: false
  },
  {
    kind: 'guidedColour',
    label: tk('Guided, colour'),
    what: tk('Like Guided, but sees colour edges too, where two colours are equally bright.'),
    expect: tk(
      'Cleaner edges between colours that are equally bright. A little slower than Guided.'
    ),
    params: [
      {
        key: 'epsilon',
        label: tk('Edge threshold'),
        min: 1e-6,
        max: 1,
        step: 1e-4,
        def: REFINE_EPSILON,
        unit: 'plain'
      }
    ],
    whole: false
  },
  {
    kind: 'edgeSnap',
    label: tk('Edge snap'),
    what: tk('Snaps a hard edge onto the strongest edge in the photo nearby.'),
    expect: tk(
      'Crisp edges and sharp corners. Best on skies, buildings and trees. Applied when you let go.'
    ),
    strength: 'distance',
    params: [
      {
        key: 'distance',
        label: tk('Distance'),
        min: 0.0005,
        max: 0.05,
        step: 0.0005,
        def: 0.005,
        unit: 'short'
      }
    ],
    whole: true
  },
  {
    kind: 'solver',
    label: tk('Soft snap'),
    what: tk('An edge-aware solver that follows the photo’s edges softly.'),
    expect: tk('Soft edges that still follow the photo. Slower. Applied when you let go.'),
    strength: 'sigma_spatial',
    params: [
      {
        key: 'sigma_spatial',
        label: tk('Reach'),
        min: 0.001,
        max: 0.05,
        step: 0.001,
        def: 0.008,
        unit: 'short'
      },
      {
        key: 'sigma_luma',
        label: tk('Brightness'),
        min: 0.005,
        max: 1,
        step: 0.001,
        def: 0.05,
        unit: 'plain'
      },
      {
        key: 'sigma_chroma',
        label: tk('Colour'),
        min: 0.005,
        max: 1,
        step: 0.001,
        def: 0.05,
        unit: 'plain'
      },
      {
        key: 'lambda',
        label: tk('Smoothness'),
        min: 1,
        max: 1000,
        step: 1,
        def: 128,
        unit: 'plain'
      },
      {
        key: 'iterations',
        label: tk('Iterations'),
        min: 1,
        max: 100,
        step: 1,
        def: 25,
        unit: 'plain'
      }
    ],
    whole: true
  },
  {
    kind: 'matting',
    label: tk('Hair and fine detail'),
    what: tk('Matting: works out partial transparency in a band along the edge.'),
    expect: tk(
      'Keeps hair, twigs and branches against the sky. Best on people. The slowest; applied when you let go.'
    ),
    strength: 'band',
    params: [
      {
        key: 'band',
        label: tk('Band'),
        min: 0.001,
        max: 0.05,
        step: 0.001,
        def: 0.01,
        unit: 'short'
      },
      {
        key: 'epsilon',
        label: tk('Edge threshold'),
        min: 1e-7,
        max: 0.1,
        step: 1e-6,
        def: 1e-5,
        unit: 'plain'
      },
      {
        key: 'iterations',
        label: tk('Iterations'),
        min: 1,
        max: 500,
        step: 1,
        def: 100,
        unit: 'plain'
      }
    ],
    whole: true
  }
]

export function refineMethod(kind: RefineKind | undefined): RefineMethodInfo {
  return REFINE_METHODS.find((m) => m.kind === (kind ?? 'guided')) ?? REFINE_METHODS[0]
}

/**
 * The Strength slider's position (0…100) for a method's main parameter
 * value. By ratio, not by amount: these are lengths from 0.1% to 5% of the
 * shorter side, and a step that doubles one reads as the same step
 * anywhere, with each default near the middle.
 */
export function strengthOf(m: RefineMethodInfo, value: number): number {
  const p = m.params.find((q) => q.key === m.strength)
  if (!p) return 50
  return Math.round((Math.log(clamp(value, p.min, p.max) / p.min) / Math.log(p.max / p.min)) * 100)
}

/** A method's parameter as set: the Advanced value, else what Strength puts it at, else its default. */
export function paramValue(m: RefineMethodInfo, r: MaskRefine | undefined, key: string): number {
  const p = m.params.find((q) => q.key === key)
  if (!p) return 0
  const set = r?.params?.[key]
  if (typeof set === 'number') return clamp(set, p.min, p.max)
  if (key === m.strength && typeof r?.strength === 'number') {
    // The Strength a method starts at is its default, exactly (not that position's rounding).
    if (r.strength === strengthOf(m, p.def)) return p.def
    return p.min * Math.pow(p.max / p.min, clamp(r.strength, 0, 100) / 100)
  }
  return p.def
}

/** The Strength a method starts at: where its default parameter sits. */
export function defaultStrength(m: RefineMethodInfo): number {
  const p = m.params.find((q) => q.key === m.strength)
  return p ? strengthOf(m, p.def) : 50
}

/**
 * The engine's refine for a method. `draft` (a drag frame): a method that
 * reads the whole frame stands aside for Guided at the same reach, so the
 * drag stays live and a tile stays the full render, cut; the release
 * renders the method itself.
 */
export function refineFor(
  r: MaskRefine,
  draft: boolean,
  /** Guided's radius, a fraction of the shorter side. */
  radius: number
): Refine {
  const m = refineMethod(r.method)
  const guided = (guide: 'Luma' | 'Colour', epsilon: number): Refine => ({
    Guided: { radius: round6(radius), epsilon, guide }
  })
  const v = (key: string): number => sig6(paramValue(m, r, key))
  if (draft && m.whole) return guided('Luma', REFINE_EPSILON)
  switch (m.kind) {
    case 'guided':
      return guided('Luma', v('epsilon'))
    case 'guidedColour':
      return guided('Colour', v('epsilon'))
    case 'edgeSnap':
      return { EdgeSnap: { distance: v('distance') } }
    case 'solver':
      return {
        BilateralSolver: {
          sigma_spatial: v('sigma_spatial'),
          sigma_luma: v('sigma_luma'),
          sigma_chroma: v('sigma_chroma'),
          lambda: v('lambda'),
          iterations: Math.round(v('iterations'))
        }
      }
    case 'matting':
      return {
        Matting: { band: v('band'), epsilon: v('epsilon'), iterations: Math.round(v('iterations')) }
      }
  }
}

/**
 * The engine's refine for a component, or null when it is not snapped.
 * `draft`: a drag frame (see `refineFor`).
 */
export function engineRefine(c: MaskComponentSetting, draft = false): Refine | null {
  if (!refining(c) || !c.refine) return null
  const radius = clamp(c.refine.radius, EDGE_RADIUS_MIN, EDGE_RADIUS_MAX) / 100
  return refineFor(c.refine, draft, radius)
}

/**
 * The engine's `shift` for a component (0.19.2): a snapped painted plane's
 * Shift edge moves the snapped edge, resolution-free (0.19's
 * `refine.contract`, the sign turned: + grows it). Elsewhere Playroom moves
 * the edge itself (the plane, a lasso's line), so the engine's stays 0.
 */
export function engineShift(c: MaskComponentSetting): number {
  if (!refining(c) || c.kind !== 'brush') return 0
  return round6((clamp(c.edge?.shift ?? 0, -100, 100) / 100) * EDGE_SHIFT_SPAN) || 0
}

/** Smooth 100: 5% of the shorter side, the engine's most. */
export const SMOOTH_SPAN = 0.05

/** Whether a component offers Smooth and Contrast: a drawn edge (a lasso, a painted brush), never a model's. */
export function edgeShaping(c: MaskComponentSetting): boolean {
  return c.kind === 'polygon' || (c.kind === 'brush' && !c.source && !((c.edge?.harden ?? 0) > 0))
}

/** The engine's `smooth` and `contrast` for a component (0 where it doesn't offer them). */
export function engineEdge(c: MaskComponentSetting): { smooth: number; contrast: number } {
  if (!edgeShaping(c)) return { smooth: 0, contrast: 0 }
  return {
    smooth: round6((clamp(c.smooth ?? 0, 0, 100) / 100) * SMOOTH_SPAN) || 0,
    contrast: round6(clamp(c.contrast ?? 0, 0, 100) / 100) || 0
  }
}

/**
 * The edge a painted plane is drawn with before it reaches the engine: a
 * snapped one's shift is the refine's (`engineRefine`), so not the plane's.
 */
export function planeEdge(c: MaskComponentSetting): MaskEdge | undefined {
  if (!c.edge || c.kind !== 'brush' || !refining(c)) return c.edge
  const e = { ...c.edge, shift: 0 }
  return isPlainEdge(e) ? undefined : e
}
