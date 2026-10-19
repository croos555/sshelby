import { dialog, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { notifyVaultChanged, store } from './store'
import { decrypt, encrypt, parseEnvelope, Payload } from './envelope'

// Encrypted, selective export of hosts/groups so they can be moved to another machine.
// File = JSON envelope; payload is AES-256-GCM with a key derived from the passphrase by scrypt.

export interface ExportSelection {
  groupIds: string[]
  hostIds: string[]
  includeForwards: boolean
  // SSH keys and identities are left out unless explicitly requested
  includeCredentials?: boolean
}

export interface ImportSummary {
  created: number
  updated: number
  detail: Record<string, { created: number; updated: number }>
}

// Expand the user's selection into everything those hosts need to work elsewhere
function collect(sel: ExportSelection): Payload {
  const v = store.get()
  const groupIds = new Set<string>()
  const hostIds = new Set<string>(sel.hostIds)

  // Selected groups bring their whole subtree
  const addSubtree = (gid: string) => {
    if (groupIds.has(gid)) return
    groupIds.add(gid)
    for (const g of v.groups) if (g.parentId === gid) addSubtree(g.id)
    for (const h of v.hosts) if (h.groupId === gid) hostIds.add(h.id)
  }
  sel.groupIds.forEach(addSubtree)

  // Jump hosts referenced by hosts or groups, transitively
  let grew = true
  while (grew) {
    grew = false
    const refs = [
      ...v.hosts.filter((h) => hostIds.has(h.id)).map((h) => h.jumpHostId),
      ...v.groups.filter((g) => groupIds.has(g.id)).map((g) => g.jumpHostId)
    ]
    for (const id of refs)
      if (id && !hostIds.has(id) && v.hosts.some((h) => h.id === id)) {
        hostIds.add(id)
        grew = true
      }
    // Ancestors keep the tree shape and the credentials hosts inherit
    for (const h of v.hosts) if (hostIds.has(h.id)) addAncestors(h.groupId)
    for (const g of [...groupIds]) addAncestors(v.groups.find((x) => x.id === g)?.parentId)
  }
  function addAncestors(gid?: string | null) {
    while (gid && !groupIds.has(gid)) {
      const g = v.groups.find((x) => x.id === gid)
      if (!g) return
      groupIds.add(gid)
      grew = true
      gid = g.parentId
    }
  }

  const hosts = v.hosts.filter((h) => hostIds.has(h.id))
  const groups = v.groups.filter((g) => groupIds.has(g.id))
  const identityIds = new Set([...hosts, ...groups].map((x) => x.identityId).filter(Boolean) as string[])
  const identities = v.identities.filter((i) => identityIds.has(i.id))
  const keyIds = new Set([...hosts, ...groups, ...identities].map((x) => x.keyId).filter(Boolean) as string[])
  const snippetIds = new Set(hosts.map((h) => h.startupSnippetId).filter(Boolean) as string[])
  const addrs = new Set(hosts.map((h) => h.address))
  return {
    exportedAt: Date.now(),
    groups,
    hosts,
    keys: sel.includeCredentials ? v.keys.filter((k) => keyIds.has(k.id)) : [],
    identities: sel.includeCredentials ? identities : [],
    snippets: v.snippets.filter((s) => snippetIds.has(s.id)),
    forwards: sel.includeForwards ? v.forwards.filter((f) => hostIds.has(f.hostId)) : [],
    knownHosts: v.knownHosts.filter((k) => addrs.has(k.host))
  }
}

// Merge into the local vault, remapping ids and matching existing items so re-imports update instead of duplicating
function merge(p: Payload): ImportSummary {
  const v = store.get()
  const detail: ImportSummary['detail'] = {}
  const count = (col: string, created: boolean) => {
    detail[col] ||= { created: 0, updated: 0 }
    detail[col][created ? 'created' : 'updated']++
  }
  const keyMap = new Map<string, string>()
  const groupMap = new Map<string, string>()
  const hostMap = new Map<string, string>()
  const snippetMap = new Map<string, string>()

  for (const k of p.keys || []) {
    const existing = v.keys.find((x) => x.fingerprint === k.fingerprint)
    const saved = store.upsert('keys', { ...k, id: existing?.id || randomUUID() })
    keyMap.set(k.id, saved.id)
    count('keys', !existing)
  }

  const identityMap = new Map<string, string>()
  for (const i of p.identities || []) {
    const existing = v.identities.find((x) => x.label === i.label && x.username === i.username)
    const saved = store.upsert('identities', {
      ...i,
      id: existing?.id || randomUUID(),
      keyId: i.keyId ? keyMap.get(i.keyId) || null : null
    })
    identityMap.set(i.id, saved.id)
    count('identities', !existing)
  }

  for (const s of p.snippets || []) {
    const existing = v.snippets.find((x) => x.label === s.label && x.script === s.script)
    const saved = existing || store.upsert('snippets', { ...s, id: randomUUID() })
    snippetMap.set(s.id, saved.id)
    if (!existing) count('snippets', true)
  }

  // Parents before children so parent ids are already mapped
  const pending = [...(p.groups || [])]
  const placed = new Set<string>()
  while (pending.length) {
    const idx = pending.findIndex((g) => !g.parentId || placed.has(g.parentId) || !p.groups.some((x) => x.id === g.parentId))
    const g = pending.splice(idx === -1 ? 0 : idx, 1)[0]
    const parentId = g.parentId ? groupMap.get(g.parentId) || null : null
    const existing = v.groups.find((x) => x.name === g.name && (x.parentId || null) === parentId)
    groupMap.set(g.id, existing?.id || randomUUID())
    placed.add(g.id)
  }

  // Hosts get ids first so jump-host references can be remapped
  for (const h of p.hosts || []) {
    const existing = v.hosts.find(
      (x) => x.address === h.address && (x.username || '') === (h.username || '') && (x.label || '') === (h.label || '') && (x.port || 22) === (h.port || 22)
    )
    hostMap.set(h.id, existing?.id || randomUUID())
  }

  for (const g of p.groups || []) {
    const id = groupMap.get(g.id)!
    const existed = v.groups.some((x) => x.id === id)
    store.upsert('groups', {
      ...g,
      id,
      parentId: g.parentId ? groupMap.get(g.parentId) || null : null,
      keyId: g.keyId ? keyMap.get(g.keyId) || null : null,
      identityId: g.identityId ? identityMap.get(g.identityId) || null : null,
      jumpHostId: g.jumpHostId ? hostMap.get(g.jumpHostId) || null : null
    })
    count('groups', !existed)
  }

  for (const h of p.hosts || []) {
    const id = hostMap.get(h.id)!
    const existed = v.hosts.some((x) => x.id === id)
    store.upsert('hosts', {
      ...h,
      id,
      groupId: h.groupId ? groupMap.get(h.groupId) || null : null,
      keyId: h.keyId ? keyMap.get(h.keyId) || null : null,
      identityId: h.identityId ? identityMap.get(h.identityId) || null : null,
      jumpHostId: h.jumpHostId ? hostMap.get(h.jumpHostId) || null : null,
      startupSnippetId: h.startupSnippetId ? snippetMap.get(h.startupSnippetId) || null : null,
      lastConnectedAt: undefined
    })
    count('hosts', !existed)
  }

  for (const f of p.forwards || []) {
    const hostId = hostMap.get(f.hostId)
    if (!hostId) continue
    const existing = v.forwards.find(
      (x) => x.hostId === hostId && x.type === f.type && x.bindPort === f.bindPort && (x.bindAddress || '') === (f.bindAddress || '')
    )
    store.upsert('forwards', { ...f, id: existing?.id || randomUUID(), hostId, autoStart: false })
    count('forwards', !existing)
  }

  for (const k of p.knownHosts || []) {
    const existing = v.knownHosts.find((x) => x.host === k.host && x.port === k.port)
    // Never silently replace a fingerprint this machine already trusts
    if (existing) continue
    store.upsert('knownHosts', { ...k, id: randomUUID() })
    count('knownHosts', true)
  }

  const all = Object.values(detail)
  return {
    created: all.reduce((n, d) => n + d.created, 0),
    updated: all.reduce((n, d) => n + d.updated, 0),
    detail
  }
}

ipcMain.handle('transfer:preview', (_e, sel: ExportSelection) => {
  const p = collect(sel)
  return {
    groups: p.groups.length,
    hosts: p.hosts.length,
    keys: p.keys.length,
    identities: p.identities?.length || 0,
    snippets: p.snippets.length,
    forwards: p.forwards.length,
    knownHosts: p.knownHosts.length
  }
})

ipcMain.handle('transfer:export', async (_e, sel: ExportSelection, passphrase: string) => {
  if (!passphrase || passphrase.length < 8) throw new Error('The key must be at least 8 characters')
  const payload = collect(sel)
  if (!payload.hosts.length && !payload.groups.length) throw new Error('Nothing selected')
  const date = new Date().toISOString().slice(0, 10)
  const res = await dialog.showSaveDialog({
    title: 'Export hosts',
    defaultPath: `sshelby-export-${date}.sshelby`,
    filters: [{ name: 'Sshelby export', extensions: ['sshelby'] }]
  })
  if (res.canceled || !res.filePath) return false
  writeFileSync(res.filePath, JSON.stringify(await encrypt(payload, passphrase)), { mode: 0o600 })
  return true
})

ipcMain.handle('transfer:pickImport', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Import hosts',
    filters: [{ name: 'Sshelby export', extensions: ['sshelby', 'json'] }],
    properties: ['openFile']
  })
  if (res.canceled || !res.filePaths[0]) return null
  parseEnvelope(readFileSync(res.filePaths[0], 'utf8'))
  return res.filePaths[0]
})

// Decrypt only, so the UI can show what will be imported before merging
ipcMain.handle('transfer:inspect', async (_e, path: string, passphrase: string) => {
  const p = await decrypt(parseEnvelope(readFileSync(path, 'utf8')), passphrase)
  return {
    exportedAt: p.exportedAt,
    groups: (p.groups || []).map((g) => g.name),
    hosts: (p.hosts || []).map((h) => h.label || h.address),
    keys: (p.keys || []).length,
    identities: (p.identities || []).length,
    snippets: (p.snippets || []).length,
    forwards: (p.forwards || []).length,
    knownHosts: (p.knownHosts || []).length
  }
})

ipcMain.handle('transfer:import', async (_e, path: string, passphrase: string) => {
  const p = await decrypt(parseEnvelope(readFileSync(path, 'utf8')), passphrase)
  const summary = merge(p)
  notifyVaultChanged()
  return summary
})
