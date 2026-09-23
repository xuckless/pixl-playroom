import { useCallback, useEffect, useState } from 'react'
import type { Preset } from '../../../shared/ipc'
import { api } from './api'

/** Every preset, built-in and saved; reloaded every `everyMs` so a new save shows up. */
export function usePresets(everyMs: number): [Preset[], () => void] {
  const [presets, setPresets] = useState<Preset[]>([])
  const reload = useCallback((): void => {
    void api.presets.list().then(setPresets)
  }, [])
  useEffect(() => {
    reload()
    const t = setInterval(reload, everyMs)
    return () => clearInterval(t)
  }, [reload, everyMs])
  return [presets, reload]
}
