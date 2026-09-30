/**
 * Upright in the develop view: a mode's suggestion measured on the photo, or
 * guides drawn on it, turned into the transform the recipe keeps.
 */
import type { Transform } from '../../../shared/engine-types'
import type { Recipe } from '../../../shared/recipe'
import { focalOf, type GuideLine, type UprightMode } from '../../../shared/upright'
import { api, errorText } from './api'
import { runJob } from '../state/busy'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'

const ENGINE_MODE = { level: 'Level', vertical: 'Vertical', full: 'Full' } as const

const LABEL: Record<UprightMode, string> = {
  off: 'Off',
  auto: 'Auto',
  level: 'Level',
  vertical: 'Vertical',
  full: 'Full',
  guided: 'Guided'
}

function keep(
  mode: UprightMode,
  suggested: Transform | null,
  focal: number,
  guides: GuideLine[]
): void {
  const dev = useDevelop.getState()
  if (!dev.recipe) return
  const r: Recipe = structuredClone(dev.recipe)
  r.geometry.upright = { ...r.geometry.upright, mode, suggested, focal, guides }
  // The old crop was drawn for the old picture: the new one fits itself.
  r.geometry.crop = null
  dev.replace(r, `Upright: ${LABEL[mode]}`)
}

/**
 * Apply an Upright mode. Auto takes the strongest the photo's lines support —
 * Full, else Vertical, else Level; a mode the lines cannot support is said
 * so, and changes nothing.
 */
export async function applyUpright(mode: UprightMode): Promise<void> {
  const dev = useDevelop.getState()
  const session = dev.session
  if (!session || !dev.recipe) return
  if (mode === 'guided') return startGuides()
  const focal = focalOf(session.info.lens?.focal_35mm)
  if (mode === 'off') return keep('off', null, focal, dev.recipe.geometry.upright.guides)
  const tries = mode === 'auto' ? (['full', 'vertical', 'level'] as const) : [mode]
  let why = ''
  const t = await runJob(
    'Finding the lines',
    async () => {
      for (const m of tries) {
        try {
          return await api.develop.suggestUpright(session.key, ENGINE_MODE[m], focal)
        } catch (err) {
          why = errorText(err)
        }
      }
      return null
    },
    { detail: 'Straight edges measured on the photo' }
  )
  if (!t) {
    useLibrary
      .getState()
      .say(`Not enough straight lines for ${LABEL[mode]}${why ? ` (${why})` : ''}`, 'error')
    return
  }
  keep(mode, t, focal, dev.recipe.geometry.upright.guides)
}

/** Guided: show the frame before the warp, with the guides drawn so far. */
export function startGuides(): void {
  const dev = useDevelop.getState()
  if (!dev.recipe) return
  dev.setGuides(dev.recipe.geometry.upright.guides)
  dev.setTool('upright-guide')
}

/** The guides as a transform: two or more lines, each made vertical or level. */
export async function applyGuides(): Promise<void> {
  const dev = useDevelop.getState()
  const session = dev.session
  if (!session || !dev.recipe) return
  const lines = dev.guides
  if (lines.length < 2)
    return useLibrary.getState().say('Draw at least two guides along edges', 'error')
  const focal = focalOf(session.info.lens?.focal_35mm)
  try {
    const t = await api.develop.uprightFromLines(session.key, lines, focal)
    dev.setTool('none')
    keep('guided', t, focal, lines)
  } catch (err) {
    useLibrary.getState().say(errorText(err), 'error')
  }
}
