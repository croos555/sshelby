# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] — 2026-10-20

### Added
- Windows ARM64 installer and portable exe; Linux arm64 `.deb` and `.rpm` next to the AppImage.
- Rust unit tests run in CI.

### Changed
- Rebuilt on Tauri 2 with a Rust backend (`russh`): the app uses the system webview, so packages
  shrink from ~120 MB to a few MB (dmg ~5 MB, Windows installer ~3.5 MB, portable exe ~11 MB,
  deb/rpm 5 MB; the self-contained AppImage stays ~80 MB). The UI is unchanged.
- Secrets are encrypted with AES-256-GCM using a key kept in the OS keychain. The vault of the
  previous version is imported on first start (secrets included on macOS and Linux).
- The password prompt now says when the server refused the SSH key or agent key.

### Known limitations
- Not yet available: agent forwarding, "keep running in background", dropping files from the OS
  onto the SFTP pane, importing secrets of the previous version on Windows.

## [0.1.2] — 2026-10-19

### Added
- macOS apps are signed with a Developer ID certificate and notarized by Apple: no more
  "unidentified developer" warning.
- Linux `.rpm` package (Fedora, RHEL, openSUSE…) next to the AppImage and `.deb`.

## [0.1.1] — 2026-10-19

### Added
- Windows executables (installer, portable, app, uninstaller) are code-signed with a Certum open
  source certificate and timestamped, so Windows shows the publisher instead of "Unknown publisher".

### Changed
- Export: saved passwords now follow the same opt-in as SSH keys and identities ("Include
  credentials"). Encryption is required only when credentials are included; otherwise it is
  optional and the file can be plain JSON. Import asks for a key only for encrypted files.

## [0.1.0] — 2026-10-19

First public release.

### Added
- Hosts and nested groups with grid, list and tree views, drag & drop, search and quick connect.
- Custom icons and colors, OS detection, tags.
- Per-host credentials, identities (password, SSH key, SSH agent), "use parent credentials" inheritance.
- SSH agent support (ssh-agent, KeePassXC, Pageant, Windows OpenSSH agent) with single-key pinning.
- Terminal tabs with 30 themes (per host, per group or global), find, snippets, keyword highlighting
  and a remote resources status bar.
- Dual-pane SFTP with transfers, remote file editor and "open in local app" with auto-upload.
- Local, remote and dynamic (SOCKS5) port forwarding.
- Keychain: generate/import SSH keys, install public keys on hosts.
- Jump hosts, known hosts and host key verification.
- Import from `~/.ssh/config` and MobaXterm; encrypted selective export/import.
- Splash screen, light/dark appearance, packages for macOS, Windows and Linux.
