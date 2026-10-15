import { AnimatePresence } from 'motion/react'
import { useEffect, useState } from 'react'
import { api, errorText } from '../lib/api'
import { useLibrary } from '../state/library'
import type { PixlCpuQuestion, PixlCpuReply } from '../../../shared/pixlcpu'
import { Modal } from './ui'
import { t } from '../lib/i18n'

/**
 * Where main's "PIXL's models would run on the processor" question shows
 * (`main/ai/pixlcpu.ts`), in the app's own dialog: what happened in plain
 * words, what the processor costs, and the engine's words folded away.
 * Closing it is "not now": asked again next time Playroom starts.
 */
export function PixlCpuHost(): React.JSX.Element {
  const [question, setQuestion] = useState<PixlCpuQuestion | null>(null)
  useEffect(() => {
    void api.ai
      .pixlCpuPending()
      .then((q) => q && setQuestion(q))
      .catch(() => undefined)
    return api.ai.onPixlCpuAsk(setQuestion)
  }, [])
  const answer = (reply: PixlCpuReply): void => {
    setQuestion(null)
    void api.ai
      .answerPixlCpu(reply)
      .catch((err) => useLibrary.getState().say(errorText(err), 'error'))
  }
  return (
    <AnimatePresence>
      {question && (
        <Modal
          key="pixl-cpu"
          title={t('Run PIXL’s models on the processor?')}
          icon="smart"
          className="confirm pixl-cpu"
          onClose={() => answer('later')}
          footer={
            <>
              <button onClick={() => answer('no')}>{t('Not on this computer')}</button>
              <button className="primary" autoFocus onClick={() => answer('yes')}>
                {t('Use the processor')}
              </button>
            </>
          }
        >
          <p>
            {question.why === 'no-gpu'
              ? t(
                  'This computer has no graphics chip Playroom can run PIXL’s models on, so they would run on the processor instead.'
                )
              : t(
                  'The graphics chip couldn’t load one of PIXL’s models this time, so it would run on the processor instead.'
                )}
          </p>
          <p>
            {t(
              'That’s slower: about 40 seconds to develop a RAW, and a minute or two for PIXL Enhance. Without them, RAWs develop the classic way and Detail’s AI boxes wait.'
            )}
          </p>
          <p className="muted">{t('You can change this any time in Settings → AI models.')}</p>
          {question.detail && (
            <details className="pixl-cpu-detail">
              <summary>{t('Technical details')}</summary>
              <pre>{question.detail}</pre>
            </details>
          )}
        </Modal>
      )}
    </AnimatePresence>
  )
}
