import { AnimatePresence } from 'motion/react'
import { useEffect, useState } from 'react'
import { api, errorText } from '../lib/api'
import { mb, useModels } from '../lib/models'
import { useModelPrompt, type ModelAsk } from '../state/modelPrompt'
import { copyOf } from '../views/modelCopy'
import { Modal } from './ui'

/**
 * Where `askModel`'s questions show (mounted once, beside the other
 * dialogs): the one model a tool needs, in plain words, its size, and
 * Download; the download's progress in place, and the tool going on by
 * itself once it is here.
 */
export function ModelPromptHost(): React.JSX.Element {
  const open = useModelPrompt((s) => s.open)
  return <AnimatePresence>{open && <ModelPrompt key={open.id} ask={open} />}</AnimatePresence>
}

function ModelPrompt({ ask }: { ask: ModelAsk }): React.JSX.Element {
  const models = useModels()
  const m = models.find((x) => x.id === ask.id)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const copy = m ? copyOf(m) : null

  // Here (or here all along): the tool goes on.
  useEffect(() => {
    if (m?.installed) ask.answer(true)
  }, [m?.installed, ask])
  // A download that stopped with an error says so, and can be tried again.
  const error =
    failed ?? (started && m && m.progress === null && !m.installed ? (m.error ?? null) : null)
  const downloading = !error && (started || (m?.progress ?? null) !== null)
  const pct = m?.progress != null ? Math.round(m.progress * 100) : 0
  const start = (): void => {
    setFailed(null)
    setStarted(true)
    void api.models.download(ask.id).catch((e) => {
      setFailed(errorText(e))
      setStarted(false)
    })
  }
  const close = (): void => {
    if (downloading) void api.models.cancel(ask.id)
    ask.answer(false)
  }

  return (
    <Modal
      title={copy?.name ?? 'A model is needed'}
      icon="smart"
      className="confirm model-prompt"
      onClose={close}
      footer={
        <>
          <button onClick={close}>{downloading ? 'Cancel download' : 'Not now'}</button>
          {!downloading && (
            <button className="primary" autoFocus disabled={!m} onClick={start}>
              {m ? `Download · ${mb(m.bytes)}` : 'Download'}
            </button>
          )}
        </>
      }
    >
      <p>
        <strong>{ask.purpose}</strong> needs this model, a one-time download.
      </p>
      {copy && <p>{copy.what}</p>}
      <p className="muted">
        It downloads once and stays on this Mac or PC; everything it does runs here, offline.
        {copy?.where ? ` You'll find it later in ${copy.where}.` : ''}
      </p>
      {downloading && (
        <div className="model-prompt-progress" aria-label="Downloading">
          <span className="model-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="t-num">{pct}%</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {m && (
        <p className="micro muted" title={m.caveat}>
          {m.title.split(':')[0]} · {m.licence} · {m.holder}
        </p>
      )}
    </Modal>
  )
}
