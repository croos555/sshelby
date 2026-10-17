import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Braces, Palette, PanelRightClose, PanelRightOpen, RotateCw, X, Search } from 'lucide-react'
import { Tab, useStore } from '../store'
import { getTheme, THEMES } from '../themes'

const isMac = window.api.platform === 'darwin'

export default function TerminalTab({ tab, active }: { tab: Tab; active: boolean }) {
  const { vault, updateTab, closeTab, saveSettings, setView, setEditing } = useStore()
  const settings = vault!.settings
  const el = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal>(undefined)
  const fit = useRef<FitAddon>(undefined)
  const search = useRef<SearchAddon>(undefined)
  const sessionId = useRef<string>('')
  const [status, setStatus] = useState<{ s: Tab['status']; msg?: string }>({ s: 'connecting' })
  const [side, setSide] = useState<'snippets' | 'themes' | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')

  const connect = () => {
    const t = term.current!
    if (sessionId.current) window.api.ssh.close(sessionId.current)
    sessionId.current = crypto.randomUUID()
    setStatus({ s: 'connecting' })
    updateTab(tab.id, { status: 'connecting' })
    window.api.ssh.open(sessionId.current, tab.hostId!, t.cols, t.rows)
  }

  useEffect(() => {
    const t = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      theme: getTheme(settings.theme).theme,
      allowProposedApi: true,
      macOptionIsMeta: true
    })
    const f = new FitAddon()
    const s = new SearchAddon()
    t.loadAddon(f)
    t.loadAddon(s)
    t.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri)))
    t.open(el.current!)
    term.current = t
    fit.current = f
    search.current = s
    requestAnimationFrame(() => {
      f.fit()
      connect()
    })

    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = isMac ? e.metaKey : e.ctrlKey && e.shiftKey
      if (mod && e.key.toLowerCase() === 'c' && t.hasSelection()) {
        navigator.clipboard.writeText(t.getSelection())
        return false
      }
      if (mod && e.key.toLowerCase() === 'v') {
        // Let the native paste event reach xterm's textarea on macOS; handle Ctrl+Shift+V elsewhere
        if (!isMac) {
          navigator.clipboard.readText().then((txt) => t.paste(txt))
          return false
        }
        return true
      }
      if (mod && e.key.toLowerCase() === 'f') {
        setFindOpen(true)
        return false
      }
      return true
    })

    const offData = window.api.ssh.onData(({ sessionId: id, data }) => {
      if (id === sessionId.current) t.write(data)
    })
    const offStatus = window.api.ssh.onStatus(({ sessionId: id, status, message }) => {
      if (id !== sessionId.current) return
      setStatus({ s: status, msg: message })
      updateTab(tab.id, { status })
      if (status === 'error' && message) t.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`)
    })
    const inData = t.onData((d) => window.api.ssh.write(sessionId.current, d))
    const inResize = t.onResize(({ cols, rows }) => window.api.ssh.resize(sessionId.current, cols, rows))
    const inSelect = t.onSelectionChange(() => {
      if (useStore.getState().vault?.settings.copyOnSelect && t.hasSelection())
        navigator.clipboard.writeText(t.getSelection())
    })

    const ro = new ResizeObserver(() => {
      if (el.current?.offsetWidth) f.fit()
    })
    ro.observe(el.current!)

    return () => {
      ro.disconnect()
      offData()
      offStatus()
      inData.dispose()
      inResize.dispose()
      inSelect.dispose()
      window.api.ssh.close(sessionId.current)
      t.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live-apply settings changes
  useEffect(() => {
    const t = term.current
    if (!t) return
    t.options.theme = getTheme(settings.theme).theme
    t.options.fontFamily = settings.fontFamily
    t.options.fontSize = settings.fontSize
    t.options.cursorBlink = settings.cursorBlink
    t.options.scrollback = settings.scrollback
    fit.current?.fit()
  }, [settings.theme, settings.fontFamily, settings.fontSize, settings.cursorBlink, settings.scrollback])

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        fit.current?.fit()
        term.current?.focus()
      })
    }
  }, [active, side])

  const theme = getTheme(settings.theme).theme
  const runSnippet = (script: string) => {
    window.api.ssh.write(sessionId.current, script.replace(/\r?\n/g, '\r') + '\r')
    term.current?.focus()
  }

  return (
    <div className={`session ${active ? '' : 'hidden'}`} style={{ background: theme.background }}>
      <div
        className="term-wrap"
        onContextMenu={(e) => {
          e.preventDefault()
          const t = term.current!
          if (t.hasSelection()) {
            navigator.clipboard.writeText(t.getSelection())
            t.clearSelection()
          } else navigator.clipboard.readText().then((txt) => t.paste(txt))
        }}
      >
        <div className="term" ref={el} />
        {findOpen && (
          <div
            className="input"
            style={{ position: 'absolute', top: 8, right: 16, width: 260, background: '#262a34', color: '#ddd', zIndex: 3 }}
          >
            <Search size={14} />
            <input
              autoFocus
              value={findText}
              placeholder="Find"
              style={{ color: '#eee' }}
              onChange={(e) => {
                setFindText(e.target.value)
                search.current?.findNext(e.target.value, { incremental: true })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.shiftKey ? search.current?.findPrevious(findText) : search.current?.findNext(findText)
                if (e.key === 'Escape') {
                  setFindOpen(false)
                  search.current?.clearDecorations()
                  term.current?.focus()
                }
              }}
            />
            <button className="icon-btn" style={{ width: 20, height: 20 }} onClick={() => setFindOpen(false)}>
              <X size={12} />
            </button>
          </div>
        )}
        <button
          className="icon-btn"
          style={{ position: 'absolute', top: 6, right: 8, color: '#8a93a3', zIndex: 2, display: findOpen ? 'none' : undefined }}
          title={side ? 'Hide panel' : 'Snippets & themes'}
          onClick={() => setSide(side ? null : 'snippets')}
        >
          {side ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
        {(status.s === 'closed' || status.s === 'error') && (
          <div className="term-overlay">
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {status.s === 'closed' ? 'Session closed' : 'Connection failed'}
            </div>
            {status.msg && <div style={{ opacity: 0.8, maxWidth: 480 }}>{status.msg}</div>}
            <div className="row">
              <button className="btn primary" onClick={connect}>
                <RotateCw size={14} /> Reconnect
              </button>
              <button
                className="btn"
                style={{ color: '#e7e9ee' }}
                onClick={() => {
                  const host = vault!.hosts.find((h) => h.id === tab.hostId)
                  if (host) {
                    setView('hosts')
                    setEditing({ kind: 'host', item: host })
                  }
                }}
              >
                Edit host
              </button>
              <button className="btn" style={{ color: '#e7e9ee' }} onClick={() => closeTab(tab.id)}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
      {side && (
        <div className="term-side" style={{ background: theme.background }}>
          <div className="head">
            <button className={`icon-btn ${side === 'snippets' ? 'active' : ''}`} title="Snippets" onClick={() => setSide('snippets')}>
              <Braces size={15} />
            </button>
            <button className={`icon-btn ${side === 'themes' ? 'active' : ''}`} title="Themes" onClick={() => setSide('themes')}>
              <Palette size={15} />
            </button>
          </div>
          <div className="list">
            {side === 'snippets' && (
              <>
                <h5>Snippets</h5>
                {vault!.snippets.length === 0 && (
                  <div style={{ padding: 8, color: '#8a93a3', fontSize: 12 }}>
                    No snippets yet.{' '}
                    <button className="link" onClick={() => setView('snippets')}>
                      Create one
                    </button>
                  </div>
                )}
                {vault!.snippets.map((s) => (
                  <button key={s.id} className="snippet-item" onClick={() => runSnippet(s.script)} title="Run in this session">
                    <Braces size={14} style={{ flexShrink: 0, color: '#4fd1a5' }} />
                    <div className="meta">
                      <div>{s.label}</div>
                      <div className="mono">{s.script.split('\n')[0]}</div>
                    </div>
                  </button>
                ))}
              </>
            )}
            {side === 'themes' && (
              <>
                <h5>Themes</h5>
                {THEMES.map((th) => (
                  <button
                    key={th.id}
                    className={`theme-item ${settings.theme === th.id ? 'active' : ''}`}
                    onClick={() => saveSettings({ theme: th.id })}
                  >
                    <div className="theme-swatch" style={{ background: th.theme.background }}>
                      <span style={{ background: th.theme.green, width: '70%' }} />
                      <span style={{ background: th.theme.foreground, width: '45%' }} />
                      <span style={{ background: th.theme.blue, width: '60%' }} />
                    </div>
                    <span style={{ color: settings.theme === th.id ? '#4fd1a5' : undefined }}>{th.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
