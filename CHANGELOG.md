# 変更履歴 / Changelog

[Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) 形式に概ね従い、[セマンティックバージョニング](https://semver.org/lang/ja/) を採用しています。
This file roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [0.6.0] — 2026-08-05

アプリの土台を Electron から Tauri v2 へ置き換え、フローチャートの配線とノードを手作業で調整する機能を追加した。

### 追加
- 配線に経由点を追加し、ドラッグと矢印キーで動かせるようにした。経由点はダブルクリックで削除する。折れ線モードでは Shift を押しながら動かすと、近い側の隣接点と水平になる位置へ揃う。
- 配線の描き方に折れ線と自動曲線の2種類を用意した。図全体の既定値と、配線ごとの指定を選べる。
- プレビュー上でノードを動かせるようにした。接続する配線は端点を計算し直して追従し、手動で置いた経由点はそのまま残る。手動補正のない配線は、他のノードを避ける経路へ引き直す。
- 選択した配線を現在のノード位置から引き直す操作と、配線、ノード、図全体それぞれのリセットを追加した。
- ノードをダブルクリックすると、Mermaid 入力欄の対応する定義位置へキャレットが移動する。文書と undo 履歴は変わらない。
- 調整結果は Mermaid ソースと図テーマの組ごとに保存し、同じ図を描き直したときに復元する。SVG、PNG、WebP の出力にも反映する。編集用のハンドルは出力に含まれない。

### 変更
- アプリの土台を Electron から Tauri v2 へ置き換えた。ファイル入出力、メニュー、確認ダイアログ、状態の保存を Rust 側へ移した。
- 配布形式を dmg、nsis、deb、rpm、AppImage の5種類にした。macOS の zip と Linux の pacman は生成しない。
- UI 文言を11言語へ拡張した。配線調整まわりを含め、全てのキーが全言語に揃っている。

### 削除
- Electron シェル一式。

### 検証
- 型検査、単体テスト、レンダラーのビルドが通ることを確認した。テストは9ファイル107件。
- Mermaid 11.15.0 が出力するノードの DOM ID、配線の `data-id` と `data-points`、配線ラベルの対応をテストで固定した。Mermaid を更新したときに黙って壊れるのではなく、テストが落ちるようにするため。
- クレートのバージョンを書き換えるスクリプトを、実際に子プロセスとして起動して検証した。タグと同じバージョンが既に manifest に入っている通常のリリース形も含む。
- 実アプリでノードと経由点の操作、拡大縮小との併用、3形式の出力を確認した。

### 備考
- アプリのバージョンをタグから決まるようにした。CI が `package.json` と `src-tauri/Cargo.toml` を書き換え、`src-tauri/tauri.conf.json` は `package.json` を参照する。
- CI が Rust シェルのビルドとテストも実行する。
- 全ロケールが同じキー集合を持つことをテストで固定した。`translate` は英語へフォールバックするため、欠落は表示上見えない。
- ビルドは未署名のまま。macOS の Gatekeeper と Windows の SmartScreen で警告が出る。

The app moved from Electron to Tauri v2, and flowchart edges and nodes can now be adjusted by hand.

### Added
- Route points can be added to an edge and moved by dragging or with the arrow keys; a double click removes one. In polyline mode, holding Shift aligns the point so that the segment towards the nearer neighbour becomes horizontal.
- Edges can be drawn as polylines or as smooth curves, set per diagram and overridable per edge.
- Nodes can be moved in the preview. Connected edges recompute their endpoints and follow, manual route points are kept, and edges without manual points are re-routed around the other nodes.
- Added an action that re-routes the selected edge from the current node positions, plus resets for one edge, one node, and the whole diagram.
- Double-clicking a node moves the caret to its definition in the Mermaid input. The document and the undo history are left alone.
- Adjustments are stored per Mermaid source and diagram theme, restored when the same diagram is rendered again, and included in SVG, PNG and WebP output. The editing handles are not exported.

### Changed
- Replaced the Electron shell with Tauri v2, moving file I/O, menus, confirmation dialogs and state persistence to Rust.
- Distribution formats are now dmg, nsis, deb, rpm and AppImage. The macOS zip and the Linux pacman package are no longer produced.
- Expanded the UI strings to 11 languages. Every key, including the edge-adjustment ones, is now defined in all of them.

### Removed
- The entire Electron shell.

### Verified
- Type-check, unit tests and the renderer build all pass; 107 tests across 9 files.
- Pinned the Mermaid 11.15.0 output contract in tests: node DOM IDs, edge `data-id` and `data-points`, and edge-label association, so a Mermaid upgrade fails the tests instead of breaking silently.
- Covered the crate-version rewrite script by running it as a real child process, including the ordinary release shape where the manifest already carries the version being tagged.
- Exercised node and route-point editing, zoom, and all three export formats in the real app.

### Notes
- The app version now derives from the tag: CI rewrites `package.json` and `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` reads `package.json`.
- CI now builds and tests the Rust shell as well.
- A test pins every locale to the same key set. `translate` falls back to English, so a gap would otherwise be invisible.
- Builds remain unsigned, so macOS Gatekeeper and Windows SmartScreen will warn.

## [0.5.1] — 2026-06-30

軽微な UX 修正と、CI 依存・テストの整備。

### 修正
- 言語を切り替えたとき、ウィンドウタイトルの「無題」表示が選択した言語に追従するようにした。
- ファイルを開いた直後にステータスが「描画完了」で上書きされ、「開きました」が見えなかった問題を修正。

### 備考
- GitHub Actions の依存を更新（actions/checkout 7・setup-node 6・upload-artifact 7・download-artifact 8、softprops/action-gh-release 3）。
- `path-resolver` のユニットテストをクロスプラットフォーム化し、Windows でも通過するようにした。

A small UX fix plus CI dependency and test housekeeping.

### Fixed
- The window title's "Untitled" label now follows the selected UI language when switching languages.
- Fixed the file-open status being immediately overwritten by "Rendered", so "Opened" now stays visible.

### Notes
- Updated GitHub Actions dependencies (actions/checkout 7, setup-node 6, upload-artifact 7, download-artifact 8, softprops/action-gh-release 3).
- Made the `path-resolver` unit tests cross-platform so they pass on Windows.

## [0.5.0] — 2026-06-30

ローカル `.mmd` ファイルの読み書きに対応。

### 追加
- ファイルの新規作成・開く・保存・名前を付けて保存（`Ctrl/Cmd+N`/`O`/`S`/`Shift+S`）。File メニューと、最近使った項目を開くサブメニュー。
- 未保存のまま新規・開く・終了しようとすると確認ダイアログ（保存／破棄／キャンセル）を表示。タイトルバーにファイル名と未保存マーク（`*`）。
- 起動時に前回開いていたファイルを再オープン。前回の終了時に未保存だった編集内容を復元。

### セキュリティ
- ファイル読み書きの IPC を、ダイアログや最近使った項目でユーザーが明示的に選んだパスだけに制限。

### 検証
- 型検査・本番ビルドが成功。本機能のユニットテスト（recent / document）も成功。

Local `.mmd` file read/write support.

### Added
- New / Open / Save / Save As (`Ctrl/Cmd+N`/`O`/`S`/`Shift+S`), a File menu, and an Open Recent submenu.
- A confirmation dialog (Save / Don't Save / Cancel) when creating, opening, or quitting with unsaved changes; the title bar shows the file name and an unsaved marker (`*`).
- Reopens the last file on startup and restores unsaved edits from the previous session.

### Security
- Restricted the file read/write IPC to paths the user explicitly chose via a dialog or the recent-files list.

### Verified
- Type-check and the production build pass; the feature's unit tests (recent / document) pass.

## [0.4.1] — 2026-06-29

UI の微調整と、言語切替の不具合修正。

### 修正
- 言語プルダウンがツールバーの overflow にクリップされて開かなかった不具合を修正（`position: fixed` 化）。v0.4.0 のリグレッション。

### 変更
- エクスポートの auto 選択時、px×px 欄を非表示にせず、出力寸法をグレー（無効）で表示する。
- コードのコピーをツールバーのボタンからエディタ右上のホバー式ボタン（押すと ✓）へ移動。

### 検証
- 型検査・ユニットテスト（17件）・本番ビルドがすべて成功。

UI polish and a language-switch bug fix.

### Fixed
- The language dropdown was clipped by the toolbar's overflow and would not open; switched it to `position: fixed`. (Regression from v0.4.0.)

### Changed
- In auto export mode, the px×px fields are shown disabled/grayed (a preview of the output size) instead of hidden.
- Moved code copy from a toolbar button to a hover button in the editor's top-right (shows ✓ on click).

### Verified
- Type-check, unit tests (17), and the production build all pass.

## [0.4.0] — 2026-06-29

エクスポートの刷新と多言語化。

### 追加
- 単一の Export ボタンとダイアログ。形式 SVG / PNG / WebP、サイズは auto（倍率 1×/2×/3×/任意 n×）または custom（px×px、チェーンで縦横比固定）。
- UI 言語を11に拡張（EN JA TW CN KR FR ES DE PT IT RU）。ヘッダーはカスタムプルダウン（トリガーは2文字コード、選択肢はコード+ネイティブ名）。

### 変更
- 旧 SVG / PNG ボタンを Export ダイアログへ統合。i18n の基準言語を en に（フォールバック en）。

### 備考
- 追加9言語の翻訳は機械翻訳ベース。ネイティブによる確認を推奨。

### 検証
- 型検査・ユニットテスト（17件）・本番ビルドがすべて成功。

Revamped export and broader localization.

### Added
- A single Export button and dialog: SVG / PNG / WebP, with auto size (scale 1×/2×/3× or a free n×) or custom px×px with an aspect-ratio lock.
- UI languages expanded to 11 (EN JA TW CN KR FR ES DE PT IT RU); the header uses a custom dropdown (a 2-letter code trigger, code+native-name options).

### Changed
- The old SVG / PNG buttons are folded into the Export dialog. The i18n base language is now en (fallback en).

### Notes
- The 9 added languages are machine-translated; native review is recommended.

### Verified
- Type-check, unit tests (17), and the production build all pass.

## [0.3.0] — 2026-06-29

エディタの挙動調整と、CI の供給網ハードニング。

### 変更
- UI 明暗トグルでの図テーマ自動連動を `default` ↔ `dark` のペアに限定。forest/neutral 等の明示選択は維持し、対象外では図を再描画しない。
- コードを手編集するとサンプル選択を「— 選択 —」へ戻す（同一サンプルの再読込も可能に）。
- 言語切替時に、表示中のステータス文言も新しい言語へ即時切替する。

### セキュリティ
- GitHub Actions を commit SHA でピン留めし、Dependabot（github-actions, weekly）で更新を追従する。

### 検証
- 型検査・ユニットテスト（11件）・本番ビルドがすべて成功。

Editor behavior tweaks and CI supply-chain hardening.

### Changed
- The UI light/dark toggle only swaps the paired `default` ↔ `dark` diagram themes; an explicit forest/neutral/etc. choice is preserved, and the diagram is not re-rendered when nothing changes.
- Editing the code resets the sample dropdown to "— Select —" (and lets you reload the same sample).
- Switching the language now also re-translates the currently shown status message.

### Security
- GitHub Actions are pinned to commit SHAs, with Dependabot (github-actions, weekly) tracking updates.

### Verified
- Type-check, unit tests (11), and the production build all pass.

## [0.2.0] — 2026-06-29

エディタの英語・日本語対応と、配布物（macOS universal / Windows arm64）の拡充。

### 追加
- 多言語UI（英語・日本語）。ヘッダーの `JA | EN` トグルで切替。初回は OS の言語に追従し、選択は localStorage に保存。UI 文言・ツールチップ・ステータス・サンプル名・ネイティブメニュー（独自ラベル）を翻訳。サンプル図のコードは日本語のまま。
- Windows arm64 ビルドを追加（`…-arm64.exe`）。Windows on ARM 向け。

### 変更
- macOS を universal 単一ビルドへ（Apple Silicon + Intel 両対応。従来は arm64 のみ）。
- リリースノートを CHANGELOG の抜き出し（日英併記）へ変更。
- ローカル作業用の `docs/superpowers/` を追跡対象外に。

### 検証
- 型検査・ユニットテスト（11件）・本番ビルドがすべて成功。

Editor localization (English/Japanese) and expanded distribution (macOS universal, Windows arm64).

### Added
- Bilingual UI (English/Japanese): a `JA | EN` toggle in the header. The initial language follows the OS and the choice is saved to localStorage. UI labels, tooltips, status messages, sample names, and the native menu (custom label) are translated; sample diagram code stays in Japanese.
- Windows arm64 build (`…-arm64.exe`) for Windows on ARM.

### Changed
- macOS is now a single universal build (Apple Silicon + Intel; previously arm64-only).
- Release notes are now a bilingual excerpt from the CHANGELOG.
- Stopped tracking the local-only `docs/superpowers/`.

### Verified
- Type-check, unit tests (11), and the production build all pass.

## [0.1.1] — 2026-06-29

サンプル選択ドロップダウンの表示を修正した版。

### 修正
- サンプルを選んだ後にドロップダウンが「— 選択 —」へ戻らず、読み込み中のサンプル名を表示し続けるようにした。以前は選択直後に選択値をリセットしていたため、どのサンプルを読み込んだか画面で確認できなかった。プレビューの描画は従来どおり動作する。

Fixes how the sample dropdown reflects the loaded sample.

### Fixed
- After picking a sample, the dropdown no longer resets to "— Select —" and keeps showing the loaded sample's name. Previously the value was cleared right after selection, so it was unclear which sample had been loaded. Diagram rendering is unchanged.

## [0.1.0] — 2026-06-29

デスクトップシェルを Tauri(Rust) から Electron(TypeScript) へ移行し、macOS / Windows / Linux（Arch / AlmaLinux / Ubuntu）対応のローカル Mermaid エディタとして整備した版。Web フロント（CodeMirror + mermaid）は再利用。

### 追加
- Electron シェル（main プロセス）。本番は独自 `app://` カスタムプロトコルでビルド済みレンダラを配信し、ES Modules と mermaid の動的 import（図種の遅延ロード）を完全オフラインで実行。
- セキュリティハードニング。本番ビルドへの厳格な CSP（`worker-src` 含む）、`contextIsolation` / `nodeIntegration:false` / `sandbox` を有効化。
- アプリメニュー（コピー・貼り付け・終了・ズーム等の標準ショートカット）と、SVG / PNG エクスポートの保存ダイアログ連携（`will-download`）。
- ダーク/ライト連動。UI テーマの切替に図テーマを連動させ、ダーク時は矢印・文字が見える mermaid `dark` テーマへ自動切替（ドロップダウンでの手動上書きも可）。
- 配色をミュートインディゴ基調へ変更（accent: light `#6366a8` / dark `#9a9de0`）。アプリアイコンも同系で生成。
- パッケージング。electron-builder による各OSターゲット（mac: dmg/zip、win: nsis、linux: AppImage/deb/rpm/pacman）。
- CI/CD。`v*` タグで GitHub Actions が全OSをビルドし GitHub Releases へ公開するリリースワークフローと、push / PR 時の型・テスト・ビルドチェック。
- テスト。レンダラのパス解決ユニットテスト（ディレクトリトラバーサル、クエリ・フラグメント、不正パーセントエンコードのガードを検証。vitest）。

### 変更
- デスクトップシェルを Tauri(Rust) から Electron(TypeScript) へ置換し、保守する言語を TypeScript に集約。
- 開発/本番の読み込みを electron-vite に統一（開発は `ELECTRON_RENDERER_URL`、本番は埋め込みレンダラを `app://` で読み込み）。

### 削除
- Tauri / Rust 一式（`src-tauri/`）と opener プラグイン。

### 検証
- 型検査・ユニットテスト（7件）・本番ビルドがすべて成功。
- macOS の `.app` を実起動し、描画・新配色・ダーク時の矢印表示・エクスポートを確認。

### 備考
- 現状ビルドは未署名（mac は Gatekeeper、win は SmartScreen の確認が出る場合あり）。
- Linux の rpm / pacman は CI（Linux ランナー）で生成。AppImage は全 distro 共通の保険。

Migrated the desktop shell from Tauri (Rust) to Electron (TypeScript), shaping it into a local Mermaid editor for macOS / Windows / Linux (Arch / AlmaLinux / Ubuntu). The web front end (CodeMirror + mermaid) is reused.

### Added
- Electron shell (main process). In production a custom `app://` protocol serves the built renderer so ES Modules and mermaid's dynamic imports (lazy-loaded diagram types) run fully offline.
- Security hardening: a strict CSP (including `worker-src`) on production builds; `contextIsolation` / `nodeIntegration:false` / `sandbox` enabled.
- Application menu (standard copy/paste/quit/zoom shortcuts) and a save dialog for SVG / PNG export (`will-download`).
- Dark/light coupling: the diagram theme follows the UI theme; in dark mode it switches to mermaid's `dark` theme (visible arrows/text), with manual override via the dropdown.
- Accent color changed to muted indigo (accent: light `#6366a8` / dark `#9a9de0`); the app icon matches.
- Packaging: per-OS electron-builder targets (mac: dmg/zip, win: nsis, linux: AppImage/deb/rpm/pacman).
- CI/CD: a release workflow that builds every OS on `v*` tags and publishes to GitHub Releases, plus type/test/build checks on push / PR.
- Tests: a renderer path-resolver unit test (guards against directory traversal, query/fragment, and malformed percent-encoding; vitest).

### Changed
- Replaced the desktop shell Tauri (Rust) with Electron (TypeScript), consolidating the maintained language to TypeScript.
- Unified dev/production loading on electron-vite (dev via `ELECTRON_RENDERER_URL`, production loading the embedded renderer over `app://`).

### Removed
- The entire Tauri / Rust setup (`src-tauri/`) and the opener plugin.

### Verified
- Type-check, unit tests (7), and the production build all pass.
- Launched the macOS `.app` and confirmed rendering, the new accent, dark-mode arrow visibility, and export.

### Notes
- Builds are currently unsigned (macOS Gatekeeper / Windows SmartScreen prompts may appear).
- Linux rpm / pacman are produced in CI (Linux runner); AppImage is the universal fallback.
