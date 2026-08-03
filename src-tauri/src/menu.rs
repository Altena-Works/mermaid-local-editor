use crate::state::AppState;
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

struct MenuLabels {
    file: &'static str,
    new: &'static str,
    open: &'static str,
    save: &'static str,
    save_as: &'static str,
    open_recent: &'static str,
    recent_empty: &'static str,
    view: &'static str,
}

fn labels_for(locale: &str) -> MenuLabels {
    match locale {
        "ja" => MenuLabels { file: "ファイル", new: "新規", open: "開く…", save: "保存", save_as: "名前を付けて保存…", open_recent: "最近使った項目を開く", recent_empty: "最近使った項目なし", view: "表示" },
        "zh-TW" => MenuLabels { file: "檔案", new: "新增", open: "開啟…", save: "儲存", save_as: "另存新檔…", open_recent: "開啟最近的檔案", recent_empty: "沒有最近的檔案", view: "檢視" },
        "zh-CN" => MenuLabels { file: "文件", new: "新建", open: "打开…", save: "保存", save_as: "另存为…", open_recent: "打开最近的文件", recent_empty: "没有最近的文件", view: "视图" },
        "ko" => MenuLabels { file: "파일", new: "새로 만들기", open: "열기…", save: "저장", save_as: "다른 이름으로 저장…", open_recent: "최근 파일 열기", recent_empty: "최근 파일 없음", view: "보기" },
        "fr" => MenuLabels { file: "Fichier", new: "Nouveau", open: "Ouvrir…", save: "Enregistrer", save_as: "Enregistrer sous…", open_recent: "Ouvrir récent", recent_empty: "Aucun fichier récent", view: "Affichage" },
        "es" => MenuLabels { file: "Archivo", new: "Nuevo", open: "Abrir…", save: "Guardar", save_as: "Guardar como…", open_recent: "Abrir reciente", recent_empty: "Sin archivos recientes", view: "Ver" },
        "de" => MenuLabels { file: "Datei", new: "Neu", open: "Öffnen…", save: "Speichern", save_as: "Speichern unter…", open_recent: "Zuletzt geöffnet", recent_empty: "Keine zuletzt verwendeten Dateien", view: "Ansicht" },
        "pt" => MenuLabels { file: "Arquivo", new: "Novo", open: "Abrir…", save: "Salvar", save_as: "Salvar como…", open_recent: "Abrir recente", recent_empty: "Nenhum arquivo recente", view: "Visualizar" },
        "it" => MenuLabels { file: "File", new: "Nuovo", open: "Apri…", save: "Salva", save_as: "Salva con nome…", open_recent: "Apri recenti", recent_empty: "Nessun file recente", view: "Visualizza" },
        "ru" => MenuLabels { file: "Файл", new: "Создать", open: "Открыть…", save: "Сохранить", save_as: "Сохранить как…", open_recent: "Открыть недавние", recent_empty: "Нет недавних файлов", view: "Вид" },
        _ => MenuLabels { file: "File", new: "New", open: "Open…", save: "Save", save_as: "Save As…", open_recent: "Open Recent", recent_empty: "No recent files", view: "View" },
    }
}

/// Mirrors `electron/main.ts`'s `app.getLocale()`-based normalization. Resolved
/// once at startup; the native menu language does not track later in-app
/// language switches (same behavior as the Electron version).
pub fn resolve_locale() -> String {
    let os = sys_locale::get_locale().unwrap_or_default().to_lowercase();
    if os.starts_with("zh") {
        if os.contains("tw") || os.contains("hant") || os.contains("hk") || os.contains("mo") {
            "zh-TW"
        } else {
            "zh-CN"
        }
    } else if os.starts_with("ja") {
        "ja"
    } else if os.starts_with("ko") {
        "ko"
    } else if os.starts_with("fr") {
        "fr"
    } else if os.starts_with("es") {
        "es"
    } else if os.starts_with("de") {
        "de"
    } else if os.starts_with("pt") {
        "pt"
    } else if os.starts_with("it") {
        "it"
    } else if os.starts_with("ru") {
        "ru"
    } else {
        "en"
    }
    .to_string()
}

pub fn build_menu(app: &AppHandle, is_dev: bool, locale: &str, recent: &[String]) -> tauri::Result<Menu<Wry>> {
    let l = labels_for(locale);
    let is_mac = cfg!(target_os = "macos");

    let recent_items: Vec<_> = if recent.is_empty() {
        vec![MenuItemBuilder::new(l.recent_empty).enabled(false).build(app)?]
    } else {
        recent
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let name = std::path::Path::new(p)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| p.clone());
                MenuItemBuilder::with_id(format!("recent:{i}"), name).build(app)
            })
            .collect::<Result<_, _>>()?
    };
    let mut recent_builder = SubmenuBuilder::new(app, l.open_recent);
    for item in &recent_items {
        recent_builder = recent_builder.item(item);
    }
    let recent_submenu = recent_builder.build()?;

    let new_item = MenuItemBuilder::with_id("file-new", l.new).accelerator("CmdOrCtrl+N").build(app)?;
    let open_item = MenuItemBuilder::with_id("file-open", l.open).accelerator("CmdOrCtrl+O").build(app)?;
    let save_item = MenuItemBuilder::with_id("file-save", l.save).accelerator("CmdOrCtrl+S").build(app)?;
    let save_as_item = MenuItemBuilder::with_id("file-save-as", l.save_as).accelerator("CmdOrCtrl+Shift+S").build(app)?;

    let mut file_builder = SubmenuBuilder::new(app, l.file)
        .item(&new_item)
        .item(&open_item)
        .item(&recent_submenu)
        .separator()
        .item(&save_item)
        .item(&save_as_item)
        .separator();
    file_builder = if is_mac {
        file_builder.item(&PredefinedMenuItem::close_window(app, None)?)
    } else {
        file_builder.item(&PredefinedMenuItem::quit(app, None)?)
    };
    let file_menu = file_builder.build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let reset_zoom = MenuItemBuilder::with_id("view-zoom-reset", "Reset Zoom").build(app)?;
    let zoom_in = MenuItemBuilder::with_id("view-zoom-in", "Zoom In").build(app)?;
    let zoom_out = MenuItemBuilder::with_id("view-zoom-out", "Zoom Out").build(app)?;
    let mut view_builder = SubmenuBuilder::new(app, l.view).item(&reset_zoom).item(&zoom_in).item(&zoom_out);
    let toggle_devtools_item;
    let reload_item;
    if is_dev {
        toggle_devtools_item = MenuItemBuilder::with_id("view-toggle-devtools", "Toggle Developer Tools").build(app)?;
        reload_item = MenuItemBuilder::with_id("view-reload", "Reload").build(app)?;
        view_builder = view_builder.separator().item(&toggle_devtools_item).item(&reload_item);
    }
    let view_menu = view_builder.build()?;

    let window_menu = if is_mac {
        SubmenuBuilder::new(app, "Window")
            .item(&PredefinedMenuItem::minimize(app, None)?)
            .item(&PredefinedMenuItem::fullscreen(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::bring_all_to_front(app, None)?)
            .build()?
    } else {
        SubmenuBuilder::new(app, "Window")
            .item(&PredefinedMenuItem::minimize(app, None)?)
            .item(&PredefinedMenuItem::close_window(app, None)?)
            .build()?
    };

    let app_menu_item = if is_mac {
        Some(
            SubmenuBuilder::new(app, "Mermaid Local Editor")
                .item(&PredefinedMenuItem::about(app, None, None)?)
                .separator()
                .item(&PredefinedMenuItem::services(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::hide(app, None)?)
                .item(&PredefinedMenuItem::hide_others(app, None)?)
                .item(&PredefinedMenuItem::show_all(app, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, None)?)
                .build()?,
        )
    } else {
        None
    };

    let mut top_items: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = Vec::new();
    if let Some(ref m) = app_menu_item {
        top_items.push(m);
    }
    top_items.push(&file_menu);
    top_items.push(&edit_menu);
    top_items.push(&view_menu);
    top_items.push(&window_menu);
    tauri::menu::MenuBuilder::new(app).items(&top_items).build()
}

pub fn handle_menu_event(app_handle: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().0.as_str();
    let emit = |t: &str| {
        let _ = app_handle.emit("command", serde_json::json!({ "type": t }));
    };
    match id {
        "file-new" => emit("new"),
        "file-open" => emit("open"),
        "file-save" => emit("save"),
        "file-save-as" => emit("save-as"),
        "view-zoom-in" => emit("zoom-in"),
        "view-zoom-out" => emit("zoom-out"),
        "view-zoom-reset" => emit("zoom-reset"),
        "view-toggle-devtools" => {
            if let Some(w) = app_handle.get_webview_window("main") {
                w.open_devtools();
            }
        }
        "view-reload" => {
            if let Some(w) = app_handle.get_webview_window("main") {
                let _ = w.eval("location.reload()");
            }
        }
        id if id.starts_with("recent:") => {
            if let Ok(idx) = id["recent:".len()..].parse::<usize>() {
                let state = app_handle.state::<AppState>();
                let path = state.recent_state.lock().unwrap().recent.get(idx).cloned();
                if let Some(path) = path {
                    let _ = app_handle.emit("command", serde_json::json!({ "type": "open-recent", "path": path }));
                }
            }
        }
        _ => {}
    }
}
