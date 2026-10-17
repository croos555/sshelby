import { app, BrowserWindow } from 'electron'
import iconSvg from '../../build/icon.svg?raw'

// Frameless startup window shown while the main window loads
const MIN_VISIBLE_MS = 900

// The app icon without its rounded-square background, cropped to the shell
function mark(): string {
  const svg = iconSvg
    .replace(/<rect x="100" y="100"[^>]*\/>/g, '')
    .replace('viewBox="0 0 1024 1024"', 'viewBox="250 200 524 600"')
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function html(): string {
  const img = mark()
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex; align-items: center; justify-content: center;
    -webkit-user-select: none; cursor: default;
  }
  .card {
    width: 340px; height: 360px; box-sizing: border-box;
    border-radius: 22px;
    background: linear-gradient(180deg, #1d3c63 0%, #0d1b2e 100%);
    border: 1px solid rgba(255,255,255,0.08);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #e7e9ee;
    animation: in .35s ease-out both;
  }
  img { width: 130px; height: 149px; margin-bottom: 14px; filter: drop-shadow(0 10px 18px rgba(0,0,0,.35)); }
  h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: .3px; }
  p { margin: 6px 0 22px; font-size: 12px; color: #9fb2c8; }
  .bar { width: 160px; height: 3px; border-radius: 2px; background: rgba(255,255,255,.12); overflow: hidden; }
  .bar span { display: block; width: 40%; height: 100%; border-radius: 2px; background: #21d07a; animation: slide 1.1s ease-in-out infinite; }
  .ver { position: absolute; bottom: 28px; font-size: 10px; color: #6c809a; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
  @keyframes in { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
</style>
</head>
<body>
  <div class="card">
    <img src="${img}" alt="">
    <h1>Sshelby</h1>
    <p>SSH · SFTP · Port forwarding</p>
    <div class="bar"><span></span></div>
  </div>
  <div class="ver">v${app.getVersion()}</div>
</body>
</html>`
}

export function showSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 380,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    show: false,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  splash.once('ready-to-show', () => splash.show())
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html()))
  return splash
}

// Swap the splash for the main window once it is ready, keeping the splash up long enough not to flash
export function handOff(splash: BrowserWindow, win: BrowserWindow) {
  const shownAt = Date.now()
  win.once('ready-to-show', () => {
    setTimeout(
      () => {
        win.show()
        if (!splash.isDestroyed()) splash.destroy()
      },
      Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt))
    )
  })
}
