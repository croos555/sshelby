// Sshelby backend: SSH, SFTP, forwarding and the local vault, exposed to the React UI as Tauri
// commands (snake_case) and events ("area:name"); see src/renderer/src/tauri-api.ts.

mod agent;
mod forwards;
mod importers;
mod keys;
mod prompts;
mod secrets;
mod sessions;
mod sftp;
mod ssh;
mod stats;
mod store;
mod transfer;
mod util;

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::Manager;

// Keep the splash up long enough not to flash
const SPLASH_MIN: Duration = Duration::from_millis(900);
static STARTED: OnceLock<Instant> = OnceLock::new();

// The UI has rendered: swap the splash for the main window, then auto-start forwards
// (they may need the UI to answer host-key / password prompts)
#[tauri::command]
async fn app_ready(app: tauri::AppHandle) {
    let elapsed = STARTED.get().map(Instant::elapsed).unwrap_or(SPLASH_MIN);
    tokio::time::sleep(SPLASH_MIN.saturating_sub(elapsed)).await;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    forwards::auto_start();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            STARTED.get_or_init(Instant::now);
            util::set_app(app.handle().clone());
            store::store().load();
            // Never leave the user with only a splash if the UI fails to report that it rendered
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(8)).await;
                if let Some(splash) = handle.get_webview_window("splash") {
                    let _ = splash.close();
                    if let Some(main) = handle.get_webview_window("main") {
                        let _ = main.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            store::vault_get,
            store::vault_upsert,
            store::vault_remove,
            store::vault_settings,
            store::vault_storage_info,
            importers::vault_import_ssh_config,
            importers::vault_import_moba,
            prompts::prompt_respond,
            agent::agent_list,
            agent::agent_path_cmd,
            keys::keys_generate,
            keys::keys_inspect,
            keys::keys_install_on_host,
            sessions::ssh_open,
            sessions::ssh_write,
            sessions::ssh_resize,
            sessions::ssh_close,
            sessions::ssh_stats,
            sftp::sftp_open,
            sftp::sftp_close,
            sftp::sftp_retain,
            sftp::sftp_read_text,
            sftp::sftp_write_text,
            sftp::sftp_open_external,
            sftp::sftp_list,
            sftp::sftp_realpath,
            sftp::sftp_mkdir,
            sftp::sftp_rename,
            sftp::sftp_chmod,
            sftp::sftp_delete,
            sftp::sftp_upload,
            sftp::sftp_download,
            sftp::sftp_cancel,
            sftp::local_home,
            sftp::local_list,
            sftp::local_parent,
            sftp::local_join,
            sftp::local_mkdir,
            sftp::local_rename,
            sftp::local_delete,
            sftp::local_open,
            sftp::read_text_file,
            sftp::write_text_file,
            forwards::forward_start,
            forwards::forward_stop,
            forwards::forward_statuses,
            transfer::transfer_preview,
            transfer::transfer_export,
            transfer::transfer_check,
            transfer::transfer_inspect,
            transfer::transfer_import,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                sessions::close_all();
                sftp::close_all();
                forwards::stop_all();
            }
        });
}
