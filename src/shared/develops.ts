/**
 * A RAW's full-size develops by their tag (`ai/rawdevelop.ts` `developTag`),
 * in words, and what the user is told when one stood in for another
 * (engine 0.20.0 guide §3: every refusal reaches the user, in the engine's
 * words).
 */
import { t, tk } from './i18n'

export const DEVELOP_NAME: Readonly<Record<string, string>> = {
  pd: tk('PIXL demosaic'),
  pdg: tk('PIXL demosaic'),
  dn: tk('DemosaicNet'),
  'dn-pm': tk('DemosaicNet after RAW denoise'),
  ahd: tk('AHD'),
  'ahd-pm': tk('AHD after RAW denoise'),
  ppg: tk('the classic demosaic'),
  'ppg-pm': tk('the classic demosaic after RAW denoise')
}

const nameOf = (tag: string): string => (DEVELOP_NAME[tag] ? t(DEVELOP_NAME[tag]) : tag)

/** The engine's words, kept to a line. */
const short = (s: string): string => (s.length > 220 ? `${s.slice(0, 217)}…` : s)

/**
 * The line for a develop another stood in for: refused (the engine's words),
 * or declined (the user's answer about the processor).
 */
export function standInNote(planned: string, ran: string, why: string | null): string {
  return why === null
    ? t(
        '{{ran}} developed this photo: PIXL’s models are kept off the processor here (Settings → AI models).',
        {
          ran: nameOf(ran)
        }
      )
    : t('{{planned}} was refused for this photo, so {{ran}} developed it: {{why}}', {
        planned: nameOf(planned),
        ran: nameOf(ran),
        why: short(why)
      })
}

/** A develop as it ran, in a few words: "PIXL demosaic · 8.4 s". */
export function developedLine(ran: string, ms: number): string {
  return `${nameOf(ran)} · ${(ms / 1000).toFixed(1)} s`
}
