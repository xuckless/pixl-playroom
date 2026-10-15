import { useCull } from './state/cull'
import { api } from './lib/api'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/manrope'
import './styles/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startLanguage } from './lib/i18n'
import { useDevelop } from './state/develop'
import { useLibrary } from './state/library'
import { useUi } from './state/ui'
import { useBusy } from './state/busy'
import { useAiJobs } from './state/jobs'
import { useLooks } from './state/looks'
import { useExports } from './state/exports'

// The stores, for automation and the devtools console.
;(window as unknown as { __playroom: unknown }).__playroom = {
  useLibrary,
  useDevelop,
  useUi,
  useBusy,
  useAiJobs,
  useLooks,
  useCull,
  useExports
}

// No title bar: macOS draws its window buttons at the top bar's left (room
// left for them, bar in full screen, where they go with the menu bar);
// Windows draws its own at the right, beside the menu names (WindowMenus).
{
  const root = document.documentElement
  // The theme from the first frame (Settings → Interface → Theme).
  root.dataset.theme = useUi.getState().theme
  root.dataset.platform = /Mac/.test(navigator.platform)
    ? 'mac'
    : /Win/.test(navigator.platform)
      ? 'win'
      : 'other'
  // Full screen as the window says it is, not guessed from its size: a
  // window as large as the screen (zoomed, with the menu bar and Dock
  // hidden) still has its buttons, and the bar must keep their room.
  const full = (on: boolean): void => void root.toggleAttribute('data-fullscreen', on)
  void api.app.fullScreen().then(full, () => undefined)
  api.app.onFullScreen(full)
}

// The language first, so the first frame is drawn in it.
void startLanguage().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
)
