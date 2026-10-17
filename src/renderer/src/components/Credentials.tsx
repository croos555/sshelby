import { useState } from 'react'
import { Database, Eye, EyeOff, IdCard, KeyRound, Lock, Pencil, Save, User } from 'lucide-react'
import { errMsg, useStore } from '../store'
import { Field, promptDialog, Select } from './ui'

export interface CredValue {
  username?: string
  password?: string
  keyId?: string | null
  identityId?: string | null
}

// Credentials block shared by the host and group editors: either a keychain identity or inline fields
export default function Credentials({ value, onChange }: { value: CredValue; onChange: (patch: CredValue) => void }) {
  const { vault, upsert, setEditing, notify } = useStore()
  const [showPw, setShowPw] = useState(false)
  if (!vault) return null
  const identity = value.identityId ? vault.identities.find((i) => i.id === value.identityId) : undefined
  const canSaveAsIdentity = !!value.username && !!(value.password || value.keyId)

  const saveAsIdentity = async () => {
    const label = await promptDialog({ title: 'Save as identity', label: 'Identity name', value: value.username })
    if (!label) return
    try {
      const idn = await upsert('identities', {
        label,
        username: value.username,
        authType: value.keyId ? 'key' : 'password',
        password: value.keyId ? undefined : value.password,
        keyId: value.keyId || null
      })
      // The identity now carries the credentials; clear the inline copies
      onChange({ identityId: idn.id, username: '', password: '', keyId: null })
      notify(`Identity "${label}" created`)
    } catch (err) {
      notify(errMsg(err), true)
    }
  }

  return (
    <>
      <Select
        icon={IdCard}
        value={value.identityId}
        onChange={(v) => onChange({ identityId: v })}
        options={vault.identities.map((i) => ({
          value: i.id,
          label: i.authType === 'keepass' ? `${i.label} (KeePass)` : `${i.label} (${i.username})`
        }))}
        placeholder="No identity: enter credentials below"
      />
      {identity ? (
        <div className="identity-summary">
          {identity.authType === 'key' ? <KeyRound size={14} /> : identity.authType === 'keepass' ? <Database size={14} /> : <Lock size={14} />}
          <div className="grow">
            <div>{identity.username || identity.label}</div>
            <div className="hint">
              {identity.authType === 'key'
                ? `Key: ${vault.keys.find((k) => k.id === identity.keyId)?.label || 'missing'}`
                : identity.authType === 'keepass'
                  ? `KeePass: ${identity.keepassEntryLabel || 'no entry'}`
                  : identity.password
                  ? 'Password saved'
                  : 'Password asked on connect'}
            </div>
          </div>
          <button className="icon-btn" title="Edit identity" onClick={() => setEditing({ kind: 'identity', item: identity })}>
            <Pencil size={13} />
          </button>
        </div>
      ) : (
        <>
          <Field icon={User} value={value.username} onChange={(v) => onChange({ username: v })} placeholder="Username" />
          <label className="input">
            <Lock size={15} />
            <input
              type={showPw ? 'text' : 'password'}
              value={value.password ?? ''}
              placeholder="Password"
              onChange={(e) => onChange({ password: e.target.value })}
            />
            <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={() => setShowPw(!showPw)}>
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </label>
          <Select
            icon={KeyRound}
            value={value.keyId}
            onChange={(v) => onChange({ keyId: v })}
            options={vault.keys.map((k) => ({ value: k.id, label: `${k.label} (${k.type})` }))}
            placeholder="SSH key"
          />
          {canSaveAsIdentity && (
            <button className="link" onClick={saveAsIdentity}>
              <Save size={12} /> Save as identity
            </button>
          )}
        </>
      )}
    </>
  )
}
