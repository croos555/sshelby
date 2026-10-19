# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

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
