// @vitest-environment jsdom
/**
 * Pins the Mermaid 11.15.0 DOM contract the edge editor depends on.
 *
 * Everything asserted here is undocumented Mermaid output, so a Mermaid upgrade
 * must fail this file rather than silently disable node movement or the jump to
 * a node's definition line.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { decodeFlowchartNodeDomId } from "../src/mermaid-source";
import { decodeMermaidPoints } from "../src/edge-routing";
import { installSvgGeometryStubs } from "./dom-setup";

const DIAGRAM_ID = "mle-svg-1";
const SOURCE = [
  "flowchart TD",
  "  A[Start] --> B{Choice}",
  "  B -- yes --> C((Done))",
  "  B -- no --> A",
].join("\n");

let root: SVGSVGElement;

beforeAll(async () => {
  installSvgGeometryStubs(window as Window & typeof globalThis);
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
  const { svg } = await mermaid.render(DIAGRAM_ID, SOURCE);
  const host = document.createElement("div");
  host.innerHTML = svg;
  const rendered = host.querySelector("svg");
  if (!rendered) throw new Error("Mermaid produced no SVG root");
  root = rendered as unknown as SVGSVGElement;
});

describe("Mermaid 11.15.0 flowchart DOM contract", () => {
  it("uses the SVG root ID as the diagram ID", () => {
    expect(root.id).toBe(DIAGRAM_ID);
  });

  it("names node groups <diagram-id>-flowchart-<source-id>-<counter>", () => {
    const ids = [...root.querySelectorAll("g.node")].map((node) => node.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith(`${DIAGRAM_ID}-flowchart-`)).toBe(true);
    }
    // The regression this file exists for: the diagram ID prefix must not
    // defeat source-ID recovery.
    expect(ids.map((id) => decodeFlowchartNodeDomId(id, DIAGRAM_ID)).sort()).toEqual(
      ["A", "B", "C"],
    );
  });

  it("exposes a shape element the boundary measurement understands", () => {
    const shapes = [...root.querySelectorAll("g.node")].map(
      (node) => node.querySelector("rect, circle, ellipse, polygon")?.tagName,
    );
    expect(shapes).toEqual(expect.arrayContaining(["rect", "polygon", "circle"]));
  });

  it("marks edges with class flowchart-link, data-id and base64 data-points", () => {
    const edges = [...root.querySelectorAll<SVGPathElement>("path.flowchart-link")];
    expect(edges).toHaveLength(3);
    const edgeIds = edges.map((edge) => edge.dataset.id);
    expect(new Set(edgeIds).size).toBe(edges.length);
    for (const edge of edges) {
      expect(edge.dataset.id).toBeTruthy();
      // decodeMermaidPoints fails closed, so a non-empty result proves the
      // btoa(JSON.stringify(points)) encoding still holds.
      expect(decodeMermaidPoints(edge.dataset.points).length).toBeGreaterThanOrEqual(2);
      expect(edge.getAttribute("marker-end")).toBeTruthy();
    }
  });

  it("keys edge labels off .edgeLabel .label[data-id] matching the edge IDs", () => {
    const edgeIds = new Set(
      [...root.querySelectorAll<SVGPathElement>("path.flowchart-link")].map(
        (edge) => edge.dataset.id,
      ),
    );
    const labelIds = [
      ...root.querySelectorAll<SVGElement>(".edgeLabel .label[data-id]"),
    ].map((label) => label.dataset.id);
    expect(labelIds.length).toBeGreaterThan(0);
    for (const labelId of labelIds) {
      expect(edgeIds.has(labelId)).toBe(true);
      expect(
        root.querySelector(`.edgeLabel .label[data-id="${labelId}"]`)?.closest(
          "g.edgeLabel",
        ),
      ).toBeTruthy();
    }
  });
});
