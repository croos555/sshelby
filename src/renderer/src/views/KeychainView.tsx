import { useEffect, useState } from 'react'
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  FileUp,
  IdCard,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Upload,
  User
} from 'lucide-react'
import type { Identity, SshKey } from '@shared/types'
import { errMsg, useStore } from '../store'
import { confirmDialog, ContextMenu, Empty, Field, Panel, Segmented, Select, useMenu } from '../components/ui'

export default function KeychainView() {
  const { vault, editing, setEditing, remove } = useStore()
  const { menu, open, close } = useMenu()
  if (!vault) return null
  const selectedId =
    editing?.kind === 'key' || editing?.kind === 'identity' ? editing.item.id : undefined
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
                      {i.username} ·{' '}
                      {i.authType === 'key' ? 'SSH key' : i.authType === 'agent' ? `agent${i.agentKeyLabel ? ` (${i.agentKeyLabel})` : ''}` : 'password'}
                      {usage(i.id) ? ` · used by ${usage(i.id)}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {vault.keys.length === 0 && vault.identities.length === 0 ? (
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
  useEffect(() => setI(initial), [initial])
  if (!vault) return null
  const set = (patch: Partial<Identity>) => setI((x) => ({ ...x, ...patch }))
  const close = () => setEditing(null)
  const authType = i.authType || 'password'
  const users = vault.hosts.filter((h) => h.identityId === i.id)
  const groupUsers = vault.groups.filter((g) => g.identityId === i.id)

  const save = async () => {
    const username = i.username?.trim() || ''
    if (!username) return notify('Username is required', true)
    if (authType === 'key' && !i.keyId) return notify('Choose an SSH key', true)
    const saved = await upsert('identities', {
      ...i,
      authType,
      label: i.label?.trim() || username,
      username,
      // Keep only the secret matching the auth type
      password: authType === 'password' ? i.password : undefined,
      keyId: authType === 'key' ? i.keyId : null,
      agentKeyFingerprint: authType === 'agent' ? i.agentKeyFingerprint || null : null,
      agentKeyLabel: authType === 'agent' ? i.agentKeyLabel : undefined
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
          placeholder="Username"
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
            { value: 'agent', label: 'SSH agent' }
          ]}
        />
        {authType === 'agent' ? (
          <AgentKeyPicker
            fingerprint={i.agentKeyFingerprint}
            onChange={(fp, label) => set({ agentKeyFingerprint: fp, agentKeyLabel: label })}
          />
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

type AgentKey = Awaited<ReturnType<typeof window.api.agent.list>>[number]

// Lists the keys currently loaded in the SSH agent (e.g. by KeePassXC) and lets the identity pin one
function AgentKeyPicker({
  fingerprint,
  onChange
}: {
  fingerprint?: string | null
  onChange: (fingerprint: string | null, label?: string) => void
}) {
  const [keys, setKeys] = useState<AgentKey[] | null>(null)
  const [error, setError] = useState('')
  const [path, setPath] = useState<string | null>(null)
  const load = () => {
    setError('')
    window.api.agent.path().then(setPath)
    window.api.agent
      .list()
      .then(setKeys)
      .catch((err) => setError(errMsg(err)))
  }
  useEffect(load, [])
  const missing = fingerprint && keys && !keys.some((k) => k.fingerprint === fingerprint)
  return (
    <>
      <p className="hint">
        Authenticates with keys held by your SSH agent: ssh-agent, KeePassXC’s SSH Agent integration, Pageant… The private
        key never leaves the agent.
      </p>
      <div className="row">
        <span className="hint grow mono" style={{ fontSize: 10 }}>
          {path || 'no agent detected'}
        </span>
        <button className="link" onClick={load}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      {error && <div className="warning-box">{error}</div>}
      {keys && (
        <div className="tree" style={{ maxHeight: 220 }}>
          <label className="tree-row" style={{ paddingLeft: 12 }}>
            <input type="radio" checked={!fingerprint} onChange={() => onChange(null)} />
            <span>Any key in the agent</span>
          </label>
          {keys.map((k) => (
            <label key={k.fingerprint} className="tree-row" style={{ paddingLeft: 12 }}>
              <input
                type="radio"
                checked={fingerprint === k.fingerprint}
                onChange={() => onChange(k.fingerprint, k.comment || k.type)}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div>{k.comment || '(no comment)'}</div>
                <div className="hint mono" style={{ marginLeft: 0, fontSize: 10 }}>
                  {k.type} {k.fingerprint}
                </div>
              </div>
            </label>
          ))}
          {keys.length === 0 && (
            <p className="hint" style={{ padding: '4px 12px 10px' }}>
              The agent has no keys. In KeePassXC, unlock the database and enable “Add key to agent” on the entry.
            </p>
          )}
        </div>
      )}
      {missing && (
        <p className="hint" style={{ color: 'var(--warning)' }}>
          The selected key isn’t in the agent right now (KeePassXC locked?). It will be used once it’s loaded again.
        </p>
      )}
    </>
  )
}
