/**
 * The `.xmp` sidecar: the truth about a photo's title, caption, copyright
 * and keywords, in the format every photo app reads. A RAW's is
 * `IMG_0001.xmp` (where Lightroom and Capture One look); anything else's is
 * `IMG_0001.jpg.xmp`, so a RAW+JPEG pair keeps two. Only our tags are ever
 * written: an existing sidecar (Lightroom's, with its develop settings)
 * keeps everything else.
 *
 * `XmpIo` is the reading and writing, so the index service can be tested
 * without ExifTool; the mapping between `PhotoMeta` and tags is pure.
 */
import type { WriteTags } from 'exiftool-vendored'
import { existsSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { MetaTextPatch, PhotoMeta } from '../../shared/ipc'
import { flatSubjects, isUnder, normaliseKeywords } from '../../shared/keywords'
import { endExiftool, exiftool } from '../exiftool'

export interface XmpIo {
  /** What the sidecar says, or null when it is missing or unreadable. */
  read(xmpPath: string): Promise<PhotoMeta | null>
  /** Set our fields (an empty one is removed), creating the file if needed. */
  write(xmpPath: string, meta: PhotoMeta): Promise<void>
  end(): Promise<void>
}

export function xmpPathFor(photoPath: string, isRaw: boolean): string {
  if (!isRaw) return photoPath + '.xmp'
  return join(dirname(photoPath), basename(photoPath, extname(photoPath)) + '.xmp')
}

export const emptyMeta = (): PhotoMeta => ({
  title: null,
  caption: null,
  copyright: null,
  keywords: []
})

export const metaIsEmpty = (m: PhotoMeta): boolean =>
  !m.title && !m.caption && !m.copyright && m.keywords.length === 0

export const sameMeta = (a: PhotoMeta, b: PhotoMeta): boolean =>
  a.title === b.title &&
  a.caption === b.caption &&
  a.copyright === b.copyright &&
  a.keywords.length === b.keywords.length &&
  a.keywords.every((k, i) => k === b.keywords[i])

/**
 * A metadata edit applied: fields set (blank clears them), then keywords
 * replaced, removed (a keyword goes with everything under it) and added.
 */
export function applyMetaPatch(meta: PhotoMeta, patch: MetaTextPatch): PhotoMeta {
  const field = (v: string | null | undefined, was: string | null): string | null =>
    v === undefined ? was : v === null || !v.trim() ? null : v.trim()
  let keywords = patch.keywords ? normaliseKeywords(patch.keywords) : [...meta.keywords]
  const remove = normaliseKeywords(patch.removeKeywords ?? [])
  keywords = keywords.filter((k) => !remove.some((r) => isUnder(k, r)))
  keywords = normaliseKeywords([...keywords, ...(patch.addKeywords ?? [])])
  return {
    title: field(patch.title, meta.title),
    caption: field(patch.caption, meta.caption),
    copyright: field(patch.copyright, meta.copyright),
    keywords
  }
}

/** Our tags as ExifTool names them. */
export const XMP_TAGS = [
  'XMP-dc:Title',
  'XMP-dc:Description',
  'XMP-dc:Rights',
  'XMP-dc:Subject',
  'XMP-lr:HierarchicalSubject'
] as const

type XmpTags = Partial<Record<(typeof XMP_TAGS)[number], string | string[] | null>>

/**
 * The tags to write: `dc:subject` gets every level of every keyword (what
 * apps without hierarchies show), `lr:hierarchicalSubject` the paths. null
 * deletes a tag.
 */
export function metaToTags(meta: PhotoMeta): XmpTags {
  const text = (s: string | null): string | null => (s && s.trim() ? s : null)
  const keywords = normaliseKeywords(meta.keywords)
  return {
    'XMP-dc:Title': text(meta.title),
    'XMP-dc:Description': text(meta.caption),
    'XMP-dc:Rights': text(meta.copyright),
    'XMP-dc:Subject': keywords.length > 0 ? flatSubjects(keywords) : null,
    'XMP-lr:HierarchicalSubject': keywords.length > 0 ? keywords : null
  }
}

/** ExifTool's JSON: a one-item list comes as the item, a number-like string as a number. */
function list(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return []
  return (Array.isArray(v) ? v : [v]).map((x) => String(x))
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = Array.isArray(v) ? v.map(String).join(', ') : String(v)
  return s.trim() ? s : null
}

/**
 * What tags say. The hierarchy wins; a flat subject that is no level of it
 * (added by an app without hierarchies) is a top-level keyword.
 */
export function tagsToMeta(tags: Record<string, unknown>): PhotoMeta {
  const hier = normaliseKeywords(list(tags['XMP-lr:HierarchicalSubject']))
  const levels = new Set(flatSubjects(hier))
  const flat = normaliseKeywords(list(tags['XMP-dc:Subject']).map((s) => s.replace(/\|/g, ' ')))
  return {
    title: text(tags['XMP-dc:Title']),
    caption: text(tags['XMP-dc:Description']),
    copyright: text(tags['XMP-dc:Rights']),
    keywords: normaliseKeywords([...hier, ...flat.filter((s) => !levels.has(s))])
  }
}

/** The real thing: ExifTool, shared with the rest of the process. */
export function exiftoolXmp(): XmpIo {
  return {
    async read(xmpPath) {
      if (!existsSync(xmpPath)) return null
      try {
        const tags = await exiftool().readRaw(xmpPath, {
          readArgs: ['-G1', ...XMP_TAGS.map((t) => '-' + t)]
        })
        return tagsToMeta(tags as unknown as Record<string, unknown>)
      } catch (err) {
        console.warn('cannot read', xmpPath, (err as Error).message)
        return null
      }
    },
    async write(xmpPath, meta) {
      // Writing to a .xmp path that does not exist makes one from scratch.
      await exiftool().write(xmpPath, metaToTags(meta) as WriteTags, { writeArgs: ['-overwrite_original'] })
    },
    end: endExiftool
  }
}
