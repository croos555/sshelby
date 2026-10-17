import type { Group, Host } from './types'

type CredHolder = Pick<Host, 'username' | 'password' | 'keyId' | 'identityId'> & { inheritCredentials?: boolean }

export function hasOwnCredentials(x: CredHolder): boolean {
  return !!(x.identityId || x.username || x.password || x.keyId)
}

// "Use parent credentials": explicit flag, else on unless the item already has credentials of its own
// (keeps hosts created before the option behaving as they did)
export function usesParentCredentials(x: CredHolder): boolean {
  return x.inheritCredentials ?? !hasOwnCredentials(x)
}

// First ancestor group that defines credentials, walking up from groupId
export function credentialSource(groups: Group[], groupId?: string | null): Group | undefined {
  const seen = new Set<string>()
  while (groupId && !seen.has(groupId)) {
    seen.add(groupId)
    const g = groups.find((x) => x.id === groupId)
    if (!g) return undefined
    if (!(g.parentId && usesParentCredentials(g)) && hasOwnCredentials(g)) return g
    groupId = g.parentId
  }
  return undefined
}
