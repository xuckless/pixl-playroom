import { useCallback, useEffect, useState } from 'react'
import type { Preset } from '../../../shared/ipc'
import { api } from './api'

const presetListeners = new Set<() => void>()

/** Say the saved presets changed (one saved or removed): the lists showing them reload. */
export function presetsChanged(): void {
  for (const l of presetListeners) l()
}

/** Every preset, built-in and saved; reloaded when one is saved or removed. */
export function usePresets(): [Preset[], () => void] {
  const [presets, setPresets] = useState<Preset[]>([])
  const reload = useCallback((): void => {
    void api.presets.list().then(setPresets)
  }, [])
  useEffect(() => {
    reload()
    presetListeners.add(reload)
    return () => {
      presetListeners.delete(reload)
    }
  }, [reload])
  return [presets, reload]
}
