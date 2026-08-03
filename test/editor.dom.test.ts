// @vitest-environment jsdom
/**
 * The node -> definition jump must move only the caret and the viewport. It
 * must not edit the document, trigger onChange, or grow the undo history.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { CodeEditor } from "../src/editor";
import { resolveNodeSourcePosition } from "../src/mermaid-source";
import { installTextMeasurementStubs } from "./dom-setup";

const SOURCE = ["flowchart TD", "  A[Start] --> B{Choice}", "  B --> C"].join("\n");

/**
 * `view` is private. The tests read it directly so that selection and history
 * depth can be asserted without adding accessors that only tests would use.
 */
function viewOf(editor: CodeEditor): EditorView {
  return (editor as unknown as { view: EditorView }).view;
}

function anchorOf(editor: CodeEditor): number {
  return viewOf(editor).state.selection.main.anchor;
}

let editor: CodeEditor;
let onChange: ReturnType<typeof vi.fn>;

beforeAll(() => {
  installTextMeasurementStubs(window as Window & typeof globalThis);
});

beforeEach(() => {
  document.body.replaceChildren();
  const parent = document.createElement("div");
  document.body.append(parent);
  onChange = vi.fn();
  editor = new CodeEditor({ parent, initialDoc: SOURCE, dark: false, onChange });
});

describe("revealPosition", () => {
  it("puts the caret at the resolved node definition", () => {
    const position = resolveNodeSourcePosition(SOURCE, "B");
    expect(position).not.toBeNull();
    expect(editor.revealPosition(position!)).toBe(true);
    expect(anchorOf(editor)).toBe(position);
    expect(viewOf(editor).state.selection.main.head).toBe(position);
    expect(editor.getValue()).toBe(SOURCE);
  });

  it("does not report a document change", () => {
    editor.revealPosition(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getValue()).toBe(SOURCE);
  });

  it("rejects out-of-range and non-integer positions without moving the caret", () => {
    const before = anchorOf(editor);
    for (const position of [-1, SOURCE.length + 1, 1.5, Number.NaN]) {
      expect(editor.revealPosition(position)).toBe(false);
    }
    expect(anchorOf(editor)).toBe(before);
  });

  it("accepts the very end of the document", () => {
    expect(editor.revealPosition(SOURCE.length)).toBe(true);
  });

  it("leaves undo and redo depth untouched", () => {
    const undoBefore = undoDepth(viewOf(editor).state);
    const redoBefore = redoDepth(viewOf(editor).state);
    editor.revealPosition(SOURCE.indexOf("B{"));
    expect(undoDepth(viewOf(editor).state)).toBe(undoBefore);
    expect(redoDepth(viewOf(editor).state)).toBe(redoBefore);
  });

  it("keeps undo and redo of a real edit working across a reveal", () => {
    editor.setValue(`${SOURCE}\n  C --> D`);
    const edited = editor.getValue();
    editor.revealPosition(3);

    undo(viewOf(editor));
    expect(editor.getValue()).toBe(SOURCE);
    redo(viewOf(editor));
    expect(editor.getValue()).toBe(edited);
  });
});

describe("setDark", () => {
  it("swaps the theme without changing the document, caret or history", () => {
    editor.revealPosition(SOURCE.indexOf("B{"));
    const anchor = anchorOf(editor);
    const undoBefore = undoDepth(viewOf(editor).state);

    editor.setDark(true);
    editor.setDark(false);

    expect(editor.getValue()).toBe(SOURCE);
    expect(anchorOf(editor)).toBe(anchor);
    expect(undoDepth(viewOf(editor).state)).toBe(undoBefore);
    expect(onChange).not.toHaveBeenCalled();
  });
});
