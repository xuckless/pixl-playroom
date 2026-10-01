import { useEffect, useState } from 'react'
import {
  BUILTIN_CURVES,
  matchingPreset,
  presetCurve,
  type CurvePreset
} from '../../../shared/curves'
import type { ToneCurveSetting } from '../../../shared/recipe'
import { Select } from '../components/ui'
import { api } from '../lib/api'
import { scoped, useScope } from '../state/scope'
import { useLibrary } from '../state/library'

/** A whole tone curve the user saved under a name. */
interface SavedCurve {
  name: string
  curve: ToneCurveSetting
}

/** Kept in the index's settings beside the white-balance and mask presets. */
const CURVE_PRESETS_KEY = 'curve.presets'

/**
 * Apply a built-in or saved tone curve, save the current one, or delete a
 * saved one. A preset replaces the whole tone curve, regions and channels.
 * The menu shows the preset the curve is now (a saved one before a built-in
 * of the same shape), or that it is a curve of its own.
 */
export function CurvePresets(): React.JSX.Element {
  const { replace, recipe: shown } = useScope()
  const toneCurve = shown?.toneCurve
  const [saved, setSaved] = useState<SavedCurve[]>([])
  const [naming, setNaming] = useState<string | null>(null)
  useEffect(() => {
    void api.app
      .getSetting<SavedCurve[]>(CURVE_PRESETS_KEY)
      .then((v) => setSaved(Array.isArray(v) ? v : []))
  }, [])
  const store = async (next: SavedCurve[]): Promise<void> => {
    setSaved(next)
    await api.app.setSetting(CURVE_PRESETS_KEY, next)
  }
  const apply = (p: CurvePreset): void => {
    const recipe = scoped.recipe()
    if (!recipe) return
    // Fill from the untouched curve, so what a preset leaves out is reset.
    replace({ ...recipe, toneCurve: presetCurve(p) }, `Curve preset: ${p.name}`)
  }
  const saveCurrent = async (name: string): Promise<void> => {
    const recipe = scoped.recipe()
    if (!recipe) return
    const entry: SavedCurve = { name, curve: structuredClone(recipe.toneCurve) }
    await store([...saved.filter((p) => p.name !== name), entry])
    useLibrary.getState().say(`Saved curve preset "${name}"`)
  }
  const choose = (v: string): void => {
    if (v === 'save') return setNaming('')
    const name = v.slice(v.indexOf(':') + 1)
    if (v.startsWith('builtin:')) {
      const p = BUILTIN_CURVES.find((x) => x.name === name)
      if (p) apply(p)
      return
    }
    const p = saved.find((x) => x.name === name)
    if (!p) return
    if (v.startsWith('del:')) {
      void store(saved.filter((x) => x.name !== name))
      return
    }
    apply(p)
  }
  const finish = (): void => {
    const name = naming?.trim()
    if (name) void saveCurrent(name)
    setNaming(null)
  }
  const mine = toneCurve && matchingPreset(toneCurve, saved)
  const builtin = toneCurve && !mine ? matchingPreset(toneCurve, BUILTIN_CURVES) : undefined
  const current = mine ? `use:${mine.name}` : builtin ? `builtin:${builtin.name}` : ''
  return (
    <>
      <div className="row">
        <Select
          label="Preset"
          value={current}
          onChange={choose}
          options={[
            // Only a curve no preset makes lands here; choosing a preset never does.
            ...(current === '' ? [{ value: '', label: 'Custom curve' }] : []),
            ...BUILTIN_CURVES.map((p) => ({ value: `builtin:${p.name}`, label: p.name })),
            ...saved.map((p) => ({ value: `use:${p.name}`, label: `★ ${p.name}` })),
            { value: 'save', label: 'Save this curve as a preset…' },
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
