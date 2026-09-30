/** The AI model list as panels need it: current as downloads move, and a few helpers. */
import { useEffect, useState } from 'react'
import type { ModelInfo } from '../../../shared/ipc'
import { api } from './api'

export const mb = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1e6))} MB`

/** The model list, kept current as downloads move. */
export function useModels(): ModelInfo[] {
  const [models, setModels] = useState<ModelInfo[]>([])
  useEffect(() => {
    void api.models.list().then(setModels, () => undefined)
    return api.models.onEvent(setModels)
  }, [])
  return models
}

/** Whether every one of `ids` is downloaded (false while the list is still loading). */
export function allInstalled(models: ModelInfo[], ids: string[]): boolean {
  return ids.every((id) => models.find((m) => m.id === id)?.installed === true)
}
