import { contextBridge, ipcRenderer, IpcRendererEvent, webUtils } from 'electron'
import type {
  Collection,
  FileEntry,
  ForwardStatus,
  PromptRequest,
  PromptResponse,
  SessionEvent,
  Settings,
  TransferProgress,
  Vault
} from '@shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  platform: process.platform,

  vault: {
    get: (): Promise<Vault> => ipcRenderer.invoke('vault:get'),
    upsert: <T>(col: Collection, item: T): Promise<T & { id: string }> => ipcRenderer.invoke('vault:upsert', col, item),
    remove: (col: Collection, id: string): Promise<void> => ipcRenderer.invoke('vault:remove', col, id),
    settings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('vault:settings', patch),
    exportFile: (): Promise<boolean> => ipcRenderer.invoke('vault:export'),
    importFile: (): Promise<boolean> => ipcRenderer.invoke('vault:import'),
    importSshConfig: (): Promise<number> => ipcRenderer.invoke('vault:importSshConfig'),
    onChanged: (cb: () => void) => on('vault:changed', cb)
  },

  keys: {
    generate: (type: 'ed25519' | 'rsa' | 'ecdsa', opts: { bits?: number; comment?: string; passphrase?: string }) =>
      ipcRenderer.invoke('keys:generate', type, opts),
    inspect: (privateKey: string, passphrase?: string) => ipcRenderer.invoke('keys:inspect', privateKey, passphrase),
    pickFile: (): Promise<{ name: string; content: string } | null> => ipcRenderer.invoke('keys:pickFile'),
    installOnHost: (keyId: string, hostId: string): Promise<void> =>
      ipcRenderer.invoke('keys:installOnHost', keyId, hostId),
    savePublic: (name: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke('keys:savePublic', name, content)
  },

  ssh: {
    open: (sessionId: string, hostId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke('ssh:open', sessionId, hostId, cols, rows),
    write: (sessionId: string, data: string) => ipcRenderer.send('ssh:write', sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.send('ssh:resize', sessionId, cols, rows),
    close: (sessionId: string) => ipcRenderer.send('ssh:close', sessionId),
    onData: (cb: (p: { sessionId: string; data: string }) => void) => on('ssh:data', cb),
    onStatus: (cb: (p: SessionEvent) => void) => on('ssh:status', cb)
  },

  sftp: {
    open: (sftpId: string, hostId: string): Promise<string> => ipcRenderer.invoke('sftp:open', sftpId, hostId),
    close: (sftpId: string) => ipcRenderer.send('sftp:close', sftpId),
    list: (sftpId: string, dir: string): Promise<FileEntry[]> => ipcRenderer.invoke('sftp:list', sftpId, dir),
    realpath: (sftpId: string, path: string): Promise<string> => ipcRenderer.invoke('sftp:realpath', sftpId, path),
    mkdir: (sftpId: string, path: string): Promise<void> => ipcRenderer.invoke('sftp:mkdir', sftpId, path),
    rename: (sftpId: string, from: string, to: string): Promise<void> =>
      ipcRenderer.invoke('sftp:rename', sftpId, from, to),
    chmod: (sftpId: string, path: string, mode: number): Promise<void> =>
      ipcRenderer.invoke('sftp:chmod', sftpId, path, mode),
    remove: (sftpId: string, paths: string[]): Promise<void> => ipcRenderer.invoke('sftp:delete', sftpId, paths),
    upload: (sftpId: string, localPaths: string[], remoteDir: string): Promise<string> =>
      ipcRenderer.invoke('sftp:upload', sftpId, localPaths, remoteDir),
    download: (sftpId: string, remotePaths: string[], localDir: string): Promise<string> =>
      ipcRenderer.invoke('sftp:download', sftpId, remotePaths, localDir),
    cancel: (transferId: string) => ipcRenderer.send('sftp:cancel', transferId),
    onTransfer: (cb: (t: TransferProgress) => void) => on('sftp:transfer', cb),
    onClosed: (cb: (sftpId: string) => void) => on('sftp:closed', cb)
  },

  local: {
    home: (): Promise<string> => ipcRenderer.invoke('local:home'),
    list: (dir: string): Promise<FileEntry[]> => ipcRenderer.invoke('local:list', dir),
    parent: (path: string): Promise<string> => ipcRenderer.invoke('local:parent', path),
    join: (...parts: string[]): Promise<string> => ipcRenderer.invoke('local:join', ...parts),
    mkdir: (path: string): Promise<void> => ipcRenderer.invoke('local:mkdir', path),
    rename: (from: string, to: string): Promise<void> => ipcRenderer.invoke('local:rename', from, to),
    remove: (paths: string[]): Promise<void> => ipcRenderer.invoke('local:delete', paths),
    open: (path: string): Promise<string> => ipcRenderer.invoke('local:open', path),
    pathForFile: (file: File): string => webUtils.getPathForFile(file),
    pick: (dirs: boolean): Promise<string[]> => ipcRenderer.invoke('dialog:pickFiles', dirs)
  },

  forwards: {
    start: (id: string): Promise<void> => ipcRenderer.invoke('forward:start', id),
    stop: (id: string): Promise<void> => ipcRenderer.invoke('forward:stop', id),
    statuses: (): Promise<ForwardStatus[]> => ipcRenderer.invoke('forward:statuses'),
    onStatus: (cb: (s: ForwardStatus) => void) => on('forward:status', cb)
  },

  prompts: {
    onRequest: (cb: (req: PromptRequest) => void) => on('prompt:request', cb),
    respond: (res: PromptResponse) => ipcRenderer.send('prompt:respond', res)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
