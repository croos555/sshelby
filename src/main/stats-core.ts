import type { HostStats } from '../shared/types'

// Remote resource sampling for the terminal status bar. Pure parsing, no Electron, testable with plain Node.

// One round trip: CPU counters, memory, load and disk usage, separated by markers
export const STATS_COMMAND = [
  'head -1 /proc/stat 2>/dev/null',
  'echo @@',
  "grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null",
  'echo @@',
  'cat /proc/loadavg 2>/dev/null',
  'echo @@',
  'nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null',
  'echo @@',
  'df -kP 2>/dev/null'
].join('; ')

// Pseudo or uninteresting filesystems
const SKIP_FS = /^(tmpfs|devtmpfs|udev|overlay|shm|none|squashfs|efivarfs|cgroup.*|proc|sysfs|run|map .*)$/i
// Container bind mounts of single files live under /etc; macOS system sub-volumes and simulator images are noise
const SKIP_MOUNT =
  /^\/(dev|proc|sys|run|snap|etc|var\/lib\/docker|var\/snap|boot\/efi)(\/|$)|^\/System\/Volumes\/(?!Data$)|^\/Library\/Developer\//

export interface CpuSample {
  idle: number
  total: number
}

export function parseStats(out: string, prev?: CpuSample): { stats: HostStats; cpuSample?: CpuSample } {
  const [statPart = '', memPart = '', loadPart = '', nprocPart = '', dfPart = ''] = out.split(/^@@$/m)
  const stats: HostStats = { disks: [] }

  // cpu  user nice system idle iowait irq softirq steal ...
  let cpuSample: CpuSample | undefined
  const cpu = statPart.trim().match(/^cpu\s+(.+)$/m)
  if (cpu) {
    const v = cpu[1].trim().split(/\s+/).map(Number)
    const idle = (v[3] || 0) + (v[4] || 0)
    const total = v.slice(0, 8).reduce((a, b) => a + (b || 0), 0)
    cpuSample = { idle, total }
    if (prev && total > prev.total) {
      stats.cpu = Math.max(0, Math.min(100, (1 - (idle - prev.idle) / (total - prev.total)) * 100))
    }
  }

  const mem: Record<string, number> = {}
  for (const m of memPart.matchAll(/^(\w+):\s+(\d+)/gm)) mem[m[1]] = Number(m[2]) * 1024
  if (mem.MemTotal) {
    // Older kernels lack MemAvailable
    const avail = mem.MemAvailable ?? (mem.MemFree || 0) + (mem.Buffers || 0) + (mem.Cached || 0)
    stats.mem = { used: mem.MemTotal - avail, total: mem.MemTotal }
  }
  if (mem.SwapTotal) stats.swap = { used: mem.SwapTotal - (mem.SwapFree || 0), total: mem.SwapTotal }

  const load = loadPart.trim().split(/\s+/).slice(0, 3).map(Number)
  if (load.length === 3 && load.every((x) => !isNaN(x))) stats.load = load as [number, number, number]
  const n = parseInt(nprocPart.trim(), 10)
  if (n > 0) stats.cores = n

  const seen = new Set<string>()
  for (const line of dfPart.trim().split('\n').slice(1)) {
    // Filesystem 1024-blocks Used Available Capacity Mounted-on (mount may contain spaces)
    const m = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/)
    if (!m) continue
    const [, fs, size, used, avail, , mount] = m
    // "/" always counts, even on an overlay (containers, LXC)
    if (mount !== '/' && (SKIP_FS.test(fs) || SKIP_MOUNT.test(mount))) continue
    if (Number(size) === 0) continue
    // Same device mounted twice (bind mounts): keep the first
    if (seen.has(fs) && fs.startsWith('/')) continue
    seen.add(fs)
    const total = (Number(used) + Number(avail)) * 1024
    stats.disks.push({ mount, used: Number(used) * 1024, total })
  }
  // macOS: the user's data lives on the Data volume, "/" is the sealed system snapshot
  const data = stats.disks.find((d) => d.mount === '/System/Volumes/Data')
  if (data) stats.disks = [{ ...data, mount: '/' }, ...stats.disks.filter((d) => d !== data && d.mount !== '/')]
  // Root first, then the largest ones
  stats.disks.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : b.total - a.total))
  stats.disks = stats.disks.slice(0, 5)
  return { stats, cpuSample }
}
