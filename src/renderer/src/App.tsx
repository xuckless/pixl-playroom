import { AnimatePresence, MotionConfig } from 'motion/react'
import { memo, useEffect, useState } from 'react'
import type { AiJobEvent } from '../../shared/ai'
import type { LibraryItem, LibrarySource, RenderScale } from '../../shared/ipc'
import { api, errorText } from './lib/api'
import { useAiJobs } from './state/jobs'
import { ProcessingOverlay } from './fx/ProcessingOverlay'
import { ConfirmHost } from './components/ConfirmHost'
import { ModelPromptHost } from './components/ModelPromptHost'
import { Scopes } from './develop/Scopes'
import { AdjustStack } from './develop/AdjustStack'
import { ToolStrip } from './develop/ToolStrip'
import { startDrawerSync } from './develop/tools'
import { startDisplayUpkeep, useDisplay, renderDisplay } from './state/display'
import { useUi } from './state/ui'
import { startDenoiseUpkeep, startStaleUpkeep } from './lib/denoise'
import { startHdrUpkeep } from './lib/hdr'
import { setAlwaysFlat, startEfficientUpkeep, useEfficient } from './lib/efficient'
import { DevelopToolbar } from './shell/DevelopToolbar'
import { DevelopIdentity } from './shell/IdentityBar'
import { LeftRail } from './shell/LeftRail'
import { Splash } from './shell/Splash'
import { LooksBrowser } from './views/looks/LooksBrowser'
import { useDevelop } from './state/develop'
import { useBoot } from './state/boot'
import { useLibrary } from './state/library'
import { useConfirm } from './state/confirm'
import { commandFor, COMMANDS, currentBindings } from './lib/commands'
import { chordOf } from './lib/keys'
import { SavePresetDialog, SyncDialog } from './views/Dialogs'
import { ExportDialog } from './views/ExportDialog'
import { EngineReportDialog } from './views/EngineReport'
import { CrashConsentDialog, PreferencesDialog } from './views/Preferences'
import { WhatsNewDialog } from './views/WhatsNew'
import { ScopesExpandedDialog } from './develop/ScopesExpanded'
import { showWhatsNew } from './state/whatsNew'
import { BetaGate, UpdateRequiredGate } from './views/Gate'
import { useGate } from './lib/gate'
import { isFrame, whenFrame } from './lib/frames'
import { openReport } from './lib/report'
import { FilmToggle, Filmstrip } from './views/Filmstrip'
import { LibraryIdentity, LibraryStatus, LibraryView, Toolbar } from './views/Library'
import { CollectionDialog } from './views/library/CollectionDialog'
import { InfoDrawer } from './views/library/InfoDrawer'
import { Sidebar } from './views/library/Sidebar'
import { FloatingToolbar } from './views/loupe/FloatingToolbar'
import { Loupe } from './views/loupe/Loupe'
import { setSpace } from './views/loupe/zoom'

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
            <ProcessingOverlay />
            <FilmToggle />
          </div>
          <Filmstrip />
        </main>
        <aside className="right">
          <Scopes />
          <ToolStrip />
          <AdjustStack />
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
      {dialog === 'looks' && <LooksBrowser key="looks" />}
      {dialog === 'preferences' && <PreferencesDialog key="preferences" />}
      {dialog === 'crash-consent' && <CrashConsentDialog key="crash-consent" />}
      {dialog === 'engine' && <EngineReportDialog key="engine" />}
      {dialog === 'whats-new' && <WhatsNewDialog key="whats-new" />}
      {dialog === 'scopes' && <ScopesExpandedDialog key="scopes" />}
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
        ? 'Engine version mismatch: reinstall the app'
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
async function openLastSource(lists: Promise<void>): Promise<void> {
  const [src, folder] = await Promise.all([
    api.app.getSetting<LibrarySource>('library.lastSource').catch(() => null),
    api.app.getSetting<string>('library.lastFolder').catch(() => null)
  ])
  const lib = useLibrary.getState()
  if (folder) useLibrary.setState({ lastFolder: folder })
  // A collection deleted since falls through quietly to the folder (known
  // once the collections are loaded; a folder needs not wait for them).
  if (src?.kind === 'collection') await lists.catch(() => undefined)
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
  // A smart look's own jobs: its run records them in the look's history step (lib/applyLook.ts).
  if (e.group) return
  if (e.phase === 'error') return lib.say(`${e.title}: ${e.message ?? 'failed'}`, 'error')
  if (e.phase !== 'done') return
  const r = e.result
  if (r?.kind === 'applied') {
    // The photo's renders switched over already; say so only when it is not in view.
    if (useDevelop.getState().session?.key !== e.key) lib.say(`${r.label} made for ${e.name}`)
    return
  }
  if (r?.kind === 'step') {
    // Main added the step to the photo's recipe: History records it here.
    const dev = useDevelop.getState()
    if (dev.session?.key !== e.key) return lib.say(`${r.label} added to ${e.name}`)
    const s = await api.develop.open(e.key)
    if (useDevelop.getState().session?.key !== e.key) return
    useDevelop.getState().replace(s.recipe, r.label)
    return
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

/**
 * Thumbnails as they come, gathered and patched in once a frame: a folder
 * filling would otherwise find and patch one item (and re-sort the grid)
 * per thumbnail.
 */
const thumbsWaiting = new Map<string, { url: string | null; unreadable?: boolean }>()
let thumbFrame = 0
function flushThumbs(): void {
  thumbFrame = 0
  const patch: LibraryItem[] = []
  for (const it of useLibrary.getState().items) {
    const t = thumbsWaiting.get(it.key)
    if (t) patch.push({ ...it, thumbUrl: t.url ?? it.thumbUrl, unreadable: !!t.unreadable })
  }
  thumbsWaiting.clear()
  if (patch.length) useLibrary.getState().patchItems(patch)
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
      // An open dialog, or a confirm, has the keyboard (it closes itself on Escape).
      if (lib.dialog || useConfirm.getState().open) return
      const cmd = commandFor(e, lib.view === 'develop')
      if (cmd) cmd.run(e)
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      // A held command lets go when its key does, whatever else is still down.
      const code = chordOf(e).code
      const bindings = currentBindings()
      for (const c of COMMANDS)
        if (c.hold && bindings[c.id]?.some((b) => b.code === code)) setSpace(false)
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
  const gate = useGate()
  // The launch (the index, the last folder, the listeners) waits until the
  // beta gate first opens, then runs once: main refuses those calls while
  // it's shut, and the splash stays behind the gate meanwhile.
  const [booted, setBooted] = useState(false)
  if (!booted && gate?.kind === 'open') setBooted(true)
  const efficient = useEfficient()
  // The efficient UI, from the first frame: unfocused, or "Always flat".
  useEffect(() => {
    setAlwaysFlat(useUi.getState().alwaysFlat)
    const offs = [
      startEfficientUpkeep(),
      useUi.subscribe((s, prev) => {
        if (s.alwaysFlat !== prev.alwaysFlat) setAlwaysFlat(s.alwaysFlat)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])
  useEffect(() => {
    if (!booted) return
    const offs = [
      api.library.onThumb((e) => {
        thumbsWaiting.set(e.key, e)
        thumbFrame ||= requestAnimationFrame(flushThumbs)
      }),
      api.library.onHdr(({ photoId, hdr }) => {
        const mine = useLibrary
          .getState()
          .items.filter((i) => i.photoId === photoId && i.hdr !== hdr)
        if (mine.length) useLibrary.getState().patchItems(mine.map((i) => ({ ...i, hdr })))
      }),
      api.library.onNames(({ photoId, words }) => {
        const mine = useLibrary.getState().items.filter((i) => i.photoId === photoId)
        if (mine.length) useLibrary.getState().patchItems(mine.map((i) => ({ ...i, names: words })))
      }),
      api.library.onChanged(({ folder }) => useLibrary.getState().onChanged(folder)),
      api.library.onSourcesChanged(() => void useLibrary.getState().onSourcesChanged()),
      api.develop.onRendered((e) => {
        // A draft sent as pixels is shown once they are here (they come on their own port).
        if (!isFrame(e.url)) return useDevelop.getState().onRendered(e)
        void whenFrame(e.url).then((bmp) => bmp && useDevelop.getState().onRendered(e))
      }),
      startDrawerSync(),
      startDenoiseUpkeep(),
      startStaleUpkeep(),
      startDisplayUpkeep(),
      // Full HDR toggled, or the display's numbers moved: render for it again.
      useUi.subscribe((s, prev) => {
        if (s.fullHdr !== prev.fullHdr) useDevelop.getState().pushView()
      }),
      useDisplay.subscribe((s, prev) => {
        const ui = useUi.getState()
        const a = renderDisplay(ui.fullHdr, prev.display)
        const b = renderDisplay(ui.fullHdr, s.display)
        if (JSON.stringify(a) !== JSON.stringify(b)) useDevelop.getState().pushView()
      }),
      startHdrUpkeep(),
      api.app.onRenderScale(onRenderScale),
      api.app.onOpenPaths((paths) => void openPaths(paths)),
      // An upscale step added or undone: the photo's full-size frame is another size.
      api.develop.onFrame((e) => {
        const s = useDevelop.getState().session
        if (s && s.key === e.key) {
          const session = { ...s, frameWidth: e.frameWidth, frameHeight: e.frameHeight }
          useDevelop.setState({ session, shown: session })
        }
      }),
      api.develop.onRenderError((e) => {
        // A failed save is said whichever photo is open: it may be the one just left.
        if (e.code === 'Save') return useLibrary.getState().say(e.message, 'error')
        useDevelop
          .getState()
          .onError(e.field ? `${e.message} (${e.field})` : e.message, e.invariant ?? null)
      }),
      api.ai.onEvent((e) => {
        useAiJobs.getState().onEvent(e)
        void aiJobEnded(e)
      }),
      api.app.onOpenPreferences(() => useLibrary.getState().setDialog('preferences')),
      api.app.onOpenEngineReport(openEngineReport),
      api.app.onOpenReport(openReport),
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
      // The rail's lists and the last source load side by side, not one
      // after the other: the folder is what the launch is waiting to see.
      const lists = (async () => {
        const [recent, pinned] = await Promise.all([
          api.library.recentFolders(),
          api.app.getSetting<string[]>('library.pinned')
        ])
        useLibrary.setState({ recent, pinned: Array.isArray(pinned) ? pinned : [] })
        await useLibrary.getState().loadSources()
        boot.finish('index')
      })()
      onRenderScale(await api.app.renderScale())
      // Photos opened from outside take the place of the last source.
      const opens = await api.app.takeOpens().catch(() => [])
      if (opens.length) await openPaths(opens)
      else await openLastSource(lists)
      await lists
      boot.finish('folder')
    })()
    void Promise.allSettled([engineUp, libraryUp]).then(() => {
      boot.end()
      // After an update, what it brought; the crash-report question waits for a launch without it.
      void showWhatsNew().then(askCrashConsent)
    })
    const t = setInterval(() => void refreshEngine(), 5000)
    return () => {
      offs.forEach((off) => off())
      clearInterval(t)
    }
  }, [booted])
  return (
    <MotionConfig reducedMotion={efficient ? 'always' : 'user'}>
      <div className="app">
        <Screens />
        <DialogHost />
        <ConfirmHost />
        <ModelPromptHost />
        <Toast />
        <EngineBanner />
        <Splash />
        <BetaGate gate={gate} />
        <UpdateRequiredGate />
      </div>
    </MotionConfig>
  )
}
