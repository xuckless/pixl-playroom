/**
 * A question the app asks before going on (deleting a collection, storing
 * results losslessly), in the app's own dialog rather than the system's.
 * `askConfirm` resolves true on the confirm button, false on cancel or close.
 */
import { create } from 'zustand'

export interface ConfirmRequest {
  title: string
  body: string
  /** The confirm button's words ("Delete", "Store losslessly"). */
  confirm: string
  cancel?: string
  /** A destructive action: the button says so. */
  danger?: boolean
}

interface ConfirmState {
  open: (ConfirmRequest & { answer: (yes: boolean) => void }) | null
}

export const useConfirm = create<ConfirmState>(() => ({ open: null }))

export function askConfirm(req: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    // One at a time: a question still open is answered no.
    useConfirm.getState().open?.answer(false)
    useConfirm.setState({
      open: {
        ...req,
        answer: (yes) => {
          useConfirm.setState({ open: null })
          resolve(yes)
        }
      }
    })
  })
}
