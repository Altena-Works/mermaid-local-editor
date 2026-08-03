// `vitest/config` re-exports Vite's defineConfig with the `test` field typed.
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: ".",
  base: "./",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    // Scratch worktrees and tool state live in dot-directories and can hold
    // their own copy of this suite. Running those hides which tests are the
    // repository's own, so keep the run to tracked, non-hidden paths.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.*/**", "release/**"],
  },
  build: {
    outDir: "dist",
    target: "es2021",
    // mermaid のダイアグラムチャンクは大きい。バンドル前提なので警告閾値を上げる。
    chunkSizeWarningLimit: 3000,
  },
});
