import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, FileLock2, Lock, Upload, Download } from 'lucide-react'
import type { Group, Host } from '@shared/types'
import { errMsg, useStore } from '../store'
import { GroupIcon, HostIcon } from './ui'

function KeyField({
  value,
  onChange,
  placeholder,
  autoFocus,
  onEnter
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoFocus?: boolean
  onEnter?: () => void
}) {
  const [show, setShow] = useState(false)
  return (
    <label className="input">
      <Lock size={15} />
      <input
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
      <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setShow(!show)}>
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </label>
  )
}

const LABELS: Record<string, string> = {
  groups: 'groups',
  hosts: 'hosts',
  keys: 'SSH keys',
  snippets: 'snippets',
  forwards: 'forwarding rules',
  knownHosts: 'known hosts'
}

function summarize(counts: Record<string, number>) {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${LABELS[k] || k}`)
    .join(' · ')
}

// ---------------- Export ----------------

export function ExportModal({ onClose }: { onClose: () => void }) {
  const { vault, notify } = useStore()
  const [groups, setGroups] = useState<Set<string>>(new Set())
  const [hosts, setHosts] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [includeForwards, setIncludeForwards] = useState(true)
  const [key, setKey] = useState('')
  const [confirm, setConfirm] = useState('')
  const [preview, setPreview] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)

  const selection = useMemo(
    () => ({ groupIds: [...groups], hostIds: [...hosts], includeForwards }),
    [groups, hosts, includeForwards]
  )

  useEffect(() => {
    window.api.transfer.preview(selection).then(setPreview)
  }, [selection])

  if (!vault) return null

  // A host or group is implicitly selected when an ancestor group is
  const coveredByAncestor = (gid?: string | null): boolean => {
    const seen = new Set<string>()
    while (gid && !seen.has(gid)) {
      seen.add(gid)
      if (groups.has(gid)) return true
      gid = vault.groups.find((g) => g.id === gid)?.parentId
    }
    return false
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set)
    next.has(id) ? next.delete(id) : next.add(id)
    setter(next)
  }

  const allSelected =
    vault.groups.filter((g) => !g.parentId).every((g) => groups.has(g.id)) &&
    vault.hosts.filter((h) => !h.groupId).every((h) => hosts.has(h.id))
  const selectAll = () => {
    if (allSelected) {
      setGroups(new Set())
      setHosts(new Set())
    } else {
      setGroups(new Set(vault.groups.filter((g) => !g.parentId).map((g) => g.id)))
      setHosts(new Set(vault.hosts.filter((h) => !h.groupId).map((h) => h.id)))
    }
  }

  const sortedGroups = (parent: string | null) =>
    vault.groups.filter((g) => (g.parentId || null) === parent).sort((a, b) => a.name.localeCompare(b.name))
  const sortedHosts = (parent: string | null) =>
    vault.hosts
      .filter((h) => (h.groupId || null) === parent)
      .sort((a, b) => (a.label || a.address).localeCompare(b.label || b.address))

  const renderLevel = (parent: string | null, depth: number): React.ReactNode => (
    <>
      {sortedGroups(parent).map((g: Group) => {
        const implied = coveredByAncestor(g.parentId)
        const open = !collapsed.has(g.id)
        return (
          <div key={g.id}>
            <div className="tree-row" style={{ paddingLeft: 8 + depth * 20 }}>
              <button className="icon-btn" style={{ width: 18, height: 18 }} onClick={() => toggle(collapsed, setCollapsed, g.id)}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <input
                type="checkbox"
                checked={implied || groups.has(g.id)}
                disabled={implied}
                onChange={() => toggle(groups, setGroups, g.id)}
              />
              <GroupIcon size="sm" />
              <span>{g.name}</span>
            </div>
            {open && renderLevel(g.id, depth + 1)}
          </div>
        )
      })}
      {sortedHosts(parent).map((h: Host) => {
        const implied = coveredByAncestor(h.groupId)
        return (
          <div key={h.id} className="tree-row" style={{ paddingLeft: 8 + depth * 20 + 22 }}>
            <input
              type="checkbox"
              checked={implied || hosts.has(h.id)}
              disabled={implied}
              onChange={() => toggle(hosts, setHosts, h.id)}
            />
            <HostIcon host={h} size="sm" />
            <span>{h.label || h.address}</span>
            <span className="hint">{h.username ? `${h.username}@` : ''}{h.address}</span>
          </div>
        )
      })}
    </>
  )

  const nothing = !preview.hosts && !preview.groups
  const keyError =
    key && key.length < 8 ? 'At least 8 characters' : confirm && key !== confirm ? 'Keys do not match' : ''

  const doExport = async () => {
    if (nothing || keyError || !key || key !== confirm) return
    setBusy(true)
    try {
      if (await window.api.transfer.exportFile(selection, key)) {
        notify('Export saved')
        onClose()
      }
    } catch (err) {
      notify(errMsg(err), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <h3>
          <Upload size={18} color="var(--accent)" /> Export hosts
        </h3>
        <p>Choose what to export. The file is encrypted with the key you set below; you’ll need it to import on another machine.</p>
        <div className="row">
          <strong className="grow">Hosts & groups</strong>
          <button className="link" onClick={selectAll}>
            {allSelected ? 'Select none' : 'Select all'}
          </button>
        </div>
        <div className="tree">
          {vault.hosts.length || vault.groups.length ? renderLevel(null, 0) : <p style={{ padding: 12 }}>No hosts yet.</p>}
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={includeForwards} onChange={(e) => setIncludeForwards(e.target.checked)} />
          <span>Include port forwarding rules of these hosts</span>
        </label>
        <div className="hint">
          {nothing ? 'Nothing selected.' : `Will export: ${summarize(preview)}.`} Parent groups, SSH keys, jump hosts and
          startup snippets used by the selection are added automatically, including passwords and private keys.
        </div>
        <KeyField value={key} onChange={setKey} placeholder="Encryption key (min. 8 characters)" />
        <KeyField value={confirm} onChange={setConfirm} placeholder="Confirm key" onEnter={doExport} />
        {keyError && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{keyError}</div>}
        <div className="actions">
          <button className="btn soft" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || nothing || !!keyError || !key || key !== confirm} onClick={doExport}>
            {busy ? 'Encrypting…' : 'Export…'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------- Import ----------------

type Preview = Awaited<ReturnType<typeof window.api.transfer.inspect>>

export function ImportModal({ onClose }: { onClose: () => void }) {
  const { notify, load } = useStore()
  const [path, setPath] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    setError('')
    try {
      const p = await window.api.transfer.pickImport()
      if (p) {
        setPath(p)
        setPreview(null)
      }
    } catch (err) {
      setError(errMsg(err))
    }
  }

  useEffect(() => {
    pick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unlock = async () => {
    if (!path || !key) return
    setBusy(true)
    setError('')
    try {
      setPreview(await window.api.transfer.inspect(path, key))
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const doImport = async () => {
    if (!path) return
    setBusy(true)
    try {
      const res = await window.api.transfer.importFile(path, key)
      await load()
      notify(`Imported: ${res.created} new, ${res.updated} updated`)
      onClose()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>
          <Download size={18} color="var(--accent)" /> Import hosts
        </h3>
        <div className="fingerprint row">
          <FileLock2 size={16} />
          <span className="grow mono" style={{ fontSize: 12 }}>
            {path ? path.split(/[\\/]/).pop() : 'No file selected'}
          </span>
          <button className="link" onClick={pick}>
            Choose file…
          </button>
        </div>
        {path && !preview && (
          <>
            <KeyField value={key} onChange={setKey} placeholder="Encryption key" autoFocus onEnter={unlock} />
          </>
        )}
        {preview && (
          <div className="fingerprint" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="hint">Exported {new Date(preview.exportedAt).toLocaleString()}</div>
            <div>
              <strong>{preview.hosts.length}</strong> hosts
              {preview.groups.length ? (
                <>
                  , <strong>{preview.groups.length}</strong> groups
                </>
              ) : null}
              {preview.keys ? `, ${preview.keys} SSH keys` : ''}
              {preview.forwards ? `, ${preview.forwards} forwarding rules` : ''}
              {preview.snippets ? `, ${preview.snippets} snippets` : ''}
              {preview.knownHosts ? `, ${preview.knownHosts} known hosts` : ''}
            </div>
            <div className="hint" style={{ maxHeight: 120, overflow: 'auto' }}>
              {preview.hosts.join(', ')}
            </div>
            <div className="hint">Matching hosts, groups and keys already on this machine are updated instead of duplicated.</div>
          </div>
        )}
        {error && <div className="warning-box">{error}</div>}
        <div className="actions">
          <button className="btn soft" onClick={onClose}>
            Cancel
          </button>
          {preview ? (
            <button className="btn primary" disabled={busy} onClick={doImport}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          ) : (
            <button className="btn primary" disabled={!path || !key || busy} onClick={unlock}>
              {busy ? 'Decrypting…' : 'Unlock'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
