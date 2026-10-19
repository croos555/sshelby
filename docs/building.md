# Building & releasing

## Local builds

```bash
npm run dist:mac       # dmg + zip, x64 and arm64   (dist:mac:arm = Apple Silicon only)
npm run dist:win       # NSIS installer (x64 + arm64) + portable exe (x64)
npm run dist:linux     # AppImage (x64 + arm64) + deb (x64) + rpm (x64, needs rpmbuild)
```

Output goes to `dist/`. macOS packages can only be built on macOS; Windows and Linux packages can be
built on macOS too (no Wine needed), or on Linux with Wine for the Windows part.

The packaged app contains only `out/` and the production dependencies; ssh2's optional native
add-ons are excluded so the app is pure JavaScript on every platform.

## Continuous integration

### Checks (`.github/workflows/ci.yml`)

Every push to `main` and every pull request runs `npm ci`, the typecheck, the build and
`npm audit --omit=dev`. Dependabot (`.github/dependabot.yml`) opens weekly dependency updates.

### Packages (`.github/workflows/build.yml`)

Builds every package on GitHub-hosted runners (macOS, Windows, Linux), free for public repositories.
It runs on tags `v*` and manually (*Actions → Build → Run workflow*). Packages are uploaded as
workflow artifacts; on a tag, a **draft release** is created with all of them attached.

## Code signing

### Windows (Certum Code Signing in the Cloud)

Windows executables are signed with a Certum open source code signing certificate kept in Certum's
cloud (SimplySign). The release workflow does it automatically on `v*` tags:

Windows packages are built **on Linux** (`build-windows` job on `ubuntu-latest`, with Wine for the
NSIS uninstaller stub), then:

1. [ssign](https://github.com/Le-Syl21/ssign) (pinned release, SHA-256 verified) is installed in the
   job. It talks to Certum's cloud API over HTTPS and computes the one-time password from
   the account's TOTP seed: no SimplySign Desktop, no virtual smart card.
2. electron-builder calls [`build/sign-win.js`](../build/sign-win.js) for every executable (app,
   installer, uninstaller, portable); ssign signs in place with SHA-256, embeds the Certum chain and
   adds an RFC 3161 timestamp from `http://time.certum.pl`. One login covers the whole build.
3. `osslsigncode verify` checks every signature (chain and timestamp) before the packages are uploaded.

Repository secrets (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|---|---|
| `CERTUM_USERNAME` | e-mail of the SimplySign account |
| `CERTUM_TOTP_SECRET` | TOTP seed in **Base32** (the `secret=` of the SimplySign activation QR code; if Certum shows it in hexadecimal, convert it to Base32) |

Without these secrets (local builds, pull requests from forks) the hook does nothing and the build
stays unsigned. The TOTP seed allows signing in the maintainer's name until the SimplySign QR code is
re-issued: consider moving the secrets to a protected GitHub environment with required reviewers.

To sign by hand on a workstation, install ssign and use a one-shot code from the SimplySign mobile
app: `ssign -e you@example.com -T 123456 app.exe`.

### macOS

Builds are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Signing needs an Apple Developer ID
certificate (`CSC_LINK` / `CSC_KEY_PASSWORD`) plus notarization credentials (`APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).

Never store certificates or passwords in the repository.

## Releasing

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit, then tag: `git tag v0.2.0 && git push --tags`.
3. The GitHub workflow builds every package and creates a draft release: review it and publish.
