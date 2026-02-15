// Mark that module loading has started
if (window.__BOOT) window.__BOOT.mark('js', true);

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Create React root
try {
  const root = createRoot(document.getElementById('root'))
  if (window.__BOOT) window.__BOOT.mark('react-root', true);
  
  // Render the app
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (err) {
  if (window.__BOOT) {
    window.__BOOT.mark('react-root', false, err.message);
    window.__BOOT.error('React root creation failed', err.stack);
  }
  throw err;
}
