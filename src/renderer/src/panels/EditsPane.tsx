/**
 * The Edits list (the left rail): what this photo's edit is, one row for
 * each section changed, each mask, each Advanced layer and each pixel step,
 * with its net change ("Exposure +0.60 · Contrast +12") and an eye that
 * switches it off and on. A switch is an edit like any other: History
 * records it and Undo takes it back. Clicking a section opens its card.
 */
import { useMemo } from 'react'
import { Icon } from '../components/icons'
import { editRows, setSectionOff, type Change, type EditRow } from '../../../shared/edits'
import { isCardId } from '../../../shared/cards'
import { useDevelop } from '../state/develop'
import { jumpToCard, openMasks } from '../develop/tools'
import { patchMask } from './masks/model'
import { t, tk, tp } from '../lib/i18n'

/** A slider's value as the list says it: signed, Exposure in hundredths, the rest whole. */
function valueText(c: Change): string {
  if (c.value === null) return ''
  const v = c.label === 'Exposure' ? c.value.toFixed(2) : String(Math.round(c.value))
  return c.value > 0 ? `+${v}` : v.replace('-', '−')
}

/** What a row says under its name: its named changes, then how many more. */
function summary(row: EditRow): string {
  if (row.count !== undefined) return tp('{{count}} spot', '{{count}} spots', row.count)
  const parts = row.changes.slice(0, 3).map((c) => `${t(c.label)} ${valueText(c)}`.trim())
  const more = row.more + Math.max(0, row.changes.length - 3)
  if (more > 0) parts.push(t('+{{count}} more', { count: more }))
  return parts.join(' · ')
}

/** Switch a row's edit off or on, as one step of History. */
function toggle(row: EditRow): void {
  const d = useDevelop.getState()
  const name = row.name
  const state = row.on ? tk('Off') : tk('On')
  if (row.kind === 'mask') {
    const id = row.id.slice('mask:'.length)
    patchMask(id, row.on ? tk('Hide mask') : tk('Show mask'), (l) => {
      l.enabled = !l.enabled
    })
    return
  }
  d.edit((r) => {
    if (row.kind === 'section' && row.section) setSectionOff(r, row.section, row.on)
    else if (row.kind === 'custom') {
      const c = r.custom.find((x) => `custom:${x.id}` === row.id)
      if (c) c.enabled = !row.on
    } else if (row.kind === 'step') {
      const p = r.pixels.find((x) => `step:${x.id}` === row.id)
      if (p && row.on) p.off = true
      else if (p) delete p.off
    }
  })
  d.commit(`${name}: ${state}`)
}

/** Clicking a row: its card opened and in view, or its mask selected. */
function reveal(row: EditRow): void {
  if (row.kind === 'section' && row.section && isCardId(row.section)) jumpToCard(row.section)
  else if (row.kind === 'mask') {
    openMasks()
    useDevelop.getState().setLayer(row.id.slice('mask:'.length))
  }
}

export function EditsPane(): React.JSX.Element {
  const recipe = useDevelop((s) => s.recipe)
  const isRaw = useDevelop((s) => s.session?.isRaw ?? false)
  const rows = useMemo(() => (recipe ? editRows(recipe, isRaw) : []), [recipe, isRaw])
  if (rows.length === 0) return <p className="rail-empty">{t('Nothing edited yet.')}</p>
  return (
    <div className="rail-list edits-list">
      {rows.map((row) => {
        const name = row.translate ? t(row.name) : row.name
        const said = summary(row)
        return (
          <div
            key={row.id}
            role="button"
            tabIndex={0}
            className={`rail-item edit-row${row.on ? '' : ' off'}`}
            title={said ? `${name} — ${said}` : name}
            onClick={() => reveal(row)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') reveal(row)
            }}
          >
            <span className="edit-text">
              <span className="edit-name">{name}</span>
              {said && <span className="edit-summary">{said}</span>}
            </span>
            <button
              type="button"
              className={`icon sm edit-eye${row.on ? '' : ' on'}`}
              aria-pressed={!row.on}
              aria-label={
                row.on ? t('Turn {{name}} off', { name }) : t('Turn {{name}} on', { name })
              }
              title={row.on ? t('Turn {{name}} off', { name }) : t('Turn {{name}} on', { name })}
              onClick={(e) => {
                e.stopPropagation()
                toggle(row)
              }}
            >
              <Icon name={row.on ? 'eye' : 'eyeOff'} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
