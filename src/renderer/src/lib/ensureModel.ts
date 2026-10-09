/**
 * Before a tool that runs a model: its model here, or the user asked to get
 * it (state/modelPrompt.ts) and the download done. True when the tool can
 * go on.
 */
import type { AiTask } from '../../../shared/ai'
import { useAiJobs } from '../state/jobs'
import { askModel } from '../state/modelPrompt'
import { useLibrary } from '../state/library'
import { t, tk } from './i18n'

const PURPOSE: Partial<Record<AiTask, string>> = {
  segment: tk('Find the subject'),
  prompt: tk('Select objects and the sky'),
  denoise: tk('AI denoise')
}

/** `purpose` as the user reads it (translated); the task's own when not given. */
export async function ensureModel(
  task: AiTask,
  purpose = PURPOSE[task] ? t(PURPOSE[task]) : task
): Promise<boolean> {
  const jobs = useAiJobs.getState()
  const caps = jobs.capabilities ?? (await jobs.refresh().catch(() => null))
  if (!caps) return false
  if (caps[task as keyof typeof caps] === true) return true
  const id = caps.get?.[task]
  if (!id) {
    const why = caps.why[task]
    useLibrary
      .getState()
      .say(why ? `${purpose}: ${why}` : t('{{purpose}} is not available', { purpose }), 'error')
    return false
  }
  if (!(await askModel(id, purpose))) return false
  const after = await jobs.refresh().catch(() => null)
  return after?.[task as keyof typeof after] === true
}

/** Before a step that runs this model (a denoise picked by name): here, or asked for. */
export async function ensureModelId(
  id: string,
  installed: boolean,
  purpose: string
): Promise<boolean> {
  if (installed) return true
  return askModel(id, purpose)
}
