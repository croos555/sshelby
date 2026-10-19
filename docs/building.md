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

### GitHub Actions (`.github/workflows/build.yml`)

Builds every package on GitHub-hosted runners (macOS, Windows, Linux), free for public repositories.
It runs on tags `v*` and manually (*Actions → Build → Run workflow*). Packages are uploaded as
workflow artifacts; on a tag, a **draft release** is created with all of them attached.

### Jenkins (`Jenkinsfile`)

Builds Linux and Windows packages inside `electronuserland/builder:24-wine` (the agent needs
Docker). The optional macOS stage runs when the `BUILD_MAC` parameter is checked, on an agent
labelled `macos`.

## Code signing

Builds are unsigned by default (`CSC_IDENTITY_AUTO_DISCOVERY=false`).

- **macOS**: an Apple Developer ID certificate (`CSC_LINK` / `CSC_KEY_PASSWORD`) plus notarization
  credentials (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`).
- **Windows**: code signing keys must live in hardware or a cloud HSM. Options supported by
  electron-builder: Azure Trusted Signing, or an OV certificate from a provider with cloud signing
  (Certum, SSL.com, DigiCert…) through a custom sign script (for example with
  [jsign](https://ebourg.github.io/jsign/), which runs on macOS and Linux).

Store certificates and passwords as protected CI variables, never in the repository.

## Releasing

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit, then tag: `git tag v0.2.0 && git push --tags`.
3. The GitHub workflow builds every package and creates a draft release: review it and publish.
