# Sshelby

Local-first SSH client inspired by Termius: hosts and nested groups, terminal tabs, dual-pane SFTP, port forwarding (local, remote, SOCKS5), SSH key management, snippets and known hosts. No account, no cloud: everything is stored on your machine, with passwords and private keys encrypted through the OS keychain (Electron `safeStorage`).

Built with Electron, React, TypeScript, [ssh2](https://github.com/mscdex/ssh2) and [xterm.js](https://xtermjs.org/).

## Development

```bash
npm install
npm run dev        # run with hot reload
npm run typecheck
```

## Packaging

```bash
npm run dist:mac     # .dmg + .zip (x64, arm64)
npm run dist:win     # NSIS installer + portable .exe
npm run dist:linux   # AppImage + .deb
```

Output goes to `dist/`. Builds are unsigned by default. The GitLab pipeline builds Linux and Windows packages on tags; the macOS job needs a GitLab-hosted macOS runner (Premium) or can be run locally.

## Data

The vault lives in the app data folder (`~/Library/Application Support/sshelby` on macOS, `%APPDATA%\sshelby` on Windows, `~/.config/sshelby` on Linux). Settings → Data lets you export or import it as JSON (plain text, keep it safe) and import hosts from `~/.ssh/config`.
