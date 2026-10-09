import { useMemo, useState } from 'react'
import {
  changedGroups,
  defaultRecipe,
  GROUP_LABELS,
  RECIPE_GROUPS,
  type RecipeGroup
} from '../../../shared/recipe'
import { toInstructions } from '../../../shared/looks/smart'
import { savedWhite } from '../../../shared/wbconvert'
import { Modal } from '../components/ui'
import { api, errorText } from '../lib/api'
import { autoWbBatch } from '../lib/autowb'
import { presetsChanged } from '../lib/hooks'
import { useDevelop } from '../state/develop'
import { useLibrary, useTargets } from '../state/library'
import { keyHint, withKey } from '../lib/commands'
import { t, tk, tp } from '../lib/i18n'

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** Paste or sync: copy chosen groups of a recipe onto the selection. */
export function SyncDialog(): React.JSX.Element {
  const targets = useTargets()
  const setDialog = useLibrary((s) => s.setDialog)
  const patchItems = useLibrary((s) => s.patchItems)
  const say = useLibrary((s) => s.say)
  const clipboard = useLibrary((s) => s.clipboard)
  const developRecipe = useDevelop((s) => s.recipe)
  const developKey = useDevelop((s) => s.session?.key)
  const developRaw = useDevelop((s) => s.session?.isRaw ?? false)
  const source = clipboard?.recipe ?? developRecipe
  // What differs from the photo's own defaults (a RAW's profile, sharpening
  // and noise reduction are not edits).
  const initial = new Set<RecipeGroup>(
    clipboard?.groups ??
      (source
        ? changedGroups(source, defaultRecipe(developRaw)).filter(
            (g) => g !== 'crop' && g !== 'upright' && g !== 'localAdjustments' && g !== 'retouch'
          )
        : [])
  )
  const [groups, setGroups] = useState<Set<RecipeGroup>>(initial)
  // The white balance either travels (converted to each photo's kind) or
  // each photo gets its own, measured by auto white balance.
  const [wbMode, setWbMode] = useState<'copy' | 'auto'>('copy')
  const keys = targets.filter((k) => k !== developKey || clipboard !== null)
  const autoWb = groups.has('whiteBalance') && wbMode === 'auto'
  const copied = [...groups].filter((g) => !(autoWb && g === 'whiteBalance'))
  return (
    <Modal
      title={tp(
        'Apply settings to {{count}} photo',
        'Apply settings to {{count}} photos',
        keys.length
      )}
      onClose={() => setDialog(null)}
      icon="copy"
      footer={
        <button
          className="primary"
          disabled={(!source && copied.length > 0) || keys.length === 0 || groups.size === 0}
          onClick={async () => {
            try {
              if (source && copied.length > 0) {
                patchItems(
                  await api.library.applyRecipe(
                    keys,
                    source,
                    copied,
                    clipboard?.source ?? developKey ?? undefined
                  )
                )
                // The open photo's sync is a step of its history, undone on its own.
                const dev = useDevelop.getState
                if (developKey && keys.includes(developKey) && dev().session?.key === developKey) {
                  const s = await api.develop.open(developKey)
                  if (dev().session?.key === developKey)
                    dev().replace(s.recipe, tk('Sync settings'))
                }
              }
              setDialog(null)
              // The batch shows its own progress and ends with an Undo.
              if (autoWb) void autoWbBatch(keys)
              else say(tp('Applied to {{count}} photo', 'Applied to {{count}} photos', keys.length))
            } catch (err) {
              say(errorText(err), 'error')
            }
          }}
        >
          {t('Apply')}
        </button>
      }
    >
      {!source && (
        <p>
          {t('Copy settings from a photo first ({{key}} in Develop).', {
            key: keyHint('settings.copy') || t('Copy settings')
          })}
        </p>
      )}
      <p>
        {t(
          'Chosen groups overwrite the same groups on each target. Everything else on the targets is kept.'
        )}
      </p>
      <div className="quick-row">
        <button className="chip" onClick={() => setGroups(new Set(RECIPE_GROUPS))}>
          {t('All')}
        </button>
        <button className="chip" onClick={() => setGroups(new Set())}>
          {t('None')}
        </button>
        <button className="chip" onClick={() => setGroups(new Set(['whiteBalance']))}>
          {t('White balance only')}
        </button>
      </div>
      <div className="rule" />
      <div className="group-checks">
        {RECIPE_GROUPS.map((g) => (
          <label key={g} className="check">
            <input
              type="checkbox"
              checked={groups.has(g)}
              onChange={(e) => {
                const n = new Set(groups)
                if (e.target.checked) n.add(g)
                else n.delete(g)
                setGroups(n)
              }}
            />
            {t(GROUP_LABELS[g])}
          </label>
        ))}
      </div>
      {groups.has('whiteBalance') && (
        <>
          <div className="rule" />
          <div className="quick-row" role="radiogroup" aria-label={t('White balance')}>
            <span className="micro" style={{ alignSelf: 'center' }}>
              {t('White balance')}
            </span>
            <button
              className={`chip${wbMode === 'copy' ? ' on' : ''}`}
              role="radio"
              aria-checked={wbMode === 'copy'}
              onClick={() => setWbMode('copy')}
              title={t('The same white on every photo, converted between RAW and other files')}
            >
              {t('Copy (converted per photo)')}
            </button>
            <button
              className={`chip${wbMode === 'auto' ? ' on' : ''}`}
              role="radio"
              aria-checked={wbMode === 'auto'}
              onClick={() => setWbMode('auto')}
              title={withKey(t("Measure each photo's own white"), 'autoWbBatch')}
            >
              {t('Auto per photo')}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

export function SavePresetDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const say = useLibrary((s) => s.say)
  const recipe = useDevelop((s) => s.recipe)
  const session = useDevelop((s) => s.session)
  const [name, setName] = useState('')
  const [group, setGroup] = useState(() => t('User presets'))
  const [withSteps, setWithSteps] = useState(true)
  const [groups, setGroups] = useState<Set<RecipeGroup>>(
    new Set(
      recipe
        ? changedGroups(recipe, defaultRecipe(session?.isRaw ?? false)).filter(
            (g) =>
              g !== 'crop' &&
              g !== 'upright' &&
              g !== 'localAdjustments' &&
              g !== 'orientation' &&
              g !== 'retouch'
          )
        : []
    )
  )
  // The masks and AI steps as a preset can carry them (smart.ts `toInstructions`).
  const converted = useMemo(
    () =>
      recipe
        ? toInstructions(
            groups.has('localAdjustments') ? recipe.layers : [],
            withSteps ? recipe.pixels : []
          )
        : { smart: null, kept: [], warnings: [] },
    [recipe, groups, withSteps]
  )
  return (
    <Modal
      title={t('Save preset')}
      onClose={() => setDialog(null)}
      icon="presets"
      footer={
        <button
          className="primary"
          disabled={!recipe || !name.trim() || (groups.size === 0 && !converted.smart)}
          onClick={async () => {
            if (!recipe) return
            try {
              // A custom white balance also goes as the engine's white, so
              // the preset converts onto photos of the other kind.
              const wbOp =
                session && groups.has('whiteBalance') && recipe.wb.mode === 'custom'
                  ? savedWhite(recipe.wb, session)
                  : undefined
              // Masks and AI steps go as instructions, made again on each photo;
              // the photo's own masks and steps are not the preset's to carry.
              const kept = [...groups].filter((g) => g !== 'localAdjustments')
              await api.presets.save({
                name: name.trim(),
                // The default group is kept in English (shown in the language of the day).
                group:
                  !group.trim() || group.trim() === t('User presets')
                    ? 'User presets'
                    : group.trim(),
                groups: kept,
                recipe: { ...recipe, layers: [], pixels: [] },
                ...(wbOp ? { wbOp } : {}),
                ...(converted.smart ? { smart: converted.smart } : {})
              })
              presetsChanged()
              say(t('Saved preset {{name}}', { name: name.trim() }))
              setDialog(null)
            } catch (err) {
              say(errorText(err), 'error')
            }
          }}
        >
          {t('Save')}
        </button>
      }
    >
      <Field label={t('Name')}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </Field>
      <Field label={t('Group')}>
        <input
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </Field>
      <p className="muted small">{t('The preset carries only the checked groups:')}</p>
      <div className="group-checks">
        {RECIPE_GROUPS.map((g) => (
          <label key={g} className="check">
            <input
              type="checkbox"
              checked={groups.has(g)}
              onChange={(e) => {
                const n = new Set(groups)
                if (e.target.checked) n.add(g)
                else n.delete(g)
                setGroups(n)
              }}
            />
            {t(GROUP_LABELS[g])}
          </label>
        ))}
        {(recipe?.pixels.length ?? 0) > 0 && (
          <label className="check">
            <input
              type="checkbox"
              checked={withSteps}
              onChange={(e) => setWithSteps(e.target.checked)}
            />
            {t('AI denoise & deblur')}
          </label>
        )}
      </div>
      {(groups.has('localAdjustments') || withSteps) &&
        (converted.kept.length > 0 || converted.warnings.length > 0) && (
          <div className="smart-convert">
            {converted.kept.length > 0 && (
              <>
                <p className="muted small">
                  {t('Saved as instructions, made again on each photo:')}
                </p>
                <ul>
                  {converted.kept.map((k) => (
                    <li key={k}>{k}</li>
                  ))}
                </ul>
              </>
            )}
            {converted.warnings.length > 0 && (
              <ul className="smart-convert-warn">
                {converted.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
    </Modal>
  )
}
