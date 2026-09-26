import { AnimatePresence, MotionConfig } from 'motion/react'
import { memo, useEffect } from 'react'
import type { RenderScale } from '../../shared/ipc'
import { RECIPE_GROUPS } from '../../shared/recipe'
import { api, errorText } from './lib/api'
import { runJob, useBusy } from './state/busy'
import { ProcessingOverlay } from './fx/ProcessingOverlay'
import { Scopes } from './develop/Scopes'
import { ToolDial } from './develop/ToolDial'
import { ToolPanelHost } from './develop/ToolPanelHost'
import { selectPanel, stepPanel, TOOLS } from './develop/tools'
import { startMaskTool } from './panels/masks/model'
import { DevelopToolbar } from './shell/DevelopToolbar'
import { DevelopIdentity } from './shell/IdentityBar'
import { LeftRail } from './shell/LeftRail'
import { useDevelop } from './state/develop'
import { useLibrary } from './state/library'
import { useUi } from './state/ui'
import { EnhanceDialog, ExportDialog, SavePresetDialog, SyncDialog } from './views/Dialogs'
import { FilmToggle, Filmstrip } from './views/Filmstrip'
import { LibraryIdentity, LibraryStatus, LibraryView, Toolbar } from './views/Library'
import { FloatingToolbar } from './views/loupe/FloatingToolbar'
import { MasksFloat } from './panels/masks/MasksFloat'
import { Loupe } from './views/loupe/Loupe'
import { loupeZoom, setSpace } from './views/loupe/zoom'

/**
 * Develop: identity and tools across the top; the rail, the loupe and the
 * tools below. It is memoised, so a toast, a dialog or the engine's status
 * changing elsewhere never re-renders what is under the pointer.
 */
const DevelopScreen = memo(function DevelopScreen(): React.JSX.Element {
  return (
    <div className="develop">
      <DevelopIdentity />
      <DevelopToolbar />
      <div className="develop-body">
        <LeftRail />
        <main className="centre">
          <div className="stage">
            <Loupe />
            <FloatingToolbar />
            <MasksFloat />
            <ProcessingOverlay />
            <FilmToggle />
          </div>
          <Filmstrip />
        </main>
        <aside className="right">
          <Scopes />
          <ToolDial />
          <ToolPanelHost />
        </aside>
      </div>
    </div>
  )
})

const LibraryScreen = memo(function LibraryScreen(): React.JSX.Element {
  return (
    <div className="library">
      <LibraryIdentity />
      <Toolbar />
      <LibraryView />
      <LibraryStatus />
    </div>
  )
})

function Screens(): React.JSX.Element {
  const view = useLibrary((s) => s.view)
  return view === 'library' ? <LibraryScreen /> : <DevelopScreen />
}

function DialogHost(): React.JSX.Element {
  const dialog = useLibrary((s) => s.dialog)
  return (
    <AnimatePresence>
      {dialog === 'export' && <ExportDialog key="export" />}
      {dialog === 'sync' && <SyncDialog key="sync" />}
      {dialog === 'preset' && <SavePresetDialog key="preset" />}
      {dialog === 'enhance' && <EnhanceDialog key="enhance" />}
    </AnimatePresence>
  )
}

function Toast(): React.JSX.Element | null {
  const toast = useLibrary((s) => s.toast)
  if (!toast) return null
  return (
    <div className={`toast ${toast.tone}`} key={toast.text} role="status">
      {toast.text}
      {toast.action && (
        <button
          className="primary"
          onClick={() => {
            useLibrary.setState({ toast: null })
            toast.action?.run()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

function EngineBanner(): React.JSX.Element | null {
  const engine = useLibrary((s) => s.engine)
  if (!engine || engine.status === 'ready') return null
  return (
    <div className="engine-banner" role="alert">
      Engine {engine.status}
      {engine.reason ? `: ${engine.reason}` : ''}
    </div>
  )
}

let restartText: string | null = null

/**
 * A display that wants another scale than the app started with (the mode
 * was changed, or the window moved) offers a restart; moving back takes the
 * offer away.
 */
function onRenderScale(s: RenderScale): void {
  const lib = useLibrary.getState()
  if (!s.restartNeeded) {
    if (restartText && lib.toast?.text === restartText) useLibrary.setState({ toast: null })
    restartText = null
    return
  }
  const times = (n: number): string => `${Number(n.toFixed(2))}×`
  const name = s.target === null ? 'Native' : s.mode === 'ultra' ? 'Ultra' : 'Performance'
  const scale = s.target ?? s.native
  const text = `${name} rendering${scale ? ` (${times(scale)})` : ''} starts after a restart`
  if (text === restartText && lib.toast?.text === text) return
  restartText = text
  lib.say(text, 'info', { label: 'Restart', run: () => void api.app.restart() })
}

/** Poll the engine's status, storing it only when it changed, so nothing re-renders every tick. */
async function refreshEngine(): Promise<void> {
  const engine = await api.app.engineStatus()
  const prev = useLibrary.getState().engine
  if (JSON.stringify(prev) !== JSON.stringify(engine)) useLibrary.setState({ engine })
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (
        t.tagName === 'INPUT' &&
        (t as HTMLInputElement).type !== 'range' &&
        (t as HTMLInputElement).type !== 'checkbox'
      )
        return
      if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      // A focused slider owns its arrow keys.
      if (t.tagName === 'INPUT' && e.key.startsWith('Arrow')) return
      const lib = useLibrary.getState()
      const dev = useDevelop.getState()
      // An open dialog has the keyboard (it closes itself on Escape).
      if (lib.dialog) return
      const mod = e.ctrlKey || e.metaKey
      const inDevelop = lib.view === 'develop'
      const k = e.key
      // ── both views ──
      if (!mod && k >= '0' && k <= '5') return void lib.setMeta({ rating: Number(k) })
      if (!mod && k >= '6' && k <= '9') {
        const label = (['red', 'yellow', 'green', 'blue'] as const)[Number(k) - 6]
        const current = lib.items.find((i) => i.key === lib.focus)?.label
        return void lib.setMeta({ label: current === label ? null : label })
      }
      if (!mod && (k === 'p' || k === 'P')) return void lib.setMeta({ flag: 'pick' })
      if (!mod && (k === 'x' || k === 'X')) return void lib.setMeta({ flag: 'reject' })
      if (!mod && (k === 'u' || k === 'U')) return void lib.setMeta({ flag: null })
      if (mod && e.shiftKey && (k === 'e' || k === 'E')) return lib.setDialog('export')
      if (mod && e.shiftKey && (k === 's' || k === 'S')) return lib.setDialog('sync')
      if (k === 'ArrowRight' || k === 'ArrowLeft') {
        const vis = lib.visible()
        const i = vis.findIndex((it) => it.key === lib.focus)
        const next = vis[Math.min(vis.length - 1, Math.max(0, i + (k === 'ArrowRight' ? 1 : -1)))]
        if (!next) return
        lib.setFocus(next.key)
        if (inDevelop) void dev.open(next.key)
        return e.preventDefault()
      }
      if (!inDevelop) {
        if (k === 'Enter' || k === 'd' || k === 'D' || k === 'e' || k === 'E') {
          if (!lib.focus) return
          lib.setView('develop')
          return void dev.open(lib.focus)
        }
        if (mod && (k === 'a' || k === 'A')) {
          lib.selectAll()
          return e.preventDefault()
        }
        if (mod && (k === 'v' || k === 'V')) return lib.setDialog('sync')
        return
      }
      // ── develop ──
      if (k === 'g' || k === 'G' || k === 'Escape') {
        if (k === 'Escape' && dev.tool !== 'none') {
          const wasCrop = dev.tool === 'crop'
          dev.setTool('none')
          const u = useUi.getState()
          if (wasCrop && u.panel === 'crop') u.setPanel(u.previousPanel)
          return
        }
        if (k === 'Escape' && dev.zoom.scale !== 'fit') return loupeZoom.fit()
        return lib.setView('library')
      }
      // ⌘+ / ⌘− / ⌘0 zoom the loupe (the page itself does not zoom).
      if (mod && (k === '=' || k === '+')) {
        loupeZoom.in()
        return e.preventDefault()
      }
      if (mod && (k === '-' || k === '_')) {
        loupeZoom.out()
        return e.preventDefault()
      }
      if (mod && k === '0') {
        loupeZoom.fit()
        return e.preventDefault()
      }
      if (mod && !e.shiftKey && (k === 'z' || k === 'Z')) return dev.undo()
      if (mod && e.shiftKey && (k === 'z' || k === 'Z')) return dev.redo()
      // The thumb-wheel: Ctrl/Cmd+1…9 jump to a tool, Ctrl/Cmd+↑/↓ turn it.
      if (mod && !e.shiftKey && k >= '1' && k <= '9') {
        const t = TOOLS[Number(k) - 1]
        if (t) selectPanel(t.id)
        return e.preventDefault()
      }
      if (mod && (k === 'ArrowUp' || k === 'ArrowDown')) {
        stepPanel(k === 'ArrowUp' ? -1 : 1)
        return e.preventDefault()
      }
      if (mod && (k === 'c' || k === 'C') && dev.recipe) {
        const groups = RECIPE_GROUPS.filter(
          (g) => g !== 'crop' && g !== 'orientation' && g !== 'localAdjustments'
        )
        lib.setClipboard({
          recipe: structuredClone(dev.recipe),
          groups: [...groups],
          source: dev.session?.key ?? null
        })
        return lib.say('Settings copied (Ctrl+V to paste, Ctrl+Shift+S to choose)')
      }
      if (mod && (k === 'v' || k === 'V') && lib.clipboard && dev.recipe && dev.session) {
        const targets = lib.targets()
        void api.library
          .applyRecipe(
            targets,
            lib.clipboard.recipe,
            lib.clipboard.groups,
            lib.clipboard.source ?? undefined
          )
          .then(async (items) => {
            lib.patchItems(items)
            const s = await api.develop.open(dev.session!.key)
            useDevelop.setState({ recipe: s.recipe })
            lib.say(`Pasted onto ${targets.length} photo${targets.length === 1 ? '' : 's'}`)
          })
        return
      }
      if (mod && k === "'") {
        if (dev.session) void api.library.createCopy(dev.session.key).then(() => lib.refresh())
        return
      }
      if (mod) return
      if (k === '\\') return dev.setCompare(dev.compare === 'before' ? 'off' : 'before')
      if (k === 'y' || k === 'Y') return dev.setCompare(dev.compare === 'split' ? 'off' : 'split')
      if (k === 'j' || k === 'J') return dev.setClipping(!dev.clipping)
      if (k === 'z' || k === 'Z') return loupeZoom.toggle()
      // Space held: drag to pan the zoomed picture.
      if (k === ' ') {
        setSpace(true)
        return e.preventDefault()
      }
      const ui = useUi.getState()
      if (k === 'r' || k === 'R') {
        // R toggles the crop tool, returning to the tool that was showing.
        if (dev.tool === 'crop') {
          dev.setTool('none')
          return selectPanel(ui.panel === 'crop' ? ui.previousPanel : ui.panel)
        }
        return selectPanel('crop', { tool: 'crop' })
      }
      // Brush and lasso: into the selected mask, or (as in Lightroom) a new one.
      if (k === 'b' || k === 'B' || k === 'k' || k === 'K') {
        if (dev.tool === 'brush') return dev.setTool('none')
        if (!dev.layerId) return startMaskTool('brush')
        return selectPanel('masks', { tool: 'brush' })
      }
      if (k === 'l' || k === 'L') {
        if (dev.tool === 'polygon') return dev.setTool('none')
        if (!dev.layerId) return startMaskTool('polygon')
        return selectPanel('masks', { tool: 'polygon' })
      }
      // M: linear gradient, Shift+M: radial gradient (into the selected mask, or a new one).
      if (k === 'm' || k === 'M') {
        const t = e.shiftKey ? 'radial' : 'linear'
        if (dev.tool === t) return dev.setTool('none')
        if (!dev.layerId) {
          startMaskTool(t)
          return
        }
        return selectPanel('masks', { tool: t })
      }
      // H: the pins cycle Auto → Always → Never.
      if (k === 'h' || k === 'H') {
        const order = ['auto', 'always', 'never'] as const
        const cur = order.indexOf(ui.maskOverlay.pins)
        return ui.setMaskOverlay({ pins: order[(cur + 1) % order.length] })
      }
      if (k === 'w' || k === 'W')
        return dev.setTool(dev.tool === 'wb-picker' ? 'none' : 'wb-picker')
      if (k === 'o' || k === 'O') {
        // In the crop tool O cycles the composition guides, as in Lightroom.
        if (dev.tool === 'crop') return ui.cycleCropGuide()
        return dev.setOverlay(!dev.overlay)
      }
      if (k === '[' || k === ']') {
        const size = ui.brushes[ui.brushSlot].size
        return ui.setBrush({
          size:
            k === '['
              ? Math.max(4, Math.round(size / 1.15))
              : Math.min(500, Math.round(size * 1.15))
        })
      }
      if (k === 'A' && e.shiftKey && dev.session && dev.recipe) {
        const key = dev.session.key
        void runJob('Auto tone', () => api.develop.autoTone(key), {
          detail: 'Measuring the picture with the tone sliders at zero'
        })
          .then((basic) => {
            const r = useDevelop.getState().recipe
            if (r) useDevelop.getState().replace({ ...r, basic }, 'Auto tone')
          })
          .catch((err) => lib.say(errorText(err), 'error'))
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === ' ') setSpace(false)
    }
    const onBlur = (): void => setSpace(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])
}

export default function App(): React.JSX.Element {
  useShortcuts()
  useEffect(() => {
    const offs = [
      api.library.onThumb(({ key, url, unreadable }) => {
        const items = useLibrary.getState().items
        const it = items.find((i) => i.key === key)
        if (it)
          useLibrary
            .getState()
            .patchItems([{ ...it, thumbUrl: url ?? it.thumbUrl, unreadable: !!unreadable }])
      }),
      api.library.onChanged(() => void useLibrary.getState().refresh()),
      api.develop.onRendered((e) => useDevelop.getState().onRendered(e)),
      api.app.onRenderScale(onRenderScale),
      api.develop.onRenderError((e) =>
        useDevelop.getState().onError(e.field ? `${e.message} (${e.field})` : e.message)
      ),
      api.enhance.onProgress((p) => {
        // A run in the background shows in the identity bar until it ends.
        const id = `enhance:${p.key}`
        if (p.phase === 'running')
          useBusy.getState().begin({ id, title: 'Enhancing', detail: p.message, scope: 'global' })
        else useBusy.getState().end(id)
        if (p.phase !== 'running' || useLibrary.getState().dialog !== 'enhance')
          useLibrary.getState().say(p.message, p.phase === 'error' ? 'error' : 'info')
        if (p.phase === 'done') void useLibrary.getState().refresh()
      })
    ]
    void (async () => {
      useLibrary.setState({ recent: await api.library.recentFolders() })
      await refreshEngine()
      onRenderScale(await api.app.renderScale())
      const last = await api.app.getSetting<string>('library.lastFolder')
      if (last) await useLibrary.getState().openFolder(last)
    })()
    const t = setInterval(() => void refreshEngine(), 5000)
    return () => {
      offs.forEach((off) => off())
      clearInterval(t)
    }
  }, [])
  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <Screens />
        <DialogHost />
        <Toast />
        <EngineBanner />
      </div>
    </MotionConfig>
  )
}
