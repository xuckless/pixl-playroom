/**
 * The macOS menu bar: Electron's default menus, with View ▸ Rendering where
 * the window's display offers a choice. Elsewhere the default menu stays.
 */
import { Menu, type MenuItemConstructorOptions } from 'electron'
import { PERFORMANCE_SCALE, renderScale, setRenderMode } from './display'

const times = (n: number): string => `${Number(n.toFixed(2))}×`

export function buildMenu(): void {
  if (process.platform !== 'darwin') return
  const s = renderScale()
  const view: MenuItemConstructorOptions[] = [
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]
  if (s.available && s.native !== null)
    view.push(
      { type: 'separator' },
      {
        label: 'Rendering',
        submenu: [
          {
            label: `Performance (${times(PERFORMANCE_SCALE)})`,
            type: 'radio',
            checked: s.mode === 'performance',
            click: () => setRenderMode('performance')
          },
          {
            label: `Native (${times(s.native)})`,
            type: 'radio',
            checked: s.mode === 'native',
            click: () => setRenderMode('native')
          }
        ]
      }
    )
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: view },
      { role: 'windowMenu' }
    ])
  )
}
