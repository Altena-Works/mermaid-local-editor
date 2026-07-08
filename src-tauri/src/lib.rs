mod dialogs;
mod files;
mod menu;
mod recent;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            dialogs::confirm_unsaved,
            files::dialog_open,
            files::file_read,
            files::dialog_save,
            files::file_write,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
