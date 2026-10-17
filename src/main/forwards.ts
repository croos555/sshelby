import { BrowserWindow, ipcMain } from 'electron'
import net from 'net'
import { ForwardStatus, PortForward } from '@shared/types'
import { connectHost, Connection } from './connect'
import { store } from './store'

interface Running {
  conn?: Connection
  server?: net.Server
  sockets: Set<net.Socket>
  status: ForwardStatus
}

const running = new Map<string, Running>()

function broadcast(status: ForwardStatus) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('forward:status', status)
}

function update(r: Running, patch: Partial<ForwardStatus>) {
  Object.assign(r.status, patch)
  broadcast({ ...r.status })
}

function pipe(a: net.Socket, b: NodeJS.ReadWriteStream & { destroy?: () => void }, r: Running) {
  r.sockets.add(a)
  update(r, { connections: r.sockets.size })
  a.pipe(b as any).pipe(a)
  const done = () => {
    if (!r.sockets.delete(a)) return
    a.destroy()
    b.destroy?.()
    update(r, { connections: r.sockets.size })
  }
  a.on('close', done).on('error', done)
  b.on('close', done).on('error', done)
}

function listen(server: net.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

// Minimal SOCKS5 (no auth, CONNECT only) handshake; resolves with the requested destination
function socksHandshake(sock: net.Socket): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    let stage = 0
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      if (stage === 0) {
        if (buf.length < 2) return
        if (buf[0] !== 5) return fail('Only SOCKS5 is supported')
        const n = buf[1]
        if (buf.length < 2 + n) return
        buf = buf.subarray(2 + n)
        sock.write(Buffer.from([5, 0]))
        stage = 1
      }
      if (stage === 1) {
        if (buf.length < 5) return
        const [ver, cmd, , atyp] = buf
        if (ver !== 5 || cmd !== 1) {
          sock.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]))
          return fail('Unsupported SOCKS command')
        }
        let host: string
        let off: number
        if (atyp === 1) {
          if (buf.length < 10) return
          host = Array.from(buf.subarray(4, 8)).join('.')
          off = 8
        } else if (atyp === 3) {
          const len = buf[4]
          if (buf.length < 5 + len + 2) return
          host = buf.subarray(5, 5 + len).toString()
          off = 5 + len
        } else if (atyp === 4) {
          if (buf.length < 22) return
          const parts: string[] = []
          for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16))
          host = parts.join(':')
          off = 20
        } else {
          return fail('Bad address type')
        }
        const port = buf.readUInt16BE(off)
        sock.removeListener('data', onData)
        const rest = buf.subarray(off + 2)
        if (rest.length) sock.unshift(rest)
        resolve({ host, port })
      }
    }
    const fail = (msg: string) => {
      sock.removeListener('data', onData)
      sock.destroy()
      reject(new Error(msg))
    }
    sock.on('data', onData)
    sock.once('error', reject)
  })
}

export async function startForward(id: string): Promise<void> {
  const f = store.get().forwards.find((x) => x.id === id)
  if (!f) throw new Error('Rule not found')
  if (running.has(id)) return
  const r: Running = { sockets: new Set(), status: { forwardId: id, state: 'starting', connections: 0 } }
  running.set(id, r)
  update(r, {})
  try {
    const conn = await connectHost(f.hostId)
    r.conn = conn
    conn.client.on('close', () => {
      if (running.get(id) === r) {
        stopForward(id)
        update(r, { state: 'error', message: 'SSH connection closed' })
      }
    })
    if (f.type === 'remote') await startRemote(f, r)
    else await startLocal(f, r)
    update(r, { state: 'running', message: undefined })
  } catch (err: any) {
    stopForward(id)
    update(r, { state: 'error', message: err?.message || String(err) })
    throw err
  }
}

async function startLocal(f: PortForward, r: Running) {
  const client = r.conn!.client
  const server = net.createServer(async (sock) => {
    try {
      const dest =
        f.type === 'dynamic'
          ? await socksHandshake(sock)
          : { host: f.destAddress || 'localhost', port: f.destPort || 0 }
      client.forwardOut(sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, dest.host, dest.port, (err, ch) => {
        if (err) {
          if (f.type === 'dynamic') sock.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]))
          else sock.destroy()
          return
        }
        if (f.type === 'dynamic') sock.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]))
        pipe(sock, ch, r)
      })
    } catch {
      sock.destroy()
    }
  })
  r.server = server
  await listen(server, f.bindPort, f.bindAddress || '127.0.0.1')
}

async function startRemote(f: PortForward, r: Running) {
  const client = r.conn!.client
  await new Promise<void>((resolve, reject) =>
    client.forwardIn(f.bindAddress || '127.0.0.1', f.bindPort, (err) => (err ? reject(err) : resolve()))
  )
  client.on('tcp connection', (_info, accept, reject) => {
    const sock = net.connect(f.destPort || 0, f.destAddress || 'localhost')
    sock.once('connect', () => pipe(sock, accept(), r))
    sock.once('error', () => reject())
  })
}

export function stopForward(id: string) {
  const r = running.get(id)
  if (!r) return
  running.delete(id)
  for (const s of r.sockets) s.destroy()
  r.sockets.clear()
  r.server?.close()
  r.conn?.close()
  update(r, { state: 'stopped', connections: 0 })
}

ipcMain.handle('forward:start', (_e, id: string) => startForward(id))
ipcMain.handle('forward:stop', (_e, id: string) => stopForward(id))
ipcMain.handle('forward:statuses', () => [...running.values()].map((r) => r.status))

export function autoStartForwards() {
  for (const f of store.get().forwards) if (f.autoStart) startForward(f.id).catch(() => {})
}

export function stopAllForwards() {
  for (const id of [...running.keys()]) stopForward(id)
}
