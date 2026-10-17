export interface Group {
  id: string
  name: string
  parentId?: string | null
  // Defaults inherited by hosts (and subgroups) that leave these empty
  username?: string
  port?: number
  password?: string
  keyId?: string | null
  jumpHostId?: string | null
  createdAt: number
}

export interface Host {
  id: string
  label: string
  address: string
  port?: number
  username?: string
  password?: string
  keyId?: string | null
  groupId?: string | null
  jumpHostId?: string | null
  tags: string[]
  keepAliveInterval?: number
  startupSnippetId?: string | null
  agentForwarding?: boolean
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
}

export interface Vault {
  version: 1
  groups: Group[]
  hosts: Host[]
  keys: SshKey[]
  forwards: PortForward[]
  snippets: Snippet[]
  knownHosts: KnownHost[]
  settings: Settings
}

export type Collection = 'groups' | 'hosts' | 'keys' | 'forwards' | 'snippets' | 'knownHosts'

export const DEFAULT_SETTINGS: Settings = {
  appearance: 'system',
  fontFamily: 'Menlo, "DejaVu Sans Mono", Consolas, monospace',
  fontSize: 13,
  theme: 'sshelby-dark',
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: false,
  defaultLocalPath: ''
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
      // Show a "save to host" checkbox
      offerSave?: boolean
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
