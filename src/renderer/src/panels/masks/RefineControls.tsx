/**
 * Snap to edges, by method (engine 0.19.2, Phase A §4.2), and the drawn
 * edge's Smooth and Contrast (§4.1, Photoshop's Select and Mask).
 *
 * One dropdown picks how an edge snaps: Off, or one of the engine's methods
 * by what it's for. Under it one Strength slider (Guided's is its Edge
 * radius), and an Advanced fold with every parameter in the engine's own
 * units. No method is preselected for a mask the user snaps: the owner's
 * call (no default; the user picks), so Snap to edges starts on the quickest,
 * Guided, as it always has, and the choice stays the user's.
 *
 * EdgeSnap, the solver and Matting read the whole frame: while a slider
 * moves, the drag renders Guided in their place (compile.ts, a draft), and
 * the method itself on release.
 */
import type { MaskComponentSetting, MaskRefine, RefineKind } from '../../../../shared/recipe'
import {
  defaultStrength,
  paramValue,
  refineMethod,
  REFINE_METHODS,
  strengthOf,
  type RefineMethodInfo,
  type RefineParam
} from '../../../../shared/refine'
import type { Tip } from '../../components/InfoTip'
import { Section, Select, Slider } from '../../components/ui'
import { t, tk } from '../../lib/i18n'

/** The dropdown's line for each method: its name and what it's for, so the choice reads at a glance. */
const OPTION: Record<RefineKind, string> = {
  guided: tk('Guided · quick'),
  guidedColour: tk('Guided colour · colour edges'),
  edgeSnap: tk('Edge snap · skies, buildings'),
  solver: tk('Soft snap · soft edges'),
  matting: tk('Hair and fine detail · people')
}

const OFF_TIP: Tip = {
  what: tk('Snap to edges pulls this edge onto the photo’s own edges, at full resolution.'),
  expect: tk(
    'Pick a method by what the mask is of: Guided for most, Edge snap for skies and buildings, Hair and fine detail for people.'
  ),
  tip: tk('The quick methods follow your slider live; the others are applied when you let go.')
}

/** A method's (i): what it does and what to expect. */
function methodTip(m: RefineMethodInfo): Tip {
  return {
    what: m.what,
    expect: m.expect,
    ...(m.whole
      ? { tip: tk('While a slider moves you see Guided; this method is applied when you let go.') }
      : {})
  }
}

/**
 * A length is shown, and typed, as a percentage of the shorter side: the
 * slider works in that unit, so the number typed is the number meant (a
 * reading of 0.50% typed back as 0.5 is not half the frame).
 */
const shown = (p: RefineParam): number => (p.unit === 'short' ? 100 : 1)

/** A parameter's slider reading, in the slider's own unit (`shown`). */
function formatParam(p: RefineParam, v: number): string {
  if (p.unit === 'short') return `${v.toFixed(2)}%`
  if (p.step >= 1) return String(Math.round(v))
  return v < 0.01 ? v.toExponential(1) : v.toFixed(3)
}

/** A method's Advanced settings: each parameter in the engine's units, reset to what Strength sets. */
export function AdvancedParams({
  m,
  refine,
  onChange,
  onCommit
}: {
  m: RefineMethodInfo
  refine: MaskRefine | undefined
  onChange: (key: string, v: number, live: boolean) => void
  onCommit: () => void
}): React.JSX.Element | null {
  if (m.params.length === 0) return null
  return (
    <Section
      id="masks.snap.settings"
      title={t('Snap settings')}
      tip={{ what: tk('Every setting of this method, in the engine’s own units') }}
      defaultOpen={false}
    >
      {m.params.map((p) => (
        <Slider
          key={p.key}
          label={t(p.label)}
          adjusts={false}
          value={paramValue(m, refine, p.key) * shown(p)}
          min={p.min * shown(p)}
          max={p.max * shown(p)}
          step={p.step * shown(p)}
          scale={p.max / p.min > 100 ? 'log' : 'linear'}
          def={p.def * shown(p)}
          format={(v) => formatParam(p, v)}
          onChange={(v, live) => onChange(p.key, v / shown(p), live)}
          onCommit={onCommit}
        />
      ))}
    </Section>
  )
}

/**
 * The refine's method dropdown, Strength and Advanced, for a mask component.
 * `setRefine` changes the component's refine (or turns it off with null).
 */
export function RefineControls({
  c,
  radiusDef,
  radiusMin,
  radiusMax,
  setRefine,
  commit
}: {
  c: MaskComponentSetting
  radiusDef: number
  radiusMin: number
  radiusMax: number
  /**
   * The new refine, or `{ on: false }`. Resolves once the caller has made
   * the change, false when it did not (a stroke needs SAM first, and its
   * download was declined): a History step is recorded only for a change made.
   */
  setRefine: (fn: (r: MaskRefine) => MaskRefine, live?: boolean) => Promise<boolean>
  commit: (label: string) => void
}): React.JSX.Element {
  const r = c.refine
  const on = r?.on === true
  const m = refineMethod(r?.method)
  const value: RefineKind | 'off' = on ? m.kind : 'off'
  const guided = m.kind === 'guided' || m.kind === 'guidedColour'
  const pick = (v: RefineKind | 'off'): void => {
    if (v === 'off') {
      void setRefine((x) => ({ ...x, on: false })).then(
        (made) => made && commit(tk('Snap to edges off'))
      )
      return
    }
    const next = refineMethod(v)
    void setRefine((x) => {
      // A method's own settings start fresh; Guided keeps the radius it had.
      const { params: _params, strength: _strength, ...rest } = x
      void _params
      void _strength
      return {
        ...rest,
        on: true,
        ...(v === 'guided' ? { method: undefined } : { method: v }),
        ...(next.strength ? { strength: defaultStrength(next) } : {})
      }
      // The step is named in English, as every step is kept (translated where History shows it).
    }).then((made) => made && commit(next.label))
  }
  return (
    <>
      <Select
        label={t('Snap to edges')}
        value={value}
        tip={on ? methodTip(m) : OFF_TIP}
        options={[
          { value: 'off', label: t('Off') },
          ...REFINE_METHODS.map((x) => ({ value: x.kind, label: t(OPTION[x.kind]) }))
        ]}
        onChange={pick}
      />
      {on && guided && (
        <Slider
          label={t('Edge radius')}
          adjusts={false}
          value={r?.radius ?? radiusDef}
          min={radiusMin}
          max={radiusMax}
          step={0.05}
          scale="log"
          def={radiusDef}
          format={(v) => `${v.toFixed(2)}%`}
          tip={{
            what: tk(
              "How far the photo's edges may pull this one, as a share of its shorter side."
            ),
            expect: tk('About three times how far off the edge is. Too wide and a halo comes back.')
          }}
          onChange={(v, live) =>
            setRefine((x) => ({ ...x, on: true, radius: Math.round(v * 100) / 100 }), live)
          }
          onCommit={() => commit(tk('Edge radius'))}
        />
      )}
      {on && !guided && (
        <Slider
          label={t('Strength')}
          adjusts={false}
          value={
            typeof r?.params?.[m.strength ?? ''] === 'number'
              ? strengthOf(m, r!.params![m.strength!])
              : (r?.strength ?? defaultStrength(m))
          }
          min={0}
          max={100}
          def={defaultStrength(m)}
          tip={{
            what: tk('How far the method reaches from the edge you drew or found.'),
            expect: tk(
              'Higher catches an edge that is further off; too high and it may jump to the wrong one.'
            )
          }}
          onChange={(v, live) =>
            setRefine((x) => {
              // Strength sets the main parameter: an Advanced value for it gives way.
              const params = { ...(x.params ?? {}) }
              if (m.strength) delete params[m.strength]
              return {
                ...x,
                on: true,
                strength: v,
                ...(Object.keys(params).length ? { params } : { params: undefined })
              }
            }, live)
          }
          onCommit={() => commit(tk('Snap strength'))}
        />
      )}
      {on && (
        <AdvancedParams
          m={m}
          refine={r}
          onChange={(key, v, live) =>
            setRefine((x) => ({ ...x, on: true, params: { ...(x.params ?? {}), [key]: v } }), live)
          }
          onCommit={() => commit(tk('Snap settings'))}
        />
      )}
    </>
  )
}
