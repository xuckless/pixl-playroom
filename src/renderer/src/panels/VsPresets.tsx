import { useEffect, useState } from 'react'
import {
  normaliseCurvesVs,
  sameVs,
  VS_PRESETS,
  type VsCurve,
  type VsPreset
} from '../../../shared/resolve'
import { Select } from '../components/ui'
import { api } from '../lib/api'
import { scoped, useScope } from '../state/scope'
import { useLibrary } from '../state/library'
import { t } from '../lib/i18n'

/** Kept in the index's settings beside the tone curve presets: each vs curve its own list. */
const VS_PRESETS_KEY = 'curve.vsPresets'

type Saved = Partial<Record<VsCurve, VsPreset[]>>

/** A preset's points as the curve holds them (sorted, one per x). */
const pointsOf = (vs: VsCurve, p: VsPreset): VsPreset['points'] =>
  normaliseCurvesVs({ [vs]: p.points })[vs]

/**
 * The Resolve Curves' preset menu for one vs curve, as the tone curve's is
 * (CurvePresets.tsx): apply a built-in or saved curve, save this one, or
 * delete a saved one. A preset replaces the whole curve. The menu shows the
 * preset the curve is now (a saved one before a built-in), or that it is
 * one of its own.
 */
export function VsPresets({ vs, label }: { vs: VsCurve; label: string }): React.JSX.Element {
  const { replace, recipe: shown } = useScope()
  const pts = shown?.curvesVs[vs]
  const [saved, setSaved] = useState<Saved>({})
  const [naming, setNaming] = useState<string | null>(null)
  useEffect(() => {
    void api.app
      .getSetting<Saved>(VS_PRESETS_KEY)
      .then((v) => setSaved(v && typeof v === 'object' ? v : {}))
  }, [])
  const mineList = saved[vs] ?? []
  const store = async (list: VsPreset[]): Promise<void> => {
    const next = { ...saved, [vs]: list }
    setSaved(next)
    await api.app.setSetting(VS_PRESETS_KEY, next)
  }
  const apply = (p: VsPreset): void => {
    const recipe = scoped.recipe()
    if (!recipe) return
    replace(
      { ...recipe, curvesVs: { ...recipe.curvesVs, [vs]: pointsOf(vs, p) } },
      `${label} preset: ${p.name}`
    )
  }
  const choose = (v: string): void => {
    if (v === 'save') return setNaming('')
    const name = v.slice(v.indexOf(':') + 1)
    if (v.startsWith('builtin:')) {
      const p = VS_PRESETS[vs].find((x) => x.name === name)
      if (p) apply(p)
      return
    }
    const p = mineList.find((x) => x.name === name)
    if (!p) return
    if (v.startsWith('del:')) {
      void store(mineList.filter((x) => x.name !== name))
      return
    }
    apply(p)
  }
  const finish = (): void => {
    const name = naming?.trim()
    setNaming(null)
    const recipe = scoped.recipe()
    if (!name || !recipe) return
    const entry: VsPreset = { name, points: structuredClone(recipe.curvesVs[vs]) }
    void store([...mineList.filter((p) => p.name !== name), entry]).then(() =>
      useLibrary.getState().say(t('Saved curve preset "{{name}}"', { name }))
    )
  }
  const mine = pts && mineList.find((p) => sameVs(pointsOf(vs, p), pts))
  const builtin =
    pts && !mine ? VS_PRESETS[vs].find((p) => sameVs(pointsOf(vs, p), pts)) : undefined
  const current = mine ? `use:${mine.name}` : builtin ? `builtin:${builtin.name}` : ''
  return (
    <>
      <div className="row">
        <Select
          label={t('Preset')}
          value={current}
          onChange={choose}
          options={[
            // Only a curve no preset makes lands here; choosing a preset never does.
            ...(current === '' ? [{ value: '', label: t('Custom curve') }] : []),
            ...VS_PRESETS[vs].map((p) => ({ value: `builtin:${p.name}`, label: t(p.name) })),
            ...mineList.map((p) => ({ value: `use:${p.name}`, label: `★ ${p.name}` })),
            { value: 'save', label: t('Save this curve as a preset…') },
            ...mineList.map((p) => ({
              value: `del:${p.name}`,
              label: t('Delete "{{name}}"', { name: p.name })
            }))
          ]}
        />
      </div>
      {naming !== null && (
        <div className="row">
          <input
            className="name"
            autoFocus
            placeholder={t('Preset name')}
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') finish()
              if (e.key === 'Escape') setNaming(null)
            }}
          />
          <button disabled={!naming.trim()} onClick={finish}>
            {t('Save')}
          </button>
        </div>
      )}
    </>
  )
}
