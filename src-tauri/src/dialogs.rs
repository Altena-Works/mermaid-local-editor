use rfd::{AsyncMessageDialog, MessageButtons, MessageDialogResult, MessageLevel};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ConfirmLabels {
    pub message: String,
    pub save: String,
    pub discard: String,
    pub cancel: String,
}

#[tauri::command]
pub async fn confirm_unsaved(filename: String, labels: ConfirmLabels) -> Result<String, String> {
    let result = AsyncMessageDialog::new()
        .set_title(&filename)
        .set_description(&labels.message)
        .set_level(MessageLevel::Warning)
        .set_buttons(MessageButtons::YesNoCancelCustom(
            labels.save.clone(),
            labels.discard.clone(),
            labels.cancel.clone(),
        ))
        .show()
        .await;

    Ok(match result {
        MessageDialogResult::Custom(label) if label == labels.save => "save".to_string(),
        MessageDialogResult::Custom(label) if label == labels.discard => "discard".to_string(),
        _ => "cancel".to_string(),
    })
}
