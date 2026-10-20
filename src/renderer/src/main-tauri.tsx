// Entry of the Tauri build: install window.api, then start the same app as the Electron build
import { invoke } from '@tauri-apps/api/core'
import './tauri-api'
import './main'

// Once the UI listens for prompts, forwards set to auto-start may ask for host keys / passwords
setTimeout(() => void invoke('app_ready'), 1000)
