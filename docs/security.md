# Security model

## Local storage

- All data is stored in `vault.json` in the application data folder. There is no account, no
  server and no telemetry.
- Secrets (host and group passwords, identity passwords, private keys and their passphrases) are
  encrypted with Electron's `safeStorage`:
  - **macOS**: Keychain (an item named *Sshelby Safe Storage*),
  - **Windows**: DPAPI, tied to your Windows user account,
  - **Linux**: GNOME Keyring / KWallet through libsecret. Without a keyring, secrets are only
    obfuscated; Settings → Data shows a warning in that case.
- The vault file is written atomically with `0600` permissions.

## Connections

- Unknown host keys are shown with their SHA-256 fingerprint and must be accepted. A changed host
  key triggers a prominent warning and is never replaced silently (imports never overwrite a trusted
  fingerprint either).
- Agent identities never see private keys: signing happens in the agent (ssh-agent, KeePassXC,
  Pageant). An identity can be restricted to a single agent key.
- Agent forwarding is off unless enabled per host.

## Export files

- Format: JSON envelope, payload encrypted with **AES-256-GCM**, key derived from your passphrase
  with **scrypt** (N=2^17, r=8, p=1, 16-byte random salt, 12-byte random IV). The header is bound to
  the ciphertext as additional authenticated data.
- A wrong key or a modified file is rejected. Choose a strong passphrase: anyone holding the file can
  attempt offline guesses.
- Credentials (passwords, SSH keys, identities) are excluded by default. A file containing any of
  them is always encrypted: the main process refuses to write it in clear. Without credentials the
  export may be saved unencrypted (plain JSON with the hosts, groups and settings selected).

## Renderer isolation

The UI runs with `contextIsolation` and without Node integration; it talks to the main process only
through a fixed preload API. Content Security Policy restricts scripts to the app itself.

## Remote file editing

"Open in local app" downloads the file to a private temporary folder, which is deleted when the SFTP
session or the application closes.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
