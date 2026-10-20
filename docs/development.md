# Development

## Setup

Requirements:

- Node.js 22.12+ (Vite 8)
- Rust stable ([rustup](https://rustup.rs/))
- Linux only: the WebKitGTK development packages, e.g. on Debian/Ubuntu
  `sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev`
  (see [Tauri's prerequisites](https://tauri.app/start/prerequisites/))

```bash
npm install
npm run dev        # Vite dev server + debug build of the backend; Rust changes rebuild and restart the app
npm run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

## Architecture

Sshelby is a [Tauri 2](https://tauri.app/) app: a Rust backend and a React UI rendered by the
system webview.

| Layer | Folder | Role |
|---|---|---|
| Backend | `src-tauri/src/` | SSH/SFTP (`russh`, `russh-sftp`), port forwarding, vault storage, OS keychain |
| UI | `src/renderer/src/` | React 19, zustand store, xterm.js, CodeMirror |
| Shared | `src/shared/` | TypeScript types of the vault and of the backend payloads |

Backend modules:

| File | Responsibility |
|---|---|
| `lib.rs` | app setup, command registration, shutdown |
| `store.rs` | `vault.json`, cascades on delete, one-time import of the former Electron vault |
| `secrets.rs` | encryption of secrets (AES-256-GCM, key in the OS keychain) |
| `ssh.rs` | credential resolution (host → groups, identities) and `connect_host` (auth, jump hosts, host keys) |
| `prompts.rs` | modal prompts raised by the backend (host key, password, keyboard-interactive) |
| `sessions.rs`, `stats.rs` | terminal shells, resize, status-bar sampling and parsing |
| `sftp.rs` | SFTP sessions (ref-counted), transfers, remote file read/write, "open in local app", local pane |
| `forwards.rs` | local / remote / SOCKS5 forwarding |
| `agent.rs` | SSH agent selection (SSH_AUTH_SOCK, Pageant, Windows OpenSSH pipe) |
| `keys.rs` | key generation, inspection, install on a host |
| `transfer.rs` | encrypted selective export/import |
| `importers.rs` | `~/.ssh/config` and MobaXterm import |

### Adding a backend call

1. Write a `#[tauri::command]` function in the relevant module (parameters in snake_case; the UI
   passes them in camelCase) and register it in `lib.rs` (`generate_handler!`).
2. Declare it in `src/renderer/src/api.ts` and implement it in `tauri-api.ts` with `invoke`.
3. Call `window.api.area.action(…)` from the UI.

Backend → UI notifications use `util::emit("area:name", payload)` and `listen` in `tauri-api.ts`.
Commands that are not `async` run on the main thread: start background work with
`tauri::async_runtime::spawn`, not `tokio::spawn`.

### Data model

Types live in `src/shared/types.ts`; the backend keeps vault items as JSON objects. When adding a
setting, give it a default in `DEFAULT_SETTINGS` (types.ts) and `default_settings()` (store.rs).
When adding a secret field, list it in `secret_fields` (store.rs) so it is encrypted at rest.

## Testing

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Unit tests sit next to the code they cover (`#[cfg(test)]` modules): status bar parsing, MobaXterm
parsing, export encryption, UTF-8 stream decoding.

Authentication is traced on stderr (`[auth user@host:port] …`, never secrets). To see it, start the
built binary from a terminal, e.g. on macOS
`src-tauri/target/release/bundle/macos/Sshelby.app/Contents/MacOS/sshelby`.

## Style

- TypeScript strict mode, Prettier-like formatting (2 spaces, single quotes, no semicolons, 120 cols).
- Rust: `cargo fmt` style, errors as `anyhow` inside the backend and plain messages at the IPC boundary.
- Comments explain *why*, not what.
- Keep `npm audit --omit=dev` clean; prefer pure-Rust crates (no OpenSSL) so cross-platform builds stay simple.
