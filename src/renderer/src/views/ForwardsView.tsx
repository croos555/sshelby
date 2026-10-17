import { useEffect, useState } from 'react'
import { ArrowRightLeft, Laptop, Pencil, Play, Plus, Server, Square, Trash2, Globe, Shield } from 'lucide-react'
import type { ForwardType, PortForward } from '@shared/types'
import { errMsg, useStore } from '../store'
import { confirmDialog, ContextMenu, Empty, Field, Panel, Segmented, Select, Switch, useMenu } from '../components/ui'

const LETTER: Record<ForwardType, string> = { local: 'L', remote: 'R', dynamic: 'D' }
const COLOR: Record<ForwardType, string> = { local: '#4b5263', remote: '#6b4fa3', dynamic: '#1f7a6b' }

export function describe(f: Partial<PortForward>): string {
  const bind = `${f.bindAddress || '127.0.0.1'}:${f.bindPort || '?'}`
  if (f.type === 'dynamic') return `SOCKS5 on ${bind}`
  const dest = `${f.destAddress || 'localhost'}:${f.destPort || '?'}`
  return f.type === 'remote' ? `remote ${bind} → local ${dest}` : `${bind} → ${dest}`
}

export default function ForwardsView() {
  const { vault, editing, setEditing, forwardStatus, remove, notify } = useStore()
  const { menu, open, close } = useMenu()
  if (!vault) return null
  const selectedId = editing?.kind === 'forward' ? editing.item.id : undefined

  const toggle = async (f: PortForward) => {
    const st = forwardStatus[f.id]?.state
    try {
      if (st === 'running' || st === 'starting') await window.api.forwards.stop(f.id)
      else await window.api.forwards.start(f.id)
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  return (
    <div className="main">
      <div className="toolbar">
        <button className="btn soft" onClick={() => setEditing({ kind: 'forward', item: { type: 'local' } })}>
          <Plus size={15} /> New forwarding
        </button>
      </div>
      <div className="content" onClick={() => setEditing(null)}>
        {vault.forwards.length === 0 ? (
          <Empty
            icon={ArrowRightLeft}
            title="Set up port forwarding"
            text="Save port forwarding rules to access databases, web apps, and other services."
            action={
              <button
                className="btn primary"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditing({ kind: 'forward', item: { type: 'local' } })
                }}
              >
                <Plus size={15} /> New forwarding
              </button>
            }
          />
        ) : (
          <>
            <div className="section-title">Port Forwarding</div>
            <div className="grid">
              {vault.forwards.map((f) => {
                const st = forwardStatus[f.id]
                const state = st?.state || 'stopped'
                const host = vault.hosts.find((h) => h.id === f.hostId)
                const active = state === 'running' || state === 'starting'
                return (
                  <div
                    key={f.id}
                    className={`card ${selectedId === f.id ? 'selected' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing({ kind: 'forward', item: f })
                    }}
                    onDoubleClick={() => toggle(f)}
                    onContextMenu={(e) =>
                      open(e, [
                        { label: active ? 'Stop' : 'Start', icon: active ? Square : Play, onClick: () => toggle(f) },
                        { label: 'Edit', icon: Pencil, onClick: () => setEditing({ kind: 'forward', item: f }) },
                        '-',
                        {
                          label: 'Delete',
                          icon: Trash2,
                          danger: true,
                          onClick: async () => {
                            if (await confirmDialog({ title: 'Delete rule', message: `Delete "${f.label}"?`, danger: true, confirm: 'Delete' })) {
                              await window.api.forwards.stop(f.id)
                              remove('forwards', f.id)
                            }
                          }
                        }
                      ])
                    }
                  >
                    <div className="icon-tile" style={{ background: COLOR[f.type] }}>
                      {LETTER[f.type]}
                    </div>
                    <div className="meta">
                      <div className="name">{f.label || describe(f)}</div>
                      <div className="sub" title={st?.message}>
                        <span className={`status-pill ${state}`}>
                          <span className="dot" />
                          {state === 'running'
                            ? `Active${st.connections ? ` · ${st.connections} conn` : ''}`
                            : state === 'error'
                              ? st?.message || 'Error'
                              : state === 'starting'
                                ? 'Connecting…'
                                : 'Inactive'}
                        </span>
                        {' · '}
                        {host ? host.label || host.address : 'missing host'} · {describe(f)}
                      </div>
                    </div>
                    <button
                      className={`icon-btn ${active ? 'active' : ''}`}
                      title={active ? 'Stop' : 'Start'}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggle(f)
                      }}
                    >
                      {active ? <Square size={14} /> : <Play size={14} />}
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  )
}

const HELP: Record<ForwardType, string> = {
  local:
    'Local forwarding lets you access a remote server’s listening port as though it were local. Example: reach a database only listening on the server via localhost:5432.',
  remote:
    'Remote forwarding opens a port on the remote server and forwards connections to a host and port reachable from this computer.',
  dynamic:
    'Dynamic forwarding starts a local SOCKS5 proxy. Point a browser or tool at it to route traffic through the server.'
}

function Diagram({ type }: { type: ForwardType }) {
  const nodes =
    type === 'remote'
      ? [
          { icon: Server, label: 'Server', color: '#3d4556' },
          { icon: Shield, label: 'SSH', color: '#d6453d' },
          { icon: Laptop, label: 'This computer', color: '#4b5263' }
        ]
      : [
          { icon: Laptop, label: 'This computer', color: '#4b5263' },
          { icon: Shield, label: 'SSH', color: '#d6453d' },
          { icon: type === 'dynamic' ? Globe : Server, label: type === 'dynamic' ? 'Any host' : 'Destination', color: '#3d4556' }
        ]
  return (
    <div className="fw-diagram">
      {nodes.map((n, i) => (
        <span key={i} style={{ display: 'contents' }}>
          {i > 0 && <span className="line" />}
          <span className="node">
            <div style={{ background: n.color }}>
              <n.icon size={18} />
            </div>
            {n.label}
          </span>
        </span>
      ))}
    </div>
  )
}

export function ForwardEditor({ initial }: { initial: Partial<PortForward> }) {
  const { vault, upsert, remove, setEditing, notify, forwardStatus } = useStore()
  const [f, setF] = useState<Partial<PortForward>>(initial)
  useEffect(() => setF(initial), [initial])
  if (!vault) return null
  const set = (patch: Partial<PortForward>) => setF((x) => ({ ...x, ...patch }))
  const type = f.type || 'local'
  const close = () => setEditing(null)

  const save = async (start = false) => {
    if (!f.hostId) return notify('Choose the SSH host to forward through', true)
    if (!f.bindPort) return notify('Port is required', true)
    if (type !== 'dynamic' && !f.destPort) return notify('Destination port is required', true)
    const saved = await upsert('forwards', {
      ...f,
      type,
      bindAddress: f.bindAddress || '127.0.0.1',
      destAddress: type === 'dynamic' ? undefined : f.destAddress || 'localhost',
      label: f.label?.trim() || ''
    })
    setF(saved)
    // Restart a running rule so edits take effect
    if (forwardStatus[saved.id]?.state === 'running') await window.api.forwards.stop(saved.id)
    if (start || forwardStatus[saved.id]?.state === 'running') {
      try {
        await window.api.forwards.start(saved.id)
      } catch (err) {
        return notify(errMsg(err), true)
      }
    }
    notify('Rule saved')
  }

  const del = async () => {
    if (!f.id) return
    if (await confirmDialog({ title: 'Delete rule', message: `Delete "${f.label || describe(f)}"?`, danger: true, confirm: 'Delete' })) {
      await window.api.forwards.stop(f.id)
      await remove('forwards', f.id)
      close()
    }
  }

  const num = (v: string) => (v ? Number(v.replace(/\D/g, '')) : undefined)

  return (
    <Panel
      title={f.id ? 'Edit Port Forwarding' : 'New Port Forwarding'}
      onClose={close}
      actions={
        f.id && (
          <button className="icon-btn" title="Delete" onClick={del}>
            <Trash2 size={15} />
          </button>
        )
      }
      footer={
        <>
          <button className="btn soft block" onClick={() => save(false)}>
            Save
          </button>
          <button className="btn primary block" onClick={() => save(true)}>
            Save & start
          </button>
        </>
      }
    >
      <div className="psection">
        <h4>Select the port forwarding type:</h4>
        <Segmented
          value={type}
          onChange={(t) => set({ type: t })}
          options={[
            { value: 'local', label: 'Local' },
            { value: 'remote', label: 'Remote' },
            { value: 'dynamic', label: 'Dynamic' }
          ]}
        />
        <Diagram type={type} />
        <p className="hint">{HELP[type]}</p>
      </div>
      <div className="psection">
        <h4>General</h4>
        <Field value={f.label} onChange={(v) => set({ label: v })} placeholder="Label" />
        <Select
          icon={Server}
          value={f.hostId}
          onChange={(v) => set({ hostId: v || undefined })}
          options={vault.hosts.map((h) => ({ value: h.id, label: h.label || h.address }))}
          placeholder="SSH host"
        />
        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>Start when Sshelby opens</span>
          <Switch on={!!f.autoStart} onChange={(v) => set({ autoStart: v })} />
        </label>
      </div>
      <div className="psection">
        <h4>{type === 'remote' ? 'Remote bind (on server)' : 'Local bind (this computer)'}</h4>
        <div className="row">
          <div className="grow">
            <Field value={f.bindAddress} onChange={(v) => set({ bindAddress: v })} placeholder="127.0.0.1" />
          </div>
          <div style={{ width: 100 }}>
            <Field value={f.bindPort} onChange={(v) => set({ bindPort: num(v) })} placeholder="Port" />
          </div>
        </div>
        {type !== 'dynamic' && (
          <>
            <h4>{type === 'remote' ? 'Destination (from this computer)' : 'Destination (from server)'}</h4>
            <div className="row">
              <div className="grow">
                <Field value={f.destAddress} onChange={(v) => set({ destAddress: v })} placeholder="localhost" />
              </div>
              <div style={{ width: 100 }}>
                <Field value={f.destPort} onChange={(v) => set({ destPort: num(v) })} placeholder="Port" />
              </div>
            </div>
          </>
        )}
        <p className="hint mono">{describe({ ...f, type })}</p>
      </div>
    </Panel>
  )
}
