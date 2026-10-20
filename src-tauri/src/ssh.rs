// SSH connections: credential resolution through groups, host key checks, authentication, jump hosts

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Context};
use regex::Regex;
use russh::client::{self, AuthResult, ChannelOpenHandle, Handle, KeyboardInteractiveAuthResponse, Msg, Session};
use russh::keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{Channel, ChannelMsg, Disconnect, MethodKind, MethodSet};
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch};

use crate::prompts::{ask, ask_secret, first_value};
use crate::store::{notify_changed, store};
use crate::{agent, util};

// ---------- credential resolution ----------

#[derive(Default, Clone)]
pub struct Resolved {
    pub host: Value,
    pub address: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub key_id: Option<String>,
    pub jump_host_id: Option<String>,
    // Credentials come from a shared identity: don't offer to save typed passwords onto the host
    pub via_identity: bool,
    // Authenticate with the SSH agent, optionally limited to one key (fingerprint)
    pub agent: Option<Option<String>>,
}

fn s(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(String::from)
}

fn has_own_credentials(x: &Value) -> bool {
    ["identityId", "username", "password", "keyId"].iter().any(|k| s(&x[*k]).is_some())
}

// "Use parent credentials": explicit flag, else on unless the item has credentials of its own
fn uses_parent_credentials(x: &Value) -> bool {
    x["inheritCredentials"].as_bool().unwrap_or_else(|| !has_own_credentials(x))
}

// Walk host → parent groups. Username and the secret (password or key) come from the nearest
// level that sets them; at each level an identity replaces that level's inline fields.
pub fn resolve_host(host_id: &str) -> anyhow::Result<Resolved> {
    let st = store();
    let host = st.find("hosts", host_id).ok_or_else(|| anyhow!("Host not found"))?;
    let mut r = Resolved {
        address: s(&host["address"]).unwrap_or_default(),
        port: host["port"].as_u64().unwrap_or(0) as u16,
        jump_host_id: s(&host["jumpHostId"]),
        host: host.clone(),
        ..Default::default()
    };
    let (mut have_user, mut have_secret) = (false, false);

    let mut apply = |level: &Value| {
        let (mut username, mut password, mut key_id) = (s(&level["username"]), s(&level["password"]), s(&level["keyId"]));
        let mut agent = None;
        let identity = s(&level["identityId"]).and_then(|id| st.find("identities", &id));
        let from_identity = identity.is_some();
        if let Some(idn) = identity {
            let kind = s(&idn["authType"]).unwrap_or_default();
            username = s(&idn["username"]);
            password = if kind == "password" { s(&idn["password"]) } else { None };
            key_id = if kind == "key" { s(&idn["keyId"]) } else { None };
            if kind == "agent" {
                agent = Some(s(&idn["agentKeyFingerprint"]));
            }
        }
        if !have_user && username.is_some() {
            r.username = username;
            have_user = true;
            r.via_identity |= from_identity;
        }
        // An identity claims the secret slot even without a saved password (asked on connect)
        if !have_secret && (password.is_some() || key_id.is_some() || from_identity) {
            r.password = password;
            r.key_id = key_id;
            r.agent = agent;
            have_secret = true;
            r.via_identity |= from_identity;
        }
    };

    // Levels set to "use parent credentials" contribute nothing; the root level always counts
    let group_id = s(&host["groupId"]);
    if !(group_id.is_some() && uses_parent_credentials(&host)) {
        apply(&host);
    }
    let mut gid = group_id;
    let mut seen = HashSet::new();
    while let Some(id) = gid.filter(|id| seen.insert(id.clone())) {
        let Some(g) = st.find("groups", &id) else { break };
        if !(s(&g["parentId"]).is_some() && uses_parent_credentials(&g)) {
            apply(&g);
        }
        if r.port == 0 {
            r.port = g["port"].as_u64().unwrap_or(0) as u16;
        }
        if r.jump_host_id.is_none() {
            r.jump_host_id = s(&g["jumpHostId"]);
        }
        gid = s(&g["parentId"]);
    }
    if r.port == 0 {
        r.port = 22;
    }
    Ok(r)
}

// ---------- client handler ----------

pub type ForwardedSender = Arc<Mutex<Option<mpsc::UnboundedSender<Channel<Msg>>>>>;

pub struct Client {
    address: String,
    port: u16,
    // Remote (-R) forwards: channels opened by the server are handed to the forward that asked for them
    forwarded: ForwardedSender,
    // Dropped with the session; lets connections notice that the server went away
    _alive: watch::Sender<()>,
}

impl client::Handler for Client {
    type Error = anyhow::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let data = match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.key_data().clone(),
            PublicKeyOrCertificate::Certificate(c) => c.public_key().clone(),
        };
        let fingerprint = data.fingerprint(HashAlg::Sha256).to_string();
        let key_type = data.algorithm().as_str().to_string();
        let known = store()
            .list("knownHosts")
            .iter()
            .find(|k| k["host"] == self.address.as_str() && k["port"] == self.port)
            .cloned();
        if let Some(k) = &known {
            if k["fingerprint"] == fingerprint.as_str() {
                return Ok(true);
            }
        }
        let res = ask(json!({
            "kind": "hostkey",
            "host": self.address,
            "port": self.port,
            "keyType": key_type,
            "fingerprint": fingerprint,
            "previousFingerprint": known.as_ref().map(|k| k["fingerprint"].clone())
        }))
        .await;
        let ok = res["accept"].as_bool().unwrap_or(false);
        if ok && res["remember"].as_bool() != Some(false) {
            store().upsert(
                "knownHosts",
                json!({
                    "id": known.map(|k| k["id"].clone()),
                    "host": self.address,
                    "port": self.port,
                    "keyType": key_type,
                    "fingerprint": fingerprint,
                    "addedAt": util::now_ms()
                }),
            );
        }
        Ok(ok)
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let tx = self.forwarded.lock().unwrap().clone();
        match tx {
            Some(tx) => {
                reply.accept().await;
                let _ = tx.send(channel);
            }
            None => drop(reply),
        }
        Ok(())
    }
}

// ---------- connection ----------

pub struct Connection {
    pub handle: Arc<Handle<Client>>,
    pub forwarded: ForwardedSender,
    alive: watch::Receiver<()>,
    jump: Option<Box<Connection>>,
}

impl Connection {
    // Resolves when the server closes the connection (or it drops)
    pub async fn closed(&self) {
        let mut rx = self.alive.clone();
        while rx.changed().await.is_ok() {}
    }


    // Closes the whole jump chain
    pub fn close(&self) {
        let h = self.handle.clone();
        tauri::async_runtime::spawn(async move {
            let _ = h.disconnect(Disconnect::ByApplication, "", "en").await;
        });
        if let Some(j) = &self.jump {
            j.close();
        }
    }

    pub async fn exec(&self, cmd: &str) -> anyhow::Result<(String, String, Option<u32>)> {
        let mut ch = self.handle.channel_open_session().await?;
        ch.exec(true, cmd).await?;
        let (mut out, mut err, mut code) = (Vec::new(), Vec::new(), None);
        while let Some(msg) = ch.wait().await {
            match msg {
                ChannelMsg::Data { data } => out.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, ext: 1 } => err.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                ChannelMsg::Close => break,
                _ => {}
            }
        }
        Ok((String::from_utf8_lossy(&out).into_owned(), String::from_utf8_lossy(&err).into_owned(), code))
    }
}

pub type Log = Arc<dyn Fn(&str) + Send + Sync>;

pub fn no_log() -> Log {
    Arc::new(|_| {})
}

pub async fn connect_host(host_id: &str, log: Log) -> anyhow::Result<Connection> {
    connect_depth(host_id.to_string(), log, 0).await
}

fn connect_depth(host_id: String, log: Log, depth: u8) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<Connection>> + Send>> {
    Box::pin(async move {
        if depth > 5 {
            bail!("Jump host chain too deep");
        }
        let r = resolve_host(&host_id)?;
        let keepalive = r.host["keepAliveInterval"].as_u64().unwrap_or(30);
        let config = Arc::new(client::Config {
            inactivity_timeout: None,
            keepalive_interval: (keepalive > 0).then(|| Duration::from_secs(keepalive)),
            keepalive_max: 3,
            ..Default::default()
        });
        let forwarded: ForwardedSender = Arc::new(Mutex::new(None));
        let (alive_tx, alive_rx) = watch::channel(());
        let handler = Client { address: r.address.clone(), port: r.port, forwarded: forwarded.clone(), _alive: alive_tx };

        let mut jump = None;
        let connect = async {
            match r.jump_host_id.clone().filter(|j| *j != host_id) {
                Some(jid) => {
                    log("Connecting via jump host…");
                    let j = connect_depth(jid, log.clone(), depth + 1).await?;
                    let ch = j.handle.channel_open_direct_tcpip(r.address.clone(), r.port as u32, "127.0.0.1", 0).await?;
                    let h = client::connect_stream(config.clone(), ch.into_stream(), handler).await;
                    jump = Some(Box::new(j));
                    h
                }
                None => {
                    log(&format!("Connecting to {}:{}…", r.address, r.port));
                    client::connect(config.clone(), (r.address.as_str(), r.port), handler).await
                }
            }
        };
        let mut handle = tokio::time::timeout(Duration::from_secs(30), connect)
            .await
            .map_err(|_| anyhow!("Timed out while connecting to {}:{}", r.address, r.port))??;

        if let Err(e) = authenticate(&mut handle, &r, &log).await {
            let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
            if let Some(j) = &jump {
                j.close();
            }
            return Err(e);
        }
        store().touch_host(&host_id);
        let conn = Connection { handle: Arc::new(handle), forwarded, alive: alive_rx, jump };
        Ok(conn)
    })
}

// ---------- authentication ----------

fn allowed(remaining: &Option<MethodSet>, kind: MethodKind) -> bool {
    remaining.as_ref().is_none_or(|m| m.contains(&kind))
}

async fn authenticate(handle: &mut Handle<Client>, r: &Resolved, log: &Log) -> anyhow::Result<()> {
    let label = s(&r.host["label"]).unwrap_or_else(|| r.address.clone());
    // Credentials typed at a prompt with "save" ticked, written to the host once auth succeeds
    let mut save_user = None;
    let mut save_password = None;

    let username = match r.username.clone() {
        Some(u) => u,
        None => {
            let res = ask(json!({
                "kind": "keyboard-interactive",
                "title": format!("Connect to {label}"),
                "instructions": "No username configured for this host.",
                "prompts": [{ "prompt": "Username", "echo": true }],
                "offerSave": !r.via_identity
            }))
            .await;
            let (v, save) = first_value(&res);
            let u = v.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()).ok_or_else(|| anyhow!("Cancelled"))?;
            if save {
                save_user = Some(u.clone());
            }
            u
        }
    };

    // Diagnostics on stderr: which methods are tried and why they fail (no secrets)
    let trace = |m: &str| eprintln!("[auth {}@{}:{}] {m}", username, r.address, r.port);
    trace(&format!(
        "key={} agent={:?} password={} via_identity={}",
        r.key_id.is_some(),
        r.agent,
        r.password.is_some(),
        r.via_identity
    ));
    let mut remaining: Option<MethodSet> = None;
    let mut ok = false;
    let track = |res: AuthResult, remaining: &mut Option<MethodSet>| -> bool {
        match res {
            AuthResult::Success => true,
            AuthResult::Failure { remaining_methods, .. } => {
                *remaining = Some(remaining_methods);
                false
            }
        }
    };

    // 1. Configured key
    let key = r.key_id.as_ref().and_then(|id| store().find("keys", id));
    if let Some(key) = &key {
        let pem = s(&key["privateKey"]).unwrap_or_default();
        let key_label = s(&key["label"]).unwrap_or_default();
        let mut parsed = decode_secret_key(&pem, s(&key["passphrase"]).as_deref());
        if parsed.is_err() && s(&key["passphrase"]).is_none() {
            if let (Some(pass), _) = ask_secret("Key passphrase", &format!("Enter passphrase for key \"{key_label}\""), false).await {
                parsed = decode_secret_key(&pem, Some(&pass));
            }
        }
        match parsed {
            Err(e) => {
                trace(&format!("key \"{key_label}\" not loaded ({} bytes): {e}", pem.len()));
                log(&format!("Key \"{key_label}\" could not be loaded: {e}"))
            }
            Ok(pk) => {
                let hash = if pk.algorithm().is_rsa() { handle.best_supported_rsa_hash().await?.flatten() } else { None };
                let res = handle.authenticate_publickey(&username, PrivateKeyWithHashAlg::new(Arc::new(pk), hash)).await?;
                ok = track(res, &mut remaining);
                trace(&format!("key \"{key_label}\" ok={ok} remaining={remaining:?}"));
            }
        }
    } else if r.key_id.is_some() {
        trace("configured key not found in the vault");
    }

    // 2. Agent: only it for agent identities, otherwise a fallback when no key is configured
    if !ok && (r.agent.is_some() || key.is_none()) && allowed(&remaining, MethodKind::PublicKey) {
        match agent::agent_path() {
            None if r.agent.is_some() => log("No SSH agent available (check Settings → SSH agent)"),
            None => trace("no agent socket (SSH_AUTH_SOCK unset)"),
            Some(path) => match agent::connect(&path).await {
                Err(e) => {
                    trace(&format!("agent {path}: {e}"));
                    log(&format!("SSH agent unavailable: {e}"))
                }
                Ok(mut ag) => {
                    let wanted = r.agent.clone().flatten();
                    let ids = match ag.request_identities().await {
                        Ok(ids) => ids,
                        Err(e) => {
                            trace(&format!("agent {path}: cannot list identities: {e}"));
                            vec![]
                        }
                    };
                    trace(&format!("agent {path}: {} identities, wanted={wanted:?}", ids.len()));
                    for id in &ids {
                        let Some(pk) = agent::identity_key(id) else { continue };
                        // Only offer the selected key: many keys would burn through MaxAuthTries
                        if wanted.as_ref().is_some_and(|f| *f != agent::fingerprint(pk)) {
                            continue;
                        }
                        let hash = if pk.algorithm().is_rsa() { handle.best_supported_rsa_hash().await?.flatten() } else { None };
                        let res = handle.authenticate_publickey_with(&username, pk.clone(), hash, &mut ag).await;
                        trace(&format!("agent key {} ({}): {:?}", agent::fingerprint(pk), pk.algorithm().as_str(), res.as_ref().map(|r| matches!(r, AuthResult::Success))));
                        match res {
                            Ok(res) => {
                                if track(res, &mut remaining) {
                                    ok = true;
                                    break;
                                }
                            }
                            Err(e) => log(&format!("SSH agent refused to sign: {e}")),
                        }
                    }
                }
            },
        }
    }

    trace(&format!("after keys/agent: ok={ok} remaining={remaining:?}"));
    // 3. Saved password
    if !ok && allowed(&remaining, MethodKind::Password) {
        if let Some(pw) = &r.password {
            ok = track(handle.authenticate_password(&username, pw).await?, &mut remaining);
        }
    }

    // 4. Keyboard-interactive (many servers send password prompts this way)
    if !ok && allowed(&remaining, MethodKind::KeyboardInteractive) {
        let password_re = Regex::new("(?i)password").unwrap();
        let mut reused = false;
        let mut resp = handle.authenticate_keyboard_interactive_start(&username, None::<String>).await?;
        loop {
            match resp {
                KeyboardInteractiveAuthResponse::Success => {
                    ok = true;
                    break;
                }
                KeyboardInteractiveAuthResponse::Failure { remaining_methods, .. } => {
                    remaining = Some(remaining_methods);
                    break;
                }
                KeyboardInteractiveAuthResponse::InfoRequest { instructions, prompts, .. } => {
                    let is_password = prompts.len() == 1 && !prompts[0].echo && password_re.is_match(&prompts[0].prompt);
                    let answers = if prompts.is_empty() {
                        vec![]
                    } else if is_password && r.password.is_some() && !reused {
                        // Reuse the stored password once
                        reused = true;
                        vec![r.password.clone().unwrap()]
                    } else {
                        let res = ask(json!({
                            "kind": "keyboard-interactive",
                            "title": format!("{username}@{}", r.address),
                            "instructions": instructions,
                            "prompts": prompts.iter().map(|p| json!({ "prompt": p.prompt, "echo": p.echo })).collect::<Vec<_>>(),
                            "offerSave": is_password && !r.via_identity
                        }))
                        .await;
                        let Some(values) = res["values"].as_array().cloned() else { bail!("Cancelled") };
                        let values: Vec<String> = values.iter().map(|v| v.as_str().unwrap_or_default().to_string()).collect();
                        if is_password {
                            save_password = (res["save"].as_bool() == Some(true)).then(|| values.first().cloned()).flatten();
                        }
                        values
                    };
                    resp = handle.authenticate_keyboard_interactive_respond(answers).await?;
                }
            }
        }
    }

    // 5. Password prompt, three attempts
    let mut attempts = 0;
    while !ok && allowed(&remaining, MethodKind::Password) && attempts < 3 {
        attempts += 1;
        let message = if attempts > 1 { "Authentication failed. Try again." } else { "Password" };
        let (value, save) = ask_secret(&format!("{username}@{}", r.address), message, !r.via_identity).await;
        let Some(pw) = value else { bail!("Cancelled") };
        save_password = save.then(|| pw.clone());
        ok = track(handle.authenticate_password(&username, &pw).await?, &mut remaining);
    }

    if !ok {
        bail!("All configured authentication methods failed");
    }

    // Typed-and-saved credentials belong to the host from now on
    if save_user.is_some() || save_password.is_some() {
        let mut st = store();
        if let Some(mut host) = st.find("hosts", r.host["id"].as_str().unwrap_or_default()) {
            if let Some(u) = save_user {
                host["username"] = json!(u);
            }
            if let Some(p) = save_password {
                host["password"] = json!(p);
            }
            host["inheritCredentials"] = json!(false);
            st.upsert("hosts", host);
            drop(st);
            notify_changed();
        }
    }
    Ok(())
}

// Context helper for callers that only need a quick one-shot connection
pub async fn with_connection<T, F, Fut>(host_id: &str, f: F) -> anyhow::Result<T>
where
    F: FnOnce(Arc<Connection>) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<T>>,
{
    let conn = Arc::new(connect_host(host_id, no_log()).await.context("connection failed")?);
    let res = f(conn.clone()).await;
    conn.close();
    res
}
