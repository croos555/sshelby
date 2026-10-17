import { useEffect, useState } from 'react'
import {
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileUp,
  IdCard,
  KeyRound,
  Lock,
  LockOpen,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
  User
} from 'lucide-react'
import type { Identity, KeepassDb, SshKey } from '@shared/types'
import { errMsg, useStore } from '../store'
import { confirmDialog, ContextMenu, Empty, Field, Panel, Segmented, Select, useMenu } from '../components/ui'

export default function KeychainView() {
  const { vault, editing, setEditing, remove } = useStore()
  const { menu, open, close } = useMenu()
  if (!vault) return null
  const selectedId =
    editing?.kind === 'key' || editing?.kind === 'identity' || editing?.kind === 'keepass' ? editing.item.id : undefined
  const usage = (id: string) =>
    vault.hosts.filter((h) => h.identityId === id).length + vault.groups.filter((g) => g.identityId === id).length

  return (
    <div className="main">
      <div className="toolbar">
        <button className="btn soft" onClick={() => setEditing({ kind: 'key', item: {} })}>
          <Plus size={15} /> New key
        </button>
        <button className="btn" onClick={() => setEditing({ kind: 'key', item: { label: '', privateKey: '' } })}>
          <Upload size={15} /> Import key
        </button>
        <button className="btn" onClick={() => setEditing({ kind: 'identity', item: { authType: 'password' } })}>
          <IdCard size={15} /> New identity
        </button>
        <button className="btn" onClick={() => setEditing({ kind: 'keepass', item: {} })}>
          <Database size={15} /> Add KeePass
        </button>
      </div>
      <div className="content" onClick={() => setEditing(null)}>
        {vault.identities.length > 0 && (
          <>
            <div className="section-title">Identities</div>
            <div className="grid">
              {vault.identities.map((i) => (
                <div
                  key={i.id}
                  className={`card ${selectedId === i.id ? 'selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditing({ kind: 'identity', item: i })
                  }}
                  onContextMenu={(e) =>
                    open(e, [
                      {
                        label: 'Delete',
                        icon: Trash2,
                        danger: true,
                        onClick: async () => {
                          const n = usage(i.id)
                          if (
                            await confirmDialog({
                              title: 'Delete identity',
                              message: `Delete "${i.label}"?${n ? ` ${n} host(s)/group(s) use it and will lose these credentials.` : ''}`,
                              danger: true,
                              confirm: 'Delete'
                            })
                          )
                            remove('identities', i.id)
                        }
                      }
                    ])
                  }
                >
                  <div className="icon-tile" style={{ background: '#2f6f8f' }}>
                    <IdCard size={18} />
                  </div>
                  <div className="meta">
                    <div className="name">{i.label}</div>
                    <div className="sub">
                      {i.authType === 'keepass'
                        ? `KeePass · ${i.keepassEntryLabel || 'no entry'}`
                        : `${i.username} · ${i.authType === 'key' ? 'SSH key' : 'password'}`}
                      {usage(i.id) ? ` · used by ${usage(i.id)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {vault.keepass.length > 0 && (
          <>
            <div className="section-title">KeePass databases</div>
            <div className="grid">
              {vault.keepass.map((k) => (
                <div
                  key={k.id}
                  className={`card ${selectedId === k.id ? 'selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditing({ kind: 'keepass', item: k })
                  }}
                >
                  <div className="icon-tile" style={{ background: '#4d7a3a' }}>
                    <Database size={18} />
                  </div>
                  <div className="meta">
                    <div className="name">{k.label}</div>
                    <div className="sub" title={k.path}>
                      {k.path.split(/[\\/]/).pop()}
                      {k.masterPassword ? ' · password saved' : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {vault.keys.length === 0 && vault.identities.length === 0 && vault.keepass.length === 0 ? (
          <Empty
            icon={KeyRound}
            title="Add credentials"
            text="Create identities (username + password or key) to reuse across hosts, and generate or import SSH keys."
            action={
              <button
                className="btn primary"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditing({ kind: 'key', item: {} })
                }}
              >
                <Plus size={15} /> New key
              </button>
            }
          />
        ) : vault.keys.length === 0 ? null : (
          <>
            <div className="section-title">Keys</div>
            <div className="grid">
              {vault.keys.map((k) => (
                <div
                  key={k.id}
                  className={`card ${selectedId === k.id ? 'selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditing({ kind: 'key', item: k })
                  }}
                  onContextMenu={(e) =>
                    open(e, [
                      {
                        label: 'Copy public key',
                        icon: Copy,
                        onClick: () => navigator.clipboard.writeText(k.publicKey)
                      },
                      '-',
                      {
                        label: 'Delete',
                        icon: Trash2,
                        danger: true,
                        onClick: async () => {
                          if (
                            await confirmDialog({
                              title: 'Delete key',
                              message: `Delete "${k.label}"? Hosts using it will lose this credential.`,
                              danger: true,
                              confirm: 'Delete'
                            })
                          )
                            remove('keys', k.id)
                        }
                      }
                    ])
                  }
                >
                  <div className="icon-tile" style={{ background: '#5a6274' }}>
                    <KeyRound size={18} />
                  </div>
                  <div className="meta">
                    <div className="name">{k.label}</div>
                    <div className="sub">
                      {k.type.toUpperCase()} · {k.fingerprint.slice(0, 22)}…
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  )
}

export function KeyEditor({ initial }: { initial: Partial<SshKey> }) {
  const { vault, upsert, remove, setEditing, notify } = useStore()
  const isNew = !initial.id
  const [mode, setMode] = useState<'generate' | 'import'>(initial.privateKey !== undefined ? 'import' : 'generate')
  const [k, setK] = useState<Partial<SshKey>>(initial)
  const [genType, setGenType] = useState<'ed25519' | 'rsa' | 'ecdsa'>('ed25519')
  const [bits, setBits] = useState(4096)
  const [showPriv, setShowPriv] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [installHost, setInstallHost] = useState<string | null>(null)
  useEffect(() => setK(initial), [initial])
  if (!vault) return null
  const set = (patch: Partial<SshKey>) => setK((x) => ({ ...x, ...patch }))
  const close = () => setEditing(null)

  const generate = async () => {
    setBusy(true)
    try {
      const info = await window.api.keys.generate(genType, {
        bits: genType === 'rsa' ? bits : genType === 'ecdsa' ? 256 : undefined,
        comment: k.label || 'sshelby',
        passphrase: k.passphrase || undefined
      })
      const saved = await upsert('keys', { label: k.label?.trim() || `${genType} key`, passphrase: k.passphrase, ...info })
      setEditing({ kind: 'key', item: saved })
      notify('Key generated')
    } catch (err) {
      notify(errMsg(err), true)
    } finally {
      setBusy(false)
    }
  }

  const importKey = async () => {
    if (!k.privateKey?.trim()) return notify('Paste a private key or choose a file', true)
    try {
      const info = await window.api.keys.inspect(k.privateKey, k.passphrase || undefined)
      const dup = vault.keys.find((x) => x.fingerprint === info.fingerprint && x.id !== k.id)
      if (dup) return notify(`This key already exists as "${dup.label}"`, true)
      const saved = await upsert('keys', { ...k, label: k.label?.trim() || 'Imported key', ...info })
      setEditing({ kind: 'key', item: saved })
      notify('Key saved')
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const pickFile = async () => {
    const f = await window.api.keys.pickFile()
    if (f) set({ privateKey: f.content, label: k.label || f.name })
  }

  const saveExisting = async () => {
    await upsert('keys', k)
    notify('Key saved')
  }

  const install = async () => {
    if (!installHost || !k.id) return
    setBusy(true)
    try {
      await window.api.keys.installOnHost(k.id, installHost)
      notify('Public key added to authorized_keys')
    } catch (err) {
      notify(errMsg(err), true)
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!k.id) return
    if (await confirmDialog({ title: 'Delete key', message: `Delete "${k.label}"?`, danger: true, confirm: 'Delete' })) {
      await remove('keys', k.id)
      close()
    }
  }

  const passField = (
    <label className="input">
      <Lock size={15} />
      <input
        type={showPass ? 'text' : 'password'}
        value={k.passphrase ?? ''}
        placeholder="Passphrase (optional)"
        onChange={(e) => set({ passphrase: e.target.value })}
      />
      <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setShowPass(!showPass)}>
        {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </label>
  )

  if (isNew) {
    return (
      <Panel
        title="New Key"
        onClose={close}
        footer={
          <button className="btn primary block" disabled={busy} onClick={mode === 'generate' ? generate : importKey}>
            {busy ? 'Generating…' : mode === 'generate' ? 'Generate & save' : 'Save'}
          </button>
        }
      >
        <div className="psection">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'generate', label: 'Generate' },
              { value: 'import', label: 'Import' }
            ]}
          />
          <Field value={k.label} onChange={(v) => set({ label: v })} placeholder="Label" autoFocus />
        </div>
        {mode === 'generate' ? (
          <div className="psection">
            <h4>Key type</h4>
            <Segmented
              value={genType}
              onChange={setGenType}
              options={[
                { value: 'ed25519', label: 'ED25519' },
                { value: 'ecdsa', label: 'ECDSA' },
                { value: 'rsa', label: 'RSA' }
              ]}
            />
            {genType === 'rsa' && (
              <Segmented
                value={String(bits) as '2048' | '3072' | '4096'}
                onChange={(v) => setBits(Number(v))}
                options={[
                  { value: '2048', label: '2048 bits' },
                  { value: '3072', label: '3072 bits' },
                  { value: '4096', label: '4096 bits' }
                ]}
              />
            )}
            {passField}
            <p className="hint">ED25519 is recommended: small, fast and supported by any modern OpenSSH server.</p>
          </div>
        ) : (
          <div className="psection">
            <div className="row">
              <h4 className="grow">Private key</h4>
              <button className="link" onClick={pickFile}>
                <FileUp size={12} /> Choose file…
              </button>
            </div>
            <textarea
              className="input"
              spellCheck={false}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              value={k.privateKey ?? ''}
              onChange={(e) => set({ privateKey: e.target.value })}
            />
            {passField}
          </div>
        )}
      </Panel>
    )
  }

  return (
    <Panel
      title="Key Details"
      onClose={close}
      actions={
        <button className="icon-btn" title="Delete" onClick={del}>
          <Trash2 size={15} />
        </button>
      }
      footer={
        <button className="btn primary block" onClick={saveExisting}>
          Save
        </button>
      }
    >
      <div className="psection">
        <h4>General</h4>
        <Field value={k.label} onChange={(v) => set({ label: v })} placeholder="Label" />
        <div className="hint">
          {k.type?.toUpperCase()} · <span className="mono">{k.fingerprint}</span>
        </div>
      </div>
      <div className="psection">
        <div className="row">
          <h4 className="grow">Public key</h4>
          <button
            className="icon-btn"
            title="Copy"
            onClick={() => {
              navigator.clipboard.writeText(k.publicKey || '')
              notify('Public key copied')
            }}
          >
            <Copy size={14} />
          </button>
          <button className="icon-btn" title="Save to file" onClick={() => window.api.keys.savePublic(k.label || 'id', k.publicKey || '')}>
            <Download size={14} />
          </button>
        </div>
        <div className="mono" style={{ background: 'var(--input)', borderRadius: 8, padding: 10 }}>
          {k.publicKey}
        </div>
      </div>
      <div className="psection">
        <h4>Export to host</h4>
        <p className="hint">Append this public key to ~/.ssh/authorized_keys on a saved host.</p>
        <Select
          value={installHost}
          onChange={setInstallHost}
          options={vault.hosts.map((h) => ({ value: h.id, label: h.label || h.address }))}
          placeholder="Choose host"
        />
        <button className="btn soft" disabled={!installHost || busy} onClick={install}>
          <Send size={14} /> Export
        </button>
      </div>
      <div className="psection">
        <div className="row">
          <h4 className="grow">Private key</h4>
          <button className="link" onClick={() => setShowPriv(!showPriv)}>
            {showPriv ? 'Hide' : 'Show'}
          </button>
        </div>
        {showPriv && (
          <textarea className="input" readOnly value={k.privateKey} spellCheck={false} style={{ minHeight: 160 }} />
        )}
        {passField}
      </div>
    </Panel>
  )
}

export function IdentityEditor({ initial }: { initial: Partial<Identity> }) {
  const { vault, upsert, remove, setEditing, notify } = useStore()
  const [i, setI] = useState<Partial<Identity>>(initial)
  const [showPw, setShowPw] = useState(false)
  const [picking, setPicking] = useState(false)
  useEffect(() => setI(initial), [initial])
  if (!vault) return null
  const set = (patch: Partial<Identity>) => setI((x) => ({ ...x, ...patch }))
  const close = () => setEditing(null)
  const authType = i.authType || 'password'
  const users = vault.hosts.filter((h) => h.identityId === i.id)
  const groupUsers = vault.groups.filter((g) => g.identityId === i.id)

  const save = async () => {
    const username = i.username?.trim() || ''
    if (!username && authType !== 'keepass') return notify('Username is required', true)
    if (authType === 'key' && !i.keyId) return notify('Choose an SSH key', true)
    if (authType === 'keepass' && (!i.keepassDbId || !i.keepassEntryUuid)) return notify('Choose a KeePass entry', true)
    const saved = await upsert('identities', {
      ...i,
      authType,
      label: i.label?.trim() || username || i.keepassEntryLabel || 'Identity',
      username,
      // Keep only the secret matching the auth type
      password: authType === 'password' ? i.password : undefined,
      keyId: authType === 'key' ? i.keyId : null,
      keepassDbId: authType === 'keepass' ? i.keepassDbId : null,
      keepassEntryUuid: authType === 'keepass' ? i.keepassEntryUuid : null,
      keepassEntryLabel: authType === 'keepass' ? i.keepassEntryLabel : undefined
    })
    setI(saved)
    notify('Identity saved')
  }
  const del = async () => {
    if (!i.id) return
    const n = users.length + groupUsers.length
    if (
      await confirmDialog({
        title: 'Delete identity',
        message: `Delete "${i.label}"?${n ? ` ${n} host(s)/group(s) use it and will lose these credentials.` : ''}`,
        danger: true,
        confirm: 'Delete'
      })
    ) {
      await remove('identities', i.id)
      close()
    }
  }

  return (
    <Panel
      title={i.id ? 'Identity' : 'New Identity'}
      onClose={close}
      actions={
        i.id && (
          <button className="icon-btn" title="Delete" onClick={del}>
            <Trash2 size={15} />
          </button>
        )
      }
      footer={
        <button className="btn primary block" onClick={save}>
          Save
        </button>
      }
    >
      <div className="psection">
        <h4>General</h4>
        <Field value={i.label} onChange={(v) => set({ label: v })} placeholder="Label (e.g. Prod admin)" autoFocus={!i.id} />
        <Field
          icon={User}
          value={i.username}
          onChange={(v) => set({ username: v })}
          placeholder={authType === 'keepass' ? 'Username (default: from the KeePass entry)' : 'Username'}
        />
      </div>
      <div className="psection">
        <h4>Authentication</h4>
        <Segmented
          value={authType}
          onChange={(v) => set({ authType: v })}
          options={[
            { value: 'password', label: 'Password' },
            { value: 'key', label: 'SSH key' },
            { value: 'keepass', label: 'KeePass' }
          ]}
        />
        {authType === 'keepass' ? (
          <>
            <Select
              icon={Database}
              value={i.keepassDbId}
              onChange={(v) => set({ keepassDbId: v, keepassEntryUuid: null, keepassEntryLabel: undefined })}
              options={vault.keepass.map((k) => ({ value: k.id, label: k.label }))}
              placeholder="Choose KeePass database"
            />
            {vault.keepass.length === 0 && (
              <button className="link" onClick={() => setEditing({ kind: 'keepass', item: {} })}>
                <Plus size={12} /> Add a KeePass database
              </button>
            )}
            {i.keepassDbId && (
              <div className="identity-summary">
                <Database size={14} />
                <div className="grow">
                  <div>{i.keepassEntryLabel || 'No entry selected'}</div>
                  <div className="hint">Username and password are read from this entry on each connection.</div>
                </div>
                <button className="btn soft" onClick={() => setPicking(true)}>
                  Choose…
                </button>
              </div>
            )}
            {picking && i.keepassDbId && (
              <EntryPicker
                dbId={i.keepassDbId}
                onClose={() => setPicking(false)}
                onPick={(e) => {
                  set({
                    keepassEntryUuid: e.uuid,
                    keepassEntryLabel: [e.path, e.title].filter(Boolean).join(' / '),
                    label: i.label || e.title
                  })
                  setPicking(false)
                }}
              />
            )}
          </>
        ) : authType === 'password' ? (
          <>
            <label className="input">
              <Lock size={15} />
              <input
                type={showPw ? 'text' : 'password'}
                value={i.password ?? ''}
                placeholder="Password"
                onChange={(e) => set({ password: e.target.value })}
              />
              <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setShowPw(!showPw)}>
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </label>
            <p className="hint">Leave empty to be asked for the password on each connection.</p>
          </>
        ) : (
          <>
            <Select
              icon={KeyRound}
              value={i.keyId}
              onChange={(v) => set({ keyId: v })}
              options={vault.keys.map((k) => ({ value: k.id, label: `${k.label} (${k.type})` }))}
              placeholder="Choose SSH key"
            />
            {vault.keys.length === 0 && <p className="hint">No keys yet: generate or import one in the Keychain first.</p>}
          </>
        )}
      </div>
      {i.id && (
        <div className="psection">
          <h4>Used by</h4>
          {users.length + groupUsers.length === 0 ? (
            <p className="hint">Not assigned yet. Pick it in a host’s or group’s Credentials.</p>
          ) : (
            <p className="hint">{[...groupUsers.map((g) => `${g.name} (group)`), ...users.map((h) => h.label || h.address)].join(', ')}</p>
          )}
        </div>
      )}
    </Panel>
  )
}

type KpEntry = Awaited<ReturnType<typeof window.api.keepass.entries>>[number]

function EntryPicker({ dbId, onClose, onPick }: { dbId: string; onClose: () => void; onPick: (e: KpEntry) => void }) {
  const [entries, setEntries] = useState<KpEntry[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    // Unlocking may raise the master-password prompt from the main process
    window.api.keepass
      .entries(dbId)
      .then(setEntries)
      .catch((err) => setError(errMsg(err)))
  }, [dbId])
  const f = q.toLowerCase()
  const shown = (entries || []).filter((e) =>
    [e.title, e.username, e.path, e.url].some((v) => v.toLowerCase().includes(f))
  )
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h3>
          <Database size={18} color="var(--accent)" /> Choose KeePass entry
        </h3>
        {error ? (
          <div className="warning-box">{error}</div>
        ) : !entries ? (
          <p>Unlocking database…</p>
        ) : (
          <>
            <Field icon={Search} value={q} onChange={setQ} placeholder="Search title, username, group or URL" autoFocus />
            <div className="tree" style={{ maxHeight: 360 }}>
              {shown.length === 0 && <p style={{ padding: 12 }}>No matching entries.</p>}
              {shown.map((e) => (
                <div key={e.uuid} className="tree-row" style={{ paddingLeft: 12, cursor: 'pointer' }} onClick={() => onPick(e)}>
                  <KeyRound size={14} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title || '(untitled)'}</div>
                    <div className="hint" style={{ marginLeft: 0 }}>
                      {e.username || 'no username'}
                      {e.path ? ` · ${e.path}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="actions">
          <button className="btn soft" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export function KeepassEditor({ initial }: { initial: Partial<KeepassDb> }) {
  const { vault, upsert, remove, setEditing, notify } = useStore()
  const [k, setK] = useState<Partial<KeepassDb>>(initial)
  const [busy, setBusy] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  useEffect(() => setK(initial), [initial])
  useEffect(() => {
    if (k.id) window.api.keepass.isUnlocked(k.id).then(setIsOpen)
  }, [k.id, busy])
  if (!vault) return null
  const set = (patch: Partial<KeepassDb>) => setK((x) => ({ ...x, ...patch }))
  const close = () => setEditing(null)
  const users = vault.identities.filter((i) => i.keepassDbId === k.id)

  const save = async (): Promise<string | null> => {
    if (!k.path) {
      notify('Choose the .kdbx file', true)
      return null
    }
    const saved = await upsert('keepass', { ...k, label: k.label?.trim() || k.path.split(/[\\/]/).pop()!.replace(/\.kdbx$/i, '') })
    // Path or key file may have changed: drop the cached unlocked copy
    await window.api.keepass.lock(saved.id)
    setK(saved)
    return saved.id
  }

  const test = async () => {
    const id = await save()
    if (!id) return
    setBusy(true)
    try {
      const entries = await window.api.keepass.entries(id)
      notify(`Unlocked: ${entries.length} entries`)
    } catch (err) {
      notify(errMsg(err), true)
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!k.id) return
    if (
      await confirmDialog({
        title: 'Remove KeePass database',
        message: `Remove “${k.label}” from Sshelby? The .kdbx file itself is not touched.${users.length ? ` ${users.length} identit${users.length > 1 ? 'ies' : 'y'} will need another source.` : ''}`,
        danger: true,
        confirm: 'Remove'
      })
    ) {
      await window.api.keepass.lock(k.id)
      await remove('keepass', k.id)
      close()
    }
  }

  return (
    <Panel
      title={k.id ? 'KeePass Database' : 'Add KeePass Database'}
      onClose={close}
      actions={
        k.id && (
          <button className="icon-btn" title="Remove" onClick={del}>
            <Trash2 size={15} />
          </button>
        )
      }
      footer={
        <>
          <button className="btn soft block" onClick={async () => (await save()) && notify('Saved')}>
            Save
          </button>
          <button className="btn primary block" disabled={busy} onClick={test}>
            {busy ? 'Unlocking…' : 'Save & unlock'}
          </button>
        </>
      }
    >
      <div className="psection">
        <h4>Database</h4>
        <Field value={k.label} onChange={(v) => set({ label: v })} placeholder="Label" autoFocus={!k.id} />
        <div className="identity-summary">
          <Database size={14} />
          <div className="grow mono" style={{ fontSize: 11 }}>
            {k.path || 'No file selected'}
          </div>
          <button
            className="btn soft"
            onClick={async () => {
              const p = await window.api.keepass.pickFile('db')
              if (p) set({ path: p })
            }}
          >
            Choose…
          </button>
        </div>
        <div className="identity-summary">
          <KeyRound size={14} />
          <div className="grow mono" style={{ fontSize: 11 }}>
            {k.keyFilePath || 'No key file (optional)'}
          </div>
          {k.keyFilePath && (
            <button className="link" onClick={() => set({ keyFilePath: undefined })}>
              Clear
            </button>
          )}
          <button
            className="btn soft"
            onClick={async () => {
              const p = await window.api.keepass.pickFile('key')
              if (p) set({ keyFilePath: p })
            }}
          >
            Choose…
          </button>
        </div>
      </div>
      {k.id && (
        <div className="psection">
          <h4>Master password</h4>
          <p className="hint">
            {k.masterPassword
              ? 'Saved on this computer, encrypted with the OS keychain.'
              : 'Asked when an identity needs it, then kept in memory for 30 minutes.'}
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {k.masterPassword && (
              <button
                className="btn soft"
                onClick={async () => {
                  setK(await upsert('keepass', { ...k, masterPassword: '' }))
                  notify('Saved master password forgotten')
                }}
              >
                Forget saved password
              </button>
            )}
            {isOpen && (
              <button
                className="btn soft"
                onClick={async () => {
                  await window.api.keepass.lock(k.id!)
                  setIsOpen(false)
                  notify('Database locked')
                }}
              >
                <Lock size={14} /> Lock now
              </button>
            )}
            {!isOpen && (
              <span className="status-pill">
                <LockOpen size={12} style={{ display: 'none' }} />
                <span className="dot" /> Locked
              </span>
            )}
          </div>
        </div>
      )}
      {users.length > 0 && (
        <div className="psection">
          <h4>Used by identities</h4>
          <p className="hint">{users.map((i) => i.label).join(', ')}</p>
        </div>
      )}
    </Panel>
  )
}
