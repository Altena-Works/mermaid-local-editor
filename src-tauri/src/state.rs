use crate::recent::RecentState;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct AppState {
    pub approved: Mutex<HashSet<PathBuf>>,
    pub recent_state: Mutex<RecentState>,
    pub menu_locale: Mutex<String>,
    pub force_close: Mutex<bool>,
}
