# Security model

## Local storage

- All data is stored in `vault.json` in the application data folder. There is no account, no
  server and no telemetry.
- Secrets (host and group passwords, identity passwords, private keys and their passphrases) are
  encrypted with **AES-256-GCM** (random 12-byte nonce per value). The 256-bit key is generated on
  first start and kept in the operating system's credential store:
  - **macOS**: Keychain (item *dev.sshelby.app* / *vault-key*),
  - **Windows**: Credential Manager, tied to your Windows user account,
  - **Linux**: GNOME Keyring / KWallet through the Secret Service API. Without one, secrets are
    stored unencrypted; Settings → Data shows a warning in that case.
- On first start, a vault from the former Electron build is imported; its secrets are decrypted
  with the Electron key (macOS asks for permission to read *sshelby Safe Storage*) and re-encrypted
  with the new key. The old file is left untouched.
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
  them is always encrypted: the backend refuses to write it in clear. Without credentials the
  export may be saved unencrypted (plain JSON with the hosts, groups and settings selected).

## UI isolation

The UI runs in the system webview without access to the file system or the network: it can only
call the backend's commands and the plugin APIs listed in `src-tauri/capabilities` (file dialogs,
opening files and links). The Content Security Policy restricts scripts to the app itself.

## Remote file editing

"Open in local app" downloads the file to a private temporary folder, which is deleted when the SFTP
session or the application closes.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
