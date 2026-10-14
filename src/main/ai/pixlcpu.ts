/**
 * PIXL's models on the CPU (engine 0.20.0, decisions 35 and 37): the engine
 * decides nothing; Playroom asks once per computer, keeps the answer in
 * Settings → AI models, and never moves a PIXL model to the CPU silently.
 * On the CPU the PIXL demosaic takes about 40 s a RAW and PIXL Enhance one
 * to two minutes a photo.
 *
 * One question (Electron's own dialog, from main), shared by every caller
 * while it is open. A "no" is `CpuDeclined`: a RAW develops as before
 * (`ai/rawdevelop.ts`), an Enhance step fails pointing at Settings.
 */
import { BrowserWindow, dialog } from 'electron'
import log from 'electron-log/main'
import { t } from '../../shared/i18n'
import type { PixlCpuAnswer } from '../../shared/heavy'

export { CpuDeclined, isPixlModel } from '../../shared/pixlcpu'

/** Where the answer is kept (the AI switches, app.ts). */
export interface PixlCpuStore {
  pixlCpu(): Promise<PixlCpuAnswer>
  setPixlCpu(answer: PixlCpuAnswer): Promise<unknown>
}

let store: PixlCpuStore | null = null
let open: Promise<boolean> | null = null

export function setPixlCpuStore(s: PixlCpuStore): void {
  store = s
}

/** The answer kept for this computer (`ask` before the store is up). */
export async function pixlCpuNow(): Promise<PixlCpuAnswer> {
  return store ? store.pixlCpu() : 'ask'
}

/**
 * Whether these PIXL models may run on the CPU now: the answer kept, else
 * the question (once, whoever else asks meanwhile shares it). `why` says
 * how they came to: no graphics chip to run them on, or the chip refused
 * one (`detail`, the engine's words).
 */
export async function mayUsePixlCpu(
  ids: readonly string[],
  why: 'no-gpu' | 'refused',
  detail?: string
): Promise<boolean> {
  const answer = await pixlCpuNow()
  if (answer !== 'ask') return answer === 'yes'
  open ??= ask(ids, why, detail).finally(() => {
    open = null
  })
  return open
}

async function ask(
  ids: readonly string[],
  why: 'no-gpu' | 'refused',
  detail?: string
): Promise<boolean> {
  const cost = t(
    'On the processor a RAW takes about 40 seconds to develop, and PIXL Enhance one to two minutes a photo. Without them, RAWs develop as before PIXL’s models and Detail’s AI boxes wait. You can change this in Settings → AI models.'
  )
  const opts: Electron.MessageBoxOptions = {
    type: 'question',
    buttons: [t('Use the processor'), t('Not on this computer')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: t('PIXL’s models would run on this computer’s processor'),
    detail:
      why === 'no-gpu'
        ? `${t('This computer has no graphics chip Playroom can run them on.')} ${cost}`
        : `${t('The graphics chip refused one of them: {{error}}', { error: detail ?? '' })}\n\n${cost}`
  }
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { response } = win
    ? await dialog.showMessageBox(win, opts)
    : await dialog.showMessageBox(opts)
  const yes = response === 0
  log.info('PIXL models on the CPU:', yes ? 'yes' : 'no', ids.join(', '), why)
  await store?.setPixlCpu(yes ? 'yes' : 'no')
  return yes
}
