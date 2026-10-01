import { AnimatePresence } from 'motion/react'
import { useConfirm } from '../state/confirm'
import { Modal } from './ui'

/** Where `askConfirm`'s questions show (mounted once, beside the other dialogs). */
export function ConfirmHost(): React.JSX.Element {
  const open = useConfirm((s) => s.open)
  return (
    <AnimatePresence>
      {open && (
        <Modal
          key="confirm"
          title={open.title}
          icon="settings"
          className="confirm"
          onClose={() => open.answer(false)}
          footer={
            <>
              <button onClick={() => open.answer(false)}>{open.cancel ?? 'Cancel'}</button>
              <button
                className={open.danger ? 'danger' : 'primary'}
                autoFocus
                onClick={() => open.answer(true)}
              >
                {open.confirm}
              </button>
            </>
          }
        >
          {open.body.split('\n\n').map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </Modal>
      )}
    </AnimatePresence>
  )
}
