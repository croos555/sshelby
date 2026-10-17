import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderSync, Plus, SquareTerminal } from 'lucide-react'
import type { Group, Host, Vault } from '@shared/types'
import { GroupIcon, HostIcon } from './ui'

const STORE_KEY = 'sshelby.tree.collapsed'

// Collapsed groups are remembered per viewer (localStorage may be unavailable: then everything starts expanded)
function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'))
  } catch {
    return new Set()
  }
}
function saveCollapsed(s: Set<string>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...s]))
  } catch {
    // not persisted, fine
  }
}

type Drag = { kind: 'host' | 'group'; id: string }

interface Props {
  vault: Vault
  query: string
  sortHosts: (a: Host, b: Host) => number
  selectedId?: string
  credLabel: (h: Host) => string
  onSelect: (item: { kind: 'host'; item: Host } | { kind: 'group'; item: Group }) => void
  onOpenHost: (h: Host) => void
  onSftp: (h: Host) => void
  onNewHost: (groupId: string) => void
  onHostMenu: (e: React.MouseEvent, h: Host) => void
  onGroupMenu: (e: React.MouseEvent, g: Group) => void
  onMove: (drag: Drag, groupId: string | null) => void
}

export default function HostTree(props: Props) {
  const { vault, query } = props
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [dragging, setDragging] = useState<Drag | null>(null)

  const setAll = (next: Set<string>) => {
    setCollapsed(next)
    saveCollapsed(next)
  }
  const toggle = (id: string) => {
    const next = new Set(collapsed)
    next.has(id) ? next.delete(id) : next.add(id)
    setAll(next)
  }

  // While searching: only matches and their ancestors are shown, all expanded
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    const keep = new Set<string>()
    const addAncestors = (gid?: string | null) => {
      while (gid && !keep.has(gid)) {
        keep.add(gid)
        gid = vault.groups.find((g) => g.id === gid)?.parentId
      }
    }
    for (const h of vault.hosts) {
      if ([h.label, h.address, h.username, ...(h.tags || [])].some((v) => v?.toLowerCase().includes(q))) {
        keep.add(h.id)
        addAncestors(h.groupId)
      }
    }
    for (const g of vault.groups) {
      if (g.name.toLowerCase().includes(q)) {
        keep.add(g.id)
        addAncestors(g.parentId)
        // a matching group shows its whole content
        const addSubtree = (gid: string) => {
          for (const h of vault.hosts) if (h.groupId === gid) keep.add(h.id)
          for (const c of vault.groups) if (c.parentId === gid) {
            keep.add(c.id)
            addSubtree(c.id)
          }
        }
        addSubtree(g.id)
      }
    }
    return keep
  }, [query, vault])

  const countHosts = (gid: string): number =>
    vault.hosts.filter((h) => h.groupId === gid).length +
    vault.groups.filter((g) => g.parentId === gid).reduce((n, g) => n + countHosts(g.id), 0)

  // A group can't be dropped into itself or one of its descendants
  const isInside = (gid: string | null, ancestor: string): boolean => {
    const seen = new Set<string>()
    while (gid && !seen.has(gid)) {
      if (gid === ancestor) return true
      seen.add(gid)
      gid = vault.groups.find((g) => g.id === gid)?.parentId || null
    }
    return false
  }
  const canDrop = (target: string | null) =>
    !!dragging && !(dragging.kind === 'group' && target && isInside(target, dragging.id))

  const dropProps = (target: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canDrop(target)) return
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(target ?? 'root')
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(null)
      if (dragging && canDrop(target)) props.onMove(dragging, target)
      setDragging(null)
    }
  })

  const dragProps = (d: Drag) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', d.id)
      setDragging(d)
    },
    onDragEnd: () => {
      setDragging(null)
      setDropTarget(null)
    }
  })

  const renderLevel = (parent: string | null, depth: number): React.ReactNode => {
    const groups = vault.groups
      .filter((g) => (g.parentId || null) === parent && (!visible || visible.has(g.id)))
      .sort((a, b) => a.name.localeCompare(b.name))
    const hosts = vault.hosts
      .filter((h) => (h.groupId || null) === parent && (!visible || visible.has(h.id)))
      .sort(props.sortHosts)
    return (
      <>
        {groups.map((g) => {
          const open = !!visible || !collapsed.has(g.id)
          const n = countHosts(g.id)
          return (
            <div key={g.id}>
              <div
                className={`tv-row group ${props.selectedId === g.id ? 'selected' : ''} ${dropTarget === g.id ? 'drop' : ''}`}
                style={{ paddingLeft: 8 + depth * 20 }}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onSelect({ kind: 'group', item: g })
                }}
                onDoubleClick={() => toggle(g.id)}
                onContextMenu={(e) => props.onGroupMenu(e, g)}
                {...dragProps({ kind: 'group', id: g.id })}
                {...dropProps(g.id)}
              >
                <button
                  className="tv-chevron"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(g.id)
                  }}
                >
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {g.icon ? (
                  <GroupIcon group={g} size="sm" />
                ) : (
                  <span className="tv-folder">{open ? <FolderOpen size={15} /> : <Folder size={15} />}</span>
                )}
                <span className="tv-name">{g.name}</span>
                <span className="tv-count">{n}</span>
                <span className="tv-actions">
                  <button
                    className="icon-btn"
                    title="New host in group"
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onNewHost(g.id)
                    }}
                  >
                    <Plus size={14} />
                  </button>
                </span>
              </div>
              {open && renderLevel(g.id, depth + 1)}
            </div>
          )
        })}
        {hosts.map((h) => (
          <div
            key={h.id}
            className={`tv-row host ${props.selectedId === h.id ? 'selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 20 + 22 }}
            onClick={(e) => {
              e.stopPropagation()
              props.onSelect({ kind: 'host', item: h })
            }}
            onDoubleClick={() => props.onOpenHost(h)}
            onContextMenu={(e) => props.onHostMenu(e, h)}
            {...dragProps({ kind: 'host', id: h.id })}
            // Dropping on a host means "into the same group"
            {...dropProps(h.groupId || null)}
          >
            <HostIcon host={h} size="sm" />
            <span className="tv-name">{h.label || h.address}</span>
            <span className="tv-sub">
              {h.label ? h.address : ''}
              {props.credLabel(h).replace(/^, /, h.label ? ' · ' : '')}
            </span>
            <span className="tv-actions">
              <button
                className="icon-btn"
                title="SFTP"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onSftp(h)
                }}
              >
                <FolderSync size={14} />
              </button>
              <button
                className="icon-btn"
                title="Connect"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onOpenHost(h)
                }}
              >
                <SquareTerminal size={14} />
              </button>
            </span>
          </div>
        ))}
      </>
    )
  }

  const empty = visible ? visible.size === 0 : !vault.groups.length && !vault.hosts.length
  return (
    <div className="tree-view">
      {!visible && vault.groups.length > 0 && (
        <div className="tv-tools">
          <button className="link" onClick={() => setAll(new Set())}>
            Expand all
          </button>
          <button className="link" onClick={() => setAll(new Set(vault.groups.map((g) => g.id)))}>
            Collapse all
          </button>
        </div>
      )}
      <div className={`tv-root ${dropTarget === 'root' ? 'drop' : ''}`} {...dropProps(null)}>
        {empty ? <p className="hint" style={{ padding: 12 }}>{visible ? 'No matches.' : 'No hosts yet.'}</p> : renderLevel(null, 0)}
        {dragging && <div className="tv-root-hint">Drop here to move to the top level</div>}
      </div>
    </div>
  )
}
