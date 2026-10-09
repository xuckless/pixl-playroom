/**
 * The menus the renderer describes and main shows natively: the menu bar
 * (macOS's at the top of the screen, a Windows window's under its title) and
 * right-click menus. The renderer owns what each item does, whether it
 * applies now and its shortcut (the user's own binding); main draws them
 * and sends back the id of the one chosen (`IPC.menu.run`).
 *
 * Keys stay the renderer's: a menu's shortcut is shown, but the key itself
 * is answered by the renderer's bindings (lib/commands.ts). On macOS a key
 * the page left alone reaches the menu too, which then does nothing (bar the
 * text fields' Undo, Redo and Select All); elsewhere the menu's shortcuts are
 * labels only.
 */

/** Edit actions the OS does on the focused text (roles). */
export type MenuRole = 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll'

export interface MenuNode {
  /** What the renderer runs when it is chosen. */
  id?: string
  label?: string
  /** An Electron accelerator ("CmdOrCtrl+Shift+C"), shown beside the label. */
  accelerator?: string
  enabled?: boolean
  /** A tick: shown as a checkbox (or a radio, with `radio`). */
  checked?: boolean
  radio?: boolean
  type?: 'separator'
  role?: MenuRole
  submenu?: MenuNode[]
}

export interface MenuBarMenu {
  label: string
  items: MenuNode[]
}

/** The menus between the app's own (macOS) and Window / Help. */
export interface MenuBarSpec {
  menus: MenuBarMenu[]
}

/**
 * Ids main answers itself when the menu takes a key on macOS (the page left
 * it alone, so a text field has the focus): that field's Undo, Redo, Select All.
 */
export const TEXT_FALLBACK = {
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.selectAll': 'selectAll'
} as const

export const SEPARATOR: MenuNode = { type: 'separator' }

/**
 * The items as they should show: no separator first, last or twice in a row
 * (items left out by context leave none behind), and no empty submenu.
 */
export function tidyMenu(items: MenuNode[]): MenuNode[] {
  const out: MenuNode[] = []
  for (const it of items) {
    if (it.type === 'separator') {
      if (out.length && out[out.length - 1].type !== 'separator') out.push(it)
      continue
    }
    if (it.submenu) {
      const sub = tidyMenu(it.submenu)
      if (sub.length === 0) continue
      out.push({ ...it, submenu: sub })
      continue
    }
    out.push(it)
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop()
  return out
}
