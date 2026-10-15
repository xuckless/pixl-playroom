import { effective } from '../../../shared/edits'
import { useEffect, useMemo, useState } from 'react'
import { clipboardLine, NOT_COPIED } from '../../../shared/clipboard'
import {
  changedGroups,
  defaultRecipe,
  GROUP_LABELS,
  RECIPE_GROUPS,
  type Recipe,
  type RecipeGroup
} from '../../../shared/recipe'
import { toInstructions } from '../../../shared/looks/smart'
import { savedWhite } from '../../../shared/wbconvert'
import { Modal } from '../components/ui'
import { api, errorText } from '../lib/api'
import { autoWbBatch } from '../lib/autowb'
import { nameOfKey, pasteSettings, settingsOf, syncSettings } from '../lib/clipboard'
import { presetsChanged } from '../lib/hooks'
import { useDevelop } from '../state/develop'
import { useLibrary, useTargets } from '../state/library'
import { keyHint, withKey } from '../lib/commands'
import { t, tp } from '../lib/i18n'

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

/**
 * Paste (⇧⌘V: the clipboard's settings, its groups chosen) or sync (⇧⌘S:
 * the focused photo's settings in the Library, the open one's in Develop,
 * read when the dialog opens) onto the selection. Either is a Library batch
 * with one Undo (lib/clipboard.ts).
 */
export function SyncDialog({ mode }: { mode: 'paste' | 'sync' }): React.JSX.Element {
  const targets = useTargets()
  const setDialog = useLibrary((s) => s.setDialog)
  const clipboard = useLibrary((s) => s.clipboard)
  const view = useLibrary((s) => s.view)
  const focus = useLibrary((s) => s.focus)
  const developKey = useDevelop((s) => s.session?.key ?? null)
  const items = useLibrary((s) => s.items)
  // Sync's source: the photo shown in Develop, the focused one in the Library.
  const sourceKey =
    mode === 'paste' ? (clipboard?.source.key ?? null) : view === 'develop' ? developKey : focus
  const [read, setRead] = useState<
    { key: string; recipe: Recipe } | { key: string; error: string } | null
  >(null)
  useEffect(() => {
    if (mode !== 'sync' || !sourceKey) return
    let live = true
    settingsOf(sourceKey).then(
      (recipe) => live && setRead({ key: sourceKey, recipe }),
      (err) => live && setRead({ key: sourceKey, error: errorText(err) })
    )
    return () => {
      live = false
    }
  }, [mode, sourceKey])
  const synced = read && read.key === sourceKey && 'recipe' in read ? read.recipe : null
  const source = mode === 'paste' ? (clipboard?.recipe ?? null) : synced
  const sourceRaw = items.find((i) => i.key === sourceKey)?.isRaw ?? false
  const name = sourceKey ? nameOfKey(sourceKey) : ''
  const keys = mode === 'sync' ? targets.filter((k) => k !== sourceKey) : targets
  // The groups to start from: the clipboard's, or what differs from the
  // photo's own defaults (a RAW's profile, sharpening and noise reduction
  // are not edits), leaving out what belongs to one frame.
  const initial = useMemo(
    () =>
      mode === 'paste'
        ? (clipboard?.groups ?? [])
        : source
          ? changedGroups(source, defaultRecipe(sourceRaw)).filter((g) => !NOT_COPIED.includes(g))
          : [],
    [mode, clipboard, source, sourceRaw]
  )
  const [chosen, setGroups] = useState<Set<RecipeGroup> | null>(null)
  const groups = chosen ?? new Set(initial)
  // The white balance either travels (converted to each photo's kind) or
  // each photo gets its own, measured by auto white balance.
  const [wbMode, setWbMode] = useState<'copy' | 'auto'>('copy')
  // How old the clipboard is, as of the dialog opening.
  const [openedAt] = useState(() => Date.now())
  const autoWb = groups.has('whiteBalance') && wbMode === 'auto'
  const copied = [...groups].filter((g) => !(autoWb && g === 'whiteBalance'))
  const failed = read && read.key === sourceKey && 'error' in read ? read.error : null
  const title =
    mode === 'paste'
      ? clipboard
        ? tp(
            'Paste the settings of {{name}} onto {{count}} photo',
            'Paste the settings of {{name}} onto {{count}} photos',
            keys.length,
            { name }
          )
        : t('Paste settings')
      : sourceKey
        ? tp(
            'Sync from {{name}} to {{count}} photo',
            'Sync from {{name}} to {{count}} photos',
            keys.length,
            { name }
          )
        : t('Sync settings')
  return (
    <Modal
      title={title}
      onClose={() => setDialog(null)}
      icon="copy"
      footer={
        <button
          className="primary"
          disabled={(!source && copied.length > 0) || keys.length === 0 || groups.size === 0}
          onClick={async () => {
            setDialog(null)
            if (source && sourceKey && copied.length > 0) {
              if (mode === 'paste') await pasteSettings(keys, copied)
              else await syncSettings({ key: sourceKey, name, recipe: source }, keys, copied)
            }
            // Its own batch, with its own progress and Undo.
            if (autoWb) await autoWbBatch(keys)
          }}
        >
          {t('Apply')}
        </button>
      }
    >
      {mode === 'paste' && clipboard && (
        <p className="muted small">{clipboardLine(clipboard, openedAt)}</p>
      )}
      {mode === 'paste' && !clipboard && (
        <p>
          {t('Copy settings from a photo first ({{key}}).', {
            key:
              keyHint(view === 'develop' ? 'settings.copy' : 'library.copy') || t('Copy settings')
          })}
        </p>
      )}
      {mode === 'sync' && !sourceKey && <p>{t('Choose the photo to sync from first.')}</p>}
      {failed && <p className="muted small">{failed}</p>}
      {mode === 'sync' && sourceKey && keys.length === 0 && (
        <p>{t('Select the photos to sync to as well as {{name}}.', { name })}</p>
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
              title={withKey(t('Measure each photo’s own white'), 'autoWbBatch')}
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
  const session = useDevelop((s) => s.session)
  // What is seen: a section switched off is saved as its defaults.
  const edited = useDevelop((s) => s.recipe)
  const recipe = useMemo(
    () => (edited ? effective(edited, session?.isRaw ?? false) : null),
    [edited, session?.isRaw]
  )
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
