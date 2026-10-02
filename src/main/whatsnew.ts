/**
 * The What's new popup's memory (shared/releasenotes.ts): the release whose
 * notes were last shown, in settings.json, and whether this install is older
 * than the popup, so that an update from a build without it still shows its
 * notes while a fresh install shows none.
 */
import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { notesToShow, type ReleaseNotes } from '../shared/releasenotes'
import { readSettings, writeSettings } from './settings'

let hadInstall = false

/** Call at launch, before the index is opened: an index already there means an earlier install. */
export function noteInstall(): void {
  hadInstall = existsSync(join(app.getPath('userData'), 'playroom.db'))
}

/** The notes to show now, newest first; a fresh install records its version and shows none. */
export function whatsNew(): ReleaseNotes[] {
  const seen = readSettings().notesSeen ?? null
  const notes = notesToShow(app.getVersion(), seen, hadInstall)
  if (!seen && notes.length === 0) writeSettings({ notesSeen: app.getVersion() })
  return notes
}

/** The notes were shown: the next ones are the next release's. */
export function notesSeen(): void {
  writeSettings({ notesSeen: app.getVersion() })
}
