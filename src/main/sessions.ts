import { ipcMain, WebContents } from 'electron'
import { StringDecoder } from 'string_decoder'
import { ClientChannel } from 'ssh2'
import { SessionStatus } from '@shared/types'
import { connectHost, Connection } from './connect'
import { notifyVaultChanged, store } from './store'
import { CpuSample, parseStats, STATS_COMMAND } from './stats-core'

interface Session {
  // Latest terminal size from the UI; resizes arriving while connecting must not be lost
  size: { cols: number; rows: number }
  statsTimer?: ReturnType<typeof setInterval>
  cpuSample?: CpuSample
  statsBusy?: boolean
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
  const session: Session = { closed: false, size: { cols, rows } }
  sessions.set(sessionId, session)
  const log = (msg: string) => send(wc, 'ssh:data', { sessionId, data: `\x1b[90m${msg}\x1b[0m\r\n` })
  status(wc, sessionId, 'connecting')
  try {
    const conn = await connectHost(hostId, log)
    if (session.closed) return conn.close()
    session.conn = conn
    const stream = await new Promise<ClientChannel>((resolve, reject) =>
      // Use the latest size: the terminal is often refitted (font loaded, panels) during the connection
      conn.client.shell({ term: 'xterm-256color', ...session.size }, (err, s) => (err ? reject(err) : resolve(s)))
    )
    session.stream = stream
    // A resize may have landed between the shell request and now
    stream.setWindow(session.size.rows, session.size.cols, 0, 0)
    status(wc, sessionId, 'connected')

    const decoder = new StringDecoder('utf8')
    const errDecoder = new StringDecoder('utf8')
    stream.on('data', (d: Buffer) => send(wc, 'ssh:data', { sessionId, data: decoder.write(d) }))
    stream.stderr.on('data', (d: Buffer) => send(wc, 'ssh:data', { sessionId, data: errDecoder.write(d) }))
    stream.on('close', () => {
      stopStats(session)
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
  const s = sessions.get(sessionId)
  if (!s || !cols || !rows) return
  s.size = { cols, rows }
  s.stream?.setWindow(rows, cols, 0, 0)
})

// Status bar sampling: only while the tab is visible, one exec at a time on the session's connection
function sampleStats(wc: WebContents, sessionId: string) {
  const s = sessions.get(sessionId)
  if (!s?.conn || s.statsBusy) return
  s.statsBusy = true
  s.conn.client.exec(STATS_COMMAND, (err, ch) => {
    if (err) {
      s.statsBusy = false
      return
    }
    let out = ''
    ch.on('data', (d: Buffer) => (out += d.toString()))
    ch.stderr.on('data', () => {})
    ch.on('close', () => {
      s.statsBusy = false
      const { stats, cpuSample } = parseStats(out, s.cpuSample)
      s.cpuSample = cpuSample
      send(wc, 'ssh:stats', { sessionId, stats })
    })
  })
}

function stopStats(s: Session) {
  if (s.statsTimer) clearInterval(s.statsTimer)
  s.statsTimer = undefined
}

ipcMain.on('ssh:stats', (e, sessionId: string, on: boolean) => {
  const s = sessions.get(sessionId)
  if (!s) return
  stopStats(s)
  if (!on) return
  sampleStats(e.sender, sessionId)
  // A quick second sample so CPU % shows up without waiting a full interval
  setTimeout(() => sampleStats(e.sender, sessionId), 1500)
  s.statsTimer = setInterval(() => sampleStats(e.sender, sessionId), 5000)
})

ipcMain.on('ssh:close', (_e, sessionId: string) => {
  const s = sessions.get(sessionId)
  if (!s) return
  stopStats(s)
  s.closed = true
  s.stream?.close()
  s.conn?.close()
  sessions.delete(sessionId)
})

export function closeAllSessions() {
  for (const s of sessions.values()) s.conn?.close()
  sessions.clear()
}
