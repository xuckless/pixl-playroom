import { useEffect, useState } from 'react'
import { useLibrary } from '../state/library'
import { t } from '../lib/i18n'
import { Icon } from './icons'
import { Modal } from './ui'

/** How long a message stays: a note a moment, a failure long enough to read twice. */
const INFO_MS = 4000
const ERROR_MS = 20000

/**
 * What the app says in passing (the store's `say`): a toast at the foot of
 * the window, and the same words in a live region a screen reader always
 * hears (politely for a note, at once for a failure). A toast stays while
 * the pointer or focus is on it, has a close button, and one with an action
 * stays until it is used or replaced. Everything said is kept in Recent
 * messages (View menu).
 */
export function Toasts(): React.JSX.Element {
  const toast = useLibrary((s) => s.toast)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!toast || toast.action || held) return
    const timer = setTimeout(
      () => {
        if (useLibrary.getState().toast === toast) useLibrary.setState({ toast: null })
      },
      toast.tone === 'error' ? ERROR_MS : INFO_MS
    )
    return () => clearTimeout(timer)
  }, [toast, held])
  const close = (): void => {
    setHeld(false)
    useLibrary.setState({ toast: null })
  }
  return (
    <>
      {/* Always in the page, so what changes in them is heard. */}
      <div className="sr-only" role="status" aria-live="polite">
        {toast?.tone === 'info' && <span key={toast.id}>{toast.text}</span>}
      </div>
      <div className="sr-only" role="alert">
        {toast?.tone === 'error' && <span key={toast.id}>{toast.text}</span>}
      </div>
      {toast && (
        <div
          className={`toast ${toast.tone}`}
          key={toast.id}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          {toast.text}
          {toast.action && (
            <button
              className="primary"
              onClick={() => {
                useLibrary.setState({ toast: null })
                toast.action?.run()
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="icon sm ghost toast-close" aria-label={t('Dismiss')} onClick={close}>
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  )
}

/** Everything the app said this session, newest first, with when. */
export function MessagesDialog(): React.JSX.Element {
  const messages = useLibrary((s) => s.messages)
  const close = (): void => useLibrary.getState().setDialog(null)
  return (
    <Modal
      title={t('Recent messages')}
      icon="history"
      onClose={close}
      footer={
        <>
          <button
            disabled={messages.length === 0}
            onClick={() => useLibrary.setState({ messages: [] })}
          >
            {t('Clear')}
          </button>
          <button className="primary" autoFocus onClick={close}>
            {t('Done')}
          </button>
        </>
      }
    >
      {messages.length === 0 ? (
        <p className="muted">{t('Nothing said yet.')}</p>
      ) : (
        <ul className="messages">
          {[...messages].reverse().map((m) => (
            <li key={m.id} className={m.tone}>
              <time className="t-num muted">
                {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </time>
              {m.tone === 'error' && <span className="sr-only">{t('Error')}: </span>}
              <span className="selectable">{m.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
