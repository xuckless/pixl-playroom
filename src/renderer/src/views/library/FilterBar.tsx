import { useState } from 'react'
import {
  clearedFilters,
  extraFilterCount,
  filterRules,
  isDefaultFilter,
  moreFilters,
  savableFilter,
  withoutMore,
  type FlagFilter,
  type MoreFilter
} from '../../../../shared/filter'
import type { ColorLabel } from '../../../../shared/ipc'
import { keywordLabel } from '../../../../shared/keywords'
import { GlassSelect } from '../../components/GlassSelect'
import { Icon } from '../../components/icons'
import { keyHint, rejectSuggested, withKey } from '../../lib/commands'
import { LABEL_COLOURS } from '../../lib/helpers'
import { t, tk, tp } from '../../lib/i18n'
import { useCull } from '../../state/cull'
import { useLibrary, useVisible } from '../../state/library'
import { useUi } from '../../state/ui'
import { FilterButton } from './ToolbarMenus'
import { FLAGS, labelName } from './filterNames'

/** What a "More…" filter's chip says. */
const MORE_NAMES: Record<MoreFilter, string> = {
  camera: tk('Camera'),
  lens: tk('Lens'),
  kind: tk('Kind'),
  iso: 'ISO',
  focal: tk('Focal length'),
  taken: tk('Taken'),
  keyword: tk('Keyword')
}

/**
 * The Library's filters in one row under the toolbar (⇧\ hides it): the
 * minimum rating, the flag, the colour label, edited or not, the suggested
 * rejects, and the rest ("More…") as chips that each clear one. Shown by
 * default because the default filter hides the rejects, and this says so.
 */
export function FilterBar(): React.JSX.Element | null {
  const shown = useUi((s) => s.filterBar)
  const filter = useLibrary((s) => s.filter)
  const setFilter = useLibrary((s) => s.setFilter)
  const editCollection = useLibrary((s) => s.editCollection)
  const dupes = useLibrary((s) => s.source?.kind === 'duplicates')
  const cullSuggest = useUi((s) => s.cullSuggest)
  if (!shown) return null
  const more = moreFilters(filter)
  const plain = isDefaultFilter(filter)
  const chip = (which: MoreFilter): string => {
    const name = t(MORE_NAMES[which])
    if (which === 'camera') return filter.camera
    if (which === 'lens') return filter.lens
    if (which === 'kind') return filter.kind === 'raw' ? 'RAW' : t('Not RAW')
    if (which === 'keyword') return keywordLabel(filter.keyword)
    if (which === 'taken') return `${name} ${filter.from || '…'} – ${filter.to || '…'}`
    const r = which === 'iso' ? filter.iso : filter.focal
    const end = (n: number | undefined): string =>
      n === undefined || !Number.isFinite(n) ? '…' : String(n)
    return `${name} ${end(r?.[0])}–${end(r?.[1])}${which === 'focal' ? ' mm' : ''}`
  }
  return (
    <div className="filter-bar" role="toolbar" aria-label={t('Filters')}>
      <span
        className="fb-group fb-stars"
        role="group"
        aria-label={t('Minimum rating')}
        title={t('Rated at least this many stars: click the same star again for any rating')}
      >
        <span className="fb-label">{t('Rating')}</span>
        {[1, 2, 3, 4, 5].map((r) => (
          <button
            key={r}
            className={r <= filter.minRating ? 'on' : ''}
            aria-pressed={filter.minRating === r}
            aria-label={tp('{{count}} star or more', '{{count}} stars or more', r)}
            onClick={() => setFilter({ minRating: filter.minRating === r ? 0 : r })}
          >
            ★
          </button>
        ))}
      </span>
      <span className="fb-group">
        <span className="fb-label" id="fb-flag">
          {t('Flag')}
        </span>
        <GlassSelect<FlagFilter>
          className="sm"
          labelledBy="fb-flag"
          value={filter.flag}
          onChange={(flag) => setFilter({ flag })}
          options={FLAGS.map(([value, label]) => ({ value, label: t(label) }))}
        />
      </span>
      <span className="fb-group label-pick fb-labels" role="group" aria-label={t('Colour label')}>
        <span className="fb-label">{t('Label')}</span>
        {Object.keys(LABEL_COLOURS).map((l) => (
          <button
            key={l}
            className={`swatch${filter.label === l ? ' on' : ''}`}
            aria-pressed={filter.label === l}
            aria-label={labelName(l)}
            title={labelName(l)}
            style={{ color: LABEL_COLOURS[l] }}
            onClick={() => setFilter({ label: filter.label === l ? 'all' : (l as ColorLabel) })}
          >
            <i />
          </button>
        ))}
      </span>
      <span className="fb-group">
        <span className="fb-label" id="fb-edits">
          {t('Edits')}
        </span>
        <GlassSelect<'all' | 'edited' | 'unedited'>
          className="sm"
          labelledBy="fb-edits"
          value={filter.edited}
          onChange={(edited) => setFilter({ edited })}
          options={[
            { value: 'all', label: t('Any') },
            { value: 'edited', label: t('Edited') },
            { value: 'unedited', label: t('Unedited') }
          ]}
        />
      </span>
      {cullSuggest && !dupes && <SuggestedChip />}
      {more.map((m) => (
        <span key={m} className="fb-chip">
          {chip(m)}
          <button
            className="icon"
            aria-label={t('Clear {{filter}}', { filter: t(MORE_NAMES[m]) })}
            onClick={() => setFilter(withoutMore(m))}
          >
            <Icon name="close" />
          </button>
        </span>
      ))}
      <FilterButton more />
      <span className="spacer" />
      {!plain && (
        <>
          {savableFilter(filter) && (
            <button
              className="sm ghost"
              title={t('Save these filters as a smart collection')}
              onClick={() =>
                editCollection({
                  name: t('New smart collection'),
                  kind: 'smart',
                  parent: null,
                  rules: filterRules({ ...filter, text: '' }),
                  sort: 0
                })
              }
            >
              <Icon name="smart" />
              {t('Save as smart collection')}
            </button>
          )}
          <button
            className="sm ghost"
            title={t('Back to every photo but the rejects')}
            onClick={() => setFilter(clearedFilters())}
          >
            <Icon name="close" />
            {t('Clear')}
          </button>
        </>
      )}
      <button
        className="icon"
        title={withKey(t('Hide the filter bar'), 'library.filterBar')}
        aria-label={t('Hide the filter bar')}
        onClick={() => useUi.getState().setFilterBar(false)}
      >
        <Icon name="chevronUp" />
      </button>
    </div>
  )
}

/**
 * Suggested rejects (Pass 115), as one chip: on, it says how many and the
 * measuring still to do, and offers Reject all (⇧X). Nothing is deleted.
 */
function SuggestedChip(): React.JSX.Element {
  const on = useLibrary((s) => s.filter.suggested === true)
  const setFilter = useLibrary((s) => s.setFilter)
  const measuring = useCull((s) => s.measuring)
  const count = useVisible().length
  return (
    <span className={`fb-suggested${on ? ' on' : ''}`}>
      <button
        className={`sm ghost${on ? ' on' : ''}`}
        aria-pressed={on}
        title={t('Photos that look like rejects, with why: nothing is deleted')}
        onClick={() => {
          setFilter({ suggested: !on })
          // Photos not measured yet are measured now.
          if (!on) void useCull.getState().measure()
        }}
      >
        {t('Suggested rejects')}
        {on && <span className="filter-count t-num">{count}</span>}
      </button>
      {on && measuring && (
        <span className="muted t-num">
          {t('Measuring {{done}} of {{total}}…', { done: measuring.done, total: measuring.total })}
        </span>
      )}
      {on && count > 0 && (
        <button
          className="sm"
          onClick={() => void rejectSuggested()}
          title={keyHint('cull.rejectAll')}
        >
          {t('Reject all {{count}}', { count })}
        </button>
      )}
    </span>
  )
}

/**
 * The search, safe for input methods: what is typed while a Chinese or
 * Japanese word is being composed waits for the composition to end, so the
 * grid never filters by half a word.
 */
export function SearchField(): React.JSX.Element {
  const text = useLibrary((s) => s.filter.text)
  const setFilter = useLibrary((s) => s.setFilter)
  const extra = useLibrary((s) => extraFilterCount(s.filter))
  const barShown = useUi((s) => s.filterBar)
  const [value, setValue] = useState(text)
  const [composing, setComposing] = useState(false)
  // Cleared or set elsewhere (Reset filters): the field follows.
  const [was, setWas] = useState(text)
  if (text !== was && !composing) {
    setWas(text)
    setValue(text)
  }
  return (
    <label className="search-field">
      <Icon name="search" />
      <input
        className="search"
        placeholder={t('Search names, titles, keywords, camera')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          const native = e.nativeEvent as InputEvent
          if (!composing && !native.isComposing) setFilter({ text: e.target.value })
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => {
          setComposing(false)
          setFilter({ text: (e.target as HTMLInputElement).value })
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          // Esc empties the field, then lets go of it (never mid-composition).
          if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
          if (value) {
            setValue('')
            setFilter({ text: '' })
          } else (e.target as HTMLInputElement).blur()
        }}
      />
      {!barShown && extra > 0 && (
        <button
          type="button"
          className="filter-count t-num search-badge"
          title={withKey(t('Filters are on: show the filter bar'), 'library.filterBar')}
          onClick={() => useUi.getState().setFilterBar(true)}
        >
          {extra}
        </button>
      )}
    </label>
  )
}
