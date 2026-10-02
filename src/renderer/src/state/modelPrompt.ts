/**
 * "This needs a model": asked the moment a tool needs one that is not
 * downloaded (Objects and Sky need SAM 2.1, Subject the subject model, AI
 * denoise DRUNet), in the app's own dialog, offering the one model Playroom
 * recommends for the job, so nobody has to go looking in Settings for which
 * one to get. `askModel` resolves true once it is downloaded (the tool then
 * goes on), false if the user said not now or the download failed.
 */
import { create } from 'zustand'

export interface ModelAsk {
  /** The roster id to download. */
  id: string
  /** What the user was doing: "Select objects", "Sky", "AI denoise". */
  purpose: string
  answer: (ok: boolean) => void
}

interface ModelPromptState {
  open: ModelAsk | null
}

export const useModelPrompt = create<ModelPromptState>(() => ({ open: null }))

export function askModel(id: string, purpose: string): Promise<boolean> {
  return new Promise((resolve) => {
    // One at a time: a question still open is answered no.
    useModelPrompt.getState().open?.answer(false)
    useModelPrompt.setState({
      open: {
        id,
        purpose,
        answer: (ok) => {
          useModelPrompt.setState({ open: null })
          resolve(ok)
        }
      }
    })
  })
}
