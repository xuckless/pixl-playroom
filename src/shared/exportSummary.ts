/**
 * What the export sheet's summary says of the photos: how many, how many
 * HDR, offline or not read yet, and about how large the files will be. Pure:
 * from the library's items and the sample main probed (`ExportFacts`).
 */
import { estimateBytes, type ExportSettings } from './export'
import type { ExportSource } from './exportGuards'
import type { ExportFacts, HdrKind } from './ipc'

/** Past this many photos the summary says its estimate is a sample's. */
export const SAMPLED_PAST = 1000

/** What the sheet needs of a library item. */
export interface ExportItem {
  key: string
  ext: string
  isRaw: boolean
  /** Absent until the file has been probed. */
  hdr?: HdrKind | null
  offline?: boolean
}

export interface Makeup {
  photos: number
  /** PQ, HLG, or a gain map: as the library knows it, or as the sample probed it. */
  hdr: number
  offline: number
  /** Not probed yet: neither SDR nor HDR is assumed of them. */
  unread: number
  /** What the guards are told of the photos known (offline ones and unread ones left out). */
  sources: ExportSource[]
}

/** The selection's makeup: each photo's HDR from the library, else from the sample's probe. */
export function exportMakeup(items: ExportItem[], sample: ExportFacts['sample'] = []): Makeup {
  const probed = new Map(sample.map((p) => [p.key, p]))
  let hdr = 0
  let offline = 0
  let unread = 0
  const sources: ExportSource[] = []
  for (const it of items) {
    if (it.offline) {
      offline++
      continue
    }
    const p = probed.get(it.key)
    const known = it.hdr !== undefined || p !== undefined
    if (!known) {
      unread++
      continue
    }
    const isHdr = it.hdr !== undefined ? it.hdr === 'pq' || it.hdr === 'hlg' : p!.isHdr
    const hasGainMap = it.hdr !== undefined ? it.hdr === 'gainmap' : p!.hasGainMap
    if (isHdr || hasGainMap) hdr++
    sources.push({ ext: it.ext, isRaw: it.isRaw, isHdr, hasGainMap })
  }
  return { photos: items.length, hdr, offline, unread, sources }
}

export interface Estimate {
  /** About how large one file is (the sample's mean). */
  each: number
  /** About how large all of them are. */
  all: number
  /** How many photos the estimate is from. */
  sampled: number
}

/**
 * About how large the export's files will be: the sample's estimate
 * (`estimateBytes`) averaged, times the photos that will be written. Null
 * with nothing sampled.
 */
export function estimateExport(
  s: ExportSettings,
  sample: ExportFacts['sample'],
  written: number
): Estimate | null {
  if (sample.length === 0 || written === 0) return null
  const hdrOut = (p: ExportFacts['sample'][number]): boolean =>
    (p.isHdr && (s.hdr.mode === 'keep' || s.hdr.mode === 'gainmap')) ||
    (p.hasGainMap && s.hdr.mode === 'gainmap') ||
    (!p.isHdr && !p.hasGainMap && s.hdr.mode === 'expand')
  const each =
    sample.reduce((n, p) => n + estimateBytes(s, p.width, p.height, hdrOut(p)), 0) / sample.length
  return { each: Math.round(each), all: Math.round(each * written), sampled: sample.length }
}

/** Bytes as a person reads them: 840 KB, 12 MB, 1.4 GB. */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) {
    const mb = n / 1024 ** 2
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  }
  return `${Math.max(1, Math.round(n / 1024))} KB`
}
