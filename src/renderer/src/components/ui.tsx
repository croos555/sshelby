import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Server, Folder, X, LucideIcon } from 'lucide-react'
import type { Host } from '@shared/types'
import { osBadge } from '../themes'

export function Field({
  icon: Icon,
  value,
  onChange,
  placeholder,
  type = 'text',
  suffix,
  autoFocus,
  onEnter
}: {
  icon?: LucideIcon
  value: string | number | undefined
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  suffix?: ReactNode
  autoFocus?: boolean
  onEnter?: () => void
}) {
  return (
    <label className="input">
      {Icon && <Icon size={15} />}
      <input
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </label>
  )
}

export function Select({
  icon: Icon,
  value,
  onChange,
  options,
  placeholder
}: {
  icon?: LucideIcon
  value: string | null | undefined
  onChange: (v: string | null) => void
  options: { value: string; label: string }[]
  placeholder: string
}) {
  return (
    <label className="input">
      {Icon && <Icon size={15} />}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ color: value ? 'var(--text)' : 'var(--text-3)' }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Panel({
  title,
  onClose,
  actions,
  footer,
  children
}: {
  title: string
  onClose: () => void
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="title">{title}</span>
        {actions}
        <button className="icon-btn" title="Close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="panel-body">{children}</div>
      {footer && <div className="panel-foot">{footer}</div>}
    </aside>
  )
}

export function Empty({
  icon: Icon,
  title,
  text,
  action
}: {
  icon: LucideIcon
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="tile">
        <Icon size={20} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function HostIcon({ host, size = 'md' }: { host: Host; size?: 'md' | 'sm' }) {
  const { color, letter } = osBadge(host.os)
  return (
    <div className={`icon-tile ${size === 'sm' ? 'sm' : ''}`} style={{ background: color }}>
      {letter || <Server size={size === 'sm' ? 15 : 18} />}
    </div>
  )
}

export function GroupIcon({ size = 'md' }: { size?: 'md' | 'sm' }) {
  return (
    <div className={`icon-tile ${size === 'sm' ? 'sm' : ''}`} style={{ background: 'var(--group-icon)' }}>
      <Folder size={size === 'sm' ? 15 : 18} />
    </div>
  )
}

export interface MenuItem {
  label: string
  icon?: LucideIcon
  danger?: boolean
  onClick: () => void
}

export type MenuState = { x: number; y: number; items: (MenuItem | '-')[] } | null

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8)
    })
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const close = () => onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu, onClose])
  if (!menu) return null
  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) =>
        it === '-' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              onClose()
              it.onClick()
            }}
          >
            {it.icon && <it.icon size={14} />}
            {it.label}
          </button>
        )
      )}
    </div>
  )
}

export function useMenu() {
  const [menu, setMenu] = useState<MenuState>(null)
  const open = (e: React.MouseEvent, items: (MenuItem | '-')[]) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }
  return { menu, open, close: () => setMenu(null) }
}

// Promise-based confirm dialog rendered by <ConfirmHost/>
type ConfirmReq = { title: string; message: string; danger?: boolean; confirm?: string; resolve: (v: boolean) => void }
let pushConfirm: ((r: ConfirmReq) => void) | null = null

export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => pushConfirm?.({ ...opts, resolve }))
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null)
  useEffect(() => {
    pushConfirm = setReq
    return () => {
      pushConfirm = null
    }
  }, [])
  if (!req) return null
  const done = (v: boolean) => {
    req.resolve(v)
    setReq(null)
  }
  return (
    <div className="overlay" onMouseDown={() => done(false)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{req.title}</h3>
        <p>{req.message}</p>
        <div className="actions">
          <button className="btn soft" onClick={() => done(false)}>
            Cancel
          </button>
          <button className={`btn ${req.danger ? 'danger solid' : 'primary'}`} autoFocus onClick={() => done(true)}>
            {req.confirm || 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Small text-input dialog (new folder, rename…)
type PromptReq = { title: string; label?: string; value?: string; resolve: (v: string | null) => void }
let pushPrompt: ((r: PromptReq) => void) | null = null

export function promptDialog(opts: Omit<PromptReq, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => pushPrompt?.({ ...opts, resolve }))
}

export function PromptHost() {
  const [req, setReq] = useState<PromptReq | null>(null)
  const [val, setVal] = useState('')
  useEffect(() => {
    pushPrompt = (r) => {
      setVal(r.value || '')
      setReq(r)
    }
    return () => {
      pushPrompt = null
    }
  }, [])
  if (!req) return null
  const done = (v: string | null) => {
    req.resolve(v)
    setReq(null)
  }
  return (
    <div className="overlay" onMouseDown={() => done(null)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{req.title}</h3>
        <Field
          value={val}
          onChange={setVal}
          placeholder={req.label}
          autoFocus
          onEnter={() => done(val.trim() || null)}
        />
        <div className="actions">
          <button className="btn soft" onClick={() => done(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => done(val.trim() || null)}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  const u = ['kB', 'MB', 'GB', 'TB']
  let i = -1
  do {
    n /= 1024
    i++
  } while (n >= 1024 && i < u.length - 1)
  return `${n.toFixed(n < 10 ? 2 : 1)} ${u[i]}`
}

export function formatPerms(mode: number, isDir: boolean): string {
  const r = (b: number, c: string) => (mode & b ? c : '-')
  return (
    (isDir ? 'd' : '-') +
    r(0o400, 'r') + r(0o200, 'w') + r(0o100, 'x') +
    r(0o040, 'r') + r(0o020, 'w') + r(0o010, 'x') +
    r(0o004, 'r') + r(0o002, 'w') + r(0o001, 'x')
  )
}
