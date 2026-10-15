/**
 * Where Playroom keeps what it makes. Everything under userData is a cache
 * or an index: the truth lives in each photo's project, beside the photo or
 * in the projects folder (project/locate.ts).
 */
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { devEnv, HIDDEN } from './build'

const made = new Set<string>()

/**
 * A scripted run (automation's hidden window, or a profile of its own:
 * scripts/drive.mjs, perf.mjs, the site's screenshots) keeps what it saves
 * for the user inside its profile: the preset projects and exports folder is
 * made there, not in the user's home, and nothing asks where they should go.
 * Null in the app as people run it.
 */
export function scriptedHome(): string | null {
  return HIDDEN || devEnv('PLAYROOM_USER_DATA') ? app.getPath('userData') : null
}

/**
 * A directory under userData, made the first time it is asked for (the
 * protocol asks per request). Sync on purpose: once per directory per run.
 */
function dir(...parts: string[]): string {
  const p = join(app.getPath('userData'), ...parts)
  if (!made.has(p)) {
    mkdirSync(p, { recursive: true })
    made.add(p)
  }
  return p
}

export const paths = {
  // The index (playroom.db) is the index host's: see indexer/service.ts.
  /** The rendering mode and the last display's scale, read before the app is ready. */
  displayState: (): string => join(dir(), 'display.json'),
  /** The update channel and crash-report consent, read before the app is ready (settings.ts). */
  settings: (): string => join(dir(), 'settings.json'),
  /** Per-photo working files: proxies, renders, mask planes. */
  photoCache: (photoId: number): string => dir('cache', 'photos', String(photoId)),
  /**
   * The same folder's path, not made: for the paths every photo of a folder
   * asks for as it opens (the probe, the thumbnail's source), whose callers
   * make it themselves, off the main thread, only when they write (300
   * `mkdirSync` calls cost 170 ms of main's time opening a 300-photo folder).
   */
  photoCachePath: (photoId: number): string =>
    join(app.getPath('userData'), 'cache', 'photos', String(photoId)),
  thumbs: (): string => dir('cache', 'thumbs'),
  /**
   * Where 0.3's before/after kept edited photos' thumbnails from the engine
   * before 0.17: only removed now (the comparison went with engine 0.18).
   */
  legacyPreviews: (): string => join(app.getPath('userData'), 'cache', 'legacy-previews'),
  luts: (): string => dir('luts'),
  /** Imported lens profiles, one JSON file per lens (`shared/lens.ts`). */
  lensProfiles: (): string => dir('lens-profiles'),
  /** Imported DNG camera profiles, one JSON file each (`cameraprofiles.ts`), not made until one is. */
  cameraProfiles: (): string => join(app.getPath('userData'), 'camera-profiles'),
  /** The lens catalogue downloaded from the models server (`lensprofiles.ts`). */
  lensCatalog: (): string => dir('lens-profiles', 'catalog'),
  /** The lens catalogue the app ships: beside its resources when packaged, in resources/ in a checkout. */
  bundledLensCatalog: (): string =>
    app.isPackaged
      ? join(process.resourcesPath, 'lens-profiles')
      : join(app.getAppPath(), 'resources', 'lens-profiles'),
  /** Downloaded AI models, `<id>/<version>/<files>` (see `ai/models.ts`). */
  models: (): string => dir('models'),
  /**
   * CoreML's compiled models (engine 0.21.0, OBS-4), one folder each, kept
   * across runs; cleared when the models or the engine change (`ai/models.ts`).
   */
  coremlCache: (): string => dir('coreml-cache'),
  cacheRoot: (): string => dir('cache'),
  /** THIRD_PARTY_NOTICES.txt: beside the app's resources when packaged, in build/ in a checkout. */
  notices: (): string =>
    app.isPackaged
      ? join(process.resourcesPath, 'THIRD_PARTY_NOTICES.txt')
      : join(app.getAppPath(), 'build', 'THIRD_PARTY_NOTICES.txt'),
  /** The beta terms the app ships (scripts/legal-copy.mjs), beside its resources or in build/legal/. */
  betaTerms: (): string =>
    app.isPackaged
      ? join(process.resourcesPath, 'legal', 'beta-terms.txt')
      : join(app.getAppPath(), 'build', 'legal', 'beta-terms.txt')
}
