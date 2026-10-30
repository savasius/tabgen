import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { diag } from './lib/diag'
import { watchForUpdates } from './lib/update'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

watchForUpdates()
diag(`open ${navigator.userAgent.match(/(iPhone OS [\d_]+|Mac OS X [\d_]+|Android [\d.]+)/)?.[0] ?? ''} standalone=${matchMedia('(display-mode: standalone)').matches}`)
