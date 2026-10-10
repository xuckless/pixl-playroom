import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { loupeZoom } from '../views/loupe/zoom'
import { useUi } from '../state/ui'
import { aboveWhite, canShowHdr, useDisplay } from '../state/display'
import { useKeyHint, withKey } from '../lib/commands'
import { t } from '../lib/i18n'
import { HoverHint, type Hint } from '../components/HoverHint'

/** Whether the open photo has light above white (state/display `aboveWhite`), and if not why. */
function useAboveWhite(): { above: boolean; why: string } {
  const session = useDevelop((s) => s.session)
  if (!session) return { above: false, why: '' }
  if (aboveWhite(session)) return { above: true, why: '' }
  return {
    above: false,
    why: session.info.gain_map
      ? t(
          'This photo is edited in SDR (Photo → Edit as SDR): nothing in it is brighter than white.'
        )
      : t('This photo is SDR: nothing in it is brighter than white.')
  }
}

/**
 * Full HDR (engine 0.18): the photo shown with its light above white, for
 * this display. How it is viewed, never how it is edited or exported, so it
 * lives with the view; one switch for every photo.
 */
function FullHdrToggle(): React.JSX.Element {
  const on = useUi((s) => s.fullHdr)
  const set = useUi((s) => s.setFullHdr)
  const display = useDisplay((s) => s.display)
  const { above, why } = useAboveWhite()
  const able = canShowHdr(display)
  const lit = on && able
  return (
    <HoverHint
      hint={{
        title: t('Full HDR'),
        what: t(
          'Shows the photo with its highlights brighter than white, as far as this screen can go. It changes only how the photo looks here: never the edit, never the export.'
        ),
        now: !able
          ? t('This screen shows SDR. Full HDR needs an HDR screen (Settings → Display).')
          : !above
            ? why
            : lit
              ? t('On: click to show the photo in SDR.')
              : t('Off: click to show the light above white.')
      }}
    >
      <button
        className={`ghost lg full-hdr${lit ? ' on' : ''}`}
        aria-pressed={lit}
        aria-disabled={!able}
        onClick={() => able && set(!on)}
      >
        {t('Full HDR')}
      </button>
    </HoverHint>
  )
}

/** The second tier in Develop: back to the library, history, how to look, and what to do with the photo. */
export function DevelopToolbar(): React.JSX.Element {
  const compare = useDevelop((s) => s.compare)
  const setCompare = useDevelop((s) => s.setCompare)
  const clipping = useDevelop((s) => s.clipping)
  const setClipping = useDevelop((s) => s.setClipping)
  const headroom = useDevelop((s) => s.headroom)
  const setHeadroom = useDevelop((s) => s.setHeadroom)
  const zoomed = useDevelop((s) => s.zoom.scale !== 'fit')
  const undo = useDevelop((s) => s.undo)
  const redo = useDevelop((s) => s.redoStep)
  const canUndo = useDevelop((s) => s.history.steps.some((x) => !x.hidden))
  const canRedo = useDevelop((s) => s.redo.length > 0)
  const session = useDevelop((s) => s.session)
  const setView = useLibrary((s) => s.setView)
  const setDialog = useLibrary((s) => s.setDialog)
  const refresh = useLibrary((s) => s.refresh)
  const say = useLibrary((s) => s.say)
  const k = useKeyHint()
  const { above, why } = useAboveWhite()
  const views: {
    label: string
    k: string
    on: boolean
    able?: boolean
    toggle: () => void
    hint: Hint
  }[] = [
    {
      label: t('Before'),
      k: k('view.before'),
      on: compare === 'before',
      toggle: () => setCompare(compare === 'before' ? 'off' : 'before'),
      hint: {
        title: t('Before'),
        keys: k('view.before'),
        what: t('Shows the photo as it was before your edits. Click again to see them.')
      }
    },
    {
      label: t('Split'),
      k: k('view.split'),
      on: compare === 'split',
      toggle: () => setCompare(compare === 'split' ? 'off' : 'split'),
      hint: {
        title: t('Before/after split'),
        keys: k('view.split'),
        what: t(
          'Shows the photo before your edits on the left and after on the right. Drag the line to move the split.'
        )
      }
    },
    {
      label: t('Clipping'),
      k: k('view.clipping'),
      on: clipping,
      toggle: () => setClipping(!clipping),
      hint: {
        title: t('Clipping'),
        keys: k('view.clipping'),
        what: t(
          'Marks detail that is lost: warm where highlights blow out to pure white, cool where shadows crush to pure black.'
        )
      }
    },
    {
      label: t('Headroom'),
      k: '',
      on: headroom && above,
      able: above,
      toggle: () => setHeadroom(!headroom),
      hint: {
        title: t('Headroom'),
        what: t(
          'Marks the light above white that Full HDR and an HDR export keep: amber just above white, magenta at the brightest.'
        ),
        now: above ? undefined : why
      }
    },
    {
      label: '1:1',
      k: k('zoom.toggle'),
      on: zoomed,
      toggle: () => loupeZoom.toggle(),
      hint: {
        title: t('Fit ↔ 100%'),
        keys: k('zoom.toggle'),
        what: t(
          'Zooms to 100%, one photo pixel per screen pixel, to check focus and noise. Pinch or scroll to zoom; hold {{key}} and drag to pan.',
          { key: k('view.pan') || 'Space' }
        )
      }
    }
  ]
  return (
    <nav className="tool-bar">
      <button
        className="ghost lg"
        onClick={() => setView('library')}
        title={withKey(t('Library'), 'develop.library')}
      >
        <Icon name="library" />
        {t('Library')} {k('develop.library') && <span className="kbd">{k('develop.library')}</span>}
      </button>
      <span className="vsep" />
      <button
        className="icon ghost lg"
        onClick={undo}
        disabled={!canUndo}
        title={withKey(t('Undo'), 'undo')}
      >
        <Icon name="undo" />
      </button>
      <button
        className="icon ghost lg"
        onClick={redo}
        disabled={!canRedo}
        title={withKey(t('Redo'), 'redo')}
      >
        <Icon name="redo" />
      </button>
      <span className="vsep" />
      <FullHdrToggle />
      <div className="seg lg" role="group" aria-label={t('View')}>
        {views.map((v) => (
          <HoverHint key={v.label} hint={v.hint}>
            <button
              className={v.on ? 'on' : ''}
              aria-pressed={v.on}
              aria-disabled={v.able === false}
              onClick={() => v.able !== false && v.toggle()}
            >
              {v.label}
              {v.k && <span className="k">{v.k}</span>}
            </button>
          </HoverHint>
        ))}
      </div>
      <span className="spacer" />
      <button
        className="icon ghost lg"
        onClick={() => setDialog('engine')}
        disabled={!session}
        title={t('Engine report (Ctrl+Alt+E)')}
        aria-label={t('Engine report')}
      >
        <Icon name="engine" />
      </button>
      <button
        className="ghost lg"
        onClick={async () => {
          if (!session) return
          try {
            await api.library.createCopy(session.key)
            await refresh()
            say(t('Virtual copy created'))
          } catch (err) {
            say(errorText(err), 'error')
          }
        }}
        title={withKey(t('Virtual copy'), 'virtualCopy')}
      >
        <Icon name="copy" />
        {t('Copy')}
      </button>
      <LiquidGlass
        as="button"
        className="primary lg"
        flat
        onClick={() => setDialog('export')}
        title={withKey(t('Export'), 'export')}
      >
        <Icon name="export" />
        {t('Export')}
      </LiquidGlass>
    </nav>
  )
}
