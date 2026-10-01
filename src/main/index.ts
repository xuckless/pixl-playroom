/**
 * The entry: only what decides whether this process stays. A Retina Mac in
 * Performance mode needs its scale on the command line, and a launch without
 * it starts again with it (see display.ts); that first process leaves having
 * loaded next to nothing, the app (the updater, the index, the engines) only
 * in the one that stays.
 */
import { app } from 'electron'
import { bootScale } from './display'
import { handOffOpens, openable, pathsFromArgv, queueOpen } from './open'

// A separate profile for automated runs and experiments (before the scale is
// read: it is kept in userData).
if (process.env['PLAYROOM_USER_DATA']) app.setPath('userData', process.env['PLAYROOM_USER_DATA'])
const hidden = process.env['PLAYROOM_HIDDEN'] === '1'

if (bootScale({ canRelaunch: app.isPackaged && !hidden })) {
  // The relaunch starts when this process exits. It leaves at ready, once
  // macOS has delivered the photos this launch was asked to open
  // (`open-file`), and hands them to the next process.
  app.on('open-file', (e, path) => {
    e.preventDefault()
    const p = openable(path)
    if (p) queueOpen([p])
  })
  queueOpen(
    pathsFromArgv(
      process.argv,
      process.cwd(),
      app.isPackaged ? 1 : 2,
      app.isPackaged ? undefined : app.getAppPath()
    )
  )
  app.once('ready', () => {
    handOffOpens(app.getPath('userData'))
    app.exit(0)
  })
} else {
  void import('./app')
}
