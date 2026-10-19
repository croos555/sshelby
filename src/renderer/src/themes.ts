import type { ITheme } from '@xterm/xterm'

export interface TermTheme {
  id: string
  name: string
  dark: boolean
  theme: ITheme
}

type Ansi8 = [string, string, string, string, string, string, string, string]

// normal / bright: black, red, green, yellow, blue, magenta, cyan, white
function t(
  id: string,
  name: string,
  bg: string,
  fg: string,
  normal: Ansi8,
  bright: Ansi8 = normal,
  extra: Partial<ITheme> = {}
): TermTheme {
  return {
    id,
    name,
    dark: luminance(bg) < 0.4,
    theme: {
      background: bg,
      foreground: fg,
      cursor: fg,
      cursorAccent: bg,
      selectionBackground: fg + '40',
      black: normal[0],
      red: normal[1],
      green: normal[2],
      yellow: normal[3],
      blue: normal[4],
      magenta: normal[5],
      cyan: normal[6],
      white: normal[7],
      brightBlack: bright[0],
      brightRed: bright[1],
      brightGreen: bright[2],
      brightYellow: bright[3],
      brightBlue: bright[4],
      brightMagenta: bright[5],
      brightCyan: bright[6],
      brightWhite: bright[7],
      ...extra
    }
  }
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export const THEMES: TermTheme[] = [
  t(
    'sshelby-dark',
    'Sshelby Dark',
    '#141729',
    '#21d07a',
    ['#2b2f42', '#ff5c7a', '#21d07a', '#f5c451', '#4ea6ff', '#c678dd', '#3fd0d4', '#d6dbe5'],
    ['#5b6178', '#ff7d95', '#4ee69a', '#ffd879', '#76bbff', '#d79cf0', '#69e3e6', '#ffffff']
  ),
  t(
    'sshelby-light',
    'Sshelby Light',
    '#f7f9fb',
    '#2b3140',
    ['#2b3140', '#d6334a', '#1c9a5a', '#b7861b', '#1f72d1', '#9c46c4', '#168d93', '#c9ced8'],
    ['#6b7385', '#e5566a', '#25b56d', '#cf9d2e', '#3e8ae6', '#b467d6', '#20a6ad', '#ffffff'],
    { cursor: '#1f72d1' }
  ),
  t(
    'flexoki-dark',
    'Flexoki Dark',
    '#100f0f',
    '#cecdc3',
    ['#100f0f', '#d14d41', '#879a39', '#d0a215', '#4385be', '#ce5d97', '#3aa99f', '#878580'],
    ['#575653', '#af3029', '#66800b', '#ad8301', '#205ea6', '#a02f6f', '#24837b', '#cecdc3']
  ),
  t(
    'flexoki-light',
    'Flexoki Light',
    '#fffcf0',
    '#100f0f',
    ['#100f0f', '#af3029', '#66800b', '#ad8301', '#205ea6', '#a02f6f', '#24837b', '#6f6e69'],
    ['#b7b5ac', '#d14d41', '#879a39', '#d0a215', '#4385be', '#ce5d97', '#3aa99f', '#cecdc3']
  ),
  t(
    'kanagawa-wave',
    'Kanagawa Wave',
    '#1f1f28',
    '#dcd7ba',
    ['#090618', '#c34043', '#76946a', '#c0a36e', '#7e9cd8', '#957fb8', '#6a9589', '#c8c093'],
    ['#727169', '#e82424', '#98bb6c', '#e6c384', '#7fb4ca', '#938aa9', '#7aa89f', '#dcd7ba'],
    { selectionBackground: '#2d4f67', cursor: '#c8c093' }
  ),
  t(
    'kanagawa-dragon',
    'Kanagawa Dragon',
    '#181616',
    '#c5c9c5',
    ['#0d0c0c', '#c4746e', '#8a9a7b', '#c4b28a', '#8ba4b0', '#a292a3', '#8ea4a2', '#c8c093'],
    ['#a6a69c', '#e46876', '#87a987', '#e6c384', '#7fb4ca', '#938aa9', '#7aa89f', '#c5c9c5'],
    { selectionBackground: '#2d4f67' }
  ),
  t(
    'kanagawa-lotus',
    'Kanagawa Lotus',
    '#f2ecbc',
    '#545464',
    ['#1f1f28', '#c84053', '#6f894e', '#77713f', '#4d699b', '#b35b79', '#597b75', '#545464'],
    ['#8a8980', '#d7474b', '#6e915f', '#836f4a', '#6693bf', '#624c83', '#5e857a', '#43436c'],
    { selectionBackground: '#c9cbd1' }
  ),
  t(
    'hacker-blue',
    'Hacker Blue',
    '#060b14',
    '#3ea8ff',
    ['#060b14', '#3ea8ff', '#3ea8ff', '#3ea8ff', '#3ea8ff', '#3ea8ff', '#3ea8ff', '#3ea8ff'],
    ['#1b4f7a', '#7cc4ff', '#7cc4ff', '#7cc4ff', '#7cc4ff', '#7cc4ff', '#7cc4ff', '#c6e5ff']
  ),
  t(
    'hacker-green',
    'Hacker Green',
    '#0b0f0b',
    '#33ff66',
    ['#0b0f0b', '#33ff66', '#33ff66', '#33ff66', '#33ff66', '#33ff66', '#33ff66', '#33ff66'],
    ['#1f7a3a', '#66ff8c', '#66ff8c', '#66ff8c', '#66ff8c', '#66ff8c', '#66ff8c', '#b3ffc6']
  ),
  t(
    'hacker-red',
    'Hacker Red',
    '#120606',
    '#ff3b3b',
    ['#120606', '#ff3b3b', '#ff3b3b', '#ff3b3b', '#ff3b3b', '#ff3b3b', '#ff3b3b', '#ff3b3b'],
    ['#7a1f1f', '#ff7a7a', '#ff7a7a', '#ff7a7a', '#ff7a7a', '#ff7a7a', '#ff7a7a', '#ffc2c2']
  ),
  t(
    'everforest-dark',
    'Everforest Dark',
    '#2d353b',
    '#d3c6aa',
    ['#475258', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa'],
    ['#859289', '#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#d3c6aa'],
    { selectionBackground: '#543a48' }
  ),
  t(
    'everforest-light',
    'Everforest Light',
    '#fdf6e3',
    '#5c6a72',
    ['#5c6a72', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#dfddc8'],
    ['#829181', '#f85552', '#8da101', '#dfa000', '#3a94c5', '#df69ba', '#35a77c', '#fdf6e3'],
    { selectionBackground: '#eaedc8' }
  ),
  t(
    'night-owl',
    'Night Owl',
    '#011627',
    '#d6deeb',
    ['#011627', '#ef5350', '#22da6e', '#addb67', '#82aaff', '#c792ea', '#21c7a8', '#ffffff'],
    ['#575656', '#ef5350', '#22da6e', '#ffeb95', '#82aaff', '#c792ea', '#7fdbca', '#ffffff'],
    { selectionBackground: '#1d3b53', cursor: '#80a4c2' }
  ),
  t(
    'light-owl',
    'Light Owl',
    '#fbfbfb',
    '#403f53',
    ['#403f53', '#de3d3b', '#08916a', '#e0af02', '#288ed7', '#d6438a', '#2aa298', '#f0f0f0'],
    ['#989fb1', '#de3d3b', '#08916a', '#daaa01', '#288ed7', '#d6438a', '#2aa298', '#f0f0f0'],
    { selectionBackground: '#e0e0e0', cursor: '#90a7b2' }
  ),
  t(
    'rose-pine',
    'Rosé Pine',
    '#191724',
    '#e0def4',
    ['#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4'],
    ['#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4'],
    { selectionBackground: '#403d52', cursor: '#524f67' }
  ),
  t(
    'rose-pine-moon',
    'Rosé Pine Moon',
    '#232136',
    '#e0def4',
    ['#393552', '#eb6f92', '#3e8fb0', '#f6c177', '#9ccfd8', '#c4a7e7', '#ea9a97', '#e0def4'],
    ['#6e6a86', '#eb6f92', '#3e8fb0', '#f6c177', '#9ccfd8', '#c4a7e7', '#ea9a97', '#e0def4'],
    { selectionBackground: '#44415a', cursor: '#56526e' }
  ),
  t(
    'rose-pine-dawn',
    'Rosé Pine Dawn',
    '#faf4ed',
    '#575279',
    ['#f2e9e1', '#b4637a', '#286983', '#ea9d34', '#56949f', '#907aa9', '#d7827e', '#575279'],
    ['#9893a5', '#b4637a', '#286983', '#ea9d34', '#56949f', '#907aa9', '#d7827e', '#575279'],
    { selectionBackground: '#dfdad9', cursor: '#cecacd' }
  ),
  t(
    'catppuccin-mocha',
    'Catppuccin Mocha',
    '#1e1e2e',
    '#cdd6f4',
    ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de'],
    ['#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8'],
    { cursor: '#f5e0dc', selectionBackground: '#585b70' }
  ),
  t(
    'catppuccin-latte',
    'Catppuccin Latte',
    '#eff1f5',
    '#4c4f69',
    ['#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be'],
    ['#6c6f85', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#bcc0cc'],
    { cursor: '#dc8a78', selectionBackground: '#acb0be' }
  ),
  t(
    'tokyo-night',
    'Tokyo Night',
    '#1a1b26',
    '#c0caf5',
    ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6'],
    ['#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'],
    { selectionBackground: '#33467c' }
  ),
  t(
    'github-dark',
    'GitHub Dark',
    '#0d1117',
    '#e6edf3',
    ['#484f58', '#ff7b72', '#3fb950', '#d29922', '#58a6ff', '#bc8cff', '#39c5cf', '#b1bac4'],
    ['#6e7681', '#ffa198', '#56d364', '#e3b341', '#79c0ff', '#d2a8ff', '#56d4dd', '#ffffff'],
    { selectionBackground: '#264f78' }
  ),
  t(
    'github-light',
    'GitHub Light',
    '#ffffff',
    '#1f2328',
    ['#24292f', '#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df', '#1b7c83', '#6e7781'],
    ['#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f'],
    { selectionBackground: '#b6e3ff' }
  ),
  t(
    'one-dark',
    'One Dark',
    '#21252b',
    '#abb2bf',
    ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf'],
    ['#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']
  ),
  t(
    'dracula',
    'Dracula',
    '#282a36',
    '#f8f8f2',
    ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'],
    ['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
    { selectionBackground: '#44475a' }
  ),
  t(
    'nord',
    'Nord',
    '#2e3440',
    '#d8dee9',
    ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'],
    ['#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'],
    { selectionBackground: '#434c5e' }
  ),
  t(
    'gruvbox-dark',
    'Gruvbox Dark',
    '#282828',
    '#ebdbb2',
    ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984'],
    ['#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']
  ),
  t(
    'gruvbox-light',
    'Gruvbox Light',
    '#fbf1c7',
    '#3c3836',
    ['#fbf1c7', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#7c6f64'],
    ['#928374', '#9d0006', '#79740e', '#b57614', '#076678', '#8f3f71', '#427b58', '#3c3836']
  ),
  t(
    'solarized-dark',
    'Solarized Dark',
    '#002b36',
    '#839496',
    ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
    ['#586e75', '#cb4b16', '#93a1a1', '#839496', '#657b83', '#6c71c4', '#93a1a1', '#fdf6e3']
  ),
  t(
    'solarized-light',
    'Solarized Light',
    '#fdf6e3',
    '#657b83',
    ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'],
    ['#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']
  ),
  t(
    'monokai',
    'Monokai',
    '#272822',
    '#f8f8f2',
    ['#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2'],
    ['#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5'],
    { selectionBackground: '#49483e' }
  )
]

export function getTheme(id?: string | null): TermTheme {
  return THEMES.find((x) => x.id === id) || THEMES[0]
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
