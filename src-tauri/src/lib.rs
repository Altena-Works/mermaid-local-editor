use tauri::{Emitter, Manager};

mod commands;
mod dialogs;
mod export;
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
            files::dialog_open,
            files::file_read,
            files::dialog_save,
            files::file_write,
            export::export_save,
            dialogs::confirm_unsaved,
            commands::startup_path,
            commands::set_active_doc,
            commands::set_title,
            commands::remove_recent,
            commands::allow_close,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = handle.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let recent_state = recent::load_state(&data_dir.join("mle-state.json"));

            {
                let app_state = handle.state::<state::AppState>();
                let mut approved = app_state.approved.lock().unwrap();
                for p in recent_state.recent.iter().chain(recent_state.last_path.iter()) {
                    approved.insert(std::path::PathBuf::from(p));
                }
                *app_state.recent_state.lock().unwrap() = recent_state;
            }

            let locale = menu::resolve_locale();
            *handle.state::<state::AppState>().menu_locale.lock().unwrap() = locale.clone();

            let recent = handle.state::<state::AppState>().recent_state.lock().unwrap().recent.clone();
            let menu = menu::build_menu(&handle, cfg!(debug_assertions), &locale, &recent)?;
            app.set_menu(menu)?;
            app.on_menu_event(menu::handle_menu_event);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<state::AppState>();
                let force_close = *state.force_close.lock().unwrap();
                if force_close {
                    return;
                }
                api.prevent_close();
                let _ = window.emit("command", serde_json::json!({ "type": "close-request" }));
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
