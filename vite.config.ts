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
    // `.claude/worktrees/*` holds throwaway agent worktrees with their own
    // copies of this suite. Running them hides which tests belong to the repo.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "release/**"],
  },
  build: {
    outDir: "dist",
    target: "es2021",
    // mermaid のダイアグラムチャンクは大きい。バンドル前提なので警告閾値を上げる。
    chunkSizeWarningLimit: 3000,
  },
});
