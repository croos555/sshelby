// SFTP sessions, remote file editing, transfers, and the local file pane

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use serde_json::{json, Value};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tauri::async_runtime::JoinHandle;

use crate::ssh::{connect_host, no_log, Connection};
use crate::util::{app, emit, uuid, Result};

struct Sftp {
    // Owner pane + open editors / external edits; the connection closes when this drops to 0
    refs: usize,
    conn: Arc<Connection>,
    sftp: Arc<SftpSession>,
    // Temp copies opened in local apps and their watchers, removed with the session
    temp_dirs: Vec<PathBuf>,
    watchers: Vec<JoinHandle<()>>,
}

static SFTPS: LazyLock<Mutex<HashMap<String, Sftp>>> = LazyLock::new(Default::default);
static CANCELLED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

const S_IFMT: u32 = 0o170000;
const S_IFDIR: u32 = 0o040000;
const S_IFLNK: u32 = 0o120000;
const MAX_EDIT_BYTES: u64 = 5 * 1024 * 1024;
const CHUNK: usize = 64 * 1024;

fn get(id: &str) -> anyhow::Result<Arc<SftpSession>> {
    SFTPS.lock().unwrap().get(id).map(|s| s.sftp.clone()).ok_or_else(|| anyhow!("SFTP session is not open"))
}

fn is_dir(a: &FileAttributes) -> bool {
    a.permissions.is_some_and(|m| m & S_IFMT == S_IFDIR)
}

fn join_remote(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

fn base_name(path: &str) -> String {
    path.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

fn cleanup(s: &mut Sftp) {
    for w in s.watchers.drain(..) {
        w.abort();
    }
    for d in s.temp_dirs.drain(..) {
        let _ = std::fs::remove_dir_all(d);
    }
}

// ---------- remote ----------

#[tauri::command]
pub async fn sftp_open(sftp_id: String, host_id: String) -> Result<String> {
    let conn = Arc::new(connect_host(&host_id, no_log()).await?);
    let ch = conn.handle.channel_open_session().await?;
    ch.request_subsystem(true, "sftp").await?;
    let sftp = Arc::new(SftpSession::new(ch.into_stream()).await?);
    let home = sftp.canonicalize(".").await?;
    SFTPS.lock().unwrap().insert(
        sftp_id.clone(),
        Sftp { refs: 1, conn: conn.clone(), sftp, temp_dirs: vec![], watchers: vec![] },
    );
    tauri::async_runtime::spawn(async move {
        conn.closed().await;
        let s = SFTPS.lock().unwrap().remove(&sftp_id);
        if let Some(mut s) = s {
            cleanup(&mut s);
            emit("sftp:closed", sftp_id);
        }
    });
    Ok(home)
}

#[tauri::command]
pub fn sftp_close(sftp_id: String) {
    let mut map = SFTPS.lock().unwrap();
    let Some(s) = map.get_mut(&sftp_id) else { return };
    s.refs = s.refs.saturating_sub(1);
    if s.refs > 0 {
        return;
    }
    let mut s = map.remove(&sftp_id).unwrap();
    cleanup(&mut s);
    s.conn.close();
}

#[tauri::command]
pub fn sftp_retain(sftp_id: String) {
    if let Some(s) = SFTPS.lock().unwrap().get_mut(&sftp_id) {
        s.refs += 1;
    }
}

async fn read_remote(sftp: &SftpSession, path: &str) -> anyhow::Result<(Vec<u8>, u32)> {
    let st = sftp.metadata(path).await?;
    if is_dir(&st) {
        bail!("This is a folder");
    }
    let size = st.size.unwrap_or(0);
    if size > MAX_EDIT_BYTES {
        bail!("File is too large to edit here ({} MB, max 5 MB)", size / 1_048_576);
    }
    Ok((sftp.read(path).await?, st.mtime.unwrap_or(0)))
}

async fn write_remote(sftp: &SftpSession, path: &str, data: &[u8]) -> anyhow::Result<()> {
    let mut f = sftp.open_with_flags(path, OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE).await?;
    f.write_all(data).await?;
    f.shutdown().await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_read_text(sftp_id: String, path: String) -> Result<Value> {
    let (data, mtime) = read_remote(&*get(&sftp_id)?, &path).await?;
    // NUL bytes in the first 8 KB: treat as binary
    if data.iter().take(8192).any(|b| *b == 0) {
        crate::bail!("Binary file: open it with a local app instead");
    }
    Ok(json!({ "content": String::from_utf8_lossy(&data), "mtime": mtime }))
}

// expectedMtime guards against overwriting a change made on the server since the file was opened
#[tauri::command]
pub async fn sftp_write_text(sftp_id: String, path: String, content: String, expected_mtime: Option<u32>) -> Result<Value> {
    let sftp = get(&sftp_id)?;
    if let (Ok(st), Some(expected)) = (sftp.metadata(&path).await, expected_mtime) {
        if st.mtime != Some(expected) {
            crate::bail!("CONFLICT: the file was modified on the server after you opened it");
        }
    }
    // Truncating an existing file keeps its permissions
    write_remote(&sftp, &path, content.as_bytes()).await?;
    let after = sftp.metadata(&path).await?;
    Ok(json!({ "mtime": after.mtime.unwrap_or(0) }))
}

// Download to a temp folder, open with the system's default app, upload back on every save
#[tauri::command]
pub async fn sftp_open_external(sftp_id: String, path: String) -> Result<String> {
    let sftp = get(&sftp_id)?;
    let (data, _) = read_remote(&sftp, &path).await?;
    let dir = std::env::temp_dir().join(format!("sshelby-edit-{}", uuid()));
    tokio::fs::create_dir_all(&dir).await?;
    let local = dir.join(base_name(&path));
    tokio::fs::write(&local, &data).await?;
    let watched = local.clone();
    let remote = path.clone();
    // Polling keeps this portable; editors often write in several steps, so wait for the file to settle
    let watcher = tauri::async_runtime::spawn(async move {
        let mut last = data;
        loop {
            tokio::time::sleep(Duration::from_millis(800)).await;
            let Ok(now) = tokio::fs::read(&watched).await else { continue };
            if now == last {
                continue;
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
            let Ok(settled) = tokio::fs::read(&watched).await else { continue };
            if settled != now {
                continue;
            }
            last = settled;
            match write_remote(&sftp, &remote, &last).await {
                Ok(()) => emit("sftp:externalSaved", json!({ "path": remote, "ok": true })),
                Err(e) => emit("sftp:externalSaved", json!({ "path": remote, "ok": false, "error": format!("{e:#}") })),
            }
        }
    });
    if let Some(s) = SFTPS.lock().unwrap().get_mut(&sftp_id) {
        s.temp_dirs.push(dir);
        s.watchers.push(watcher);
    }
    app().opener().open_path(local.to_string_lossy(), None::<&str>)?;
    Ok(local.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn sftp_list(sftp_id: String, dir: String) -> Result<Vec<Value>> {
    let sftp = get(&sftp_id)?;
    let mut out = Vec::new();
    for entry in sftp.read_dir(&dir).await? {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let attrs = entry.metadata();
        let mode = attrs.permissions.unwrap_or(0);
        let full = join_remote(&dir, &name);
        let is_symlink = mode & S_IFMT == S_IFLNK;
        let mut dir_flag = mode & S_IFMT == S_IFDIR;
        if is_symlink {
            // Follow links so directories behind them are browsable
            if let Ok(st) = sftp.metadata(&full).await {
                dir_flag = is_dir(&st);
            }
        }
        out.push(json!({
            "name": name,
            "path": full,
            "isDir": dir_flag,
            "isSymlink": is_symlink,
            "size": attrs.size.unwrap_or(0),
            "mtime": attrs.mtime.unwrap_or(0) as u64 * 1000,
            "mode": mode
        }));
    }
    Ok(out)
}

#[tauri::command]
pub async fn sftp_realpath(sftp_id: String, path: String) -> Result<String> {
    Ok(get(&sftp_id)?.canonicalize(path).await?)
}

#[tauri::command]
pub async fn sftp_mkdir(sftp_id: String, path: String) -> Result<()> {
    Ok(get(&sftp_id)?.create_dir(path).await?)
}

#[tauri::command]
pub async fn sftp_rename(sftp_id: String, from: String, to: String) -> Result<()> {
    Ok(get(&sftp_id)?.rename(from, to).await?)
}

#[tauri::command]
pub async fn sftp_chmod(sftp_id: String, path: String, mode: u32) -> Result<()> {
    let attrs = FileAttributes { permissions: Some(mode), ..FileAttributes::empty() };
    Ok(get(&sftp_id)?.set_metadata(path, attrs).await?)
}

fn remote_remove<'a>(sftp: &'a SftpSession, path: String) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send + 'a>> {
    Box::pin(async move {
        let st = sftp.symlink_metadata(&path).await?;
        if is_dir(&st) {
            for e in sftp.read_dir(&path).await? {
                let name = e.file_name();
                if name != "." && name != ".." {
                    remote_remove(sftp, join_remote(&path, &name)).await?;
                }
            }
            sftp.remove_dir(&path).await?;
        } else {
            sftp.remove_file(&path).await?;
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn sftp_delete(sftp_id: String, paths: Vec<String>) -> Result<()> {
    let sftp = get(&sftp_id)?;
    for p in paths {
        remote_remove(&sftp, p).await?;
    }
    Ok(())
}

// ---------- transfers ----------

struct Progress {
    t: Value,
    last: Instant,
}

impl Progress {
    fn new(sftp_id: &str, direction: &str, sources: &[String]) -> Self {
        let name = if sources.len() == 1 { base_name(&sources[0]) } else { format!("{} items", sources.len()) };
        let t = json!({
            "transferId": uuid(), "sftpId": sftp_id, "direction": direction, "name": name,
            "transferred": 0, "total": 0, "status": "running"
        });
        emit("sftp:transfer", t.clone());
        Progress { t, last: Instant::now() }
    }
    fn id(&self) -> String {
        self.t["transferId"].as_str().unwrap_or_default().to_string()
    }
    fn add_total(&mut self, n: u64) {
        self.t["total"] = json!(self.t["total"].as_u64().unwrap_or(0) + n);
    }
    fn advance(&mut self, n: u64) -> anyhow::Result<()> {
        self.t["transferred"] = json!(self.t["transferred"].as_u64().unwrap_or(0) + n);
        if self.last.elapsed() > Duration::from_millis(100) {
            self.last = Instant::now();
            emit("sftp:transfer", self.t.clone());
        }
        if CANCELLED.lock().unwrap().contains(&self.id()) {
            bail!("Cancelled");
        }
        Ok(())
    }
    fn finish(mut self, res: anyhow::Result<()>) {
        let id = self.id();
        let cancelled = CANCELLED.lock().unwrap().remove(&id);
        match res {
            Ok(()) => self.t["status"] = json!(if cancelled { "cancelled" } else { "done" }),
            Err(e) => {
                self.t["status"] = json!(if cancelled { "cancelled" } else { "error" });
                self.t["error"] = json!(format!("{e:#}"));
            }
        }
        emit("sftp:transfer", self.t);
    }
}

fn local_size(path: &Path) -> u64 {
    match std::fs::metadata(path) {
        Ok(m) if m.is_dir() => std::fs::read_dir(path)
            .map(|rd| rd.flatten().map(|e| local_size(&e.path())).sum())
            .unwrap_or(0),
        Ok(m) => m.len(),
        Err(_) => 0,
    }
}

fn remote_size<'a>(sftp: &'a SftpSession, path: String) -> std::pin::Pin<Box<dyn std::future::Future<Output = u64> + Send + 'a>> {
    Box::pin(async move {
        let Ok(st) = sftp.metadata(&path).await else { return 0 };
        if !is_dir(&st) {
            return st.size.unwrap_or(0);
        }
        let mut total = 0;
        if let Ok(rd) = sftp.read_dir(&path).await {
            for e in rd {
                let name = e.file_name();
                if name != "." && name != ".." {
                    total += remote_size(sftp, join_remote(&path, &name)).await;
                }
            }
        }
        total
    })
}

fn put<'a>(sftp: &'a SftpSession, src: PathBuf, dest: String, p: &'a mut Progress) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send + 'a>> {
    Box::pin(async move {
        p.advance(0)?;
        if tokio::fs::metadata(&src).await?.is_dir() {
            let _ = sftp.create_dir(&dest).await;
            let mut rd = tokio::fs::read_dir(&src).await?;
            while let Some(e) = rd.next_entry().await? {
                let name = e.file_name().to_string_lossy().into_owned();
                put(sftp, e.path(), join_remote(&dest, &name), p).await?;
            }
            return Ok(());
        }
        let mut local = tokio::fs::File::open(&src).await?;
        let mut remote = sftp.create(&dest).await?;
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = local.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            remote.write_all(&buf[..n]).await?;
            p.advance(n as u64)?;
        }
        remote.shutdown().await?;
        Ok(())
    })
}

fn fetch<'a>(sftp: &'a SftpSession, src: String, dest: PathBuf, p: &'a mut Progress) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send + 'a>> {
    Box::pin(async move {
        p.advance(0)?;
        let st = sftp.metadata(&src).await?;
        if is_dir(&st) {
            tokio::fs::create_dir_all(&dest).await?;
            for e in sftp.read_dir(&src).await? {
                let name = e.file_name();
                if name != "." && name != ".." {
                    fetch(sftp, join_remote(&src, &name), dest.join(&name), p).await?;
                }
            }
            return Ok(());
        }
        let mut remote = sftp.open(&src).await?;
        let mut local = tokio::fs::File::create(&dest).await?;
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = remote.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            local.write_all(&buf[..n]).await?;
            p.advance(n as u64)?;
        }
        local.flush().await?;
        Ok(())
    })
}

#[tauri::command]
pub fn sftp_upload(sftp_id: String, local_paths: Vec<String>, remote_dir: String) -> Result<String> {
    let sftp = get(&sftp_id)?;
    let mut p = Progress::new(&sftp_id, "upload", &local_paths);
    let id = p.id();
    tauri::async_runtime::spawn(async move {
        for lp in &local_paths {
            p.add_total(local_size(Path::new(lp)));
        }
        let mut res = Ok(());
        for lp in &local_paths {
            res = put(&sftp, PathBuf::from(lp), join_remote(&remote_dir, &base_name(lp)), &mut p).await;
            if res.is_err() {
                break;
            }
        }
        p.finish(res);
    });
    Ok(id)
}

#[tauri::command]
pub fn sftp_download(sftp_id: String, remote_paths: Vec<String>, local_dir: String) -> Result<String> {
    let sftp = get(&sftp_id)?;
    let mut p = Progress::new(&sftp_id, "download", &remote_paths);
    let id = p.id();
    tauri::async_runtime::spawn(async move {
        for rp in &remote_paths {
            let n = remote_size(&sftp, rp.clone()).await;
            p.add_total(n);
        }
        let mut res = Ok(());
        for rp in &remote_paths {
            res = fetch(&sftp, rp.clone(), Path::new(&local_dir).join(base_name(rp)), &mut p).await;
            if res.is_err() {
                break;
            }
        }
        p.finish(res);
    });
    Ok(id)
}

#[tauri::command]
pub fn sftp_cancel(transfer_id: String) {
    CANCELLED.lock().unwrap().insert(transfer_id);
}

pub fn close_all() {
    for (_, mut s) in SFTPS.lock().unwrap().drain() {
        cleanup(&mut s);
        s.conn.close();
    }
}

// ---------- local ----------

#[tauri::command]
pub fn local_home() -> String {
    dirs::home_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

#[tauri::command]
pub fn local_list(dir: String) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir)?.flatten() {
        let path = e.path();
        // Unreadable entries (permissions, broken mounts) are skipped
        let Ok(lst) = std::fs::symlink_metadata(&path) else { continue };
        let st = if lst.file_type().is_symlink() { std::fs::metadata(&path).unwrap_or(lst.clone()) } else { lst.clone() };
        let mtime = st
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        #[cfg(unix)]
        let mode = std::os::unix::fs::PermissionsExt::mode(&st.permissions());
        #[cfg(not(unix))]
        let mode = if st.is_dir() { 0o040755 } else { 0o100644 };
        out.push(json!({
            "name": e.file_name().to_string_lossy(),
            "path": path.to_string_lossy(),
            "isDir": st.is_dir(),
            "isSymlink": lst.file_type().is_symlink(),
            "size": st.len(),
            "mtime": mtime,
            "mode": mode
        }));
    }
    Ok(out)
}

#[tauri::command]
pub fn local_parent(path: String) -> String {
    Path::new(&path).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or(path)
}

#[tauri::command]
pub fn local_join(parts: Vec<String>) -> String {
    let mut p = PathBuf::new();
    for part in parts {
        p.push(part);
    }
    p.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn local_mkdir(path: String) -> Result<()> {
    Ok(std::fs::create_dir(path)?)
}

#[tauri::command]
pub fn local_rename(from: String, to: String) -> Result<()> {
    Ok(std::fs::rename(from, to)?)
}

#[tauri::command]
pub fn local_delete(paths: Vec<String>) -> Result<()> {
    Ok(trash::delete_all(paths)?)
}

#[tauri::command]
pub fn local_open(path: String) -> Result<String> {
    app().opener().open_path(path, None::<&str>)?;
    Ok(String::new())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String> {
    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<()> {
    Ok(std::fs::write(path, content)?)
}
