use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn export_save(
    app: AppHandle,
    state: State<'_, AppState>,
    suggested_name: String,
    base64_data: String,
) -> Result<bool, String> {
    let bytes = STANDARD.decode(&base64_data).map_err(|e| e.to_string())?;

    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let suggested_name = suggested_name.clone();
        move || app.dialog().file().set_file_name(&suggested_name).blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(fp) = picked else { return Ok(false) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    state.approved.lock().unwrap().insert(path);
    Ok(true)
}
