import { useEffect, useState } from 'react'
import {
  neutralSettings,
  settingsFromAdjust,
  ZERO_LOCAL,
  type LayerSettings,
  type LocalAdjust,
  type LocalLayer
} from '../../../../shared/recipe'
import { Select } from '../../components/ui'
import { api } from '../../lib/api'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { changeLayer } from './model'

/**
 * A mask's settings and Amount saved under a name ("Sky darken"), for any
 * mask. Presets saved before masks had the panels' settings hold `adjust`.
 */
interface MaskPreset {
  name: string
  settings?: LayerSettings
  adjust?: LocalAdjust
  amount: number
}

/** A preset's settings, whichever version saved it; filled from neutral either way. */
function presetSettings(p: MaskPreset): LayerSettings {
  if (p.settings) return { ...neutralSettings(), ...structuredClone(p.settings) }
  return settingsFromAdjust({ ...ZERO_LOCAL, ...p.adjust })
}

/** Kept in the index's settings beside the white-balance presets. */
const MASK_PRESETS_KEY = 'mask.presets'

/**
 * Save the selected mask's adjustments as a preset, apply one, or delete one.
 * Only the sliders and Amount travel: a mask's shapes belong to its photo.
 */
export function MaskPresets({ layer }: { layer: LocalLayer }): React.JSX.Element {
  const commit = useDevelop((s) => s.commit)
  const [saved, setSaved] = useState<MaskPreset[]>([])
  const [naming, setNaming] = useState<string | null>(null)
  useEffect(() => {
    void api.app
      .getSetting<MaskPreset[]>(MASK_PRESETS_KEY)
      .then((v) => setSaved(Array.isArray(v) ? v : []))
  }, [])
  const store = async (next: MaskPreset[]): Promise<void> => {
    setSaved(next)
    await api.app.setSetting(MASK_PRESETS_KEY, next)
  }
  const saveCurrent = async (name: string): Promise<void> => {
    const entry: MaskPreset = {
      name,
      settings: structuredClone(layer.settings),
      amount: layer.amount
    }
    await store([...saved.filter((p) => p.name !== name), entry])
    useLibrary.getState().say(`Saved mask preset "${name}"`)
  }
  const choose = (v: string): void => {
    if (v === 'save') return setNaming('')
    const name = v.slice(v.indexOf(':') + 1)
    const p = saved.find((x) => x.name === name)
    if (!p) return
    if (v.startsWith('del:')) {
      void store(saved.filter((x) => x.name !== name))
      return
    }
    changeLayer((l) => {
      l.settings = presetSettings(p)
      l.amount = p.amount
    })
    commit(`${layer.name}: preset ${p.name}`)
  }
  const finish = (): void => {
    const name = naming?.trim()
    if (name) void saveCurrent(name)
    setNaming(null)
  }
  return (
    <>
      <div className="row">
        <Select
          label="Preset"
          value=""
          onChange={choose}
          options={[
            { value: '', label: saved.length ? 'Apply a preset…' : 'No presets yet' },
            ...saved.map((p) => ({ value: `use:${p.name}`, label: `★ ${p.name}` })),
            { value: 'save', label: "Save this mask's settings as a preset…" },
            ...saved.map((p) => ({ value: `del:${p.name}`, label: `Delete "${p.name}"` }))
          ]}
        />
      </div>
      {naming !== null && (
        <div className="row">
          <input
            className="name"
            autoFocus
            placeholder="Preset name"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') finish()
              if (e.key === 'Escape') setNaming(null)
            }}
          />
          <button disabled={!naming.trim()} onClick={finish}>
            Save
          </button>
        </div>
      )}
    </>
  )
}
