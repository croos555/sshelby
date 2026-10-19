import { useEffect } from 'react'
import {
  Activity,
  BarChart3,
  Bot,
  Box,
  Boxes,
  Brain,
  Briefcase,
  Bug,
  Building2,
  Cloud,
  Code2,
  Container,
  Cpu,
  Database,
  Factory,
  FlaskConical,
  Flame,
  Folder,
  Gamepad2,
  GitBranch,
  Globe,
  HardDrive,
  Heart,
  Home,
  KeyRound,
  Laptop,
  Leaf,
  Lock,
  LucideIcon,
  Mail,
  MessageSquare,
  Monitor,
  Network,
  Package,
  Printer,
  Rocket,
  Router,
  Server,
  Settings,
  Shield,
  Star,
  Terminal,
  User,
  Users,
  Wifi,
  Wrench,
  X,
  Zap
} from 'lucide-react'

export const ICONS: Record<string, LucideIcon> = {
  server: Server,
  database: Database,
  cloud: Cloud,
  globe: Globe,
  monitor: Monitor,
  laptop: Laptop,
  cpu: Cpu,
  'hard-drive': HardDrive,
  router: Router,
  wifi: Wifi,
  network: Network,
  container: Container,
  box: Box,
  boxes: Boxes,
  package: Package,
  shield: Shield,
  lock: Lock,
  key: KeyRound,
  terminal: Terminal,
  code: Code2,
  git: GitBranch,
  activity: Activity,
  chart: BarChart3,
  mail: Mail,
  chat: MessageSquare,
  printer: Printer,
  user: User,
  users: Users,
  home: Home,
  building: Building2,
  factory: Factory,
  briefcase: Briefcase,
  flask: FlaskConical,
  bug: Bug,
  wrench: Wrench,
  settings: Settings,
  rocket: Rocket,
  zap: Zap,
  flame: Flame,
  bot: Bot,
  brain: Brain,
  gamepad: Gamepad2,
  leaf: Leaf,
  star: Star,
  heart: Heart,
  folder: Folder
}

export const COLORS = [
  '#3d4556',
  '#0b3d6b',
  '#1f8ef1',
  '#14a3b8',
  '#1f9d68',
  '#5f9e2f',
  '#d4a017',
  '#e8743b',
  '#e95420',
  '#d6453d',
  '#c2306e',
  '#8b5cf6'
]

// Tile used for hosts and groups with a custom icon/color
export function CustomTile({
  icon,
  color,
  size = 'md',
  fallbackColor
}: {
  icon?: string | null
  color?: string | null
  size?: 'md' | 'sm' | 'xs'
  fallbackColor: string
}) {
  const Icon = (icon && ICONS[icon]) || Server
  const px = size === 'xs' ? 10 : size === 'sm' ? 15 : 18
  const style =
    size === 'xs'
      ? { width: 16, height: 16, borderRadius: 4, background: color || fallbackColor }
      : { background: color || fallbackColor }
  return (
    <div className={`icon-tile ${size === 'sm' ? 'sm' : ''}`} style={style}>
      <Icon size={px} />
    </div>
  )
}

export function IconPicker({
  icon,
  color,
  autoLabel,
  autoPreview,
  onChange,
  onClose
}: {
  icon?: string | null
  color?: string | null
  autoLabel: string
  autoPreview: React.ReactNode
  onChange: (patch: { icon?: string | null; color?: string | null }) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const current = color || COLORS[0]
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal icon-picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row">
          <h3 className="grow">Icon</h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="icon-grid">
          <button
            className={`icon-choice auto ${!icon ? 'on' : ''}`}
            title={autoLabel}
            onClick={() => onChange({ icon: null, color: null })}
          >
            {autoPreview}
            <span>Auto</span>
          </button>
          {Object.entries(ICONS).map(([id, Icon]) => (
            <button
              key={id}
              className={`icon-choice ${icon === id ? 'on' : ''}`}
              title={id}
              onClick={() => onChange({ icon: id, color: color || current })}
            >
              <span className="swatch" style={{ background: current }}>
                <Icon size={16} />
              </span>
            </button>
          ))}
        </div>
        <h4 style={{ margin: '4px 0 0' }}>Color</h4>
        <div className="color-row">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`color-dot ${current === c && icon ? 'on' : ''}`}
              style={{ background: c }}
              disabled={!icon}
              onClick={() => onChange({ color: c })}
            />
          ))}
        </div>
        <p className="hint">{icon ? 'The color applies to the selected icon.' : `Auto: ${autoLabel}. Pick an icon to choose a color.`}</p>
      </div>
    </div>
  )
}
