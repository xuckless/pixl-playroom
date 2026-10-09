/**
 * The update feed as main sees it (main/updater.ts), and the notice at
 * launch: main pings the update server as Playroom opens; when a newer
 * version is there, a toast says "Update available!" once per version, and
 * again when it has downloaded, each opening the Update available dialog
 * (views/UpdateDialog.tsx) with what it brings.
 */
import { useEffect, useState } from 'react'
import type { UpdateState } from '../../../shared/ipc'
import { versionLabel } from '../../../shared/releasenotes'
import { useLibrary } from '../state/library'
import { api } from './api'
import { t } from './i18n'

let latest: UpdateState | null = null
const listeners = new Set<(s: UpdateState) => void>()

export function useUpdateState(): UpdateState | null {
  const [s, setS] = useState<UpdateState | null>(latest)
  useEffect(() => {
    listeners.add(setS)
    return () => void listeners.delete(setS)
  }, [])
  return s
}

/** Versions already announced, and how far ("available", then "downloaded"). */
const ANNOUNCED_KEY = 'playroom.update.announced'
function announced(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(ANNOUNCED_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}
function remember(version: string, stage: string): void {
  try {
    localStorage.setItem(ANNOUNCED_KEY, JSON.stringify({ ...announced(), [version]: stage }))
  } catch {
    // Private storage off: announced again next launch, no harm.
  }
}

/** Follow the update feed; say so when there is something new. */
export function startUpdateNotice(): () => void {
  const seen = (s: UpdateState): void => {
    latest = s
    listeners.forEach((l) => l(s))
    if (!s.version || s.version === s.currentVersion) return
    const stage =
      s.phase === 'downloaded'
        ? 'downloaded'
        : s.phase === 'available' || s.phase === 'downloading'
          ? 'available'
          : null
    if (!stage) return
    const was = announced()[s.version]
    if (was === stage || (was === 'downloaded' && stage === 'available')) return
    remember(s.version, stage)
    const lib = useLibrary.getState()
    // The dialog open says it already (and a toast would sit over its buttons).
    if (lib.dialog === 'update') return
    const open = { label: t('What’s new'), run: () => lib.setDialog('update') }
    if (stage === 'available')
      lib.say(
        t('Update available! Playroom {{version}} is downloading', {
          version: versionLabel(s.version)
        }),
        'info',
        open
      )
    else
      lib.say(
        t('Playroom {{version}} is ready: restart to update', { version: versionLabel(s.version) }),
        'info',
        {
          label: t('Restart'),
          run: () => void api.updates.install()
        }
      )
  }
  void api.updates.getState().then(seen, () => undefined)
  return api.updates.onState(seen)
}
