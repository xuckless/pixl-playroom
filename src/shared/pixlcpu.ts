/**
 * PIXL's own models and the processor (engine 0.20.0, decisions 35 and 37):
 * what main's `ai/pixlcpu.ts` asks with, apart from Electron so the develop
 * planning reads it in tests.
 */
import { t } from './i18n'

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
