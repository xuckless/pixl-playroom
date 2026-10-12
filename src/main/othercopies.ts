/**
 * macOS: have Launch Services forget the other copies of Playroom, so Finder's
 * "Open With" lists one (src/shared/othercopies.ts says which). Run at each
 * launch of a packaged build, so it also follows an update: macOS registers a
 * copy again when it meets it (a disk image mounted again), and the next
 * launch forgets it again. Nothing on disk is touched.
 */
import { app } from 'electron'
import log from 'electron-log/main'
import { execFile } from 'child_process'
import { homedir } from 'os'
import { dirname } from 'path'
import { promisify } from 'util'
import { copiesToForget, type AppCopy } from '../shared/othercopies'

const run = promisify(execFile)

/** electron-builder.yml `appId`. */
const BUNDLE_ID = 'com.xuckless.pixlplayroom'
const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

/**
 * The copies Launch Services holds for a bundle id that are still on disk
 * (the ones Finder lists), with their versions, as JSON. JavaScript for
 * Automation: it only calls AppKit, no other app is scripted.
 */
const LIST_COPIES = `
ObjC.import('AppKit')
function run(argv) {
  const urls = $.NSWorkspace.sharedWorkspace.URLsForApplicationsWithBundleIdentifier(argv[0])
  const out = []
  for (let i = 0; i < urls.count; i++) {
    const url = urls.objectAtIndex(i)
    const bundle = $.NSBundle.bundleWithURL(url)
    const version = bundle.isNil() ? $() : bundle.objectForInfoDictionaryKey('CFBundleShortVersionString')
    out.push({ path: ObjC.unwrap(url.path), version: version.isNil() ? null : ObjC.unwrap(version) })
  }
  return JSON.stringify(out)
}`

export async function forgetOtherCopies(): Promise<void> {
  if (process.platform !== 'darwin' || !app.isPackaged) return
  try {
    // …/Pixl Playroom.app/Contents/MacOS/Pixl Playroom
    const self = dirname(dirname(dirname(app.getPath('exe'))))
    const { stdout } = await run('osascript', ['-l', 'JavaScript', '-e', LIST_COPIES, BUNDLE_ID])
    const copies = JSON.parse(stdout) as AppCopy[]
    for (const path of copiesToForget(self, app.getVersion(), homedir(), copies)) {
      await run(LSREGISTER, ['-u', path])
      log.info(`open with: forgot another copy of Playroom at ${path}`)
    }
  } catch (err) {
    log.warn('open with: other copies not looked for', (err as Error).message)
  }
}
