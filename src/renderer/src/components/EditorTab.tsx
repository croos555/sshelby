import { useEffect, useRef, useState } from 'react'
import { basicSetup } from 'codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { RotateCw, Save, AlertTriangle, Loader2 } from 'lucide-react'
import { errMsg, Tab, useStore } from '../store'
import { confirmDialog } from './ui'

function isDark() {
  return document.documentElement.dataset.theme === 'dark'
}

// Built-in editor for a remote file, saved back over the SFTP session it was opened from
export default function EditorTab({ tab, active }: { tab: Tab; active: boolean }) {
  const { updateTab, notify, vault } = useStore()
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(undefined)
  const mtime = useRef<number | undefined>(undefined)
  const saved = useRef('')
  const themeComp = useRef(new Compartment())
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (force = false) => {
    const v = view.current
    if (!v || !tab.sftpId || !tab.path) return
    const content = v.state.doc.toString()
    setSaving(true)
    try {
      const res = await window.api.sftp.writeText(tab.sftpId, tab.path, content, force ? undefined : mtime.current)
      mtime.current = res.mtime
      saved.current = content
      updateTab(tab.id, { dirty: false })
      notify(`Saved ${tab.title}`)
    } catch (err) {
      const msg = errMsg(err)
      if (msg.startsWith('CONFLICT')) {
        const ok = await confirmDialog({
          title: 'File changed on the server',
          message: `${tab.path} was modified on the server after you opened it. Overwrite it with your version?`,
          danger: true,
          confirm: 'Overwrite'
        })
        if (ok) return save(true)
      } else notify(msg, true)
    } finally {
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  const load = async () => {
    if (!tab.sftpId || !tab.path) return
    setState('loading')
    try {
      const { content, mtime: m } = await window.api.sftp.readText(tab.sftpId, tab.path)
      mtime.current = m
      saved.current = content
      // Keep the file's line endings when saving
      const crlf = /\r\n/.test(content)
      const lang = LanguageDescription.matchFilename(languages, tab.path.split('/').pop() || '')
      const support = lang ? await lang.load().catch(() => null) : null
      view.current?.destroy()
      view.current = new EditorView({
        parent: host.current!,
        state: EditorState.create({
          doc: content,
          extensions: [
            basicSetup,
            keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (saveRef.current(), true) }]),
            ...(crlf ? [EditorState.lineSeparator.of('\r\n')] : []),
            ...(support ? [support] : []),
            themeComp.current.of(isDark() ? oneDark : []),
            EditorView.theme({
              '&': { height: '100%', fontSize: `${vault?.settings.fontSize || 13}px` },
              '.cm-scroller': { fontFamily: vault?.settings.fontFamily || 'monospace' }
            }),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) updateTab(tab.id, { dirty: u.state.doc.toString() !== saved.current })
            })
          ]
        })
      })
      setState('ready')
      view.current.focus()
    } catch (err) {
      setError(errMsg(err))
      setState('error')
    }
  }

  useEffect(() => {
    load()
    // Follow the app's light/dark switch
    const obs = new MutationObserver(() =>
      view.current?.dispatch({ effects: themeComp.current.reconfigure(isDark() ? oneDark : []) })
    )
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      obs.disconnect()
      view.current?.destroy()
      // Drop our hold on the SFTP connection
      if (tab.sftpId) window.api.sftp.close(tab.sftpId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (active) requestAnimationFrame(() => view.current?.focus())
  }, [active])

  const reload = async () => {
    if (tab.dirty && !(await confirmDialog({ title: 'Reload from server', message: 'Discard your unsaved changes?', danger: true, confirm: 'Reload' })))
      return
    await load()
    updateTab(tab.id, { dirty: false })
  }

  return (
    <div className={`editor-tab ${active ? '' : 'hidden'}`}>
      <div className="editor-bar">
        <span className="mono editor-path" title={tab.path}>
          {tab.path}
        </span>
        <span className="hint">{tab.dirty ? 'Modified' : state === 'ready' ? 'Saved' : ''}</span>
        <button className="btn soft" onClick={reload} disabled={state === 'loading'}>
          <RotateCw size={13} /> Reload
        </button>
        <button className="btn primary" onClick={() => save()} disabled={state !== 'ready' || saving || !tab.dirty}>
          {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Save
        </button>
      </div>
      {state === 'error' && (
        <div className="empty">
          <div className="tile">
            <AlertTriangle size={20} color="var(--danger)" />
          </div>
          <h3>Cannot open file</h3>
          <p>{error}</p>
        </div>
      )}
      {state === 'loading' && (
        <div className="empty">
          <Loader2 size={22} className="spin" />
        </div>
      )}
      <div className="editor-host" ref={host} style={{ display: state === 'ready' ? undefined : 'none' }} />
    </div>
  )
}
