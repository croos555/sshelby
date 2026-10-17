import { useEffect } from 'react'
import {
  ArrowRightLeft,
  Braces,
  Fingerprint,
  FolderSync,
  KeyRound,
  LayoutGrid,
  Plus,
  Server,
  Settings as SettingsIcon,
  X
} from 'lucide-react'
import { useStore, View } from './store'
import HostsView from './views/HostsView'
import KeychainView, { IdentityEditor, KeepassEditor, KeyEditor } from './views/KeychainView'
import ForwardsView, { ForwardEditor } from './views/ForwardsView'
import { KnownHostsView, SettingsView, SnippetEditor, SnippetsView } from './views/MiscViews'
import { GroupEditor, HostEditor } from './components/HostEditor'
import TerminalTab from './components/TerminalTab'
import SftpTab from './components/SftpTab'
import PromptModal from './components/PromptModal'
import { ConfirmHost, PromptHost } from './components/ui'
import { ExportModal, ImportModal } from './components/TransferModals'
import { osBadge } from './themes'

const NAV: { id: View; label: string; icon: typeof Server }[] = [
  { id: 'hosts', label: 'Hosts', icon: Server },
  { id: 'keychain', label: 'Keychain', icon: KeyRound },
  { id: 'forwards', label: 'Port Forwarding', icon: ArrowRightLeft },
  { id: 'snippets', label: 'Snippets', icon: Braces },
  { id: 'knownHosts', label: 'Known Hosts', icon: Fingerprint }
]

function useAppearance(appearance: 'system' | 'light' | 'dark' | undefined) {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = appearance === 'dark' || (appearance !== 'light' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [appearance])
}

export default function App() {
  const { vault, load, view, setView, tabs, activeTab, setActiveTab, closeTab, editing, toast, openTab, modal, setModal } =
    useStore()

  useEffect(() => {
    load()
  }, [load])
  useAppearance(vault?.settings.appearance)

  // Tab shortcuts: Cmd/Ctrl+W closes, Cmd/Ctrl+1..9 switches (1 = vault)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey
      if (!mod) return
      const { tabs, activeTab } = useStore.getState()
      if (e.key === 'w' && activeTab) {
        e.preventDefault()
        closeTab(activeTab)
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const n = Number(e.key)
        if (n === 1) setActiveTab(null)
        else if (tabs[n - 2]) setActiveTab(tabs[n - 2].id)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeTab, setActiveTab])

  if (!vault) return <div className="app" />

  const editor =
    editing?.kind === 'host' ? (
      <HostEditor initial={editing.item} />
    ) : editing?.kind === 'group' ? (
      <GroupEditor initial={editing.item} />
    ) : editing?.kind === 'key' ? (
      <KeyEditor initial={editing.item} />
    ) : editing?.kind === 'identity' ? (
      <IdentityEditor initial={editing.item} />
    ) : editing?.kind === 'keepass' ? (
      <KeepassEditor initial={editing.item} />
    ) : editing?.kind === 'forward' ? (
      <ForwardEditor initial={editing.item} />
    ) : editing?.kind === 'snippet' ? (
      <SnippetEditor initial={editing.item} />
    ) : null

  return (
    <div className="app">
      <div className={`titlebar ${window.api.platform === 'darwin' ? 'mac' : ''}`}>
        <button className={`tab ${activeTab === null ? 'active' : ''}`} onClick={() => setActiveTab(null)}>
          <LayoutGrid size={14} />
          <span className="title">Vault</span>
        </button>
        {/* Permanent SFTP entry like Termius: focuses the first SFTP tab, creating it if needed */}
        {!tabs.some((t) => t.kind === 'sftp') && (
          <button className="tab" onClick={() => openTab('sftp')}>
            <FolderSync size={14} />
            <span className="title">SFTP</span>
          </button>
        )}
        {tabs.map((t) => {
          const host = vault.hosts.find((h) => h.id === t.hostId)
          return (
            <button
              key={t.id}
              className={`tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id)}
              onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
              title={t.title}
            >
              {t.kind === 'sftp' ? (
                <FolderSync size={14} />
              ) : (
                <span
                  className="icon-tile"
                  style={{ width: 16, height: 16, borderRadius: 4, fontSize: 9, background: osBadge(host?.os).color }}
                >
                  {osBadge(host?.os).letter || <Server size={10} />}
                </span>
              )}
              <span className="title">{t.title}</span>
              {t.kind === 'ssh' && <span className={`dot ${t.status}`} />}
              <span
                className="close"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
              >
                <X size={12} />
              </span>
            </button>
          )
        })}
        <button className="tab-add" title="New SFTP tab" onClick={() => openTab('sftp')}>
          <Plus size={16} />
        </button>
        <div className="spacer" />
      </div>

      <div className="body">
        {activeTab === null && (
          <>
            <nav className="sidebar">
              {NAV.map((n) => (
                <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)}>
                  <n.icon size={16} />
                  {n.label}
                </button>
              ))}
              <div className="grow" />
              <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
                <SettingsIcon size={16} />
                Settings
              </button>
            </nav>
            {view === 'hosts' && <HostsView />}
            {view === 'keychain' && <KeychainView />}
            {view === 'forwards' && <ForwardsView />}
            {view === 'snippets' && <SnippetsView />}
            {view === 'knownHosts' && <KnownHostsView />}
            {view === 'settings' && <SettingsView />}
            {editor}
          </>
        )}
        {/* Sessions stay mounted so terminals keep their state while hidden */}
        <div style={{ position: 'absolute', inset: 0, display: activeTab ? 'block' : 'none' }}>
          {tabs.map((t) =>
            t.kind === 'ssh' ? (
              <TerminalTab key={t.id} tab={t} active={activeTab === t.id} />
            ) : (
              <SftpTab key={t.id} tab={t} active={activeTab === t.id} />
            )
          )}
        </div>
      </div>

      {modal === 'export' && <ExportModal onClose={() => setModal(null)} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} />}
      <PromptModal />
      <ConfirmHost />
      <PromptHost />
      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.message}</div>}
    </div>
  )
}
