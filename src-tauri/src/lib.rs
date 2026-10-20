// Sshelby, Tauri build: Rust backend behind the same renderer as the Electron build.
// Command and event names mirror the Electron IPC channels (see src/renderer/src/tauri-api.ts).

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

#[tauri::command]
fn app_ready() {
    // Auto-start forwards once the UI can answer host-key / password prompts
    forwards::auto_start();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            util::set_app(app.handle().clone());
            store::store().load();
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
