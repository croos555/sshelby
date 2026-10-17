import { ipcMain, WebContents } from 'electron'
import { StringDecoder } from 'string_decoder'
import { ClientChannel } from 'ssh2'
import { SessionStatus } from '@shared/types'
import { connectHost, Connection } from './connect'
import { notifyVaultChanged, store } from './store'

interface Session {
  conn?: Connection
  stream?: ClientChannel
  closed: boolean
}

const sessions = new Map<string, Session>()

function send(wc: WebContents, channel: string, payload: unknown) {
  if (!wc.isDestroyed()) wc.send(channel, payload)
}

function status(wc: WebContents, sessionId: string, s: SessionStatus, message?: string) {
  send(wc, 'ssh:status', { sessionId, status: s, message })
}

ipcMain.handle('ssh:open', async (e, sessionId: string, hostId: string, cols: number, rows: number) => {
  const wc = e.sender
  const session: Session = { closed: false }
  sessions.set(sessionId, session)
  const log = (msg: string) => send(wc, 'ssh:data', { sessionId, data: `\x1b[90m${msg}\x1b[0m\r\n` })
  status(wc, sessionId, 'connecting')
  try {
    const conn = await connectHost(hostId, log)
    if (session.closed) return conn.close()
    session.conn = conn
    const stream = await new Promise<ClientChannel>((resolve, reject) =>
      conn.client.shell({ term: 'xterm-256color', cols, rows }, (err, s) => (err ? reject(err) : resolve(s)))
    )
    session.stream = stream
    status(wc, sessionId, 'connected')

    const decoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')
    stream.on('data', (d: Buffer) => send(wc, 'ssh:data', { sessionId, data: decoder.write(d) }))
    stream.stderr.on('data', (d: Buffer) => send(wc, 'ssh:data', { sessionId, data: errDecoder.write(d) }))
    stream.on('close', () => {
      conn.close()
      if (!session.closed) status(wc, sessionId, 'closed', 'Connection closed')
      sessions.delete(sessionId)
    })
    conn.client.on('error', (err) => status(wc, sessionId, 'error', err.message))

    const host = store.get().hosts.find((h) => h.id === hostId)
    if (host && !host.os) detectOs(conn, hostId)
    const snippet = host?.startupSnippetId && store.get().snippets.find((s) => s.id === host.startupSnippetId)
    if (snippet) stream.write(snippet.script.replace(/\r?\n/g, '\r') + '\r')
  } catch (err: any) {
    sessions.delete(sessionId)
    status(wc, sessionId, 'error', err?.message || String(err))
  }
})

// Best-effort distro detection so the UI can show an OS icon like Termius does
function detectOs(conn: Connection, hostId: string) {
  conn.client.exec('cat /etc/os-release 2>/dev/null || uname -s', (err, ch) => {
    if (err) return
    let out = ''
    ch.on('data', (d: Buffer) => (out += d.toString()))
    ch.stderr.on('data', () => {})
    ch.on('close', () => {
      const id = out.match(/^ID="?([\w.-]+)"?/m)?.[1] || out.trim().split(/\s/)[0]
      const host = store.get().hosts.find((h) => h.id === hostId)
      if (id && host) {
        store.upsert('hosts', { ...host, os: id.toLowerCase() })
        notifyVaultChanged()
      }
    })
  })
}

ipcMain.on('ssh:write', (_e, sessionId: string, data: string) => {
  sessions.get(sessionId)?.stream?.write(data)
})

ipcMain.on('ssh:resize', (_e, sessionId: string, cols: number, rows: number) => {
  sessions.get(sessionId)?.stream?.setWindow(rows, cols, 0, 0)
})

ipcMain.on('ssh:close', (_e, sessionId: string) => {
  const s = sessions.get(sessionId)
  if (!s) return
  s.closed = true
  s.stream?.close()
  s.conn?.close()
  sessions.delete(sessionId)
})

export function closeAllSessions() {
  for (const s of sessions.values()) s.conn?.close()
  sessions.clear()
}
