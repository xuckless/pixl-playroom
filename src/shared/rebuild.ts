/**
 * Rebuild with the latest develop: a photo edited with the earlier pipeline
 * made again with today's. On a RAW the PIXL demosaic develops it and
 * denoises as it goes, so its denoise (PMRID, AI Denoise steps) goes; on any
 * other photo a denoise step becomes PIXL Enhance's "Clean up + denoise";
 * Enhance steps are made again with PIXL Enhance (JPEG restore and Deblur
 * become its levels, Super resolution kept); steps made from an older RAW
 * develop (heals, Enhance) are made again from the new one, and the masks
 * a model found are found again on it. Main does it (main/rebuild.ts),
 * after a Version of the photo as it was. Pure, for tests.
 */
import { normaliseEnhance, withPixl, type EnhanceSettings } from './enhance'
import type { RawCfa } from './engine-types'
import type { PixelStep } from './pixels'
import type { Recipe } from './recipe'

/** What today's pipeline has on this computer (a development kit's roster, its switch). */
export interface Pipeline {
  /** The PIXL demosaic develops RAWs (offered and switched on). */
  pixlDemosaic: boolean
  /** PIXL Enhance is offered. */
  pixlEnhance: boolean
}

/**
 * A RAW step's develop mark (`params.develop`) with the PIXL demosaic
 * named: `+pd`, or `+pdg` on a Bayer sensor since engine 0.21.0 (E64: its
 * red and blue told the greens' noise line, so a Bayer master moved, and a
 * step made on 0.20's is from an older develop). X-Trans did not move.
 */
export function pixlMark(mark: string, pixl: boolean, cfa: RawCfa | null = null): string {
  if (!pixl) return mark
  return cfa === 'Bayer' ? `${mark}+pdg` : `${mark}+pd`
}

/** Whether a step's mark names the PIXL demosaic (either generation). */
function byPixl(develop: unknown): boolean {
  return typeof develop === 'string' && /\+pdg?$/.test(develop)
}

export type RebuildReason = 'rawDenoise' | 'denoise' | 'staleSteps' | 'oldEnhance'

/** An Enhance step made before PIXL Enhance with a JPEG restore or a Deblur in it. */
export function oldEnhance(s: PixelStep): boolean {
  if (s.kind !== 'enhance') return false
  const settings = settingsOf(s)
  return settings.pixl === 'off' && (settings.jpeg !== 'off' || settings.deblur)
}

function settingsOf(s: PixelStep): EnhanceSettings {
  try {
    return normaliseEnhance(
      typeof s.params.settings === 'string'
        ? (JSON.parse(s.params.settings) as Partial<EnhanceSettings>)
        : undefined
    )
  } catch {
    return normaliseEnhance(undefined)
  }
}

/**
 * Why a photo is on the earlier pipeline (none: it is on today's). `mark`
 * is a RAW's develop mark today (`pixlMark`), what its steps' marks are told
 * against.
 */
export function rebuildReasons(
  r: Recipe,
  isRaw: boolean,
  p: Pipeline,
  mark: string | null
): RebuildReason[] {
  const out = new Set<RebuildReason>()
  if (isRaw && p.pixlDemosaic) {
    if (r.detail.rawDenoise || r.detail.ai.enabled) out.add('rawDenoise')
    if (r.pixels.some((s) => s.kind === 'denoise')) out.add('denoise')
    if (mark && r.pixels.some((s) => s.kind !== 'denoise' && s.params.develop !== mark))
      out.add('staleSteps')
  }
  if (!isRaw && p.pixlEnhance && r.pixels.some((s) => s.kind === 'denoise')) out.add('denoise')
  if (p.pixlEnhance && r.pixels.some(oldEnhance)) out.add('oldEnhance')
  return [...out]
}

/** One step made again, in recipe order: as PIXL Enhance (settings), or a heal baked again. */
export type Redo =
  { id: string; kind: 'enhance'; settings: EnhanceSettings } | { id: string; kind: 'heal' }

export interface RebuildPlan {
  /** The recipe with what goes gone (a RAW's denoise), the steps to make again still in place. */
  recipe: Recipe
  redo: Redo[]
  /** The model-made mask components to find again (a RAW's develop changed). */
  masks: { layerId: string; componentId: string }[]
}

/** PIXL Enhance's settings for an old step: its JPEG restore and Deblur as levels, its upscale kept. */
export function pixlSettingsFor(old: EnhanceSettings): EnhanceSettings {
  const pixl =
    old.pixl !== 'off' ? old.pixl : old.deblur ? 'sharpen' : old.jpeg !== 'off' ? 'clean' : 'off'
  return { ...withPixl(old), pixl }
}

/** What a rebuild does to `r` (`rebuildReasons` says whether it is wanted). */
export function rebuildPlan(
  r: Recipe,
  isRaw: boolean,
  p: Pipeline,
  mark: string | null
): RebuildPlan {
  const recipe = structuredClone(r)
  const redo: Redo[] = []
  const develops = isRaw && p.pixlDemosaic
  if (develops) {
    recipe.detail.rawDenoise = false
    recipe.detail.ai = { ...recipe.detail.ai, enabled: false }
    // The PIXL demosaic denoises as it develops: no denoise step on it.
    recipe.pixels = recipe.pixels.filter((s) => s.kind !== 'denoise')
  }
  const stale = (s: PixelStep): boolean => develops && !!mark && s.params.develop !== mark
  for (const s of recipe.pixels) {
    if (s.kind === 'denoise' && p.pixlEnhance)
      redo.push({
        id: s.id,
        kind: 'enhance',
        settings: { ...withPixl(normaliseEnhance(undefined)), pixl: 'denoise', upscale: 'off' }
      })
    else if (s.kind === 'enhance' && ((p.pixlEnhance && oldEnhance(s)) || stale(s))) {
      const settings = p.pixlEnhance ? pixlSettingsFor(settingsOf(s)) : settingsOf(s)
      // Nothing left for it to do (an old step of nothing PIXL Enhance does, no upscale).
      if (settings.pixl !== 'off' || settings.upscale !== 'off')
        redo.push({ id: s.id, kind: 'enhance', settings })
    } else if (s.kind === 'retouch' && stale(s)) redo.push({ id: s.id, kind: 'heal' })
  }
  const masks = develops
    ? recipe.layers.flatMap((l) =>
        l.components
          .filter((c) => c.kind === 'depth' || (c.kind === 'brush' && !!c.source))
          .map((c) => ({ layerId: l.id, componentId: c.id }))
      )
    : []
  return { recipe, redo, masks }
}

/** What of the earlier pipeline a recipe holds, whatever this computer has (kept per item in the index). */
export const LEGACY = {
  /** A RAW's mosaic denoise (PMRID) or the old AI denoise setting on. */
  rawDenoise: 1,
  /** AI Denoise steps. */
  denoise: 2,
  /** Enhance steps from before PIXL Enhance with a JPEG restore or a Deblur. */
  oldEnhance: 4,
  /** RAW steps made from a develop other than the PIXL demosaic's. */
  notPixl: 8
} as const

export function legacyBits(r: Recipe | null, isRaw: boolean): number {
  if (!r) return 0
  let bits = 0
  if (isRaw && (r.detail.rawDenoise || r.detail.ai.enabled)) bits |= LEGACY.rawDenoise
  if (r.pixels.some((s) => s.kind === 'denoise')) bits |= LEGACY.denoise
  if (r.pixels.some(oldEnhance)) bits |= LEGACY.oldEnhance
  if (isRaw && r.pixels.some((s) => s.kind !== 'denoise' && !byPixl(s.params.develop)))
    bits |= LEGACY.notPixl
  return bits
}

/** Whether an item's legacy bits make it a photo to rebuild, with this computer's pipeline. */
export function olderDevelop(bits: number, isRaw: boolean, p: Pipeline): boolean {
  if (isRaw && p.pixlDemosaic && bits & (LEGACY.rawDenoise | LEGACY.denoise | LEGACY.notPixl))
    return true
  if (!isRaw && p.pixlEnhance && bits & LEGACY.denoise) return true
  return p.pixlEnhance && (bits & LEGACY.oldEnhance) !== 0
}
