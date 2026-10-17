import { BaseAgent, ParsedKey, utils } from 'ssh2'
import { fingerprintBlob } from './keys'

// Agent helpers without Electron, so they can be tested with plain Node

// Agents hand back parsed keys, but the typings also allow raw blobs
export function asKey(k: any): ParsedKey | null {
  if (k && typeof k.getPublicSSH === 'function') return k
  const parsed = utils.parseKey(k)
  return parsed instanceof Error ? null : Array.isArray(parsed) ? parsed[0] : parsed
}

// Only offers the selected key to the server: an agent with many keys would otherwise
// burn through the server's MaxAuthTries before reaching the right one.
export class FilteredAgent extends BaseAgent<ParsedKey> {
  private inner: BaseAgent<any>
  private fingerprint: string
  constructor(inner: BaseAgent<any>, fingerprint: string) {
    super()
    this.inner = inner
    this.fingerprint = fingerprint
  }
  getIdentities(cb: (err: Error | null | undefined, keys?: ParsedKey[]) => void) {
    this.inner.getIdentities((err: Error | null | undefined, keys?: any[]) => {
      if (err) return cb(err)
      cb(undefined, (keys || []).map(asKey).filter((k) => k && fingerprintBlob(k.getPublicSSH()) === this.fingerprint) as ParsedKey[])
    })
  }
  sign(pubKey: ParsedKey, data: Buffer, options: any, cb?: any) {
    return (this.inner as any).sign(pubKey, data, options, cb)
  }
}

