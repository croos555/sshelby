// window.api over Tauri IPC: commands are snake_case Rust functions (src-tauri/src), events keep
// the "area:name" form emitted by the backend.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { Api, Platform } from './api'

function on<T>(event: string, cb: (payload: T) => void): () => void {
  const unlisten = listen<T>(event, (e) => cb(e.payload))
  return () => void unlisten.then((f) => f())
}

function platform(): Platform {
  const ua = navigator.userAgent
  if (/Mac/i.test(ua)) return 'darwin'
  if (/Win/i.test(ua)) return 'win32'
  return 'linux'
}

const fire = (cmd: string, args?: Record<string, unknown>) => void invoke(cmd, args).catch(() => {})

const api = {
  platform: platform(),

  vault: {
    get: () => invoke('vault_get'),
    upsert: (col: string, item: unknown) => invoke('vault_upsert', { col, item }),
    remove: (col: string, id: string) => invoke('vault_remove', { col, id }),
    settings: (patch: unknown) => invoke('vault_settings', { patch }),
    storageInfo: () => invoke('vault_storage_info'),
    importSshConfig: () => invoke('vault_import_ssh_config'),
    importMobaXterm: async () => {
      const path = await open({
        title: 'Import MobaXterm sessions',
        filters: [{ name: 'MobaXterm sessions', extensions: ['mxtsessions', 'ini'] }]
      })
      return path ? invoke('vault_import_moba', { path }) : null
    },
    onChanged: (cb: () => void) => on('vault:changed', cb)
  },

  keys: {
    generate: (type: string, opts: unknown) => invoke('keys_generate', { type, opts }),
    inspect: (privateKey: string, passphrase?: string) => invoke('keys_inspect', { privateKey, passphrase }),
    pickFile: async () => {
      const home = await invoke<string>('local_home')
      const path = await open({ title: 'Import private key', defaultPath: `${home}/.ssh` })
      if (!path) return null
      return { name: path.split(/[\\/]/).pop() || path, content: await invoke<string>('read_text_file', { path }) }
    },
    installOnHost: (keyId: string, hostId: string) => invoke('keys_install_on_host', { keyId, hostId }),
    savePublic: async (name: string, content: string) => {
      const path = await save({ defaultPath: name + '.pub' })
      if (!path) return false
      await invoke('write_text_file', { path, content })
      return true
    }
  },

  ssh: {
    open: (sessionId: string, hostId: string, cols: number, rows: number) =>
      invoke('ssh_open', { sessionId, hostId, cols, rows }),
    write: (sessionId: string, data: string) => fire('ssh_write', { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) => fire('ssh_resize', { sessionId, cols, rows }),
    close: (sessionId: string) => fire('ssh_close', { sessionId }),
    onData: (cb: (p: unknown) => void) => on('ssh:data', cb),
    onStatus: (cb: (p: unknown) => void) => on('ssh:status', cb),
    stats: (sessionId: string, on: boolean) => fire('ssh_stats', { sessionId, on }),
    onStats: (cb: (p: unknown) => void) => on('ssh:stats', cb)
  },

  sftp: {
    open: (sftpId: string, hostId: string) => invoke('sftp_open', { sftpId, hostId }),
    close: (sftpId: string) => fire('sftp_close', { sftpId }),
    retain: (sftpId: string) => fire('sftp_retain', { sftpId }),
    readText: (sftpId: string, path: string) => invoke('sftp_read_text', { sftpId, path }),
    writeText: (sftpId: string, path: string, content: string, expectedMtime?: number) =>
      invoke('sftp_write_text', { sftpId, path, content, expectedMtime }),
    openExternal: (sftpId: string, path: string) => invoke('sftp_open_external', { sftpId, path }),
    onExternalSaved: (cb: (p: unknown) => void) => on('sftp:externalSaved', cb),
    list: (sftpId: string, dir: string) => invoke('sftp_list', { sftpId, dir }),
    realpath: (sftpId: string, path: string) => invoke('sftp_realpath', { sftpId, path }),
    mkdir: (sftpId: string, path: string) => invoke('sftp_mkdir', { sftpId, path }),
    rename: (sftpId: string, from: string, to: string) => invoke('sftp_rename', { sftpId, from, to }),
    chmod: (sftpId: string, path: string, mode: number) => invoke('sftp_chmod', { sftpId, path, mode }),
    remove: (sftpId: string, paths: string[]) => invoke('sftp_delete', { sftpId, paths }),
    upload: (sftpId: string, localPaths: string[], remoteDir: string) =>
      invoke('sftp_upload', { sftpId, localPaths, remoteDir }),
    download: (sftpId: string, remotePaths: string[], localDir: string) =>
      invoke('sftp_download', { sftpId, remotePaths, localDir }),
    cancel: (transferId: string) => fire('sftp_cancel', { transferId }),
    onTransfer: (cb: (t: unknown) => void) => on('sftp:transfer', cb),
    onClosed: (cb: (sftpId: string) => void) => on('sftp:closed', cb)
  },

  local: {
    home: () => invoke('local_home'),
    list: (dir: string) => invoke('local_list', { dir }),
    parent: (path: string) => invoke('local_parent', { path }),
    join: (...parts: string[]) => invoke('local_join', { parts }),
    mkdir: (path: string) => invoke('local_mkdir', { path }),
    rename: (from: string, to: string) => invoke('local_rename', { from, to }),
    remove: (paths: string[]) => invoke('local_delete', { paths }),
    open: (path: string) => invoke('local_open', { path }),
    // Files dropped from the OS carry no path in a webview; not supported by this test build
    pathForFile: () => '',
    pick: async (dirs: boolean) => {
      const res = await open(dirs ? { directory: true } : { multiple: true })
      return res ? (Array.isArray(res) ? res : [res]) : []
    }
  },

  agent: {
    list: () => invoke('agent_list'),
    path: () => invoke('agent_path_cmd')
  },

  transfer: {
    preview: (sel: unknown) => invoke('transfer_preview', { sel }),
    exportFile: async (sel: unknown, passphrase: string | null) => {
      // Validate (credentials need a key, key length) before asking where to save
      if (passphrase !== null && passphrase.length < 8) throw new Error('The key must be at least 8 characters')
      const date = new Date().toISOString().slice(0, 10)
      const path = await save({
        title: 'Export hosts',
        defaultPath: `sshelby-export-${date}.sshelby`,
        filters: [{ name: 'Sshelby export', extensions: ['sshelby'] }]
      })
      if (!path) return false
      return invoke('transfer_export', { sel, passphrase, path })
    },
    pickImport: async () => {
      const path = await open({ title: 'Import hosts', filters: [{ name: 'Sshelby export', extensions: ['sshelby', 'json'] }] })
      return path ? invoke('transfer_check', { path }) : null
    },
    inspect: (path: string, passphrase?: string) => invoke('transfer_inspect', { path, passphrase }),
    importFile: (path: string, passphrase?: string) => invoke('transfer_import', { path, passphrase })
  },

  forwards: {
    start: (id: string) => invoke('forward_start', { id }),
    stop: (id: string) => invoke('forward_stop', { id }),
    statuses: () => invoke('forward_statuses'),
    onStatus: (cb: (s: unknown) => void) => on('forward:status', cb)
  },

  prompts: {
    onRequest: (cb: (req: unknown) => void) => on('prompt:request', cb),
    respond: (res: unknown) => fire('prompt_respond', { res })
  }
}

window.api = api as unknown as Api
