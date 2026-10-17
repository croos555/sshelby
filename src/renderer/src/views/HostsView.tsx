import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileInput,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Server,
  SquareTerminal,
  FolderSync,
  Trash2,
  ArrowDownAZ,
  Clock
} from 'lucide-react'
import type { Group, Host } from '@shared/types'
import { errMsg, useStore } from '../store'
import { confirmDialog, ContextMenu, Empty, GroupIcon, HostIcon, useMenu } from '../components/ui'
import { groupPath } from '../components/HostEditor'

function parseQuick(q: string): Partial<Host> | null {
  // ssh user@host -p 2222 | user@host:2222 | host
  const s = q.trim().replace(/^ssh\s+/, '')
  const pFlag = s.match(/-p\s*(\d+)/)
  const rest = s.replace(/-p\s*\d+/, '').trim()
  const m = rest.match(/^(?:([^@\s]+)@)?([^\s:@]+)(?::(\d+))?$/)
  if (!m) return null
  return { username: m[1], address: m[2], port: Number(pFlag?.[1] || m[3]) || undefined }
}

export default function HostsView() {
  const { vault, editing, setEditing, openTab, upsert, remove, currentGroup, setCurrentGroup, notify, load } =
    useStore()
  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [sort, setSort] = useState<'name' | 'recent'>('name')
  const [newMenu, setNewMenu] = useState(false)
  const { menu, open, close } = useMenu()

  const { groups, hosts } = useMemo(() => {
    if (!vault) return { groups: [] as Group[], hosts: [] as Host[] }
    const q = query.trim().toLowerCase()
    const sorter = (a: Host, b: Host) =>
      sort === 'recent'
        ? (b.lastConnectedAt || 0) - (a.lastConnectedAt || 0)
        : (a.label || a.address).localeCompare(b.label || b.address)
    if (q) {
      // Search spans every group
      const hosts = vault.hosts.filter((h) =>
        [h.label, h.address, h.username, ...(h.tags || [])].some((v) => v?.toLowerCase().includes(q))
      )
      const groups = vault.groups.filter((g) => g.name.toLowerCase().includes(q))
      return { groups, hosts: hosts.sort(sorter) }
    }
    return {
      groups: vault.groups
        .filter((g) => (g.parentId || null) === currentGroup)
        .sort((a, b) => a.name.localeCompare(b.name)),
      hosts: vault.hosts.filter((h) => (h.groupId || null) === currentGroup).sort(sorter)
    }
  }, [vault, query, currentGroup, sort])

  if (!vault) return null

  const countHosts = (gid: string): number =>
    vault.hosts.filter((h) => h.groupId === gid).length +
    vault.groups.filter((g) => g.parentId === gid).reduce((n, g) => n + countHosts(g.id), 0)

  const crumbs: Group[] = []
  {
    let id = currentGroup
    const seen = new Set<string>()
    while (id && !seen.has(id)) {
      seen.add(id)
      const g = vault.groups.find((x) => x.id === id)
      if (!g) break
      crumbs.unshift(g)
      id = g.parentId || null
    }
  }

  const quickConnect = async () => {
    const parsed = parseQuick(query)
    if (!parsed?.address) return
    const existing = vault.hosts.find(
      (h) => h.address === parsed.address && (!parsed.username || h.username === parsed.username)
    )
    const host = existing || (await upsert('hosts', { ...parsed, label: '', tags: [], groupId: currentGroup }))
    openTab('ssh', host.id)
    setQuery('')
  }

  const importSshConfig = async () => {
    try {
      const n = await window.api.vault.importSshConfig()
      await load()
      notify(n ? `Imported ${n} host${n > 1 ? 's' : ''} from ~/.ssh/config` : 'No new hosts found in ~/.ssh/config')
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const hostMenu = (e: React.MouseEvent, h: Host) =>
    open(e, [
      { label: 'Connect', icon: SquareTerminal, onClick: () => openTab('ssh', h.id) },
      { label: 'Open SFTP', icon: FolderSync, onClick: () => openTab('sftp', h.id) },
      '-',
      { label: 'Edit', icon: Pencil, onClick: () => setEditing({ kind: 'host', item: h }) },
      {
        label: 'Duplicate',
        icon: Copy,
        onClick: async () => {
          const { id, lastConnectedAt, createdAt, ...rest } = h
          const copy = await upsert('hosts', { ...rest, label: (h.label || h.address) + ' copy' })
          setEditing({ kind: 'host', item: copy })
        }
      },
      '-',
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Delete host',
            message: `Delete "${h.label || h.address}"?`,
            danger: true,
            confirm: 'Delete'
          })
          if (ok) {
            await remove('hosts', h.id)
            setEditing(null)
          }
        }
      }
    ])

  const groupMenu = (e: React.MouseEvent, g: Group) =>
    open(e, [
      { label: 'Open', icon: FolderOpen, onClick: () => setCurrentGroup(g.id) },
      { label: 'Edit', icon: Pencil, onClick: () => setEditing({ kind: 'group', item: g }) },
      {
        label: 'New host in group',
        icon: Plus,
        onClick: () => setEditing({ kind: 'host', item: { groupId: g.id, tags: [] } })
      },
      '-',
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'Delete group',
            message: `Delete "${g.name}"? Its hosts and subgroups move to the parent group.`,
            danger: true,
            confirm: 'Delete'
          })
          if (ok) {
            await remove('groups', g.id)
            setEditing(null)
          }
        }
      }
    ])

  const selectedId = editing && (editing.kind === 'host' || editing.kind === 'group') ? editing.item.id : undefined
  const isEmpty = !groups.length && !hosts.length

  return (
    <div className="main">
      <div className="searchbar">
        <div className="field">
          <input
            placeholder="Find a host or ssh user@hostname..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && quickConnect()}
          />
          <button className="btn soft" disabled={!parseQuick(query)} onClick={quickConnect} style={{ height: 26 }}>
            Connect
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="btn-group" style={{ position: 'relative' }}>
          <button className="btn soft" onClick={() => setEditing({ kind: 'host', item: { groupId: currentGroup, tags: [] } })}>
            <Plus size={15} /> New host
          </button>
          <button className="btn soft" onClick={() => setNewMenu(!newMenu)} onBlur={() => setTimeout(() => setNewMenu(false), 150)}>
            <ChevronDown size={14} />
          </button>
          {newMenu && (
            <div className="menu" style={{ position: 'absolute', top: 34, left: 0 }}>
              <button onClick={() => setEditing({ kind: 'group', item: { parentId: currentGroup } })}>
                <FolderPlus size={14} /> New group
              </button>
              <button onClick={importSshConfig}>
                <FileInput size={14} /> Import ~/.ssh/config
              </button>
            </div>
          )}
        </div>
        <button className="btn" onClick={() => openTab('sftp')}>
          <FolderSync size={15} /> SFTP
        </button>
        <div className="grow" />
        <button
          className="icon-btn"
          title={sort === 'name' ? 'Sorted by name' : 'Sorted by last connection'}
          onClick={() => setSort(sort === 'name' ? 'recent' : 'name')}
        >
          {sort === 'name' ? <ArrowDownAZ size={16} /> : <Clock size={16} />}
        </button>
        <button className="icon-btn" title="Change layout" onClick={() => setLayout(layout === 'grid' ? 'list' : 'grid')}>
          {layout === 'grid' ? <List size={16} /> : <LayoutGrid size={16} />}
        </button>
      </div>

      <div className="content" onClick={() => setEditing(null)}>
        {crumbs.length > 0 && !query && (
          <div className="crumbs">
            <button onClick={() => setCurrentGroup(null)}>All hosts</button>
            {crumbs.map((g) => (
              <span key={g.id} className="row" style={{ gap: 4 }}>
                <ChevronRight size={14} className="sep" />
                <button onClick={() => setCurrentGroup(g.id)}>{g.name}</button>
              </span>
            ))}
          </div>
        )}

        {isEmpty ? (
          query ? (
            <Empty icon={Server} title="No matches" text={`Press Enter to connect to "${query}".`} />
          ) : (
            <Empty
              icon={Server}
              title={currentGroup ? 'This group is empty' : 'Create a host'}
              text="Save hosts to connect to your servers in one click, or import them from ~/.ssh/config."
              action={
                <div className="row">
                  <button
                    className="btn primary"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing({ kind: 'host', item: { groupId: currentGroup, tags: [] } })
                    }}
                  >
                    <Plus size={15} /> New host
                  </button>
                  {!currentGroup && (
                    <button
                      className="btn soft"
                      onClick={(e) => {
                        e.stopPropagation()
                        importSshConfig()
                      }}
                    >
                      Import ~/.ssh/config
                    </button>
                  )}
                </div>
              }
            />
          )
        ) : (
          <>
            {groups.length > 0 && (
              <>
                <div className="section-title">Groups</div>
                <div className={`grid ${layout === 'list' ? 'list' : ''}`}>
                  {groups.map((g) => (
                    <div
                      key={g.id}
                      className={`card ${selectedId === g.id ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing({ kind: 'group', item: g })
                      }}
                      onDoubleClick={() => {
                        setQuery('')
                        setCurrentGroup(g.id)
                        setEditing(null)
                      }}
                      onContextMenu={(e) => groupMenu(e, g)}
                    >
                      <GroupIcon />
                      <div className="meta">
                        <div className="name">{g.name}</div>
                        <div className="sub">
                          {query && g.parentId ? groupPath(vault.groups, g.parentId) + ' · ' : ''}
                          {countHosts(g.id)} Host{countHosts(g.id) === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {hosts.length > 0 && (
              <>
                <div className="section-title">Hosts</div>
                <div className={`grid ${layout === 'list' ? 'list' : ''}`}>
                  {hosts.map((h) => (
                    <div
                      key={h.id}
                      className={`card ${selectedId === h.id ? 'selected' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing({ kind: 'host', item: h })
                      }}
                      onDoubleClick={() => openTab('ssh', h.id)}
                      onContextMenu={(e) => hostMenu(e, h)}
                    >
                      <HostIcon host={h} />
                      <div className="meta">
                        <div className="name">{h.label || h.address}</div>
                        <div className="sub">
                          ssh{h.username ? `, ${h.username}` : ''}
                          {query && h.groupId ? ` · ${groupPath(vault.groups, h.groupId)}` : ''}
                          {h.tags?.length ? ` · ${h.tags.join(', ')}` : ''}
                        </div>
                      </div>
                      <div className="actions">
                        <button
                          className="icon-btn"
                          title="SFTP"
                          onClick={(e) => {
                            e.stopPropagation()
                            openTab('sftp', h.id)
                          }}
                        >
                          <FolderSync size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Connect"
                          onClick={(e) => {
                            e.stopPropagation()
                            openTab('ssh', h.id)
                          }}
                        >
                          <SquareTerminal size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      <ContextMenu menu={menu} onClose={close} />
    </div>
  )
}
