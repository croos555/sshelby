# User guide

## Hosts and groups

The **Hosts** screen lists your groups and hosts. Switch between **grid**, **list** and **tree**
views with the buttons at the top right.

- **New host / New group**: toolbar button (the arrow next to *New host* opens more actions) or the
  overview panel on the right.
- **Open a group**: double-click it (grid/list) or expand it (tree). The breadcrumb brings you back.
- **Connect**: double-click a host, or use the terminal icon on hover. Right-click for SFTP,
  duplicate and delete.
- **Quick connect**: type `user@host`, `user@host:2222` or `ssh user@host -p 2222` in the search
  bar and press Enter. A host is created on the fly if it doesn't exist.
- **Move hosts and groups**: drag them onto a group in the tree view, or onto the bottom of the tree
  to move them to the top level.
- **Icon and color**: click the icon in the host or group editor. *Auto* shows the operating system
  badge (detected on first connection) for hosts and a folder for groups.
- **Show more** in the host editor: jump host, startup snippet, keep-alive, agent forwarding,
  terminal theme (empty = inherited from the group or the default).
- Groups can also set a default **terminal theme** for everything inside them.

## Credentials

Each host or group can either define its own credentials or **use its parent's**:

- **Use parent credentials** (default for new hosts and subgroups): the host takes the credentials
  of the nearest parent group that has some. The panel shows where they come from.
- **Own credentials**: either pick an **identity**, or fill username / password / SSH key.
- Groups can also set a default **port** and **jump host** for the hosts inside them.

If a password or username is missing, Sshelby asks when connecting; tick *Save to host* to keep it
(encrypted).

### Identities

Identities (Keychain → *New identity*) are reusable credentials:

| Type | Content |
|---|---|
| Password | username + password (leave empty to be asked each time) |
| SSH key | username + a key from the Keychain |
| SSH agent | username; keys come from your SSH agent, optionally pinned to one key |

Turn inline credentials into an identity with *Save as identity* in the host editor.

### SSH agent and KeePassXC

Settings → **SSH agent** chooses the agent: *Auto* (`SSH_AUTH_SOCK`, or the Windows OpenSSH agent
pipe), *Pageant*, or a custom socket. *Test* lists the keys the agent holds.

With KeePassXC: enable *Settings → SSH Agent* in KeePassXC, then on each entry holding a key open
the *SSH Agent* tab, select the private key and tick *Add key to agent when database is opened*.
The private key never leaves KeePassXC.

## Keychain

- **New key**: generate Ed25519 (recommended), ECDSA or RSA, with an optional passphrase.
- **Import key**: paste it or choose a file.
- **Key details**: copy or save the public key, or **Export to host** to append it to
  `~/.ssh/authorized_keys` on a saved host.

## Terminal

- `⌘/Ctrl+F` find, `⌘C` / `⌘V` (macOS) or `Ctrl+Shift+C` / `Ctrl+Shift+V` copy and paste,
  right-click copies the selection or pastes.
- **Side panel** (button at the top right of a terminal): snippets, themes, font size, keyword
  highlighting and status bar toggles.
- **Themes** apply at three levels: a **host** theme wins, otherwise the theme of the nearest
  **group** that sets one (subgroups and their hosts inherit it), otherwise the **default** theme.
  Pick the level in the side panel (*This host* / *Group* / *Default*), or set it in the host and
  group editors.
- **Status bar** (Settings → Terminal): remote CPU, RAM, load and disk usage, sampled every 5 s over
  the existing connection while the tab is visible. Nothing is installed on the server.
- **Keyword highlighting** (Settings → Keyword highlighting): colors errors, warnings, success,
  IPv4/IPv6 addresses, dates… Rules are editable regular expressions. Text a program already colors
  and full-screen apps (vim, htop, less) are left untouched.
- **Option as Meta** (macOS, Settings → Terminal): off by default so Option types `{ } [ ] | ~` on
  international keyboards.
- If a connection drops, *Reconnect* reopens it in the same tab.

## SFTP

Open the **SFTP** tab (or *Open SFTP* on a host). Each pane shows either your computer or a host;
switch with the source button at the top of the pane.

- Drag files between panes, or from your file manager onto a remote pane, to transfer them.
- Right-click for rename, delete, permissions (chmod), copy path, new folder.
- **Edit** (double-click a remote file): opens it in an editor tab with syntax highlighting.
  `⌘/Ctrl+S` saves it back; Sshelby warns if the file changed on the server meanwhile.
- **Open in local app**: opens the file in your default application and uploads it again every time
  you save it there.

## Port forwarding

Port Forwarding → *New forwarding*:

| Type | What it does |
|---|---|
| Local | a port on this computer reaches a host/port seen from the server (e.g. a database) |
| Remote | a port on the server reaches a host/port seen from this computer |
| Dynamic | a SOCKS5 proxy on this computer, routing through the server |

Rules can start automatically when Sshelby opens. Double-click a rule to start or stop it.

## Import and export

- **`~/.ssh/config`**: imports `Host` entries (address, port, user, identity file).
- **MobaXterm**: export your sessions from MobaXterm (*Settings → Configuration → General →
  Export sessions*) and import the `.mxtsessions` file (or `MobaXterm.ini`). SSH/SFTP sessions,
  folders and SSH gateways are imported; other session types and MobaXterm's encrypted passwords
  are not.
- **Encrypted export**: choose groups and hosts, set a key (8+ characters) and save a `.sshelby`
  file. Parent groups, jump hosts, snippets and known hosts are added automatically. SSH keys and
  identities are only included if you tick the option. **Import** asks for the key, shows a
  preview, then merges (existing items are updated, not duplicated).

## Settings

Appearance (system / light / dark), terminal font and behavior, status bar, keyword highlighting,
SSH agent, "keep running when the window is closed" (keeps port forwards alive), data import/export.

## Where is my data?

| System | Folder |
|---|---|
| macOS | `~/Library/Application Support/sshelby` |
| Windows | `%APPDATA%\sshelby` |
| Linux | `~/.config/sshelby` |

`vault.json` holds everything; secrets inside it are encrypted with the OS keychain, so copying the
file to another computer doesn't work: use the encrypted export instead.
