import '@radix-ui/themes/styles.css'
import { Theme } from '@radix-ui/themes'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { router } from './app/router'
import { startSession } from './session/session'

startSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme appearance="dark">
      <RouterProvider router={router} />
    </Theme>
  </StrictMode>,
)
