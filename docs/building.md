# Building & releasing

## Local builds

```bash
npm run dist:mac       # dmg + zip, x64 and arm64   (dist:mac:arm = Apple Silicon only)
npm run dist:win       # NSIS installer (x64 + arm64) + portable exe (x64)
npm run dist:linux     # AppImage (x64 + arm64) + deb (x64)
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

1. [`jay0lee/certum-cloud-code-sign`](https://github.com/jay0lee/certum-cloud-code-sign) (pinned to a
   reviewed commit) installs SimplySign Desktop on the Windows runner and logs in with a TOTP code
   computed from the account's secret, which mounts the certificate in the Windows store.
2. electron-builder calls [`build/sign-win.js`](../build/sign-win.js) for every executable (app,
   installer, uninstaller, portable): `signtool` with SHA-256 and an RFC 3161 timestamp from
   `http://time.certum.pl`.
3. The signatures are verified (`signtool verify /pa`), then the SimplySign session is closed.

Repository secrets (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|---|---|
| `CERTUM_USERNAME` | e-mail of the SimplySign account |
| `CERTUM_TOTP_SECRET` | Base32 TOTP secret: the `secret=` parameter of the QR code shown when activating SimplySign (regenerate the QR code in the Certum account if it wasn't kept) |

Without these secrets (local builds, pull requests from forks) the hook does nothing and the build
stays unsigned.

Troubleshooting (repository *variables*, not secrets): `CERTUM_DEBUG=true` uploads screenshots of the
SimplySign login as a workflow artifact; `CERTUM_TOTP_ALGORITHM` (default `SHA-256`) changes the
one-time password algorithm. "No matching certificate was found" after a successful login usually
means the certificate isn't issued/active yet in the Certum account. The TOTP secret allows signing in the maintainer's name: consider moving the secrets
to a protected GitHub environment with required reviewers.

### macOS

Builds are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Signing needs an Apple Developer ID
certificate (`CSC_LINK` / `CSC_KEY_PASSWORD`) plus notarization credentials (`APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).

Never store certificates or passwords in the repository.

## Releasing

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit, then tag: `git tag v0.2.0 && git push --tags`.
3. The GitHub workflow builds every package and creates a draft release: review it and publish.
