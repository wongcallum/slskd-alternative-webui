// A colour scale used in a `color` prop or a variable has to be imported here, or it shows uncoloured. They go before
// base.css, as in tokens.css, so its mapping of gray onto slate wins over gray.css's own scale on .light and .dark.
import '@radix-ui/themes/tokens/colors/gray.css'
import '@radix-ui/themes/tokens/colors/slate.css'
import '@radix-ui/themes/tokens/colors/indigo.css'
import '@radix-ui/themes/tokens/colors/blue.css'
import '@radix-ui/themes/tokens/colors/teal.css'
import '@radix-ui/themes/tokens/colors/green.css'
import '@radix-ui/themes/tokens/colors/amber.css'
import '@radix-ui/themes/tokens/colors/orange.css'
import '@radix-ui/themes/tokens/colors/red.css'
import '@radix-ui/themes/tokens/base.css'
import '@radix-ui/themes/components.css'
import '@radix-ui/themes/utilities.css'
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
