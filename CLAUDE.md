# Sshelby — notes for Claude Code

Local-first SSH client inspired by Termius (+ a few MobaXterm ideas): hosts and nested groups,
terminal tabs, dual-pane SFTP, remote file editor, port forwarding (local / remote / SOCKS5),
SSH keys, identities, SSH agent (KeePassXC), snippets, known hosts, themes, encrypted export/import.
No account, no cloud: everything lives in a local vault. Packaged for macOS, Windows and Linux.

Open source (MIT). Code, comments, docs and commit messages are in English. User and contributor
docs live in README.md and docs/; keep them in sync when behavior changes.

## Open source standards (non-negotiable)

Sshelby is a public MIT project on GitHub (github.com/croos555/sshelby). Every change must meet the
standards expected of a well-run open source repository:

- **History**: small, focused commits with [Conventional Commits](https://www.conventionalcommits.org/)
  messages (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`…) and a body explaining *why*. Never commit
  secrets, personal data, local paths or machine-specific config. Never rewrite published history or
  force-push `main` without the maintainer's explicit approval.
- **Versioning**: [Semantic Versioning](https://semver.org/); `package.json` version, `CHANGELOG.md`
  ([Keep a Changelog](https://keepachangelog.com/), user-visible changes under *Unreleased*) and the
  `vX.Y.Z` tag must agree. Releases are cut by pushing an annotated tag; CI drafts the GitHub release.
- **Quality gates**: `npm run typecheck` and `npm run build` must pass before pushing; the CI workflow
  checks every push and pull request. Keep `npm audit --omit=dev` clean and dependencies MIT-compatible.
- **Docs in sync**: README, `docs/`, CHANGELOG and this file are updated in the same commit as the
  behavior they describe. User-facing text is in English.
- **Community files** stay current: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY (private
  vulnerability reporting), issue and PR templates.
- **Security**: secrets encrypted at rest, no telemetry, renderer isolation kept intact; anything
  touching credentials or the export format is reviewed with extra care and documented in
  `docs/security.md`.



Electron + electron-vite, React 19 + TypeScript, zustand, `ssh2` (SSH, SFTP, agent), xterm.js,
CodeMirror 6 (editor), lucide-react (icons). **No native modules**: keep it that way so every
platform builds from one machine (ssh2's optional `cpu-features` / `sshcrypto` addons are excluded
from the package in `package.json → build.files`, ssh2 falls back to pure JS).

## Commands

```bash
npm run dev          # electron-vite dev (hot reload renderer, restarts the app on main changes)
npm run typecheck    # tsc for node (main/preload/shared) and web (renderer) configs
npm run build        # bundle to out/
npm run dist:mac     # dmg + zip, x64 and arm64 (dist:mac:arm = Apple Silicon only)
npm run dist:win     # NSIS installer (x64+arm64) + portable exe
npm run dist:linux   # AppImage (x64+arm64) + deb
```

There is no test runner. Pure logic lives in `*-core.ts` files without Electron imports so it can be
exercised directly with Node's TypeScript support, e.g. `node --no-warnings some-test.mts` importing
`src/main/stats-core.ts` (use `import type` for type-only imports, no TS parameter properties).

## Layout

```
src/shared/      types.ts (vault model, settings, IPC payloads), creds.ts (credential inheritance)
src/main/        Electron main process
  index.ts       window, single-instance lock, vault/keys IPC, ~/.ssh/config import, lifecycle
  store.ts       vault.json in userData; secrets encrypted with safeStorage; migrations on load
  connect.ts     resolveHost (host → group chain, identities) + connectHost (auth, jump hosts, host keys)
  prompts.ts     main → renderer modal prompts (host key, password, keyboard-interactive)
  sessions.ts    terminal shells, resize, status-bar sampling (exec channel)
  sftp.ts        SFTP sessions (ref-counted), transfers, remote read/write, "open in local app"
  forwards.ts    port forwarding manager (local, remote, dynamic SOCKS5)
  agent*.ts      SSH agent (SSH_AUTH_SOCK / Pageant / Windows pipe), single-key filtering
  transfer.ts    encrypted selective export/import (envelope.ts = AES-256-GCM + scrypt)
  mobaxterm*.ts  MobaXterm .mxtsessions / MobaXterm.ini import
  stats-core.ts  /proc + df parsing for the status bar
  keys.ts        key generation/import, fingerprints
  splash.ts      startup splash window
src/preload/     contextBridge API (`window.api`), typed in index.d.ts
src/renderer/src App.tsx (tabs, sidebar), store.ts (zustand), themes.ts, highlight.ts,
                 views/ (Hosts, Keychain, Forwards, Misc: snippets/known hosts/settings),
                 components/ (editors, terminal, SFTP, tree, modals, ui primitives)
build/           icon.svg (source) → icon.png used by electron-builder; splash reuses the SVG
```

## Data model and rules

- Vault = `~/Library/Application Support/sshelby/vault.json` (Windows `%APPDATA%\sshelby`, Linux `~/.config/sshelby`).
  Collections: groups, hosts, keys, identities, forwards, snippets, knownHosts + settings.
  `store.upsert/remove` handle ids and cascades (deleting a key/identity/group clears references).
  New settings need a default in `DEFAULT_SETTINGS` (loaded vaults are merged with defaults).
- Secrets (`password`, `privateKey`, `passphrase`) are encrypted at rest via `safeStorage`
  (`SECRET_FIELDS` in store.ts). Never log them or send them to the renderer unnecessarily.
- Credentials: a host or subgroup with "Use parent credentials" (`usesParentCredentials`, default
  when it has none of its own) contributes nothing; otherwise its identity replaces its inline fields.
  Resolution walks host → groups in `resolveHost`; username and secret slots fill independently.
- Identities: `password` | `key` | `agent` (agent can be pinned to one key fingerprint).
- Export: keys and identities are **excluded by default** (`includeCredentials` opt-in). Imports
  merge with id remapping and dedupe (never replace a trusted known-host fingerprint).
- Renderer ↔ main only through `window.api` (contextIsolation on, no nodeIntegration). Add a
  channel = handler in main + entry in `src/preload/index.ts`.

## Conventions

- Match the existing style: terse comments explaining *why*, small helpers, no new dependencies
  without a reason (check `npm audit --omit=dev` stays clean).
- UI follows Termius' look (light default, dark supported via CSS variables in styles.css).
- Conventional commits with a descriptive body; update CHANGELOG.md for user-visible changes.

## Gotchas

- `npm run dev` restarts the whole app when a main-process file changes, which closes open SSH
  sessions. Warn before editing `src/main` while someone is testing in dev mode.
- To try the UI without touching real data, run a separate instance:
  `./node_modules/.bin/electron . --user-data-dir=<scratch dir>` with a hand-written vault.json
  (the single-instance lock is per user-data dir).
- Some shells wrap or rewrite `npx` (e.g. token-saving hooks); in scripts prefer calling
  `./node_modules/.bin/<tool>` directly.
- macOS packages can only be built on macOS. Windows/Linux packages also build on macOS without
  Wine (verified).
- Pasting into mongosh can garble the line display: that is a mongosh bracketed-paste bug, it also
  happens in other terminals.

## CI

- GitHub Actions (`.github/workflows/build.yml`): macOS, Windows and Linux packages on
  GitHub-hosted runners for tags `v*` and manual runs; tags create a draft release.
- Windows signing: Certum cloud certificate through ssign (Certum cloud API, no SimplySign Desktop)
  on release tags (`build/sign-win.js`, secrets `CERTUM_USERNAME` / `CERTUM_TOTP_SECRET` in Base32,
  see docs/building.md). Third-party tools that receive secrets are pinned (release + SHA-256 or
  commit SHA) after review. SimplySign Desktop on GitHub's Windows runner does not work: its virtual
  smart card reader never registers. macOS builds are unsigned.
