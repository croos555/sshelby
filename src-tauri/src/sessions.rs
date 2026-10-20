// Terminal sessions: one SSH connection + PTY shell per tab

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use russh::client::Msg;
use russh::{ChannelMsg, ChannelWriteHalf};
use serde_json::json;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::ssh::{connect_host, Connection};
use crate::stats::{parse_stats, CpuSample, STATS_COMMAND};
use crate::store::{notify_changed, store};
use crate::util::emit;

enum Input {
    Data(Vec<u8>),
    Resize(u32, u32),
    Close,
}

struct Session {
    // Latest terminal size from the UI; resizes arriving while connecting must not be lost
    size: (u32, u32),
    input: Option<mpsc::UnboundedSender<Input>>,
    conn: Option<Arc<Connection>>,
    stats: Option<JoinHandle<()>>,
    closed: bool,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, Session>>> = LazyLock::new(Default::default);

fn status(session_id: &str, status: &str, message: Option<String>) {
    emit("ssh:status", json!({ "sessionId": session_id, "status": status, "message": message }));
}

fn data(session_id: &str, text: String) {
    emit("ssh:data", json!({ "sessionId": session_id, "data": text }));
}

// Decodes UTF-8 across chunk boundaries (a multibyte character can be split between packets)
#[derive(Default)]
struct Utf8Stream(Vec<u8>);

impl Utf8Stream {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.0.extend_from_slice(bytes);
        let valid = match std::str::from_utf8(&self.0) {
            Ok(_) => self.0.len(),
            Err(e) if e.error_len().is_none() => e.valid_up_to(),
            Err(_) => self.0.len(),
        };
        let rest = self.0.split_off(valid);
        let out = String::from_utf8_lossy(&self.0).into_owned();
        self.0 = rest;
        out
    }
}

#[tauri::command]
pub async fn ssh_open(session_id: String, host_id: String, cols: u32, rows: u32) {
    SESSIONS
        .lock()
        .unwrap()
        .insert(session_id.clone(), Session { size: (cols, rows), input: None, conn: None, stats: None, closed: false });
    status(&session_id, "connecting", None);
    let sid = session_id.clone();
    let log = Arc::new(move |msg: &str| data(&sid, format!("\x1b[90m{msg}\x1b[0m\r\n")));
    if let Err(e) = open(&session_id, &host_id, log).await {
        SESSIONS.lock().unwrap().remove(&session_id);
        status(&session_id, "error", Some(format!("{e:#}")));
    }
}

async fn open(session_id: &str, host_id: &str, log: crate::ssh::Log) -> anyhow::Result<()> {
    let conn = Arc::new(connect_host(host_id, log).await?);
    let size = {
        let mut map = SESSIONS.lock().unwrap();
        match map.get_mut(session_id) {
            Some(s) if !s.closed => {
                s.conn = Some(conn.clone());
                s.size
            }
            _ => {
                conn.close();
                return Ok(());
            }
        }
    };
    let ch = conn.handle.channel_open_session().await?;
    // Use the latest size: the terminal is often refitted (font loaded, panels) during the connection
    ch.request_pty(false, "xterm-256color", size.0, size.1, 0, 0, &[]).await?;
    ch.request_shell(true).await?;
    let (mut read, write) = ch.split();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let latest = {
        let mut map = SESSIONS.lock().unwrap();
        let Some(s) = map.get_mut(session_id) else {
            conn.close();
            return Ok(());
        };
        s.input = Some(tx);
        s.size
    };
    // A resize may have landed between the shell request and now
    if latest != size {
        let _ = write.window_change(latest.0, latest.1, 0, 0).await;
    }
    status(session_id, "connected", None);

    // Writer: keystrokes and resizes from the UI
    tokio::spawn(async move {
        let write: ChannelWriteHalf<Msg> = write;
        while let Some(msg) = rx.recv().await {
            match msg {
                Input::Data(d) => {
                    if write.data_bytes(d).await.is_err() {
                        break;
                    }
                }
                Input::Resize(c, r) => {
                    let _ = write.window_change(c, r, 0, 0).await;
                }
                Input::Close => {
                    let _ = write.close().await;
                    break;
                }
            }
        }
    });

    // Reader: shell output to the terminal
    let sid = session_id.to_string();
    let reader_conn = conn.clone();
    tokio::spawn(async move {
        let (mut out, mut err) = (Utf8Stream::default(), Utf8Stream::default());
        while let Some(msg) = read.wait().await {
            match msg {
                ChannelMsg::Data { data: d } => data(&sid, out.push(&d)),
                ChannelMsg::ExtendedData { data: d, .. } => data(&sid, err.push(&d)),
                ChannelMsg::Close => break,
                _ => {}
            }
        }
        reader_conn.close();
        let s = SESSIONS.lock().unwrap().remove(&sid);
        if let Some(s) = s {
            if let Some(t) = s.stats {
                t.abort();
            }
            if !s.closed {
                status(&sid, "closed", Some("Connection closed".into()));
            }
        }
    });

    // OS icon and startup snippet
    let host = store().find("hosts", host_id);
    if let Some(host) = host {
        if host["os"].as_str().is_none_or(str::is_empty) {
            let c = conn.clone();
            let hid = host_id.to_string();
            tokio::spawn(async move { detect_os(c, hid).await });
        }
        let snippet = host["startupSnippetId"].as_str().and_then(|id| store().find("snippets", id));
        if let Some(sn) = snippet {
            let script = sn["script"].as_str().unwrap_or_default().replace("\r\n", "\r").replace('\n', "\r") + "\r";
            send(session_id, Input::Data(script.into_bytes()));
        }
    }
    Ok(())
}

// Best-effort distro detection so the UI can show an OS icon
async fn detect_os(conn: Arc<Connection>, host_id: String) {
    let Ok((out, _, _)) = conn.exec("cat /etc/os-release 2>/dev/null || uname -s").await else { return };
    let id = out
        .lines()
        .find_map(|l| l.strip_prefix("ID="))
        .map(|v| v.trim_matches('"').to_string())
        .or_else(|| out.split_whitespace().next().map(String::from));
    let Some(id) = id.filter(|s| !s.is_empty()) else { return };
    let mut st = store();
    if let Some(mut host) = st.find("hosts", &host_id) {
        host["os"] = json!(id.to_lowercase());
        st.upsert("hosts", host);
        drop(st);
        notify_changed();
    }
}

fn send(session_id: &str, msg: Input) {
    if let Some(tx) = SESSIONS.lock().unwrap().get(session_id).and_then(|s| s.input.clone()) {
        let _ = tx.send(msg);
    }
}

#[tauri::command]
pub fn ssh_write(session_id: String, data: String) {
    send(&session_id, Input::Data(data.into_bytes()));
}

#[tauri::command]
pub fn ssh_resize(session_id: String, cols: u32, rows: u32) {
    if cols == 0 || rows == 0 {
        return;
    }
    if let Some(s) = SESSIONS.lock().unwrap().get_mut(&session_id) {
        s.size = (cols, rows);
    }
    send(&session_id, Input::Resize(cols, rows));
}

#[tauri::command]
pub fn ssh_close(session_id: String) {
    let Some(mut s) = SESSIONS.lock().unwrap().remove(&session_id) else { return };
    s.closed = true;
    if let Some(t) = s.stats.take() {
        t.abort();
    }
    if let Some(tx) = &s.input {
        let _ = tx.send(Input::Close);
    }
    if let Some(c) = &s.conn {
        c.close();
    }
}

// Status bar sampling: only while the tab is visible, one exec at a time on the session's connection
#[tauri::command]
pub fn ssh_stats(session_id: String, on: bool) {
    let mut map = SESSIONS.lock().unwrap();
    let Some(s) = map.get_mut(&session_id) else { return };
    if let Some(t) = s.stats.take() {
        t.abort();
    }
    let Some(conn) = s.conn.clone().filter(|_| on) else { return };
    s.stats = Some(tokio::spawn(async move {
        let mut prev: Option<CpuSample> = None;
        let mut first = true;
        loop {
            if let Ok((out, _, _)) = conn.exec(STATS_COMMAND).await {
                let (stats, sample) = parse_stats(&out, prev);
                prev = sample;
                emit("ssh:stats", json!({ "sessionId": session_id, "stats": stats }));
            }
            // A quick second sample so CPU % shows up without waiting a full interval
            tokio::time::sleep(Duration::from_millis(if first { 1500 } else { 5000 })).await;
            first = false;
        }
    }));
}

pub fn close_all() {
    for (_, s) in SESSIONS.lock().unwrap().drain() {
        if let Some(c) = s.conn {
            c.close();
        }
    }
}
