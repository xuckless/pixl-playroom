import { AnimatePresence } from 'motion/react'
import { useConfirm } from '../state/confirm'
import { Modal } from './ui'
import { t } from '../lib/i18n'

/**
 * Where `askConfirm`'s questions show (mounted once, beside the other
 * dialogs). Return answers the least destructive button: Cancel when the
 * action deletes or cannot be undone (`danger`), the action otherwise.
 */
export function ConfirmHost(): React.JSX.Element {
  const open = useConfirm((s) => s.open)
  return (
    <AnimatePresence>
      {open && (
        <Modal
          key="confirm"
          title={open.title}
          icon={open.danger ? 'warning' : 'info'}
          className={`confirm${open.danger ? ' danger' : ''}`}
          onClose={() => open.answer(false)}
          footer={
            <>
              <button autoFocus={!!open.danger} onClick={() => open.answer(false)}>
                {open.cancel ?? t('Cancel')}
              </button>
              <button
                className={open.danger ? 'danger' : 'primary'}
                autoFocus={!open.danger}
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
