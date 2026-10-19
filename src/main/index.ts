import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { Collection, Settings } from '@shared/types'
import { store } from './store'
import { generateKey, inspectKey } from './keys'
import { connectHost } from './connect'
import { closeAllSessions } from './sessions'
import { closeAllSftp } from './sftp'
import { autoStartForwards, stopAllForwards } from './forwards'
import icon from '../../build/icon.png?asset'
import './prompts'
import { handOff, showSplash } from './splash'
import './transfer'
import './agent'
import './mobaxterm'

function createWindow(splash?: BrowserWindow) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#14161d',
    title: 'Sshelby',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    // Windows/macOS take the icon from the packaged app; Linux needs it on the window
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  if (splash) handOff(splash, win)
  else win.once('ready-to-show', () => win.show())
  // Auto-start forwards once the UI can answer host-key / password prompts
  win.webContents.once('did-finish-load', autoStartForwards)
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// ---------- vault ----------

ipcMain.handle('vault:get', () => store.get())
ipcMain.handle('vault:upsert', (_e, col: Collection, item: any) => store.upsert(col, item))
ipcMain.handle('vault:remove', (_e, col: Collection, id: string) => store.remove(col, id))
ipcMain.handle('vault:settings', (_e, patch: Partial<Settings>) => store.updateSettings(patch))

ipcMain.handle('vault:storageInfo', () => ({
  encrypted: safeStorage.isEncryptionAvailable(),
  backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'darwin' ? 'keychain' : 'dpapi'
}))

// Import Host entries from ~/.ssh/config (wildcard patterns are skipped)
ipcMain.handle('vault:importSshConfig', () => {
  const file = join(homedir(), '.ssh', 'config')
  if (!existsSync(file)) throw new Error('~/.ssh/config not found')
  const blocks: Record<string, string>[] = []
  let cur: Record<string, string> | null = null
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^(\S+)\s*=?\s*(.+)$/)
    if (!m) continue
    const k = m[1].toLowerCase()
    const v = m[2].replace(/^"|"$/g, '')
    if (k === 'host') {
      cur = null
      for (const alias of v.split(/\s+/)) {
        if (/[*?!]/.test(alias)) continue
        cur = { host: alias }
        blocks.push(cur)
        break
      }
    } else if (k === 'match') {
      cur = null
    } else if (cur) {
      cur[k] = v
    }
  }

  const vault = store.get()
  let imported = 0
  for (const b of blocks) {
    let keyId: string | null = null
    if (b.identityfile) {
      const path = b.identityfile.replace(/^~/, homedir())
      try {
        const info = inspectKey(readFileSync(path, 'utf8'))
        const existing = vault.keys.find((k) => k.fingerprint === info.fingerprint)
        keyId = existing ? existing.id : store.upsert('keys', { label: path.split(/[\\/]/).pop(), ...info }).id
      } catch {
        // encrypted or unreadable key: leave it to the user
      }
    }
    const address = b.hostname || b.host
    if (vault.hosts.some((h) => h.label === b.host && h.address === address)) continue
    store.upsert('hosts', {
      label: b.host,
      address,
      port: b.port ? Number(b.port) : undefined,
      username: b.user,
      keyId,
      tags: ['ssh-config']
    })
    imported++
  }
  return imported
})

// ---------- keys ----------

ipcMain.handle('keys:generate', (_e, type: 'ed25519' | 'rsa' | 'ecdsa', opts: any) => generateKey(type, opts))
ipcMain.handle('keys:inspect', (_e, privateKey: string, passphrase?: string) => inspectKey(privateKey, passphrase))
ipcMain.handle('keys:installOnHost', async (_e, keyId: string, hostId: string) => {
  const key = store.get().keys.find((k) => k.id === keyId)
  if (!key) throw new Error('Key not found')
  const pub = key.publicKey.trim().replace(/'/g, '')
  const conn = await connectHost(hostId)
  try {
    // Idempotent: only append when the key is not already present
    const cmd =
      `umask 077; mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && ` +
      `(grep -qxF '${pub}' ~/.ssh/authorized_keys || echo '${pub}' >> ~/.ssh/authorized_keys)`
    await new Promise<void>((resolve, reject) =>
      conn.client.exec(cmd, (err, ch) => {
        if (err) return reject(err)
        let stderr = ''
        ch.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
        ch.on('data', () => {})
        ch.on('close', (code: number) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `exit ${code}`))))
      })
    )
  } finally {
    conn.close()
  }
})
ipcMain.handle('keys:pickFile', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Import private key',
    defaultPath: join(homedir(), '.ssh'),
    properties: ['openFile', 'showHiddenFiles']
  })
  if (res.canceled || !res.filePaths[0]) return null
  return { name: res.filePaths[0].split(/[\\/]/).pop(), content: readFileSync(res.filePaths[0], 'utf8') }
})
ipcMain.handle('keys:savePublic', async (_e, name: string, content: string) => {
  const res = await dialog.showSaveDialog({ defaultPath: name + '.pub' })
  if (res.canceled || !res.filePath) return false
  writeFileSync(res.filePath, content)
  return true
})

ipcMain.handle('dialog:pickFiles', async (_e, dirs: boolean) => {
  const res = await dialog.showOpenDialog({
    properties: dirs ? ['openDirectory'] : ['openFile', 'multiSelections']
  })
  return res.canceled ? [] : res.filePaths
})

// ---------- lifecycle ----------

// One instance only: a second launch brings back (or reopens) the window of the running one
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return createWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

app.whenReady().then(() => {
  // Packaged builds have the bundle icon; show it in the Dock during development too
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon)
  const splash = showSplash()
  store.load()
  createWindow(splash)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  closeAllSessions()
  closeAllSftp()
  stopAllForwards()
})

// Closing the window quits, on macOS too, unless the user wants port forwards to keep running in the background
app.on('window-all-closed', () => {
  if (!store.get().settings.keepRunningInBackground) app.quit()
})
