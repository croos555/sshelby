import * as kdbxweb from 'kdbxweb'
import { argon2d, argon2id } from 'hash-wasm'

// Pure KeePass (.kdbx) reading on top of kdbxweb, without Electron so it can be tested with plain Node.

let argonReady = false
function ensureArgon2() {
  if (argonReady) return
  kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type) => {
    const opts = {
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      memorySize: memory,
      iterations,
      hashLength: length,
      parallelism,
      outputType: 'binary' as const
    }
    // type: 0 = Argon2d, 2 = Argon2id
    const out = type === 2 ? await argon2id(opts) : await argon2d(opts)
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
  })
  argonReady = true
}

export interface KeepassEntryInfo {
  uuid: string
  title: string
  username: string
  url: string
  path: string
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

export async function openKdbx(data: Uint8Array, password: string, keyFile?: Uint8Array): Promise<kdbxweb.Kdbx> {
  ensureArgon2()
  const creds = new kdbxweb.Credentials(
    password ? kdbxweb.ProtectedValue.fromString(password) : null,
    keyFile ? toArrayBuffer(keyFile) : null
  )
  try {
    return await kdbxweb.Kdbx.load(toArrayBuffer(data), creds)
  } catch (err: any) {
    if (err?.code === kdbxweb.Consts.ErrorCodes.InvalidKey) throw new Error('Wrong master password or key file')
    if (err?.code === kdbxweb.Consts.ErrorCodes.BadSignature) throw new Error('Not a KeePass database')
    throw new Error(err?.message || String(err))
  }
}

function text(v: unknown): string {
  if (v instanceof kdbxweb.ProtectedValue) return v.getText()
  return typeof v === 'string' ? v : ''
}

// Walk every group except the recycle bin
function* walk(db: kdbxweb.Kdbx): Generator<{ entry: kdbxweb.KdbxEntry; path: string }> {
  const bin = db.meta.recycleBinUuid?.id
  function* rec(group: kdbxweb.KdbxGroup, path: string[]): Generator<{ entry: kdbxweb.KdbxEntry; path: string }> {
    if (bin && group.uuid.id === bin) return
    for (const entry of group.entries) yield { entry, path: path.join(' / ') }
    for (const g of group.groups) yield* rec(g, [...path, g.name || ''])
  }
  yield* rec(db.getDefaultGroup(), [])
}

export function listEntries(db: kdbxweb.Kdbx): KeepassEntryInfo[] {
  const out: KeepassEntryInfo[] = []
  for (const { entry, path } of walk(db)) {
    out.push({
      uuid: entry.uuid.id,
      title: text(entry.fields.get('Title')),
      username: text(entry.fields.get('UserName')),
      url: text(entry.fields.get('URL')),
      path
    })
  }
  return out.sort((a, b) => (a.path + a.title).localeCompare(b.path + b.title))
}

export function entryCredentials(db: kdbxweb.Kdbx, uuid: string): { username: string; password: string; title: string } {
  for (const { entry } of walk(db)) {
    if (entry.uuid.id === uuid) {
      return {
        username: text(entry.fields.get('UserName')),
        password: text(entry.fields.get('Password')),
        title: text(entry.fields.get('Title'))
      }
    }
  }
  throw new Error('KeePass entry not found (deleted or moved to the recycle bin?)')
}
