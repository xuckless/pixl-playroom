import { useCull } from './state/cull'
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

// The stores, for automation and the devtools console.
;(window as unknown as { __playroom: unknown }).__playroom = {
  useLibrary,
  useDevelop,
  useUi,
  useBusy,
  useAiJobs,
  useLooks,
  useCull
}

// macOS draws its window buttons in the top bar (no title bar): the bar
// leaves them room, except in full screen, where they go with the menu bar.
{
  const root = document.documentElement
  root.dataset.platform = /Mac/.test(navigator.platform) ? 'mac' : 'other'
  const full = (): void => {
    root.toggleAttribute(
      'data-fullscreen',
      window.outerWidth >= screen.width && window.outerHeight >= screen.height
    )
  }
  full()
  window.addEventListener('resize', full)
}

// The language first, so the first frame is drawn in it.
void startLanguage().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
)
