/**
 * PIXL's models on the CPU (engine 0.20.0, decisions 35 and 37): the engine
 * decides nothing; Playroom asks once per computer, keeps the answer in
 * Settings → AI models, and never moves a PIXL model to the CPU silently.
 * On the CPU the PIXL demosaic takes about 40 s a RAW and PIXL Enhance one
 * to two minutes a photo.
 *
 * One question, shared by every caller while it is open, asked in the app's
 * own dialog (the renderer's `PixlCpuHost`): main sends it to the window and
 * waits for the answer (`answerPixlCpu`). "Not now" asks again next session;
 * no window to ask in is a "not now". A "no" is `CpuDeclined`: a RAW
 * develops as before (`ai/rawdevelop.ts`), an Enhance step fails pointing
 * at Settings. */
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { homedir } from 'node:os'
import { IPC } from '../../shared/ipc'
import type { PixlCpuAnswer } from '../../shared/heavy'
import { cpuDetail, type PixlCpuQuestion, type PixlCpuReply } from '../../shared/pixlcpu'

export { CpuDeclined, isPixlModel } from '../../shared/pixlcpu'

/** Where the answer is kept (the AI switches, app.ts). */
export interface PixlCpuStore {
  pixlCpu(): Promise<PixlCpuAnswer>
  setPixlCpu(answer: PixlCpuAnswer): Promise<unknown>
}

let store: PixlCpuStore | null = null
let open: Promise<boolean> | null = null
/** The question on screen, and how it is answered. */
let pending: { question: PixlCpuQuestion; answer: (reply: PixlCpuReply) => void } | null = null
/** "Not now" this session: not asked again until the app starts again. */
let later = false

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
  if (later) return false
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
  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  if (windows.length === 0) {
    log.info('PIXL models on the CPU: no window to ask in; not now', ids.join(', '), why)
    later = true
    return false
  }
  const question: PixlCpuQuestion = {
    why,
    detail: detail ? cpuDetail(detail, [app.getPath('userData')], homedir()) : null
  }
  const reply = await new Promise<PixlCpuReply>((resolve) => {
    pending = { question, answer: resolve }
    for (const w of windows) w.webContents.send(IPC.ai.pixlCpuAsk, question)
  })
  pending = null
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) w.webContents.send(IPC.ai.pixlCpuAsk, null)
  log.info('PIXL models on the CPU:', reply, ids.join(', '), why, detail ?? '')
  if (reply === 'later') {
    later = true
    return false
  }
  await store?.setPixlCpu(reply)
  return reply === 'yes'
}

/** The question still on screen (a window that reloads shows it again). */
export function pixlCpuPending(): PixlCpuQuestion | null {
  return pending?.question ?? null
}

/**
 * The window's answer, or Settings → AI models changing it while the
 * question is open (`ask` there is "not now"). Any answer from Settings
 * also ends "not now".
 */
export function answerPixlCpu(reply: PixlCpuReply): void {
  if (reply !== 'later') later = false
  pending?.answer(reply)
}
