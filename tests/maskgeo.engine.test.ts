/**
 * Masks under geometry and lens edits, measured with the engine. A synthetic
 * 1200 × 800 chart (no photograph) carries a coloured marker for each kind
 * of mask, and each mask (exposure −3) is drawn on its marker: a radial, a
 * linear (a half disk: the gradient's line through a disk), a bidirectional
 * (its band through a disk), a lasso, a painted plane, a model's plane, a
 * depth range, a clone spot, and a colour range as the control; and, in the
 * lens cases, a radial and a lasso near the corners, where a correction moves
 * the picture most and its map is read nearest its edge. For every
 * framing and lens case the recipe is rendered through `compile` as
 * render.ts does it, the masks carried to the lens rendered as main does
 * (maskframe.ts, its planes re-warped as brushes.ts writes them), and:
 *
 *   effect − marker  where the engine applied the mask against where its
 *                    content landed (both centroids, output pixels);
 *   plane − effect   Inspect::LayerMask's plane (the overlay's) against the effect;
 *   loupe − effect   the loupe's map of the mask's own point (loupeGeometry,
 *                    baseToDisplay, through its lens grid);
 *   matrix − effect  the same through the projective matrix (no lens grid:
 *                    held to 2 px only where the masks are on the lens rendered).
 *
 * Every case within 2 px. MASKGEO_OUT=<folder> writes the table there.
 * (Engine 0.21's brush Strokes join as a kind once brushes are drawn as them.)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Recipe, MaskComponentSetting, LocalLayer } from '../src/shared/recipe'
import type { RetouchSpot } from '../src/shared/retouch'
import type { P } from '../src/shared/view'

/** The native engine, where it is built (not in CI: this check skips). */
const engine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown): Promise<{ output: Buffer; width: number; height: number }>
      engineVersion(): string
    }
  } catch {
    return null
  }
})()

const W = 1200
const H = 800
/** Marker and mask radius, frame pixels. */
const R = 26

type Kind =
  | 'radial'
  | 'linear'
  | 'bidirectional'
  | 'lasso'
  | 'brush'
  | 'model plane'
  | 'depth'
  | 'clone spot'
  | 'range'
  | 'corner radial'
  | 'corner lasso'

/** Each kind's marker: centre (base frame, normalised) and colour (linear 0…1). */
const MARKS: Record<Kind, { at: P; rgb: [number, number, number] }> = {
  radial: { at: { x: 0.28, y: 0.36 }, rgb: [0.9, 0.08, 0.08] },
  linear: { at: { x: 0.42, y: 0.36 }, rgb: [0.95, 0.45, 0.02] },
  bidirectional: { at: { x: 0.56, y: 0.36 }, rgb: [0.85, 0.85, 0.05] },
  range: { at: { x: 0.7, y: 0.36 }, rgb: [0.45, 0.05, 0.9] },
  'clone spot': { at: { x: 0.3, y: 0.52 }, rgb: [0.02, 0.02, 0.02] },
  lasso: { at: { x: 0.46, y: 0.52 }, rgb: [0.05, 0.1, 0.9] },
  brush: { at: { x: 0.62, y: 0.52 }, rgb: [0.08, 0.8, 0.08] },
  'model plane': { at: { x: 0.28, y: 0.68 }, rgb: [0.05, 0.8, 0.8] },
  depth: { at: { x: 0.44, y: 0.68 }, rgb: [0.85, 0.08, 0.85] },
  // Near the corners, where a lens moves the picture most and its map is
  // read nearest its edge (held to the lens cases: a warp crops them away).
  'corner radial': { at: { x: 0.075, y: 0.1 }, rgb: [0.55, 0.95, 0.3] },
  'corner lasso': { at: { x: 0.925, y: 0.88 }, rgb: [0.95, 0.6, 0.7] }
}
/** Kinds measured only where the framing keeps the corners (the lens cases). */
const CORNERS: Kind[] = ['corner radial', 'corner lasso']
const isLensCase = (name: string): boolean =>
  /distortion|Optics|lens|^none$/.test(name) && !/straighten|crop|turn|Upright/.test(name)
const KINDS = Object.keys(MARKS) as Kind[]
/** Where the clone spot copies from: a white patch. */
const PATCH = { x: 0.67, y: 0.69 }
const GREY = 0.3

/** Inside the linear's marker: the half of the disk the gradient keeps (its start side, left). */
const inHalf = (dx: number): boolean => dx <= 0

function chart(): Uint16Array {
  const rgb = new Uint16Array(W * H * 3).fill(Math.round(GREY * 65535))
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let c: [number, number, number] | null = null
      for (const k of KINDS) {
        const m = MARKS[k]
        const dx = x + 0.5 - m.at.x * W
        const dy = y + 0.5 - m.at.y * H
        const r = k === 'clone spot' ? 5 : R
        const square = k === 'lasso' || k === 'corner lasso'
        if (square ? Math.max(Math.abs(dx), Math.abs(dy)) < r : Math.hypot(dx, dy) < r)
          if (k !== 'linear' || inHalf(dx)) c = m.rgb
      }
      if (Math.abs(x + 0.5 - PATCH.x * W) < 60 && Math.abs(y + 0.5 - PATCH.y * H) < 45)
        c = [0.95, 0.95, 0.95]
      if (!c) continue
      const i = (y * W + x) * 3
      for (let j = 0; j < 3; j++) rgb[i + j] = Math.round(c[j] * 65535)
    }
  return rgb
}

/** A disk on a plane at half the frame's size (as painted planes are smaller than the frame). */
function diskPlane(at: P): { data: Uint8Array; w: number; h: number } {
  const w = W / 2
  const h = H / 2
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (Math.hypot(x + 0.5 - at.x * w, y + 0.5 - at.y * h) < R / 2) data[y * w + x] = 255
  return { data, w, h }
}

const base = { mode: 'Add' as const, opacity: 100, invert: false, feather: 0 }

/** The masks drawn on markers at `pos` (each kind's centre, normalised, on the masks' frame). */
function masksAt(
  pos: Record<Kind, P>,
  frame: { k: number }
): {
  layers: Record<Kind, MaskComponentSetting[]>
  spot: RetouchSpot
} {
  const r = (R * frame.k) / H
  const px = frame.k / W
  const disk = (k: Kind, id: string): MaskComponentSetting => ({
    ...base,
    id,
    kind: 'radial',
    centre: pos[k],
    radiusX: r,
    radiusY: r,
    angle: 0,
    softness: 0,
    width: 512,
    height: 341
  })
  const lassoHalf = (R * frame.k) / H
  const square = (k: Kind, id: string): MaskComponentSetting => ({
    ...base,
    id,
    kind: 'polygon',
    points: [
      { x: pos[k].x - (lassoHalf * H) / W, y: pos[k].y - lassoHalf },
      { x: pos[k].x + (lassoHalf * H) / W, y: pos[k].y - lassoHalf },
      { x: pos[k].x + (lassoHalf * H) / W, y: pos[k].y + lassoHalf },
      { x: pos[k].x - (lassoHalf * H) / W, y: pos[k].y + lassoHalf }
    ]
  })
  const layers: Record<Kind, MaskComponentSetting[]> = {
    radial: [disk('radial', 'radial')],
    'corner radial': [disk('corner radial', 'corner-radial')],
    'corner lasso': [square('corner lasso', 'corner-lasso')],
    linear: [
      disk('linear', 'linear-disk'),
      {
        ...base,
        mode: 'Intersect',
        id: 'linear',
        kind: 'linear',
        start: { x: pos.linear.x - px, y: pos.linear.y },
        end: { x: pos.linear.x + px, y: pos.linear.y },
        width: 512,
        height: 341
      }
    ],
    bidirectional: [
      disk('bidirectional', 'bi-disk'),
      {
        ...base,
        mode: 'Intersect',
        id: 'bidirectional',
        kind: 'bidirectional',
        start: { x: pos.bidirectional.x - 12 * px, y: pos.bidirectional.y },
        end: { x: pos.bidirectional.x + 12 * px, y: pos.bidirectional.y },
        centre: 0.5,
        width: 512,
        height: 341
      }
    ],
    lasso: [square('lasso', 'lasso')],
    brush: [{ ...base, id: 'brush', kind: 'brush', width: W / 2, height: H / 2, png: 'x' }],
    'model plane': [
      {
        ...base,
        id: 'model',
        kind: 'brush',
        width: W / 2,
        height: H / 2,
        png: 'x',
        source: { kind: 'segment', target: 'subject' }
      }
    ],
    depth: [
      {
        ...base,
        id: 'depth',
        kind: 'depth',
        width: W / 2,
        height: H / 2,
        png: 'x',
        near: 0,
        far: 33,
        softness: 0
      }
    ],
    range: [],
    'clone spot': []
  }
  const spot = {
    id: 'spot',
    kind: 'clone',
    enabled: true,
    points: [pos['clone spot']],
    radius: (R * frame.k) / H,
    radiusY: (R * frame.k) / H,
    rotate: 0,
    source: { x: PATCH.x + (pos['clone spot'].x - MARKS['clone spot'].at.x), y: PATCH.y },
    feather: 0,
    opacity: 100,
    desaturate: 0,
    darken: 0,
    amount: 0,
    pupilLevel: 0
  } as RetouchSpot
  return { layers, spot }
}

interface Case {
  name: string
  /** The geometry and lens rendered. */
  edit: (r: Recipe) => void
  /** The lens the masks are drawn under (they are placed on the markers as it shows them). */
  drawnUnder?: 'lens'
  /** The model plane was found on another frame than the masks' (its own `lensFrame`). */
  modelOn?: 'none'
  /** The masks rewritten onto the recipe's lens before rendering (a lens edit settled). */
  rebase?: boolean
  /** A whole-frame view: the crop tool (its warp whole, the wedges empty) or Upright's guides. */
  view?: 'crop tool' | 'guides'
}

const lens50 = (r: Recipe): void => void (r.lens.distortion = 50)

const CASES: Case[] = [
  { name: 'none', edit: () => {} },
  { name: 'crop', edit: (r) => (r.geometry.crop = { x: 0.15, y: 0.2, width: 0.7, height: 0.65 }) },
  { name: 'straighten 10°', edit: (r) => (r.geometry.straighten = 10) },
  { name: 'quarter turn', edit: (r) => (r.geometry.quarterTurns = 1) },
  { name: 'half turn', edit: (r) => (r.geometry.quarterTurns = 2) },
  { name: 'three quarter turns', edit: (r) => (r.geometry.quarterTurns = 3) },
  { name: 'flip', edit: (r) => (r.geometry.flipHorizontal = true) },
  {
    name: 'turn + flip',
    edit: (r) => {
      r.geometry.quarterTurns = 1
      r.geometry.flipHorizontal = true
    }
  },
  { name: 'Upright V20°', edit: (r) => (r.geometry.upright.vertical = 50) },
  {
    name: 'Upright V20° H10° + crop',
    edit: (r) => {
      r.geometry.upright.vertical = 50
      r.geometry.upright.horizontal = 25
      r.geometry.crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
    }
  },
  {
    name: 'turn + flip + straighten 4 + crop + Upright',
    edit: (r) => {
      r.geometry.quarterTurns = 3
      r.geometry.flipHorizontal = true
      r.geometry.straighten = 4
      r.geometry.crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
      r.geometry.upright.vertical = 40
      r.geometry.upright.horizontal = 15
    }
  },
  {
    name: 'turn + flip + straighten 4 + crop + Upright, crop tool open',
    view: 'crop tool',
    edit: (r) => {
      r.geometry.quarterTurns = 3
      r.geometry.flipHorizontal = true
      r.geometry.straighten = 4
      r.geometry.crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
      r.geometry.upright.vertical = 40
      r.geometry.upright.horizontal = 15
    }
  },
  {
    name: 'turn + Upright, Upright’s guides',
    view: 'guides',
    edit: (r) => {
      r.geometry.quarterTurns = 1
      r.geometry.upright.vertical = 40
      r.geometry.crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
    }
  },
  {
    name: 'crop + straighten 6, Crop section off',
    edit: (r) => {
      r.geometry.crop = { x: 0.15, y: 0.2, width: 0.6, height: 0.6 }
      r.geometry.straighten = 6
      r.off = { crop: true }
    }
  },
  {
    name: 'Upright V20° + crop, Crop section off',
    edit: (r) => {
      r.geometry.upright.vertical = 50
      r.geometry.crop = { x: 0.15, y: 0.2, width: 0.6, height: 0.6 }
      r.off = { crop: true }
    }
  },
  {
    name: 'Upright V20°, Geometry section off',
    edit: (r) => {
      r.geometry.upright.vertical = 50
      r.off = { geometry: true }
    }
  },
  { name: 'distortion +50 after the masks', edit: lens50 },
  { name: 'distortion −50 after the masks', edit: (r) => void (r.lens.distortion = -50) },
  { name: 'distortion +50 after, settled', edit: lens50, rebase: true },
  {
    name: 'distortion +50 after + straighten 10°',
    edit: (r) => {
      lens50(r)
      r.geometry.straighten = 10
    }
  },
  {
    name: 'drawn under +50, Optics off',
    drawnUnder: 'lens',
    edit: (r) => {
      lens50(r)
      r.off = { optics: true }
    }
  },
  {
    // Drawn on the picture with no correction; the correction set with Optics
    // off, which settles the masks onto it (rebased), and the render carries
    // them back: both ways through the maps.
    name: 'drawn with no lens, +50 set with Optics off, settled',
    edit: (r) => {
      lens50(r)
      r.off = { optics: true }
    },
    rebase: true
  },
  {
    name: 'model plane found with Optics off, on again',
    drawnUnder: 'lens',
    modelOn: 'none',
    edit: lens50
  }
]

type Out = { width: number; height: number; output: Buffer }

function centroid(
  w: number,
  h: number,
  pick: (i: number, x: number, y: number) => boolean
): P | null {
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!pick(y * w + x, x, y)) continue
      sx += x + 0.5
      sy += y + 0.5
      n++
    }
  return n > 30 ? { x: sx / n, y: sy / n } : null
}

const dist = (a: P | null, b: P | null): number =>
  a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Number.NaN
const fmt = (p: P | null): string => (p ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : '—')
const num = (v: number): string => (Number.isNaN(v) ? '—' : v.toFixed(1))
const luma = (b: Buffer, i: number): number =>
  0.2126 * b[i * 3] + 0.7152 * b[i * 3 + 1] + 0.0722 * b[i * 3 + 2]

test(
  'every kind of mask lands on its content under every framing and lens edit (within 2 px)',
  { skip: engine === null ? 'the engine is not built for this platform' : false, timeout: 600_000 },
  async () => {
    const e = engine!
    const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { blankRequest, displayPolicy } = await import('../src/main/source')
    const { encodeGreyPng, encodePng16, grey8 } = await import('../src/main/pngio')
    const { writeRamp } = await import('../src/main/pixels/ops')
    const { writeBrushPlane } = await import('../src/main/planes')
    const { maskFramesFor, maskGrid, planeWarpFor, rebaseMasks, stMap } =
      await import('../src/main/maskframe')
    const { compile, framingTransparent, orientedFrame } = await import('../src/shared/compile')
    const { renderedLens } = await import('../src/shared/edits')
    const { frameMap, frameOf, lensFrameKey, lensFrameOf, ownLensFrame } =
      await import('../src/shared/lensframe')
    const { defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
    const { applyProjective, baseToDisplay, baseToDisplayMatrix, loupeGeometry } =
      await import('../src/shared/view')

    const dir = mkdtempSync(join(tmpdir(), 'maskgeo-'))
    const src = join(dir, 'chart.png')
    writeFileSync(src, encodePng16(chart(), W, H, 3))
    const deps = {
      engine: e as never,
      cacheDir: dir,
      work: async (job: { op: string; file?: string; w?: number; h?: number }): Promise<null> => {
        if (job.op === 'ramp') writeRamp(job.file!, job.w!, job.h!)
        return null
      }
    }

    const render = async (
      rec: Recipe,
      brushPaths: Record<string, string>,
      view?: Case['view']
    ): Promise<Out> => {
      const frames = await maskFramesFor(deps, rec, false, W, H)
      const c = compile(rec, ctxOf(brushPaths, frames, view))
      // The crop tool shows a warp's empty wedges transparent: its alpha dropped.
      const channels = framingTransparent(c.framing) ? 4 : 3
      const o = await e.convert({
        ...blankRequest(src, '', 'Png'),
        sink: 'Bytes',
        pixel: { depth: 'Eight', channels },
        encode: { Pixels: { sample: 'U8' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: displayPolicy({ is_hdr: false } as never, 'DisplayP3'),
        grade: c.grade,
        framing: c.framing,
        lens: c.lens,
        retouch: c.retouch,
        threads: 6
      })
      if (channels === 3) return o
      const rgb = Buffer.alloc(o.width * o.height * 3)
      for (let i = 0; i < o.width * o.height; i++)
        for (let j = 0; j < 3; j++) rgb[i * 3 + j] = o.output[i * 4 + j]
      return { ...o, output: rgb }
    }
    const ctxOf = (
      brushPaths: Record<string, string>,
      maskFrames: Awaited<ReturnType<typeof maskFramesFor>>,
      view?: Case['view']
    ): Parameters<typeof compile>[1] => ({
      isRaw: false,
      asShot: null,
      sourceOrientation: 'Normal',
      frameWidth: W,
      frameHeight: H,
      scale: 1,
      seed: 1,
      brushPaths,
      maskFrames,
      // As render.ts compiles the whole-frame tools' view.
      applyCrop: view === undefined,
      showTransform: view !== 'guides'
    })

    // The marker colours as rendered, and the range's key on its marker.
    const plain = await render(defaultRecipe(false), {})
    const colourAt = (o: Out, p: P): [number, number, number] => {
      const i = (Math.round(p.y * o.height) * o.width + Math.round(p.x * o.width)) * 3
      return [o.output[i], o.output[i + 1], o.output[i + 2]]
    }
    const shown = Object.fromEntries(
      KINDS.map((k) => [
        k,
        colourAt(plain, k === 'linear' ? { ...MARKS[k].at, x: MARKS[k].at.x - 0.01 } : MARKS[k].at)
      ])
    ) as Record<Kind, [number, number, number]>
    const [pr, pg, pb] = shown.range.map((v) => v / 255)
    const mx = Math.max(pr, pg, pb)
    const mn = Math.min(pr, pg, pb)
    const hue =
      mx === pr
        ? 60 * (((pg - pb) / (mx - mn) + 6) % 6)
        : mx === pg
          ? 60 * ((pb - pr) / (mx - mn) + 2)
          : 60 * ((pr - pg) / (mx - mn) + 4)
    const rangeComp: MaskComponentSetting = {
      ...base,
      id: 'range',
      kind: 'range',
      hue: { centre: hue, width: 20, softness: 4 },
      saturation: { centre: (mx - mn) / mx, width: 0.3, softness: 0.05 },
      luma: null,
      smoothness: 0
    }
    const isMarker = (o: Out, i: number, k: Kind): boolean => {
      const c = shown[k]
      const d = Math.hypot(
        o.output[i * 3] - c[0],
        o.output[i * 3 + 1] - c[1],
        o.output[i * 3 + 2] - c[2]
      )
      return d < 45
    }
    /** Each marker's centroid on a render, near where it should be. */
    const markersOn = (o: Out, near: Record<Kind, P | null>): Record<Kind, P | null> =>
      Object.fromEntries(
        KINDS.map((k) => {
          const at = near[k]
          return [
            k,
            at
              ? centroid(
                  o.width,
                  o.height,
                  (i, x, y) => Math.hypot(x - at.x, y - at.y) < 70 && isMarker(o, i, k)
                )
              : null
          ]
        })
      ) as Record<Kind, P | null>

    // Where each marker (and the clone's white patch) shows under the +50
    // correction alone: what a mask drawn while it was on is placed on
    // (measured on the engine's render, not mapped).
    const lensed = defaultRecipe(false)
    lens50(lensed)
    const underLens = await render(lensed, {})
    const scaled = (o: Out, p: P): P => ({ x: p.x * o.width, y: p.y * o.height })
    const lensMarks = markersOn(
      underLens,
      Object.fromEntries(KINDS.map((k) => [k, scaled(underLens, MARKS[k].at)])) as Record<Kind, P>
    )
    const plainMarks = markersOn(
      plain,
      Object.fromEntries(KINDS.map((k) => [k, scaled(plain, MARKS[k].at)])) as Record<Kind, P>
    )
    const white = (o: Out, at: P): P | null =>
      centroid(
        o.width,
        o.height,
        (i, x, y) =>
          Math.hypot(x - at.x, y - at.y) < 120 &&
          o.output[i * 3] > 220 &&
          o.output[i * 3 + 1] > 220 &&
          o.output[i * 3 + 2] > 220
      )
    /** A point's move under the correction, from where its content lands (locally a translation). */
    const moved = (p: P, a: P, b: P): P => ({
      x: p.x + (b.x / underLens.width - a.x / W),
      y: p.y + (b.y / underLens.height - a.y / H)
    })
    const onLens = Object.fromEntries(
      KINDS.map((k) => [k, moved(MARKS[k].at, plainMarks[k]!, lensMarks[k]!)])
    ) as Record<Kind, P>
    const patchOnLens = moved(
      PATCH,
      white(plain, scaled(plain, PATCH))!,
      white(underLens, scaled(underLens, PATCH))!
    )
    const lensScale = W / underLens.width

    const rows: string[] = [
      `engine ${e.engineVersion()}, ${W}×${H} synthetic chart, output pixels`,
      '',
      '| case | mask | out W×H | marker | effect | effect−marker | plane−effect | loupe−effect | matrix−effect |',
      '|---|---|---|---|---|---|---|---|---|'
    ]
    const failures: string[] = []
    for (const kase of CASES) {
      // The masks, on the markers as the frame they are drawn on shows them.
      const drawn = kase.drawnUnder === 'lens'
      const pos = drawn
        ? onLens
        : (Object.fromEntries(KINDS.map((k) => [k, MARKS[k].at])) as Record<Kind, P>)
      const { layers, spot } = masksAt(pos, { k: drawn ? lensScale : 1 })
      if (drawn) spot.source = patchOnLens
      let r = defaultRecipe(false)
      if (drawn) {
        lens50(r)
        r.masks = { lensFrame: ownLensFrame(r) }
      }
      r.retouch = [spot]
      r.layers = KINDS.filter((k) => k !== 'clone spot').map((k) => {
        const l: LocalLayer = newLocalLayer(k)
        l.id = k
        l.components = k === 'range' ? [rangeComp] : layers[k]
        l.settings.basic.exposure = -3
        return l
      })
      // The model's plane found on the uncorrected frame (Optics off), the rest under the lens.
      const planeAt: Record<string, P> = {
        brush: pos.brush,
        model: kase.modelOn === 'none' ? MARKS['model plane'].at : pos['model plane'],
        depth: pos.depth
      }
      if (kase.modelOn === 'none') {
        const ml = r.layers.find((l) => l.id === 'model plane')!
        ml.components = ml.components.map((c) => ({ ...c, lensFrame: null }))
      }
      kase.edit(r)
      if (kase.rebase) r = await rebaseMasks(deps, r, W, H)
      // The planes, written as main writes them: turned, and re-warped when
      // drawn under another lens than the one rendered.
      const { user } = orientedFrame(r, W, H)
      const frames = await maskFramesFor(deps, r, false, W, H)
      const masksFrame = r.masks.lensFrame
      const brushPaths: Record<string, string> = {}
      const tag = kase.name.replace(/\W+/g, '-')
      for (const l of r.layers)
        for (const c of l.components) {
          if (c.kind !== 'brush' && c.kind !== 'depth') continue
          const p = diskPlane(planeAt[c.id])
          const png = encodeGreyPng(p.data, p.w, p.h).toString('base64')
          const warped = frames ? planeWarpFor(frames, frameOf(c, masksFrame)) : null
          const file = join(dir, `${tag}-${c.id}-${warped?.key ?? 'as'}-${user}.png`)
          writeBrushPlane(file, png, user, undefined, undefined, warped?.warp)
          brushPaths[c.id] = file
        }
      const plainRecipe = structuredClone(r)
      plainRecipe.layers = []
      plainRecipe.retouch = []
      const a = await render(plainRecipe, {}, kase.view)
      const b = await render(r, brushPaths, kase.view)
      assert.equal(a.width, b.width)
      const ow = a.width
      const oh = a.height
      // The loupe: the picture as rendered, and its lens grid when the masks are on another lens.
      const rendered = lensFrameOf(renderedLens(r, false))
      const grid = await maskGrid(deps, masksFrame, rendered, W, H)
      const g = {
        ...loupeGeometry(r, false, W, H, kase.view !== undefined, kase.view === 'guides'),
        lens: grid
      }
      const toDisplay = baseToDisplayMatrix(g)
      const compiled = compile(r, ctxOf(brushPaths, frames, kase.view))
      // Each mask's own point as the recipe holds it, on the masks' frame (a
      // plane on its own frame carried over, as the loupe shows it re-warped).
      const all = r.layers.flatMap((l) => l.components)
      const comp = (id: string): MaskComponentSetting => all.find((c) => c.id === id)!
      const maps = {
        [lensFrameKey(null)]: null,
        ...Object.fromEntries(
          await Promise.all(
            [masksFrame, ...all.map((c) => frameOf(c, masksFrame))].map(
              async (f) => [lensFrameKey(f), await stMap(deps, f, W, H)] as const
            )
          )
        )
      }
      const onMasks = (c: MaskComponentSetting | RetouchSpot, p: P): P =>
        frameMap(maps, frameOf(c, masksFrame), masksFrame)(p)
      const stored = (k: Kind): P | null => {
        if (k === 'range') return null
        if (k === 'clone spot') return onMasks(r.retouch[0], r.retouch[0].points[0])
        if (k === 'brush' || k === 'model plane' || k === 'depth') {
          const c = comp(k === 'model plane' ? 'model' : k)
          return onMasks(c, planeAt[c.id])
        }
        if (k === 'lasso' || k === 'corner lasso') {
          const c = comp(k === 'lasso' ? 'lasso' : 'corner-lasso') as Extract<
            MaskComponentSetting,
            { kind: 'polygon' }
          >
          const n = c.points.length
          return onMasks(c, {
            x: c.points.reduce((t, p) => t + p.x, 0) / n,
            y: c.points.reduce((t, p) => t + p.y, 0) / n
          })
        }
        const disk = comp(
          k === 'radial'
            ? 'radial'
            : k === 'corner radial'
              ? 'corner-radial'
              : k === 'linear'
                ? 'linear-disk'
                : 'bi-disk'
        ) as Extract<MaskComponentSetting, { kind: 'radial' }>
        // The linear keeps the disk's start side: its centroid, 4r / 3π from the centre.
        const off = k === 'linear' ? (4 * disk.radiusY * H) / (3 * Math.PI) / W : 0
        return onMasks(disk, { x: disk.centre.x - off, y: disk.centre.y })
      }
      for (const k of KINDS) {
        if (CORNERS.includes(k) && !isLensCase(kase.name)) continue
        const own = stored(k)
        // Where its content landed, near where it was put on the chart.
        const guess = own ? baseToDisplay(g, own) : null
        // A range has no point of its own: its marker's, on the masks' frame.
        const look = guess ?? baseToDisplay(g, pos[k])
        const near = { x: look.x * ow, y: look.y * oh }
        const within = (x: number, y: number): boolean => Math.hypot(x - near.x, y - near.y) < 80
        const marker = centroid(ow, oh, (i, x, y) => within(x, y) && isMarker(a, i, k))
        const effect =
          k === 'clone spot'
            ? centroid(
                ow,
                oh,
                (i, x, y) => within(x, y) && luma(b.output, i) - luma(a.output, i) > 60
              )
            : centroid(ow, oh, (i, x, y) => {
                if (!within(x, y)) return false
                const ya = luma(a.output, i)
                return ya > 10 && 1 - luma(b.output, i) / ya > 0.3
              })
        let planeD = Number.NaN
        const index = compiled.layerIndex[k]
        if (index !== undefined && compiled.grade && !framingTransparent(compiled.framing)) {
          const file = join(dir, 'mask.png')
          await e.convert({
            ...blankRequest(src, file, 'Png'),
            pixel: { depth: 'Eight', channels: 1 },
            encode: { Png: { compression: 'Fast', filter: 'Sub' } },
            color: 'Preserve',
            grade: compiled.grade,
            framing: compiled.framing,
            lens: compiled.lens,
            retouch: compiled.retouch,
            inspect: { LayerMask: { layer: index } }
          })
          const pl = grey8(readFileSync(file))
          const pc = centroid(
            pl.width,
            pl.height,
            (i, x, y) =>
              within(((x + 0.5) / pl.width) * ow, ((y + 0.5) / pl.height) * oh) && pl.data[i] > 127
          )
          planeD = dist(pc && { x: (pc.x / pl.width) * ow, y: (pc.y / pl.height) * oh }, effect)
        }
        const viaM = own ? applyProjective(toDisplay, own) : null
        const em = dist(effect, marker)
        const le = guess ? dist({ x: guess.x * ow, y: guess.y * oh }, effect) : Number.NaN
        const me = viaM ? dist({ x: viaM.x * ow, y: viaM.y * oh }, effect) : Number.NaN
        rows.push(
          `| ${kase.name} | ${k} | ${ow}×${oh} | ${fmt(marker)} | ${fmt(effect)} | ${num(em)} | ${num(planeD)} | ${num(le)} | ${num(me)} |`
        )
        const what = `${kase.name} / ${k}`
        if (!(em <= 2)) failures.push(`${what}: effect ${num(em)} px from its marker`)
        if (!Number.isNaN(planeD) && !(planeD <= 2))
          failures.push(`${what}: plane ${num(planeD)} px off`)
        if (!Number.isNaN(le) && !(le <= 2)) failures.push(`${what}: loupe ${num(le)} px off`)
        // The matrix leaves the lens grid out: it is the GPU's map of the frame rendered.
        if (!grid && !Number.isNaN(me) && !(me <= 2))
          failures.push(`${what}: matrix ${num(me)} px off`)
      }
    }
    const text = rows.join('\n')
    console.log(text)
    const out = process.env['MASKGEO_OUT']
    if (out) writeFileSync(join(out, 'maskgeo-table.md'), text)
    rmSync(dir, { recursive: true, force: true })
    assert.deepEqual(failures, [])
  }
)
