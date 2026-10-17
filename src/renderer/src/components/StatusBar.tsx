import { Cpu, HardDrive, MemoryStick, Gauge, X } from 'lucide-react'
import type { HostStats } from '@shared/types'
import type { ITheme } from '@xterm/xterm'
import { formatSize } from './ui'

function level(pct: number) {
  return pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok'
}

function Meter({ pct }: { pct: number }) {
  return (
    <span className={`sb-meter ${level(pct)}`}>
      <span style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} />
    </span>
  )
}

const short = (n: number) => formatSize(n).replace(' ', '').replace('kB', 'K').replace(/B$/, '')

// Remote CPU / RAM / disk usage under a terminal, MobaXterm style
export default function StatusBar({
  stats,
  theme,
  onHide
}: {
  stats: HostStats | null
  theme: ITheme
  onHide: () => void
}) {
  const memPct = stats?.mem ? (stats.mem.used / stats.mem.total) * 100 : undefined
  const swapPct = stats?.swap && stats.swap.total ? (stats.swap.used / stats.swap.total) * 100 : undefined
  return (
    <div
      className="statusbar"
      style={{ '--sb-fg': theme.foreground, background: theme.background } as React.CSSProperties}
    >
      {!stats ? (
        <span className="sb-item dim">Reading host resources…</span>
      ) : (
        <>
          {stats.cpu !== undefined && (
            <span className="sb-item" title={stats.cores ? `${stats.cores} cores` : undefined}>
              <Cpu size={12} />
              CPU <Meter pct={stats.cpu} />
              <b>{Math.round(stats.cpu)}%</b>
            </span>
          )}
          {stats.mem && memPct !== undefined && (
            <span
              className="sb-item"
              title={stats.swap ? `Swap ${short(stats.swap.used)} / ${short(stats.swap.total)}` : undefined}
            >
              <MemoryStick size={12} />
              RAM <Meter pct={memPct} />
              <b>
                {short(stats.mem.used)} / {short(stats.mem.total)}
              </b>
              {swapPct !== undefined && swapPct >= 1 && <span className="dim">swap {Math.round(swapPct)}%</span>}
            </span>
          )}
          {stats.load && (
            <span className="sb-item" title="Load average (1, 5, 15 min)">
              <Gauge size={12} />
              <b>{stats.load.map((l) => l.toFixed(2)).join(' ')}</b>
            </span>
          )}
          {stats.disks.map((d) => {
            const pct = (d.used / d.total) * 100
            return (
              <span key={d.mount} className="sb-item" title={`${d.mount}: ${short(d.used)} / ${short(d.total)}`}>
                <HardDrive size={12} />
                <span className="sb-mount">{d.mount}</span>
                <Meter pct={pct} />
                <b>{Math.round(pct)}%</b>
              </span>
            )
          })}
        </>
      )}
      <button className="sb-hide" title="Hide status bar (Settings → Terminal to show it again)" onClick={onHide}>
        <X size={11} />
      </button>
    </div>
  )
}
