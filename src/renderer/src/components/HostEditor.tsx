import { useEffect, useState } from 'react'
import {
  Eye,
  EyeOff,
  Folder,
  Globe,
  KeyRound,
  Lock,
  Plus,
  Server,
  Tag,
  Trash2,
  User,
  X,
  ChevronDown,
  ChevronUp,
  Route,
  Code2,
  Palette
} from 'lucide-react'
import type { Group, Host } from '@shared/types'
import { errMsg, useStore } from '../store'
import { confirmDialog, Field, GroupIcon, HostIcon, Panel, Select, Switch } from './ui'
import Credentials from './Credentials'
import { IconPicker } from './icons'
import { getTheme, groupThemeSource, THEMES } from '../themes'

export function groupPath(groups: Group[], id?: string | null): string {
  const parts: string[] = []
  const seen = new Set<string>()
  while (id && !seen.has(id)) {
    seen.add(id)
    const g = groups.find((x) => x.id === id)
    if (!g) break
    parts.unshift(g.name)
    id = g.parentId
  }
  return parts.join(' / ')
}

export function groupOptions(groups: Group[], exclude?: string) {
  // A group can't become its own descendant
  const banned = new Set<string>()
  if (exclude) {
    banned.add(exclude)
    let grew = true
    while (grew) {
      grew = false
      for (const g of groups)
        if (g.parentId && banned.has(g.parentId) && !banned.has(g.id)) {
          banned.add(g.id)
          grew = true
        }
    }
  }
  return groups
    .filter((g) => !banned.has(g.id))
    .map((g) => ({ value: g.id, label: groupPath(groups, g.id) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function HostEditor({ initial }: { initial: Partial<Host> }) {
  const { vault, upsert, remove, setEditing, openTab, notify } = useStore()
  const [h, setH] = useState<Partial<Host>>(initial)
  const [pickIcon, setPickIcon] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [more, setMore] = useState(false)
  useEffect(() => setH(initial), [initial])
  if (!vault) return null
  const set = (patch: Partial<Host>) => setH((x) => ({ ...x, ...patch }))
  const close = () => setEditing(null)

  const save = async (): Promise<string | null> => {
    if (!h.address?.trim()) {
      notify('Address is required', true)
      return null
    }
    try {
      const saved = await upsert('hosts', {
        ...h,
        address: h.address.trim(),
        label: h.label?.trim() || '',
        port: h.port ? Number(h.port) : undefined,
        tags: h.tags || []
      })
      setH(saved)
      return saved.id
    } catch (err) {
      notify(errMsg(err), true)
      return null
    }
  }

  const addTag = () => {
    const t = tagInput.trim()
    if (t && !(h.tags || []).includes(t)) set({ tags: [...(h.tags || []), t] })
    setTagInput('')
  }

  const del = async () => {
    if (!h.id) return
    if (await confirmDialog({ title: 'Delete host', message: `Delete "${h.label || h.address}"?`, danger: true, confirm: 'Delete' })) {
      await remove('hosts', h.id)
      close()
    }
  }

  const otherHosts = vault.hosts.filter((x) => x.id !== h.id)

  return (
    <Panel
      title={h.id ? 'Host Details' : 'New Host'}
      onClose={close}
      actions={
        h.id && (
          <button className="icon-btn" title="Delete" onClick={del}>
            <Trash2 size={15} />
          </button>
        )
      }
      footer={
        <>
          <button className="btn soft block" onClick={async () => (await save()) && notify('Host saved')}>
            Save
          </button>
          <button
            className="btn primary block"
            onClick={async () => {
              const id = await save()
              if (id) {
                openTab('ssh', id)
                close()
              }
            }}
          >
            Connect
          </button>
        </>
      }
    >
      <div className="psection">
        <h4>Address</h4>
        <div className="row">
          <button className="tile-btn" title="Change icon" onClick={() => setPickIcon(true)}>
            <HostIcon host={{ ...h, address: h.address || '' } as Host} size="sm" />
          </button>
          {pickIcon && (
            <IconPicker
              icon={h.icon}
              color={h.color}
              autoLabel={h.os ? `${h.os} badge` : 'operating system badge'}
              autoPreview={<HostIcon host={{ ...h, icon: null } as Host} size="sm" />}
              onChange={(p) => set(p)}
              onClose={() => setPickIcon(false)}
            />
          )}
          <div className="grow">
            <Field value={h.address} onChange={(v) => set({ address: v })} placeholder="IP or Hostname" autoFocus={!h.id} />
          </div>
        </div>
      </div>

      <div className="psection">
        <h4>General</h4>
        <Field value={h.label} onChange={(v) => set({ label: v })} placeholder="Label" />
        <Select
          icon={Folder}
          value={h.groupId}
          onChange={(v) => set({ groupId: v })}
          options={groupOptions(vault.groups)}
          placeholder="Parent Group"
        />
        <Field icon={Tag} value={tagInput} onChange={setTagInput} placeholder="Tags (Enter to add)" onEnter={addTag} />
        {(h.tags || []).length > 0 && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {(h.tags || []).map((t) => (
              <span key={t} className="chip">
                {t}
                <button onClick={() => set({ tags: (h.tags || []).filter((x) => x !== t) })}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="psection">
        <div className="row">
          <span>SSH on</span>
          <label className="input small">
            <input
              value={h.port ?? ''}
              placeholder="22"
              onChange={(e) => set({ port: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined })}
            />
          </label>
          <span>port</span>
        </div>
        <h4>Credentials</h4>
        <Credentials value={h} onChange={set} parentGroupId={h.groupId} />
        <button className="link" style={{ color: 'var(--text-2)' }} onClick={() => setMore(!more)}>
          Show {more ? 'less' : 'more'} {more ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {more && (
          <>
            <Select
              icon={Route}
              value={h.jumpHostId}
              onChange={(v) => set({ jumpHostId: v })}
              options={otherHosts.map((x) => ({ value: x.id, label: x.label || x.address }))}
              placeholder="Jump host (none)"
            />
            <Select
              icon={Code2}
              value={h.startupSnippetId}
              onChange={(v) => set({ startupSnippetId: v })}
              options={vault.snippets.map((s) => ({ value: s.id, label: s.label }))}
              placeholder="Startup snippet (none)"
            />
            <Select
              icon={Palette}
              value={h.theme}
              onChange={(v) => set({ theme: v })}
              options={THEMES.map((t) => ({ value: t.id, label: `${t.name}${t.dark ? '' : ' (light)'}` }))}
              placeholder={(() => {
                const src = groupThemeSource(vault, h.groupId)
                return `Theme: inherit ${getTheme(src.id).name}${src.group ? ` (group ${src.group.name})` : ' (default)'}`
              })()}
            />
            <Field
              icon={Globe}
              value={h.keepAliveInterval}
              onChange={(v) => set({ keepAliveInterval: v ? Number(v.replace(/\D/g, '')) : undefined })}
              placeholder="Keep-alive interval"
              suffix="sec"
            />
            <label className="row" style={{ justifyContent: 'space-between' }}>
              <span>Agent forwarding</span>
              <Switch on={!!h.agentForwarding} onChange={(v) => set({ agentForwarding: v })} />
            </label>
          </>
        )}
      </div>
    </Panel>
  )
}

export function GroupEditor({ initial }: { initial: Partial<Group> }) {
  const { vault, upsert, remove, setEditing, notify } = useStore()
  const [g, setG] = useState<Partial<Group>>(initial)
  const [pickIcon, setPickIcon] = useState(false)
  useEffect(() => setG(initial), [initial])
  if (!vault) return null
  const set = (patch: Partial<Group>) => setG((x) => ({ ...x, ...patch }))
  const close = () => setEditing(null)

  const save = async () => {
    if (!g.name?.trim()) return notify('Name is required', true)
    const saved = await upsert('groups', { ...g, name: g.name.trim(), port: g.port ? Number(g.port) : undefined })
    setG(saved)
    notify('Group saved')
  }
  const del = async () => {
    if (!g.id) return
    const ok = await confirmDialog({
      title: 'Delete group',
      message: `Delete "${g.name}"? Its hosts and subgroups move to the parent group.`,
      danger: true,
      confirm: 'Delete'
    })
    if (ok) {
      await remove('groups', g.id)
      close()
    }
  }

  return (
    <Panel
      title={g.id ? 'Group Details' : 'New Group'}
      onClose={close}
      actions={
        g.id && (
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
        <div className="row">
          <button className="tile-btn" title="Change icon" onClick={() => setPickIcon(true)}>
            <GroupIcon group={g} size="sm" />
          </button>
          {pickIcon && (
            <IconPicker
              icon={g.icon}
              color={g.color}
              autoLabel="folder"
              autoPreview={<GroupIcon size="sm" />}
              onChange={(p) => set(p)}
              onClose={() => setPickIcon(false)}
            />
          )}
          <div className="grow">
            <Field value={g.name} onChange={(v) => set({ name: v })} placeholder="Name" autoFocus={!g.id} onEnter={save} />
          </div>
        </div>
        <Select
          icon={Folder}
          value={g.parentId}
          onChange={(v) => set({ parentId: v })}
          options={groupOptions(vault.groups, g.id)}
          placeholder="Parent Group"
        />
      </div>
      <div className="psection">
        <h4>Defaults for hosts in this group</h4>
        <p className="hint">Hosts and subgroups set to “Use parent credentials” use these, as well as this port and jump host when they leave them empty.</p>
        <div className="row">
          <span>SSH on</span>
          <label className="input small">
            <input
              value={g.port ?? ''}
              placeholder="22"
              onChange={(e) => set({ port: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined })}
            />
          </label>
          <span>port</span>
        </div>
        <Credentials value={g} onChange={set} parentGroupId={g.parentId} />
        <Select
          icon={Route}
          value={g.jumpHostId}
          onChange={(v) => set({ jumpHostId: v })}
          options={vault.hosts.map((x) => ({ value: x.id, label: x.label || x.address }))}
          placeholder="Jump host (none)"
        />
        <Select
          icon={Palette}
          value={g.theme}
          onChange={(v) => set({ theme: v })}
          options={THEMES.map((t) => ({ value: t.id, label: `${t.name}${t.dark ? '' : ' (light)'}` }))}
          placeholder={(() => {
            const src = groupThemeSource(vault, g.parentId)
            return `Terminal theme: inherit ${getTheme(src.id).name}${src.group ? ` (group ${src.group.name})` : ' (default)'}`
          })()}
        />
      </div>
    </Panel>
  )
}
