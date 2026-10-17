import { dialog, ipcMain } from 'electron'
import { readFileSync } from 'fs'
import type { Kdbx } from 'kdbxweb'
import { entryCredentials, KeepassEntryInfo, listEntries, openKdbx } from './keepass-core'
import { notifyVaultChanged, store } from './store'
import { askSecretEx } from './prompts'

// Unlocked databases stay in memory for a while so connecting doesn't ask for the master password every time
const LOCK_AFTER_MS = 30 * 60 * 1000

interface Open {
  db: Kdbx
  timer: ReturnType<typeof setTimeout>
}

const unlocked = new Map<string, Open>()

function remember(id: string, db: Kdbx) {
  const prev = unlocked.get(id)
  if (prev) clearTimeout(prev.timer)
  unlocked.set(id, { db, timer: setTimeout(() => lock(id), LOCK_AFTER_MS) })
}

export function lock(id: string) {
  const o = unlocked.get(id)
  if (o) clearTimeout(o.timer)
  unlocked.delete(id)
}

export function lockAll() {
  for (const id of [...unlocked.keys()]) lock(id)
}

// Returns the opened database, asking for the master password when it isn't cached or saved
async function unlock(id: string): Promise<Kdbx> {
  const cached = unlocked.get(id)
  if (cached) {
    remember(id, cached.db)
    return cached.db
  }
  const cfg = store.get().keepass.find((k) => k.id === id)
  if (!cfg) throw new Error('KeePass database not found; check the identity’s settings')
  let data: Uint8Array
  let keyFile: Uint8Array | undefined
  try {
    data = readFileSync(cfg.path)
  } catch {
    throw new Error(`Cannot read KeePass file: ${cfg.path}`)
  }
  if (cfg.keyFilePath) {
    try {
      keyFile = readFileSync(cfg.keyFilePath)
    } catch {
      throw new Error(`Cannot read key file: ${cfg.keyFilePath}`)
    }
  }

  if (cfg.masterPassword) {
    try {
      const db = await openKdbx(data, cfg.masterPassword, keyFile)
      remember(id, db)
      return db
    } catch {
      // Saved password no longer valid (changed in KeePass): forget it and ask
      store.upsert('keepass', { ...cfg, masterPassword: '' })
      notifyVaultChanged()
    }
  }

  let message = `Master password for “${cfg.label}”`
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, save } = await askSecretEx('Unlock KeePass', message, true, 'Remember (encrypted with the OS keychain)')
    if (value === null) throw new Error('KeePass unlock cancelled')
    try {
      const db = await openKdbx(data, value, keyFile)
      remember(id, db)
      if (save) {
        store.upsert('keepass', { ...cfg, masterPassword: value })
        notifyVaultChanged()
      }
      return db
    } catch (err: any) {
      message = `${err.message}. Try again.`
    }
  }
  throw new Error('Could not unlock KeePass database')
}

export async function keepassCredentials(dbId: string, entryUuid: string) {
  return entryCredentials(await unlock(dbId), entryUuid)
}

ipcMain.handle('keepass:entries', async (_e, id: string): Promise<KeepassEntryInfo[]> => listEntries(await unlock(id)))
ipcMain.handle('keepass:lock', (_e, id: string) => lock(id))
ipcMain.handle('keepass:isUnlocked', (_e, id: string) => unlocked.has(id))
ipcMain.handle('keepass:pickFile', async (_e, kind: 'db' | 'key') => {
  const res = await dialog.showOpenDialog({
    title: kind === 'db' ? 'Choose KeePass database' : 'Choose key file',
    filters: kind === 'db' ? [{ name: 'KeePass database', extensions: ['kdbx'] }] : undefined,
    properties: ['openFile']
  })
  return res.canceled ? null : res.filePaths[0]
})
