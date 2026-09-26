/** Every renderer-facing handler. Results are `{ ok: true, ... }` or `{ ok: false, error }`; nothing throws across the bridge. */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFileSync, existsSync, readdirSync } from 'fs'
import { basename, join } from 'path'
import { cpus } from 'os'
import type { ExportSettings } from '../shared/export'
import {
  IPC,
  type AppError,
  type ExportPreset,
  type LutProfile,
  type MetaPatch,
  type Preset,
  type RegionRequest,
  type Snapshot,
  type ViewState
} from '../shared/ipc'
import { absoluteWb, baseWhite } from '../shared/compile'
import type { WhitePoint } from '../shared/engine-types'
import { absoluteFromOp, relativeFromOp } from '../shared/wb'
import { BUILTIN_PRESETS } from '../shared/presets'
import {
  applyGroups,
  defaultRecipe,
  newId,
  planeRef,
  type Recipe,
  type RecipeGroup
} from '../shared/recipe'
import type { Store } from './db'
import type { PlaneStore } from './planestore'
import { renderScale, restart } from './display'
import { EngineError, type EngineClient } from './engine/client'
import { enhanceAvailability, type Enhancer } from './enhance'
import type { Exporter } from './exporter'
import { parseKey, type Library } from './library'
import { paths } from './paths'
import type { DevelopSessions } from './render'
import { itemOf } from './sidecar'

function toAppError(err: unknown): AppError {
  if (err instanceof EngineError) return { message: err.message, code: err.code, field: err.field }
  return { message: err instanceof Error ? err.message : String(err), code: 'Error' }
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (_e, ...args: unknown[]) => {
    try {
      const value = await fn(...(args as A))
      return { ok: true, value }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
}

interface WbContext {
  isRaw: boolean
  asShot: WhitePoint | null
}

async function wbContext(library: Library, key: string): Promise<WbContext> {
  const row = library.photoRow(key)
  const isRaw = row.is_raw === 1
  const info = isRaw ? await library.probe(row) : null
  return { isRaw, asShot: info?.as_shot_white ?? null }
}

/** The same white, in the target's slider units. */
function convertWb(wb: Recipe['wb'], from: WbContext, to: WbContext): Recipe['wb'] {
  if (absoluteWb(from) === absoluteWb(to)) return wb
  const op = baseWhite({ wb } as Recipe, from) ?? { kelvin: 6504, tint: 0 }
  if (absoluteWb(to) && to.asShot) {
    const abs = absoluteFromOp(op, to.asShot)
    return {
      mode: 'custom',
      temperature: Math.round(abs.kelvin),
      tint: Math.round(abs.tint * 3000),
      preset: null
    }
  }
  const rel = relativeFromOp(op)
  return {
    mode: 'custom',
    temperature: Math.round(rel.temperature),
    tint: Math.round(rel.tint),
    preset: null
  }
}

export interface Services {
  store: Store
  planes: PlaneStore
  library: Library
  sessions: DevelopSessions
  exporter: Exporter
  enhancer: Enhancer
  engine: EngineClient
  bgEngine: EngineClient
}

export function registerIpc(s: Services): void {
  const win = (): BrowserWindow | undefined =>
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

  // ── app ──
  handle(IPC.app.cpus, () => cpus().length)
  handle(IPC.app.engineStatus, () => s.engine.getStatus())
  handle(IPC.app.getSetting, (key: string) => s.store.getSetting(key) ?? null)
  handle(IPC.app.setSetting, (key: string, value: unknown) => s.store.setSetting(key, value))
  handle(IPC.app.reveal, (path: string) => shell.showItemInFolder(path))
  handle(IPC.app.renderScale, () => renderScale())
  handle(IPC.app.restart, () => restart())

  // ── library ──
  handle(IPC.library.chooseFolder, async () => {
    const w = win()
    const r = w
      ? await dialog.showOpenDialog(w, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle(IPC.library.openFolder, (folder: string) => ({
    folder,
    items: s.library.openFolder(folder)
  }))
  handle(IPC.library.recentFolders, () => s.store.recentFolders().filter((f) => existsSync(f)))
  handle(IPC.library.setMeta, (keys: string[], patch: MetaPatch) => {
    s.library.setMeta(keys, patch)
    return keys.map((k) => s.library.item(k))
  })
  handle(IPC.library.createCopy, (key: string) => {
    s.sessions.flush(key)
    const k = s.library.createCopy(key)
    return s.library.item(k)
  })
  handle(IPC.library.deleteCopy, (key: string) => {
    s.sessions.close(key)
    s.library.deleteCopy(key)
  })
  /** Copy groups of `recipe` onto every key's recipe (paste, sync, presets on a selection). */
  handle(
    IPC.library.applyRecipe,
    async (keys: string[], slim: Recipe, groups: RecipeGroup[], sourceKey?: string) => {
      const recipe = s.planes.hydrate(slim)
      // A white balance means different numbers on a RAW (absolute Kelvin from
      // its as-shot white) and anything else (relative sliders); crossing
      // kinds goes through the engine's white itself.
      let sourceWb: WbContext | null = null
      if (groups.includes('whiteBalance') && recipe.wb.mode === 'custom' && sourceKey) {
        sourceWb = await wbContext(s.library, sourceKey)
      }
      const from = new Map<string, Recipe>()
      for (const key of keys) {
        s.sessions.flush(key)
        const target = sourceWb ? await wbContext(s.library, key) : null
        from.set(
          key,
          sourceWb && target ? { ...recipe, wb: convertWb(recipe.wb, sourceWb, target) } : recipe
        )
      }
      // The writes in one transaction: a batch commits once.
      s.store.tx(() => {
        for (const key of keys) {
          const live = s.sessions.liveRecipe(key)
          const next = applyGroups(live ?? s.library.recipe(key), from.get(key) ?? recipe, groups)
          s.library.saveRecipe(key, next)
          if (live) s.sessions.update(key, next, false)
          const { photoId, copyId } = parseKey(key)
          s.library.queueThumb(photoId, copyId, true)
        }
      })
      return keys.map((k) => s.library.item(k))
    }
  )
  handle(IPC.library.prioritize, (keys: string[]) => s.library.prioritize(keys))
  handle(IPC.library.resetRecipe, (keys: string[]) => {
    s.store.tx(() => {
      for (const key of keys) {
        const raw = s.library.photoRow(key).is_raw === 1
        const fresh = defaultRecipe(raw)
        s.library.saveRecipe(key, fresh)
        if (s.sessions.liveRecipe(key)) s.sessions.update(key, fresh, false)
        const { photoId, copyId } = parseKey(key)
        s.library.queueThumb(photoId, copyId, true)
      }
    })
    return keys.map((k) => s.library.item(k))
  })

  // ── develop ──
  // Recipes go out with their brush planes by reference and come back in
  // hydrated (planestore.ts): the renderer never holds the PNGs in its state.
  handle(IPC.develop.open, async (key: string) => {
    const d = await s.sessions.open(key)
    return {
      ...d,
      recipe: s.planes.slim(d.recipe),
      snapshots: d.snapshots.map((sn) => ({ ...sn, recipe: s.planes.slim(sn.recipe) }))
    }
  })
  handle(IPC.develop.close, (key: string) => s.sessions.close(key))
  handle(IPC.develop.update, (key: string, recipe: Recipe, interactive: boolean) =>
    s.sessions.update(key, s.planes.hydrate(recipe), interactive)
  )
  handle(IPC.develop.view, (key: string, view: ViewState) => s.sessions.view(key, view))
  handle(IPC.develop.region, (req: RegionRequest) => s.sessions.region(req))
  handle(IPC.develop.sample, (key: string, x: number, y: number) => s.sessions.sample(key, x, y))
  handle(IPC.develop.autoTone, (key: string) => s.sessions.autoTone(key))
  handle(IPC.develop.autoWb, (key: string) => s.sessions.autoWb(key))
  handle(IPC.develop.noise, (key: string) => s.sessions.noise(key))
  handle(IPC.develop.putPlane, (png: string) => {
    const ref = planeRef(png)
    s.planes.put(ref, png)
    return ref
  })
  handle(IPC.develop.getPlane, (ref: string) => {
    const png = s.planes.get(ref)
    if (png === undefined) throw new Error('a painted mask is missing from the plane store')
    return png
  })
  handle(IPC.develop.saveSnapshots, (key: string, snapshots: Snapshot[]) => {
    const { copyId } = parseKey(key)
    s.library.update(key, (sc) => {
      const it = itemOf(sc, copyId)
      if (it) it.snapshots = snapshots.map((sn) => ({ ...sn, recipe: s.planes.hydrate(sn.recipe) }))
    })
  })
  handle(IPC.develop.historyList, (key: string) =>
    s.store.history(key).map((e) => ({ ...e, recipe: s.planes.slim(e.recipe) }))
  )
  handle(IPC.develop.historyAppend, (key: string, label: string, recipe: Recipe) =>
    s.store.appendHistory(key, label, s.planes.slim(recipe))
  )

  // ── presets and profiles ──
  handle(IPC.presets.list, (): Preset[] =>
    [...BUILTIN_PRESETS, ...s.store.presets()].map((p) => ({
      ...p,
      recipe: s.planes.slim(p.recipe)
    }))
  )
  handle(IPC.presets.save, (p: Omit<Preset, 'id' | 'builtin'> & { id?: string }) => {
    const preset: Preset = {
      ...p,
      recipe: s.planes.hydrate(p.recipe),
      id: p.id ?? newId(),
      builtin: false
    }
    s.store.savePreset(preset)
    return preset
  })
  handle(IPC.presets.remove, (id: string) => s.store.removePreset(id))
  handle(IPC.presets.luts, (): LutProfile[] =>
    readdirSync(paths.luts())
      .filter((f) => f.toLowerCase().endsWith('.cube'))
      .map((f) => ({ name: basename(f, '.cube'), path: join(paths.luts(), f) }))
  )
  handle(IPC.presets.importLut, async (): Promise<LutProfile[]> => {
    const w = win()
    const opts = {
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'Cube LUT', extensions: ['cube'] }]
    }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return []
    return r.filePaths.map((f) => {
      const dest = join(paths.luts(), basename(f))
      copyFileSync(f, dest)
      return { name: basename(f, '.cube'), path: dest }
    })
  })

  // ── export ──
  handle(IPC.export.chooseFolder, async () => {
    const w = win()
    const opts = {
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[]
    }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })
  handle(IPC.export.start, (keys: string[], settings: ExportSettings) => {
    s.store.setSetting('export.last', settings)
    return s.exporter.start(keys, settings)
  })
  handle(IPC.export.cancel, (id: string) => s.exporter.cancel(id))
  handle(IPC.export.presets, () => s.store.exportPresets())
  handle(IPC.export.savePreset, (p: Omit<ExportPreset, 'id'> & { id?: string }) => {
    const preset: ExportPreset = { ...p, id: p.id ?? newId() }
    s.store.saveExportPreset(preset)
    return preset
  })
  handle(IPC.export.removePreset, (id: string) => s.store.removeExportPreset(id))

  // ── enhance ──
  handle(IPC.enhance.available, () => enhanceAvailability(s.bgEngine.getStatus().enhance === true))
  handle(IPC.enhance.run, (key: string, choice: 'auto' | 'cpu') => {
    void s.enhancer.run(key, choice)
  })
}
