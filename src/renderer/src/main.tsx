import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useDevelop } from './state/develop'
import { useLibrary } from './state/library'

// The stores, for automation and the devtools console.
;(window as unknown as { __playroom: unknown }).__playroom = { useLibrary, useDevelop }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
