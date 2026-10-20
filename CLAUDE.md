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
- **Versioning**: [Semantic Versioning](https://semver.org/); the version in `package.json`,
  `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, `CHANGELOG.md`
  ([Keep a Changelog](https://keepachangelog.com/), user-visible changes under *Unreleased*) and the
  `vX.Y.Z` tag must agree. Releases are cut by pushing an annotated tag; CI drafts the GitHub release.
- **Quality gates**: `npm run typecheck`, `npm run web:build` and `cargo test` (in `src-tauri`) must
  pass before pushing; CI checks every push and pull request. Keep `npm audit --omit=dev` clean and
  dependencies (npm and crates) MIT-compatible.
- **Docs in sync**: README, `docs/`, CHANGELOG and this file are updated in the same commit as the
  behavior they describe. User-facing text is in English.
- **Community files** stay current: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY (private
  vulnerability reporting), issue and PR templates.
- **Security**: secrets encrypted at rest, no telemetry, the UI only reaches the system through the
  backend commands and the capabilities in `src-tauri/capabilities`; anything
  touching credentials or the export format is reviewed with extra care and documented in
  `docs/security.md`.



**Tauri 2** (Rust backend) + React 19 / TypeScript UI built with Vite, zustand, xterm.js,
CodeMirror 6 (editor), lucide-react (icons). Rust side: `russh` (SSH, agent), `russh-sftp`,
`keyring` (OS keychain), `aes-gcm` + `scrypt` (export files), tokio. The UI uses the system webview
(WKWebView, WebView2, WebKitGTK), so packages are a few MB.

## Commands

```bash
npm run dev          # tauri dev: Vite dev server + debug build of the Rust backend
npm run typecheck    # tsc for the UI (src/renderer, src/shared)
npm run web:build    # UI only, to out/web
npm run build        # tauri build: release binary + packages for the current OS
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit tests (stats, MobaXterm, export, UTF-8)
```

Rust needs a stable toolchain (rustup). On Linux, Tauri also needs the WebKitGTK development
packages (see docs/development.md).

## Layout

```
src/shared/       types.ts (vault model, settings, payloads), creds.ts (credential inheritance)
src/renderer/src  React UI: App.tsx, store.ts (zustand), themes.ts, highlight.ts, views/, components/
  api.ts          the `window.api` contract used by the UI
  tauri-api.ts    implementation of `window.api` over Tauri commands and events
src-tauri/src     Rust backend
  lib.rs          app setup, command registration, shutdown
  store.rs        vault.json in the app data dir; one-time import of the former Electron vault
  secrets.rs      AES-256-GCM for secrets with a key in the OS keychain; Electron os_crypt migration
  ssh.rs          resolve_host (host → group chain, identities), connect_host (auth, jump hosts, host keys)
  prompts.rs      backend → UI modal prompts (host key, password, keyboard-interactive)
  sessions.rs     terminal shells, resize, status-bar sampling (exec channel)
  stats.rs        /proc + df parsing for the status bar
  sftp.rs         SFTP sessions (ref-counted), transfers, remote read/write, "open in local app", local pane
  forwards.rs     port forwarding (local, remote, dynamic SOCKS5)
  agent.rs        SSH agent (SSH_AUTH_SOCK / Pageant / Windows pipe)
  keys.rs         key generation/inspection, install on host
  transfer.rs     encrypted selective export/import (same file format as before)
  importers.rs    ~/.ssh/config and MobaXterm import
src-tauri/tauri.conf.json   window, CSP, bundle targets; capabilities/ = allowed plugin APIs
build/            icon.svg (source) → icon.png; src-tauri/icons generated with `npx tauri icon`
```

## Data model and rules

- Vault = `vault.json` in the Tauri app data dir (identifier `dev.sshelby.app`: macOS
  `~/Library/Application Support/dev.sshelby.app`, Windows `%APPDATA%\dev.sshelby.app`, Linux
  `~/.local/share/dev.sshelby.app`). On first start the vault of the former Electron build
  (`<config dir>/sshelby/vault.json`) is imported, the original is left untouched.
  Collections: groups, hosts, keys, identities, forwards, snippets, knownHosts + settings. Items are
  JSON objects (`serde_json::Value`): `src/shared/types.ts` stays the single source of truth.
  `Store::upsert/remove` handle ids and cascades. New settings need a default in both
  `DEFAULT_SETTINGS` (types.ts) and `default_settings()` (store.rs).
- Secrets (`password`, `privateKey`, `passphrase`; `secret_fields` in store.rs) are encrypted at rest
  (`enc:v2:` = AES-256-GCM, key in the OS keychain). Never log them or send them to the UI unnecessarily.
- Credentials: a host or subgroup with "Use parent credentials" (`usesParentCredentials`, default
  when it has none of its own) contributes nothing; otherwise its identity replaces its inline fields.
  Resolution walks host → groups in `resolve_host`; username and secret slots fill independently.
- Identities: `password` | `key` | `agent` (agent can be pinned to one key fingerprint).
- Export: keys and identities are **excluded by default** (`includeCredentials` opt-in). Imports
  merge with id remapping and dedupe (never replace a trusted known-host fingerprint).
- UI ↔ backend only through `window.api`. Add a call = `#[tauri::command]` in src-tauri, register it
  in `lib.rs`, add it to `api.ts` (type) and `tauri-api.ts` (invoke). Events: `util::emit("area:name")`.
- Commands that are not `async` run on the main thread: spawn with `tauri::async_runtime::spawn`,
  never `tokio::spawn` (no runtime there, it panics).

## Conventions

- Match the existing style: terse comments explaining *why*, small helpers, no new dependencies
  without a reason (check `npm audit --omit=dev` stays clean).
- UI follows Termius' look (light default, dark supported via CSS variables in styles.css).
- Conventional commits with a descriptive body; update CHANGELOG.md for user-visible changes.

## Gotchas

- `npm run dev` rebuilds and restarts the app when Rust code changes, which closes open SSH sessions.
- Auth steps are traced on stderr (`[auth user@host:port] …`, never secrets): run the binary from a
  terminal to see why a key or the agent was refused.
- Files dropped from the OS onto the SFTP pane carry no path in the webview: not supported yet
  (window `dragDropEnabled` is off so in-app drag & drop works).
- Startup: `main` window starts hidden, `splash` (src/renderer/splash.html, transparent → needs
  `macOSPrivateApi`) shows until the UI calls `app_ready` (min 900 ms, 8 s fallback).
- Not ported yet from the Electron build: agent forwarding, "keep running in background",
  single-instance lock, Electron secrets migration on Windows (DPAPI).
- Some shells wrap or rewrite `npx` (e.g. token-saving hooks); in scripts prefer calling
  `./node_modules/.bin/<tool>` directly.
- Pasting into mongosh can garble the line display: that is a mongosh bracketed-paste bug, it also
  happens in other terminals.

## CI

- `.github/workflows/ci.yml` (main, pull requests): typecheck, UI build, `npm audit --omit=dev`.
- `.github/workflows/build.yml` (tags `v*`, manual): macOS arm64 + x64 dmg (signed + notarized on
  tags and manual runs), Linux amd64 + arm64 AppImage/deb/rpm (Ubuntu 22.04 for glibc compatibility; also runs the
  typecheck and `cargo test`), Windows x64 + arm64 NSIS installer + portable exe; tags draft a release
  (pre-release for `-rc`).
- Windows signing: ssign (Certum cloud API, pinned Windows release + SHA-256) through
  `bundle.windows.signCommand` → `build/sign-win.sh`, passed with `--config` in CI only, so the app
  exe is signed before NSIS packs it. Secrets `CERTUM_USERNAME` / `CERTUM_TOTP_SECRET` (Base32).
  SimplySign Desktop on GitHub's Windows runner does not work (its virtual card reader never registers).
- macOS signing: Developer ID certificate imported into a dedicated keychain (tool-created temporary
  keychains fail to unlock on hosted runners), identity passed as `APPLE_SIGNING_IDENTITY`;
  notarization with the App Store Connect API key (`APPLE_API_KEY`, `APPLE_API_ISSUER`,
  `APPLE_API_KEY_PATH`). Secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`,
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. The verify step requires spctl "source=Notarized Developer ID"
  and a stapled ticket.
- Third-party tools that receive secrets are pinned (release + SHA-256 or commit SHA) after review.
