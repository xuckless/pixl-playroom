/** The What's new popup (views/WhatsNew.tsx): which notes it shows, and the two ways it opens. */
import { create } from 'zustand'
import { latestNotes, type ReleaseNotes } from '../../../shared/releasenotes'
import { api } from '../lib/api'
import { useLibrary } from './library'

/** The notes shown, and whether closing marks them seen (the launch's) or not (Settings'). */
export const useWhatsNew = create<{ notes: ReleaseNotes[]; atLaunch: boolean }>(() => ({
  notes: [],
  atLaunch: false
}))

/** After an update, once the splash is gone: what it brought, once. */
export async function showWhatsNew(): Promise<void> {
  const notes = await api.app.whatsNew().catch(() => [])
  if (notes.length === 0 || useLibrary.getState().dialog) return
  useWhatsNew.setState({ notes, atLaunch: true })
  useLibrary.getState().setDialog('whats-new')
}

/** This build's notes again (Settings → Updates). */
export function openReleaseNotes(version: string): void {
  const notes = latestNotes(version)
  if (!notes) return
  useWhatsNew.setState({ notes: [notes], atLaunch: false })
  useLibrary.getState().setDialog('whats-new')
}
