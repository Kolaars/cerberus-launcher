import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/pages.css'

const container = document.getElementById('root')
if (!container) throw new Error('Корневой элемент #root не найден.')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
