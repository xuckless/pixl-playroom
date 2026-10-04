/**
 * Legacy previews: what an edited photo looked like under the engine before
 * 0.17 (PixlRGB moved every channel-wise edit), kept so its first opening can
 * show before and after. The picture is the photo's last library thumbnail,
 * taken from the disk just before the new engine's replaces it. Nothing here
 * makes a render: it only holds files. They go when the user removes one (or
 * all), and on their own the first launch of a later version than the one
 * that took them.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'

export interface LegacyEntry {
  /** The picture, in the folder. */
  file: string
  /** The engine that made it, for the words ("0.16"). */
  engine: string
  /** The app version that took it: a later one removes it. */
  capturedIn: string
  /** The first-open comparison was shown. */
  seen: boolean
}

const MANIFEST = 'manifest.json'

export class LegacyPreviews {
  private entries: Record<string, LegacyEntry> = {}
  readonly dir: string
  private readonly appVersion: string

  constructor(dir: string, appVersion: string) {
    this.dir = dir
    this.appVersion = appVersion
    try {
      const raw = JSON.parse(readFileSync(join(dir, MANIFEST), 'utf8')) as {
        entries?: Record<string, LegacyEntry>
      }
      this.entries = raw.entries ?? {}
    } catch {
      this.entries = {}
    }
    this.expire()
  }

  /** Drop what an earlier version took: legacy previews last one release. */
  expire(): number {
    let gone = 0
    for (const [key, e] of Object.entries(this.entries)) {
      if (e.capturedIn !== this.appVersion || !existsSync(join(this.dir, e.file))) {
        this.drop(key)
        gone++
      }
    }
    if (gone) this.save()
    return gone
  }

  /** Keep `from` as `key`'s legacy preview (copied: the thumbnail's own file is replaced next). */
  capture(key: string, from: string, engine = '0.16'): boolean {
    if (this.entries[key] || !existsSync(from)) return false
    mkdirSync(this.dir, { recursive: true })
    const file = `${key.replace(/[^\w-]/g, '_')}.jpg`
    copyFileSync(from, join(this.dir, file))
    this.entries[key] = { file, engine, capturedIn: this.appVersion, seen: false }
    this.save()
    return true
  }

  get(key: string): (LegacyEntry & { path: string }) | null {
    const e = this.entries[key]
    return e ? { ...e, path: join(this.dir, e.file) } : null
  }

  has(key: string): boolean {
    return key in this.entries
  }

  count(): number {
    return Object.keys(this.entries).length
  }

  markSeen(key: string): void {
    const e = this.entries[key]
    if (!e || e.seen) return
    e.seen = true
    this.save()
  }

  remove(key: string): void {
    if (!this.has(key)) return
    this.drop(key)
    this.save()
  }

  removeAll(): number {
    const n = this.count()
    for (const key of Object.keys(this.entries)) this.drop(key)
    this.save()
    return n
  }

  private drop(key: string): void {
    const e = this.entries[key]
    if (e) rmSync(join(this.dir, e.file), { force: true })
    delete this.entries[key]
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true })
    const tmp = join(this.dir, `${MANIFEST}.tmp`)
    writeFileSync(tmp, JSON.stringify({ entries: this.entries }))
    renameSync(tmp, join(this.dir, MANIFEST))
  }
}
