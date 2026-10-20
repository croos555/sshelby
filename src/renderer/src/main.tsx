import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
// Installs window.api before the app reads it
import './tauri-api'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)

// After the first paint (and the effects that subscribe to prompts): show the main window in place
// of the splash, and let forwards set to auto-start ask for host keys / passwords
requestAnimationFrame(() => setTimeout(() => void invoke('app_ready'), 0))
