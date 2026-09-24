import '@radix-ui/themes/styles.css'
import { Theme } from '@radix-ui/themes'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Home } from './Home'
import { SessionGate } from './SessionGate'
import { startSession } from './session'

startSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme>
      <SessionGate>
        <Home />
      </SessionGate>
    </Theme>
  </StrictMode>,
)
