import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import UserApp from './user-app'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <UserApp />
  </StrictMode>
)