/**
 * Export presets that come with Playroom, beside the person's own (kept in
 * the index, `export_presets`), and how the sheet tells a preset's settings
 * from settings changed since. Pure.
 */
import { defaultExportSettings, normaliseExportSettings, type ExportSettings } from './export'
import { tk } from './i18n'

/** Bumped when a built-in's settings change, so nothing caches the old ones. */
export const BUILT_IN_VERSION = 1

export interface BuiltInPreset {
  /** `builtin:` and a name of its own, never a saved preset's id. */
  id: string
  /** Its name, to translate where it is shown. */
  name: string
  settings: ExportSettings
}

const make = (more: (d: ExportSettings) => Partial<ExportSettings>): ExportSettings => {
  const d = defaultExportSettings()
  return normaliseExportSettings({ ...d, ...more(d) })
}

/**
 * The built-ins (the owner's, 2026-10-14): for the web, for social posts
 * (1080 wide, up to 1350 tall for a 4:5 portrait), for print (Adobe RGB:
 * Display P3 is a screen's space, not a printer's), and HDR as PQ in AVIF.
 */
export const BUILT_IN_PRESETS: BuiltInPreset[] = [
  {
    id: 'builtin:web',
    name: tk('Web 2048'),
    settings: make((d) => ({
      format: 'jpeg',
      quality: 85,
      colorSpace: 'Srgb',
      resize: { ...d.resize, mode: 'long', value: 2048 },
      outputSharpen: { ...d.outputSharpen, enabled: true, media: 'screen' }
    }))
  },
  {
    id: 'builtin:social',
    name: tk('Social 1080'),
    settings: make((d) => ({
      format: 'jpeg',
      quality: 85,
      colorSpace: 'Srgb',
      resize: { ...d.resize, mode: 'box', value: 1080, valueH: 1350 },
      outputSharpen: { ...d.outputSharpen, enabled: true, media: 'screen' }
    }))
  },
  {
    id: 'builtin:print',
    name: tk('Print TIFF 16-bit'),
    settings: make(() => ({
      format: 'tiff',
      bitDepth: 16,
      tiffCompression: 'Lzw',
      colorSpace: 'AdobeRgb'
    }))
  },
  {
    id: 'builtin:hdr',
    name: tk('HDR AVIF PQ'),
    settings: make((d) => ({
      format: 'avif',
      quality: 85,
      bitDepth: 10,
      colorSpace: 'Rec2020',
      hdr: { ...d.hdr, mode: 'keep', to: 'Rec2100Pq' }
    }))
  }
]

export const isBuiltIn = (id: string): boolean => id.startsWith('builtin:')

/** A value with its object keys in order: two settings compare by what they say, not how. */
function ordered(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordered)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, ordered((v as Record<string, unknown>)[k])])
    )
  return v
}

/** Settings as a key that two equal settings share, older saved ones brought up to date first. */
export function settingsKey(s: Partial<ExportSettings> | null | undefined): string {
  return JSON.stringify(ordered(normaliseExportSettings(s)))
}

/** Whether settings say what a preset's do (an older preset's missing fields read as defaults). */
export function sameSettings(
  a: Partial<ExportSettings> | null | undefined,
  b: Partial<ExportSettings> | null | undefined
): boolean {
  return settingsKey(a) === settingsKey(b)
}

/** A name for a copy that none of `taken` has: "Web 2048 copy", "Web 2048 copy 2". */
export function copyName(name: string, taken: string[], copy: string): string {
  const base = `${name} ${copy}`
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}
