import type { ITheme } from '@xterm/xterm'

export interface TermTheme {
  id: string
  name: string
  theme: ITheme
}

const base16 = (
  bg: string,
  fg: string,
  c: [string, string, string, string, string, string, string, string],
  bright?: [string, string, string, string, string, string, string, string]
): ITheme => {
  const b = bright || c
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: fg + '40',
    black: c[0],
    red: c[1],
    green: c[2],
    yellow: c[3],
    blue: c[4],
    magenta: c[5],
    cyan: c[6],
    white: c[7],
    brightBlack: b[0],
    brightRed: b[1],
    brightGreen: b[2],
    brightYellow: b[3],
    brightBlue: b[4],
    brightMagenta: b[5],
    brightCyan: b[6],
    brightWhite: b[7]
  }
}

export const THEMES: TermTheme[] = [
  {
    id: 'sshelby-dark',
    name: 'Sshelby Dark',
    theme: {
      ...base16(
        '#141729',
        '#21d07a',
        ['#2b2f42', '#ff5c7a', '#21d07a', '#f5c451', '#4ea6ff', '#c678dd', '#3fd0d4', '#d6dbe5'],
        ['#5b6178', '#ff7d95', '#4ee69a', '#ffd879', '#76bbff', '#d79cf0', '#69e3e6', '#ffffff']
      ),
      cursor: '#21d07a'
    }
  },
  {
    id: 'sshelby-light',
    name: 'Sshelby Light',
    theme: base16(
      '#f7f9fb',
      '#2b3140',
      ['#2b3140', '#d6334a', '#1c9a5a', '#b7861b', '#1f72d1', '#9c46c4', '#168d93', '#c9ced8'],
      ['#6b7385', '#e5566a', '#25b56d', '#cf9d2e', '#3e8ae6', '#b467d6', '#20a6ad', '#ffffff']
    )
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    theme: base16(
      '#21252b',
      '#abb2bf',
      ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf'],
      ['#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']
    )
  },
  {
    id: 'dracula',
    name: 'Dracula',
    theme: base16(
      '#282a36',
      '#f8f8f2',
      ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'],
      ['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']
    )
  },
  {
    id: 'nord',
    name: 'Nord',
    theme: base16(
      '#2e3440',
      '#d8dee9',
      ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'],
      ['#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']
    )
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    theme: base16(
      '#002b36',
      '#839496',
      ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
      ['#586e75', '#cb4b16', '#93a1a1', '#839496', '#657b83', '#6c71c4', '#93a1a1', '#fdf6e3']
    )
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    theme: base16(
      '#fdf6e3',
      '#657b83',
      ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
      ['#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']
    )
  },
  {
    id: 'kanagawa',
    name: 'Kanagawa Wave',
    theme: base16(
      '#1f1f28',
      '#dcd7ba',
      ['#16161d', '#c34043', '#76946a', '#c0a36e', '#7e9cd8', '#957fb8', '#6a9589', '#c8c093'],
      ['#727169', '#e82424', '#98bb6c', '#e6c384', '#7fb4ca', '#938aa9', '#7aa89f', '#dcd7ba']
    )
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox Dark',
    theme: base16(
      '#282828',
      '#ebdbb2',
      ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984'],
      ['#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']
    )
  },
  {
    id: 'hacker-green',
    name: 'Hacker Green',
    theme: base16(
      '#0b0f0b',
      '#33ff66',
      ['#0b0f0b', '#33ff66', '#33ff66', '#33ff66', '#33ff66', '#33ff66', '#33ff66', '#33ff66'],
      ['#1f7a3a', '#66ff8c', '#66ff8c', '#66ff8c', '#66ff8c', '#66ff8c', '#66ff8c', '#b3ffc6']
    )
  }
]

export function getTheme(id: string): TermTheme {
  return THEMES.find((t) => t.id === id) || THEMES[0]
}

// Color + short label for the OS badge shown on host cards and tabs
const OS: Record<string, [string, string]> = {
  ubuntu: ['#e95420', 'U'],
  debian: ['#a80030', 'D'],
  fedora: ['#294172', 'F'],
  centos: ['#932279', 'C'],
  rhel: ['#cc0000', 'R'],
  rocky: ['#10b981', 'R'],
  almalinux: ['#0f4266', 'A'],
  arch: ['#1793d1', 'A'],
  alpine: ['#0d597f', 'A'],
  opensuse: ['#73ba25', 'S'],
  'opensuse-leap': ['#73ba25', 'S'],
  amzn: ['#ff9900', 'A'],
  raspbian: ['#c51a4a', 'R'],
  freebsd: ['#ab2b28', 'F'],
  darwin: ['#555555', ''],
  nixos: ['#5277c3', 'N']
}

export function osBadge(os?: string, fallback = '#3d4556'): { color: string; letter: string } {
  const hit = os && OS[os]
  return hit ? { color: hit[0], letter: hit[1] } : { color: fallback, letter: '' }
}
