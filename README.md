![Version](https://img.shields.io/github/v/release/4ltena/mermaid-local-editor)
![License](https://img.shields.io/github/license/4ltena/mermaid-local-editor)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![HTML5 / CSS3](https://img.shields.io/badge/HTML5_%2F_CSS3-E34F26?logo=html5&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-24C8D8?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![Downloads](https://img.shields.io/github/downloads/4ltena/mermaid-local-editor/total?label=downloads)
![CI](https://img.shields.io/github/actions/workflow/status/4ltena/mermaid-local-editor/ci.yml?branch=main&label=CI)

# Mermaid Local Editor

完全ローカルで動く、クロスプラットフォームの Mermaid ダイアグラムエディタ
A fully local, cross-platform Mermaid diagram editor.

---

## 日本語 | [English](#english)

---

## 日本語

### これは何？
**完全ローカル・オフライン**で動く Mermaid 編集アプリです。Tauri v2 + Vite + TypeScript 製で、コードを書くと右側のプレビューに図がリアルタイムで描画されます。図の生成はすべて端末内で完結し、ネットワーク通信は行いません。

### 主な機能
- **ライブプレビュー** — CodeMirror エディタに入力すると、デバウンス付きで即座に再描画。構文エラーはパネル表示し、直前の正常な図は保持。
- **ダーク/ライト対応** — UI のダーク切替に図のテーマが連動し、ダーク時は矢印・文字が見える mermaid の `dark` テーマへ自動切替（`default`/`dark`/`forest`/`neutral` の手動選択も可）。
- **パン & ズーム** — ホイールズーム、ドラッグでパン、フィット表示。
- **配線とノードの手動調整** — フローチャートで配線に経由点を足し、ドラッグや矢印キーで動かせます。ノードも動かせて、つながる配線は端点を計算し直して追従します。配線は折れ線と自動曲線から選べ、調整結果は図ごとに保存されて画像出力にも反映されます。ノードをダブルクリックすると、その定義行へキャレットが移動します。
- **エクスポート** — Export ダイアログから SVG / PNG / WebP を書き出し（サイズは auto 倍率または custom px×px、縦横比固定）。コードのクリップボードコピーにも対応。
- **サンプル & 永続化** — 代表的な図種のサンプルを同梱。コード・テーマ・分割幅は `localStorage` に自動保存。
- **多言語UI** — 11言語（英語/日本語/繁体中文/简体中文/한국어/Français/Español/Deutsch/Português/Italiano/Русский）。ヘッダーのプルダウンで切替（初回は OS の言語に追従し、選択は保存）。
- **完全ローカル / オフライン** — mermaid・CodeMirror をバンドル。外部 CDN・fetch・トラッキングなし。
- **ハードニング** — `default-src 'none'` を基点とした CSP を適用し、外部オリジンへの接続を許しません。Webview へ渡す権限は `core:default` だけで、ファイル読み書きは Rust 側の専用コマンドを通し、ダイアログや最近使った項目でユーザーが選んだパスに限定します。

### 動作環境
- macOS / Windows / Linux（Arch / AlmaLinux / Ubuntu）
- 開発時: Node 24

### 開発・実行
```bash
npm install
npm run dev          # Tauri アプリを起動。レンダラは Vite の HMR が効きます
npm run dev:renderer # ブラウザだけで確認する場合
```

品質チェック:
```bash
npm run typecheck      # src と test の型検査
npm test               # vitest（純粋関数と jsdom による DOM テスト）
npm run build:renderer # vite build -> dist/
```

### パッケージ作成（各OS）
ネイティブアプリは**それぞれのOS上**でのみビルドできます。いずれも `tauri build` を呼びます。
```bash
npm run dist:mac   # universal の dmg（macOS で実行。Apple Silicon と Intel の両方に対応）
npm run dist:win   # nsis の exe（Windows で実行）
npm run dist:linux # AppImage, deb, rpm（Linux で実行）
```
出力先は `src-tauri/target/<target>/release/bundle/` です。

### リリース（CI/CD）
リリースはバージョンタグで GitHub Actions が生成します。
```bash
git tag v0.6.0
git push origin v0.6.0
```
アプリのバージョンはタグから決まります。CI がタグの値で `package.json` を書き換え、`src-tauri/tauri.conf.json` はそれを参照します。`src-tauri/Cargo.toml` の `version` だけは自動で追随しないため、手作業で合わせてください。

`.github/workflows/release.yml` が macOS の universal dmg、Windows の x64 と arm64 の nsis、Linux の AppImage と deb と rpm をビルドし、GitHub Releases へ公開します。Linux は Ubuntu 系が `.deb`、AlmaLinux 系が `.rpm` で、AppImage が全 distro 共通の保険です。現状のビルドは**未署名**です。

### 技術構成
- **シェル**: Tauri v2（`src-tauri/` の Rust 側でファイル入出力、パス承認、メニュー、確認ダイアログ、状態の保存を担当）
- **レンダラ**: Vite + TypeScript + CodeMirror 6 + mermaid 11（`src/`）。Rust 側とは Tauri の invoke とイベントでやり取りします。
- **ビルド/配布**: Vite（レンダラ）と Tauri CLI（各OSパッケージ）

### ライセンス
本プロジェクトは **Apache License 2.0** のもとで公開されています（© 2026 4ltena）。詳細は [LICENSE](LICENSE) を参照してください。

---

## English

### What is it?
A Mermaid editing app that runs **fully local and offline**. Built with Tauri v2 + Vite + TypeScript: type your diagram code and it renders live in the preview pane. All rendering happens on-device with no network access.

### Key Features
- **Live preview** — debounced re-render as you type in the CodeMirror editor; syntax errors show in a panel while the last valid diagram is kept.
- **Dark / light aware** — the diagram theme follows the UI theme, switching to mermaid's `dark` theme (visible arrows/text) in dark mode (`default`/`dark`/`forest`/`neutral` can also be chosen manually).
- **Pan & zoom** — wheel zoom, drag to pan, fit-to-view.
- **Manual edge and node adjustment** — in flowcharts, add route points to an edge and move them by dragging or with the arrow keys. Nodes can be moved too, and connected edges recompute their endpoints to follow. Edges draw as polylines or smooth curves; adjustments are stored per diagram and included in exported images. Double-clicking a node moves the caret to its definition line.
- **Export** — export SVG / PNG / WebP from the Export dialog (auto scale or custom px×px with aspect lock); copy the source to the clipboard too.
- **Samples & persistence** — bundled samples for common diagram types; code, theme, and split width are auto-saved to `localStorage`.
- **Multilingual UI** — 11 languages (English / 日本語 / 繁體中文 / 简体中文 / 한국어 / Français / Español / Deutsch / Português / Italiano / Русский), switched via the header dropdown (initial language follows the OS; the choice is saved).
- **Fully local / offline** — mermaid and CodeMirror are bundled; no external CDN, fetch, or tracking.
- **Hardened** — a CSP rooted at `default-src 'none'` that permits no external origin. The webview is granted only the `core:default` capability; file access goes through dedicated Rust commands and is limited to paths the user picked in a dialog or the recent-files list.

### Requirements
- macOS / Windows / Linux (Arch / AlmaLinux / Ubuntu)
- For development: Node 24

### Develop & Run
```bash
npm install
npm run dev          # launches the Tauri app; the renderer keeps Vite's HMR
npm run dev:renderer # renderer only, in a browser
```

Quality checks:
```bash
npm run typecheck      # type-checks src and test
npm test               # vitest (pure functions plus jsdom DOM tests)
npm run build:renderer # vite build -> dist/
```

### Packaging (per OS)
Native apps can only be built on their own OS. Each script calls `tauri build`.
```bash
npm run dist:mac   # universal dmg (run on macOS; Apple Silicon + Intel)
npm run dist:win   # nsis exe      (run on Windows)
npm run dist:linux # AppImage, deb, rpm (run on Linux)
```
Output lands in `src-tauri/target/<target>/release/bundle/`.

### Release (CI/CD)
Releases are produced by GitHub Actions on a version tag.
```bash
git tag v0.6.0
git push origin v0.6.0
```
The tag decides the app version: CI rewrites `package.json` from it and `src-tauri/tauri.conf.json` reads that file. Only `version` in `src-tauri/Cargo.toml` does not follow automatically, so bump it by hand.

`.github/workflows/release.yml` builds the macOS universal dmg, the Windows x64 and arm64 nsis installers, and the Linux AppImage, deb and rpm, then publishes them to GitHub Releases. On Linux, Ubuntu-family systems take the `.deb` and AlmaLinux-family systems the `.rpm`, with AppImage as the universal fallback. Builds are currently **unsigned**.

### Tech Stack
- **Shell**: Tauri v2 (`src-tauri/` — file I/O, path approval, menus, confirmation dialogs and state persistence in Rust)
- **Renderer**: Vite + TypeScript + CodeMirror 6 + mermaid 11 (`src/`), talking to Rust over Tauri's invoke and event APIs.
- **Build/Dist**: Vite for the renderer and the Tauri CLI for per-OS packages

### License
This project is licensed under the **Apache License 2.0** (© 2026 4ltena). See the [LICENSE](LICENSE) file for details.
