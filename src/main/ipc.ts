/** Every renderer-facing handler. Results are `{ ok: true, ... }` or `{ ok: false, error }`; nothing throws across the bridge. */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import log from 'electron-log/main'
import { copyFile, readdir, readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { cpus } from 'os'
import { pathToFileURL } from 'url'
import { is } from '@electron-toolkit/utils'
import type { ExportSettings } from '../shared/export'
import {
  IPC,
  type AppError,
  type Collection,
  type CrashConsent,
  type ErrorReport,
  type ExportPreset,
  type HistoryLog,
  type LibrarySource,
  type LookThumbRequest,
  type LutProfile,
  type MetaPatch,
  type MetaTextPatch,
  type Preset,
  type RegionRequest,
  type Prefs,
  type Snapshot,
  type UpdateChannel,
  type ViewState
} from '../shared/ipc'
import { convertWb, type WbContext } from '../shared/wbconvert'
import { LicenceError } from '../shared/licence'
import { applyGroups, newId, type Recipe, type RecipeGroup } from '../shared/recipe'
import { applyLook } from '../shared/looks/apply'
import { resolveLook } from '../shared/looks/catalog'
import { planeRef } from './planeref'
import { equivalentFocal } from '../shared/upright'
import { orientedFrame } from '../shared/compile'
import { cropAtAspect } from '../shared/crop'
import { ensureProxies } from './proxy'
import { BACKGROUND_THREADS } from './source'
import type { IndexClient } from './indexer/client'
import { IndexError } from './indexer/client'
import type { PlaneStore } from './planestore'
import { renderScale, restart } from './display'
import { EngineError, type EngineClient } from './engine/client'
import { autoWbBatch, setWbBatch } from './autowb'
import { crashConsent, reportRendererError, sendProblemReport, setCrashConsent } from './crash'
import { freeDevice, licence, refreshLicence, requireLicence, startTrial } from './licence'
import type { AiCapabilities, AiStartRequest } from '../shared/ai'
import { immediateLayers, previewLayers, smartReadiness } from '../shared/looks/smart'
import type { LookRunRequest, PickAnswer } from '../shared/looks/run'
import { LookRuns } from './looks/runner'
import { editPhotoRecipe } from './ai/apply'
import type { ProblemInput } from '../shared/crash'
import { importProfiles, type LensProfileStore, type LensShot } from './lensprofiles'
import type { LensProfile } from '../shared/lens'
import type { GuideLine } from '../shared/upright'
import type { P as SpotPoint, RetouchSpot } from '../shared/retouch'
import type { PixelStep } from '../shared/pixels'
import { enhanceAvailability, enhanceRates } from './enhance'
import { readWatermark } from './watermark'
import type { AiJobs } from './ai/jobs'
import { modelName, type ModelStore } from './ai/models'
import type { Exporter } from './exporter'
import { keyOf, parseKey } from './keys'
import type { OriginalEmbedder } from './project/embed'
import type { Library } from './library'
import { MAIN_DIR } from './dirs'
import { appPage } from './guard'
import { gate, gateRefuses } from './gate'
import { accountStatus, cancelSignIn, signIn, signOut } from './account'
import { AccountError } from './account/api'
import { OAuthError } from './account/oauth'
import { takeOpens } from './open'
import { SAM_MODEL, type SelectService } from './select/service'
import { boxAround, type PromptSourceAsk, type SelectDecode } from '../shared/prompt'
import { paths } from './paths'
import type { DevelopSessions } from './render'
import { readSettings } from './settings'
import { checkForUpdates, installUpdate, setUpdateChannel, updateState } from './updater'

function toAppError(err: unknown): AppError {
  if (err instanceof EngineError)
    return { message: err.userMessage, code: err.code, field: err.field }
  if (err instanceof IndexError) return { message: err.message, code: err.code }
  if (err instanceof LicenceError) return { message: err.message, code: err.code }
  if (err instanceof OAuthError) return { message: err.message, code: err.code }
  if (err instanceof AccountError) return { message: err.message, code: err.code }
  return { message: err instanceof Error ? err.message : String(err), code: 'Error' }
}

/** The window's own page (src/main/app.ts loads it); no other frame may call in. */
const isAppPage = appPage(
  pathToFileURL(join(MAIN_DIR, '../renderer/index.html')).href,
  is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
)

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (e, ...args: unknown[]) => {
    if (!isAppPage(e.senderFrame?.url)) {
      log.warn(`ipc: refused ${channel} from ${e.senderFrame?.url ?? 'a closed frame'}`)
      return { ok: false, error: { message: 'Not allowed.', code: 'Forbidden' } }
    }
    // The beta gate holds everything but signing in, access, updates and settings.
    if (gateRefuses(channel)) {
      return {
        ok: false,
        error: { message: 'Pixl Playroom is locked until beta access is confirmed.', code: 'Gated' }
      }
    }
    try {
      const value = await fn(...(args as A))
      return { ok: true, value }
    } catch (err) {
      return { ok: false, error: toAppError(err) }
    }
  })
}

async function wbContext(library: Library, key: string): Promise<WbContext> {
  const row = await library.photoRow(key)
  const isRaw = row.is_raw === 1
  const info = isRaw ? await library.probe(row) : null
  return { isRaw, asShot: info?.as_shot_white ?? null }
}

export interface Services {
  index: IndexClient
  /** Carries each project's original inside it (project/embed.ts). */
  embedder: OriginalEmbedder
  planes: PlaneStore
  library: Library
  sessions: DevelopSessions
  exporter: Exporter
  ai: AiJobs
  engine: EngineClient
  bgEngine: EngineClient
  /** AI jobs' engine (started when first needed). */
  aiEngine: EngineClient
  models: ModelStore
  lenses: LensProfileStore
  /** Select by clicks, a box or strokes (SAM 2.1), on its own engine host. */
  select: SelectService
}

/** A photo's base frame (upright, before the user's turns): the open session's, else its proxies'. */
async function baseFrame(s: Services, key: string): Promise<{ width: number; height: number }> {
  if (s.sessions.liveRecipe(key)) {
    const shot = await s.sessions.lensShot(key)
    return { width: shot.width, height: shot.height }
  }
  const row = await s.library.photoRow(key)
  const px = await ensureProxies(s.bgEngine, row, await s.library.probe(row), BACKGROUND_THREADS)
  return { width: px.frameWidth, height: px.frameHeight }
}

/** A photo that is not open, as lens matching needs it: probed, with its camera. */
async function lensShotOf(s: Services, key: string): Promise<LensShot> {
  const row = await s.library.photoRow(key)
  const info = await s.library.probe(row)
  const item = await s.library.item(key)
  return {
    lens: info.lens ?? null,
    camera: item ? { make: item.camera.make, model: item.camera.model } : null,
    // Only the frame's shape matters, and a RAW's developed frame keeps it.
    width: info.width,
    height: info.height
  }
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

  handle(IPC.app.reportError, (e: ErrorReport) => reportRendererError(e))
  handle(IPC.app.reportProblem, (r: ProblemInput) =>
    sendProblemReport(r, s.engine.getStatus().version)
  )
  handle(IPC.app.openNotices, async () => {
    const err = await shell.openPath(paths.notices())
    if (err) throw new Error(`Couldn't open the third-party notices: ${err}`)
  })
  handle(IPC.app.openBetaTerms, async () => {
    const err = await shell.openPath(paths.betaTerms())
    if (err) throw new Error(`Couldn't open the beta terms: ${err}`)
  })

  // ── the account, updates and preferences ──
  handle(IPC.app.gate, () => gate())
  handle(IPC.account.status, () => accountStatus())
  handle(IPC.account.signIn, () => signIn())
  handle(IPC.account.cancelSignIn, () => cancelSignIn())
  handle(IPC.account.signOut, () => signOut())
  handle(IPC.updates.getState, () => updateState())
  handle(IPC.updates.check, () => checkForUpdates())
  handle(IPC.updates.install, () => installUpdate())
  handle(IPC.updates.setChannel, (c: UpdateChannel) => setUpdateChannel(c))
  handle(IPC.prefs.get, (): Prefs => ({
    updateChannel: readSettings().updateChannel,
    crashReports: crashConsent(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch
  }))
  handle(IPC.prefs.setCrashReports, (c: CrashConsent) => setCrashConsent(c))

  // ── access from the PIXL account (not enforced yet: shared/licence.ts; exports check it) ──
  handle(IPC.licence.status, () => licence())
  handle(IPC.licence.refresh, () => refreshLicence())
  handle(IPC.licence.startTrial, () => startTrial())
  handle(IPC.licence.freeDevice, (id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('No device to free.')
    return freeDevice(id)
  })

  // ── opens (Open With, second launch) ── workstream E
  handle(IPC.app.takeOpens, () => takeOpens())

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
  handle(IPC.library.forgetFolder, (folder: string) => s.index.forgetFolder(folder))
  handle(IPC.library.subfolders, (folder: string) => s.index.subfolders(folder))
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
        if (!base) continue
        const next = applyGroups(base, from, groups)
        // A crop locked to an aspect keeps it on a photo of another shape:
        // the same centre and share of the frame, the aspect's shape.
        const g = next.geometry
        if (groups.includes('crop') && g.crop && g.aspect && key !== sourceKey) {
          try {
            const frame = await baseFrame(s, key)
            const o = orientedFrame(next, frame.width, frame.height)
            g.crop = cropAtAspect(g.crop, g.aspect, o.width, o.height)
          } catch (err) {
            log.info('pasted crop not refitted for', key, (err as Error).message)
          }
        }
        // Chromatic aberration is measured per photo: a target keeps its own
        // measurement (or none, the profile's then), never the source's.
        if (groups.includes('lens') && key !== sourceKey) next.lens.ca = base.lens.ca
        // A lens profile is resolved per photo: each target at its own lens,
        // focal length, aperture and crop factor (an automatic one finds
        // each target's own lens), not the source's numbers.
        if (groups.includes('lens') && next.lens.profile.enabled) {
          try {
            const shot = live ? await s.sessions.lensShot(key) : await lensShotOf(s, key)
            next.lens.profile.resolved = s.lenses.resolve(shot, next.lens.profile.id).resolved
          } catch (err) {
            // Not the source's numbers on another lens: none, until it resolves.
            next.lens.profile.resolved = null
            log.info('lens profile not re-resolved for', key, (err as Error).message)
          }
        }
        pairs.push({ key, recipe: next })
      }
      // One message, one transaction: a batch commits once. Planes by reference.
      const items = await s.index.saveRecipes(
        pairs.map((p) => ({ key: p.key, recipe: s.planes.slim(p.recipe) }))
      )
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

  // ── library sources, metadata, collections, stacks, duplicates ── workstream D1
  handle(IPC.library.openSource, (src: LibrarySource) => s.library.openSource(src))
  handle(IPC.library.resolvePaths, (paths: string[]) => s.index.resolvePaths(paths))
  handle(IPC.library.projectInfo, (key: string) => s.index.originalState(key))
  handle(IPC.library.setMetadata, (keys: string[], patch: MetaTextPatch) =>
    s.index.setMetadata(keys, patch)
  )
  handle(IPC.library.keywordTree, () => s.index.keywordTree())
  handle(IPC.library.collections, () => s.index.collections())
  handle(IPC.library.saveCollection, (c: Omit<Collection, 'id' | 'count'> & { id?: string }) =>
    s.index.saveCollection(c)
  )
  handle(IPC.library.removeCollection, (id: string) => s.index.removeCollection(id))
  handle(IPC.library.collectionItems, (id: string, keys: string[], action: 'add' | 'remove') =>
    s.index.collectionItems(id, keys, action)
  )
  handle(IPC.library.exportCollections, async (ids: string[]): Promise<string | null> => {
    const file = await s.index.exportCollections(ids)
    const only = file.collections.length === 1 ? file.collections[0].name : 'Collections'
    const opts = {
      defaultPath: `${only.replace(/[/\\:*?"<>|]/g, '-')}.json`,
      filters: [{ name: 'Collections', extensions: ['json'] }]
    }
    const w = win()
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    await writeFile(r.filePath, JSON.stringify(file, null, 2))
    return r.filePath
  })
  handle(IPC.library.importCollections, async (): Promise<Collection[]> => {
    const opts = {
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'Collections', extensions: ['json'] }]
    }
    const w = win()
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(r.filePaths[0], 'utf8'))
    } catch {
      throw new Error(`${basename(r.filePaths[0])} is not a collections file`)
    }
    return s.index.importCollections(parsed)
  })
  handle(IPC.library.stack, (keys: string[], cover: string) => s.index.stack(keys, cover))
  handle(IPC.library.unstack, (keys: string[]) => s.index.unstack(keys))
  handle(IPC.library.stackTop, (key: string) => s.index.stackTop(key))
  handle(IPC.library.autoStack, (folder: string, seconds?: number) =>
    s.index.autoStack(folder, seconds ?? 3)
  )
  handle(IPC.library.duplicates, (folder: string | null, threshold?: number) =>
    s.library.duplicates(folder, threshold ?? 6)
  )

  // ── batch auto white balance ── workstream B
  // Each photo measured on its own draft proxy by the background engine;
  // the renderer sends a few keys at a time so it can show progress and stop.
  handle(IPC.library.autoWb, (keys: string[]) => autoWbBatch(s, keys))
  handle(IPC.library.setWb, (pairs: { key: string; wb: Recipe['wb'] }[]) => setWbBatch(s, pairs))

  // ── develop ──
  // Recipes go out with their brush planes by reference and come back in
  // hydrated (planestore.ts): the renderer never holds the PNGs in its state.
  handle(IPC.develop.open, async (key: string) => {
    const d = await s.sessions.open(key)
    // A project made before its original could be carried (or interrupted) catches up.
    s.embedder.request(keyOf(parseKey(key).photoId, null))
    // Upright's perspective: the file's 35 mm figure, else focal length × the camera's crop.
    const focal35 = d.info.lens?.focal_35mm
      ? d.info.lens.focal_35mm
      : equivalentFocal(
          d.info.lens,
          await s.sessions
            .lensShot(key)
            .then((shot) => s.lenses.crop(shot))
            .catch(() => null)
        )
    return {
      ...d,
      focal35,
      recipe: s.planes.slim(d.recipe),
      snapshots: d.snapshots.map((sn) => ({ ...sn, recipe: s.planes.slim(sn.recipe) }))
    }
  })
  handle(IPC.develop.close, (key: string) => s.sessions.close(key))
  handle(
    IPC.develop.update,
    async (key: string, recipe: Recipe, interactive: boolean, rev?: number) =>
      s.sessions.update(key, await s.planes.hydrate(recipe), interactive, rev)
  )
  handle(IPC.develop.preview, async (key: string, recipe: Recipe | null) =>
    s.sessions.preview(key, recipe ? await s.planes.hydrate(recipe) : null)
  )
  handle(IPC.develop.view, (key: string, view: ViewState) => s.sessions.view(key, view))
  handle(IPC.develop.region, (req: RegionRequest) => s.sessions.region(req))
  handle(IPC.develop.measureCa, (key: string) => s.sessions.measureCa(key))
  handle(
    IPC.develop.bakeSpot,
    (key: string, spot: RetouchSpot, layerId: string | null, steps: PixelStep[]) =>
      s.sessions.bakeSpot(key, spot, layerId, steps)
  )
  handle(
    IPC.develop.suggestHeal,
    (key: string, points: SpotPoint[], radius: number, feather: number, kind: 'heal' | 'clone') =>
      s.sessions.suggestHeal(key, points, radius, feather, kind)
  )
  handle(
    IPC.develop.suggestUpright,
    (key: string, mode: 'Level' | 'Vertical' | 'Full', focal: number) =>
      s.sessions.suggestUpright(key, mode, focal)
  )
  handle(IPC.develop.uprightFromLines, (key: string, lines: GuideLine[], focal: number) =>
    s.sessions.uprightFromLines(key, lines, focal)
  )
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
  // Snapshots come and go by reference: the index keeps the planes they name.
  handle(IPC.develop.saveSnapshots, (key: string, snapshots: Snapshot[]) =>
    s.index.saveSnapshots(
      key,
      snapshots.map((sn) => ({ ...sn, recipe: s.planes.slim(sn.recipe) }))
    )
  )
  // Stored recipes and patches hold planes by reference; the base crosses slim.
  const slimLog = (log: HistoryLog): HistoryLog => ({
    ...log,
    base: log.base && { ...log.base, recipe: s.planes.slim(log.base.recipe) },
    ...(log.head ? { head: s.planes.slim(log.head) } : {})
  })
  handle(IPC.develop.warm, (keys: string[]) => s.library.warm(keys))
  handle(IPC.develop.historyList, async (key: string) => slimLog(await s.index.history(key)))
  handle(IPC.develop.historyAppend, async (key: string, label: string, recipe: Recipe) => {
    // The step and the recipe the photo has now go into its project together.
    // An open photo saves its live recipe (as new as the step or newer), and
    // its own save of that recipe is not needed after.
    const live = s.sessions.liveRecipe(key)
    const saved = live ? s.planes.slim(live) : recipe
    const change = await s.index.commitEdit(key, label, s.planes.slim(recipe), saved)
    if (live) s.sessions.saved(key, live)
    return change.base
      ? { ...change, base: { ...change.base, recipe: s.planes.slim(change.base.recipe) } }
      : change
  })
  handle(
    IPC.develop.historyAmend,
    async (key: string, seq: number, label: string, recipe: Recipe) => {
      // As an append: the step and the photo's live recipe saved together.
      const live = s.sessions.liveRecipe(key)
      const saved = live ? s.planes.slim(live) : recipe
      const change = await s.index.amendEdit(key, seq, label, s.planes.slim(recipe), saved)
      if (change && live) s.sessions.saved(key, live)
      return change
    }
  )
  handle(IPC.develop.historySetHidden, async (key: string, seqs: number[], hidden: boolean) =>
    slimLog(await s.index.setHistoryHidden(key, seqs, hidden))
  )
  handle(IPC.develop.historyDelete, async (key: string, seqs: number[]) =>
    slimLog(await s.index.deleteHistory(key, seqs))
  )

  // ── presets and profiles ──
  // The user's presets as the Looks browser's cards need them, read once until one changes.
  let userPresets: Promise<Preset[]> | null = null
  // The user's own presets: the catalog's looks are code both sides import.
  handle(IPC.presets.list, async (): Promise<Preset[]> =>
    (await s.index.presets()).map((p) => ({
      ...p,
      recipe: s.planes.slim(p.recipe)
    }))
  )
  handle(IPC.presets.save, async (p: Omit<Preset, 'id' | 'builtin'> & { id?: string }) => {
    // The engine white only means something for a custom white balance the
    // preset actually carries.
    const { wbOp, ...rest } = p
    const keepsWb = p.groups.includes('whiteBalance') && p.recipe.wb.mode === 'custom'
    const preset: Preset = {
      ...rest,
      ...(keepsWb && wbOp ? { wbOp } : {}),
      recipe: await s.planes.hydrate(p.recipe),
      id: p.id ?? newId(),
      builtin: false
    }
    await s.index.savePreset(preset)
    userPresets = null
    return preset
  })
  handle(IPC.presets.remove, async (id: string) => {
    userPresets = null
    await s.index.removePreset(id)
  })

  // ── the Looks browser's cards ──
  handle(IPC.looks.thumbs, async (req: LookThumbRequest) => {
    const wb = s.sessions.wbContext(req.key)
    if (!wb) return
    const base = await s.planes.hydrate(req.base)
    userPresets ??= s.index.presets()
    const user = await userPresets
    // A smart look's card shows the masks it makes without a model (ranges, gradients).
    const frame = req.ids.some((id) => resolveLook(id)?.smart) ? await baseFrame(s, req.key) : null
    const jobs = req.ids.flatMap((id) => {
      if (id === 'current') return [{ id, recipe: base }]
      const p = resolveLook(id) ?? user.find((u) => u.id === id)
      if (!p) return []
      // A card never looks a lens up: the preset's resolution stands in.
      const recipe = applyLook(base, p, { wb, lensResolved: 'keep' })
      if (p.smart && frame)
        recipe.layers.push(
          ...previewLayers(
            p.id,
            immediateLayers(p.smart, {
              frameWidth: frame.width,
              frameHeight: frame.height
            })
          )
        )
      return [{ id, recipe }]
    })
    s.sessions.lookThumbs(req.key, req.token, jobs, req.edge)
  })
  handle(IPC.looks.cancel, (key: string) => s.sessions.cancelLookThumbs(key))
  // Smart looks' model work: one job at a time on the AI queue, landing on its photo.
  const runs = new LookRuns({
    startJob: (req) => s.ai.start(req),
    cancelJob: (id) => s.ai.cancel(id),
    onJobEnded: (l) => s.ai.onEnded(l),
    edit: (key, change) =>
      editPhotoRecipe(key, change, { library: s.library, sessions: s.sessions }),
    send: (e) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.looks.runEvent, e)
    },
    megapixels: async (key) => {
      const f = await baseFrame(s, key)
      return (f.width * f.height) / 1e6
    },
    // SAM 2.1 (engine 0.16) selects what the user points at. Finding an
    // object by its name needs the detector (E45), and people's parts their
    // model (E30): neither has shipped, so `label` waits and `personJob` is
    // not given.
    promptJob: (r) => {
      if (r.prompt.kind === 'label')
        throw new Error('finding an object by name needs the next engine update')
      const prompt =
        r.prompt.kind === 'point'
          ? { rect: null, points: [{ ...r.prompt.point, fg: true }] }
          : { rect: boxAround([r.prompt.from, r.prompt.to]), points: [] }
      if (!prompt.rect && prompt.points.length === 0) throw new Error('nothing was pointed at')
      return s.ai.start({
        task: 'prompt',
        key: r.key,
        group: r.group,
        label: r.label,
        prompt,
        via: r.label.toLowerCase() === 'sky' ? 'sky' : 'look',
        into: { layerId: r.layerId, mode: r.mode }
      })
    }
  })
  handle(IPC.looks.run, (req: LookRunRequest) => runs.start(req))
  handle(IPC.looks.cancelRun, (by: { runId?: string; key?: string }) => {
    if (by.runId) runs.cancel(by.runId)
    if (by.key) runs.cancelFor(by.key)
  })
  handle(IPC.looks.answer, (runId: string, a: PickAnswer) => runs.answer(runId, a))
  handle(IPC.presets.luts, async (): Promise<LutProfile[]> =>
    (await readdir(paths.luts()))
      .filter((f) => f.toLowerCase().endsWith('.cube'))
      .map((f) => ({ name: basename(f, '.cube'), path: join(paths.luts(), f) }))
  )
  // ── lens profiles ──
  handle(IPC.lens.status, () => s.lenses.status())
  handle(IPC.lens.check, () => s.lenses.check())
  handle(IPC.lens.search, (query: string) => s.lenses.search(query))
  handle(IPC.lens.resolve, async (key: string, id: string | null) =>
    s.lenses.resolve(await s.sessions.lensShot(key), id)
  )
  handle(IPC.lens.importProfiles, async (): Promise<LensProfile[]> => {
    const w = win()
    const opts = {
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'Lens profile', extensions: ['json'] }]
    }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return []
    const added = await importProfiles(r.filePaths)
    await s.lenses.reloadImported()
    return added
  })
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
  handle(IPC.export.chooseWatermark, async () => {
    const w = win()
    const opts = {
      title: 'Choose a watermark',
      properties: ['openFile'] as 'openFile'[],
      filters: [{ name: 'PNG', extensions: ['png'] }]
    }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : readWatermark(r.filePaths[0])
  })
  handle(IPC.export.readWatermark, (path: string) => readWatermark(path))
  handle(IPC.export.start, (keys: string[], settings: ExportSettings) => {
    requireLicence('export')
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
  handle(IPC.enhance.rates, () => enhanceRates(s.index))

  // ── AI models ──
  handle(IPC.models.list, () => s.models.list())
  // A download runs on; its progress arrives as `models:event`.
  handle(IPC.models.download, (id: string) => void s.models.download(id))
  handle(IPC.models.cancel, (id: string) => s.models.cancel(id))
  handle(IPC.models.remove, (id: string) => s.models.remove(id))
  handle(IPC.models.provider, () => s.models.providerInfo())
  handle(IPC.models.benchmark, () => s.models.benchmark(s.aiEngine))

  // ── AI jobs ──
  handle(IPC.ai.start, (req: AiStartRequest) => s.ai.start(req))
  handle(IPC.ai.cancel, (jobId: string) => s.ai.cancel(jobId))
  handle(IPC.ai.list, () => s.ai.list())
  handle(IPC.ai.capabilities, async (): Promise<AiCapabilities> => {
    const enhance = enhanceAvailability(s.bgEngine.getStatus())
    const subject = (await s.models.installed('u2net')) || (await s.models.installed('u2netp'))
    // Models run on the engine's bundled runtime; each denoise model is
    // offered for download where it is picked (Detail → Noise reduction).
    const status = s.bgEngine.getStatus()
    const models = status.enhance === true
    const segment = models && subject
    // SAM 2.1 came with engine 0.16: the binding has its calls.
    const sam2 = models && status.prompt === true
    const samModel = await s.select.installed()
    const smart = smartReadiness({
      models,
      subjectModel: subject,
      drunetModel: await s.models.installed('drunet-color'),
      samModel,
      enhance: enhance.available,
      // Still to come: a sky model (E28; meanwhile the sky is clicked,
      // SKY_BY_CLICK), people's parts (E30), the detector (E45) and NAFNet
      // denoise. They turn on with the binding that has them.
      engine: { sky: false, people: false, sam2, detector: false, nafnet: false }
    })
    const drunet = await s.models.installed('drunet-color')
    return {
      enhance: enhance.available,
      segment,
      denoise: models,
      prompt: sam2 && samModel,
      smart,
      // By name: a text-prompted segmenter (SAM 3, or the detector, E45),
      // people's parts (E30) and a sky model (E28) are still to come.
      finders: { click: sam2, text: false, parts: false, 'sky-model': false },
      // What to download for a task that waits only on its model: the one
      // Playroom recommends (the detailed subject model, SAM 2.1, DRUNet).
      get: {
        ...(models && !subject ? { segment: 'u2net' } : {}),
        ...(sam2 && !samModel ? { prompt: SAM_MODEL } : {}),
        ...(models && !drunet ? { denoise: 'drunet-color' } : {})
      },
      why: {
        ...(enhance.available ? {} : { enhance: enhance.reason }),
        ...(segment ? {} : { segment: `download ${modelName(s.models.entry('u2net'))}` }),
        ...(models ? {} : { denoise: 'this engine build runs no models' }),
        ...(sam2 && samModel
          ? {}
          : {
              prompt: sam2
                ? `download ${modelName(s.models.entry(SAM_MODEL))}`
                : 'this engine build has no prompted segmentation'
            })
      }
    }
  })

  // ── select by clicks, a box or strokes (SAM 2.1) ──
  handle(IPC.select.open, (key: string) => s.select.open(key))
  handle(IPC.select.decode, (selId: string, req: SelectDecode) => s.select.decode(selId, req))
  handle(IPC.select.commit, (selId: string, source: PromptSourceAsk) =>
    s.select.commit(selId, source)
  )
  handle(IPC.select.close, (selId: string) => s.select.close(selId))
}
