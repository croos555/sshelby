import { ipcMain } from 'electron'
import { BaseAgent, createAgent, ParsedKey } from 'ssh2'
import { store } from './store'
import { fingerprintBlob } from './keys'
import { asKey, FilteredAgent } from './agent-core'

// SSH agent integration (ssh-agent, KeePassXC's SSH agent, Pageant, Windows OpenSSH agent)

const WIN_OPENSSH_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'

// Which agent to talk to, from Settings: auto = SSH_AUTH_SOCK, else the Windows OpenSSH pipe
export function agentPath(): string | undefined {
  const { agentSource, agentPath: custom } = store.get().settings
  if (agentSource === 'pageant') return 'pageant'
  if (agentSource === 'custom') return custom || undefined
  if (process.env.SSH_AUTH_SOCK) return process.env.SSH_AUTH_SOCK
  return process.platform === 'win32' ? WIN_OPENSSH_PIPE : undefined
}

export function makeAgent(fingerprint?: string | null): BaseAgent<any> | string | undefined {
  const path = agentPath()
  if (!path) return undefined
  return fingerprint ? new FilteredAgent(createAgent(path), fingerprint) : path
}

export interface AgentKeyInfo {
  type: string
  comment: string
  fingerprint: string
}

export function listAgentKeys(): Promise<AgentKeyInfo[]> {
  const path = agentPath()
  if (!path) {
    return Promise.reject(
      new Error('No SSH agent found. Start one (or enable KeePassXC’s SSH Agent integration) or set its socket in Settings.')
    )
  }
  return new Promise((resolve, reject) => {
    createAgent(path).getIdentities((err, keys) => {
      if (err) return reject(new Error(`Cannot reach the SSH agent (${path}): ${err.message}`))
      resolve(
        ((keys || []) as any[])
          .map(asKey)
          .filter((k): k is ParsedKey => !!k)
          .map((k) => ({ type: k.type, comment: k.comment, fingerprint: fingerprintBlob(k.getPublicSSH()) }))
      )
    })
  })
}

ipcMain.handle('agent:list', () => listAgentKeys())
ipcMain.handle('agent:path', () => agentPath() || null)
