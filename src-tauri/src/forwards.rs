// Port forwarding: local (-L), dynamic SOCKS5 (-D) and remote (-R)

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use anyhow::{anyhow, bail};
use russh::client::Msg;
use russh::Channel;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tauri::async_runtime::JoinHandle;

use crate::ssh::{connect_host, no_log, Connection};
use crate::store::store;
use crate::util::{emit, Result};

struct Running {
    conn: Option<Arc<Connection>>,
    tasks: Vec<JoinHandle<()>>,
    connections: Arc<AtomicUsize>,
    state: String,
    message: Option<String>,
}

static RUNNING: LazyLock<Mutex<HashMap<String, Running>>> = LazyLock::new(Default::default);

fn status_json(id: &str, state: &str, message: Option<&str>, connections: usize) -> Value {
    json!({ "forwardId": id, "state": state, "message": message, "connections": connections })
}

fn broadcast(id: &str, state: &str, message: Option<String>) {
    let connections = {
        let mut map = RUNNING.lock().unwrap();
        match map.get_mut(id) {
            Some(r) => {
                r.state = state.to_string();
                r.message = message.clone();
                r.connections.load(Ordering::Relaxed)
            }
            None => 0,
        }
    };
    emit("forward:status", status_json(id, state, message.as_deref(), connections));
}

fn connections_changed(id: &str, counter: &AtomicUsize) {
    let (state, message) = {
        let map = RUNNING.lock().unwrap();
        match map.get(id) {
            Some(r) => (r.state.clone(), r.message.clone()),
            None => return,
        }
    };
    emit("forward:status", status_json(id, &state, message.as_deref(), counter.load(Ordering::Relaxed)));
}

// Pipe a local socket and an SSH channel until either side closes
fn pipe(id: String, mut sock: TcpStream, ch: Channel<Msg>, counter: Arc<AtomicUsize>) {
    tauri::async_runtime::spawn(async move {
        counter.fetch_add(1, Ordering::Relaxed);
        connections_changed(&id, &counter);
        let mut stream = ch.into_stream();
        let _ = tokio::io::copy_bidirectional(&mut sock, &mut stream).await;
        counter.fetch_sub(1, Ordering::Relaxed);
        connections_changed(&id, &counter);
    });
}

// Minimal SOCKS5 (no auth, CONNECT only) handshake; returns the requested destination
async fn socks_handshake(sock: &mut TcpStream) -> anyhow::Result<(String, u16)> {
    let mut head = [0u8; 2];
    sock.read_exact(&mut head).await?;
    if head[0] != 5 {
        bail!("Only SOCKS5 is supported");
    }
    let mut methods = vec![0u8; head[1] as usize];
    sock.read_exact(&mut methods).await?;
    sock.write_all(&[5, 0]).await?;
    let mut req = [0u8; 4];
    sock.read_exact(&mut req).await?;
    if req[0] != 5 || req[1] != 1 {
        sock.write_all(&[5, 7, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
        bail!("Unsupported SOCKS command");
    }
    let host = match req[3] {
        1 => {
            let mut a = [0u8; 4];
            sock.read_exact(&mut a).await?;
            std::net::Ipv4Addr::from(a).to_string()
        }
        3 => {
            let mut len = [0u8; 1];
            sock.read_exact(&mut len).await?;
            let mut name = vec![0u8; len[0] as usize];
            sock.read_exact(&mut name).await?;
            String::from_utf8_lossy(&name).into_owned()
        }
        4 => {
            let mut a = [0u8; 16];
            sock.read_exact(&mut a).await?;
            std::net::Ipv6Addr::from(a).to_string()
        }
        _ => bail!("Bad address type"),
    };
    let mut port = [0u8; 2];
    sock.read_exact(&mut port).await?;
    Ok((host, u16::from_be_bytes(port)))
}

fn field(f: &Value, k: &str) -> String {
    f[k].as_str().unwrap_or_default().to_string()
}

pub async fn start(id: &str) -> anyhow::Result<()> {
    let f = store().find("forwards", id).ok_or_else(|| anyhow!("Rule not found"))?;
    {
        let mut map = RUNNING.lock().unwrap();
        if map.contains_key(id) {
            return Ok(());
        }
        map.insert(
            id.to_string(),
            Running { conn: None, tasks: vec![], connections: Arc::new(AtomicUsize::new(0)), state: "starting".into(), message: None },
        );
    }
    broadcast(id, "starting", None);
    match run(id, &f).await {
        Ok(()) => {
            broadcast(id, "running", None);
            Ok(())
        }
        Err(e) => {
            stop(id);
            emit("forward:status", status_json(id, "error", Some(&format!("{e:#}")), 0));
            Err(e)
        }
    }
}

async fn run(id: &str, f: &Value) -> anyhow::Result<()> {
    let conn = Arc::new(connect_host(&field(f, "hostId"), no_log()).await?);
    let counter = {
        let mut map = RUNNING.lock().unwrap();
        let Some(r) = map.get_mut(id) else {
            conn.close();
            bail!("Stopped");
        };
        r.conn = Some(conn.clone());
        r.connections.clone()
    };
    let kind = field(f, "type");
    let bind_addr = Some(field(f, "bindAddress")).filter(|s| !s.is_empty()).unwrap_or_else(|| "127.0.0.1".into());
    let bind_port = f["bindPort"].as_u64().unwrap_or(0) as u16;
    let dest_addr = Some(field(f, "destAddress")).filter(|s| !s.is_empty()).unwrap_or_else(|| "localhost".into());
    let dest_port = f["destPort"].as_u64().unwrap_or(0) as u16;

    let task = if kind == "remote" {
        let (tx, mut rx) = mpsc::unbounded_channel();
        *conn.forwarded.lock().unwrap() = Some(tx);
        conn.handle.tcpip_forward(bind_addr, bind_port as u32).await?;
        let fid = id.to_string();
        tauri::async_runtime::spawn(async move {
            while let Some(ch) = rx.recv().await {
                if let Ok(sock) = TcpStream::connect((dest_addr.as_str(), dest_port)).await {
                    pipe(fid.clone(), sock, ch, counter.clone());
                }
            }
        })
    } else {
        let listener = TcpListener::bind((bind_addr.as_str(), bind_port)).await?;
        let dynamic = kind == "dynamic";
        let c = conn.clone();
        let fid = id.to_string();
        tauri::async_runtime::spawn(async move {
            while let Ok((mut sock, peer)) = listener.accept().await {
                let (c, fid, counter, dest_addr) = (c.clone(), fid.clone(), counter.clone(), dest_addr.clone());
                tauri::async_runtime::spawn(async move {
                    let dest = if dynamic { socks_handshake(&mut sock).await } else { Ok((dest_addr, dest_port)) };
                    let Ok((host, port)) = dest else { return };
                    match c.handle.channel_open_direct_tcpip(host, port as u32, peer.ip().to_string(), peer.port() as u32).await {
                        Ok(ch) => {
                            if dynamic {
                                let _ = sock.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await;
                            }
                            pipe(fid, sock, ch, counter);
                        }
                        Err(_) if dynamic => {
                            let _ = sock.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await;
                        }
                        Err(_) => {}
                    }
                });
            }
        })
    };

    // The forward dies with its SSH connection
    let fid = id.to_string();
    let watcher = tauri::async_runtime::spawn(async move {
        conn.closed().await;
        if RUNNING.lock().unwrap().contains_key(&fid) {
            stop(&fid);
            emit("forward:status", status_json(&fid, "error", Some("SSH connection closed"), 0));
        }
    });
    if let Some(r) = RUNNING.lock().unwrap().get_mut(id) {
        r.tasks.push(task);
        r.tasks.push(watcher);
    }
    Ok(())
}

pub fn stop(id: &str) {
    let Some(r) = RUNNING.lock().unwrap().remove(id) else { return };
    for t in r.tasks {
        t.abort();
    }
    if let Some(c) = r.conn {
        c.close();
    }
    emit("forward:status", status_json(id, "stopped", None, 0));
}

#[tauri::command]
pub async fn forward_start(id: String) -> Result<()> {
    Ok(start(&id).await?)
}

#[tauri::command]
pub fn forward_stop(id: String) {
    stop(&id)
}

#[tauri::command]
pub fn forward_statuses() -> Vec<Value> {
    RUNNING
        .lock()
        .unwrap()
        .iter()
        .map(|(id, r)| status_json(id, &r.state, r.message.as_deref(), r.connections.load(Ordering::Relaxed)))
        .collect()
}

pub fn auto_start() {
    let ids: Vec<String> = store()
        .list("forwards")
        .iter()
        .filter(|f| f["autoStart"].as_bool() == Some(true))
        .filter_map(|f| f["id"].as_str().map(String::from))
        .collect();
    for id in ids {
        tauri::async_runtime::spawn(async move {
            let _ = start(&id).await;
        });
    }
}

pub fn stop_all() {
    let ids: Vec<String> = RUNNING.lock().unwrap().keys().cloned().collect();
    for id in ids {
        stop(&id);
    }
}
