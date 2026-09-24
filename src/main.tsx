import '@radix-ui/themes/styles.css'
import { Theme } from '@radix-ui/themes'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Hello } from './Hello'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme>
      <Hello />
    </Theme>
  </StrictMode>,
)
