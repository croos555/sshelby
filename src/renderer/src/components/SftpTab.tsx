import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Link2,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Unplug,
  Upload,
  X,
  FileEdit,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react'
import type { FileEntry, Host, TransferProgress } from '@shared/types'
import { errMsg, Tab, useStore } from '../store'
import {
  confirmDialog,
  ContextMenu,
  formatPerms,
  formatSize,
  HostIcon,
  MenuItem,
  promptDialog,
  useMenu
} from './ui'

type Source = { kind: 'local' } | { kind: 'remote'; hostId: string; sftpId: string }

interface PaneState {
  source: Source
  path: string
  connecting?: boolean
  error?: string
  // Bumped to force a re-list (after a transfer lands in this pane)
  refresh: number
}

const isWin = window.api.platform === 'win32'

// Path helpers: remote is always POSIX; local follows the OS
function sep(src: Source) {
  return src.kind === 'local' && isWin ? '\\' : '/'
}
function joinPath(src: Source, dir: string, name: string) {
  const s = sep(src)
  return dir.endsWith(s) ? dir + name : dir + s + name
}
function parentPath(src: Source, p: string) {
  const s = sep(src)
  const trimmed = p.replace(/[\\/]+$/, '')
  const idx = trimmed.lastIndexOf(s)
  if (idx <= 0) return s === '/' ? '/' : trimmed.slice(0, 3)
  const parent = trimmed.slice(0, idx)
  return /^[A-Za-z]:$/.test(parent) ? parent + '\\' : parent
}
function splitCrumbs(src: Source, p: string): { label: string; path: string }[] {
  const s = sep(src)
  if (s === '/') {
    const parts = p.split('/').filter(Boolean)
    return [{ label: '/', path: '/' }, ...parts.map((part, i) => ({ label: part, path: '/' + parts.slice(0, i + 1).join('/') }))]
  }
  const parts = p.split('\\').filter(Boolean)
  return parts.map((part, i) => ({ label: part, path: parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '') }))
}

function kindOf(e: FileEntry) {
  if (e.isDir) return 'folder'
  const m = e.name.match(/\.([^.]+)$/)
  return m ? m[1].toLowerCase() : 'file'
}

export default function SftpTab({ tab, active }: { tab: Tab; active: boolean }) {
  const { notify, transfers } = useStore()
  const [panes, setPanes] = useState<[PaneState, PaneState]>([
    { source: { kind: 'local' }, path: '', refresh: 0 },
    { source: { kind: 'local' }, path: '', refresh: 0 }
  ])
  const [rightPicked, setRightPicked] = useState(false)
  // Transfer id -> pane index that receives the files
  const pending = useRef(new Map<string, number>())
  const [myTransfers, setMyTransfers] = useState<string[]>([])

  const update = useCallback((i: number, patch: Partial<PaneState>) => {
    setPanes((ps) => {
      const next = [...ps] as [PaneState, PaneState]
      next[i] = { ...next[i], ...patch }
      return next
    })
  }, [])

  const connect = useCallback(
    async (i: number, hostId: string | null) => {
      const prev = panes[i].source
      if (prev.kind === 'remote') window.api.sftp.close(prev.sftpId)
      if (!hostId) {
        const home = await window.api.local.home()
        update(i, { source: { kind: 'local' }, path: home, error: undefined, connecting: false })
        return
      }
      const sftpId = crypto.randomUUID()
      update(i, { source: { kind: 'remote', hostId, sftpId }, path: '', connecting: true, error: undefined })
      try {
        const home = await window.api.sftp.open(sftpId, hostId)
        update(i, { path: home, connecting: false })
      } catch (err) {
        update(i, { connecting: false, error: errMsg(err) })
      }
    },
    [panes, update]
  )

  useEffect(() => {
    window.api.local.home().then((home) => {
      update(0, { path: home })
      if (tab.hostId) {
        setRightPicked(true)
        connect(1, tab.hostId)
      }
    })
    const off = window.api.sftp.onClosed((id) => {
      setPanes((ps) =>
        ps.map((p) =>
          p.source.kind === 'remote' && p.source.sftpId === id ? { ...p, error: 'Connection closed' } : p
        ) as [PaneState, PaneState]
      )
    })
    return () => {
      off()
      setPanes((ps) => {
        for (const p of ps) if (p.source.kind === 'remote') window.api.sftp.close(p.source.sftpId)
        return ps
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh the destination pane when one of our transfers finishes
  useEffect(() => {
    for (const [id, paneIdx] of pending.current) {
      const t = transfers[id]
      if (t && t.status !== 'running') {
        pending.current.delete(id)
        setPanes((ps) => {
          const next = [...ps] as [PaneState, PaneState]
          next[paneIdx] = { ...next[paneIdx], refresh: next[paneIdx].refresh + 1 }
          return next
        })
        if (t.status === 'error') notify(`Transfer failed: ${t.error}`, true)
      }
    }
  }, [transfers, notify])

  const transfer = async (from: number, paths: string[], to: number, destDir?: string) => {
    const src = panes[from].source
    const dst = panes[to].source
    const dir = destDir || panes[to].path
    try {
      let id: string
      if (src.kind === 'local' && dst.kind === 'remote') id = await window.api.sftp.upload(dst.sftpId, paths, dir)
      else if (src.kind === 'remote' && dst.kind === 'local') id = await window.api.sftp.download(src.sftpId, paths, dir)
      else return notify(src.kind === 'local' ? 'Both panes are local' : 'Remote-to-remote copy is not supported yet', true)
      pending.current.set(id, to)
      setMyTransfers((x) => [...x, id])
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const uploadExternal = async (to: number, localPaths: string[], destDir?: string) => {
    const dst = panes[to].source
    if (dst.kind !== 'remote') return
    try {
      const id = await window.api.sftp.upload(dst.sftpId, localPaths, destDir || panes[to].path)
      pending.current.set(id, to)
      setMyTransfers((x) => [...x, id])
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const visibleTransfers = myTransfers.map((id) => transfers[id]).filter(Boolean) as TransferProgress[]

  return (
    <div className={`sftp ${active ? '' : 'hidden'}`}>
      {[0, 1].map((i) => (
        <Pane
          key={i}
          index={i}
          state={panes[i]}
          otherState={panes[1 - i]}
          showPicker={i === 1 && !rightPicked}
          onPick={(hostId) => {
            if (i === 1) setRightPicked(true)
            connect(i, hostId)
          }}
          onNavigate={(path) => update(i, { path })}
          onTransfer={(paths, destDir) => transfer(i, paths, 1 - i, destDir)}
          onDropFromOther={(paths, destDir) => transfer(1 - i, paths, i, destDir)}
          onDropExternal={(paths, destDir) => uploadExternal(i, paths, destDir)}
          active={active}
        />
      ))}
      {visibleTransfers.length > 0 && (
        <div className="transfers">
          <div className="row" style={{ padding: '2px 6px' }}>
            <strong className="grow">Transfers</strong>
            {visibleTransfers.every((t) => t.status !== 'running') && (
              <button className="link" onClick={() => setMyTransfers([])}>
                Clear
              </button>
            )}
          </div>
          {visibleTransfers.map((t) => (
            <div key={t.transferId} className="transfer">
              {t.status === 'running' ? (
                <Loader2 size={15} className="spin" />
              ) : t.status === 'done' ? (
                <CheckCircle2 size={15} color="var(--success)" />
              ) : (
                <AlertCircle size={15} color="var(--danger)" />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {t.direction === 'upload' ? <Upload size={11} /> : <Download size={11} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${t.total ? Math.min(100, (t.transferred / t.total) * 100) : t.status === 'done' ? 100 : 0}%` }} />
                </div>
                <div className="sub">
                  {t.status === 'error'
                    ? t.error
                    : t.status === 'cancelled'
                      ? 'Cancelled'
                      : `${formatSize(t.transferred)} / ${formatSize(t.total)}`}
                </div>
              </div>
              {t.status === 'running' && (
                <button className="icon-btn" title="Cancel after current file" onClick={() => window.api.sftp.cancel(t.transferId)}>
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface PaneProps {
  index: number
  state: PaneState
  otherState: PaneState
  showPicker: boolean
  active: boolean
  onPick: (hostId: string | null) => void
  onNavigate: (path: string) => void
  onTransfer: (paths: string[], destDir?: string) => void
  onDropFromOther: (paths: string[], destDir?: string) => void
  onDropExternal: (paths: string[], destDir?: string) => void
}

type SortKey = 'name' | 'mtime' | 'size' | 'kind'

function Pane(props: PaneProps) {
  const { state, otherState, index } = props
  const { vault, notify, openEditor } = useStore()
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [history, setHistory] = useState<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] })
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
  const [dropTarget, setDropTarget] = useState(false)
  const [sourceMenu, setSourceMenu] = useState(false)
  const { menu, open, close } = useMenu()

  const src = state.source
  const api = useMemo(() => {
    if (src.kind === 'local')
      return {
        list: (p: string) => window.api.local.list(p),
        mkdir: (p: string) => window.api.local.mkdir(p),
        rename: (a: string, b: string) => window.api.local.rename(a, b),
        remove: (ps: string[]) => window.api.local.remove(ps)
      }
    const id = src.sftpId
    return {
      list: (p: string) => window.api.sftp.list(id, p),
      mkdir: (p: string) => window.api.sftp.mkdir(id, p),
      rename: (a: string, b: string) => window.api.sftp.rename(id, a, b),
      remove: (ps: string[]) => window.api.sftp.remove(id, ps)
    }
  }, [src])

  const ready = !!state.path && !state.connecting && !state.error && !props.showPicker

  const reload = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    try {
      setEntries(await api.list(state.path))
    } catch (err) {
      notify(errMsg(err), true)
    } finally {
      setLoading(false)
    }
  }, [api, state.path, ready, notify])

  useEffect(() => {
    reload()
    setSelected(new Set())
  }, [reload, state.refresh])

  const navigate = (p: string, push = true) => {
    if (p === state.path) return
    if (push) setHistory((h) => ({ back: [...h.back, state.path], fwd: [] }))
    setFilter('')
    props.onNavigate(p)
  }
  const goBack = () => {
    const prev = history.back[history.back.length - 1]
    if (!prev) return
    setHistory((h) => ({ back: h.back.slice(0, -1), fwd: [state.path, ...h.fwd] }))
    props.onNavigate(prev)
  }
  const goFwd = () => {
    const next = history.fwd[0]
    if (!next) return
    setHistory((h) => ({ back: [...h.back, state.path], fwd: h.fwd.slice(1) }))
    props.onNavigate(next)
  }

  const shown = useMemo(() => {
    const f = filter.toLowerCase()
    const list = entries.filter((e) => !f || e.name.toLowerCase().includes(f))
    const dir = sort.asc ? 1 : -1
    return list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      let c = 0
      if (sort.key === 'name') c = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      else if (sort.key === 'mtime') c = a.mtime - b.mtime
      else if (sort.key === 'size') c = a.size - b.size
      else c = kindOf(a).localeCompare(kindOf(b))
      return c * dir
    })
  }, [entries, filter, sort])

  const otherReady = !!otherState.path && !otherState.connecting && !otherState.error
  const canSend = otherReady && (src.kind === 'remote') !== (otherState.source.kind === 'remote')
  const sendLabel = src.kind === 'local' ? 'Upload' : 'Download'

  const clickRow = (e: React.MouseEvent, entry: FileEntry) => {
    const mod = e.metaKey || e.ctrlKey
    if (e.shiftKey && anchor) {
      const a = shown.findIndex((x) => x.path === anchor)
      const b = shown.findIndex((x) => x.path === entry.path)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setSelected(new Set(shown.slice(lo, hi + 1).map((x) => x.path)))
    } else if (mod) {
      const next = new Set(selected)
      next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path)
      setSelected(next)
      setAnchor(entry.path)
    } else {
      setSelected(new Set([entry.path]))
      setAnchor(entry.path)
    }
  }

  const openEntry = (entry: FileEntry) => {
    if (entry.isDir) navigate(entry.path)
    else if (src.kind === 'local') window.api.local.open(entry.path)
    else openEditor(src.sftpId, src.hostId, entry.path)
  }

  const openLocalApp = async (entry: FileEntry) => {
    if (src.kind !== 'remote') return
    try {
      await window.api.sftp.openExternal(src.sftpId, entry.path)
      notify(`Opened ${entry.name}: saves are uploaded automatically`)
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const newFolder = async () => {
    const name = await promptDialog({ title: 'New folder', label: 'Folder name' })
    if (!name) return
    try {
      await api.mkdir(joinPath(src, state.path, name))
      reload()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const doRename = async () => {
    if (!renaming) return
    const { path, value } = renaming
    setRenaming(null)
    const name = value.trim()
    const old = path.split(/[\\/]/).pop()
    if (!name || name === old) return
    try {
      await api.rename(path, joinPath(src, parentPath(src, path), name))
      reload()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const deleteSelected = async (paths = [...selected]) => {
    if (!paths.length) return
    const ok = await confirmDialog({
      title: `Delete ${paths.length === 1 ? 'item' : `${paths.length} items`}`,
      message:
        src.kind === 'local'
          ? 'Selected items will be moved to the Trash.'
          : 'Selected items will be permanently deleted from the server, including folder contents.',
      danger: true,
      confirm: 'Delete'
    })
    if (!ok) return
    try {
      await api.remove(paths)
      reload()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const chmod = async (entry: FileEntry) => {
    if (src.kind !== 'remote') return
    const val = await promptDialog({
      title: `Permissions for ${entry.name}`,
      label: 'Octal mode, e.g. 644',
      value: (entry.mode & 0o777).toString(8)
    })
    if (!val || !/^[0-7]{3,4}$/.test(val)) return
    try {
      await window.api.sftp.chmod(src.sftpId, entry.path, parseInt(val, 8))
      reload()
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const rowMenu = (e: React.MouseEvent, entry?: FileEntry) => {
    let sel = selected
    if (entry && !selected.has(entry.path)) {
      sel = new Set([entry.path])
      setSelected(sel)
      setAnchor(entry.path)
    }
    const paths = [...sel]
    const items: (MenuItem | '-')[] = []
    if (entry) {
      if (entry.isDir || src.kind === 'local') items.push({ label: 'Open', icon: FolderOpen, onClick: () => openEntry(entry) })
      else {
        items.push({ label: 'Edit', icon: FileEdit, onClick: () => openEntry(entry) })
        items.push({ label: 'Open in local app', icon: ExternalLink, onClick: () => openLocalApp(entry) })
      }
      if (canSend)
        items.push({
          label: `${sendLabel}${paths.length > 1 ? ` ${paths.length} items` : ''}`,
          icon: src.kind === 'local' ? Upload : Download,
          onClick: () => props.onTransfer(paths)
        })
      items.push('-')
      if (paths.length === 1)
        items.push({ label: 'Rename', icon: Pencil, onClick: () => setRenaming({ path: entry.path, value: entry.name }) })
      if (src.kind === 'remote' && paths.length === 1)
        items.push({ label: 'Edit permissions', icon: ShieldCheck, onClick: () => chmod(entry) })
      items.push({ label: 'Copy path', icon: Link2, onClick: () => navigator.clipboard.writeText(paths.join('\n')) })
      items.push('-')
      items.push({ label: 'Delete', icon: Trash2, danger: true, onClick: () => deleteSelected(paths) })
      items.push('-')
    }
    items.push({ label: 'New folder', icon: FolderPlus, onClick: newFolder })
    items.push({ label: 'Refresh', icon: RefreshCw, onClick: reload })
    if (src.kind === 'remote') items.push({ label: 'Upload files…', icon: Upload, onClick: pickAndUpload })
    open(e, items)
  }

  const pickAndUpload = async () => {
    const paths = await window.api.local.pick(false)
    if (paths.length) props.onDropExternal(paths)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming || editingPath !== null) return
    if ((e.key === 'Backspace' && e.metaKey) || e.key === 'Delete') deleteSelected()
    else if (e.key === 'Backspace') navigate(parentPath(src, state.path))
    else if (e.key === 'Enter' && selected.size === 1) {
      const entry = entries.find((x) => selected.has(x.path))
      if (entry) openEntry(entry)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault()
      setSelected(new Set(shown.map((x) => x.path)))
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = shown.findIndex((x) => x.path === anchor)
      const next = shown[Math.max(0, Math.min(shown.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) {
        setSelected(new Set([next.path]))
        setAnchor(next.path)
      }
    }
  }

  // ---------- drag & drop ----------
  const onDragStart = (e: React.DragEvent, entry: FileEntry) => {
    const paths = selected.has(entry.path) ? [...selected] : [entry.path]
    if (!selected.has(entry.path)) setSelected(new Set([entry.path]))
    e.dataTransfer.setData('application/x-sshelby', JSON.stringify({ pane: index, paths }))
    e.dataTransfer.effectAllowed = 'copy'
  }
  const handleDrop = (e: React.DragEvent, destDir?: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(false)
    const internal = e.dataTransfer.getData('application/x-sshelby')
    if (internal) {
      const { pane, paths } = JSON.parse(internal)
      if (pane !== index) props.onDropFromOther(paths, destDir)
      return
    }
    if (src.kind === 'remote' && e.dataTransfer.files.length) {
      const paths = Array.from(e.dataTransfer.files).map((f) => window.api.local.pathForFile(f)).filter(Boolean)
      if (paths.length) props.onDropExternal(paths, destDir)
    }
  }

  const host: Host | undefined = src.kind === 'remote' ? vault?.hosts.find((h) => h.id === src.hostId) : undefined

  // ---------- render ----------
  const sourceButton = (
    <div style={{ position: 'relative' }}>
      <button className="source" onClick={() => setSourceMenu(!sourceMenu)} onBlur={() => setTimeout(() => setSourceMenu(false), 150)}>
        {host ? (
          <HostIcon host={host} size="sm" />
        ) : (
          <div className="icon-tile sm" style={{ background: 'var(--group-icon)' }}>
            <HardDrive size={15} />
          </div>
        )}
        {host ? host.label || host.address : 'Local'}
        <ChevronDown size={13} />
      </button>
      {sourceMenu && (
        <div className="menu" style={{ position: 'absolute', top: 38, left: 0, maxHeight: 360, overflow: 'auto' }}>
          <button onClick={() => props.onPick(null)}>
            <HardDrive size={14} /> Local
          </button>
          {vault?.hosts.length ? <hr /> : null}
          {vault?.hosts.map((h) => (
            <button key={h.id} onClick={() => props.onPick(h.id)}>
              <Folder size={14} /> {h.label || h.address}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (props.showPicker) {
    return (
      <div className="pane">
        <div className="empty">
          <div className="tile">
            <Folder size={20} />
          </div>
          <h3>Connect to host</h3>
          <p>Start by connecting to a saved host to manage your files with SFTP.</p>
          <div className="host-picker">
            {vault?.hosts.map((h) => (
              <div key={h.id} className="card" onClick={() => props.onPick(h.id)} style={{ cursor: 'pointer' }}>
                <HostIcon host={h} size="sm" />
                <div className="meta">
                  <div className="name">{h.label || h.address}</div>
                  <div className="sub">sftp{h.username ? `, ${h.username}` : ''}</div>
                </div>
              </div>
            ))}
            {!vault?.hosts.length && <p>No saved hosts yet.</p>}
          </div>
        </div>
      </div>
    )
  }

  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <div onClick={() => setSort((s) => ({ key: k, asc: s.key === k ? !s.asc : true }))}>
      {label}
      {sort.key === k && (sort.asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </div>
  )

  return (
    <div
      className={`pane ${dropTarget ? 'drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        if (!dropTarget) setDropTarget(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(false)
      }}
      onDrop={(e) => handleDrop(e)}
    >
      <div className="pane-head">
        {sourceButton}
        <div className="grow" style={{ flex: 1 }} />
        <label className="filter">
          <Search size={14} />
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <button className="icon-btn" title="New folder" onClick={newFolder} disabled={!ready}>
          <FolderPlus size={15} />
        </button>
        <button className="icon-btn" title="Refresh" onClick={reload} disabled={!ready}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
        {src.kind === 'remote' && (
          <button className="icon-btn" title="Disconnect" onClick={() => props.onPick(null)}>
            <Unplug size={14} />
          </button>
        )}
      </div>
      <div className="pane-path">
        <button className="icon-btn" disabled={!history.back.length} onClick={goBack}>
          <ArrowLeft size={14} />
        </button>
        <button className="icon-btn" disabled={!history.fwd.length} onClick={goFwd}>
          <ArrowRight size={14} />
        </button>
        <button className="icon-btn" title="Parent folder" onClick={() => navigate(parentPath(src, state.path))}>
          <ArrowUp size={14} />
        </button>
        {editingPath !== null ? (
          <input
            autoFocus
            value={editingPath}
            onChange={(e) => setEditingPath(e.target.value)}
            onBlur={() => setEditingPath(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const p = editingPath.trim()
                setEditingPath(null)
                if (p) navigate(p)
              }
              if (e.key === 'Escape') setEditingPath(null)
            }}
          />
        ) : (
          <div className="crumbs-scroll" onDoubleClick={() => setEditingPath(state.path)} title="Double-click to type a path">
            {splitCrumbs(src, state.path).map((c, i) => (
              <span key={c.path} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <ChevronRight size={12} color="var(--text-3)" />}
                <button
                  className="crumb"
                  onClick={() => navigate(c.path)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, c.path)}
                >
                  {i === splitCrumbs(src, state.path).length - 1 && <Folder size={14} color="var(--accent)" />}
                  {c.label}
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {state.connecting ? (
        <div className="empty">
          <Loader2 size={22} className="spin" />
          <p>Connecting to {host?.label || host?.address}…</p>
        </div>
      ) : state.error ? (
        <div className="empty">
          <div className="tile">
            <AlertCircle size={20} color="var(--danger)" />
          </div>
          <h3>Connection failed</h3>
          <p>{state.error}</p>
          <div className="row">
            <button className="btn primary" onClick={() => props.onPick(src.kind === 'remote' ? src.hostId : null)}>
              Retry
            </button>
            <button className="btn soft" onClick={() => props.onPick(null)}>
              Back to local
            </button>
          </div>
        </div>
      ) : (
        <div
          className="ftable"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}
          onContextMenu={(e) => rowMenu(e)}
        >
          <div className="frow head">
            <SortHead k="name" label="Name" />
            <SortHead k="mtime" label="Date Modified" />
            <SortHead k="size" label="Size" />
            <SortHead k="kind" label="Kind" />
          </div>
          <div className="frow" onDoubleClick={() => navigate(parentPath(src, state.path))}>
            <div className="fname">
              <Folder size={18} color="#5aa9f0" fill="#5aa9f0" className="icon" />
              ..
            </div>
          </div>
          {shown.map((e) => (
            <div
              key={e.path}
              className={`frow ${selected.has(e.path) ? 'selected' : ''}`}
              draggable={!renaming}
              onDragStart={(ev) => onDragStart(ev, e)}
              onDragOver={e.isDir ? (ev) => ev.preventDefault() : undefined}
              onDrop={e.isDir ? (ev) => handleDrop(ev, e.path) : undefined}
              onClick={(ev) => clickRow(ev, e)}
              onDoubleClick={() => openEntry(e)}
              onContextMenu={(ev) => rowMenu(ev, e)}
            >
              <div className="fname">
                {e.isDir ? (
                  <Folder size={18} color="#5aa9f0" fill="#5aa9f0" className="icon" />
                ) : (
                  <File size={18} color="var(--text-3)" className="icon" />
                )}
                {renaming?.path === e.path ? (
                  <input
                    autoFocus
                    value={renaming.value}
                    onClick={(ev) => ev.stopPropagation()}
                    onChange={(ev) => setRenaming({ ...renaming, value: ev.target.value })}
                    onBlur={doRename}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') doRename()
                      if (ev.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {e.name}
                      {e.isSymlink && <Link2 size={10} style={{ marginLeft: 4, opacity: 0.6 }} />}
                    </div>
                    <div className="perm">{formatPerms(e.mode, e.isDir)}</div>
                  </div>
                )}
              </div>
              <div>{new Date(e.mtime).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</div>
              <div>{e.isDir ? '- -' : formatSize(e.size)}</div>
              <div>{kindOf(e)}</div>
            </div>
          ))}
        </div>
      )}
      <ContextMenu menu={menu} onClose={close} />
    </div>
  )
}
