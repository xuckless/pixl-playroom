import { useCull } from './state/cull'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/manrope'
import './styles/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
