import { create } from 'zustand'
import type {
  Collection,
  ForwardStatus,
  Group,
  Host,
  PortForward,
  Settings,
  SshKey,
  Snippet,
  TransferProgress,
  Vault
} from '@shared/types'

export type View = 'hosts' | 'keychain' | 'forwards' | 'snippets' | 'knownHosts' | 'sftp' | 'settings'

export interface Tab {
  id: string
  kind: 'ssh' | 'sftp'
  // ssh: the host; sftp: host preselected in the right-hand pane (optional)
  hostId?: string
  title: string
  status: 'connecting' | 'connected' | 'closed' | 'error'
}

// What the right-hand editor panel is showing, if anything
export type Editing =
  | { kind: 'host'; item: Partial<Host> }
  | { kind: 'group'; item: Partial<Group> }
  | { kind: 'key'; item: Partial<SshKey> }
  | { kind: 'forward'; item: Partial<PortForward> }
  | { kind: 'snippet'; item: Partial<Snippet> }
  | null

interface State {
  vault: Vault | null
  view: View
  tabs: Tab[]
  activeTab: string | null // null = vault screen
  editing: Editing
  currentGroup: string | null
  forwardStatus: Record<string, ForwardStatus>
  transfers: Record<string, TransferProgress>
  toast: { message: string; error?: boolean } | null

  load(): Promise<void>
  upsert<T extends { id?: string; [k: string]: any }>(col: Collection, item: T): Promise<T & { id: string }>
  remove(col: Collection, id: string): Promise<void>
  saveSettings(patch: Partial<Settings>): Promise<void>
  setView(v: View): void
  setEditing(e: Editing): void
  setCurrentGroup(id: string | null): void
  openTab(kind: Tab['kind'], hostId?: string): void
  closeTab(id: string): void
  setActiveTab(id: string | null): void
  updateTab(id: string, patch: Partial<Tab>): void
  notify(message: string, error?: boolean): void
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useStore = create<State>((set, get) => ({
  vault: null,
  view: 'hosts',
  tabs: [],
  activeTab: null,
  editing: null,
  currentGroup: null,
  forwardStatus: {},
  transfers: {},
  toast: null,

  async load() {
    set({ vault: await window.api.vault.get() })
  },
  async upsert(col, item) {
    const saved = await window.api.vault.upsert(col, item)
    await get().load()
    return saved
  },
  async remove(col, id) {
    await window.api.vault.remove(col, id)
    await get().load()
  },
  async saveSettings(patch) {
    const settings = await window.api.vault.settings(patch)
    set((s) => ({ vault: s.vault && { ...s.vault, settings } }))
  },
  setView: (view) => set({ view, editing: null, activeTab: null }),
  setEditing: (editing) => set({ editing }),
  setCurrentGroup: (currentGroup) => set({ currentGroup }),
  openTab(kind, hostId) {
    const host = get().vault?.hosts.find((h) => h.id === hostId)
    const tab: Tab = {
      id: crypto.randomUUID(),
      kind,
      hostId,
      title: kind === 'sftp' ? 'SFTP' : host?.label || host?.address || 'Session',
      status: kind === 'sftp' ? 'connected' : 'connecting'
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id }))
  },
  closeTab(id) {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeTab = s.activeTab
      if (activeTab === id) activeTab = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null
      return { tabs, activeTab }
    })
  },
  setActiveTab: (activeTab) => set({ activeTab }),
  updateTab: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  notify(message, error) {
    clearTimeout(toastTimer)
    set({ toast: { message, error } })
    toastTimer = setTimeout(() => set({ toast: null }), 3500)
  }
}))

// Global listeners for events pushed from the main process
window.api.forwards.onStatus((st) =>
  useStore.setState((s) => ({ forwardStatus: { ...s.forwardStatus, [st.forwardId]: st } }))
)
window.api.forwards.statuses().then((list) =>
  useStore.setState({ forwardStatus: Object.fromEntries(list.map((x) => [x.forwardId, x])) })
)
window.api.vault.onChanged(() => useStore.getState().load())
window.api.sftp.onTransfer((t) => useStore.setState((s) => ({ transfers: { ...s.transfers, [t.transferId]: t } })))

export function errMsg(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err)
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
