import { ipcMain, shell, WebContents } from 'electron'
import { promises as fsp, Stats } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, posix } from 'path'
import { randomUUID } from 'crypto'
import { SFTPWrapper } from 'ssh2'
import { FileEntry, TransferProgress } from '@shared/types'
import { connectHost, Connection } from './connect'

interface SftpSession {
  conn: Connection
  sftp: SFTPWrapper
}

const sftps = new Map<string, SftpSession>()
const cancelled = new Set<string>()

function get(id: string): SftpSession {
  const s = sftps.get(id)
  if (!s) throw new Error('SFTP session is not open')
  return s
}

function p<T>(fn: (cb: (err: any, res?: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res as T))))
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

// ---------- remote ----------

ipcMain.handle('sftp:open', async (e, sftpId: string, hostId: string) => {
  const wc = e.sender
  const conn = await connectHost(hostId)
  const sftp = await p<SFTPWrapper>((cb) => conn.client.sftp(cb))
  sftps.set(sftpId, { conn, sftp })
  conn.client.on('close', () => {
    sftps.delete(sftpId)
    if (!wc.isDestroyed()) wc.send('sftp:closed', sftpId)
  })
  return p<string>((cb) => sftp.realpath('.', cb))
})

ipcMain.on('sftp:close', (_e, sftpId: string) => {
  sftps.get(sftpId)?.conn.close()
  sftps.delete(sftpId)
})

ipcMain.handle('sftp:list', async (_e, sftpId: string, dir: string): Promise<FileEntry[]> => {
  const { sftp } = get(sftpId)
  const list = await p<any[]>((cb) => sftp.readdir(dir, cb))
  const entries = await Promise.all(
    list.map(async (f) => {
      const full = posix.join(dir, f.filename)
      const type = f.attrs.mode & S_IFMT
      let isDir = type === S_IFDIR
      const isSymlink = type === S_IFLNK
      if (isSymlink) {
        // Follow links so directories behind them are browsable
        try {
          const st = await p<any>((cb) => sftp.stat(full, cb))
          isDir = (st.mode & S_IFMT) === S_IFDIR
        } catch {}
      }
      return {
        name: f.filename,
        path: full,
        isDir,
        isSymlink,
        size: f.attrs.size,
        mtime: f.attrs.mtime * 1000,
        mode: f.attrs.mode
      }
    })
  )
  return entries
})

ipcMain.handle('sftp:realpath', (_e, sftpId: string, path: string) =>
  p<string>((cb) => get(sftpId).sftp.realpath(path, cb))
)

ipcMain.handle('sftp:mkdir', (_e, sftpId: string, path: string) =>
  p((cb) => get(sftpId).sftp.mkdir(path, cb))
)

ipcMain.handle('sftp:rename', (_e, sftpId: string, from: string, to: string) =>
  p((cb) => get(sftpId).sftp.rename(from, to, cb))
)

ipcMain.handle('sftp:chmod', (_e, sftpId: string, path: string, mode: number) =>
  p((cb) => get(sftpId).sftp.chmod(path, mode, cb))
)

async function remoteRemove(sftp: SFTPWrapper, path: string): Promise<void> {
  const st = await p<any>((cb) => sftp.lstat(path, cb))
  if ((st.mode & S_IFMT) === S_IFDIR) {
    const list = await p<any[]>((cb) => sftp.readdir(path, cb))
    for (const f of list) await remoteRemove(sftp, posix.join(path, f.filename))
    await p((cb) => sftp.rmdir(path, cb))
  } else {
    await p((cb) => sftp.unlink(path, cb))
  }
}

ipcMain.handle('sftp:delete', async (_e, sftpId: string, paths: string[]) => {
  const { sftp } = get(sftpId)
  for (const path of paths) await remoteRemove(sftp, path)
})

// ---------- transfers ----------

function progress(wc: WebContents, t: TransferProgress) {
  if (!wc.isDestroyed()) wc.send('sftp:transfer', t)
}

async function localSize(path: string): Promise<number> {
  const st = await fsp.stat(path)
  if (!st.isDirectory()) return st.size
  let total = 0
  for (const f of await fsp.readdir(path)) total += await localSize(join(path, f))
  return total
}

async function remoteSize(sftp: SFTPWrapper, path: string): Promise<number> {
  const st = await p<any>((cb) => sftp.stat(path, cb))
  if ((st.mode & S_IFMT) !== S_IFDIR) return st.size
  let total = 0
  for (const f of await p<any[]>((cb) => sftp.readdir(path, cb)))
    total += await remoteSize(sftp, posix.join(path, f.filename))
  return total
}

function startTransfer(
  wc: WebContents,
  sftpId: string,
  direction: 'upload' | 'download',
  sources: string[],
  run: (t: TransferProgress, report: () => void) => Promise<void>
): string {
  const transferId = randomUUID()
  const name = sources.length === 1 ? basename(sources[0]) : `${sources.length} items`
  const t: TransferProgress = { transferId, sftpId, direction, name, transferred: 0, total: 0, status: 'running' }
  let last = 0
  const report = () => {
    const now = Date.now()
    if (now - last > 100) {
      last = now
      progress(wc, { ...t })
    }
  }
  progress(wc, t)
  run(t, report)
    .then(() => {
      t.status = cancelled.has(transferId) ? 'cancelled' : 'done'
      progress(wc, t)
    })
    .catch((err) => {
      t.status = cancelled.has(transferId) ? 'cancelled' : 'error'
      t.error = err?.message || String(err)
      progress(wc, t)
    })
    .finally(() => cancelled.delete(transferId))
  return transferId
}

ipcMain.handle('sftp:upload', (e, sftpId: string, localPaths: string[], remoteDir: string) => {
  const { sftp } = get(sftpId)
  return startTransfer(e.sender, sftpId, 'upload', localPaths, async (t, report) => {
    for (const lp of localPaths) t.total += await localSize(lp)
    const put = async (src: string, dest: string) => {
      if (cancelled.has(t.transferId)) throw new Error('Cancelled')
      const st: Stats = await fsp.stat(src)
      if (st.isDirectory()) {
        await p((cb) => sftp.mkdir(dest, cb)).catch(() => {})
        for (const f of await fsp.readdir(src)) await put(join(src, f), posix.join(dest, f))
      } else {
        const base = t.transferred
        await p((cb) =>
          sftp.fastPut(src, dest, { step: (done: number) => ((t.transferred = base + done), report()) }, cb)
        )
        t.transferred = base + st.size
        report()
      }
    }
    for (const lp of localPaths) await put(lp, posix.join(remoteDir, basename(lp)))
  })
})

ipcMain.handle('sftp:download', (e, sftpId: string, remotePaths: string[], localDir: string) => {
  const { sftp } = get(sftpId)
  return startTransfer(e.sender, sftpId, 'download', remotePaths, async (t, report) => {
    for (const rp of remotePaths) t.total += await remoteSize(sftp, rp)
    const getFile = async (src: string, dest: string) => {
      if (cancelled.has(t.transferId)) throw new Error('Cancelled')
      const st = await p<any>((cb) => sftp.stat(src, cb))
      if ((st.mode & S_IFMT) === S_IFDIR) {
        await fsp.mkdir(dest, { recursive: true })
        for (const f of await p<any[]>((cb) => sftp.readdir(src, cb)))
          await getFile(posix.join(src, f.filename), join(dest, f.filename))
      } else {
        const base = t.transferred
        await p((cb) =>
          sftp.fastGet(src, dest, { step: (done: number) => ((t.transferred = base + done), report()) }, cb)
        )
        t.transferred = base + st.size
        report()
      }
    }
    for (const rp of remotePaths) await getFile(rp, join(localDir, posix.basename(rp)))
  })
})

ipcMain.on('sftp:cancel', (_e, transferId: string) => cancelled.add(transferId))

// ---------- local ----------

ipcMain.handle('local:home', () => homedir())

ipcMain.handle('local:list', async (_e, dir: string): Promise<FileEntry[]> => {
  const names = await fsp.readdir(dir)
  const out: FileEntry[] = []
  for (const name of names) {
    const full = join(dir, name)
    try {
      const lst = await fsp.lstat(full)
      const st = lst.isSymbolicLink() ? await fsp.stat(full).catch(() => lst) : lst
      out.push({
        name,
        path: full,
        isDir: st.isDirectory(),
        isSymlink: lst.isSymbolicLink(),
        size: st.size,
        mtime: st.mtimeMs,
        mode: st.mode
      })
    } catch {
      // unreadable entry (permissions, broken mount): skip
    }
  }
  return out
})

ipcMain.handle('local:parent', (_e, path: string) => dirname(path))
ipcMain.handle('local:join', (_e, ...parts: string[]) => join(...parts))
ipcMain.handle('local:mkdir', (_e, path: string) => fsp.mkdir(path))
ipcMain.handle('local:rename', (_e, from: string, to: string) => fsp.rename(from, to))
ipcMain.handle('local:delete', async (_e, paths: string[]) => {
  for (const path of paths) await shell.trashItem(path)
})
ipcMain.handle('local:open', (_e, path: string) => shell.openPath(path))

export function closeAllSftp() {
  for (const s of sftps.values()) s.conn.close()
  sftps.clear()
}
