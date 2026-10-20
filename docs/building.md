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

### Packages (`.github/workflows/build.yml`)

Runs on version tags (`v*`) and manually (*Actions → Build → Run workflow*), on GitHub-hosted
runners (free for public repositories):

| Job | Runner | Packages |
|---|---|---|
| macOS | `macos-latest` (arm64 + x64 targets) | `Sshelby_<version>_aarch64.dmg`, `Sshelby_<version>_x64.dmg` |
| Linux | `ubuntu-22.04` / `ubuntu-22.04-arm` | `.AppImage`, `.deb`, `.rpm` for amd64 and arm64 |
| Windows | `windows-latest` (x64 + arm64 targets) | `Sshelby_<version>_<arch>-setup.exe` (NSIS) and `Sshelby_<version>_<arch>-portable.exe` |

Linux packages are built on Ubuntu 22.04 so they also run on distributions with an older glibc. The
Linux x64 job also runs the typecheck and `cargo test`. Packages are uploaded as workflow artifacts;
on a tag, a **draft release** is created with all of them attached (pre-release for `-rc` tags).

## Code signing

### Windows (Certum Code Signing in the Cloud)

Windows executables are signed with a Certum open source code signing certificate kept in Certum's
cloud (SimplySign):

1. [ssign](https://github.com/Le-Syl21/ssign) (pinned Windows release, SHA-256 verified) is
   installed in the job. It talks to Certum's cloud API over HTTPS and computes the one-time password
   from the account's TOTP seed: no SimplySign Desktop, no virtual smart card.
2. `tauri build` gets a `bundle.windows.signCommand` pointing to
   [`build/sign-win.sh`](../build/sign-win.sh), which runs ssign (with retries). Tauri calls it for the
   app executable **before** NSIS packs it, then for the installer, so both the installer and the
   installed app are signed (SHA-256, Certum chain, RFC 3161 timestamp from `http://time.certum.pl`).
   The app executable is also published, signed separately, as the portable version.
3. PowerShell's `Get-AuthenticodeSignature` checks every executable (valid chain and timestamp)
   before the artifacts are uploaded.

Repository secrets (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|---|---|
| `CERTUM_USERNAME` | e-mail of the SimplySign account |
| `CERTUM_TOTP_SECRET` | TOTP seed in **Base32** (the `secret=` of the SimplySign activation QR code; if Certum shows it in hexadecimal, convert it to Base32) |

Without these secrets (forks) the executables are left unsigned. The TOTP seed allows signing in the
maintainer's name until the SimplySign QR code is re-issued: consider moving the secrets to a
protected GitHub environment with required reviewers.

To sign by hand on a workstation, install ssign and use a one-shot code from the SimplySign mobile
app: `ssign -e you@example.com -T 123456 Sshelby.exe`.

### macOS (Developer ID + notarization)

On `v*` tags and manual runs, the macOS jobs import the **Developer ID Application** certificate into a dedicated
keychain created for the job (temporary keychains created by build tools fail to unlock on hosted
runners) and pass its identity to `tauri build` (`APPLE_SIGNING_IDENTITY`). Tauri signs the app with
the hardened runtime and has Apple notarize it with an App Store Connect API key (`APPLE_API_KEY`,
`APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`), then staples the ticket. The job checks
`codesign --verify`, `spctl --assess` (must report *Notarized Developer ID*) and `stapler validate`.

Repository secrets:

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | the Developer ID Application certificate and its private key, exported from Keychain Access as `.p12`, **base64-encoded** |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_API_KEY_BASE64` | the App Store Connect API key (`AuthKey_XXXXXXXXXX.p8`, *Developer* access), base64-encoded |
| `APPLE_API_KEY_ID` | the key ID |
| `APPLE_API_ISSUER` | the issuer ID shown above the keys list |

```bash
base64 -i developer-id.p12 | gh secret set MAC_CSC_LINK --repo croos555/sshelby
base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set APPLE_API_KEY_BASE64 --repo croos555/sshelby
```

The `.p12` and `.p8` are written to the runner's temp folder only for the build and deleted
afterwards, along with the keychain. Without the secrets (forks) macOS builds stay unsigned. The first notarization of an Apple account can take up to an hour.

Never store certificates or passwords in the repository.

## Releasing

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, and
   update `CHANGELOG.md`.
2. Commit, then tag: `git tag -a vX.Y.Z -m "Sshelby X.Y.Z" && git push --tags`.
3. The Build workflow builds every package and creates a draft release: review it and publish.
