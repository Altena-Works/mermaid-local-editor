import "./styles.css";
import { CodeEditor } from "./editor";
import {
  configureMermaid,
  renderMermaid,
  svgIntrinsicSize,
  type MermaidTheme,
} from "./mermaid-render";
import { exportDiagram, lockedCounterpart } from "./export";
import { SAMPLES, DEFAULT_CODE } from "./samples";
import { detectInitialLocale, applyDom, getLocale, setLocale, t, LOCALES } from "./i18n";
import type { Locale } from "./i18n";
import { DocumentManager, type DocHost } from "./document";
import { createTauriBridge, onCommand, allowClose } from "./tauri-bridge";

// ---------- persisted state ----------
const LS = {
  code: "mle.code",
  theme: "mle.theme",
  ui: "mle.uiTheme",
  split: "mle.split",
  docPath: "mle.docPath",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const els = {
  editor: $("editor"),
  viewport: $<HTMLDivElement>("preview-viewport"),
  canvas: $<HTMLDivElement>("preview-canvas"),
  errorPanel: $<HTMLDivElement>("error-panel"),
  status: $("status-text"),
  sampleSelect: $<HTMLSelectElement>("sample-select"),
  themeSelect: $<HTMLSelectElement>("theme-select"),
  split: $<HTMLDivElement>("split"),
  gutter: $<HTMLDivElement>("gutter"),
  editorPane: document.querySelector<HTMLElement>(".pane--editor")!,
  btnZoomIn: $("btn-zoom-in"),
  btnZoomOut: $("btn-zoom-out"),
  btnZoomReset: $("btn-zoom-reset"),
  editorCopy: $<HTMLButtonElement>("editor-copy"),
  btnExport: $("btn-export"),
  expDialog: $<HTMLDivElement>("export-dialog"),
  expCustomRow: $<HTMLDivElement>("exp-custom-row"),
  expScaleRow: $<HTMLDivElement>("exp-scale-row"),
  expW: $<HTMLInputElement>("exp-w"),
  expH: $<HTMLInputElement>("exp-h"),
  expScaleN: $<HTMLInputElement>("exp-scale-n"),
  expLock: $<HTMLButtonElement>("exp-lock"),
  expRun: $("exp-run"),
  btnThemeUi: $("btn-theme-ui"),
  btnLang: $("btn-lang"),
  langMenu: $<HTMLUListElement>("lang-menu"),
};

// ---------- i18n ----------
detectInitialLocale();
document.documentElement.lang = getLocale();
applyDom();

// ---------- UI (light/dark) theme ----------
function applyUiTheme(dark: boolean): void {
  document.documentElement.dataset.uiTheme = dark ? "dark" : "light";
  els.btnThemeUi.textContent = dark ? "☀️" : "🌙";
}

let uiDark = localStorage.getItem(LS.ui) === "dark";
applyUiTheme(uiDark);

// ---------- pan & zoom ----------
class PanZoom {
  scale = 1;
  tx = 0;
  ty = 0;
  private panning = false;
  private startX = 0;
  private startY = 0;

  constructor(
    private viewport: HTMLElement,
    private canvas: HTMLElement,
    private onChange: () => void,
  ) {
    viewport.addEventListener("wheel", this.onWheel, { passive: false });
    viewport.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
  }

  apply(): void {
    this.canvas.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    this.onChange();
  }

  reset(): void {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.apply();
  }

  /** Fit the canvas content centered in the viewport. */
  fit(contentW: number, contentH: number): void {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    if (!contentW || !contentH || !vw || !vh) {
      this.reset();
      return;
    }
    const margin = 0.92;
    this.scale = Math.min((vw / contentW) * margin, (vh / contentH) * margin, 1);
    this.tx = (vw - contentW * this.scale) / 2;
    this.ty = (vh - contentH * this.scale) / 2;
    this.apply();
  }

  zoomBy(factor: number, cx?: number, cy?: number): void {
    const rect = this.viewport.getBoundingClientRect();
    const px = cx ?? rect.width / 2;
    const py = cy ?? rect.height / 2;
    const next = Math.min(8, Math.max(0.1, this.scale * factor));
    // keep the point under the cursor fixed
    this.tx = px - (px - this.tx) * (next / this.scale);
    this.ty = py - (py - this.ty) * (next / this.scale);
    this.scale = next;
    this.apply();
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.panning = true;
    this.startX = e.clientX - this.tx;
    this.startY = e.clientY - this.ty;
    this.viewport.classList.add("is-panning");
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.panning) return;
    this.tx = e.clientX - this.startX;
    this.ty = e.clientY - this.startY;
    this.apply();
  };

  private onUp = (): void => {
    if (!this.panning) return;
    this.panning = false;
    this.viewport.classList.remove("is-panning");
  };
}

const panzoom = new PanZoom(els.viewport, els.canvas, () => {
  els.btnZoomReset.textContent = `${Math.round(panzoom.scale * 100)}%`;
});

// ---------- rendering ----------
let currentTheme =
  (localStorage.getItem(LS.theme) as MermaidTheme) ||
  (uiDark ? "dark" : "default");
els.themeSelect.value = currentTheme;
configureMermaid(currentTheme);

let lastGoodSize: { w: number; h: number } | null = null;
let renderToken = 0;
let lastStatusKey: string | null = null;

/** Set the status bar from an i18n key and remember it, so it can be
 *  re-translated when the language changes. */
function setStatus(key: string): void {
  lastStatusKey = key;
  els.status.textContent = t(key);
}

function showError(msg: string): void {
  els.errorPanel.hidden = false;
  els.errorPanel.textContent = msg;
  setStatus("status.syntaxError");
}

function clearError(): void {
  els.errorPanel.hidden = true;
  els.errorPanel.textContent = "";
}

async function render(code: string, refit: boolean): Promise<void> {
  const token = ++renderToken;
  try {
    const { svg } = await renderMermaid(code);
    if (token !== renderToken) return; // a newer render superseded us
    clearError();
    els.canvas.innerHTML = svg;
    const svgEl = els.canvas.querySelector("svg");
    if (svgEl) {
      const size = svgIntrinsicSize(svgEl as SVGSVGElement);
      svgEl.setAttribute("width", String(size.w));
      svgEl.setAttribute("height", String(size.h));
      svgEl.style.maxWidth = "none";
      if (refit || !lastGoodSize) panzoom.fit(size.w, size.h);
      lastGoodSize = size;
    }
    setStatus("status.rendered");
  } catch (err) {
    if (token !== renderToken) return;
    const msg = err instanceof Error ? err.message : String(err);
    showError(msg);
  }
}

// ---------- editor ----------
let debounceTimer: number | undefined;
let loadingSample = false;
function scheduleRender(code: string): void {
  // A manual edit means the loaded sample no longer matches; clear the dropdown.
  // Skipped while a sample is being loaded programmatically (see the change handler).
  if (!loadingSample) els.sampleSelect.value = "";
  window.clearTimeout(debounceTimer);
  setStatus("status.typing");
  debounceTimer = window.setTimeout(() => {
    localStorage.setItem(LS.code, code);
    void render(code, false);
  }, 280);
}

let doc: DocumentManager;

const initialCode = localStorage.getItem(LS.code) ?? DEFAULT_CODE;

const editor = new CodeEditor({
  parent: els.editor,
  initialDoc: initialCode,
  dark: uiDark,
  onChange: (code) => {
    scheduleRender(code);
    doc.onEdit();
  },
});

// ---------- samples ----------
for (const s of SAMPLES) {
  const opt = document.createElement("option");
  opt.value = s.id;
  opt.textContent = s.label[getLocale()] ?? s.label.en;
  els.sampleSelect.appendChild(opt);
}
els.sampleSelect.addEventListener("change", () => {
  const s = SAMPLES.find((x) => x.id === els.sampleSelect.value);
  if (s) {
    loadingSample = true;
    editor.setValue(s.code);
    loadingSample = false;
    void render(s.code, true);
    localStorage.setItem(LS.code, s.code);
  }
  // Leave the chosen option selected so the dropdown reflects which sample is
  // currently loaded (do not reset it back to the "— 選択 —" placeholder).
});

// ---------- language dropdown ----------
function relabelSamples(): void {
  for (const opt of Array.from(els.sampleSelect.options)) {
    const s = SAMPLES.find((x) => x.id === opt.value);
    if (s) opt.textContent = s.label[getLocale()] ?? s.label.en;
  }
}

function updateLangButton(): void {
  const loc = getLocale();
  const cur = LOCALES.find((l) => l.code === loc);
  const codeEl = els.btnLang.querySelector<HTMLElement>(".lang-code");
  if (codeEl && cur) codeEl.textContent = cur.short;
  els.langMenu.querySelectorAll<HTMLElement>(".lang-item").forEach((li) => {
    li.setAttribute("aria-selected", String(li.dataset.locale === loc));
  });
}

function openLangMenu(): void {
  // position:fixed + JS placement so the toolbar's overflow clipping can't hide it.
  const r = els.btnLang.getBoundingClientRect();
  els.langMenu.style.top = `${Math.round(r.bottom + 4)}px`;
  els.langMenu.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  els.langMenu.style.left = "auto";
  els.langMenu.hidden = false;
  els.btnLang.setAttribute("aria-expanded", "true");
}
function closeLangMenu(): void {
  els.langMenu.hidden = true;
  els.btnLang.setAttribute("aria-expanded", "false");
}

function buildLangMenu(): void {
  els.langMenu.replaceChildren();
  for (const l of LOCALES) {
    const li = document.createElement("li");
    li.className = "lang-item";
    li.setAttribute("role", "option");
    li.dataset.locale = l.code;
    li.textContent = `${l.short} ${l.name}`;
    li.addEventListener("click", () => {
      setLocale(l.code as Locale);
      relabelSamples();
      updateLangButton();
      if (lastStatusKey) els.status.textContent = t(lastStatusKey);
      doc.refreshTitle();
      closeLangMenu();
    });
    els.langMenu.appendChild(li);
  }
}

buildLangMenu();
updateLangButton();

els.btnLang.addEventListener("click", (e) => {
  e.stopPropagation();
  if (els.langMenu.hidden) openLangMenu();
  else closeLangMenu();
});
window.addEventListener("click", () => closeLangMenu());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLangMenu();
});
window.addEventListener("resize", () => closeLangMenu());
els.langMenu.addEventListener("click", (e) => e.stopPropagation());

// ---------- theme select ----------
els.themeSelect.addEventListener("change", () => {
  currentTheme = els.themeSelect.value as MermaidTheme;
  localStorage.setItem(LS.theme, currentTheme);
  configureMermaid(currentTheme);
  void render(editor.getValue(), false);
});

// ---------- toolbar buttons ----------
els.btnZoomIn.addEventListener("click", () => panzoom.zoomBy(1.2));
els.btnZoomOut.addEventListener("click", () => panzoom.zoomBy(1 / 1.2));
els.btnZoomReset.addEventListener("click", () => {
  if (lastGoodSize) panzoom.fit(lastGoodSize.w, lastGoodSize.h);
  else panzoom.reset();
});

els.editorCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(editor.getValue());
    els.editorCopy.classList.add("is-copied");
    window.setTimeout(() => els.editorCopy.classList.remove("is-copied"), 1500);
  } catch {
    setStatus("status.copyFailed");
  }
});

function currentSvg(): SVGSVGElement | null {
  return els.canvas.querySelector("svg");
}

// ---------- export dialog ----------
const EXP = {
  fmt: "mle.exportFormat",
  mode: "mle.exportSizeMode",
  scale: "mle.exportScale",
  lock: "mle.exportLock",
};

function expIntrinsic(): { w: number; h: number } {
  const svg = currentSvg();
  if (!svg) return { w: 0, h: 0 };
  return svgIntrinsicSize(svg);
}

function expScaleValue(): number {
  const sel = els.expDialog.querySelector<HTMLInputElement>('input[name="exp-scale"]:checked');
  if (sel && sel.value !== "n") return Number(sel.value);
  return Math.max(1, Math.min(10, Number(els.expScaleN.value) || 1));
}

function expFillCustomFromAuto(): void {
  const { w, h } = expIntrinsic();
  const s = expScaleValue();
  els.expW.value = String(Math.max(1, Math.round(w * s)));
  els.expH.value = String(Math.max(1, Math.round(h * s)));
}

function expSyncRows(): void {
  const mode =
    els.expDialog.querySelector<HTMLInputElement>('input[name="exp-size"]:checked')?.value ?? "auto";
  const auto = mode !== "custom";
  els.expScaleRow.hidden = !auto;
  // The px×px row stays visible; in auto it is shown disabled and dimmed
  // (a preview of the dimensions auto will produce). In custom it is editable.
  els.expCustomRow.classList.toggle("is-disabled", auto);
  els.expW.disabled = auto;
  els.expH.disabled = auto;
  els.expLock.disabled = auto;
}

function expLocked(): boolean {
  return els.expLock.classList.contains("is-locked");
}

function openExportDialog(): void {
  if (!currentSvg()) {
    setStatus("status.noRender");
    return;
  }
  const fmt = localStorage.getItem(EXP.fmt) ?? "svg";
  const fmtEl = els.expDialog.querySelector<HTMLInputElement>(`input[name="exp-format"][value="${fmt}"]`);
  if (fmtEl) fmtEl.checked = true;
  const mode = localStorage.getItem(EXP.mode) ?? "auto";
  const modeEl = els.expDialog.querySelector<HTMLInputElement>(`input[name="exp-size"][value="${mode}"]`);
  if (modeEl) modeEl.checked = true;
  const scale = localStorage.getItem(EXP.scale) ?? "2";
  const preset = els.expDialog.querySelector<HTMLInputElement>(`input[name="exp-scale"][value="${scale}"]`);
  if (preset) preset.checked = true;
  else {
    const nEl = els.expDialog.querySelector<HTMLInputElement>('input[name="exp-scale"][value="n"]');
    if (nEl) nEl.checked = true;
    els.expScaleN.value = scale;
  }
  els.expLock.classList.toggle("is-locked", localStorage.getItem(EXP.lock) !== "0");
  els.expLock.setAttribute("aria-pressed", String(expLocked()));
  expSyncRows();
  expFillCustomFromAuto();
  els.expDialog.hidden = false;
}

function closeExportDialog(): void {
  els.expDialog.hidden = true;
}

els.btnExport.addEventListener("click", openExportDialog);
els.expDialog.querySelectorAll<HTMLElement>("[data-close]").forEach((el) =>
  el.addEventListener("click", closeExportDialog),
);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.expDialog.hidden) closeExportDialog();
});
els.expDialog
  .querySelectorAll<HTMLInputElement>('input[name="exp-size"], input[name="exp-scale"]')
  .forEach((el) =>
    el.addEventListener("change", () => {
      expSyncRows();
      expFillCustomFromAuto();
    }),
  );
els.expScaleN.addEventListener("input", () => {
  // Editing the n× field implies the n× preset, even if the radio wasn't clicked
  // (clicking the nested number input does not activate the label's radio).
  const nRadio = els.expDialog.querySelector<HTMLInputElement>('input[name="exp-scale"][value="n"]');
  if (nRadio) nRadio.checked = true;
  expFillCustomFromAuto();
});

els.expLock.addEventListener("click", () => {
  const locked = !expLocked();
  els.expLock.classList.toggle("is-locked", locked);
  els.expLock.setAttribute("aria-pressed", String(locked));
});

els.expW.addEventListener("input", () => {
  if (!expLocked()) return;
  els.expH.value = String(lockedCounterpart("w", Number(els.expW.value) || 0, expIntrinsic()));
});
els.expH.addEventListener("input", () => {
  if (!expLocked()) return;
  els.expW.value = String(lockedCounterpart("h", Number(els.expH.value) || 0, expIntrinsic()));
});

els.expRun.addEventListener("click", async () => {
  const svg = currentSvg();
  if (!svg) {
    setStatus("status.noRender");
    closeExportDialog();
    return;
  }
  const format = (els.expDialog.querySelector<HTMLInputElement>('input[name="exp-format"]:checked')?.value ??
    "svg") as "svg" | "png" | "webp";
  const mode =
    els.expDialog.querySelector<HTMLInputElement>('input[name="exp-size"]:checked')?.value ?? "auto";
  const intrinsic = expIntrinsic();
  let width: number;
  let height: number;
  if (mode === "custom") {
    width = Number(els.expW.value) || intrinsic.w;
    height = Number(els.expH.value) || intrinsic.h;
  } else {
    const s = expScaleValue();
    width = intrinsic.w * s;
    height = intrinsic.h * s;
  }
  localStorage.setItem(EXP.fmt, format);
  localStorage.setItem(EXP.mode, mode);
  localStorage.setItem(EXP.scale, String(expScaleValue()));
  localStorage.setItem(EXP.lock, expLocked() ? "1" : "0");
  closeExportDialog();
  setStatus("status.exporting");
  try {
    await exportDiagram(svg, { format, width, height });
    setStatus("status.exported");
  } catch (e) {
    lastStatusKey = null;
    els.status.textContent = e instanceof Error ? e.message : t("status.exportFailed");
  }
});

els.btnThemeUi.addEventListener("click", () => {
  uiDark = !uiDark;
  localStorage.setItem(LS.ui, uiDark ? "dark" : "light");
  applyUiTheme(uiDark);
  editor.setDark(uiDark);
  // Only swap the paired default<->dark diagram themes with the UI theme; leave
  // forest/neutral/etc. untouched so an explicit choice is preserved.
  const next: MermaidTheme | null = uiDark
    ? currentTheme === "default"
      ? "dark"
      : null
    : currentTheme === "dark"
      ? "default"
      : null;
  if (next) {
    currentTheme = next;
    els.themeSelect.value = currentTheme;
    localStorage.setItem(LS.theme, currentTheme);
    configureMermaid(currentTheme);
    void render(editor.getValue(), false);
  }
});

// ---------- split gutter resize ----------
(function setupGutter() {
  const saved = localStorage.getItem(LS.split);
  if (saved) els.editorPane.style.flexBasis = saved;

  let dragging = false;
  els.gutter.addEventListener("pointerdown", (e) => {
    dragging = true;
    els.gutter.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = els.split.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const clamped = Math.min(0.8, Math.max(0.15, ratio));
    const basis = `${(clamped * 100).toFixed(2)}%`;
    els.editorPane.style.flexBasis = basis;
    localStorage.setItem(LS.split, basis);
  });
  window.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = "";
  });
})();

// ---------- keyboard shortcuts ----------
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === "=" || e.key === "+") {
    e.preventDefault();
    panzoom.zoomBy(1.2);
  } else if (e.key === "-") {
    e.preventDefault();
    panzoom.zoomBy(1 / 1.2);
  } else if (e.key === "0") {
    e.preventDefault();
    if (lastGoodSize) panzoom.fit(lastGoodSize.w, lastGoodSize.h);
  }
});

// ---------- document / file management ----------
const host: DocHost = {
  getEditorContent: () => editor.getValue(),
  applyContent: (text) => {
    loadingSample = true;
    editor.setValue(text);
    loadingSample = false;
    els.sampleSelect.value = "";
    return render(text, true);
  },
  setStatus,
  persist: (code, path) => {
    localStorage.setItem(LS.code, code);
    if (path) localStorage.setItem(LS.docPath, path);
    else localStorage.removeItem(LS.docPath);
  },
  loadDraft: () => ({
    code: localStorage.getItem(LS.code),
    path: localStorage.getItem(LS.docPath),
  }),
  t,
  defaultContent: DEFAULT_CODE,
};

doc = new DocumentManager(createTauriBridge(), host);

onCommand((payload) => {
  switch (payload.type) {
    case "new":
      void doc.newDoc();
      break;
    case "open":
      void doc.open();
      break;
    case "save":
      void doc.save();
      break;
    case "save-as":
      void doc.saveAs();
      break;
    case "open-recent":
      if (payload.path) void doc.openRecent(payload.path);
      break;
    case "close-request":
      void doc.handleCloseRequest(() => void allowClose());
      break;
    case "zoom-in":
      els.btnZoomIn.click();
      break;
    case "zoom-out":
      els.btnZoomOut.click();
      break;
    case "zoom-reset":
      els.btnZoomReset.click();
      break;
  }
});

void doc.init();
editor.focus();
