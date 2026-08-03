use crate::menu;
use crate::recent::{add_recent, save_state};
use crate::state::AppState;
use tauri::{AppHandle, Manager, State};

const RECENT_MAX: usize = 10;

fn state_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("mle-state.json"))
}

fn rebuild_menu(app: &AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    let is_dev = cfg!(debug_assertions);
    let locale = state.menu_locale.lock().unwrap().clone();
    let recent = state.recent_state.lock().unwrap().recent.clone();
    let menu = menu::build_menu(app, is_dev, &locale, &recent).map_err(|e| e.to_string())?;
    app.set_menu(menu).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn startup_path(state: State<'_, AppState>) -> Option<String> {
    state.recent_state.lock().unwrap().last_path.clone()
}

#[tauri::command]
pub fn set_active_doc(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
    add_to_recent: bool,
) -> Result<(), String> {
    {
        let mut rs = state.recent_state.lock().unwrap();
        rs.last_path = path.clone();
        if add_to_recent {
            if let Some(p) = &path {
                rs.recent = add_recent(&rs.recent, p, RECENT_MAX);
            }
        }
    }
    if add_to_recent && path.is_some() {
        rebuild_menu(&app, &state)?;
    }
    let sp = state_path(&app)?;
    save_state(&sp, &state.recent_state.lock().unwrap());
    Ok(())
}

#[tauri::command]
pub fn set_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_recent(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<(), String> {
    {
        let mut rs = state.recent_state.lock().unwrap();
        rs.recent.retain(|p| p != &path);
        if rs.last_path.as_deref() == Some(path.as_str()) {
            rs.last_path = None;
        }
    }
    rebuild_menu(&app, &state)?;
    let sp = state_path(&app)?;
    save_state(&sp, &state.recent_state.lock().unwrap());
    Ok(())
}

#[tauri::command]
pub fn allow_close(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    *state.force_close.lock().unwrap() = true;
    if let Some(window) = app.get_webview_window("main") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
