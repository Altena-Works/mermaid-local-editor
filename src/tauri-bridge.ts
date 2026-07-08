import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConfirmLabels, FileBridge } from "./document";

type FileReadResult = { content: string } | { error: string };
type FileWriteResult = { ok: true } | { error: string };

export function createTauriBridge(): FileBridge {
  return {
    showOpenDialog: () => invoke<string | null>("dialog_open"),
    readFile: (path: string) => invoke<FileReadResult>("file_read", { path }),
    showSaveDialog: (suggestedName: string) =>
      invoke<string | null>("dialog_save", { suggestedName }),
    writeFile: (path: string, content: string) =>
      invoke<FileWriteResult>("file_write", { path, content }),
    confirmUnsaved: (filename: string, labels: ConfirmLabels) =>
      invoke<"save" | "discard" | "cancel">("confirm_unsaved", { filename, labels }),
    setActiveDoc: (path: string | null, addToRecent: boolean) =>
      void invoke("set_active_doc", { path, addToRecent }),
    removeRecent: (path: string) => void invoke("remove_recent", { path }),
    getStartupPath: () => invoke<string | null>("startup_path"),
    setTitle: (title: string) => void invoke("set_title", { title }),
  };
}

export function allowClose(): Promise<void> {
  return invoke("allow_close");
}

export type CommandPayload = { type: string; path?: string };

export function onCommand(cb: (payload: CommandPayload) => void): void {
  void listen<CommandPayload>("command", (event) => cb(event.payload));
}
