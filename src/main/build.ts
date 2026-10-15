/**
 * What kind of build this is, settled when it was built (electron.vite.config.ts
 * `define`), never at run time. `app.isPackaged` is false whenever a
 * shipped app.asar runs under a stock Electron, so it cannot decide what a
 * release trusts: the development entitlement root, the beta gate's skip,
 * the dev kit, the automation switches and DevTools are a development
 * build's alone.
 *
 * A release build is made with PLAYROOM_RELEASE_BUILD=1 (release.yml); any
 * other `electron-vite build`, and `electron-vite dev`, is a development
 * build, which is what scripts/drive.mjs, ui-sweep.mjs and perf.mjs launch.
 */

declare const __DEV__: boolean | undefined

/** A development build. Tests (no bundler) count as one. */
export const DEV_BUILD: boolean = typeof __DEV__ === 'boolean' ? __DEV__ : true

/**
 * The automation switches (PLAYROOM_HIDDEN, PLAYROOM_USER_DATA, the
 * update and policy feeds): a development build's only. A release ignores
 * them, so its profile, its window and its feeds are always its own.
 */
export function devEnv(name: string): string | undefined {
  return DEV_BUILD ? process.env[name] : undefined
}

/** Automation: never show the window (a development build only). */
export const HIDDEN = devEnv('PLAYROOM_HIDDEN') === '1'

/**
 * Chromium's remote debugging, which drives a window from outside (a
 * development build's test drives use it): a release refuses to start with it.
 */
export const REMOTE_DEBUGGING_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe'] as const

/** Whether this launch must stop: a release asked for remote debugging. */
export function refusesSwitches(hasSwitch: (name: string) => boolean, dev = DEV_BUILD): boolean {
  return !dev && REMOTE_DEBUGGING_SWITCHES.some((s) => hasSwitch(s))
}
