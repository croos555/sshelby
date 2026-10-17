// Keyword highlighting for terminal output (MobaXterm-style), applied to the byte stream before xterm renders it.
// Only text printed in the default color is touched, and nothing happens on the alternate screen (vim, htop, less…).

import type { HighlightRule } from '@shared/types'
export type { HighlightRule }

export const COLOR_CODES: Record<string, number> = {
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  gray: 90,
  'bright-red': 91,
  'bright-green': 92,
  'bright-yellow': 93,
  'bright-blue': 94,
  'bright-magenta': 95,
  'bright-cyan': 96
}

export const DEFAULT_RULES: HighlightRule[] = [
  { id: 'err', label: 'Errors', pattern: '\\b(error|errors|fatal|failed|failure|fail|critical|crit|panic|denied|refused|exception|traceback|segfault)\\b', color: 'bright-red', bold: true, enabled: true },
  { id: 'warn', label: 'Warnings', pattern: '\\b(warn|warning|warnings|deprecated|timeout|timed out)\\b', color: 'bright-yellow', enabled: true },
  { id: 'ok', label: 'Success', pattern: '\\b(ok|success|successful|succeeded|passed|done|active \\(running\\)|enabled)\\b', color: 'bright-green', enabled: true },
  { id: 'info', label: 'Info / debug', pattern: '\\b(info|notice|debug|trace)\\b', color: 'cyan', enabled: true },
  { id: 'ip', label: 'IP addresses', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}(?:/\\d{1,2})?(?::\\d+)?\\b', color: 'bright-magenta', caseSensitive: true, enabled: true },
  { id: 'date', label: 'Dates & times', pattern: '\\b\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?\\b|\\b\\d{2}:\\d{2}:\\d{2}\\b', color: 'blue', caseSensitive: true, enabled: true },
  { id: 'url', label: 'URLs', pattern: 'https?://[^\\s"\'<>]+', color: 'bright-blue', caseSensitive: true, enabled: false }
]

interface Compiled {
  re: RegExp
  color: number
  bold: boolean
}

export function compileRules(rules: HighlightRule[]): Compiled[] {
  const out: Compiled[] = []
  for (const r of rules) {
    if (!r.enabled || !r.pattern) continue
    try {
      const re = new RegExp(r.pattern, r.caseSensitive ? 'g' : 'gi')
      // A pattern that matches the empty string would loop forever
      if (re.test('')) continue
      out.push({ re, color: COLOR_CODES[r.color] || 31, bold: !!r.bold })
    } catch {
      // invalid regex typed by the user: ignore that rule
    }
  }
  return out
}

// Escape sequences: CSI, OSC (BEL or ST terminated), and two-byte ESC sequences
const ESC_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export class Highlighter {
  private rules: Compiled[] = []
  private altScreen = false
  // Foreground color set by the program (we only color text in the default color)
  private fgSet = false
  // Bold set by the program: keep it when closing our own color
  private boldSet = false

  setRules(rules: HighlightRule[]) {
    this.rules = compileRules(rules)
  }

  process(chunk: string): string {
    if (!this.rules.length) {
      this.track(chunk)
      return chunk
    }
    let out = ''
    let last = 0
    ESC_RE.lastIndex = 0
    for (let m = ESC_RE.exec(chunk); m; m = ESC_RE.exec(chunk)) {
      out += this.colorize(chunk.slice(last, m.index))
      out += m[0]
      this.onEscape(m[0])
      last = m.index + m[0].length
    }
    return out + this.colorize(chunk.slice(last))
  }

  private track(chunk: string) {
    ESC_RE.lastIndex = 0
    for (let m = ESC_RE.exec(chunk); m; m = ESC_RE.exec(chunk)) this.onEscape(m[0])
  }

  private onEscape(seq: string) {
    if (/^\x1b\[\?(1049|1047|47)h$/.test(seq)) this.altScreen = true
    else if (/^\x1b\[\?(1049|1047|47)l$/.test(seq)) this.altScreen = false
    else if (seq.startsWith('\x1b[') && seq.endsWith('m')) this.onSgr(seq.slice(2, -1))
  }

  private onSgr(params: string) {
    const ps = params === '' ? [0] : params.split(/[;:]/).map(Number)
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      if (p === 0) {
        this.fgSet = false
        this.boldSet = false
      } else if (p === 39) this.fgSet = false
      else if (p === 1) this.boldSet = true
      else if (p === 22) this.boldSet = false
      else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) this.fgSet = true
      else if (p === 38) {
        this.fgSet = true
        i += ps[i + 1] === 5 ? 2 : 4 // skip 256-color / truecolor arguments
      } else if (p === 48) i += ps[i + 1] === 5 ? 2 : 4
    }
  }

  private colorize(text: string): string {
    if (!text || this.altScreen || this.fgSet) return text
    // Collect non-overlapping matches, earlier rules win
    const marks: { start: number; end: number; rule: Compiled }[] = []
    for (const r of this.rules) {
      r.re.lastIndex = 0
      for (let m = r.re.exec(text); m; m = r.re.exec(text)) {
        const start = m.index
        const end = start + m[0].length
        if (end === start) {
          r.re.lastIndex++
          continue
        }
        if (!marks.some((x) => start < x.end && end > x.start)) marks.push({ start, end, rule: r })
      }
    }
    if (!marks.length) return text
    marks.sort((a, b) => a.start - b.start)
    let out = ''
    let pos = 0
    for (const mk of marks) {
      // Undo only what we set: 39 = default foreground, 22 = normal intensity (unless the program wanted bold)
      const addBold = mk.rule.bold && !this.boldSet
      const open = `\x1b[${addBold ? '1;' : ''}${mk.rule.color}m`
      const close = addBold ? '\x1b[22;39m' : '\x1b[39m'
      out += text.slice(pos, mk.start) + open + text.slice(mk.start, mk.end) + close
      pos = mk.end
    }
    return out + text.slice(pos)
  }
}
