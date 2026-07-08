import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "./",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    target: "es2021",
    // mermaid のダイアグラムチャンクは大きい。バンドル前提なので警告閾値を上げる。
    chunkSizeWarningLimit: 3000,
  },
});
