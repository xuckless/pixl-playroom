/**
 * Gemma names the library's photos in the background (the owner: on import,
 * only when idle and on power), newest arrivals first, one at a time: the
 * computer on mains power, nobody at it for a minute, Gemma on in Settings
 * and AI on. Anyone back at the keyboard, or the power cable out, and it
 * stops after the photo in hand; then Gemma's server is stopped, so its
 * gigabytes don't wait for its idle timeout (the guide: name a batch, then
 * stop the server).
 *
 * The open photo can also be named at once from its Masks pane (`nameNow`),
 * idle or not.
 */
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { IPC, type LibraryItem } from '../../shared/ipc'
import { readNames, type PhotoNames } from '../../shared/naming'
import type { IndexClient } from '../indexer/client'
import type { Library } from '../library'
import { NamingAnswerError, type BrainStore } from './brain'
import type { AiSwitchStore } from './switches'
import { idleOnPower } from './idle'

/** How long nobody touched the computer before naming starts, seconds (a test run may say less). */
const IDLE_S = Number(process.env.PLAYROOM_NAMING_IDLE_S ?? 60)
const CHECK_MS = Number(process.env.PLAYROOM_NAMING_CHECK_MS ?? 30_000)
/** Photos looked up per round. */
const BATCH = 25

export class Namer {
  private timer: NodeJS.Timeout | undefined
  private running = false
  private now = new Map<number, Promise<PhotoNames | null>>()

  constructor(
    private readonly index: IndexClient,
    private readonly library: Library,
    private readonly brain: BrainStore,
    private readonly switches: AiSwitchStore
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), CHECK_MS)
    this.timer.unref()
  }

  stop(): void {
    clearInterval(this.timer)
  }

  /** May it name in the background now? */
  private async mayRun(): Promise<boolean> {
    return idleOnPower(IDLE_S) && this.switches.allowed('gemma')
  }

  private async tick(): Promise<void> {
    if (this.running || !(await this.mayRun())) return
    this.running = true
    let named = 0
    try {
      const ids = await this.index.unnamed(BATCH)
      for (const id of ids) {
        if (!(await this.mayRun())) break
        if (this.now.has(id)) continue
        try {
          await this.nameOne(id)
          named++
        } catch (err) {
          // The server gone or refusing: try again next round, not photo after photo.
          log.warn('naming stopped', (err as Error).message)
          break
        }
      }
    } finally {
      this.running = false
      if (named > 0) {
        log.info(`naming: ${named} photo(s) named`)
        await this.brain.stop()
      }
    }
  }

  /** Name one photo and keep it; a usable-less answer is kept as tried. */
  private async nameOne(photoId: number): Promise<PhotoNames | null> {
    const image = await this.library.namingPicture(photoId)
    try {
      const t = Date.now()
      const names = await this.brain.name(image, 'image/jpeg')
      log.info('named', photoId, `${Date.now() - t} ms`, names.things.length)
      // The user's own list, if they changed it meanwhile, stays.
      const had = readNames(await this.index.namesOf(photoId))
      if (had?.edited) return had
      await this.publish(photoId, await this.index.setNames(photoId, JSON.stringify(names)), names)
      return names
    } catch (err) {
      if (!(err instanceof NamingAnswerError)) throw err
      log.info('naming: no usable answer', photoId, err.message)
      await this.index.namingFailed(photoId)
      return null
    }
  }

  /** The open photo, named now (from its Masks pane): shared with one in flight. */
  nameNow(photoId: number): Promise<PhotoNames | null> {
    let p = this.now.get(photoId)
    if (!p) {
      p = this.nameOne(photoId).finally(() => this.now.delete(photoId))
      this.now.set(photoId, p)
    }
    return p
  }

  /** The user's own changes to a photo's names (a chip taken off, one typed). */
  async edit(photoId: number, names: PhotoNames | null): Promise<void> {
    const items = await this.index.setNames(photoId, names ? JSON.stringify(names) : null)
    await this.publish(photoId, items, names)
  }

  private async publish(
    photoId: number,
    items: LibraryItem[],
    names: PhotoNames | null
  ): Promise<void> {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC.names.event, { photoId, names })
      w.webContents.send(IPC.library.names, {
        photoId,
        words: items[0]?.names ?? []
      })
    }
  }
}
