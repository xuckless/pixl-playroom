import { AnimatePresence, MotionConfig } from 'motion/react'
import { memo, useEffect } from 'react'
import type { AiJobEvent } from '../../shared/ai'
import type { LibrarySource, RenderScale } from '../../shared/ipc'
import { nextOf } from '../../shared/masks'
import { RECIPE_GROUPS } from '../../shared/recipe'
import { api, errorText } from './lib/api'
import { autoWbBatch } from './lib/autowb'
import { runJob } from './state/busy'
import { useAiJobs } from './state/jobs'
import { ProcessingOverlay } from './fx/ProcessingOverlay'
import { Scopes } from './develop/Scopes'
import { ToolDial } from './develop/ToolDial'
import { ToolPanelHost } from './develop/ToolPanelHost'
import { selectPanel, stepPanel, TOOLS } from './develop/tools'
import { startWheelMemory } from './develop/wheelMemory'
import { startDenoiseUpkeep } from './lib/denoise'
import { startHdrUpkeep } from './lib/hdr'
import { deleteSpot } from './lib/heal'
import {
  componentLabel,
  deleteComponent,
  deleteMask,
  duplicateComponent,
  duplicateMask,
  patchMask,
  startMaskTool
} from './panels/masks/model'
import { DevelopToolbar } from './shell/DevelopToolbar'
import { DevelopIdentity } from './shell/IdentityBar'
import { LeftRail } from './shell/LeftRail'
import { Splash } from './shell/Splash'
import { useDevelop } from './state/develop'
import { useBoot } from './state/boot'
import { useLibrary } from './state/library'
import { OVERLAY_MODES, useUi } from './state/ui'
import { ExportDialog, SavePresetDialog, SyncDialog } from './views/Dialogs'
import { EngineReportDialog } from './views/EngineReport'
import { CrashConsentDialog, PreferencesDialog } from './views/Preferences'
import { FilmToggle, Filmstrip } from './views/Filmstrip'
import { LibraryIdentity, LibraryStatus, LibraryView, Toolbar } from './views/Library'
import { CollectionDialog } from './views/library/CollectionDialog'
import { InfoDrawer } from './views/library/InfoDrawer'
import { Sidebar } from './views/library/Sidebar'
import { FloatingToolbar } from './views/loupe/FloatingToolbar'
import { flashHud } from './views/loupe/hudNote'
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
      <div className="library-body">
        <Sidebar />
        <main className="library-main">
          <LibraryView />
        </main>
        <InfoDrawer />
      </div>
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
  const editing = useLibrary((s) => s.editing)
  return (
    <AnimatePresence>
      {dialog === 'collection' && editing && (
        <CollectionDialog key={`collection:${editing.id ?? 'new'}`} initial={editing} />
      )}
      {dialog === 'export' && <ExportDialog key="export" />}
      {dialog === 'sync' && <SyncDialog key="sync" />}
      {dialog === 'preset' && <SavePresetDialog key="preset" />}
      {dialog === 'preferences' && <PreferencesDialog key="preferences" />}
      {dialog === 'crash-consent' && <CrashConsentDialog key="crash-consent" />}
      {dialog === 'engine' && <EngineReportDialog key="engine" />}
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
      {engine.code === 'VersionMismatch'
        ? 'Engine version mismatch — reinstall the app (or run pnpm install in a checkout)'
        : `Engine ${engine.status}`}
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

/** The longest the launch waits on an engine that never says hello. */
const ENGINE_BOOT_MS = 20_000

/** Poll quickly until the engine has started (ready or not), for the splash. */
async function waitForEngine(): Promise<void> {
  const until = performance.now() + ENGINE_BOOT_MS
  for (;;) {
    await refreshEngine()
    if (useLibrary.getState().engine?.status !== 'starting') return
    if (performance.now() > until) return
    await new Promise((r) => setTimeout(r, 150))
  }
}

/**
 * Photos opened from outside (Finder's and Explorer's "Open With", a second
 * launch): their folder opens with them selected, and the first goes to
 * Develop. A folder (main sends it with a trailing separator) just opens.
 * The folder opens as the library's source, in place of whatever was shown.
 */
async function openPaths(paths: string[]): Promise<void> {
  const isDir = (p: string): boolean => /[\\/]$/.test(p)
  const files = paths.filter((p) => !isDir(p))
  // A folder loses its separator again, unless it is a root.
  const dir = paths.find(isDir)?.replace(/(?<=[^\\/:])[\\/]$/, '') ?? null
  try {
    const { folder, keys } = files.length
      ? await api.library.resolvePaths(files)
      : { folder: dir, keys: [] }
    if (!folder) return
    if (!(await useLibrary.getState().openSource({ kind: 'folder', path: folder }))) return
    const lib = useLibrary.getState()
    const known = new Set(lib.items.map((i) => i.key))
    const picked = keys.filter((k) => known.has(k))
    if (!picked[0]) return
    useLibrary.setState({ selection: picked, focus: picked[0] })
    lib.setView('develop')
    await useDevelop.getState().open(picked[0])
  } catch (err) {
    useLibrary.getState().say(errorText(err), 'error')
  }
}

/**
 * What the library showed last time: its source (a folder, a collection, a
 * keyword), else the last folder (a profile from before sources, or a
 * collection since deleted).
 */
async function openLastSource(): Promise<void> {
  const [src, folder] = await Promise.all([
    api.app.getSetting<LibrarySource>('library.lastSource').catch(() => null),
    api.app.getSetting<string>('library.lastFolder').catch(() => null)
  ])
  const lib = useLibrary.getState()
  if (folder) useLibrary.setState({ lastFolder: folder })
  // A collection deleted since falls through quietly to the folder.
  const gone =
    src?.kind === 'collection' && !useLibrary.getState().collections.some((c) => c.id === src.id)
  if (src && src.kind !== 'duplicates' && !gone && (await lib.openSource(src))) return
  if (folder && !(src?.kind === 'folder' && src.path === folder)) await lib.openFolder(folder)
}

/**
 * An AI job's end: say how it went, and when it made a mask for the photo in
 * view, show it (the recipe it was added to, a history step, the new mask
 * selected and revealed with a wipe). The mask is already on its photo
 * either way: main put it there.
 */
async function aiJobEnded(e: AiJobEvent): Promise<void> {
  const lib = useLibrary.getState()
  if (e.phase === 'error') return lib.say(`${e.title}: ${e.message ?? 'failed'}`, 'error')
  if (e.phase !== 'done') return
  const r = e.result
  if (r?.kind === 'applied') {
    // The photo's renders switched over already; say so only when it is not in view.
    if (useDevelop.getState().session?.key !== e.key) lib.say(`${r.label} made for ${e.name}`)
    return
  }
  if (r?.kind === 'file') {
    lib.say(`${e.title}: wrote ${r.path.split(/[\\/]/).pop()}`)
    return void lib.refresh()
  }
  if (r?.kind !== 'mask') return
  const dev = useDevelop.getState()
  if (dev.session?.key !== e.key) {
    return lib.say(`${r.label} mask added to ${e.name}`, 'info', {
      label: 'Show',
      run: () => {
        lib.setFocus(e.key)
        void useDevelop.getState().open(e.key)
      }
    })
  }
  const s = await api.develop.open(e.key)
  if (useDevelop.getState().session?.key !== e.key) return
  useDevelop.getState().replace(s.recipe, `AI: ${r.label}`)
  if (r.into) {
    useDevelop.getState().setLayer(r.into.layerId)
    // Shown: what the model found is the point.
    useDevelop.getState().setOverlay(true)
    useAiJobs.getState().setReveal(r.into.layerId)
  }
}

/** View ▸ Engine Report…: the open photo's, so only in Develop. */
function openEngineReport(): void {
  const lib = useLibrary.getState()
  if (lib.view === 'develop' && useDevelop.getState().session) lib.setDialog('engine')
  else lib.say('Open a photo in Develop to see its engine report')
}

/** Uncaught errors and rejections go to main: the log, and a crash report when opted in. */
function reportErrors(): () => void {
  const onError = (e: ErrorEvent): void => {
    void api.app
      .reportError({ kind: 'error', message: e.message, stack: e.error?.stack })
      .catch(() => undefined)
  }
  const onRejection = (e: PromiseRejectionEvent): void => {
    const r = e.reason as { message?: string; stack?: string } | undefined
    void api.app
      .reportError({ kind: 'rejection', message: r?.message ?? String(e.reason), stack: r?.stack })
      .catch(() => undefined)
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

/** The first launch without an answer asks whether crash reports may be sent (once the splash is gone). */
async function askCrashConsent(): Promise<void> {
  const prefs = await api.prefs.get().catch(() => null)
  if (prefs?.crashReports !== 'unset' || useLibrary.getState().dialog) return
  useLibrary.getState().setDialog('crash-consent')
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
      if (mod && e.shiftKey && (k === 'u' || k === 'U')) return void autoWbBatch(lib.targets())
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
        // Stacks: ⌘G stacks the selection under the focused photo, ⇧⌘G undoes
        // it, S opens or closes the focused stack, Shift+S makes it the cover.
        if (mod && (k === 'g' || k === 'G')) {
          void (e.shiftKey ? lib.unstackTargets() : lib.stackTargets())
          return e.preventDefault()
        }
        const focused = lib.items.find((i) => i.key === lib.focus)
        if (!mod && !e.shiftKey && k === 's' && focused?.stack)
          return lib.toggleStack(focused.stack.id)
        if (!mod && e.shiftKey && k === 'S' && focused?.stack)
          return void lib.makeCover(focused.key)
        const ui = useUi.getState()
        if (!mod && (k === 'i' || k === 'I')) return ui.setLibraryInfo(!ui.libraryInfo)
        if ((!mod && k === '\\') || (mod && e.shiftKey && (k === 'l' || k === 'L'))) {
          ui.setLibrarySidebar(!ui.librarySidebar)
          return e.preventDefault()
        }
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
      if (mod && e.shiftKey && (k === 'z' || k === 'Z')) return dev.redoStep()
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
          (g) => g !== 'crop' && g !== 'orientation' && g !== 'localAdjustments' && g !== 'retouch'
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
      const masksOpen = useUi.getState().panel === 'masks'
      const healOpen = useUi.getState().panel === 'heal'
      // ⌘D duplicates the selected mask component, or else the selected mask.
      if (mod && !e.shiftKey && (k === 'd' || k === 'D') && masksOpen && dev.layerId) {
        e.preventDefault()
        return dev.compId ? duplicateComponent(dev.compId) : duplicateMask(dev.layerId)
      }
      if (mod) return
      // Delete / Backspace in Heal: the selected spot.
      if ((k === 'Delete' || k === 'Backspace') && healOpen && t.tagName !== 'INPUT') {
        if (dev.spotId) deleteSpot(dev.spotId)
        return
      }
      // Q: the Heal tool (Lightroom's spot removal key).
      if (k === 'q' || k === 'Q')
        return selectPanel(healOpen ? useUi.getState().previousPanel : 'heal')
      // Delete / Backspace: the selected mask component, or else the selected mask.
      if ((k === 'Delete' || k === 'Backspace') && masksOpen && t.tagName !== 'INPUT') {
        const layer = dev.recipe?.layers.find((l) => l.id === dev.layerId)
        if (!layer) return
        e.preventDefault()
        const comp = layer.components.find((c) => c.id === dev.compId)
        if (comp) deleteComponent(comp.id)
        else deleteMask(layer.id)
        return lib.say(`Deleted ${comp ? componentLabel(comp) : layer.name} — Ctrl+Z to undo`)
      }
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
      // H in Heal shows or hides the spots.
      if ((k === 'h' || k === 'H') && healOpen) return ui.setHeal({ showAll: !ui.heal.showAll })
      // H hides or shows the selected mask; Shift+H cycles the pins Auto → Always → Never.
      if (k === 'h' && masksOpen && dev.layerId) {
        const layer = dev.recipe?.layers.find((l) => l.id === dev.layerId)
        if (!layer) return
        return patchMask(layer.id, layer.enabled ? 'Hide mask' : 'Show mask', (l) => {
          l.enabled = !l.enabled
        })
      }
      if (k === 'H' || k === 'h') {
        const order = ['auto', 'always', 'never'] as const
        const cur = order.indexOf(ui.maskOverlay.pins)
        return ui.setMaskOverlay({ pins: order[(cur + 1) % order.length] })
      }
      if (k === 'w' || k === 'W')
        return dev.setTool(dev.tool === 'wb-picker' ? 'none' : 'wb-picker')
      // T: the targeted adjustment tool, for the HSL or Tone Curve panel on show.
      if ((k === 't' || k === 'T') && (ui.panel === 'hsl' || ui.panel === 'curve')) {
        if (dev.tool === 'tat') return dev.setTool('none')
        dev.setTatTarget(ui.panel)
        return dev.setTool('tat')
      }
      // Shift+O cycles how the overlay shows a mask (and shows it).
      if (k === 'O' && e.shiftKey && dev.tool !== 'crop') {
        const mode = nextOf(
          OVERLAY_MODES.map((m) => m.value),
          ui.maskOverlay.mode
        )
        ui.setMaskOverlay({ mode })
        dev.setOverlay(true)
        return flashHud(OVERLAY_MODES.find((m) => m.value === mode)?.label ?? mode)
      }
      if (k === 'o' || k === 'O') {
        // In the crop tool O cycles the composition guides, as in Lightroom.
        if (dev.tool === 'crop') return ui.cycleCropGuide()
        return dev.setOverlay(!dev.overlay)
      }
      if ((k === '[' || k === ']') && healOpen) {
        const size = ui.heal.size
        return ui.setHeal({
          size: k === '[' ? Math.max(0.002, size / 1.15) : Math.min(0.25, size * 1.15)
        })
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
      api.library.onHdr(({ photoId, hdr }) => {
        const mine = useLibrary
          .getState()
          .items.filter((i) => i.photoId === photoId && i.hdr !== hdr)
        if (mine.length) useLibrary.getState().patchItems(mine.map((i) => ({ ...i, hdr })))
      }),
      api.library.onChanged(({ folder }) => useLibrary.getState().onChanged(folder)),
      api.library.onSourcesChanged(() => void useLibrary.getState().onSourcesChanged()),
      api.develop.onRendered((e) => useDevelop.getState().onRendered(e)),
      startWheelMemory(),
      startDenoiseUpkeep(),
      startHdrUpkeep(),
      api.app.onRenderScale(onRenderScale),
      api.app.onOpenPaths((paths) => void openPaths(paths)),
      api.develop.onRenderError((e) =>
        useDevelop.getState().onError(e.field ? `${e.message} (${e.field})` : e.message)
      ),
      api.ai.onEvent((e) => {
        useAiJobs.getState().onEvent(e)
        void aiJobEnded(e)
      }),
      api.app.onOpenPreferences(() => useLibrary.getState().setDialog('preferences')),
      api.app.onOpenEngineReport(openEngineReport),
      reportErrors()
    ]
    void useAiJobs
      .getState()
      .load()
      .catch(() => undefined)
    // The launch, side by side: the engine coming up, and the index then the
    // last folder. The splash follows both and leaves when they are done.
    const boot = useBoot.getState()
    const engineUp = waitForEngine().then(() => boot.finish('engine'))
    const libraryUp = (async () => {
      const [recent, pinned] = await Promise.all([
        api.library.recentFolders(),
        api.app.getSetting<string[]>('library.pinned')
      ])
      useLibrary.setState({ recent, pinned: Array.isArray(pinned) ? pinned : [] })
      await useLibrary.getState().loadSources()
      boot.finish('index')
      onRenderScale(await api.app.renderScale())
      // Photos opened from outside take the place of the last source.
      const opens = await api.app.takeOpens().catch(() => [])
      if (opens.length) await openPaths(opens)
      else await openLastSource()
      boot.finish('folder')
    })()
    void Promise.allSettled([engineUp, libraryUp]).then(() => {
      boot.end()
      void askCrashConsent()
    })
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
        <Splash />
      </div>
    </MotionConfig>
  )
}
