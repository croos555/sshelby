import { createHash } from 'crypto'
import { utils } from 'ssh2'
import type { KeyType } from '@shared/types'

export function fingerprintBlob(blob: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

// First field of an SSH public key blob is the algorithm name
export function blobKeyType(blob: Buffer): string {
  try {
    const len = blob.readUInt32BE(0)
    return blob.subarray(4, 4 + len).toString('ascii')
  } catch {
    return 'unknown'
  }
}

function normalizeType(sshType: string): KeyType {
  if (sshType.includes('ed25519')) return 'ed25519'
  if (sshType.includes('rsa')) return 'rsa'
  if (sshType.includes('ecdsa')) return 'ecdsa'
  return 'unknown'
}

export interface KeyInfo {
  type: KeyType
  publicKey: string
  privateKey: string
  fingerprint: string
}

export function generateKey(
  type: 'ed25519' | 'rsa' | 'ecdsa',
  opts: { bits?: number; comment?: string; passphrase?: string }
): KeyInfo {
  const base: any = { comment: opts.comment || 'sshelby' }
  if (opts.passphrase) Object.assign(base, { passphrase: opts.passphrase, cipher: 'aes256-ctr', rounds: 16 })
  let pair
  if (type === 'rsa') pair = utils.generateKeyPairSync('rsa', { bits: opts.bits || 4096, ...base })
  else if (type === 'ecdsa')
    pair = utils.generateKeyPairSync('ecdsa', { bits: (opts.bits as 256 | 384 | 521) || 256, ...base })
  else pair = utils.generateKeyPairSync('ed25519', base)
  return inspectKey(pair.private, opts.passphrase)
}

// Parse a private key (any format ssh2 understands) and derive public key + fingerprint
export function inspectKey(privateKey: string, passphrase?: string): KeyInfo {
  const parsed = utils.parseKey(privateKey, passphrase || undefined)
  if (parsed instanceof Error) {
    const msg = parsed.message
    if (/passphrase|encrypted/i.test(msg) && !passphrase) throw new Error('Key is encrypted: passphrase required')
    throw new Error(msg)
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  if (!key.isPrivateKey()) throw new Error('This is a public key; paste the private key')
  const blob = key.getPublicSSH()
  return {
    type: normalizeType(key.type),
    publicKey: `${key.type} ${blob.toString('base64')}${key.comment ? ' ' + key.comment : ''}`,
    privateKey: privateKey.trim() + '\n',
    fingerprint: fingerprintBlob(blob)
  }
}
