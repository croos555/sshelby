import { Client, ConnectConfig, utils } from 'ssh2'
import { Host } from '@shared/types'
import { usesParentCredentials } from '@shared/creds'
import { notifyVaultChanged, store } from './store'
import { ask, askSecret, askSecretEx } from './prompts'
import { blobKeyType, fingerprintBlob } from './keys'
import { agentPath, makeAgent } from './agent'

export interface ResolvedHost {
  host: Host
  address: string
  port: number
  username?: string
  password?: string
  keyId?: string | null
  jumpHostId?: string | null
  // Credentials come from a shared identity: don't offer to save typed passwords onto the host
  viaIdentity: boolean
  // Authenticate with the SSH agent, optionally limited to one key
  agent?: { fingerprint?: string | null }
}

interface CredLevel {
  username?: string
  password?: string
  keyId?: string | null
  identityId?: string | null
}

// Walk host → parent groups. Username and the secret (password or key) are taken from the
// nearest level that sets them; at each level an identity replaces that level's inline fields.
export function resolveHost(hostId: string): ResolvedHost {
  const vault = store.get()
  const host = vault.hosts.find((h) => h.id === hostId)
  if (!host) throw new Error('Host not found')
  const r: ResolvedHost = { host, address: host.address, port: host.port || 0, jumpHostId: host.jumpHostId, viaIdentity: false }
  let haveSecret = false
  let haveUser = false

  const apply = (level: CredLevel) => {
    let { username, password, keyId } = level
    let fromIdentity = false
    let agent: ResolvedHost['agent']
    const idn = level.identityId ? vault.identities.find((i) => i.id === level.identityId) : undefined
    if (idn) {
      fromIdentity = true
      username = idn.username || undefined
      password = idn.authType === 'password' ? idn.password : undefined
      keyId = idn.authType === 'key' ? idn.keyId : undefined
      if (idn.authType === 'agent') agent = { fingerprint: idn.agentKeyFingerprint }
    }
    if (!haveUser && username) {
      r.username = username
      haveUser = true
      r.viaIdentity ||= fromIdentity
    }
    // An identity claims the secret slot even without a saved password (it is then asked on connect)
    if (!haveSecret && (password || keyId || fromIdentity)) {
      r.password = password
      r.keyId = keyId
      r.agent = agent
      haveSecret = true
      r.viaIdentity ||= fromIdentity
    }
  }

  // Levels set to "use parent credentials" contribute nothing; the root level always counts
  if (!(host.groupId && usesParentCredentials(host))) apply(host)
  let gid = host.groupId
  const seen = new Set<string>()
  while (gid && !seen.has(gid)) {
    seen.add(gid)
    const g = vault.groups.find((x) => x.id === gid)
    if (!g) break
    if (!(g.parentId && usesParentCredentials(g))) apply(g)
    r.port ||= g.port || 0
    r.jumpHostId ||= g.jumpHostId
    gid = g.parentId
  }
  r.port ||= 22
  return r
}

export interface Connection {
  client: Client
  // Every client in the jump chain, target last; closing disposes all of them
  close(): void
}

type Log = (msg: string) => void

function makeHostVerifier(address: string, port: number) {
  return (key: Buffer, verify: (ok: boolean) => void) => {
    const fingerprint = fingerprintBlob(key)
    const keyType = blobKeyType(key)
    const known = store.get().knownHosts.find((k) => k.host === address && k.port === port)
    if (known && known.fingerprint === fingerprint) return verify(true)
    ask({
      kind: 'hostkey',
      host: address,
      port,
      keyType,
      fingerprint,
      previousFingerprint: known?.fingerprint
    }).then((res) => {
      const ok = 'accept' in res && res.accept
      if (ok && res.remember !== false) {
        store.upsert('knownHosts', {
          id: known?.id,
          host: address,
          port,
          keyType,
          fingerprint,
          addedAt: Date.now()
        })
      }
      verify(ok)
    })
  }
}

async function buildAuth(r: ResolvedHost, log: Log) {
  // Credentials typed at a prompt with "save" ticked, written to the host once auth succeeds
  const toSave: { username?: string; password?: string } = {}
  let username = r.username
  if (!username) {
    const res = await ask({
      kind: 'keyboard-interactive',
      title: `Connect to ${r.host.label || r.address}`,
      instructions: 'No username configured for this host.',
      prompts: [{ prompt: 'Username', echo: true }],
      offerSave: !r.viaIdentity
    })
    username = 'values' in res && res.values ? res.values[0].trim() : ''
    if (!username) throw new Error('Cancelled')
    if ('save' in res && res.save) toSave.username = username
  }

  const methods: any[] = []
  const key = r.keyId ? store.get().keys.find((k) => k.id === r.keyId) : undefined
  if (key) {
    let parsed = utils.parseKey(key.privateKey, key.passphrase || undefined)
    if (parsed instanceof Error && !key.passphrase) {
      const pass = await askSecret('Key passphrase', `Enter passphrase for key "${key.label}"`)
      if (pass) parsed = utils.parseKey(key.privateKey, pass)
    }
    if (parsed instanceof Error) log(`Key "${key.label}" could not be loaded: ${parsed.message}`)
    else methods.push({ type: 'publickey', username, key: Array.isArray(parsed) ? parsed[0] : parsed })
  }
  // Agent identity: only the agent (and the password prompt as last resort).
  // Otherwise the agent is a fallback when no key is configured.
  const agent = makeAgent(r.agent?.fingerprint)
  if (r.agent && !agent) log('No SSH agent available (check Settings → SSH agent)')
  if (agent && (r.agent || !key)) methods.push({ type: 'agent', username, agent })
  if (r.password) methods.push({ type: 'password', username, password: r.password })
  methods.push({
    type: 'keyboard-interactive',
    username,
    prompt: (_name: string, instructions: string, _lang: string, prompts: any[], finish: (r: string[]) => void) => {
      // Many servers send password prompts this way; reuse the stored password once
      if (r.password && prompts.length === 1 && /password/i.test(prompts[0].prompt)) {
        return finish([r.password])
      }
      const isPassword = prompts.length === 1 && !prompts[0].echo && /password/i.test(prompts[0].prompt)
      ask({
        kind: 'keyboard-interactive',
        title: `${username}@${r.address}`,
        instructions,
        prompts: prompts.map((p) => ({ prompt: p.prompt, echo: !!p.echo })),
        offerSave: isPassword && !r.viaIdentity
      }).then((res) => {
        const values = 'values' in res && res.values ? res.values : []
        if (isPassword) toSave.password = 'save' in res && res.save ? values[0] : undefined
        finish(values)
      })
    }
  })

  let passwordAttempts = 0
  const authHandler = (methodsLeft: string[] | null, _partial: boolean, cb: (m: any) => void) => {
    while (methods.length) {
      const m = methods.shift()
      if (!methodsLeft || methodsLeft.includes(m.type)) return cb(m)
    }
    if ((!methodsLeft || methodsLeft.includes('password')) && passwordAttempts < 3) {
      passwordAttempts++
      askSecretEx(
        `${username}@${r.address}`,
        passwordAttempts > 1 ? 'Authentication failed. Try again.' : 'Password',
        !r.viaIdentity
      ).then(({ value, save }) => {
        toSave.password = save && value ? value : undefined
        cb(value ? { type: 'password', username, password: value } : false)
      })
      return
    }
    cb(false)
  }
  const persist = () => {
    if (!toSave.username && !toSave.password) return
    const host = store.get().hosts.find((h) => h.id === r.host.id)
    if (host) {
      // Typed-and-saved credentials belong to the host from now on
      store.upsert('hosts', { ...host, ...toSave, inheritCredentials: false })
      notifyVaultChanged()
    }
  }
  return { username, authHandler, agentForward: !!(r.host.agentForwarding && agentPath()), agent: agentPath(), persist }
}

export async function connectHost(hostId: string, log: Log = () => {}, depth = 0): Promise<Connection> {
  if (depth > 5) throw new Error('Jump host chain too deep')
  const r = resolveHost(hostId)
  let jump: Connection | undefined
  let sock: any
  if (r.jumpHostId && r.jumpHostId !== hostId) {
    log(`Connecting via jump host…`)
    jump = await connectHost(r.jumpHostId, log, depth + 1)
    sock = await new Promise((resolve, reject) =>
      jump!.client.forwardOut('127.0.0.1', 0, r.address, r.port, (err, stream) =>
        err ? reject(err) : resolve(stream)
      )
    )
  }

  const auth = await buildAuth(r, log)
  const client = new Client()
  const config: ConnectConfig = {
    host: r.address,
    port: r.port,
    username: auth.username,
    sock,
    readyTimeout: 30000,
    keepaliveInterval: (r.host.keepAliveInterval ?? 30) * 1000,
    hostVerifier: makeHostVerifier(r.address, r.port) as any,
    authHandler: auth.authHandler as any,
    agent: auth.agent,
    agentForward: auth.agentForward
  }

  log(`Connecting to ${auth.username}@${r.address}:${r.port}…`)
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      client.removeListener('ready', onReady)
      jump?.close()
      reject(err)
    }
    const onReady = () => {
      client.removeListener('error', onError)
      resolve()
    }
    client.once('ready', onReady)
    client.once('error', onError)
    client.connect(config)
  })
  auth.persist()
  store.touchHost(hostId)
  client.on('close', () => jump?.close())

  return {
    client,
    close() {
      client.end()
      jump?.close()
    }
  }
}
