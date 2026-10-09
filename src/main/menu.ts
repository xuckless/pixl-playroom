/**
 * The menu bar and right-click menus, native on each platform.
 *
 * The renderer describes the menus between the app's own and Window / Help
 * (File, Edit, Photo, Develop, Masks, View: shared/appmenu.ts), with what
 * applies now and the user's own shortcuts, and sends them again as that
 * changes; until it has, Electron's defaults stand in. Main adds the app's
 * menu (macOS), Settings… (⌘, / Ctrl+,), View ▸ Engine Report…, Rendering
 * where the window's display offers a choice (macOS), the developer items,
 * Window and Help's legal pages. Page zoom is left out (⌘+ / ⌘− / ⌘0 zoom
 * the loupe instead).
 *
 * Windows shows the bar in the window (it is no longer hidden behind Alt),
 * so Settings and the tools are in reach there too.
 */
import {
  app,
  BrowserWindow,
  Menu,
  shell,
  type KeyboardEvent as MenuKeyEvent,
  type MenuItemConstructorOptions
} from 'electron'
import { IPC, type RenderMode } from '../shared/ipc'
import { TEXT_FALLBACK, type MenuBarSpec, type MenuNode } from '../shared/appmenu'
import { PERFORMANCE_SCALE, renderScale, setRenderMode, ULTRA_SCALE } from './display'
import { paths } from './paths'
import { t } from '../shared/i18n'

const SITE = 'https://playroom.pixlfoundation.com'
const LEGAL = 'https://playroom.pixlfoundation.com/legal'
const mac = process.platform === 'darwin'

const target = (): BrowserWindow | undefined =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

const toRenderer = (channel: string) => (): void => {
  target()?.webContents.send(channel)
}

// Made when the menu is built (labels in the language of the moment).
const settings = (): MenuItemConstructorOptions => ({
  label: t('Settings…'),
  accelerator: 'CmdOrCtrl+,',
  click: toRenderer(IPC.app.openPreferences)
})

const engineReport = (): MenuItemConstructorOptions => ({
  label: t('Engine Report…'),
  accelerator: 'CmdOrCtrl+Alt+E',
  click: toRenderer(IPC.app.openEngineReport)
})

const help = (): MenuItemConstructorOptions[] => [
  { label: t('Pixl Playroom Website'), click: () => void shell.openExternal(SITE) },
  { label: t('Report a Problem…'), click: toRenderer(IPC.app.openReport) },
  { type: 'separator' },
  { label: t('Licence Agreement'), click: () => void shell.openExternal(`${LEGAL}/eula/`) },
  // The copy this build shipped with, offline too.
  ...(app.getVersion().includes('-beta')
    ? [{ label: t('Beta Terms'), click: () => void shell.openPath(paths.betaTerms()) }]
    : []),
  { label: t('Privacy Policy'), click: () => void shell.openExternal(`${LEGAL}/privacy/`) },
  { label: t('Third-Party Notices'), click: () => void shell.openPath(paths.notices()) }
]

const times = (n: number): string => `${Number(n.toFixed(2))}×`

/**
 * A chosen item, to the renderer. One the menu took by its key (macOS: the
 * page left the key alone) is not run again: the renderer's bindings had
 * their turn. Only a text field's Undo, Redo and Select All are done here then.
 */
function choose(id: string, win: BrowserWindow | undefined, e: MenuKeyEvent): void {
  const w = win ?? target()
  if (!w || w.isDestroyed()) return
  if (e.triggeredByAccelerator) {
    const fallback = TEXT_FALLBACK[id as keyof typeof TEXT_FALLBACK]
    if (fallback) w.webContents[fallback]()
    return
  }
  w.webContents.send(IPC.menu.run, id)
}

/** The renderer's item as Electron's: labels only for keys off macOS (the page answers them). */
export function toItem(n: MenuNode): MenuItemConstructorOptions {
  if (n.type === 'separator') return { type: 'separator' }
  if (n.role) return { role: n.role, ...(n.label ? { label: n.label } : {}) }
  const item: MenuItemConstructorOptions = {
    label: n.label ?? '',
    enabled: n.enabled ?? true
  }
  if (n.accelerator) {
    item.accelerator = n.accelerator
    if (!mac) item.registerAccelerator = false
  }
  if (n.checked !== undefined) {
    item.type = n.radio ? 'radio' : 'checkbox'
    item.checked = n.checked
  }
  if (n.submenu) item.submenu = n.submenu.map(toItem)
  else if (n.id) {
    const id = n.id
    item.click = (_item, win, e) => choose(id, win as BrowserWindow | undefined, e)
  }
  return item
}

/** The renderer's menus, once it has sent them. */
let spec: MenuBarSpec | null = null

/** The renderer's menus, as they apply now. */
export function setMenuSpec(next: MenuBarSpec): void {
  spec = next
  buildMenu()
}

/** A right-click menu at the pointer, in the focused window. */
export function popupMenu(items: MenuNode[]): void {
  const win = target()
  if (!win || win.isDestroyed() || items.length === 0) return
  Menu.buildFromTemplate(items.map(toItem)).popup({ window: win })
}

function renderingMenu(): MenuItemConstructorOptions[] {
  const s = renderScale()
  if (!s.available || s.native === null) return []
  const native = s.native
  const label: Record<RenderMode, string> = {
    ultra: t('Ultra ({{scale}})', { scale: times(ULTRA_SCALE) }),
    performance: t('Performance ({{scale}})', { scale: times(PERFORMANCE_SCALE) }),
    native: t('Native ({{scale}})', { scale: times(native) })
  }
  // A mode that draws no coarser here than native is native.
  const shown = s.modes.includes(s.mode) ? s.mode : 'native'
  return [
    { type: 'separator' },
    {
      label: t('Rendering'),
      submenu: s.modes.map((m) => ({
        label: label[m],
        type: 'radio' as const,
        checked: m === shown,
        click: () => setRenderMode(m)
      }))
    }
  ]
}

export function buildMenu(): void {
  const developer: MenuItemConstructorOptions = {
    label: t('Developer'),
    submenu: [
      { role: 'reload', label: t('Reload') },
      { role: 'forceReload', label: t('Force Reload') },
      { role: 'toggleDevTools', label: t('Toggle Developer Tools') }
    ]
  }
  const viewTail: MenuItemConstructorOptions[] = [
    engineReport(),
    ...renderingMenu(),
    { type: 'separator' },
    { role: 'togglefullscreen', label: t('Toggle Full Screen') },
    { type: 'separator' },
    developer
  ]
  // The renderer's menus come in order (File, Edit, Photo, Develop, Masks,
  // View), labelled in the user's language: File is the first, View the last.
  const theirs = spec?.menus ?? []
  const fileMenu = theirs.length > 0 ? theirs[0] : undefined
  const viewMenu = theirs.length > 1 ? theirs[theirs.length - 1] : undefined
  const fileItems = (fileMenu?.items ?? []).map(toItem)
  const viewItems = (viewMenu?.items ?? []).map(toItem)
  const middle: MenuItemConstructorOptions[] = theirs
    .slice(1, -1)
    .map((m) => ({ label: m.label, submenu: m.items.map(toItem) }))
  const settingsItem = settings()

  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about', label: t('About {{app}}', { app: app.name }) },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services', label: t('Services') },
              { type: 'separator' },
              { role: 'hide', label: t('Hide {{app}}', { app: app.name }) },
              { role: 'hideOthers', label: t('Hide Others') },
              { role: 'unhide', label: t('Show All') },
              { type: 'separator' },
              { role: 'quit', label: t('Quit {{app}}', { app: app.name }) }
            ] satisfies MenuItemConstructorOptions[]
          }
        ]
      : []),
    spec
      ? {
          label: fileMenu?.label ?? t('File'),
          submenu: [
            ...fileItems,
            { type: 'separator' },
            mac ? { role: 'close', label: t('Close Window') } : settingsItem,
            ...(mac
              ? []
              : [{ type: 'separator' as const }, { role: 'quit' as const, label: t('Exit') }])
          ]
        }
      : mac
        ? { role: 'fileMenu' }
        : { label: t('File'), submenu: [settingsItem, { type: 'separator' }, { role: 'quit' }] },
    // Until the renderer has said, the OS's Edit menu (text fields' copy and paste).
    ...(spec ? middle : [{ role: 'editMenu' } as MenuItemConstructorOptions]),
    {
      label: viewMenu?.label ?? t('View'),
      submenu: viewItems.length ? [...viewItems, { type: 'separator' }, ...viewTail] : viewTail
    },
    {
      role: 'windowMenu',
      label: t('Window'),
      submenu: [
        { role: 'minimize', label: t('Minimize') },
        { role: 'zoom', label: t('Zoom') },
        ...(mac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: t('Bring All to Front') }
            ]
          : [{ role: 'close' as const, label: t('Close') }])
      ]
    },
    { role: 'help', label: t('Help'), submenu: help() }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  // Windows shows the menu names in the window's top bar: they are read again.
  if (process.platform === 'win32')
    for (const w of BrowserWindow.getAllWindows())
      if (!w.isDestroyed()) w.webContents.send(IPC.menu.changed)
}

/** The menu bar's names, for the window's top bar to show (Windows). */
export function topMenus(): string[] {
  return Menu.getApplicationMenu()?.items.map((i) => i.label) ?? []
}

/** One of the menu bar's menus, opened under its name in the top bar (window coordinates). */
export function openTopMenu(index: number, x: number, y: number): void {
  const win = target()
  const menu = Menu.getApplicationMenu()?.items[index]?.submenu
  if (!win || win.isDestroyed() || !menu) return
  menu.popup({ window: win, x, y })
}
