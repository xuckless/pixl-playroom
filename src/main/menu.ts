/**
 * The menu bar: Electron's default menus, less page zoom (⌘+ / ⌘− / ⌘0 zoom
 * the loupe instead), with View ▸ Rendering where the window's display offers
 * a choice (macOS).
 */
import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { RenderMode } from '../shared/ipc'
import { PERFORMANCE_SCALE, renderScale, setRenderMode, ULTRA_SCALE } from './display'

const times = (n: number): string => `${Number(n.toFixed(2))}×`

export function buildMenu(): void {
  const mac = process.platform === 'darwin'
  const s = renderScale()
  const view: MenuItemConstructorOptions[] = [
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]
  if (s.available && s.native !== null) {
    const native = s.native
    const label: Record<RenderMode, string> = {
      ultra: `Ultra (${times(ULTRA_SCALE)})`,
      performance: `Performance (${times(PERFORMANCE_SCALE)})`,
      native: `Native (${times(native)})`
    }
    // A mode that draws no coarser here than native is native.
    const shown = s.modes.includes(s.mode) ? s.mode : 'native'
    view.push(
      { type: 'separator' },
      {
        label: 'Rendering',
        submenu: s.modes.map((m) => ({
          label: label[m],
          type: 'radio' as const,
          checked: m === shown,
          click: () => setRenderMode(m)
        }))
      }
    )
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: view },
      { role: 'windowMenu' }
    ])
  )
}
