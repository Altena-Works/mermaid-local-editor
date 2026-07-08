use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct RecentState {
    pub recent: Vec<String>,
    #[serde(rename = "lastPath")]
    pub last_path: Option<String>,
}

/// Most-recent-first, de-duplicated, capped at `max`.
pub fn add_recent(list: &[String], path: &str, max: usize) -> Vec<String> {
    let mut out = vec![path.to_string()];
    out.extend(list.iter().filter(|p| p.as_str() != path).cloned());
    out.truncate(max);
    out
}

/// Defensive load: any read/parse failure, or a non-array `recent`/non-string
/// `lastPath`, falls back to an empty state rather than propagating an error
/// (mirrors `electron/recent.ts`'s `try { ... } catch { return default }`).
pub fn load_state(path: &Path) -> RecentState {
    let raw = fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok());
    let Some(raw) = raw else {
        return RecentState::default();
    };
    let recent = raw
        .get("recent")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let last_path = raw.get("lastPath").and_then(|v| v.as_str()).map(str::to_string);
    RecentState { recent, last_path }
}

/// Best-effort; a write failure must not crash the app.
pub fn save_state(path: &Path, state: &RecentState) {
    if let Ok(json) = serde_json::to_string(state) {
        let _ = fs::write(path, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepends_a_new_path() {
        let list = vec!["a".to_string(), "b".to_string()];
        assert_eq!(add_recent(&list, "c", 10), vec!["c", "a", "b"]);
    }

    #[test]
    fn moves_an_existing_path_to_the_front_without_duplicating() {
        let list = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        assert_eq!(add_recent(&list, "b", 10), vec!["b", "a", "c"]);
    }

    #[test]
    fn caps_the_list_at_max_dropping_the_oldest() {
        let list = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        assert_eq!(add_recent(&list, "d", 3), vec!["d", "a", "b"]);
    }
}
