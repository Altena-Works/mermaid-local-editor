import { describe, expect, it } from "vitest";
import {
  EDGE_ROUTING_STORAGE_KEY_V2,
  MAX_STORED_DIAGRAMS,
  autoRoute,
  clampRoutePoint,
  clearDiagramRoutes,
  clearDiagramRoutesV2,
  decodeMermaidPoints,
  diagramRoutingKey,
  edgeRoutePath,
  emptyEdgeRoutingStore,
  emptyEdgeRoutingStoreV2,
  getDiagramRoutes,
  intersectNodeBoundary,
  loadEdgeRoutingStoreV2,
  migrateEdgeRoutingStoreV1,
  nearestRouteInsertionIndex,
  parseEdgeRoutingStore,
  parseEdgeRoutingStoreV2,
  removeEdgeRoute,
  roundedRoutePath,
  routeIntersectsObstacles,
  setDiagramDefaultMode,
  clearEdgePointsV2,
  snapCornerRoutePoint,
  setEdgeModeV2,
  setEdgeRoute,
  setEdgeRouteV2,
  setNodeOffset,
  smoothRoutePath,
} from "../src/edge-routing";

describe("edge route path", () => {
  it("rounds an interior corner while preserving endpoints", () => {
    expect(
      roundedRoutePath([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ], 2),
    ).toBe("M 0 0 L 8 0 Q 10 0 10 2 L 10 10");
  });

  it("drops consecutive duplicate points", () => {
    expect(
      roundedRoutePath([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe("M 0 0 L 10 0");
  });

  it("selects the nearest segment as the insertion position", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(nearestRouteInsertionIndex(route, { x: 4, y: 1 })).toBe(1);
    expect(nearestRouteInsertionIndex(route, { x: 9, y: 8 })).toBe(2);
  });

  it("clamps points to the SVG viewBox", () => {
    expect(
      clampRoutePoint({ x: -5, y: 35 }, { x: 0, y: 10, width: 20, height: 20 }),
    ).toEqual({ x: 0, y: 30 });
  });
});

describe("corner route point snapping", () => {
  const route = [
    { x: 0, y: 0 },
    { x: 10, y: 40 },
    { x: 20, y: 100 },
  ];

  it("chooses the nearest adjacent y and preserves pointer x", () => {
    expect(snapCornerRoutePoint(route, 1, { x: 77, y: 92 })).toEqual({
      x: 77,
      y: 100,
    });
    expect(snapCornerRoutePoint(route, 1, { x: -4, y: 8 })).toEqual({
      x: -4,
      y: 0,
    });
  });

  it("uses the previous point on an exact tie", () => {
    expect(snapCornerRoutePoint(route, 1, { x: 55, y: 50 })).toEqual({
      x: 55,
      y: 0,
    });
  });

  it("supports either endpoint as the only adjacent candidate", () => {
    expect(snapCornerRoutePoint(route, 0, { x: 33, y: 70 })).toEqual({
      x: 33,
      y: 40,
    });
    expect(snapCornerRoutePoint(route, 2, { x: 33, y: 10 })).toEqual({
      x: 33,
      y: 40,
    });
  });

  it("returns free movement when Shift is released or mode is smooth", () => {
    const pointer = { x: 77, y: 92 };
    expect(snapCornerRoutePoint(route, 1, pointer, false, "corner")).toEqual(
      pointer,
    );
    expect(snapCornerRoutePoint(route, 1, pointer, true, "smooth")).toEqual(
      pointer,
    );
  });

  it("returns free movement without an adjacent point", () => {
    const pointer = { x: 12, y: 34 };
    expect(snapCornerRoutePoint([], 0, pointer)).toEqual(pointer);
  });
});

describe("edge route persistence", () => {
  it("stores, removes, and clears diagram routes without mutating the input", () => {
    const original = emptyEdgeRoutingStore();
    const stored = setEdgeRoute(original, "diagram", "edge", [{ x: 4, y: 5 }], 10);
    expect(original.diagrams).toEqual({});
    expect(getDiagramRoutes(stored, "diagram").edge.points).toEqual([{ x: 4, y: 5 }]);

    const removed = removeEdgeRoute(stored, "diagram", "edge", 20);
    expect(removed.diagrams).toEqual({});

    const restored = setEdgeRoute(stored, "other", "edge", [{ x: 1, y: 2 }], 30);
    expect(clearDiagramRoutes(restored, "diagram").diagrams).toEqual({
      other: restored.diagrams.other,
    });
  });

  it("keeps only the most recently touched diagrams", () => {
    let store = emptyEdgeRoutingStore();
    for (let index = 0; index <= MAX_STORED_DIAGRAMS; index += 1) {
      store = setEdgeRoute(
        store,
        `diagram-${index}`,
        "edge",
        [{ x: index, y: index }],
        index,
      );
    }
    expect(Object.keys(store.diagrams)).toHaveLength(MAX_STORED_DIAGRAMS);
    expect(store.diagrams["diagram-0"]).toBeUndefined();
    expect(store.diagrams[`diagram-${MAX_STORED_DIAGRAMS}`]).toBeDefined();
  });

  it("ignores malformed and non-finite persisted data", () => {
    expect(parseEdgeRoutingStore("not json")).toEqual(emptyEdgeRoutingStore());
    expect(
      parseEdgeRoutingStore(JSON.stringify({
        version: 1,
        diagrams: {
          valid: {
            touchedAt: 1,
            edges: {
              good: { points: [{ x: 1, y: 2 }] },
              bad: { points: [{ x: "1", y: 2 }] },
            },
          },
        },
      })),
    ).toEqual({
      version: 1,
      diagrams: {
        valid: {
          touchedAt: 1,
          edges: { good: { points: [{ x: 1, y: 2 }] } },
        },
      },
    });
  });
});

describe("Mermaid route data", () => {
  it("decodes Mermaid data-points and fails closed for invalid input", () => {
    const encoded = btoa(JSON.stringify([{ x: 1, y: 2 }, { x: 3, y: 4 }]));
    expect(decodeMermaidPoints(encoded)).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    expect(decodeMermaidPoints("%%%")).toEqual([]);
  });

  it("binds the diagram key to both source and theme", async () => {
    const first = await diagramRoutingKey("flowchart LR\nA-->B", "default");
    expect(first).toHaveLength(64);
    expect(await diagramRoutingKey("flowchart LR\nA-->B", "dark")).not.toBe(first);
    expect(await diagramRoutingKey("flowchart LR\nA-->C", "default")).not.toBe(first);
  });
});

describe("edge routing v2 persistence", () => {
  it("parses valid siblings while discarding malformed v2 records", () => {
    const store = parseEdgeRoutingStoreV2(JSON.stringify({
      version: 2,
      diagrams: {
        diagram: {
          touchedAt: 12,
          defaultMode: "smooth",
          nodes: {
            good: { dx: 3, dy: -2 },
            bad: { dx: "3", dy: 0 },
          },
          edges: {
            good: { points: [{ x: 4, y: 5 }], mode: "smooth" },
            modeOnly: { points: [], mode: "corner" },
            bad: { points: [{ x: Number.NaN, y: 1 }] },
          },
        },
      },
    }));
    expect(store.diagrams.diagram).toEqual({
      touchedAt: 12,
      defaultMode: "smooth",
      nodes: { good: { dx: 3, dy: -2 } },
      edges: {
        good: { points: [{ x: 4, y: 5 }], mode: "smooth" },
        modeOnly: { points: [], mode: "corner" },
      },
    });
  });

  it("migrates v1 in memory and gives an empty v2 diagram precedence", () => {
    const v1 = setEdgeRoute(
      emptyEdgeRoutingStore(),
      "diagram",
      "edge",
      [{ x: 1, y: 2 }],
      1,
    );
    expect(migrateEdgeRoutingStoreV1(v1).diagrams.diagram).toEqual({
      touchedAt: 1,
      defaultMode: "corner",
      nodes: {},
      edges: { edge: { points: [{ x: 1, y: 2 }] } },
    });
    expect(
      loadEdgeRoutingStoreV2(
        JSON.stringify({
          version: 2,
          diagrams: {
            diagram: {
              touchedAt: 2,
              defaultMode: "corner",
              nodes: {},
              edges: {},
            },
          },
        }),
        JSON.stringify(v1),
      ),
    ).toEqual({
      version: 2,
      diagrams: {
        diagram: {
          touchedAt: 2,
          defaultMode: "corner",
          nodes: {},
          edges: {},
        },
      },
    });
    expect(
      loadEdgeRoutingStoreV2(
        JSON.stringify({ version: 2, diagrams: {} }),
        JSON.stringify(v1),
      ).diagrams.diagram.edges.edge,
    ).toBeDefined();
    expect(EDGE_ROUTING_STORAGE_KEY_V2).toBe("mle.edgeRouting.v2");
  });

  it("validates all records before applying caps and LRU pruning", () => {
    const edges: Record<string, unknown> = {};
    for (let index = 0; index < 500; index += 1) {
      edges[`bad-${index}`] = { points: [{ x: "invalid", y: 0 }] };
    }
    edges.valid = { points: [{ x: 1, y: 2 }] };
    const parsed = parseEdgeRoutingStoreV2(JSON.stringify({
      version: 2,
      diagrams: { d: { touchedAt: 1, defaultMode: "corner", nodes: {}, edges } },
    }));
    expect(parsed.diagrams.d.edges.valid).toEqual({ points: [{ x: 1, y: 2 }] });

    const diagrams: Record<string, unknown> = {};
    for (let index = 0; index < 21; index += 1) {
      diagrams[`d-${index}`] = { touchedAt: index, defaultMode: "corner", nodes: {}, edges: {} };
    }
    const lru = parseEdgeRoutingStoreV2(JSON.stringify({ version: 2, diagrams }));
    expect(Object.keys(lru.diagrams)).toHaveLength(MAX_STORED_DIAGRAMS);
    expect(lru.diagrams["d-20"]).toBeDefined();
    expect(lru.diagrams["d-0"]).toBeUndefined();
  });

  it("updates node, mode, and edge state without mutating its input", () => {
    const original = emptyEdgeRoutingStoreV2();
    const withNode = setNodeOffset(original, "diagram", "node", { dx: 4, dy: 5 }, 1);
    const withMode = setDiagramDefaultMode(withNode, "diagram", "smooth", 2);
    const withEdge = setEdgeRouteV2(
      withMode,
      "diagram",
      "edge",
      [{ x: 6, y: 7 }],
      3,
    );
    expect(original.diagrams).toEqual({});
    expect(withEdge.diagrams.diagram).toMatchObject({
      touchedAt: 3,
      defaultMode: "smooth",
      nodes: { node: { dx: 4, dy: 5 } },
      edges: { edge: { points: [{ x: 6, y: 7 }] } },
    });
    expect(clearDiagramRoutesV2(withEdge, "diagram", 4).diagrams.diagram).toEqual({
      touchedAt: 4,
      defaultMode: "corner",
      nodes: {},
      edges: {},
    });
  });

  it("preserves manual points when changing mode and preserves mode when rerouting", () => {
    let store = setEdgeRouteV2(
      emptyEdgeRoutingStoreV2(),
      "diagram",
      "edge",
      [{ x: 6, y: 7 }],
      1,
    );
    store = setEdgeModeV2(store, "diagram", "edge", "smooth", 2);
    expect(store.diagrams.diagram.edges.edge).toEqual({
      points: [{ x: 6, y: 7 }],
      mode: "smooth",
    });
    store = clearEdgePointsV2(store, "diagram", "edge", 3);
    expect(store.diagrams.diagram.edges.edge).toEqual({
      points: [],
      mode: "smooth",
    });
  });
});

describe("smooth routes and node geometry", () => {
  it("uses cubic commands while preserving every route vertex", () => {
    const path = smoothRoutePath([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(path).toMatch(/^M 0 0 C /);
    expect(path).toContain(" 10 0 C ");
    expect(path.endsWith(" 10 10")).toBe(true);
    expect(smoothRoutePath([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBe(
      "M 0 0 L 5 5",
    );
  });

  it("keeps smooth control points inside the viewBox", () => {
    const path = smoothRoutePath(
      [{ x: 0, y: 0 }, { x: 9, y: 1 }, { x: 10, y: 10 }],
      { x: 0, y: 0, width: 10, height: 10 },
    );
    const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    expect(values.every((value) => value >= 0 && value <= 10)).toBe(true);
  });

  it("intersects rectangular, circular, and polygon boundaries", () => {
    expect(
      intersectNodeBoundary(
        { x: 5, y: 5 },
        { x: 20, y: 5 },
        { kind: "rect", x: 0, y: 0, width: 10, height: 10 },
      ),
    ).toEqual({ x: 10, y: 5 });
    expect(
      intersectNodeBoundary(
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { kind: "circle", x: -5, y: -5, width: 10, height: 10 },
      ),
    ).toEqual({ x: 5, y: 0 });
    expect(
      intersectNodeBoundary(
        { x: 5, y: 5 },
        { x: 10, y: 5 },
        {
          kind: "polygon",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          points: [{ x: 5, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 5 }],
        },
      ),
    ).toEqual({ x: 10, y: 5 });
  });

  it("generates a deterministic obstacle-free automatic route", () => {
    const obstacle = { x: 4, y: -2, width: 4, height: 4 };
    const first = autoRoute(
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      [obstacle],
      { clearance: 2, mode: "smooth" },
    );
    expect(first).not.toBeNull();
    expect(
      autoRoute(
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        [obstacle],
        { clearance: 2, mode: "smooth" },
      ),
    ).toEqual(first);
    expect(
      routeIntersectsObstacles(first ?? [], [obstacle], 2, "smooth"),
    ).toBe(false);
    expect(edgeRoutePath(first ?? [], "smooth", undefined, [obstacle], 2)).toContain(
      " C ",
    );
  });

  it("checks rounded quadratic corners and shortens the radius on collision", () => {
    const points = [
      { x: -1, y: 20 },
      { x: -1, y: -1 },
      { x: 20, y: -1 },
    ];
    const obstacle = { x: 0, y: 0, width: 10, height: 10 };
    expect(routeIntersectsObstacles(points, [obstacle], 0, "corner")).toBe(true);
    const path = edgeRoutePath(points, "corner", undefined, [obstacle]);
    expect(path).not.toBe("");
    expect(path).toContain("Q");
  });
});

describe("routing performance regression", () => {
  it("keeps a 500-edge batch near linear relative to 250 edges", () => {
    const obstacles = Array.from({ length: 120 }, (_, index) => ({
      x: 2_000 + index * 20,
      y: 2_000,
      width: 10,
      height: 10,
    }));
    const measure = (count: number): number => {
      const startedAt = performance.now();
      let routed = 0;
      for (let index = 0; index < count; index += 1) {
        const y = index % 100;
        if (
          autoRoute(
            { x: 0, y },
            { x: 100, y },
            obstacles,
            { clearance: 8, mode: "corner" },
          )
        ) {
          routed += 1;
        }
      }
      expect(routed).toBe(count);
      return performance.now() - startedAt;
    };

    measure(50);
    const baseline = Math.min(measure(250), measure(250), measure(250));
    const doubled = Math.min(measure(500), measure(500), measure(500));

    expect(doubled / baseline).toBeLessThan(3.25);
  });
});
