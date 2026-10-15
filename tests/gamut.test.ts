/**
 * The gamut warning (E22, soft proofing's first part): what it proofs
 * against, the overlay's threshold, and its plane as the engine renders it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GAMUT_SCALE,
  GAMUT_THRESHOLD,
  SPACE_NAME,
  gamutAlpha,
  softProofTarget
} from '../src/shared/gamutwarning'

test('the warning proofs against the space the Export dialog starts with', () => {
  // Nothing exported yet: the default settings, sRGB.
  assert.deepEqual(softProofTarget(null), {
    to: 'Srgb',
    intent: 'RelativeColorimetric',
    black_point_compensation: true
  })
  // The last export's space, intent and black point.
  assert.deepEqual(
    softProofTarget({
      colorSpace: 'AdobeRgb',
      intent: 'Perceptual',
      blackPointCompensation: false
    }),
    { to: 'AdobeRgb', intent: 'Perceptual', black_point_compensation: false }
  )
  assert.equal(SPACE_NAME.DisplayP3, 'Display P3')
})

test('the overlay marks from 2 ΔE, deeper the further out', () => {
  const at = (dE: number): number => gamutAlpha(dE / GAMUT_SCALE)
  assert.equal(GAMUT_THRESHOLD, 2)
  assert.equal(at(0), 0)
  assert.equal(at(1.99), 0)
  assert.equal(at(2), 0.55)
  assert.ok(at(3) > at(2) && at(3) < at(4))
  assert.ok(Math.abs(at(GAMUT_SCALE) - 0.9) < 1e-9)
  // The plane's 8 bits: 128 (just past 2 ΔE) marked, 127 not.
  assert.ok(gamutAlpha(128 / 255) > 0)
  assert.equal(gamutAlpha(127 / 255), 0)
})

/** The native engine, where it is built (not in CI: this check skips). */
const realEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown): Promise<{ width: number; inspected: string | null }>
    }
  } catch {
    return null
  }
})()

test(
  'the engine marks a colour past the export’s space and holds the rest',
  { skip: realEngine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { gamutWarningRequest } = await import('../src/main/proofing')
    const { withRequiredFields } = await import('../src/main/engine/required')
    const { CICP_DISPLAY_P3, encodePng8, grey8 } = await import('../src/main/pngio')
    const { compile } = await import('../src/shared/compile')
    const { defaultRecipe } = await import('../src/shared/recipe')
    const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'gamut-'))
    // A Display P3 green past sRGB's on the left half, a mid grey on the right.
    const w = 32
    const h = 16
    const rgba = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++)
      rgba.set(i % w < w / 2 ? [40, 250, 40, 255] : [128, 128, 128, 255], i * 4)
    const path = join(dir, 'p3.png')
    writeFileSync(path, encodePng8(rgba, w, h, 1, [CICP_DISPLAY_P3]))
    const info = { is_hdr: false } as never
    const src = { path, input: 'Png' as const }
    const plain = { grade: null, framing: null, lens: null, retouch: null }
    const send = (r: unknown): ReturnType<NonNullable<typeof realEngine>['convert']> =>
      realEngine!.convert(withRequiredFields('convert', [r])[0])
    const out = join(dir, 'plane.png')
    const target = {
      to: 'Srgb' as const,
      intent: 'RelativeColorimetric' as const,
      black_point_compensation: true
    }
    try {
      const r = await send(gamutWarningRequest(src, out, info, plain, target, 2))
      assert.match(String(r.inspected), /ΔE2000/)
      const plane = grey8(readFileSync(out))
      const at = (x: number): number => plane.data[(h / 2) * plane.width + x]
      assert.ok(gamutAlpha(at(2) / 255) > 0, `P3 green marked against sRGB (${at(2)})`)
      assert.equal(at(w - 3), 0, 'grey is held')
      // Against Display P3 itself nothing is out.
      await send(gamutWarningRequest(src, out, info, plain, { ...target, to: 'DisplayP3' }, 2))
      assert.ok(grey8(readFileSync(out)).data.every((v) => gamutAlpha(v / 255) === 0))
      // With an edit, as the settled picture is graded.
      const edited = defaultRecipe(false)
      edited.basic.exposure = 0.1
      const graded = compile(edited, {
        isRaw: false,
        asShot: null,
        sourceOrientation: 'Normal',
        frameWidth: w,
        frameHeight: h,
        scale: 1,
        seed: 7,
        brushPaths: {},
        applyCrop: true
      })
      const g = await send(gamutWarningRequest(src, out, info, graded, target, 2))
      assert.equal(g.width, w)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
