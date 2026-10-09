import { useEffect, useState } from 'react'
import {
  neutralSettings,
  settingsFromAdjust,
  ZERO_LOCAL,
  type LayerSettings,
  type LocalAdjust,
  type LocalLayer
} from '../../../../shared/recipe'
import { api } from '../../lib/api'
import { t } from '../../lib/i18n'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { patchMask } from './model'

/**
 * A mask's settings and Amount saved under a name ("Sky darken"), for any
 * mask. Presets saved before masks had the panels' settings hold `adjust`.
 * Only the sliders and Amount travel: a mask's shapes belong to its photo.
 */
export interface MaskPreset {
  name: string
  settings?: LayerSettings
  adjust?: LocalAdjust
  amount: number
}

/** Kept in the index's settings beside the white-balance presets. */
const MASK_PRESETS_KEY = 'mask.presets'

/** A preset's settings, whichever version saved it; filled from neutral either way. */
function presetSettings(p: MaskPreset): LayerSettings {
  if (p.settings) return { ...neutralSettings(), ...structuredClone(p.settings) }
  return settingsFromAdjust({ ...ZERO_LOCAL, ...p.adjust })
}

/** Every window showing the list hears a save or a delete made in another. */
const listeners = new Set<(list: MaskPreset[]) => void>()

async function store(next: MaskPreset[]): Promise<void> {
  listeners.forEach((l) => l(next))
  await api.app.setSetting(MASK_PRESETS_KEY, next)
}

/** The saved mask presets, and what can be done with them. */
export function useMaskPresets(): {
  presets: MaskPreset[]
  save: (layer: LocalLayer, name: string) => Promise<void>
  apply: (layer: LocalLayer, p: MaskPreset) => void
  remove: (name: string) => Promise<void>
} {
  const [presets, setPresets] = useState<MaskPreset[]>([])
  useEffect(() => {
    let on = true
    void api.app
      .getSetting<MaskPreset[]>(MASK_PRESETS_KEY)
      .then((v) => on && setPresets(Array.isArray(v) ? v : []))
    listeners.add(setPresets)
    return () => {
      on = false
      listeners.delete(setPresets)
    }
  }, [])
  return {
    presets,
    save: async (layer, name) => {
      const entry: MaskPreset = {
        name,
        settings: structuredClone(layer.settings),
        amount: layer.amount
      }
      await store([...presets.filter((p) => p.name !== name), entry])
      useLibrary.getState().say(t('Saved mask preset "{{name}}"', { name }))
    },
    apply: (layer, p) =>
      patchMask(layer.id, `${layer.name}: preset ${p.name}`, (l) => {
        l.settings = presetSettings(p)
        l.amount = p.amount
      }),
    remove: (name) => store(presets.filter((p) => p.name !== name))
  }
}

/** The selected mask, for the presets list: null when none is. */
export function useSelectedMask(): LocalLayer | null {
  return useDevelop((s) => s.recipe?.layers.find((l) => l.id === s.layerId) ?? null)
}
