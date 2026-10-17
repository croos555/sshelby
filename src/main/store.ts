import { app, BrowserWindow, safeStorage } from 'electron'
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import { Collection, DEFAULT_SETTINGS, Settings, Vault } from '@shared/types'

// Fields that hold secrets, per collection. They are encrypted at rest.
const SECRET_FIELDS: Partial<Record<Collection, string[]>> = {
  hosts: ['password'],
  groups: ['password'],
  keys: ['privateKey', 'passphrase']
}

const ENC_PREFIX = 'enc:v1:'

function encrypt(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return value
  return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string {
  if (typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}

function emptyVault(): Vault {
  return {
    version: 1,
    groups: [],
    hosts: [],
    keys: [],
    forwards: [],
    snippets: [],
    knownHosts: [],
    settings: { ...DEFAULT_SETTINGS }
  }
}

function mapSecrets(vault: Vault, fn: (v: string) => string): Vault {
  const out: Vault = { ...vault }
  for (const [col, fields] of Object.entries(SECRET_FIELDS) as [Collection, string[]][]) {
    ;(out as any)[col] = (vault[col] as any[]).map((item) => {
      const copy = { ...item }
      for (const f of fields) if (copy[f]) copy[f] = fn(copy[f])
      return copy
    })
  }
  return out
}

class Store {
  private vault: Vault = emptyVault()
  private file = ''

  load(): void {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'vault.json')
    // The app used to be called Termcraft: carry its vault over on first launch
    const legacy = join(dirname(dir), 'termcraft', 'vault.json')
    if (!existsSync(this.file) && existsSync(legacy)) copyFileSync(legacy, this.file)
    if (!existsSync(this.file)) {
      this.save()
      return
    }
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8'))
      const base = emptyVault()
      this.vault = mapSecrets(
        { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } },
        decrypt
      )
      this.vault.settings.theme = this.vault.settings.theme.replace(/^termcraft-/, 'sshelby-')
    } catch (err) {
      // Keep the unreadable file around rather than silently overwriting it
      renameSync(this.file, this.file + '.corrupt-' + Date.now())
      this.vault = emptyVault()
      this.save()
    }
  }

  private save(): void {
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(mapSecrets(this.vault, encrypt), null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  get(): Vault {
    return this.vault
  }

  upsert<T extends { id?: string; [k: string]: any }>(col: Collection, item: T): T & { id: string } {
    const list = this.vault[col] as any[]
    const id = item.id || randomUUID()
    const idx = list.findIndex((x) => x.id === id)
    const next = { createdAt: Date.now(), ...item, id }
    if (idx >= 0) list[idx] = { ...list[idx], ...next }
    else list.push(next)
    this.save()
    return next
  }

  remove(col: Collection, id: string): void {
    const removed = (this.vault[col] as any[]).find((x) => x.id === id)
    ;(this.vault as any)[col] = (this.vault[col] as any[]).filter((x) => x.id !== id)
    if (col === 'groups') {
      // Orphaned hosts and subgroups move up to the deleted group's parent
      const parent = removed?.parentId ?? null
      for (const h of this.vault.hosts) if (h.groupId === id) h.groupId = parent
      for (const g of this.vault.groups) if (g.parentId === id) g.parentId = parent
    }
    if (col === 'keys') {
      for (const h of this.vault.hosts) if (h.keyId === id) h.keyId = null
      for (const g of this.vault.groups) if (g.keyId === id) g.keyId = null
    }
    if (col === 'hosts') {
      this.vault.forwards = this.vault.forwards.filter((f) => f.hostId !== id)
      for (const h of this.vault.hosts) if (h.jumpHostId === id) h.jumpHostId = null
      for (const g of this.vault.groups) if (g.jumpHostId === id) g.jumpHostId = null
    }
    this.save()
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.vault.settings = { ...this.vault.settings, ...patch }
    this.save()
    return this.vault.settings
  }

  touchHost(id: string): void {
    const h = this.vault.hosts.find((x) => x.id === id)
    if (h) {
      h.lastConnectedAt = Date.now()
      this.save()
    }
  }

  exportPlain(): string {
    return JSON.stringify(this.vault, null, 2)
  }

  importPlain(json: string): void {
    const raw = JSON.parse(json)
    const base = emptyVault()
    this.vault = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } }
    this.save()
  }
}

export const store = new Store()

// Tell renderers to reload when the main process changes the vault on its own
export function notifyVaultChanged() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('vault:changed')
}
