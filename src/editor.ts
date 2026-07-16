import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import type { ThemeVars } from "./color-theme";

export interface EditorOptions {
  parent: HTMLElement;
  initialDoc: string;
  onChange: (doc: string) => void;
  vars: ThemeVars;
}

// Builds a CodeMirror theme from the active color theme's resolved variables,
// so the editor always matches whichever preset is selected.
function buildCmTheme(vars: ThemeVars): Extension {
  return EditorView.theme(
    {
      "&": { color: vars.text, backgroundColor: vars.bgPanel },
      ".cm-content": { caretColor: vars.accent },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: vars.accent },
      ".cm-activeLine": { backgroundColor: vars.bgSoft },
      ".cm-gutters": {
        backgroundColor: vars.bgPanel,
        color: vars.textSoft,
        border: "none",
      },
      ".cm-activeLineGutter": { backgroundColor: vars.bgSoft },
    },
    { dark: vars.base === "dark" },
  );
}

export class CodeEditor {
  private view: EditorView;
  private onChange: (doc: string) => void;
  private themeCompartment = new Compartment();

  constructor(opts: EditorOptions) {
    this.onChange = opts.onChange;
    this.view = new EditorView({
      parent: opts.parent,
      state: this.makeState(opts.initialDoc, opts.vars),
    });
  }

  private extensions(vars: ThemeVars): Extension[] {
    return [
      lineNumbers(),
      history(),
      bracketMatching(),
      highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) this.onChange(u.state.doc.toString());
      }),
      this.themeCompartment.of(buildCmTheme(vars)),
    ];
  }

  private makeState(doc: string, vars: ThemeVars): EditorState {
    return EditorState.create({ doc, extensions: this.extensions(vars) });
  }

  getValue(): string {
    return this.view.state.doc.toString();
  }

  setValue(doc: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: doc },
    });
  }

  /** Swap the editor's colors in place, preserving undo history and cursor position. */
  setColorTheme(vars: ThemeVars): void {
    this.view.dispatch({
      effects: this.themeCompartment.reconfigure(buildCmTheme(vars)),
    });
  }

  focus(): void {
    this.view.focus();
  }
}
