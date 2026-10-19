// Parser for MobaXterm session exports (.mxtsessions) and MobaXterm.ini. Pure, no Electron.
//
// Sessions live in [Bookmarks], [Bookmarks_1]… sections:
//   SubRep=Folder\Sub folder          (folder path, backslash separated; empty = root)
//   ImgNum=41                         (folder icon)
//   My server=#109#0%host%22%user%%-1%-1%%gwhost%22%gwuser%0%0%0%_ProfileDir_\.ssh\id_rsa%…#MobaFont%…#0# #-1
// The value is "#icon#type" then %-separated fields; type 0 = SSH, 7 = SFTP.

export interface MobaSession {
  name: string
  folder: string[] // path from the root
  type: 'ssh' | 'sftp'
  host: string
  port?: number
  username?: string
  keyPath?: string
  gateway?: { host: string; port?: number; username?: string }
}

export interface MobaParseResult {
  sessions: MobaSession[]
  skipped: { name: string; kind: string }[]
}

const TYPES: Record<string, string> = {
  '0': 'ssh',
  '1': 'telnet',
  '2': 'rsh',
  '3': 'xdmcp',
  '4': 'rdp',
  '5': 'vnc',
  '6': 'ftp',
  '7': 'sftp',
  '8': 'serial',
  '9': 'file',
  '10': 'shell',
  '11': 'browser',
  '12': 'mosh',
  '13': 'aws-s3',
  '14': 'wsl'
}

// MobaXterm escapes a few characters in session names and values
function unescape(s: string): string {
  return s
    .replace(/__PIPE__/g, '|')
    .replace(/__DIEZE__/g, '#')
    .replace(/__PTVIRG__/g, ';')
    .replace(/__PERCENT__/g, '%')
    .trim()
}

function num(s?: string): number | undefined {
  const n = Number(s)
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined
}

export function decodeMobaFile(buf: Buffer): string {
  // Exports are UTF-8 (with or without BOM) or Windows-1252 on older versions
  let text = buf.toString('utf8')
  if (text.includes('�')) text = buf.toString('latin1')
  return text.replace(/^﻿/, '')
}

export function parseMobaXterm(text: string): MobaParseResult {
  const sessions: MobaSession[] = []
  const skipped: MobaParseResult['skipped'] = []
  let inBookmarks = false
  let folder: string[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';')) continue
    const section = line.match(/^\[(.+)\]$/)
    if (section) {
      inBookmarks = /^Bookmarks(_\d+)?$/i.test(section[1])
      folder = []
      continue
    }
    if (!inBookmarks) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    if (key === 'SubRep') {
      folder = value
        .split('\\')
        .map((s) => unescape(s))
        .filter(Boolean)
      continue
    }
    if (key === 'ImgNum' || !value.startsWith('#')) continue

    // "#icon#type%field1%field2…#MobaFont%…": keep the connection part only
    const m = value.match(/^#\d+#(\d+)%([^#]*)/)
    if (!m) continue
    const kind = TYPES[m[1]] || `type ${m[1]}`
    const name = unescape(key)
    if (kind !== 'ssh' && kind !== 'sftp') {
      skipped.push({ name, kind })
      continue
    }
    const f = m[2].split('%')
    const host = unescape(f[0] || '')
    if (!host) {
      skipped.push({ name, kind: `${kind} without host` })
      continue
    }
    const s: MobaSession = {
      name,
      folder,
      type: kind,
      host,
      port: num(f[1]),
      username: unescape(f[2] || '') || undefined
    }
    if (kind === 'ssh') {
      // fields: 0 host, 1 port, 2 user, 3-6 options, 7 gateway host, 8 gateway port, 9 gateway user, 13 private key
      const gwHost = unescape(f[7] || '')
      if (gwHost) s.gateway = { host: gwHost, port: num(f[8]), username: unescape(f[9] || '') || undefined }
      const key = unescape(f[13] || '')
      if (key) s.keyPath = key
    }
    sessions.push(s)
  }
  return { sessions, skipped }
}
