import {
  ArrowRightLeft,
  Download,
  FileInput,
  FolderPlus,
  IdCard,
  KeyRound,
  Pencil,
  Plus,
  Server,
  SquareTerminal,
  Upload,
  Folder
} from 'lucide-react'
import { errMsg, importMobaXterm, useStore } from '../store'
import { GroupIcon } from './ui'
import { groupPath } from './HostEditor'

// Right panel of the Hosts screen when nothing is selected: it stays in place so the grid
// doesn't reflow between the two clicks of a double-click.
export default function HostsOverview() {
  const { vault, currentGroup, setEditing, setModal, setView, tabs, forwardStatus, notify, load } = useStore()
  if (!vault) return null
  const group = currentGroup ? vault.groups.find((g) => g.id === currentGroup) : undefined

  const countHosts = (gid: string): number =>
    vault.hosts.filter((h) => h.groupId === gid).length +
    vault.groups.filter((g) => g.parentId === gid).reduce((n, g) => n + countHosts(g.id), 0)

  const sessions = tabs.filter((t) => t.kind === 'ssh' && t.status === 'connected').length
  const forwards = Object.values(forwardStatus).filter((f) => f.state === 'running').length

  const importSshConfig = async () => {
    try {
      const n = await window.api.vault.importSshConfig()
      await load()
      notify(n ? `Imported ${n} host${n > 1 ? 's' : ''} from ~/.ssh/config` : 'No new hosts found in ~/.ssh/config')
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  const stat = (icon: React.ReactNode, value: number, label: string, onClick?: () => void) => (
    <button className="ov-stat" onClick={onClick} disabled={!onClick}>
      {icon}
      <b>{value}</b>
      <span>{label}</span>
    </button>
  )

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="title">{group ? group.name : 'Overview'}</span>
      </div>
      <div className="panel-body">
        {group && (
          <div className="psection">
            <div className="row">
              <GroupIcon group={group} size="sm" />
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{group.name}</div>
                <div className="hint">
                  {group.parentId ? `${groupPath(vault.groups, group.parentId)} · ` : ''}
                  {countHosts(group.id)} host{countHosts(group.id) === 1 ? '' : 's'}
                </div>
              </div>
              <button className="icon-btn" title="Edit group" onClick={() => setEditing({ kind: 'group', item: group })}>
                <Pencil size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="psection">
          <h4>Create</h4>
          <button
            className="btn primary block"
            onClick={() => setEditing({ kind: 'host', item: { groupId: currentGroup, tags: [] } })}
          >
            <Plus size={15} /> New host{group ? ' in this group' : ''}
          </button>
          <button className="btn soft block" onClick={() => setEditing({ kind: 'group', item: { parentId: currentGroup } })}>
            <FolderPlus size={15} /> New group{group ? ' inside' : ''}
          </button>
          <button className="btn soft block" onClick={() => setEditing({ kind: 'identity', item: { authType: 'password' } })}>
            <IdCard size={15} /> New identity
          </button>
        </div>

        <div className="psection">
          <h4>Vault</h4>
          <div className="ov-stats">
            {stat(<Server size={15} />, vault.hosts.length, 'hosts')}
            {stat(<Folder size={15} />, vault.groups.length, 'groups')}
            {stat(<KeyRound size={15} />, vault.keys.length, 'keys', () => setView('keychain'))}
            {stat(<IdCard size={15} />, vault.identities.length, 'identities', () => setView('keychain'))}
            {stat(<SquareTerminal size={15} />, sessions, 'open sessions')}
            {stat(<ArrowRightLeft size={15} />, forwards, 'active forwards', () => setView('forwards'))}
          </div>
        </div>

        <div className="psection">
          <h4>Import & export</h4>
          <button className="btn soft block" onClick={importSshConfig}>
            <FileInput size={15} /> Import ~/.ssh/config
          </button>
          <button className="btn soft block" onClick={importMobaXterm}>
            <FileInput size={15} /> Import from MobaXterm…
          </button>
          <div className="row">
            <button className="btn soft grow" onClick={() => setModal('import')}>
              <Download size={15} /> Import…
            </button>
            <button className="btn soft grow" onClick={() => setModal('export')}>
              <Upload size={15} /> Export…
            </button>
          </div>
        </div>

        <div className="psection">
          <h4>Tips</h4>
          <ul className="ov-tips">
            <li>Double-click a host to connect, a group to open it.</li>
            <li>Right-click for SFTP, duplicate, delete…</li>
            <li>Type <code>user@host:port</code> in the search bar and press Enter to connect right away.</li>
            <li>Tree view: drag hosts and groups to reorganize them.</li>
            <li>
              <kbd>{window.api.platform === 'darwin' ? '⌘' : 'Ctrl'}</kbd>+<kbd>1…9</kbd> switches tabs,{' '}
              <kbd>{window.api.platform === 'darwin' ? '⌘' : 'Ctrl'}</kbd>+<kbd>W</kbd> closes one.
            </li>
          </ul>
        </div>
      </div>
    </aside>
  )
}
