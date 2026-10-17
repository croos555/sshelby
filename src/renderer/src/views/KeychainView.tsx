import { useEffect, useState } from 'react'
import { Copy, Download, Eye, EyeOff, FileUp, KeyRound, Lock, Plus, Send, Trash2, Upload } from 'lucide-react'
import type { SshKey } from '@shared/types'
import { errMsg, useStore } from '../store'
import { confirmDialog, ContextMenu, Empty, Field, Panel, Segmented, Select, useMenu } from '../components/ui'

export default function KeychainView() {
  const { vault, editing, setEditing, remove } = useStore()
  const { menu, open, close } = useMenu()
  if (!vault) return null
  const selectedId = editing?.kind === 'key' ? editing.item.id : undefined

  return (
    <div className="main">
      <div className="toolbar">
        <button className="btn soft" onClick={() => setEditing({ kind: 'key', item: {} })}>
          <Plus size={15} /> New key
        </button>
        <button className="btn" onClick={() => setEditing({ kind: 'key', item: { label: '', privateKey: '' } })}>
          <Upload size={15} /> Import
        </button>
      </div>
      <div className="content" onClick={() => setEditing(null)}>
        {vault.keys.length === 0 ? (
          <Empty
            icon={KeyRound}
            title="Add credentials"
            text="Generate or import SSH keys to quickly and securely access your servers."
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
        ) : (
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
