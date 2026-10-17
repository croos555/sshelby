import { useEffect, useState } from 'react'
import { Braces, Copy, Download, Fingerprint, Pencil, Plus, Trash2, Upload, FileInput } from 'lucide-react'
import type { Snippet } from '@shared/types'
import { errMsg, useStore } from '../store'
import { confirmDialog, ContextMenu, Empty, Field, Panel, Segmented, Select, Switch, useMenu } from '../components/ui'
import { THEMES } from '../themes'

// ---------------- Snippets ----------------

export function SnippetsView() {
  const { vault, editing, setEditing, remove } = useStore()
  const { menu, open, close } = useMenu()
  if (!vault) return null
  const selectedId = editing?.kind === 'snippet' ? editing.item.id : undefined
  return (
    <div className="main">
      <div className="toolbar">
        <button className="btn soft" onClick={() => setEditing({ kind: 'snippet', item: {} })}>
          <Plus size={15} /> New snippet
        </button>
      </div>
      <div className="content" onClick={() => setEditing(null)}>
        {vault.snippets.length === 0 ? (
          <Empty
            icon={Braces}
            title="Create snippet"
            text="Save your most used commands as snippets to reuse them in one click from any terminal."
            action={
              <button
                className="btn primary"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditing({ kind: 'snippet', item: {} })
                }}
              >
                <Plus size={15} /> New snippet
              </button>
            }
          />
        ) : (
          <>
            <div className="section-title">Snippets</div>
            <div className="grid">
              {vault.snippets.map((s) => (
                <div
                  key={s.id}
                  className={`card ${selectedId === s.id ? 'selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditing({ kind: 'snippet', item: s })
                  }}
                  onContextMenu={(e) =>
                    open(e, [
                      { label: 'Copy', icon: Copy, onClick: () => navigator.clipboard.writeText(s.script) },
                      { label: 'Edit', icon: Pencil, onClick: () => setEditing({ kind: 'snippet', item: s }) },
                      '-',
                      {
                        label: 'Delete',
                        icon: Trash2,
                        danger: true,
                        onClick: async () => {
                          if (await confirmDialog({ title: 'Delete snippet', message: `Delete "${s.label}"?`, danger: true, confirm: 'Delete' }))
                            remove('snippets', s.id)
                        }
                      }
                    ])
                  }
                >
                  <div className="icon-tile" style={{ background: '#3b4a6b' }}>
                    <Braces size={18} />
                  </div>
                  <div className="meta">
                    <div className="name">{s.label}</div>
                    <div className="sub mono">{s.script.split('\n')[0]}</div>
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

export function SnippetEditor({ initial }: { initial: Partial<Snippet> }) {
  const { upsert, remove, setEditing, notify } = useStore()
  const [s, setS] = useState<Partial<Snippet>>(initial)
  useEffect(() => setS(initial), [initial])
  const close = () => setEditing(null)
  const save = async () => {
    if (!s.label?.trim() || !s.script?.trim()) return notify('Name and script are required', true)
    setS(await upsert('snippets', { ...s, label: s.label.trim() }))
    notify('Snippet saved')
  }
  const del = async () => {
    if (!s.id) return
    if (await confirmDialog({ title: 'Delete snippet', message: `Delete "${s.label}"?`, danger: true, confirm: 'Delete' })) {
      await remove('snippets', s.id)
      close()
    }
  }
  return (
    <Panel
      title={s.id ? 'Edit Snippet' : 'New Snippet'}
      onClose={close}
      actions={
        s.id && (
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
        <Field value={s.label} onChange={(v) => setS({ ...s, label: v })} placeholder="Name" autoFocus />
        <textarea
          className="input"
          spellCheck={false}
          style={{ minHeight: 200 }}
          placeholder={'sudo apt update && sudo apt upgrade -y'}
          value={s.script ?? ''}
          onChange={(e) => setS({ ...s, script: e.target.value })}
        />
        <p className="hint">Run a snippet from the terminal side panel, or set it as a host’s startup snippet.</p>
      </div>
    </Panel>
  )
}

// ---------------- Known hosts ----------------

export function KnownHostsView() {
  const { vault, remove } = useStore()
  const { menu, open, close } = useMenu()
  if (!vault) return null
  return (
    <div className="main">
      <div className="toolbar">
        <span style={{ color: 'var(--text-2)' }}>Host keys you have trusted. Remove one to be asked again on next connection.</span>
      </div>
      <div className="content">
        {vault.knownHosts.length === 0 ? (
          <Empty icon={Fingerprint} title="No known hosts" text="Server fingerprints appear here after you trust them on first connection." />
        ) : (
          <>
            <div className="section-title">Known Hosts</div>
            <div className="grid">
              {vault.knownHosts.map((k) => (
                <div
                  key={k.id}
                  className="card"
                  onContextMenu={(e) =>
                    open(e, [
                      { label: 'Copy fingerprint', icon: Copy, onClick: () => navigator.clipboard.writeText(k.fingerprint) },
                      '-',
                      {
                        label: 'Remove',
                        icon: Trash2,
                        danger: true,
                        onClick: () => remove('knownHosts', k.id)
                      }
                    ])
                  }
                >
                  <div className="icon-tile" style={{ background: 'var(--group-icon)' }}>
                    <Fingerprint size={18} />
                  </div>
                  <div className="meta">
                    <div className="name">
                      {k.host}
                      {k.port !== 22 ? `:${k.port}` : ''}
                    </div>
                    <div className="sub mono" title={k.fingerprint}>
                      {k.keyType} {k.fingerprint}
                    </div>
                  </div>
                  <div className="actions">
                    <button className="icon-btn" title="Remove" onClick={() => remove('knownHosts', k.id)}>
                      <Trash2 size={14} />
                    </button>
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

// ---------------- Settings ----------------

const BACKEND: Record<string, string> = {
  keychain: 'the macOS Keychain',
  dpapi: 'Windows DPAPI (tied to your Windows account)',
  gnome_libsecret: 'GNOME Keyring (libsecret)',
  kwallet: 'KWallet',
  kwallet5: 'KWallet',
  kwallet6: 'KWallet'
}

export function SettingsView() {
  const { vault, saveSettings, notify, load, setModal } = useStore()
  const [storage, setStorage] = useState<{ encrypted: boolean; backend: string } | null>(null)
  const [agentInfo, setAgentInfo] = useState('')
  const testAgent = async () => {
    const path = await window.api.agent.path()
    try {
      const keys = await window.api.agent.list()
      setAgentInfo(`${path} · ${keys.length} key${keys.length === 1 ? '' : 's'}${keys.length ? ': ' + keys.map((k) => k.comment || k.type).join(', ') : ''}`)
    } catch (err) {
      setAgentInfo(errMsg(err))
    }
  }
  useEffect(() => {
    window.api.vault.storageInfo().then(setStorage)
  }, [])
  if (!vault) return null
  const s = vault.settings
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      const r = await fn()
      if (r !== false) notify(ok)
      await load()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }
  return (
    <div className="main">
      <div className="content">
        <div className="settings">
          <div className="section-title">Appearance</div>
          <div className="psection">
            <label className="row">
              <span>Theme</span>
              <div style={{ width: 260 }}>
                <Segmented
                  value={s.appearance}
                  onChange={(v) => saveSettings({ appearance: v })}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' }
                  ]}
                />
              </div>
            </label>
          </div>

          <div className="section-title">Terminal</div>
          <div className="psection">
            <label className="row">
              <span>Color theme</span>
              <div style={{ width: 260 }}>
                <Select
                  value={s.theme}
                  onChange={(v) => v && saveSettings({ theme: v })}
                  options={THEMES.map((t) => ({ value: t.id, label: t.name }))}
                  placeholder="Theme"
                />
              </div>
            </label>
            <label className="row">
              <span>Font family</span>
              <div style={{ width: 260 }}>
                <Field value={s.fontFamily} onChange={(v) => saveSettings({ fontFamily: v })} />
              </div>
            </label>
            <label className="row">
              <span>Font size</span>
              <div style={{ width: 100 }}>
                <Field
                  value={s.fontSize}
                  onChange={(v) => saveSettings({ fontSize: Math.min(32, Math.max(8, Number(v) || 13)) })}
                  suffix="px"
                />
              </div>
            </label>
            <label className="row">
              <span>Scrollback lines</span>
              <div style={{ width: 100 }}>
                <Field value={s.scrollback} onChange={(v) => saveSettings({ scrollback: Number(v.replace(/\D/g, '')) || 1000 })} />
              </div>
            </label>
            <label className="row">
              <span>Blinking cursor</span>
              <Switch on={s.cursorBlink} onChange={(v) => saveSettings({ cursorBlink: v })} />
            </label>
            <label className="row">
              <span>Status bar (remote CPU, RAM, disks)</span>
              <Switch on={s.statusBar} onChange={(v) => saveSettings({ statusBar: v })} />
            </label>
            <label className="row">
              <span>Copy on select</span>
              <Switch on={s.copyOnSelect} onChange={(v) => saveSettings({ copyOnSelect: v })} />
            </label>
          </div>

          <div className="section-title">SSH agent</div>
          <div className="psection">
            <p className="hint">
              Used by identities of type “SSH agent” and as a fallback for hosts without a key. KeePassXC users: enable
              Settings → SSH Agent in KeePassXC, then “Add key to agent” on your entries.
            </p>
            <label className="row">
              <span>Agent</span>
              <div style={{ width: 300 }}>
                <Segmented
                  value={s.agentSource}
                  onChange={(v) => saveSettings({ agentSource: v })}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'pageant', label: 'Pageant' },
                    { value: 'custom', label: 'Custom' }
                  ]}
                />
              </div>
            </label>
            {s.agentSource === 'custom' && (
              <Field
                value={s.agentPath}
                onChange={(v) => saveSettings({ agentPath: v })}
                placeholder={window.api.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '/path/to/agent.sock'}
              />
            )}
            <div className="row">
              <span className="hint grow mono" style={{ fontSize: 11 }}>
                {agentInfo}
              </span>
              <button className="btn soft" onClick={testAgent}>
                Test
              </button>
            </div>
          </div>

          <div className="section-title">Data</div>
          <div className="psection">
            <p className="hint">
              Everything is stored locally on this computer.{' '}
              {storage &&
                (storage.encrypted && storage.backend !== 'basic_text' ? (
                  <>Passwords and private keys are encrypted with {BACKEND[storage.backend] || storage.backend}.</>
                ) : (
                  <span style={{ color: 'var(--danger)' }}>
                    No system keyring is available: secrets are only obfuscated on disk. Install and unlock a keyring
                    (GNOME Keyring or KWallet) to encrypt them.
                  </span>
                ))}
            </p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn soft" onClick={() => setModal('export')}>
                <Upload size={14} /> Export hosts…
              </button>
              <button className="btn soft" onClick={() => setModal('import')}>
                <Download size={14} /> Import hosts…
              </button>
              <button className="btn soft" onClick={() => run(() => window.api.vault.importSshConfig(), 'Imported ~/.ssh/config')}>
                <FileInput size={14} /> Import ~/.ssh/config
              </button>
            </div>
            <p className="hint">Exports are encrypted with a key you choose (AES-256-GCM, scrypt key derivation).</p>
          </div>
        </div>
      </div>
    </div>
  )
}
