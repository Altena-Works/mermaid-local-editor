import { describe, expect, it } from "vitest";
import {
  decodeFlowchartNodeDomId,
  resolveNodeSourcePosition,
} from "../src/mermaid-source";

describe("flowchart DOM node IDs", () => {
  it("decodes the source ID and treats the final number as structural", () => {
    expect(decodeFlowchartNodeDomId("flowchart-A-0")).toBe("A");
    expect(decodeFlowchartNodeDomId("flowchart-order-2026-42")).toBe(
      "order-2026",
    );
  });

  it("strips the diagram ID that Mermaid prepends when rendering", () => {
    expect(decodeFlowchartNodeDomId("mle-svg-1-flowchart-A-1", "mle-svg-1")).toBe(
      "A",
    );
    // A source ID may itself contain the prefix text, so the strip is literal.
    expect(
      decodeFlowchartNodeDomId("d-flowchart-flowchart-B-0", "d"),
    ).toBe("flowchart-B");
    expect(
      decodeFlowchartNodeDomId("mle-svg-1-flowchart-order-2026-42", "mle-svg-1"),
    ).toBe("order-2026");
  });

  it("rejects empty IDs, non-numeric counters, and unknown prefixes", () => {
    expect(decodeFlowchartNodeDomId("flowchart--1")).toBeNull();
    expect(decodeFlowchartNodeDomId("flowchart-A-counter")).toBeNull();
    expect(decodeFlowchartNodeDomId("flowchart-A-1-extra")).toBeNull();
    // Without the matching root ID the prefix is not guessed away.
    expect(decodeFlowchartNodeDomId("mle-svg-1-flowchart-A-1")).toBeNull();
    expect(
      decodeFlowchartNodeDomId("mle-svg-1-flowchart-A-1", "other-root"),
    ).toBeNull();
  });
});

describe("Mermaid node source positions", () => {
  it("finds shaped, attributed, styled, and bare definitions", () => {
    const code = [
      "flowchart TD",
      "  Shaped[Label]",
      "Attributed@{ shape: rect }",
      "Styled:::important",
      "  Bare;  ",
    ].join("\n");
    for (const id of ["Shaped", "Attributed", "Styled", "Bare"]) {
      expect(resolveNodeSourcePosition(code, id)).toBe(code.indexOf(id));
    }
  });

  it("finds implicit and chained edge endpoints", () => {
    const code = "flowchart LR\nA --> B --> C";
    for (const id of ["A", "B", "C"]) {
      expect(resolveNodeSourcePosition(code, id)).toBe(code.indexOf(id));
    }
  });

  it("supports grouped edge endpoints", () => {
    const code = "flowchart LR\nA & B --> C";
    for (const id of ["A", "B", "C"]) {
      expect(resolveNodeSourcePosition(code, id)).toBe(code.indexOf(id));
    }
  });

  it("prefers the earliest explicit definition over implicit occurrences", () => {
    const code = "flowchart LR\nA --> Target\nTarget[Defined]\nTarget[Again]";
    expect(resolveNodeSourcePosition(code, "Target")).toBe(
      code.indexOf("Target[Defined]"),
    );
  });

  it("uses the first definition among equal-priority candidates", () => {
    const code = "flowchart LR\nFirst;\nFirst[Later]";
    expect(resolveNodeSourcePosition(code, "First")).toBe(code.indexOf("First"));
  });

  it("preserves CRLF UTF-16 offsets and accepts pinned Unicode IDs", () => {
    const code = "flowchart TD\r\nA --> 日本語\r\n日本語[定義]";
    expect(resolveNodeSourcePosition(code, "日本語")).toBe(
      code.lastIndexOf("日本語"),
    );
  });

  it("accepts punctuation and apostrophes from Mermaid idString", () => {
    const code = "flowchart TD\ncash$flow[Money]\nO'Reilly[Publisher]";
    expect(resolveNodeSourcePosition(code, "cash$flow")).toBe(
      code.indexOf("cash$flow"),
    );
    expect(resolveNodeSourcePosition(code, "O'Reilly")).toBe(
      code.indexOf("O'Reilly"),
    );
  });

  it("ignores comments, directives, and command statements", () => {
    const code = [
      "%% Hidden[comment]",
      "%%{init: { 'theme': 'base' }}%%",
      "flowchart TD",
      "class Hidden important",
      "classDef Hidden fill:red",
      "style Hidden fill:red",
      "linkStyle Hidden stroke:red",
      "click Hidden callback",
      "accTitle: Hidden",
      "accDescr: Hidden",
      "Visible[Hidden]",
    ].join("\n");
    expect(resolveNodeSourcePosition(code, "Hidden")).toBeNull();
    expect(resolveNodeSourcePosition(code, "Visible")).toBe(
      code.indexOf("Visible"),
    );
  });

  it("ignores quoted and multiline Markdown node labels", () => {
    const code = [
      "flowchart TD",
      'A["Hidden"]',
      'B["`Hidden',
      'still Hidden`"]',
      "Visible[Node]",
    ].join("\n");
    expect(resolveNodeSourcePosition(code, "Hidden")).toBeNull();
    expect(resolveNodeSourcePosition(code, "Visible")).toBe(
      code.indexOf("Visible"),
    );
  });

  it("ignores pipe and non-pipe edge labels", () => {
    const code = [
      "flowchart LR",
      "A -->|Hidden| B",
      "B -- Hidden --> C",
      "C == Hidden ==> D",
      "D -. Hidden .-> E",
      "Hidden[Actual node]",
    ].join("\n");
    expect(resolveNodeSourcePosition(code, "Hidden")).toBe(
      code.indexOf("Hidden[Actual node]"),
    );
  });

  it("does not confuse a label with an implicit node of the same name", () => {
    const code = "flowchart LR\nA -- Target --> B\nB --> Target";
    expect(resolveNodeSourcePosition(code, "Target")).toBe(
      code.lastIndexOf("Target"),
    );
  });

  it("returns null for missing IDs and unsafe unclosed lexical regions", () => {
    expect(resolveNodeSourcePosition("flowchart TD\nA[Node]", "Missing")).toBeNull();
    expect(resolveNodeSourcePosition('flowchart TD\nA["Node]', "A")).toBeNull();
    expect(resolveNodeSourcePosition("flowchart LR\nA -->|label", "A")).toBeNull();
    expect(resolveNodeSourcePosition("flowchart LR\nA -- label", "A")).toBeNull();
    expect(resolveNodeSourcePosition("flowchart TD", "")).toBeNull();
  });
});
