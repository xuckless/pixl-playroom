/**
 * PIXL's own models and the processor (engine 0.20.0, decisions 35 and 37):
 * what main's `ai/pixlcpu.ts` asks with, apart from Electron so the develop
 * planning reads it in tests.
 */
import { t } from './i18n'

/**
 * The question main puts to the window (`ai/pixlcpu.ts`, shown by the
 * renderer's `PixlCpuHost`): why PIXL's models would run on the processor,
 * and the engine's words, shortened, for a details fold.
 */
export interface PixlCpuQuestion {
  why: 'no-gpu' | 'refused'
  detail: string | null
}

/** The window's answer: yes or no (kept, Settings → AI models), or "not now" (this session). */
export type PixlCpuReply = 'yes' | 'no' | 'later'

/**
 * The engine's words for the details fold: `file://` dropped, the app's own
 * folders (`roots`, longest first) shortened to `…` and the home folder to
 * `~`, so the line says which model and what failed, not where it lives.
 */
export function cpuDetail(message: string, roots: readonly string[], home: string): string {
  let s = message.replace(/file:\/\//g, '')
  for (const r of [...roots].filter(Boolean).sort((a, b) => b.length - a.length))
    s = s.split(r.replace(/\/+$/, '')).join('…')
  if (home) s = s.split(home.replace(/\/+$/, '')).join('~')
  return s.trim()
}

/** PIXL's own models, by id (`pixl-demosaic-v1-bayer`, `pixl-enhance-v1`, …). */
export const isPixlModel = (id: string): boolean => id.startsWith('pixl-')

/** The user said no to PIXL's models on this computer's processor. */
export class CpuDeclined extends Error {
  code = 'CpuDeclined'
  constructor() {
    super(
      t(
        'PIXL’s models would run on this computer’s processor, and you chose not to. To change it: Settings → AI models → Run PIXL models on the processor.'
      )
    )
  }
}
