import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'

/** The second tier in Develop: back to the library, history, how to look, and what to do with the photo. */
export function DevelopToolbar(): React.JSX.Element {
  const compare = useDevelop((s) => s.compare)
  const setCompare = useDevelop((s) => s.setCompare)
  const clipping = useDevelop((s) => s.clipping)
  const setClipping = useDevelop((s) => s.setClipping)
  const zoom = useDevelop((s) => s.zoom)
  const setZoom = useDevelop((s) => s.setZoom)
  const undo = useDevelop((s) => s.undo)
  const redo = useDevelop((s) => s.redo)
  const canUndo = useDevelop((s) => s.cursor > 0)
  const canRedo = useDevelop((s) => s.cursor < s.history.length - 1)
  const session = useDevelop((s) => s.session)
  const setView = useLibrary((s) => s.setView)
  const setDialog = useLibrary((s) => s.setDialog)
  const refresh = useLibrary((s) => s.refresh)
  const say = useLibrary((s) => s.say)
  const views: { label: string; k: string; on: boolean; toggle: () => void; title: string }[] = [
    {
      label: 'Before',
      k: '\\',
      on: compare === 'before',
      toggle: () => setCompare(compare === 'before' ? 'off' : 'before'),
      title: 'Before (\\)'
    },
    {
      label: 'Split',
      k: 'Y',
      on: compare === 'split',
      toggle: () => setCompare(compare === 'split' ? 'off' : 'split'),
      title: 'Before/after split (Y)'
    },
    {
      label: 'Clipping',
      k: 'J',
      on: clipping,
      toggle: () => setClipping(!clipping),
      title: 'Clipping (J)'
    },
    {
      label: '1:1',
      k: 'Z',
      on: zoom === 1,
      toggle: () => setZoom(zoom === 1 ? 'fit' : 1),
      title: '100% (Z)'
    }
  ]
  return (
    <nav className="tool-bar">
      <button className="ghost lg" onClick={() => setView('library')} title="Library (G)">
        <Icon name="library" />
        Library <span className="kbd">G</span>
      </button>
      <span className="vsep" />
      <button className="icon ghost lg" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <Icon name="undo" />
      </button>
      <button
        className="icon ghost lg"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
      >
        <Icon name="redo" />
      </button>
      <span className="vsep" />
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
            <span className="k">{v.k}</span>
          </button>
        ))}
      </div>
      <span className="spacer" />
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
        title="Virtual copy (Ctrl+')"
      >
        <Icon name="copy" />
        Copy
      </button>
      <button
        className="lg"
        onClick={() => setDialog('enhance')}
        title="Enhance → Super Resolution"
      >
        <Icon name="enhance" />
        Enhance
      </button>
      <LiquidGlass
        as="button"
        className="primary lg"
        flat
        onClick={() => setDialog('export')}
        title="Export (Ctrl+Shift+E)"
      >
        <Icon name="export" />
        Export
      </LiquidGlass>
    </nav>
  )
}
