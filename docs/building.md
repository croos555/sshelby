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

### GitLab CI (`.gitlab-ci.yml`)

A single `build` job runs on a **self-hosted macOS runner** and produces all packages
(macOS, Windows, Linux) as job artifacts.

1. On a Mac: `brew install gitlab-runner`.
2. In the project: *Settings → CI/CD → Runners → New project runner*, tag `macos`.
3. Register it with the shell executor:
   `gitlab-runner register --url https://gitlab.com --token <glrt-token> --executor shell`
4. Start it: `brew services start gitlab-runner`.

The job runs automatically from *Run pipeline* and on tags, and manually on pushes to the default
branch. Use the `MAC_RUNNER_TAG` CI/CD variable if your runner has another tag (for example
`saas-macos-medium-m1` for GitLab-hosted macOS runners, available on paid plans).

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
3. The tag pipeline builds every package; attach them to a GitLab release.
