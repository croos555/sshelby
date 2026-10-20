// Imports from ~/.ssh/config and MobaXterm session exports

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::keys::inspect;
use crate::store::{notify_changed, store, Store};
use crate::util::Result;

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

fn file_name(p: &str) -> String {
    p.rsplit(['/', '\\']).next().unwrap_or(p).to_string()
}

// Existing key with the same fingerprint, or a new one
fn import_key(st: &mut Store, path: &Path) -> Option<String> {
    let pem = std::fs::read_to_string(path).ok()?;
    let mut info = inspect(&pem, None).ok()?;
    let fp = info["fingerprint"].clone();
    if let Some(k) = st.list("keys").iter().find(|k| k["fingerprint"] == fp) {
        return k["id"].as_str().map(String::from);
    }
    info["label"] = json!(file_name(&path.to_string_lossy()));
    st.upsert("keys", info)["id"].as_str().map(String::from)
}

// ---------- ~/.ssh/config ----------

// Host entries (wildcard patterns are skipped)
#[tauri::command]
pub fn vault_import_ssh_config() -> Result<usize> {
    let file = home().join(".ssh").join("config");
    let Ok(text) = std::fs::read_to_string(&file) else { crate::bail!("~/.ssh/config not found") };
    let mut blocks: Vec<Vec<(String, String)>> = Vec::new();
    let mut in_block = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (k, v) = match line.split_once(|c: char| c.is_whitespace() || c == '=') {
            Some((k, v)) => (k.to_lowercase(), v.trim_start_matches(|c: char| c.is_whitespace() || c == '=').trim_matches('"').to_string()),
            None => continue,
        };
        if k == "host" {
            in_block = false;
            if let Some(alias) = v.split_whitespace().find(|a| !a.contains(['*', '?', '!'])) {
                blocks.push(vec![("host".into(), alias.to_string())]);
                in_block = true;
            }
        } else if k == "match" {
            in_block = false;
        } else if in_block {
            blocks.last_mut().unwrap().push((k, v));
        }
    }

    let mut st = store();
    let mut imported = 0;
    for b in blocks {
        let get = |k: &str| b.iter().find(|(bk, _)| bk == k).map(|(_, v)| v.clone());
        let alias = get("host").unwrap_or_default();
        let key_id = get("identityfile").and_then(|p| {
            let path = if let Some(rest) = p.strip_prefix('~') { format!("{}{rest}", home().to_string_lossy()) } else { p };
            // Encrypted or unreadable keys are left to the user
            import_key(&mut st, Path::new(&path))
        });
        let address = get("hostname").unwrap_or_else(|| alias.clone());
        if st.list("hosts").iter().any(|h| h["label"] == alias.as_str() && h["address"] == address.as_str()) {
            continue;
        }
        st.upsert(
            "hosts",
            json!({
                "label": alias,
                "address": address,
                "port": get("port").and_then(|p| p.parse::<u16>().ok()),
                "username": get("user"),
                "keyId": key_id,
                "tags": ["ssh-config"]
            }),
        );
        imported += 1;
    }
    Ok(imported)
}

// ---------- MobaXterm ----------
//
// Sessions live in [Bookmarks], [Bookmarks_1]… sections:
//   SubRep=Folder\Sub folder
//   My server=#109#0%host%22%user%%-1%-1%%gwhost%22%gwuser%0%0%0%_ProfileDir_\.ssh\id_rsa%…#MobaFont%…
// The value is "#icon#type" then %-separated fields; type 0 = SSH, 7 = SFTP.

struct MobaSession {
    name: String,
    folder: Vec<String>,
    host: String,
    port: Option<u16>,
    username: Option<String>,
    key_path: Option<String>,
    gateway: Option<(String, Option<u16>, Option<String>)>,
}

fn kind_name(t: &str) -> String {
    let names = [
        "ssh", "telnet", "rsh", "xdmcp", "rdp", "vnc", "ftp", "sftp", "serial", "file", "shell", "browser", "mosh", "aws-s3", "wsl",
    ];
    t.parse::<usize>().ok().and_then(|i| names.get(i)).map(|s| s.to_string()).unwrap_or_else(|| format!("type {t}"))
}

// MobaXterm escapes a few characters in session names and values
fn unescape(s: &str) -> String {
    s.replace("__PIPE__", "|").replace("__DIEZE__", "#").replace("__PTVIRG__", ";").replace("__PERCENT__", "%").trim().to_string()
}

fn port(s: Option<&&str>) -> Option<u16> {
    s.and_then(|p| p.parse::<u16>().ok()).filter(|p| *p > 0)
}

fn non_empty(s: String) -> Option<String> {
    Some(s).filter(|s| !s.is_empty())
}

fn parse_moba(text: &str) -> (Vec<MobaSession>, Vec<Value>) {
    let (mut sessions, mut skipped) = (Vec::new(), Vec::new());
    let mut in_bookmarks = false;
    let mut folder: Vec<String> = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            let name = &line[1..line.len() - 1];
            let lower = name.to_lowercase();
            in_bookmarks = lower == "bookmarks" || lower.strip_prefix("bookmarks_").is_some_and(|n| n.chars().all(|c| c.is_ascii_digit()));
            folder.clear();
            continue;
        }
        if !in_bookmarks {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim();
        if key == "SubRep" {
            folder = value.split('\\').map(unescape).filter(|s| !s.is_empty()).collect();
            continue;
        }
        if key == "ImgNum" || !value.starts_with('#') {
            continue;
        }
        // "#icon#type%field1%field2…#MobaFont%…": keep the connection part only
        let mut parts = value[1..].splitn(2, '#');
        let (Some(_icon), Some(rest)) = (parts.next(), parts.next()) else { continue };
        let conn = rest.split('#').next().unwrap_or_default();
        let Some((t, fields)) = conn.split_once('%') else { continue };
        let kind = kind_name(t);
        let name = unescape(key);
        if kind != "ssh" && kind != "sftp" {
            skipped.push(json!({ "name": name, "kind": kind }));
            continue;
        }
        let f: Vec<&str> = fields.split('%').collect();
        let host = unescape(f.first().copied().unwrap_or_default());
        if host.is_empty() {
            skipped.push(json!({ "name": name, "kind": format!("{kind} without host") }));
            continue;
        }
        let mut s = MobaSession {
            name,
            folder: folder.clone(),
            host,
            port: port(f.get(1)),
            username: non_empty(unescape(f.get(2).copied().unwrap_or_default())),
            key_path: None,
            gateway: None,
        };
        if kind == "ssh" {
            // fields: 0 host, 1 port, 2 user, 7 gateway host, 8 gateway port, 9 gateway user, 13 private key
            let gw = unescape(f.get(7).copied().unwrap_or_default());
            if !gw.is_empty() {
                s.gateway = Some((gw, port(f.get(8)), non_empty(unescape(f.get(9).copied().unwrap_or_default()))));
            }
            s.key_path = non_empty(unescape(f.get(13).copied().unwrap_or_default()));
        }
        sessions.push(s);
    }
    (sessions, skipped)
}

// MobaXterm stores key paths Windows-style, often relative to its profile folder.
// Try the same file name in ~/.ssh as a best effort.
fn find_key(path: &str) -> Option<PathBuf> {
    let name = file_name(path);
    if name.is_empty() {
        return None;
    }
    let windowsy = |p: &str| p.starts_with("_ProfileDir_") || (p.len() > 1 && p.as_bytes()[1] == b':');
    [PathBuf::from(path), home().join(".ssh").join(&name)]
        .into_iter()
        .find(|p| !windowsy(&p.to_string_lossy()) && p.exists())
}

#[tauri::command]
pub fn vault_import_moba(path: String) -> Result<Value> {
    let bytes = std::fs::read(&path)?;
    // Exports are UTF-8 (with or without BOM) or Windows-1252 on older versions
    let text = match String::from_utf8(bytes.clone()) {
        Ok(t) => t,
        Err(_) => bytes.iter().map(|b| *b as char).collect(),
    };
    let (sessions, skipped) = parse_moba(text.trim_start_matches('\u{feff}'));
    let mut st = store();
    let (mut hosts, mut updated, mut groups, mut jump_hosts, mut keys, mut keys_missing) = (0, 0, 0, 0, 0, 0);

    let default_port = |p: Option<u16>| p.filter(|p| *p != 22);
    for s in &sessions {
        let mut jump_host_id: Option<String> = None;
        if let Some((gh, gp, gu)) = &s.gateway {
            let existing = st
                .list("hosts")
                .iter()
                .find(|h| {
                    h["address"] == gh.as_str()
                        && h["port"].as_u64().unwrap_or(22) == gp.unwrap_or(22) as u64
                        && gu.as_ref().is_none_or(|u| h["username"].as_str().unwrap_or_default() == u)
                })
                .and_then(|h| h["id"].as_str().map(String::from));
            jump_host_id = Some(match existing {
                Some(id) => id,
                None => {
                    jump_hosts += 1;
                    st.upsert(
                        "hosts",
                        json!({ "label": gh, "address": gh, "port": default_port(*gp), "username": gu, "tags": ["mobaxterm", "gateway"], "groupId": null }),
                    )["id"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string()
                }
            });
        }

        let mut parent: Option<String> = None;
        for name in &s.folder {
            let existing = st
                .list("groups")
                .iter()
                .find(|g| g["name"] == name.as_str() && g["parentId"].as_str().map(String::from) == parent)
                .and_then(|g| g["id"].as_str().map(String::from));
            parent = Some(match existing {
                Some(id) => id,
                None => {
                    groups += 1;
                    st.upsert("groups", json!({ "name": name, "parentId": parent }))["id"].as_str().unwrap_or_default().to_string()
                }
            });
        }

        let key_id = s.key_path.as_ref().and_then(|kp| {
            let before = st.list("keys").len();
            let id = find_key(kp).and_then(|f| import_key(&mut st, &f));
            match &id {
                None => keys_missing += 1,
                Some(_) if st.list("keys").len() > before => keys += 1,
                _ => {}
            }
            id
        });

        let mut fields = json!({
            "label": s.name,
            "address": s.host,
            "port": default_port(s.port),
            "username": s.username,
            "groupId": parent,
            "jumpHostId": jump_host_id,
            "keyId": key_id
        });
        let existing = st.list("hosts").iter().find(|h| h["label"] == s.name.as_str() && h["address"] == s.host.as_str()).cloned();
        match existing {
            Some(mut h) => {
                if fields["keyId"].is_null() {
                    fields["keyId"] = h["keyId"].clone();
                }
                for (k, v) in fields.as_object().unwrap() {
                    h[k] = v.clone();
                }
                st.upsert("hosts", h);
                updated += 1;
            }
            None => {
                fields["tags"] = json!(["mobaxterm"]);
                st.upsert("hosts", fields);
                hosts += 1;
            }
        }
    }
    drop(st);
    if hosts == 0 && updated == 0 && skipped.is_empty() {
        crate::bail!("No MobaXterm sessions found in this file");
    }
    notify_changed();
    Ok(json!({ "hosts": hosts, "updated": updated, "groups": groups, "jumpHosts": jump_hosts, "keys": keys, "keysMissing": keys_missing, "skipped": skipped }))
}
