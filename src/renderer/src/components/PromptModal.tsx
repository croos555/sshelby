import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldQuestion, KeyRound } from 'lucide-react'
import type { PromptRequest } from '@shared/types'
import { Field } from './ui'

// Queue of interactive prompts raised by the main process while connecting
export default function PromptModal() {
  const [queue, setQueue] = useState<PromptRequest[]>([])
  const [values, setValues] = useState<string[]>([])
  const [remember, setRemember] = useState(true)

  useEffect(() => window.api.prompts.onRequest((req) => setQueue((q) => [...q, req])), [])

  const req = queue[0]
  useEffect(() => {
    setValues(req?.kind === 'keyboard-interactive' ? req.prompts.map(() => '') : [''])
    setRemember(true)
  }, [req?.id])

  if (!req) return null
  const pop = () => setQueue((q) => q.slice(1))

  if (req.kind === 'hostkey') {
    const changed = !!req.previousFingerprint
    const answer = (accept: boolean) => {
      window.api.prompts.respond({ id: req.id, accept, remember })
      pop()
    }
    return (
      <div className="overlay">
        <div className="modal">
          <h3>
            {changed ? <ShieldAlert size={18} color="var(--danger)" /> : <ShieldQuestion size={18} color="var(--accent)" />}
            {changed ? 'Host key has changed!' : 'Unknown host'}
          </h3>
          {changed ? (
            <div className="warning-box">
              The fingerprint of <strong>{req.host}</strong> does not match the one you trusted before. This can mean the
              server was reinstalled — or that someone is intercepting the connection. Only continue if you know why it
              changed.
            </div>
          ) : (
            <p>
              The authenticity of <strong>{req.host}{req.port !== 22 ? `:${req.port}` : ''}</strong> can’t be established.
              Check that the fingerprint matches the server before continuing.
            </p>
          )}
          <div className="fingerprint">
            <div className="hint" style={{ marginBottom: 4 }}>{req.keyType}</div>
            <div className="mono">{req.fingerprint}</div>
            {changed && (
              <>
                <div className="hint" style={{ margin: '8px 0 4px' }}>Previously trusted</div>
                <div className="mono" style={{ textDecoration: 'line-through', opacity: 0.7 }}>{req.previousFingerprint}</div>
              </>
            )}
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Remember this host key</span>
          </label>
          <div className="actions">
            <button className="btn soft" onClick={() => answer(false)} autoFocus>
              Cancel
            </button>
            <button className={`btn ${changed ? 'danger solid' : 'primary'}`} onClick={() => answer(true)}>
              {changed ? 'Accept new key' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const prompts =
    req.kind === 'password' ? [{ prompt: req.message, echo: false }] : req.prompts
  const submit = (ok: boolean) => {
    window.api.prompts.respond({ id: req.id, values: ok ? values : null, save: ok && !!req.offerSave && remember })
    pop()
  }

  return (
    <div className="overlay">
      <div className="modal">
        <h3>
          <KeyRound size={18} color="var(--accent)" />
          {req.title}
        </h3>
        {req.kind === 'keyboard-interactive' && req.instructions && <p>{req.instructions}</p>}
        {prompts.map((p, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(req.kind === 'keyboard-interactive' || prompts.length > 1) && (
              <span className="hint">{p.prompt}</span>
            )}
            <Field
              type={p.echo ? 'text' : 'password'}
              value={values[i]}
              placeholder={req.kind === 'password' ? req.message : p.prompt.replace(/:\s*$/, '')}
              autoFocus={i === 0}
              onChange={(v) => setValues((vs) => vs.map((x, j) => (j === i ? v : x)))}
              onEnter={() => i === prompts.length - 1 && submit(true)}
            />
          </div>
        ))}
        {req.offerSave && (
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Save to host</span>
          </label>
        )}
        <div className="actions">
          <button className="btn soft" onClick={() => submit(false)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => submit(true)}>
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
