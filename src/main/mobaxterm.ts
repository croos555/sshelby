import { dialog, ipcMain } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { decodeMobaFile, parseMobaXterm } from './mobaxterm-core'
import { inspectKey } from './keys'
import { notifyVaultChanged, store } from './store'

export interface MobaImportSummary {
  hosts: number
  updated: number
  groups: number
  jumpHosts: number
  keys: number
  keysMissing: number
  skipped: { name: string; kind: string }[]
}

// MobaXterm stores key paths Windows-style, often relative to its profile folder.
// Try the same file name in ~/.ssh as a best effort.
function findKey(path: string): string | null {
  const name = path.split(/[\\/]/).pop()
  if (!name) return null
  const candidates = [path, join(homedir(), '.ssh', name)]
  return candidates.find((p) => !/^[A-Za-z]:|^_ProfileDir_/.test(p) && existsSync(p)) || null
}

function importMoba(text: string): MobaImportSummary {
  const { sessions, skipped } = parseMobaXterm(text)
  const v = store.get()
  const sum: MobaImportSummary = { hosts: 0, updated: 0, groups: 0, jumpHosts: 0, keys: 0, keysMissing: 0, skipped }

  const groupFor = (path: string[]): string | null => {
    let parent: string | null = null
    for (const name of path) {
      const existing = v.groups.find((g) => g.name === name && (g.parentId || null) === parent)
      if (existing) parent = existing.id
      else {
        parent = store.upsert('groups', { name, parentId: parent }).id
        sum.groups++
      }
    }
    return parent
  }

  const findHost = (address: string, port?: number, username?: string) =>
    v.hosts.find(
      (h) => h.address === address && (h.port || 22) === (port || 22) && (!username || (h.username || '') === username)
    )

  const keyFor = (path?: string): string | null => {
    if (!path) return null
    const file = findKey(path)
    if (!file) {
      sum.keysMissing++
      return null
    }
    try {
      const info = inspectKey(readFileSync(file, 'utf8'))
      const existing = v.keys.find((k) => k.fingerprint === info.fingerprint)
      if (existing) return existing.id
      sum.keys++
      return store.upsert('keys', { label: file.split('/').pop(), ...info }).id
    } catch {
      // encrypted or unreadable: the user sets the key on the host
      sum.keysMissing++
      return null
    }
  }

  for (const s of sessions) {
    let jumpHostId: string | null = null
    if (s.gateway) {
      const gw = findHost(s.gateway.host, s.gateway.port, s.gateway.username)
      jumpHostId =
        gw?.id ||
        store.upsert('hosts', {
          label: s.gateway.host,
          address: s.gateway.host,
          port: s.gateway.port && s.gateway.port !== 22 ? s.gateway.port : undefined,
          username: s.gateway.username,
          tags: ['mobaxterm', 'gateway'],
          groupId: null
        }).id
      if (!gw) sum.jumpHosts++
    }
    const groupId = groupFor(s.folder)
    const fields = {
      label: s.name,
      address: s.host,
      port: s.port && s.port !== 22 ? s.port : undefined,
      username: s.username,
      groupId,
      jumpHostId,
      keyId: keyFor(s.keyPath)
    }
    const existing = v.hosts.find((h) => h.label === s.name && h.address === s.host)
    if (existing) {
      store.upsert('hosts', { ...existing, ...fields, keyId: fields.keyId || existing.keyId })
      sum.updated++
    } else {
      store.upsert('hosts', { ...fields, tags: ['mobaxterm'] })
      sum.hosts++
    }
  }
  return sum
}

ipcMain.handle('vault:importMobaXterm', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Import MobaXterm sessions',
    message: 'Choose a MobaXterm sessions export (.mxtsessions) or MobaXterm.ini',
    filters: [{ name: 'MobaXterm sessions', extensions: ['mxtsessions', 'ini'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return null
  const summary = importMoba(decodeMobaFile(readFileSync(res.filePaths[0])))
  if (!summary.hosts && !summary.updated && !summary.skipped.length) throw new Error('No MobaXterm sessions found in this file')
  notifyVaultChanged()
  return summary
})
