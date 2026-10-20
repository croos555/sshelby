# Building & releasing

## Local builds

```bash
npm run build      # tauri build: release binary + packages for the current OS
```

Packages are written to `src-tauri/target/release/bundle/`:

| OS | Packages |
|---|---|
| macOS | `.app`, `.dmg` |
| Windows | NSIS installer; `src-tauri/target/release/sshelby.exe` is the portable executable |
| Linux | AppImage, `.deb`, `.rpm` |

Each OS builds its own packages. A single portable executable is enough on Windows: it uses the
WebView2 runtime that ships with Windows 10 and 11.

## Continuous integration

### Checks (`.github/workflows/ci.yml`)

Every push to `main` and every pull request runs `npm ci`, the typecheck, the UI build and
`npm audit --omit=dev`. Dependabot (`.github/dependabot.yml`) opens weekly dependency updates.

### Tauri build (`.github/workflows/tauri.yml`)

Runs on pushes to the `tauri` branch and manually. A Windows runner runs `cargo test` and builds the
portable executable (`Sshelby-<version>-portable.exe`); a Linux job signs it (see below). The
executable is uploaded as a workflow artifact. macOS and Linux packages are not built by CI yet.

## Code signing

### Windows (Certum Code Signing in the Cloud)

Windows executables are signed with a Certum open source code signing certificate kept in Certum's
cloud (SimplySign), from a Linux job:

1. [ssign](https://github.com/Le-Syl21/ssign) (pinned release, SHA-256 verified) is installed in the
   job. It talks to Certum's cloud API over HTTPS and computes the one-time password from the
   account's TOTP seed: no SimplySign Desktop, no virtual smart card.
2. ssign signs the executable in place with SHA-256, embeds the Certum chain and adds an RFC 3161
   timestamp from `http://time.certum.pl` (retried if the cloud API is slow).
3. `osslsigncode verify` checks the signature (chain and timestamp) before the artifact is uploaded.

Repository secrets (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|---|---|
| `CERTUM_USERNAME` | e-mail of the SimplySign account |
| `CERTUM_TOTP_SECRET` | TOTP seed in **Base32** (the `secret=` of the SimplySign activation QR code; if Certum shows it in hexadecimal, convert it to Base32) |

Without these secrets (forks) the signing job skips signing. The TOTP seed allows signing in the
maintainer's name until the SimplySign QR code is re-issued: consider moving the secrets to a
protected GitHub environment with required reviewers.

To sign by hand on a workstation, install ssign and use a one-shot code from the SimplySign mobile
app: `ssign -e you@example.com -T 123456 Sshelby.exe`.

### macOS

Not wired into the Tauri workflow yet. Tauri signs and notarizes with the same Developer ID
certificate and App Store Connect API key as the Electron releases (`APPLE_SIGNING_IDENTITY`,
`APPLE_CERTIFICATE`, `APPLE_API_KEY`… environment variables of `tauri build`); the repository
secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID` and
`APPLE_API_ISSUER` already hold them.

Never store certificates or passwords in the repository.

## Releasing

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, and
   update `CHANGELOG.md`.
2. Commit, then tag: `git tag -a vX.Y.Z -m "Sshelby X.Y.Z" && git push --tags`.
