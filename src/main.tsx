import '@radix-ui/themes/styles.css'
import './app/app.css'
import { Theme } from '@radix-ui/themes'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { router } from './app/router'
import { useAppearance } from './app/theme'
import { startSession } from './session/session'

startSession()

function App() {
  return (
    <Theme appearance={useAppearance()}>
      <RouterProvider router={router} />
    </Theme>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
