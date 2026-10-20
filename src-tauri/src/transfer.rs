// Selective export / import of hosts and groups between machines.
// File = JSON envelope; payload is AES-256-GCM with a key derived from the passphrase by scrypt
// (same format as the Electron build, files are interchangeable).

use std::collections::{HashMap, HashSet};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, bail};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

use crate::store::{notify_changed, store, Store};
use crate::util::{now_ms, random_bytes, uuid, Result};

const FORMAT: &str = "sshelby-export";
const AAD: &[u8] = b"sshelby-export:1";
const LOG_N: u8 = 17;

fn derive_key(passphrase: &str, salt: &[u8], log_n: u8, r: u32, p: u32) -> anyhow::Result<[u8; 32]> {
    let params = scrypt::Params::new(log_n, r, p, 32).map_err(|e| anyhow!("{e}"))?;
    let mut key = [0u8; 32];
    let normalized: String = passphrase.nfkc().collect();
    scrypt::scrypt(normalized.as_bytes(), salt, &params, &mut key).map_err(|e| anyhow!("{e}"))?;
    Ok(key)
}

fn encrypt(payload: &Value, passphrase: &str) -> anyhow::Result<Value> {
    let salt = random_bytes::<16>();
    let iv = random_bytes::<12>();
    let key = derive_key(passphrase, &salt, LOG_N, 8, 1)?;
    let cipher = Aes256Gcm::new_from_slice(&key)?;
    let plain = serde_json::to_vec(payload)?;
    // Bind the header to the ciphertext so it can't be swapped
    let mut ct = cipher.encrypt(Nonce::from_slice(&iv), Payload { msg: &plain, aad: AAD }).map_err(|_| anyhow!("Encryption failed"))?;
    let tag = ct.split_off(ct.len() - 16);
    Ok(json!({
        "format": FORMAT,
        "version": 1,
        "kdf": { "name": "scrypt", "salt": B64.encode(salt), "N": 1u32 << LOG_N, "r": 8, "p": 1 },
        "cipher": "aes-256-gcm",
        "iv": B64.encode(iv),
        "tag": B64.encode(tag),
        "data": B64.encode(ct)
    }))
}

fn decrypt(env: &Value, passphrase: &str) -> anyhow::Result<Value> {
    let kdf = &env["kdf"];
    let n = kdf["N"].as_u64().unwrap_or(0);
    let (r, p) = (kdf["r"].as_u64().unwrap_or(0) as u32, kdf["p"].as_u64().unwrap_or(0) as u32);
    // Refuse absurd parameters from a crafted file instead of hanging the app
    if !n.is_power_of_two() || n > 1 << 20 || r > 16 || p > 4 {
        bail!("Unsupported key derivation parameters");
    }
    let field = |k: &str| B64.decode(env[k].as_str().unwrap_or_default());
    let salt = B64.decode(kdf["salt"].as_str().unwrap_or_default())?;
    let key = derive_key(passphrase, &salt, n.trailing_zeros() as u8, r, p)?;
    let (iv, tag, mut data) = (field("iv")?, field("tag")?, field("data")?);
    if iv.len() != 12 || tag.len() != 16 {
        bail!("Wrong key, or the file is corrupted");
    }
    data.extend(tag);
    let cipher = Aes256Gcm::new_from_slice(&key)?;
    let plain = cipher
        .decrypt(Nonce::from_slice(&iv), Payload { msg: &data, aad: AAD })
        .map_err(|_| anyhow!("Wrong key, or the file is corrupted"))?;
    Ok(serde_json::from_slice(&plain)?)
}

fn is_encrypted(env: &Value) -> bool {
    env["encrypted"] != json!(false)
}

fn parse_envelope(path: &str) -> anyhow::Result<Value> {
    let raw = std::fs::read_to_string(path)?;
    let env: Value = serde_json::from_str(&raw).map_err(|_| anyhow!("Not a Sshelby export file"))?;
    let ok = env["format"] == FORMAT
        && env["version"] == 1
        && if is_encrypted(&env) { env["kdf"]["name"] == "scrypt" } else { env["payload"].is_object() };
    if !ok {
        bail!("Not a Sshelby export file (or an unsupported version)");
    }
    Ok(env)
}

fn open_export(env: &Value, passphrase: Option<&str>) -> anyhow::Result<Value> {
    if !is_encrypted(env) {
        return Ok(env["payload"].clone());
    }
    match passphrase.filter(|p| !p.is_empty()) {
        Some(p) => decrypt(env, p),
        None => bail!("This file is encrypted: enter its key"),
    }
}

fn arr<'a>(p: &'a Value, k: &str) -> &'a [Value] {
    p[k].as_array().map(Vec::as_slice).unwrap_or(&[])
}

fn sid(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(String::from)
}

// Anything that could log someone in: decides whether the export must be encrypted
fn has_secrets(p: &Value) -> bool {
    !arr(p, "keys").is_empty()
        || !arr(p, "identities").is_empty()
        || arr(p, "hosts").iter().chain(arr(p, "groups")).any(|x| sid(&x["password"]).is_some())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    group_ids: Vec<String>,
    host_ids: Vec<String>,
    include_forwards: bool,
    // Passwords, SSH keys and identities are left out unless explicitly requested
    include_credentials: Option<bool>,
}

// Expand the user's selection into everything those hosts need to work elsewhere
fn collect(st: &Store, sel: &Selection) -> Value {
    let (all_groups, all_hosts) = (st.list("groups"), st.list("hosts"));
    let mut group_ids: HashSet<String> = HashSet::new();
    let mut host_ids: HashSet<String> = sel.host_ids.iter().cloned().collect();

    // Selected groups bring their whole subtree
    let mut stack = sel.group_ids.clone();
    while let Some(gid) = stack.pop() {
        if !group_ids.insert(gid.clone()) {
            continue;
        }
        stack.extend(all_groups.iter().filter(|g| g["parentId"] == gid.as_str()).filter_map(|g| sid(&g["id"])));
        host_ids.extend(all_hosts.iter().filter(|h| h["groupId"] == gid.as_str()).filter_map(|h| sid(&h["id"])));
    }

    let add_ancestors = |group_ids: &mut HashSet<String>, mut gid: Option<String>| -> bool {
        let mut grew = false;
        while let Some(id) = gid.filter(|id| !group_ids.contains(id)) {
            let Some(g) = all_groups.iter().find(|g| g["id"] == id.as_str()) else { break };
            group_ids.insert(id);
            grew = true;
            gid = sid(&g["parentId"]);
        }
        grew
    };

    // Jump hosts referenced by hosts or groups, transitively; ancestors keep the tree shape
    let mut grew = true;
    while grew {
        grew = false;
        let refs: Vec<String> = all_hosts
            .iter()
            .filter(|h| host_ids.contains(h["id"].as_str().unwrap_or_default()))
            .chain(all_groups.iter().filter(|g| group_ids.contains(g["id"].as_str().unwrap_or_default())))
            .filter_map(|x| sid(&x["jumpHostId"]))
            .collect();
        for id in refs {
            if !host_ids.contains(&id) && all_hosts.iter().any(|h| h["id"] == id.as_str()) {
                host_ids.insert(id);
                grew = true;
            }
        }
        for h in all_hosts.iter().filter(|h| host_ids.contains(h["id"].as_str().unwrap_or_default())) {
            grew |= add_ancestors(&mut group_ids, sid(&h["groupId"]));
        }
        for g in group_ids.clone() {
            let parent = all_groups.iter().find(|x| x["id"] == g.as_str()).and_then(|x| sid(&x["parentId"]));
            grew |= add_ancestors(&mut group_ids, parent);
        }
    }

    let creds = sel.include_credentials.unwrap_or(false);
    let hosts: Vec<Value> = all_hosts.iter().filter(|h| host_ids.contains(h["id"].as_str().unwrap_or_default())).cloned().collect();
    let groups: Vec<Value> = all_groups.iter().filter(|g| group_ids.contains(g["id"].as_str().unwrap_or_default())).cloned().collect();
    let identity_ids: HashSet<String> = hosts.iter().chain(&groups).filter_map(|x| sid(&x["identityId"])).collect();
    let identities: Vec<Value> = st.list("identities").iter().filter(|i| identity_ids.contains(i["id"].as_str().unwrap_or_default())).cloned().collect();
    let key_ids: HashSet<String> = hosts.iter().chain(&groups).chain(&identities).filter_map(|x| sid(&x["keyId"])).collect();
    let snippet_ids: HashSet<String> = hosts.iter().filter_map(|h| sid(&h["startupSnippetId"])).collect();
    let addrs: HashSet<String> = hosts.iter().filter_map(|h| sid(&h["address"])).collect();
    // Without credentials, drop the secrets and the references to keys/identities that aren't exported
    let strip = |x: &Value| {
        let mut x = x.clone();
        if !creds {
            if let Some(o) = x.as_object_mut() {
                o.remove("password");
                o.insert("keyId".into(), Value::Null);
                o.insert("identityId".into(), Value::Null);
            }
        }
        x
    };
    let pick = |col: &str, ids: &HashSet<String>| -> Vec<Value> {
        st.list(col).iter().filter(|x| ids.contains(x["id"].as_str().unwrap_or_default())).cloned().collect()
    };
    json!({
        "exportedAt": now_ms(),
        "groups": groups.iter().map(strip).collect::<Vec<_>>(),
        "hosts": hosts.iter().map(strip).collect::<Vec<_>>(),
        "keys": if creds { pick("keys", &key_ids) } else { vec![] },
        "identities": if creds { identities } else { vec![] },
        "snippets": pick("snippets", &snippet_ids),
        "forwards": if sel.include_forwards {
            st.list("forwards").iter().filter(|f| host_ids.contains(f["hostId"].as_str().unwrap_or_default())).cloned().collect()
        } else { vec![] },
        "knownHosts": st.list("knownHosts").iter().filter(|k| addrs.contains(k["host"].as_str().unwrap_or_default())).cloned().collect::<Vec<_>>()
    })
}

// Merge into the local vault, remapping ids and matching existing items so re-imports update instead of duplicating
fn merge(st: &mut Store, p: &Value) -> Value {
    let mut detail: HashMap<&str, (u32, u32)> = HashMap::new();
    let mut count = |col: &'static str, created: bool| {
        let e = detail.entry(col).or_default();
        if created { e.0 += 1 } else { e.1 += 1 }
    };
    let map_id = |m: &HashMap<String, String>, v: &Value| -> Value {
        sid(v).and_then(|id| m.get(&id).cloned()).map(Value::String).unwrap_or(Value::Null)
    };
    let find_id = |st: &Store, col: &str, f: &dyn Fn(&Value) -> bool| st.list(col).iter().find(|x| f(x)).and_then(|x| sid(&x["id"]));

    let mut key_map = HashMap::new();
    for k in arr(p, "keys") {
        let existing = find_id(st, "keys", &|x| x["fingerprint"] == k["fingerprint"]);
        let mut item = k.clone();
        item["id"] = json!(existing.clone().unwrap_or_else(uuid));
        let saved = st.upsert("keys", item);
        key_map.insert(sid(&k["id"]).unwrap_or_default(), sid(&saved["id"]).unwrap_or_default());
        count("keys", existing.is_none());
    }

    let mut identity_map = HashMap::new();
    for i in arr(p, "identities") {
        let existing = find_id(st, "identities", &|x| x["label"] == i["label"] && x["username"] == i["username"]);
        let mut item = i.clone();
        item["id"] = json!(existing.clone().unwrap_or_else(uuid));
        item["keyId"] = map_id(&key_map, &i["keyId"]);
        let saved = st.upsert("identities", item);
        identity_map.insert(sid(&i["id"]).unwrap_or_default(), sid(&saved["id"]).unwrap_or_default());
        count("identities", existing.is_none());
    }

    let mut snippet_map = HashMap::new();
    for s in arr(p, "snippets") {
        let existing = find_id(st, "snippets", &|x| x["label"] == s["label"] && x["script"] == s["script"]);
        let id = match existing {
            Some(id) => id,
            None => {
                let mut item = s.clone();
                item["id"] = json!(uuid());
                count("snippets", true);
                sid(&st.upsert("snippets", item)["id"]).unwrap_or_default()
            }
        };
        snippet_map.insert(sid(&s["id"]).unwrap_or_default(), id);
    }

    // Parents before children so parent ids are already mapped
    let groups = arr(p, "groups");
    let mut group_map: HashMap<String, String> = HashMap::new();
    let mut pending: Vec<&Value> = groups.iter().collect();
    while !pending.is_empty() {
        let idx = pending
            .iter()
            .position(|g| match sid(&g["parentId"]) {
                None => true,
                Some(pid) => group_map.contains_key(&pid) || !groups.iter().any(|x| x["id"] == pid.as_str()),
            })
            .unwrap_or(0);
        let g = pending.remove(idx);
        let parent = map_id(&group_map, &g["parentId"]);
        let existing = find_id(st, "groups", &|x| x["name"] == g["name"] && sid(&x["parentId"]).map(Value::String).unwrap_or(Value::Null) == parent);
        group_map.insert(sid(&g["id"]).unwrap_or_default(), existing.unwrap_or_else(uuid));
    }

    // Hosts get ids first so jump-host references can be remapped
    let mut host_map: HashMap<String, String> = HashMap::new();
    for h in arr(p, "hosts") {
        let s = |v: &Value| v.as_str().unwrap_or_default().to_string();
        let existing = find_id(st, "hosts", &|x| {
            x["address"] == h["address"]
                && s(&x["username"]) == s(&h["username"])
                && s(&x["label"]) == s(&h["label"])
                && x["port"].as_u64().unwrap_or(22) == h["port"].as_u64().unwrap_or(22)
        });
        host_map.insert(sid(&h["id"]).unwrap_or_default(), existing.unwrap_or_else(uuid));
    }

    for g in groups {
        let id = group_map[&sid(&g["id"]).unwrap_or_default()].clone();
        let existed = st.find("groups", &id).is_some();
        let mut item = g.clone();
        item["id"] = json!(id);
        item["parentId"] = map_id(&group_map, &g["parentId"]);
        item["keyId"] = map_id(&key_map, &g["keyId"]);
        item["identityId"] = map_id(&identity_map, &g["identityId"]);
        item["jumpHostId"] = map_id(&host_map, &g["jumpHostId"]);
        st.upsert("groups", item);
        count("groups", !existed);
    }

    for h in arr(p, "hosts") {
        let id = host_map[&sid(&h["id"]).unwrap_or_default()].clone();
        let existed = st.find("hosts", &id).is_some();
        let mut item = h.clone();
        item["id"] = json!(id);
        item["groupId"] = map_id(&group_map, &h["groupId"]);
        item["keyId"] = map_id(&key_map, &h["keyId"]);
        item["identityId"] = map_id(&identity_map, &h["identityId"]);
        item["jumpHostId"] = map_id(&host_map, &h["jumpHostId"]);
        item["startupSnippetId"] = map_id(&snippet_map, &h["startupSnippetId"]);
        if let Some(o) = item.as_object_mut() {
            o.remove("lastConnectedAt");
        }
        st.upsert("hosts", item);
        count("hosts", !existed);
    }

    for f in arr(p, "forwards") {
        let Some(host_id) = sid(&f["hostId"]).and_then(|id| host_map.get(&id).cloned()) else { continue };
        let existing = find_id(st, "forwards", &|x| {
            x["hostId"] == host_id.as_str()
                && x["type"] == f["type"]
                && x["bindPort"] == f["bindPort"]
                && x["bindAddress"].as_str().unwrap_or_default() == f["bindAddress"].as_str().unwrap_or_default()
        });
        let mut item = f.clone();
        item["id"] = json!(existing.clone().unwrap_or_else(uuid));
        item["hostId"] = json!(host_id);
        item["autoStart"] = json!(false);
        st.upsert("forwards", item);
        count("forwards", existing.is_none());
    }

    for k in arr(p, "knownHosts") {
        // Never silently replace a fingerprint this machine already trusts
        if find_id(st, "knownHosts", &|x| x["host"] == k["host"] && x["port"] == k["port"]).is_some() {
            continue;
        }
        let mut item = k.clone();
        item["id"] = json!(uuid());
        st.upsert("knownHosts", item);
        count("knownHosts", true);
    }

    let created: u32 = detail.values().map(|d| d.0).sum();
    let updated: u32 = detail.values().map(|d| d.1).sum();
    let detail: serde_json::Map<String, Value> =
        detail.into_iter().map(|(k, (c, u))| (k.to_string(), json!({ "created": c, "updated": u }))).collect();
    json!({ "created": created, "updated": updated, "detail": detail })
}

// ---------- commands ----------

#[tauri::command]
pub fn transfer_preview(sel: Selection) -> Value {
    let p = collect(&store(), &sel);
    let n = |k: &str| arr(&p, k).len();
    json!({
        "secrets": has_secrets(&p), "groups": n("groups"), "hosts": n("hosts"), "keys": n("keys"),
        "identities": n("identities"), "snippets": n("snippets"), "forwards": n("forwards"), "knownHosts": n("knownHosts")
    })
}

// passphrase null = unencrypted export, refused when the payload contains credentials
#[tauri::command]
pub async fn transfer_export(sel: Selection, passphrase: Option<String>, path: String) -> Result<bool> {
    let payload = collect(&store(), &sel);
    if arr(&payload, "hosts").is_empty() && arr(&payload, "groups").is_empty() {
        crate::bail!("Nothing selected");
    }
    let file = match passphrase {
        None if has_secrets(&payload) => crate::bail!("Exports containing credentials must be encrypted"),
        None => serde_json::to_string_pretty(&json!({ "format": FORMAT, "version": 1, "encrypted": false, "payload": payload }))?,
        Some(p) if p.chars().count() < 8 => crate::bail!("The key must be at least 8 characters"),
        // scrypt with N=2^17 takes a moment: keep it off the async workers
        Some(p) => serde_json::to_string(&tauri::async_runtime::spawn_blocking(move || encrypt(&payload, &p)).await??)?,
    };
    std::fs::write(&path, file)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(true)
}

#[tauri::command]
pub fn transfer_check(path: String) -> Result<Value> {
    let env = parse_envelope(&path)?;
    Ok(json!({ "path": path, "encrypted": is_encrypted(&env) }))
}

async fn open_file(path: String, passphrase: Option<String>) -> anyhow::Result<Value> {
    tauri::async_runtime::spawn_blocking(move || open_export(&parse_envelope(&path)?, passphrase.as_deref())).await?
}

// Decrypt only, so the UI can show what will be imported before merging
#[tauri::command]
pub async fn transfer_inspect(path: String, passphrase: Option<String>) -> Result<Value> {
    let p = open_file(path, passphrase).await?;
    let names = |k: &str, f: &str, alt: &str| -> Vec<Value> {
        arr(&p, k).iter().map(|x| if sid(&x[f]).is_some() { x[f].clone() } else { x[alt].clone() }).collect()
    };
    Ok(json!({
        "exportedAt": p["exportedAt"],
        "groups": names("groups", "name", "name"),
        "hosts": names("hosts", "label", "address"),
        "keys": arr(&p, "keys").len(), "identities": arr(&p, "identities").len(), "snippets": arr(&p, "snippets").len(),
        "forwards": arr(&p, "forwards").len(), "knownHosts": arr(&p, "knownHosts").len()
    }))
}

#[tauri::command]
pub async fn transfer_import(path: String, passphrase: Option<String>) -> Result<Value> {
    let p = open_file(path, passphrase).await?;
    let summary = merge(&mut store(), &p);
    notify_changed();
    Ok(summary)
}
