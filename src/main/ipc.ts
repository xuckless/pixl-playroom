/** Every renderer-facing handler. Results are `{ ok: true, ... }` or `{ ok: false, error }`; nothing throws across the bridge. */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFile, readdir } from 'fs/promises'
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
import { applyGroups, newId, planeRef, type Recipe, type RecipeGroup } from '../shared/recipe'
import type { IndexClient } from './indexer/client'
import { IndexError } from './indexer/client'
import type { PlaneStore } from './planestore'
import { renderScale, restart } from './display'
import { EngineError, type EngineClient } from './engine/client'
import { enhanceAvailability, type Enhancer } from './enhance'
import type { Exporter } from './exporter'
import { parseKey } from './keys'
import type { Library } from './library'
import { paths } from './paths'
import type { DevelopSessions } from './render'

function toAppError(err: unknown): AppError {
  if (err instanceof EngineError) return { message: err.message, code: err.code, field: err.field }
  if (err instanceof IndexError) return { message: err.message, code: err.code }
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
  const row = await library.photoRow(key)
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
  index: IndexClient
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
  handle(IPC.app.getSetting, (key: string) => s.index.getSetting(key))
  handle(IPC.app.setSetting, (key: string, value: unknown) => s.index.setSetting(key, value))
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
  handle(IPC.library.openFolder, async (folder: string) => ({
    folder,
    items: await s.library.openFolder(folder)
  }))
  handle(IPC.library.recentFolders, () => s.index.recentFolders())
  handle(IPC.library.setMeta, (keys: string[], patch: MetaPatch) => s.index.setMeta(keys, patch))
  handle(IPC.library.createCopy, async (key: string) => {
    await s.sessions.flush(key)
    const item = await s.index.createCopy(key)
    s.library.queueThumb(item.photoId, item.copyId)
    return item
  })
  handle(IPC.library.deleteCopy, async (key: string) => {
    await s.sessions.close(key)
    await s.index.deleteCopy(key)
  })
  /** Copy groups of `recipe` onto every key's recipe (paste, sync, presets on a selection). */
  handle(
    IPC.library.applyRecipe,
    async (keys: string[], slim: Recipe, groups: RecipeGroup[], sourceKey?: string) => {
      const recipe = await s.planes.hydrate(slim)
      // A white balance means different numbers on a RAW (absolute Kelvin from
      // its as-shot white) and anything else (relative sliders); crossing
      // kinds goes through the engine's white itself.
      let sourceWb: WbContext | null = null
      if (groups.includes('whiteBalance') && recipe.wb.mode === 'custom' && sourceKey) {
        sourceWb = await wbContext(s.library, sourceKey)
      }
      await Promise.all(keys.map((key) => s.sessions.flush(key)))
      const saved = new Map((await s.index.recipes(keys)).map((r) => [r.key, r.recipe]))
      const pairs: { key: string; recipe: Recipe }[] = []
      for (const key of keys) {
        const target = sourceWb ? await wbContext(s.library, key) : null
        const from =
          sourceWb && target ? { ...recipe, wb: convertWb(recipe.wb, sourceWb, target) } : recipe
        const live = s.sessions.liveRecipe(key)
        const base = live ?? saved.get(key)
        if (base) pairs.push({ key, recipe: applyGroups(base, from, groups) })
      }
      // One message, one transaction: a batch commits once.
      const items = await s.index.saveRecipes(pairs)
      for (const { key, recipe: next } of pairs) {
        if (s.sessions.liveRecipe(key)) s.sessions.update(key, next, false)
        const { photoId, copyId } = parseKey(key)
        s.library.queueThumb(photoId, copyId, true)
      }
      return items
    }
  )
  handle(IPC.library.prioritize, (keys: string[]) => s.library.prioritize(keys))
  handle(IPC.library.resetRecipe, async (keys: string[]) => {
    const { items, recipes } = await s.index.resetRecipes(keys)
    for (const key of keys) {
      if (s.sessions.liveRecipe(key)) s.sessions.update(key, recipes[key], false)
      const { photoId, copyId } = parseKey(key)
      s.library.queueThumb(photoId, copyId, true)
    }
    return items
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
  handle(IPC.develop.update, async (key: string, recipe: Recipe, interactive: boolean) =>
    s.sessions.update(key, await s.planes.hydrate(recipe), interactive)
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
  handle(IPC.develop.getPlane, async (ref: string) => {
    const png = await s.planes.get(ref)
    if (png === undefined) throw new Error('a painted mask is missing from the plane store')
    return png
  })
  handle(IPC.develop.saveSnapshots, async (key: string, snapshots: Snapshot[]) => {
    const full = await Promise.all(
      snapshots.map(async (sn) => ({ ...sn, recipe: await s.planes.hydrate(sn.recipe) }))
    )
    await s.index.saveSnapshots(key, full)
  })
  handle(IPC.develop.historyList, async (key: string) =>
    (await s.index.history(key)).map((e) => ({ ...e, recipe: s.planes.slim(e.recipe) }))
  )
  handle(IPC.develop.historyAppend, (key: string, label: string, recipe: Recipe) =>
    s.index.appendHistory(key, label, s.planes.slim(recipe))
  )

  // ── presets and profiles ──
  handle(IPC.presets.list, async (): Promise<Preset[]> =>
    [...BUILTIN_PRESETS, ...(await s.index.presets())].map((p) => ({
      ...p,
      recipe: s.planes.slim(p.recipe)
    }))
  )
  handle(IPC.presets.save, async (p: Omit<Preset, 'id' | 'builtin'> & { id?: string }) => {
    const preset: Preset = {
      ...p,
      recipe: await s.planes.hydrate(p.recipe),
      id: p.id ?? newId(),
      builtin: false
    }
    await s.index.savePreset(preset)
    return preset
  })
  handle(IPC.presets.remove, (id: string) => s.index.removePreset(id))
  handle(IPC.presets.luts, async (): Promise<LutProfile[]> =>
    (await readdir(paths.luts()))
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
    return Promise.all(
      r.filePaths.map(async (f) => {
        const dest = join(paths.luts(), basename(f))
        await copyFile(f, dest)
        return { name: basename(f, '.cube'), path: dest }
      })
    )
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
    void s.index.setSetting('export.last', settings).catch(() => {})
    return s.exporter.start(keys, settings)
  })
  handle(IPC.export.cancel, (id: string) => s.exporter.cancel(id))
  handle(IPC.export.presets, () => s.index.exportPresets())
  handle(IPC.export.savePreset, async (p: Omit<ExportPreset, 'id'> & { id?: string }) => {
    const preset: ExportPreset = { ...p, id: p.id ?? newId() }
    await s.index.saveExportPreset(preset)
    return preset
  })
  handle(IPC.export.removePreset, (id: string) => s.index.removeExportPreset(id))

  // ── enhance ──
  handle(IPC.enhance.available, () => enhanceAvailability(s.bgEngine.getStatus().enhance === true))
  handle(IPC.enhance.run, (key: string, choice: 'auto' | 'cpu') => {
    void s.enhancer.run(key, choice)
  })
}
