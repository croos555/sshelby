export interface Group {
  id: string
  name: string
  // Custom icon (name from the renderer's icon set) and tile color; empty = default folder
  icon?: string | null
  color?: string | null
  parentId?: string | null
  // Defaults inherited by hosts (and subgroups) that leave these empty
  username?: string
  port?: number
  password?: string
  keyId?: string | null
  identityId?: string | null
  // Take credentials from the parent group instead of the fields above
  inheritCredentials?: boolean
  jumpHostId?: string | null
  createdAt: number
}

export interface Host {
  id: string
  label: string
  address: string
  // Custom icon and tile color; empty = OS badge
  icon?: string | null
  color?: string | null
  port?: number
  username?: string
  password?: string
  keyId?: string | null
  // Reusable credentials from the keychain; takes over the inline username/password/key
  identityId?: string | null
  // Take credentials from the group instead of the fields above (default when the host has none)
  inheritCredentials?: boolean
  groupId?: string | null
  jumpHostId?: string | null
  tags: string[]
  keepAliveInterval?: number
  startupSnippetId?: string | null
  agentForwarding?: boolean
  // Terminal color theme for this host; empty = the global default
  theme?: string | null
  lastConnectedAt?: number
  // Detected from /etc/os-release on first connect (ubuntu, debian, alpine, darwin…)
  os?: string
  createdAt: number
}

export type KeyType = 'ed25519' | 'rsa' | 'ecdsa' | 'unknown'

export interface SshKey {
  id: string
  label: string
  type: KeyType
  privateKey: string
  publicKey: string
  passphrase?: string
  fingerprint: string
  createdAt: number
}

// Reusable credential: a username plus a password, an SSH key, or keys from the SSH agent
// (ssh-agent, KeePassXC's SSH agent, Pageant…)
export interface Identity {
  id: string
  label: string
  username: string
  authType: 'password' | 'key' | 'agent'
  password?: string
  keyId?: string | null
  // Agent identities: restrict to one key of the agent (SHA256 fingerprint); empty = any key
  agentKeyFingerprint?: string | null
  agentKeyLabel?: string
  createdAt: number
}



export type ForwardType = 'local' | 'remote' | 'dynamic'

export interface PortForward {
  id: string
  label: string
  type: ForwardType
  hostId: string
  bindAddress: string
  bindPort: number
  // Not used for dynamic (SOCKS5) forwards
  destAddress?: string
  destPort?: number
  autoStart?: boolean
  createdAt: number
}

export interface Snippet {
  id: string
  label: string
  script: string
  createdAt: number
}

export interface KnownHost {
  id: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  addedAt: number
}

export interface Settings {
  appearance: 'system' | 'light' | 'dark'
  fontFamily: string
  fontSize: number
  theme: string
  cursorBlink: boolean
  scrollback: number
  copyOnSelect: boolean
  defaultLocalPath: string
  agentSource: 'auto' | 'pageant' | 'custom'
  agentPath: string
  // Remote CPU / RAM / disk bar under terminals
  statusBar: boolean
}

export interface Vault {
  version: 1
  groups: Group[]
  hosts: Host[]
  keys: SshKey[]
  identities: Identity[]
  forwards: PortForward[]
  snippets: Snippet[]
  knownHosts: KnownHost[]
  settings: Settings
}

export type Collection =
  | 'groups'
  | 'hosts'
  | 'keys'
  | 'identities'
  | 'forwards'
  | 'snippets'
  | 'knownHosts'

export const DEFAULT_SETTINGS: Settings = {
  appearance: 'system',
  fontFamily: 'Menlo, "DejaVu Sans Mono", Consolas, monospace',
  fontSize: 13,
  theme: 'sshelby-dark',
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: false,
  defaultLocalPath: '',
  agentSource: 'auto',
  agentPath: '',
  statusBar: true
}

// ---- Interactive prompts raised by the main process during connection ----

export type PromptRequest =
  | {
      id: string
      kind: 'hostkey'
      host: string
      port: number
      keyType: string
      fingerprint: string
      // Set when a stored fingerprint no longer matches
      previousFingerprint?: string
    }
  | {
      id: string
      kind: 'password'
      title: string
      message: string
      // Show a "save" checkbox, labelled saveLabel (default "Save to host")
      offerSave?: boolean
      saveLabel?: string
    }
  | {
      id: string
      kind: 'keyboard-interactive'
      title: string
      instructions: string
      prompts: { prompt: string; echo: boolean }[]
      offerSave?: boolean
    }

export type PromptResponse =
  | { id: string; accept: boolean; remember?: boolean }
  | { id: string; values: string[] | null; save?: boolean }

// ---- Sessions ----

export type SessionStatus = 'connecting' | 'connected' | 'closed' | 'error'

export interface SessionEvent {
  sessionId: string
  status: SessionStatus
  message?: string
}

// ---- Status bar ----

export interface HostStats {
  cpu?: number // percent, needs two samples
  cores?: number
  load?: [number, number, number]
  mem?: { used: number; total: number } // bytes
  swap?: { used: number; total: number }
  disks: { mount: string; used: number; total: number }[]
}

// ---- SFTP ----

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  size: number
  mtime: number
  mode: number
}

export interface TransferProgress {
  transferId: string
  sftpId: string
  direction: 'upload' | 'download'
  name: string
  transferred: number
  total: number
  status: 'running' | 'done' | 'error' | 'cancelled'
  error?: string
}

// ---- Port forwarding ----

export interface ForwardStatus {
  forwardId: string
  state: 'stopped' | 'starting' | 'running' | 'error'
  message?: string
  connections: number
}
