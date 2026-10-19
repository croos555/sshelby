# Development

## Setup

```bash
npm install
npm run dev        # electron-vite: hot reload for the UI, restarts the app when main-process code changes
npm run typecheck
```

Node.js 22.12+ is required (electron-vite / Vite 8).

## Architecture

Sshelby is an Electron app built with electron-vite:

| Layer | Folder | Role |
|---|---|---|
| Main process | `src/main/` | SSH/SFTP connections (`ssh2`), port forwarding, vault storage, dialogs |
| Preload | `src/preload/` | the `window.api` bridge (contextIsolation, no Node in the UI) |
| Renderer | `src/renderer/src/` | React 19 UI, zustand store, xterm.js, CodeMirror |
| Shared | `src/shared/` | types and pure helpers used by both sides |

Main-process modules:

| File | Responsibility |
|---|---|
| `index.ts` | window, splash, single-instance lock, vault/keys IPC, `~/.ssh/config` import, lifecycle |
| `store.ts` | `vault.json`, secrets encryption (`safeStorage`), cascades on delete |
| `connect.ts` | credential resolution (host → groups, identities) and `connectHost` (auth, jump hosts, host keys) |
| `prompts.ts` | modal prompts raised by the main process (host key, password, keyboard-interactive) |
| `sessions.ts` | terminal shells, resize, status-bar sampling |
| `sftp.ts` | SFTP sessions (ref-counted), transfers, remote file read/write, "open in local app" |
| `forwards.ts` | local / remote / SOCKS5 forwarding |
| `agent.ts`, `agent-core.ts` | SSH agent selection and single-key filtering |
| `transfer.ts`, `envelope.ts` | encrypted selective export/import |
| `mobaxterm.ts`, `mobaxterm-core.ts` | MobaXterm import |
| `stats-core.ts` | parsing of `/proc` and `df` output for the status bar |
| `keys.ts` | key generation/import and fingerprints |

### Adding an IPC call

1. Register `ipcMain.handle('area:action', …)` (or `ipcMain.on` for fire-and-forget) in the main module.
2. Expose it in `src/preload/index.ts` under the matching namespace; the type of `window.api` is
   inferred from that file.
3. Call `window.api.area.action(…)` from the renderer.

### Data model

Types live in `src/shared/types.ts`. When adding a setting, give it a default in `DEFAULT_SETTINGS`:
existing vaults are merged with the defaults on load. When adding a secret field, list it in
`SECRET_FIELDS` (`store.ts`) so it is encrypted at rest.

## Testing

There is no test framework yet. Pure logic is kept in `*-core.ts` files (no Electron import) so it
can be exercised directly with Node's built-in TypeScript support:

```bash
cat > /tmp/try.mts <<'TS'
import { parseStats } from './src/main/stats-core.ts'
console.log(parseStats('…sample output…'))
TS
node --no-warnings /tmp/try.mts
```

(Node strips types but doesn't transpile: use `import type` for type-only imports and avoid
TypeScript parameter properties in those files.)

To try the UI without touching your own data, start a separate instance with its own data folder:

```bash
npm run build
./node_modules/.bin/electron . --user-data-dir=/tmp/sshelby-test
```

## Style

- TypeScript strict mode, Prettier-like formatting (2 spaces, single quotes, no semicolons, 120 cols).
- Comments explain *why*, not what.
- No native Node modules: every platform must build from a single machine.
- Keep `npm audit --omit=dev` clean.
