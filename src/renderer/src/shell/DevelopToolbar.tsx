import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { loupeZoom } from '../views/loupe/zoom'
import { toggleMasks } from '../develop/tools'
import { useUi } from '../state/ui'
import { canShowHdr, useDisplay } from '../state/display'
import { useKeyHint, withKey } from '../lib/commands'

/**
 * Full HDR (engine 0.18): the photo shown with its light above white, for
 * this display. How it is viewed, not how it is edited (a gain-map photo's
 * SDR | HDR switch is that), so it says "show" and lives with the view.
 */
function FullHdrToggle(): React.JSX.Element {
  const on = useUi((s) => s.fullHdr)
  const set = useUi((s) => s.setFullHdr)
  const display = useDisplay((s) => s.display)
  const able = canShowHdr(display)
  return (
    <button
      className={`ghost lg full-hdr${on && able ? ' on' : ''}`}
      aria-pressed={on && able}
      disabled={!able}
      onClick={() => set(!on)}
      title={
        able
          ? on
            ? 'Showing the photo in HDR, for this display: click to show it in SDR'
            : 'Show the photo in HDR, with the light above white this display can show'
          : 'This display shows SDR: Full HDR needs one with headroom (Settings → Display)'
      }
    >
      Full HDR
    </button>
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
  const gainMapEdit = useDevelop((s) => s.recipe?.gainMap ?? 'base')
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
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
  const masksUp = useUi((s) => s.masksWin.open && !s.masksWin.minimized)
  const maskCount = useDevelop((s) => s.recipe?.layers.length ?? 0)
  const views: { label: string; k: string; on: boolean; toggle: () => void; title: string }[] = [
    {
      label: 'Before',
      k: k('view.before'),
      on: compare === 'before',
      toggle: () => setCompare(compare === 'before' ? 'off' : 'before'),
      title: withKey('Before', 'view.before')
    },
    {
      label: 'Split',
      k: k('view.split'),
      on: compare === 'split',
      toggle: () => setCompare(compare === 'split' ? 'off' : 'split'),
      title: withKey('Before/after split', 'view.split')
    },
    {
      label: 'Clipping',
      k: k('view.clipping'),
      on: clipping,
      toggle: () => setClipping(!clipping),
      title: withKey('Clipping', 'view.clipping')
    },
    ...(session?.isHdr
      ? [
          {
            label: 'Headroom',
            k: '',
            on: headroom,
            toggle: () => setHeadroom(!headroom),
            title: 'Where the picture rises above white: amber just above, magenta at the peak'
          }
        ]
      : []),
    {
      label: '1:1',
      k: k('zoom.toggle'),
      on: zoomed,
      toggle: () => loupeZoom.toggle(),
      title: `${withKey('Fit ↔ 100%', 'zoom.toggle')} · pinch or scroll to zoom, ${k('view.pan') || 'Space'}+drag to pan`
    }
  ]
  return (
    <nav className="tool-bar">
      <button
        className="ghost lg"
        onClick={() => setView('library')}
        title={withKey('Library', 'develop.library')}
      >
        <Icon name="library" />
        Library {k('develop.library') && <span className="kbd">{k('develop.library')}</span>}
      </button>
      <span className="vsep" />
      <button
        className="icon ghost lg"
        onClick={undo}
        disabled={!canUndo}
        title={withKey('Undo', 'undo')}
      >
        <Icon name="undo" />
      </button>
      <button
        className="icon ghost lg"
        onClick={redo}
        disabled={!canRedo}
        title={withKey('Redo', 'redo')}
      >
        <Icon name="redo" />
      </button>
      <span className="vsep" />
      <FullHdrToggle />
      <div className="seg lg" role="group" aria-label="View">
        {views.map((v) => (
          <button
            key={v.label}
            className={v.on ? 'on' : ''}
            aria-pressed={v.on}
            onClick={v.toggle}
            title={v.title}
          >
            {v.label}
            {v.k && <span className="k">{v.k}</span>}
          </button>
        ))}
      </div>
      {session?.info.gain_map && (
        <>
          <span className="vsep" />
          <div className="seg lg" role="group" aria-label="Edit the photo as">
            {(['base', 'hdr'] as const).map((m) => (
              <button
                key={m}
                className={gainMapEdit === m ? 'on' : ''}
                aria-pressed={gainMapEdit === m}
                onClick={() => {
                  if (gainMapEdit === m) return
                  edit((r) => (r.gainMap = m))
                  commit(m === 'hdr' ? 'Edit as HDR' : 'Edit as SDR')
                }}
                title={
                  m === 'hdr'
                    ? 'Edit the HDR rendition the gain map lifts this photo to (it is written as HDR, or as SDR with a gain map)'
                    : 'Edit the SDR picture the file stores (what a display without HDR shows)'
                }
              >
                {m === 'hdr' ? 'HDR' : 'SDR'}
              </button>
            ))}
          </div>
        </>
      )}
      <span className="vsep" />
      <button
        className={`ghost lg masks-toggle${masksUp ? ' on' : ''}`}
        aria-pressed={masksUp}
        onClick={toggleMasks}
        title={withKey('Masks window', 'masks.toggle')}
      >
        <Icon name="overlay" />
        Masks
        {maskCount > 0 && <span className="masks-count">{maskCount}</span>}
      </button>
      <span className="spacer" />
      <button
        className="icon ghost lg"
        onClick={() => setDialog('engine')}
        disabled={!session}
        title="Engine report (Ctrl+Alt+E)"
        aria-label="Engine report"
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
            say('Virtual copy created')
          } catch (err) {
            say(errorText(err), 'error')
          }
        }}
        title={withKey('Virtual copy', 'virtualCopy')}
      >
        <Icon name="copy" />
        Copy
      </button>
      <LiquidGlass
        as="button"
        className="primary lg"
        flat
        onClick={() => setDialog('export')}
        title={withKey('Export', 'export')}
      >
        <Icon name="export" />
        Export
      </LiquidGlass>
    </nav>
  )
}
