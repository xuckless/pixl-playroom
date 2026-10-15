import { useEffect, useMemo, useRef } from 'react'
import type { LibraryItem } from '../../../../shared/ipc'
import { surveyLayout } from '../../../../shared/cullnav'
import { Icon } from '../../components/icons'
import { keyHint, withKey } from '../../lib/commands'
import { t, tp } from '../../lib/i18n'
import {
  goLoupe,
  pickPane,
  promoteCandidate,
  settleCompare,
  swapCompare
} from '../../lib/librarymodes'
import { useLibrary, useVisible } from '../../state/library'
import { useSize } from '../loupe/useSize'
import { libZoom, useLibZoom } from './libzoom'
import { PhotoPane } from './PhotoPane'
import { warmAround } from './usePreview'

/** The photos shown, by key, and their order. */
function useShown(): { order: string[]; byKey: Map<string, LibraryItem> } {
  const visible = useVisible()
  const items = useLibrary((s) => s.items)
  return useMemo(
    () => ({
      order: visible.map((i) => i.key),
      // Every photo of the source: a pane keeps showing one the filter now hides.
      byKey: new Map(items.map((i) => [i.key, i]))
    }),
    [visible, items]
  )
}

/**
 * The photos either side of `key` made ahead, once per step (not per
 * rating); `shown` are on screen, the rest of what waits is dropped.
 */
function useWarm(order: string[], key: string | null, shown: (string | null)[]): void {
  const now = useRef(order)
  useEffect(() => {
    now.current = order
  }, [order])
  const on = shown.filter((k): k is string => !!k).join('\n')
  useEffect(() => warmAround(now.current, key, on ? on.split('\n') : []), [key, on])
}

/** No photo to show: the folder is empty, or the filters hide everything. */
function ModeEmpty(): React.JSX.Element {
  const total = useLibrary((s) => s.items.length)
  const chooseFolder = useLibrary((s) => s.chooseFolder)
  const resetFilter = useLibrary((s) => s.resetFilter)
  return (
    <div className="lib-stage lib-empty">
      {total === 0 ? (
        <>
          <p>{t('No photos here')}</p>
          <button className="lg" onClick={() => void chooseFolder()}>
            <Icon name="folder" />
            {t('Choose folder…')}
          </button>
        </>
      ) : (
        <>
          <p>{t('No photos match the filters.')}</p>
          <button className="lg" onClick={resetFilter}>
            {t('Reset filters')}
          </button>
        </>
      )}
    </div>
  )
}

/** E: one photo, as large as it goes; Z (or a click) for 1:1. */
export function LibraryLoupe(): React.JSX.Element {
  const { order, byKey } = useShown()
  const focus = useLibrary((s) => s.focus)
  const setFocus = useLibrary((s) => s.setFocus)
  const item = focus ? byKey.get(focus) : undefined
  useWarm(order, focus, [focus])
  // Nothing focused yet (a folder just opened): the first photo.
  const first = order[0] ?? null
  useEffect(() => {
    if (!item && first) setFocus(first)
  }, [item, first, setFocus])
  if (!item) return <ModeEmpty />
  const i = order.indexOf(item.key)
  return (
    <div className="lib-stage loupe">
      <PhotoPane
        item={item}
        pane="loupe"
        where={
          i >= 0 ? t('{{index}} of {{total}}', { index: i + 1, total: order.length }) : undefined
        }
      />
    </div>
  )
}

/** C: the Select and the Candidate side by side. */
export function LibraryCompare(): React.JSX.Element {
  const { order, byKey } = useShown()
  const focus = useLibrary((s) => s.focus)
  const candidate = useLibrary((s) => s.candidate)
  const active = useLibrary((s) => s.active)
  const linked = useLibZoom((s) => s.linked)
  const select = focus ? byKey.get(focus) : undefined
  const cand = candidate ? byKey.get(candidate) : undefined
  // A photo gone (another source, Develop's filmstrip): the pair made whole again.
  const whole = !!select && !!cand && select.key !== cand.key
  useEffect(() => {
    if (!whole) settleCompare()
  }, [whole])
  useWarm(order, candidate, [focus, candidate])
  if (!select || !cand) return <ModeEmpty />
  return (
    <div className="lib-stage compare">
      <div className="compare-panes">
        <PhotoPane
          item={select}
          pane="select"
          tag={t('Select')}
          active={active === 'select'}
          onPress={() => pickPane('select')}
        />
        <PhotoPane
          item={cand}
          pane="candidate"
          tag={t('Candidate')}
          active={active === 'candidate'}
          onPress={() => pickPane('candidate')}
        />
      </div>
      <div className="lib-bar">
        <button
          className={`sm ghost${linked ? ' on' : ''}`}
          aria-pressed={linked}
          title={withKey(t('Zoom and pan both together'), 'compare.link')}
          onClick={() => libZoom.toggleLink()}
        >
          {linked ? t('Linked') : t('Not linked')}
        </button>
        <span className="spacer" />
        <button
          className="sm ghost"
          title={withKey(t('The Select and the Candidate change places'), 'compare.swap')}
          onClick={swapCompare}
        >
          {t('Swap')} <span className="kbd">{keyHint('compare.swap')}</span>
        </button>
        <button
          className="sm ghost"
          title={withKey(
            t('The Candidate becomes the Select, the next photo the Candidate'),
            'compare.promote'
          )}
          onClick={promoteCandidate}
        >
          {t('Make Select')} <span className="kbd">{keyHint('compare.promote')}</span>
        </button>
      </div>
    </div>
  )
}

/** N: the selection (or a photo's burst) at once, up to twelve. */
export function LibrarySurvey(): React.JSX.Element {
  const { order, byKey } = useShown()
  const survey = useLibrary((s) => s.survey)
  const focus = useLibrary((s) => s.focus)
  const [setEl, box] = useSize()
  // Nothing either side: every tile is shown.
  useWarm(order, null, survey?.keys ?? [])
  const tiles = (survey?.keys ?? []).map((k) => byKey.get(k)).filter((x): x is LibraryItem => !!x)
  if (!survey || tiles.length === 0) return <ModeEmpty />
  const layout = surveyLayout(tiles.length, box)
  const n = tiles.length
  const what =
    survey.group === 'burst'
      ? tp('A burst of {{count}} photo', 'A burst of {{count}} photos', n)
      : survey.group === 'near'
        ? tp('{{count}} photo nearly the same', '{{count}} photos nearly the same', n)
        : survey.group === 'stack'
          ? tp('A stack of {{count}} photo', 'A stack of {{count}} photos', n)
          : null
  return (
    <div className="lib-stage survey">
      {(what || survey.total > n) && (
        <div className="lib-bar">
          {what && <span>{what}</span>}
          {survey.total > n && (
            <span className="muted">
              {t('{{shown}} of {{count}} · narrow the selection', {
                shown: n,
                count: survey.total
              })}
            </span>
          )}
        </div>
      )}
      <div
        ref={setEl}
        className="survey-grid"
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`
        }}
      >
        {tiles.map((it) => (
          <PhotoPane
            key={it.key}
            item={it}
            pane={null}
            compact
            active={it.key === focus}
            onPress={() => useLibrary.setState({ focus: it.key, anchor: it.key })}
            onOpen={() => {
              useLibrary.setState({ focus: it.key, anchor: it.key })
              goLoupe()
            }}
          />
        ))}
      </div>
    </div>
  )
}
