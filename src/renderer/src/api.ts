// Contract between the UI and the Rust backend. Implemented over Tauri IPC in tauri-api.ts.
import type {
  Collection,
  FileEntry,
  ForwardStatus,
  HostStats,
  KeyType,
  PromptRequest,
  PromptResponse,
  SessionEvent,
  Settings,
  TransferProgress,
  Vault
} from '@shared/types'

export type Platform = 'darwin' | 'win32' | 'linux'

export interface ExportSelection {
  groupIds: string[]
  hostIds: string[]
  includeForwards: boolean
  includeCredentials?: boolean
}

export interface ImportPreview {
  exportedAt: number
  groups: string[]
  hosts: string[]
  keys: number
  identities: number
  snippets: number
  forwards: number
  knownHosts: number
}

export interface ImportSummary {
  created: number
  updated: number
  detail: Record<string, { created: number; updated: number }>
}

export interface KeyInfo {
  type: KeyType
  publicKey: string
  privateKey: string
  fingerprint: string
}

export interface MobaImportSummary {
  hosts: number
  updated: number
  groups: number
  jumpHosts: number
  keys: number
  keysMissing: number
  skipped: { name: string; kind: string }[]
}

type Unsubscribe = () => void

export interface Api {
  platform: Platform

  vault: {
    get(): Promise<Vault>
    upsert<T>(col: Collection, item: T): Promise<T & { id: string }>
    remove(col: Collection, id: string): Promise<void>
    settings(patch: Partial<Settings>): Promise<Settings>
    storageInfo(): Promise<{ encrypted: boolean; backend: string }>
    importSshConfig(): Promise<number>
    importMobaXterm(): Promise<MobaImportSummary | null>
    onChanged(cb: () => void): Unsubscribe
  }

  keys: {
    generate(type: 'ed25519' | 'rsa' | 'ecdsa', opts: { bits?: number; comment?: string; passphrase?: string }): Promise<KeyInfo>
    inspect(privateKey: string, passphrase?: string): Promise<KeyInfo>
    pickFile(): Promise<{ name: string; content: string } | null>
    installOnHost(keyId: string, hostId: string): Promise<void>
    savePublic(name: string, content: string): Promise<boolean>
  }

  ssh: {
    open(sessionId: string, hostId: string, cols: number, rows: number): Promise<void>
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    close(sessionId: string): void
    onData(cb: (p: { sessionId: string; data: string }) => void): Unsubscribe
    onStatus(cb: (p: SessionEvent) => void): Unsubscribe
    stats(sessionId: string, on: boolean): void
    onStats(cb: (p: { sessionId: string; stats: HostStats }) => void): Unsubscribe
  }

  sftp: {
    open(sftpId: string, hostId: string): Promise<string>
    close(sftpId: string): void
    retain(sftpId: string): void
    readText(sftpId: string, path: string): Promise<{ content: string; mtime: number }>
    writeText(sftpId: string, path: string, content: string, expectedMtime?: number): Promise<{ mtime: number }>
    openExternal(sftpId: string, path: string): Promise<string>
    onExternalSaved(cb: (p: { path: string; ok: boolean; error?: string }) => void): Unsubscribe
    list(sftpId: string, dir: string): Promise<FileEntry[]>
    realpath(sftpId: string, path: string): Promise<string>
    mkdir(sftpId: string, path: string): Promise<void>
    rename(sftpId: string, from: string, to: string): Promise<void>
    chmod(sftpId: string, path: string, mode: number): Promise<void>
    remove(sftpId: string, paths: string[]): Promise<void>
    upload(sftpId: string, localPaths: string[], remoteDir: string): Promise<string>
    download(sftpId: string, remotePaths: string[], localDir: string): Promise<string>
    cancel(transferId: string): void
    onTransfer(cb: (t: TransferProgress) => void): Unsubscribe
    onClosed(cb: (sftpId: string) => void): Unsubscribe
  }

  local: {
    home(): Promise<string>
    list(dir: string): Promise<FileEntry[]>
    parent(path: string): Promise<string>
    join(...parts: string[]): Promise<string>
    mkdir(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    remove(paths: string[]): Promise<void>
    open(path: string): Promise<string>
    pathForFile(file: File): string
    pick(dirs: boolean): Promise<string[]>
  }

  agent: {
    list(): Promise<{ type: string; comment: string; fingerprint: string }[]>
    path(): Promise<string | null>
  }

  transfer: {
    preview(sel: ExportSelection): Promise<Record<string, number> & { secrets: boolean }>
    // passphrase null = unencrypted (refused by the backend when credentials are included)
    exportFile(sel: ExportSelection, passphrase: string | null): Promise<boolean>
    pickImport(): Promise<{ path: string; encrypted: boolean } | null>
    inspect(path: string, passphrase?: string): Promise<ImportPreview>
    importFile(path: string, passphrase?: string): Promise<ImportSummary>
  }

  forwards: {
    start(id: string): Promise<void>
    stop(id: string): Promise<void>
    statuses(): Promise<ForwardStatus[]>
    onStatus(cb: (s: ForwardStatus) => void): Unsubscribe
  }

  prompts: {
    onRequest(cb: (req: PromptRequest) => void): Unsubscribe
    respond(res: PromptResponse): void
  }
}

declare global {
  interface Window {
    api: Api
  }
}
