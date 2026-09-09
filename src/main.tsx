import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyViewportClasses } from './orientation'
import './index.css'

applyViewportClasses()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
