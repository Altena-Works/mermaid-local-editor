use crate::state::AppState;
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
#[serde(untagged)]
pub enum FileReadResult {
    Content { content: String },
    Error { error: String },
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum FileWriteResult {
    Ok { ok: bool },
    Error { error: String },
}

/// Paths are always OS-dialog return values or entries from our own persisted
/// recent list (never free-form input from JS), so a direct PathBuf-equality
/// check is enough — no traversal-style normalization needed.
pub fn is_approved(approved: &HashSet<PathBuf>, path: &str) -> bool {
    approved.contains(&PathBuf::from(path))
}

#[tauri::command]
pub async fn dialog_open(app: AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .add_filter("Mermaid", &["mmd"])
                .add_filter("All Files", &["*"])
                .blocking_pick_file()
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    state.approved.lock().unwrap().insert(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn file_read(path: String, state: State<'_, AppState>) -> FileReadResult {
    if !is_approved(&state.approved.lock().unwrap(), &path) {
        return FileReadResult::Error { error: "Unauthorized path".to_string() };
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => FileReadResult::Content { content },
        Err(e) => FileReadResult::Error { error: e.to_string() },
    }
}

#[tauri::command]
pub async fn dialog_save(
    app: AppHandle,
    state: State<'_, AppState>,
    suggested_name: String,
) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        let suggested_name = suggested_name.clone();
        move || {
            app.dialog()
                .file()
                .add_filter("Mermaid", &["mmd"])
                .add_filter("All Files", &["*"])
                .set_file_name(&suggested_name)
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    state.approved.lock().unwrap().insert(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn file_write(path: String, content: String, state: State<'_, AppState>) -> FileWriteResult {
    if !is_approved(&state.approved.lock().unwrap(), &path) {
        return FileWriteResult::Error { error: "Unauthorized path".to_string() };
    }
    match std::fs::write(&path, content) {
        Ok(()) => FileWriteResult::Ok { ok: true },
        Err(e) => FileWriteResult::Error { error: e.to_string() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_a_path_not_in_the_approved_set() {
        let approved: HashSet<PathBuf> = HashSet::new();
        assert!(!is_approved(&approved, "/tmp/x.mmd"));
    }

    #[test]
    fn accepts_a_path_that_was_approved() {
        let mut approved: HashSet<PathBuf> = HashSet::new();
        approved.insert(PathBuf::from("/tmp/x.mmd"));
        assert!(is_approved(&approved, "/tmp/x.mmd"));
    }
}
