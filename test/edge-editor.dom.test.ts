// @vitest-environment jsdom
/**
 * Event-level behaviour of the edge editor: selection vs. point insertion,
 * handle deletion, the 4 CSS px drag threshold, atomic restore on save failure
 * and the node -> source-line jump.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeRoutingEditor } from "../src/edge-editor";
import { EDGE_ROUTING_STORAGE_KEY_V2 } from "../src/edge-routing";
import { installEdgeEditorStubs } from "./dom-setup";

const SVG_NS = "http://www.w3.org/2000/svg";
const DIAGRAM_ID = "mle-svg-1";
const EDGE_ID = "L_A_B_0";
const DIAGRAM_KEY = "diagram-key";

/** Node A occupies x 40..100 / y 20..50, node B x 40..100 / y 200..230. */
const EDGE_START = { x: 70, y: 50 };
const EDGE_END = { x: 70, y: 200 };
const CURVE_POINT = { x: 120, y: 125 };
const STRAIGHT_PATH = "M 70 50 L 70 200";
const CURVED_PATH = "M 70 50 Q 120 125 70 200";

function encodePoints(points: Array<{ x: number; y: number }>): string {
  return btoa(JSON.stringify(points));
}

function buildControls() {
  const make = <T extends HTMLElement>(tag: string): T =>
    document.createElement(tag) as T;
  const select = (values: string[]): HTMLSelectElement => {
    const element = make<HTMLSelectElement>("select");
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      element.append(option);
    }
    return element;
  };
  return {
    mode: make<HTMLButtonElement>("button"),
    tools: make<HTMLDivElement>("div"),
    reset: make<HTMLButtonElement>("button"),
    resetAll: make<HTMLButtonElement>("button"),
    defaultMode: select(["corner", "smooth"]),
    edgeSelection: make<HTMLDivElement>("div"),
    selectedMode: select(["inherit", "corner", "smooth"]),
    reroute: make<HTMLButtonElement>("button"),
    nodeSelection: make<HTMLDivElement>("div"),
    nodeReset: make<HTMLButtonElement>("button"),
  };
}

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  failOnWrite = false;

  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error("quota exceeded");
    this.data.set(key, value);
  }
}

/** `curved` gives the edge an interior Mermaid point and a Q command, so that
 *  replacing it with an app-generated route is visible in the `d` attribute. */
function buildSvg(curved = false): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.id = DIAGRAM_ID;
  svg.setAttribute("viewBox", "0 0 400 300");

  const addNode = (id: string, bbox: string): void => {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "node");
    group.id = id;
    group.setAttribute("data-bbox", bbox);
    group.append(document.createElementNS(SVG_NS, "rect"));
    svg.append(group);
  };
  addNode(`${DIAGRAM_ID}-flowchart-A-0`, "40,20,60,30");
  addNode(`${DIAGRAM_ID}-flowchart-B-1`, "40,200,60,30");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", "edge-thickness-normal flowchart-link");
  path.dataset.id = EDGE_ID;
  path.dataset.points = encodePoints(
    curved ? [EDGE_START, CURVE_POINT, EDGE_END] : [EDGE_START, EDGE_END],
  );
  path.setAttribute("d", curved ? CURVED_PATH : STRAIGHT_PATH);
  svg.append(path);

  const labelGroup = document.createElementNS(SVG_NS, "g");
  labelGroup.setAttribute("class", "edgeLabel");
  const innerLabel = document.createElementNS(SVG_NS, "g");
  innerLabel.setAttribute("class", "label");
  innerLabel.dataset.id = EDGE_ID;
  labelGroup.append(innerLabel);
  svg.append(labelGroup);

  return svg;
}

interface Harness {
  editor: EdgeRoutingEditor;
  canvas: HTMLDivElement;
  svg: SVGSVGElement;
  storage: MemoryStorage;
  controls: ReturnType<typeof buildControls>;
  revealNodeSource: ReturnType<typeof vi.fn>;
  statuses: string[];
}

function setup(curved = false): Harness {
  const canvas = document.createElement("div");
  document.body.replaceChildren(canvas);
  const svg = buildSvg(curved);
  canvas.append(svg);

  const controls = buildControls();
  const storage = new MemoryStorage();
  const statuses: string[] = [];
  const revealNodeSource = vi.fn(() => true);

  const editor = new EdgeRoutingEditor({
    canvas,
    controls,
    storage,
    t: (key) => key,
    setStatus: (key) => statuses.push(key),
    revealNodeSource,
  });
  editor.attach(svg, DIAGRAM_KEY);
  controls.mode.click();
  statuses.length = 0;
  return { editor, canvas, svg, storage, controls, revealNodeSource, statuses };
}

function edgePath(svg: SVGSVGElement): SVGPathElement {
  const path = svg.querySelector<SVGPathElement>("path.flowchart-link");
  if (!path) throw new Error("missing edge path");
  return path;
}

function handles(canvas: HTMLElement): SVGCircleElement[] {
  return [...canvas.querySelectorAll<SVGCircleElement>(".edge-route-handle")];
}

function pointerDown(target: Element, x: number, y: number): void {
  target.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      clientX: x,
      clientY: y,
    }),
  );
}

function click(target: Element, x: number, y: number, detail = 1): void {
  target.dispatchEvent(
    new MouseEvent("click", { bubbles: true, detail, clientX: x, clientY: y }),
  );
}

function doubleClick(target: Element, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent("dblclick", { bubbles: true, detail: 2, clientX: x, clientY: y }),
  );
}

/** pointerdown + click on the edge, as a real single click produces. */
function clickEdge(harness: Harness, x: number, y: number, detail = 1): void {
  const path = edgePath(harness.svg);
  pointerDown(path, x, y);
  click(path, x, y, detail);
}

function storedPoints(storage: MemoryStorage): Array<{ x: number; y: number }> {
  const raw = storage.getItem(EDGE_ROUTING_STORAGE_KEY_V2);
  if (!raw) return [];
  return JSON.parse(raw).diagrams?.[DIAGRAM_KEY]?.edges?.[EDGE_ID]?.points ?? [];
}

beforeAll(() => {
  installEdgeEditorStubs(window as Window & typeof globalThis);
});

let harness: Harness;
beforeEach(() => {
  harness = setup();
});

describe("edge selection and point insertion", () => {
  it("only selects on the first click of an unselected edge", () => {
    clickEdge(harness, 70, 120);
    expect(handles(harness.canvas)).toHaveLength(0);
    expect(storedPoints(harness.storage)).toHaveLength(0);
    expect(harness.statuses).toContain("status.edgeSelected");
  });

  it("adds exactly one point when clicking an already selected edge", () => {
    clickEdge(harness, 70, 120);
    clickEdge(harness, 70, 120);
    expect(handles(harness.canvas)).toHaveLength(1);
    const points = storedPoints(harness.storage);
    expect(points).toHaveLength(1);
    // The point snaps onto the rendered path rather than the raw pointer spot.
    expect(points[0].x).toBeCloseTo(70, 3);
    // nearestPathPoint refines by bisection, so allow its sampling error.
    expect(points[0].y).toBeCloseTo(120, 1);
  });

  it("adds at most one point for a double click on a selected edge", () => {
    clickEdge(harness, 70, 120);
    clickEdge(harness, 70, 140);
    clickEdge(harness, 70, 140, 2);
    doubleClick(edgePath(harness.svg), 70, 140);
    expect(handles(harness.canvas)).toHaveLength(1);
  });

  it("ignores a click that moved more than 4 CSS px after pointerdown", () => {
    clickEdge(harness, 70, 120);
    const path = edgePath(harness.svg);
    pointerDown(path, 70, 120);
    click(path, 70, 126);
    expect(handles(harness.canvas)).toHaveLength(0);
    expect(storedPoints(harness.storage)).toHaveLength(0);
  });
});

describe("point handles", () => {
  function addPoint(y: number): void {
    clickEdge(harness, 70, y);
    clickEdge(harness, 70, y);
  }

  it("deletes the point on a handle double click without adding one", () => {
    addPoint(120);
    expect(handles(harness.canvas)).toHaveLength(1);
    doubleClick(handles(harness.canvas)[0], 70, 120);
    expect(handles(harness.canvas)).toHaveLength(0);
    expect(storedPoints(harness.storage)).toHaveLength(0);
    expect(harness.statuses).toContain("status.edgePointDeleted");
  });

  it("deletes the point with Delete and with Backspace", () => {
    for (const key of ["Delete", "Backspace"]) {
      harness = setup();
      addPoint(120);
      handles(harness.canvas)[0].dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key }),
      );
      expect(handles(harness.canvas), key).toHaveLength(0);
    }
  });

  it("restores points, path and store atomically when saving fails", () => {
    addPoint(120);
    const path = edgePath(harness.svg);
    const savedPath = path.getAttribute("d");
    const savedStore = harness.storage.getItem(EDGE_ROUTING_STORAGE_KEY_V2);

    harness.storage.failOnWrite = true;
    doubleClick(handles(harness.canvas)[0], 70, 120);

    expect(harness.statuses).toContain("status.edgeSaveFailed");
    expect(path.getAttribute("d")).toBe(savedPath);
    expect(harness.storage.getItem(EDGE_ROUTING_STORAGE_KEY_V2)).toBe(savedStore);
    expect(handles(harness.canvas)).toHaveLength(1);
    expect(storedPoints(harness.storage)).toHaveLength(1);
  });
});

function pointerMove(x: number, y: number, shiftKey = false): void {
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientX: x,
      clientY: y,
      shiftKey,
    }),
  );
}

function pointerUp(x: number, y: number): void {
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: 1,
      clientX: x,
      clientY: y,
    }),
  );
}

function storedNodes(
  storage: MemoryStorage,
): Record<string, { dx: number; dy: number }> {
  const raw = storage.getItem(EDGE_ROUTING_STORAGE_KEY_V2);
  if (!raw) return {};
  return JSON.parse(raw).diagrams?.[DIAGRAM_KEY]?.nodes ?? {};
}

describe("node movement", () => {
  function nodeB(): SVGGElement {
    const nodes = harness.svg.querySelectorAll<SVGGElement>("g.node");
    return nodes[1];
  }

  it("moves the selected node with the arrow keys and persists the offset", () => {
    const node = nodeB();
    const before = edgePath(harness.svg).getAttribute("d");
    node.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );
    expect(storedNodes(harness.storage)[node.id]).toEqual({ dx: 1, dy: 0 });
    expect(node.getAttribute("transform")).toContain("translate(1 0)");
    // The incident edge follows the node.
    expect(edgePath(harness.svg).getAttribute("d")).not.toBe(before);
  });

  it("uses a 10 unit step with Shift", () => {
    const node = nodeB();
    node.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp", shiftKey: true }),
    );
    expect(storedNodes(harness.storage)[node.id]).toEqual({ dx: 0, dy: -10 });
  });

  it("does not persist a drag that stays within 4 CSS px", () => {
    const node = nodeB();
    pointerDown(node, 70, 215);
    pointerMove(72, 216);
    pointerUp(72, 216);
    expect(storedNodes(harness.storage)).toEqual({});
    expect(node.getAttribute("transform")).toBeNull();
  });

  it("persists a drag beyond the threshold", () => {
    const node = nodeB();
    pointerDown(node, 70, 215);
    pointerMove(100, 215);
    pointerUp(100, 215);
    expect(storedNodes(harness.storage)[node.id].dx).toBeCloseTo(30, 3);
    expect(harness.statuses).toContain("status.nodeMoved");
  });

  it("suppresses the definition jump for a drag that became a double click", () => {
    const node = nodeB();
    pointerDown(node, 70, 215);
    pointerMove(100, 215);
    pointerUp(100, 215);
    doubleClick(node, 100, 215);
    expect(harness.revealNodeSource).not.toHaveBeenCalled();
  });
});

describe("route point dragging", () => {
  function addPointAndDrag(
    y: number,
    to: { x: number; y: number },
    shiftKey: boolean,
  ): Array<{ x: number; y: number }> {
    clickEdge(harness, 70, y);
    clickEdge(harness, 70, y);
    const handle = handles(harness.canvas)[0];
    pointerDown(handle, 70, y);
    pointerMove(to.x, to.y, shiftKey);
    pointerUp(to.x, to.y);
    return storedPoints(harness.storage);
  }

  it("follows the pointer freely without Shift", () => {
    const points = addPointAndDrag(120, { x: 150, y: 130 }, false);
    expect(points).toHaveLength(1);
    expect(points[0].x).toBeCloseTo(150, 3);
    expect(points[0].y).toBeCloseTo(130, 3);
  });

  it("snaps Y to the nearer neighbour with Shift in corner mode", () => {
    // The neighbours are the endpoints at y=50 and y=200. From y=130 the end
    // point is nearer (70 vs 80), so the segment towards it becomes horizontal.
    const points = addPointAndDrag(120, { x: 150, y: 130 }, true);
    expect(points[0].x).toBeCloseTo(150, 3);
    expect(points[0].y).toBeCloseTo(EDGE_END.y, 3);
  });

  it("does not snap in smooth mode", () => {
    harness.controls.defaultMode.value = "smooth";
    harness.controls.defaultMode.dispatchEvent(new Event("change"));
    const points = addPointAndDrag(120, { x: 150, y: 130 }, true);
    expect(points[0].y).toBeCloseTo(130, 3);
  });
});

describe("edge modes", () => {
  it("switches the diagram default between polyline and cubic commands", () => {
    clickEdge(harness, 70, 120);
    clickEdge(harness, 70, 120);
    expect(edgePath(harness.svg).getAttribute("d")).toContain("L ");

    harness.controls.defaultMode.value = "smooth";
    harness.controls.defaultMode.dispatchEvent(new Event("change"));
    expect(edgePath(harness.svg).getAttribute("d")).toContain("C ");
    expect(harness.statuses).toContain("status.edgeModeChanged");
  });

  it("lets a single edge override the diagram default", () => {
    clickEdge(harness, 70, 120);
    clickEdge(harness, 70, 120);
    harness.controls.selectedMode.value = "smooth";
    harness.controls.selectedMode.dispatchEvent(new Event("change"));
    expect(edgePath(harness.svg).getAttribute("d")).toContain("C ");

    const raw = harness.storage.getItem(EDGE_ROUTING_STORAGE_KEY_V2);
    expect(JSON.parse(raw!).diagrams[DIAGRAM_KEY].edges[EDGE_ID].mode).toBe(
      "smooth",
    );
  });

  it("keeps manual points when only the mode changes", () => {
    clickEdge(harness, 70, 120);
    clickEdge(harness, 70, 120);
    const before = storedPoints(harness.storage);
    harness.controls.selectedMode.value = "smooth";
    harness.controls.selectedMode.dispatchEvent(new Event("change"));
    expect(storedPoints(harness.storage)).toEqual(before);
  });
});

describe("what is shown survives the next re-render", () => {
  // A curved original is required: with a straight one the app's automatic
  // route is identical to Mermaid's, which would hide a divergence.
  beforeEach(() => {
    harness = setup(true);
  });

  /** Re-render with the same source and theme, as main.ts does on every edit. */
  function reRender(): string | null {
    const fresh = buildSvg(true);
    harness.canvas.replaceChildren(fresh);
    harness.svg = fresh;
    harness.editor.attach(fresh, DIAGRAM_KEY);
    return edgePath(fresh).getAttribute("d");
  }

  it("keeps manual points across a re-render", () => {
    clickEdge(harness, 70, 120);
    clickEdge(harness, 70, 120);
    const live = edgePath(harness.svg).getAttribute("d");
    expect(live).not.toBe(CURVED_PATH);
    expect(reRender()).toBe(live);
  });

  it("shows the same geometry after an explicit auto reroute", () => {
    clickEdge(harness, 70, 120);
    clickEdge(harness, 70, 120);
    harness.controls.reroute.click();
    const live = edgePath(harness.svg).getAttribute("d");
    expect(reRender()).toBe(live);
  });

  it("shows the same geometry after resetting one edge", () => {
    clickEdge(harness, 70, 120);
    clickEdge(harness, 70, 120);
    harness.controls.reset.click();
    const live = edgePath(harness.svg).getAttribute("d");
    expect(reRender()).toBe(live);
  });

  it("shows the same geometry after moving a node back to its origin", () => {
    const node = harness.svg.querySelectorAll<SVGGElement>("g.node")[1];
    node.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
    );
    node.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }),
    );
    const live = edgePath(harness.svg).getAttribute("d");
    expect(reRender()).toBe(live);
  });

  it("keeps the smooth default across a re-render", () => {
    harness.controls.defaultMode.value = "smooth";
    harness.controls.defaultMode.dispatchEvent(new Event("change"));
    const live = edgePath(harness.svg).getAttribute("d");
    // The automatic router works from the endpoints only, so it drops Mermaid's
    // own waypoint; the assertion here is that the re-render agrees.
    expect(live).not.toBe(CURVED_PATH);
    expect(reRender()).toBe(live);
  });
});

describe("resetting", () => {
  it("restores the original Mermaid path and clears the diagram record", () => {
    const original = edgePath(harness.svg).getAttribute("d");
    clickEdge(harness, 70, 120);
    clickEdge(harness, 70, 120);
    expect(edgePath(harness.svg).getAttribute("d")).not.toBe(original);

    harness.controls.resetAll.click();
    expect(edgePath(harness.svg).getAttribute("d")).toBe(original);
    expect(storedPoints(harness.storage)).toHaveLength(0);
    expect(storedNodes(harness.storage)).toEqual({});
  });
});

describe("node double click reveals the definition line", () => {
  function nodeA(): SVGGElement {
    const node = harness.svg.querySelector<SVGGElement>("g.node");
    if (node?.id !== `${DIAGRAM_ID}-flowchart-A-0`) {
      throw new Error("missing node");
    }
    return node;
  }

  it("passes the Mermaid source ID, not the rendered DOM ID", () => {
    doubleClick(nodeA(), 70, 35);
    expect(harness.revealNodeSource).toHaveBeenCalledWith("A");
    expect(harness.statuses).toContain("status.nodeSourceRevealed");
  });

  it("works while edge routing is disabled", () => {
    harness.controls.mode.click();
    harness.statuses.length = 0;
    doubleClick(nodeA(), 70, 35);
    expect(harness.revealNodeSource).toHaveBeenCalledWith("A");
  });

  it("reports not-found without touching the caret when unresolved", () => {
    harness.revealNodeSource.mockReturnValue(false);
    doubleClick(nodeA(), 70, 35);
    expect(harness.statuses).toContain("status.nodeSourceNotFound");
  });

  it("ignores nodes that belong to a superseded SVG root", () => {
    const stale = buildSvg();
    harness.canvas.append(stale);
    const staleNode = stale.querySelector<SVGGElement>("g.node");
    doubleClick(staleNode!, 70, 35);
    expect(harness.revealNodeSource).not.toHaveBeenCalled();
  });
});
