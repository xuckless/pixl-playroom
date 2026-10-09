import { useEffect, useMemo, useState } from 'react'
import type { Collection } from '../../../../shared/ipc'
import { matchSmart, referencedCollections, type SmartGroup } from '../../../../shared/smart'
import { Modal } from '../../components/ui'
import { api, errorText } from '../../lib/api'
import { ruleCount } from '../../lib/rules'
import { setsFor, sourceTrail } from '../../lib/sources'
import { useLibrary, type CollectionDraft } from '../../state/library'
import { t, tk, tp } from '../../lib/i18n'
import { GroupEditor } from './RuleEditor'

const TITLE: Record<Collection['kind'], { add: string; edit: string }> = {
  manual: { add: tk('New collection'), edit: tk('Edit collection') },
  smart: { add: tk('New smart collection'), edit: tk('Edit smart collection') },
  set: { add: tk('New set'), edit: tk('Edit set') }
}

/**
 * How many of the photos on show a rule tree takes. There is no listing of
 * the whole library to try rules on, so the preview is honest about its
 * scope; the collection itself, once saved, looks through everything. The
 * members of collections the rules name are fetched as they are named.
 */
function usePreview(rules: SmartGroup | null): { matched: number; of: number } | null {
  const items = useLibrary((s) => s.items)
  const [members, setMembers] = useState<Map<string, Set<string>>>(() => new Map())
  const wanted = rules ? referencedCollections(rules).filter((id) => id && !members.has(id)) : []
  const want = wanted.join(',')
  useEffect(() => {
    if (!want) return
    let alive = true
    void Promise.all(
      want.split(',').map(async (id) => {
        const listing = await api.library.openSource({ kind: 'collection', id }).catch(() => null)
        return [id, new Set(listing?.items.map((i) => i.key) ?? [])] as const
      })
    ).then((got) => {
      if (alive) setMembers((m) => new Map([...m, ...got]))
    })
    return () => {
      alive = false
    }
  }, [want])
  return useMemo(() => {
    if (!rules) return null
    const ctx = { now: new Date(), members: (id: string) => members.get(id) }
    return { matched: items.filter((it) => matchSmart(it, rules, ctx)).length, of: items.length }
  }, [rules, items, members])
}

/** Make or change a collection: its name, the set it sits in, and a smart one's rules. */
export function CollectionDialog({ initial }: { initial: CollectionDraft }): React.JSX.Element {
  const collections = useLibrary((s) => s.collections)
  const source = useLibrary((s) => s.source)
  const editCollection = useLibrary((s) => s.editCollection)
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const smart = draft.kind === 'smart'
  const preview = usePreview(smart ? draft.rules : null)
  const sets = setsFor(collections, draft.id)
  const close = (): void => editCollection(null)
  const where = source ? sourceTrail(source, collections).at(-1) : null

  const save = async (): Promise<void> => {
    const name = draft.name.trim()
    if (!name || saving) return
    setSaving(true)
    const lib = useLibrary.getState()
    try {
      const saved = await api.library.saveCollection({ ...draft, name })
      close()
      await lib.loadSources()
      const count = useLibrary.getState().collections.find((c) => c.id === saved.id)?.count
      if (!draft.id && saved.kind !== 'set')
        await lib.openSource({ kind: 'collection', id: saved.id })
      lib.say(
        saved.kind === 'smart' && count !== undefined
          ? tp('Saved {{name}} · {{count}} photo', 'Saved {{name}} · {{count}} photos', count, {
              name: saved.name
            })
          : saved.kind === 'manual' && !draft.id
            ? t('Saved {{name}} · drag photos onto it to add them', { name: saved.name })
            : t('Saved {{name}}', { name: saved.name })
      )
    } catch (err) {
      setSaving(false)
      lib.say(errorText(err), 'error')
    }
  }

  return (
    <Modal
      title={t(draft.id ? TITLE[draft.kind].edit : TITLE[draft.kind].add)}
      icon={draft.kind === 'manual' ? 'collection' : draft.kind}
      onClose={close}
      className={smart ? 'smart-dialog' : undefined}
      footer={
        <>
          {smart && preview && (
            <span className="progress rule-preview t-num">
              <span className="big">{preview.matched}</span>
              <span>
                {where
                  ? tp(
                      'of the {{count}} photo in {{place}} match',
                      'of the {{count}} photos in {{place}} match',
                      preview.of,
                      { place: where }
                    )
                  : tp(
                      'of the {{count}} photo in view match',
                      'of the {{count}} photos in view match',
                      preview.of
                    )}
                <span className="muted">
                  {' · '}
                  {t('saved, it looks through the whole library')}
                </span>
              </span>
            </span>
          )}
          <button onClick={close}>{t('Cancel')}</button>
          <button
            className="primary"
            disabled={!draft.name.trim() || saving}
            onClick={() => void save()}
          >
            {draft.id ? t('Save') : t('Create')}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{t('Name')}</span>
        <input
          autoFocus
          value={draft.name}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') close()
          }}
        />
      </label>
      <label className="field">
        <span>{t('In set')}</span>
        <select
          value={draft.parent ?? ''}
          onChange={(e) => setDraft({ ...draft, parent: e.target.value || null })}
        >
          <option value="">{t('None (top level)')}</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {smart && draft.rules && (
        <fieldset className="rules-fieldset">
          <legend>
            {t('Rules')} · {ruleCount(draft.rules)}
          </legend>
          <GroupEditor
            group={draft.rules}
            collections={collections.filter((c) => c.id !== draft.id)}
            onChange={(rules) => setDraft({ ...draft, rules })}
          />
        </fieldset>
      )}
    </Modal>
  )
}
