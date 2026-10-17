import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto'
import type { Group, Host, Identity, KnownHost, PortForward, Snippet, SshKey } from '../shared/types'

// Encrypted export file: JSON envelope around an AES-256-GCM payload whose key is derived
// from the user's passphrase with scrypt. No Electron dependency so it can be tested with plain Node.

const FORMAT = 'sshelby-export'
const AAD = Buffer.from(FORMAT + ':1')
const KDF = { N: 2 ** 17, r: 8, p: 1 }

export interface Payload {
  exportedAt: number
  groups: Group[]
  hosts: Host[]
  keys: SshKey[]
  // Absent in files from before identities existed
  identities?: Identity[]
  snippets: Snippet[]
  forwards: PortForward[]
  knownHosts: KnownHost[]
}

export interface Envelope {
  format: typeof FORMAT
  version: 1
  kdf: { name: 'scrypt'; salt: string; N: number; r: number; p: number }
  cipher: 'aes-256-gcm'
  iv: string
  tag: string
  data: string
}

function deriveKey(passphrase: string, salt: Buffer, p: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(passphrase.normalize('NFKC'), salt, 32, { ...p, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  )
}

export async function encrypt(payload: Payload, passphrase: string): Promise<Envelope> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(passphrase, salt, KDF)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  // Bind the header to the ciphertext so it can't be swapped
  cipher.setAAD(AAD)
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return {
    format: FORMAT,
    version: 1,
    kdf: { name: 'scrypt', salt: salt.toString('base64'), ...KDF },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
}

export function parseEnvelope(raw: string): Envelope {
  let env: Envelope
  try {
    env = JSON.parse(raw)
  } catch {
    throw new Error('Not a Sshelby export file')
  }
  if (env?.format !== FORMAT || env.version !== 1 || env.kdf?.name !== 'scrypt') {
    throw new Error('Not a Sshelby export file (or an unsupported version)')
  }
  return env
}

export async function decrypt(env: Envelope, passphrase: string): Promise<Payload> {
  const { salt, N, r, p } = env.kdf
  // Refuse absurd parameters from a crafted file instead of hanging the app
  if (N > 2 ** 20 || r > 16 || p > 4) throw new Error('Unsupported key derivation parameters')
  const key = await deriveKey(passphrase, Buffer.from(salt, 'base64'), { N, r, p })
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'))
    d.setAAD(AAD)
    d.setAuthTag(Buffer.from(env.tag, 'base64'))
    const json = Buffer.concat([d.update(Buffer.from(env.data, 'base64')), d.final()]).toString('utf8')
    return JSON.parse(json)
  } catch {
    throw new Error('Wrong key, or the file is corrupted')
  }
}
