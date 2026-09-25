import { memo, useEffect } from 'react'
import { newLocalLayer, RECIPE_GROUPS } from '../../shared/recipe'
import { Histogram, HueChart } from './components/charts'
import { api } from './lib/api'
import { emptyRange } from './lib/helpers'
import { AdvancedPanel } from './panels/advanced'
import {
  BasicPanel,
  CalibrationPanel,
  ColorGradePanel,
  DetailPanel,
  EffectsPanel,
  GeometryPanel,
  HslPanel,
  ToneCurvePanel
} from './panels/global'
import { MasksPanel } from './panels/masks'
import { DevelopToolbar } from './shell/DevelopToolbar'
import { DevelopIdentity } from './shell/IdentityBar'
import { LeftRail } from './shell/LeftRail'
import { useDevelop } from './state/develop'
import { useLibrary } from './state/library'
import { useUi } from './state/ui'
import { EnhanceDialog, ExportDialog, SavePresetDialog, SyncDialog } from './views/Dialogs'
import { FilmToggle, Filmstrip } from './views/Filmstrip'
import { LibraryView, Toolbar } from './views/Library'
import { FloatingToolbar } from './views/loupe/FloatingToolbar'
import { Loupe } from './views/loupe/Loupe'

function Scopes(): React.JSX.Element {
  const stats = useDevelop((s) => s.stats)
  const before = useDevelop((s) => s.before)
  const mask = useDevelop((s) => s.mask)
  const layerId = useDevelop((s) => s.layerId)
  const clipping = useDevelop((s) => s.clipping)
  const setClipping = useDevelop((s) => s.setClipping)
  const setHslFocus = useDevelop((s) => s.setHslFocus)
  const setHslTab = useDevelop((s) => s.setHslTab)
  return (
    <div className="scopes">
      <Histogram stats={stats} clipping={clipping} onClipping={setClipping} />
      <HueChart
        stats={stats}
        before={before?.stats ?? null}
        masked={layerId ? (mask?.maskStats ?? null) : null}
        onPick={(hue, band, newMask) => {
          if (newMask) {
            const d = useDevelop.getState()
            if (!d.recipe) return
            const comp = emptyRange('color')
            if (comp.kind === 'range')
              comp.hue = { centre: Math.round(hue), width: 20, softness: 15 }
            const layer = newLocalLayer(`${band} range`)
            layer.components.push(comp)
            d.replace(
              { ...d.recipe, layers: [...d.recipe.layers, layer] },
              `Colour mask at ${Math.round(hue)}°`
            )
            d.setLayer(layer.id)
          } else {
            setHslFocus(band)
            setHslTab('all')
          }
        }}
      />
    </div>
  )
}

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
            <FilmToggle />
          </div>
          <Filmstrip />
        </main>
        <aside className="right">
          <Scopes />
          <div className="panels">
            <BasicPanel />
            <ToneCurvePanel />
            <HslPanel />
            <ColorGradePanel />
            <DetailPanel />
            <EffectsPanel />
            <MasksPanel />
            <GeometryPanel />
            <CalibrationPanel />
            <AdvancedPanel />
          </div>
        </aside>
      </div>
    </div>
  )
})

const LibraryScreen = memo(function LibraryScreen(): React.JSX.Element {
  return (
    <div className="library">
      <Toolbar />
      <LibraryView />
    </div>
  )
})

function Screens(): React.JSX.Element {
  const view = useLibrary((s) => s.view)
  return view === 'library' ? <LibraryScreen /> : <DevelopScreen />
}

function DialogHost(): React.JSX.Element | null {
  const dialog = useLibrary((s) => s.dialog)
  if (dialog === 'export') return <ExportDialog />
  if (dialog === 'sync') return <SyncDialog />
  if (dialog === 'preset') return <SavePresetDialog />
  if (dialog === 'enhance') return <EnhanceDialog />
  return null
}

function Toast(): React.JSX.Element | null {
  const toast = useLibrary((s) => s.toast)
  if (!toast) return null
  return (
    <div className={`toast ${toast.tone}`} key={toast.text} role="status">
      {toast.text}
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
        if (k === 'Escape' && dev.tool !== 'none') return dev.setTool('none')
        if (k === 'Escape' && dev.zoom === 1) return dev.setZoom('fit')
        return lib.setView('library')
      }
      if (mod && !e.shiftKey && (k === 'z' || k === 'Z')) return dev.undo()
      if (mod && e.shiftKey && (k === 'z' || k === 'Z')) return dev.redo()
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
      if (k === 'z' || k === 'Z') return dev.setZoom(dev.zoom === 1 ? 'fit' : 1)
      if (k === 'r' || k === 'R') return dev.setTool(dev.tool === 'crop' ? 'none' : 'crop')
      if (k === 'b' || k === 'B' || k === 'k' || k === 'K')
        return dev.setTool(dev.tool === 'brush' ? 'none' : 'brush')
      if (k === 'l' || k === 'L') return dev.setTool(dev.tool === 'polygon' ? 'none' : 'polygon')
      if (k === 'w' || k === 'W')
        return dev.setTool(dev.tool === 'wb-picker' ? 'none' : 'wb-picker')
      if (k === 'o' || k === 'O') {
        // In the crop tool O cycles the composition guides, as in Lightroom.
        if (dev.tool === 'crop') return useUi.getState().cycleCropGuide()
        return dev.setOverlay(!dev.overlay)
      }
      if (k === '[') return dev.setBrush({ size: Math.max(4, Math.round(dev.brush.size / 1.15)) })
      if (k === ']') return dev.setBrush({ size: Math.min(500, Math.round(dev.brush.size * 1.15)) })
      if (k === 'A' && e.shiftKey && dev.session && dev.recipe) {
        void api.develop
          .autoTone(dev.session.key)
          .then((basic) => dev.replace({ ...dev.recipe!, basic }, 'Auto tone'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App(): React.JSX.Element {
  useShortcuts()
  useEffect(() => {
    const offs = [
      api.library.onThumb(({ key, url }) => {
        const items = useLibrary.getState().items
        const it = items.find((i) => i.key === key)
        if (it) useLibrary.getState().patchItems([{ ...it, thumbUrl: url }])
      }),
      api.library.onChanged(() => void useLibrary.getState().refresh()),
      api.develop.onRendered((e) => useDevelop.getState().onRendered(e)),
      api.develop.onRenderError((e) =>
        useDevelop.getState().onError(e.field ? `${e.message} (${e.field})` : e.message)
      ),
      api.enhance.onProgress((p) => {
        useLibrary.getState().say(p.message, p.phase === 'error' ? 'error' : 'info')
        if (p.phase === 'done') void useLibrary.getState().refresh()
      })
    ]
    void (async () => {
      useLibrary.setState({ recent: await api.library.recentFolders() })
      await refreshEngine()
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
    <div className="app">
      <Screens />
      <DialogHost />
      <Toast />
      <EngineBanner />
    </div>
  )
}
