import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const WINDOWS = /Win/.test(navigator.platform)

/** Open the menu bar's `index`th menu under its name. */
function openMenu(index: number, el: HTMLElement): void {
  const r = el.getBoundingClientRect()
  void api.menu.openTop(index, Math.round(r.left), Math.round(r.bottom)).catch(() => undefined)
}

/**
 * Windows: the menu bar's names in the top bar (the window has no frame;
 * main/app.ts). Each opens the same native menu the bar holds, with its
 * items, shortcuts and greying. Alt on its own opens the first, as a
 * Windows menu bar does.
 */
export function WindowMenus(): React.JSX.Element | null {
  const [menus, setMenus] = useState<string[]>([])
  useEffect(() => {
    if (!WINDOWS) return
    const load = (): void => void api.menu.top().then(setMenus, () => undefined)
    load()
    const off = api.menu.onChanged(load)
    // Alt pressed and let go with nothing else: the first menu.
    let alone = false
    const down = (e: KeyboardEvent): void => {
      alone = e.key === 'Alt' && !e.repeat
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key !== 'Alt' || !alone) return
      alone = false
      const first = document.querySelector<HTMLElement>('.window-menus button')
      if (first) openMenu(0, first)
    }
    const cancel = (): void => {
      alone = false
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('pointerdown', cancel, true)
    window.addEventListener('blur', cancel)
    return () => {
      off()
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('pointerdown', cancel, true)
      window.removeEventListener('blur', cancel)
    }
  }, [])
  if (!WINDOWS || menus.length === 0) return null
  return (
    <nav className="window-menus" role="menubar">
      {menus.map((label, i) => (
        <button
          key={i}
          role="menuitem"
          aria-haspopup="menu"
          onClick={(e) => openMenu(i, e.currentTarget)}
        >
          {label.replace(/&/g, '')}
        </button>
      ))}
    </nav>
  )
}
