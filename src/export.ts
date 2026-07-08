// File export helpers. Bytes are base64-encoded and handed to the Rust
// `export_save` command, which shows a native save dialog and writes them.

import { invoke } from "@tauri-apps/api/core";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function saveViaDialog(bytes: Uint8Array, filename: string): Promise<void> {
  await invoke("export_save", { suggestedName: filename, base64Data: bytesToBase64(bytes) });
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
    d.getHours(),
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Given the edited dimension and its new value, return the other dimension
 *  that preserves the intrinsic aspect ratio. Rounds; guards divide-by-zero. */
export function lockedCounterpart(
  edited: "w" | "h",
  value: number,
  intrinsic: { w: number; h: number },
): number {
  if (!intrinsic.w || !intrinsic.h) return value;
  return edited === "w"
    ? Math.round(value * (intrinsic.h / intrinsic.w))
    : Math.round(value * (intrinsic.w / intrinsic.h));
}

export interface ExportOpts {
  format: "svg" | "png" | "webp";
  width: number;
  height: number;
  quality?: number;
}

export async function exportDiagram(
  svgEl: SVGSVGElement,
  opts: ExportOpts,
): Promise<void> {
  const w = Math.max(1, Math.round(opts.width));
  const h = Math.max(1, Math.round(opts.height));

  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const source = new XMLSerializer().serializeToString(clone);

  if (opts.format === "svg") {
    const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n${source}`;
    await saveViaDialog(new TextEncoder().encode(svgText), `mermaid-${timestamp()}.svg`);
    return;
  }

  const svgUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to rasterize the SVG."));
    img.src = svgUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not initialize a canvas.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const mime = opts.format === "png" ? "image/png" : "image/webp";
  const ext = opts.format;
  await new Promise<void>((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          void blob.arrayBuffer().then((buf) => saveViaDialog(new Uint8Array(buf), `mermaid-${timestamp()}.${ext}`).then(resolve));
        } else {
          resolve();
        }
      },
      mime,
      opts.format === "webp" ? (opts.quality ?? 0.92) : undefined,
    );
  });
}
