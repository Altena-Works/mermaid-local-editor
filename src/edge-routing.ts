export const EDGE_ROUTING_STORAGE_KEY = "mle.edgeRouting.v1";
export const EDGE_ROUTING_STORAGE_KEY_V2 = "mle.edgeRouting.v2";
export const MAX_STORED_DIAGRAMS = 20;

const MAX_RAW_STORE_LENGTH = 1_000_000;
const MAX_EDGES_PER_DIAGRAM = 500;
const MAX_NODES_PER_DIAGRAM = 2_000;
const MAX_POINTS_PER_EDGE = 64;
const MAX_COORDINATE = 10_000_000;
const MAX_ID_LENGTH = 256;

export interface RoutePoint {
  x: number;
  y: number;
}

export interface EdgeRoute {
  points: RoutePoint[];
}

export interface DiagramRoutes {
  touchedAt: number;
  edges: Record<string, EdgeRoute>;
}

export interface EdgeRoutingStoreV1 {
  version: 1;
  diagrams: Record<string, DiagramRoutes>;
}

export type EdgeRoutingMode = "corner" | "smooth";

export interface NodeOffset {
  dx: number;
  dy: number;
}

export interface EdgeRouteV2 {
  points: RoutePoint[];
  mode?: EdgeRoutingMode;
}

export interface DiagramRoutesV2 {
  touchedAt: number;
  defaultMode: EdgeRoutingMode;
  nodes: Record<string, NodeOffset>;
  edges: Record<string, EdgeRouteV2>;
}

export interface EdgeRoutingStoreV2 {
  version: 2;
  diagrams: Record<string, DiagramRoutesV2>;
}

export interface ViewBoxBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeBoundary extends ViewBoxBounds {
  kind: "rect" | "circle" | "ellipse" | "polygon" | "unknown";
  points?: RoutePoint[];
}

export interface AutoRouteOptions {
  clearance?: number;
  mode?: EdgeRoutingMode;
  bounds?: ViewBoxBounds;
  previous?: RoutePoint[];
}

export function emptyEdgeRoutingStore(): EdgeRoutingStoreV1 {
  return { version: 1, diagrams: {} };
}

export function emptyEdgeRoutingStoreV2(): EdgeRoutingStoreV2 {
  return { version: 2, diagrams: {} };
}

function validPoint(value: unknown): value is RoutePoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<RoutePoint>;
  return (
    typeof point.x === "number" &&
    typeof point.y === "number" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Math.abs(point.x) <= MAX_COORDINATE &&
    Math.abs(point.y) <= MAX_COORDINATE
  );
}

function sanitizePoints(value: unknown): RoutePoint[] | null {
  if (!Array.isArray(value) || value.length > MAX_POINTS_PER_EDGE) return null;
  const points: RoutePoint[] = [];
  for (const item of value) {
    if (!validPoint(item)) return null;
    points.push({ x: item.x, y: item.y });
  }
  return points;
}

function validMode(value: unknown): value is EdgeRoutingMode {
  return value === "corner" || value === "smooth";
}

function validNodeOffset(value: unknown): value is NodeOffset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const offset = value as Partial<NodeOffset>;
  return (
    typeof offset.dx === "number" &&
    typeof offset.dy === "number" &&
    Number.isFinite(offset.dx) &&
    Number.isFinite(offset.dy) &&
    Math.abs(offset.dx) <= MAX_COORDINATE &&
    Math.abs(offset.dy) <= MAX_COORDINATE
  );
}

export function parseEdgeRoutingStore(raw: string | null): EdgeRoutingStoreV1 {
  if (!raw || raw.length > MAX_RAW_STORE_LENGTH) return emptyEdgeRoutingStore();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyEdgeRoutingStore();
    const candidate = parsed as {
      version?: unknown;
      diagrams?: unknown;
    };
    if (
      candidate.version !== 1 ||
      !candidate.diagrams ||
      typeof candidate.diagrams !== "object" ||
      Array.isArray(candidate.diagrams)
    ) {
      return emptyEdgeRoutingStore();
    }

    const diagrams: Record<string, DiagramRoutes> = {};
    for (const [diagramKey, diagramValue] of Object.entries(candidate.diagrams)) {
      if (!diagramKey || !diagramValue || typeof diagramValue !== "object") continue;
      const diagram = diagramValue as { touchedAt?: unknown; edges?: unknown };
      if (
        typeof diagram.touchedAt !== "number" ||
        !Number.isFinite(diagram.touchedAt) ||
        !diagram.edges ||
        typeof diagram.edges !== "object" ||
        Array.isArray(diagram.edges)
      ) {
        continue;
      }

      const edges: Record<string, EdgeRoute> = {};
      for (const [edgeId, routeValue] of Object.entries(diagram.edges)) {
        if (!edgeId || edgeId.length > 256 || !routeValue || typeof routeValue !== "object") {
          continue;
        }
        const points = sanitizePoints((routeValue as { points?: unknown }).points);
        if (points?.length) edges[edgeId] = { points };
      }
      if (Object.keys(edges).length) {
        diagrams[diagramKey] = { touchedAt: diagram.touchedAt, edges: Object.fromEntries(Object.entries(edges).slice(0, MAX_EDGES_PER_DIAGRAM)) };
      }
    }
    const retained = Object.entries(diagrams).sort((a, b) => b[1].touchedAt - a[1].touchedAt).slice(0, MAX_STORED_DIAGRAMS);
    return { version: 1, diagrams: Object.fromEntries(retained) };
  } catch {
    return emptyEdgeRoutingStore();
  }
}

function parseV2Envelope(raw: string | null): {
  valid: boolean;
  store: EdgeRoutingStoreV2;
} {
  const empty = emptyEdgeRoutingStoreV2();
  if (!raw || raw.length > MAX_RAW_STORE_LENGTH) return { valid: false, store: empty };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { valid: false, store: empty };
    }
    const candidate = parsed as { version?: unknown; diagrams?: unknown };
    if (
      candidate.version !== 2 ||
      !candidate.diagrams ||
      typeof candidate.diagrams !== "object" ||
      Array.isArray(candidate.diagrams)
    ) {
      return { valid: false, store: empty };
    }

    const diagrams: Record<string, DiagramRoutesV2> = {};
    for (const [diagramKey, value] of Object.entries(candidate.diagrams)) {
      if (
        !diagramKey ||
        diagramKey.length > MAX_ID_LENGTH ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        continue;
      }
      const diagram = value as {
        touchedAt?: unknown;
        defaultMode?: unknown;
        nodes?: unknown;
        edges?: unknown;
      };
      if (
        typeof diagram.touchedAt !== "number" ||
        !Number.isFinite(diagram.touchedAt) ||
        !diagram.nodes ||
        typeof diagram.nodes !== "object" ||
        Array.isArray(diagram.nodes) ||
        !diagram.edges ||
        typeof diagram.edges !== "object" ||
        Array.isArray(diagram.edges)
      ) {
        continue;
      }

      const nodes: Record<string, NodeOffset> = {};
      for (const [nodeId, offset] of Object.entries(diagram.nodes)) {
        if (
          nodeId &&
          nodeId.length <= MAX_ID_LENGTH &&
          validNodeOffset(offset)
        ) {
          nodes[nodeId] = { dx: offset.dx, dy: offset.dy };
        }
      }

      const edges: Record<string, EdgeRouteV2> = {};
      for (const [edgeId, routeValue] of Object.entries(diagram.edges)) {
        if (
          !edgeId ||
          edgeId.length > MAX_ID_LENGTH ||
          !routeValue ||
          typeof routeValue !== "object" ||
          Array.isArray(routeValue)
        ) {
          continue;
        }
        const route = routeValue as { points?: unknown; mode?: unknown };
        const points = sanitizePoints(route.points);
        if (!points) continue;
        const mode = validMode(route.mode) ? route.mode : undefined;
        if (!points.length && !mode) continue;
        edges[edgeId] = mode ? { points, mode } : { points };
      }

      diagrams[diagramKey] = {
        touchedAt: diagram.touchedAt,
        defaultMode: validMode(diagram.defaultMode) ? diagram.defaultMode : "corner",
        nodes: Object.fromEntries(Object.entries(nodes).slice(0, MAX_NODES_PER_DIAGRAM)),
        edges: Object.fromEntries(Object.entries(edges).slice(0, MAX_EDGES_PER_DIAGRAM)),
      };
    }
    const retained = Object.entries(diagrams).sort((a, b) => b[1].touchedAt - a[1].touchedAt).slice(0, MAX_STORED_DIAGRAMS);
    return { valid: true, store: { version: 2, diagrams: Object.fromEntries(retained) } };
  } catch {
    return { valid: false, store: empty };
  }
}

export function parseEdgeRoutingStoreV2(raw: string | null): EdgeRoutingStoreV2 {
  return parseV2Envelope(raw).store;
}

export function migrateEdgeRoutingStoreV1(
  store: EdgeRoutingStoreV1,
): EdgeRoutingStoreV2 {
  const migrated = emptyEdgeRoutingStoreV2();
  for (const [diagramKey, diagram] of Object.entries(store.diagrams)) {
    const edges: Record<string, EdgeRouteV2> = {};
    for (const [edgeId, route] of Object.entries(diagram.edges)) {
      const points = sanitizePoints(route.points);
      if (points?.length) edges[edgeId] = { points };
    }
    migrated.diagrams[diagramKey] = {
      touchedAt: diagram.touchedAt,
      defaultMode: "corner",
      nodes: {},
      edges: Object.fromEntries(Object.entries(edges).slice(0, MAX_EDGES_PER_DIAGRAM)),
    };
  }
  pruneDiagramsV2(migrated);
  return migrated;
}

export function loadEdgeRoutingStoreV2(
  v2Raw: string | null,
  v1Raw: string | null,
): EdgeRoutingStoreV2 {
  const v2 = parseV2Envelope(v2Raw);
  const migrated = migrateEdgeRoutingStoreV1(parseEdgeRoutingStore(v1Raw));
  if (!v2.valid) return migrated;
  const merged = copyStoreV2(v2.store);
  for (const [diagramKey, diagram] of Object.entries(migrated.diagrams)) {
    if (!Object.hasOwn(merged.diagrams, diagramKey)) {
      merged.diagrams[diagramKey] = diagram;
    }
  }
  pruneDiagramsV2(merged);
  return merged;
}

function copyStore(store: EdgeRoutingStoreV1): EdgeRoutingStoreV1 {
  const diagrams: Record<string, DiagramRoutes> = {};
  for (const [diagramKey, diagram] of Object.entries(store.diagrams)) {
    const edges: Record<string, EdgeRoute> = {};
    for (const [edgeId, route] of Object.entries(diagram.edges)) {
      edges[edgeId] = { points: route.points.map((point) => ({ ...point })) };
    }
    diagrams[diagramKey] = { touchedAt: diagram.touchedAt, edges };
  }
  return { version: 1, diagrams };
}

function copyStoreV2(store: EdgeRoutingStoreV2): EdgeRoutingStoreV2 {
  const diagrams: Record<string, DiagramRoutesV2> = {};
  for (const [diagramKey, diagram] of Object.entries(store.diagrams)) {
    const nodes: Record<string, NodeOffset> = {};
    for (const [nodeId, offset] of Object.entries(diagram.nodes)) {
      nodes[nodeId] = { ...offset };
    }
    const edges: Record<string, EdgeRouteV2> = {};
    for (const [edgeId, route] of Object.entries(diagram.edges)) {
      const points = route.points.map((point) => ({ ...point }));
      edges[edgeId] = route.mode ? { points, mode: route.mode } : { points };
    }
    diagrams[diagramKey] = {
      touchedAt: diagram.touchedAt,
      defaultMode: diagram.defaultMode,
      nodes,
      edges,
    };
  }
  return { version: 2, diagrams };
}

function pruneDiagrams(store: EdgeRoutingStoreV1): void {
  const entries = Object.entries(store.diagrams);
  if (entries.length <= MAX_STORED_DIAGRAMS) return;
  entries
    .sort((left, right) => right[1].touchedAt - left[1].touchedAt)
    .slice(MAX_STORED_DIAGRAMS)
    .forEach(([diagramKey]) => delete store.diagrams[diagramKey]);
}

function pruneDiagramsV2(store: EdgeRoutingStoreV2): void {
  const entries = Object.entries(store.diagrams);
  if (entries.length <= MAX_STORED_DIAGRAMS) return;
  entries
    .sort((left, right) => right[1].touchedAt - left[1].touchedAt)
    .slice(MAX_STORED_DIAGRAMS)
    .forEach(([diagramKey]) => delete store.diagrams[diagramKey]);
}

function ensureDiagramV2(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
  touchedAt: number,
): DiagramRoutesV2 {
  return (
    store.diagrams[diagramKey] ?? {
      touchedAt,
      defaultMode: "corner",
      nodes: {},
      edges: {},
    }
  );
}

export function setEdgeRoute(
  store: EdgeRoutingStoreV1,
  diagramKey: string,
  edgeId: string,
  points: RoutePoint[],
  touchedAt = Date.now(),
): EdgeRoutingStoreV1 {
  const next = copyStore(store);
  const sanitized = sanitizePoints(points);
  if (!diagramKey || !edgeId || edgeId.length > 256 || !sanitized?.length) return next;
  const diagram = next.diagrams[diagramKey] ?? { touchedAt, edges: {} };
  if (
    !diagram.edges[edgeId] &&
    Object.keys(diagram.edges).length >= MAX_EDGES_PER_DIAGRAM
  ) {
    return next;
  }
  diagram.touchedAt = touchedAt;
  diagram.edges[edgeId] = { points: sanitized };
  next.diagrams[diagramKey] = diagram;
  pruneDiagrams(next);
  return next;
}

export function removeEdgeRoute(
  store: EdgeRoutingStoreV1,
  diagramKey: string,
  edgeId: string,
  touchedAt = Date.now(),
): EdgeRoutingStoreV1 {
  const next = copyStore(store);
  const diagram = next.diagrams[diagramKey];
  if (!diagram) return next;
  delete diagram.edges[edgeId];
  if (Object.keys(diagram.edges).length) diagram.touchedAt = touchedAt;
  else delete next.diagrams[diagramKey];
  return next;
}

export function clearDiagramRoutes(
  store: EdgeRoutingStoreV1,
  diagramKey: string,
): EdgeRoutingStoreV1 {
  const next = copyStore(store);
  delete next.diagrams[diagramKey];
  return next;
}

export function getDiagramRoutes(
  store: EdgeRoutingStoreV1,
  diagramKey: string,
): Record<string, EdgeRoute> {
  return store.diagrams[diagramKey]?.edges ?? {};
}

export function getDiagramRoutingConfig(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
): DiagramRoutesV2 | undefined {
  return store.diagrams[diagramKey];
}

export function setNodeOffset(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
  nodeId: string,
  offset: NodeOffset,
  touchedAt = Date.now(),
): EdgeRoutingStoreV2 {
  const next = copyStoreV2(store);
  if (
    !diagramKey ||
    !nodeId ||
    nodeId.length > MAX_ID_LENGTH ||
    !validNodeOffset(offset)
  ) {
    return next;
  }
  const diagram = ensureDiagramV2(next, diagramKey, touchedAt);
  if (
    !diagram.nodes[nodeId] &&
    Object.keys(diagram.nodes).length >= MAX_NODES_PER_DIAGRAM
  ) {
    return next;
  }
  diagram.nodes[nodeId] = { dx: offset.dx, dy: offset.dy };
  diagram.touchedAt = touchedAt;
  next.diagrams[diagramKey] = diagram;
  pruneDiagramsV2(next);
  return next;
}

export function removeNodeOffset(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
  nodeId: string,
  touchedAt = Date.now(),
): EdgeRoutingStoreV2 {
  const next = copyStoreV2(store);
  const diagram = next.diagrams[diagramKey];
  if (!diagram) return next;
  delete diagram.nodes[nodeId];
  diagram.touchedAt = touchedAt;
  return next;
}

export function setDiagramDefaultMode(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
  mode: EdgeRoutingMode,
  touchedAt = Date.now(),
): EdgeRoutingStoreV2 {
  const next = copyStoreV2(store);
  if (!diagramKey || !validMode(mode)) return next;
  const diagram = ensureDiagramV2(next, diagramKey, touchedAt);
  diagram.defaultMode = mode;
  diagram.touchedAt = touchedAt;
  next.diagrams[diagramKey] = diagram;
  pruneDiagramsV2(next);
  return next;
}

export function setEdgeRouteV2(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
  edgeId: string,
  points: RoutePoint[],
  touchedAt = Date.now(),
): EdgeRoutingStoreV2 {
  const next = copyStoreV2(store);
  const sanitized = sanitizePoints(points);
  if (
    !diagramKey ||
    !edgeId ||
    edgeId.length > MAX_ID_LENGTH ||
    !sanitized?.length
  ) {
    return next;
  }
  const diagram = ensureDiagramV2(next, diagramKey, touchedAt);
  if (
    !diagram.edges[edgeId] &&
    Object.keys(diagram.edges).length >= MAX_EDGES_PER_DIAGRAM
  ) {
    return next;
  }
  const mode = diagram.edges[edgeId]?.mode;
  diagram.edges[edgeId] = mode
    ? { points: sanitized, mode }
    : { points: sanitized };
  diagram.touchedAt = touchedAt;
  next.diagrams[diagramKey] = diagram;
  pruneDiagramsV2(next);
  return next;
}

export function setEdgeModeV2(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
  edgeId: string,
  mode: EdgeRoutingMode | undefined,
  touchedAt = Date.now(),
): EdgeRoutingStoreV2 {
  const next = copyStoreV2(store);
  if (
    !diagramKey ||
    !edgeId ||
    edgeId.length > MAX_ID_LENGTH ||
    (mode !== undefined && !validMode(mode))
  ) {
    return next;
  }
  const diagram = ensureDiagramV2(next, diagramKey, touchedAt);
  const current = diagram.edges[edgeId];
  if (!current && mode === undefined) return next;
  if (
    !current &&
    Object.keys(diagram.edges).length >= MAX_EDGES_PER_DIAGRAM
  ) {
    return next;
  }
  const points = current?.points.map((point) => ({ ...point })) ?? [];
  if (mode === undefined && !points.length) delete diagram.edges[edgeId];
  else diagram.edges[edgeId] = mode ? { points, mode } : { points };
  diagram.touchedAt = touchedAt;
  next.diagrams[diagramKey] = diagram;
  pruneDiagramsV2(next);
  return next;
}

export function clearEdgePointsV2(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
  edgeId: string,
  touchedAt = Date.now(),
): EdgeRoutingStoreV2 {
  const next = copyStoreV2(store);
  const diagram = next.diagrams[diagramKey];
  const route = diagram?.edges[edgeId];
  if (!diagram || !route) return next;
  if (route.mode) diagram.edges[edgeId] = { points: [], mode: route.mode };
  else delete diagram.edges[edgeId];
  diagram.touchedAt = touchedAt;
  return next;
}

export function removeEdgeRouteV2(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
  edgeId: string,
  touchedAt = Date.now(),
): EdgeRoutingStoreV2 {
  const next = copyStoreV2(store);
  const diagram = next.diagrams[diagramKey];
  if (!diagram) return next;
  delete diagram.edges[edgeId];
  diagram.touchedAt = touchedAt;
  return next;
}

export function clearDiagramRoutesV2(
  store: EdgeRoutingStoreV2,
  diagramKey: string,
  touchedAt = Date.now(),
): EdgeRoutingStoreV2 {
  const next = copyStoreV2(store);
  if (!diagramKey) return next;
  next.diagrams[diagramKey] = {
    touchedAt,
    defaultMode: "corner",
    nodes: {},
    edges: {},
  };
  pruneDiagramsV2(next);
  return next;
}

export function effectiveEdgeMode(
  diagram: DiagramRoutesV2 | undefined,
  edgeId: string,
): EdgeRoutingMode {
  return diagram?.edges[edgeId]?.mode ?? diagram?.defaultMode ?? "corner";
}

export async function diagramRoutingKey(source: string, theme: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${theme}\u0000${source}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function decodeMermaidPoints(encoded: string | undefined): RoutePoint[] {
  if (!encoded || encoded.length > 100_000) return [];
  try {
    const decoded = atob(encoded);
    const points = sanitizePoints(JSON.parse(decoded));
    return points ?? [];
  } catch {
    return [];
  }
}

function formatCoordinate(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function samePoint(left: RoutePoint, right: RoutePoint): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function distance(left: RoutePoint, right: RoutePoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function roundedRoutePath(points: RoutePoint[], radius = 8): string {
  const usable = points.filter(validPoint).filter((point, index, all) => {
    return index === 0 || !samePoint(point, all[index - 1]);
  });
  if (usable.length < 2) return "";

  const commands = [`M ${formatCoordinate(usable[0].x)} ${formatCoordinate(usable[0].y)}`];
  for (let index = 1; index < usable.length - 1; index += 1) {
    const previous = usable[index - 1];
    const current = usable[index];
    const next = usable[index + 1];
    const incomingLength = distance(previous, current);
    const outgoingLength = distance(current, next);
    const cornerRadius = Math.max(
      0,
      Math.min(radius, incomingLength / 2, outgoingLength / 2),
    );
    if (cornerRadius < 0.001) {
      commands.push(`L ${formatCoordinate(current.x)} ${formatCoordinate(current.y)}`);
      continue;
    }
    const before = {
      x: current.x + ((previous.x - current.x) * cornerRadius) / incomingLength,
      y: current.y + ((previous.y - current.y) * cornerRadius) / incomingLength,
    };
    const after = {
      x: current.x + ((next.x - current.x) * cornerRadius) / outgoingLength,
      y: current.y + ((next.y - current.y) * cornerRadius) / outgoingLength,
    };
    commands.push(
      `L ${formatCoordinate(before.x)} ${formatCoordinate(before.y)}`,
      `Q ${formatCoordinate(current.x)} ${formatCoordinate(current.y)} ${formatCoordinate(after.x)} ${formatCoordinate(after.y)}`,
    );
  }
  const last = usable[usable.length - 1];
  commands.push(`L ${formatCoordinate(last.x)} ${formatCoordinate(last.y)}`);
  return commands.join(" ");
}

function dedupeRoutePoints(points: RoutePoint[]): RoutePoint[] {
  const result: RoutePoint[] = [];
  for (const point of points) {
    if (
      validPoint(point) &&
      (!result.length || !samePoint(result[result.length - 1], point))
    ) {
      result.push({ ...point });
    }
  }
  return result;
}

function roundedRoutePolyline(points: RoutePoint[], radius: number): RoutePoint[] {
  const usable = dedupeRoutePoints(points);
  if (usable.length < 2 || radius <= 0) return usable;
  const result: RoutePoint[] = [{ ...usable[0] }];
  for (let index = 1; index < usable.length - 1; index += 1) {
    const previous = usable[index - 1];
    const current = usable[index];
    const next = usable[index + 1];
    const incoming = distance(previous, current);
    const outgoing = distance(current, next);
    const r = Math.min(radius, incoming / 2, outgoing / 2);
    if (r < 0.001) {
      result.push({ ...current });
      continue;
    }
    const before = {
      x: current.x + ((previous.x - current.x) * r) / incoming,
      y: current.y + ((previous.y - current.y) * r) / incoming,
    };
    const after = {
      x: current.x + ((next.x - current.x) * r) / outgoing,
      y: current.y + ((next.y - current.y) * r) / outgoing,
    };
    result.push(before);
    // A quadratic is flattened deterministically; this captures the actual Q
    // geometry rather than checking only the underlying polyline.
    for (let step = 1; step <= 8; step += 1) {
      const t = step / 8;
      const one = 1 - t;
      result.push({
        x: one * one * before.x + 2 * one * t * current.x + t * t * after.x,
        y: one * one * before.y + 2 * one * t * current.y + t * t * after.y,
      });
    }
  }
  result.push({ ...usable[usable.length - 1] });
  return result;
}

function limitControlPoint(
  control: RoutePoint,
  anchor: RoutePoint,
  limit: number,
  bounds?: ViewBoxBounds,
): RoutePoint {
  const controlDistance = distance(anchor, control);
  let limited = control;
  if (controlDistance > limit && controlDistance > 0) {
    limited = {
      x: anchor.x + ((control.x - anchor.x) * limit) / controlDistance,
      y: anchor.y + ((control.y - anchor.y) * limit) / controlDistance,
    };
  }
  return bounds ? clampRoutePoint(limited, bounds) : limited;
}

interface CubicSegment {
  start: RoutePoint;
  control1: RoutePoint;
  control2: RoutePoint;
  end: RoutePoint;
}

function smoothCubicSegments(
  points: RoutePoint[],
  bounds?: ViewBoxBounds,
  tension = 0.5,
): CubicSegment[] {
  const usable = dedupeRoutePoints(points);
  const strength = Math.max(0, Math.min(1, tension));
  const segments: CubicSegment[] = [];
  for (let index = 0; index < usable.length - 1; index += 1) {
    const start = usable[index];
    const end = usable[index + 1];
    const previous = usable[index - 1] ?? start;
    const next = usable[index + 2] ?? end;
    const segmentLength = distance(start, end);
    if (segmentLength < 0.001) continue;

    const previousLength = distance(previous, start) || segmentLength;
    const nextLength = distance(end, next) || segmentLength;
    const dt0 = Math.sqrt(Math.max(previousLength, 0.001));
    const dt1 = Math.sqrt(Math.max(segmentLength, 0.001));
    const dt2 = Math.sqrt(Math.max(nextLength, 0.001));
    const tangent1Scale = (strength * dt1) / Math.max(0.001, dt0 + dt1);
    const tangent2Scale = (strength * dt1) / Math.max(0.001, dt1 + dt2);

    let control1 = {
      x: start.x + ((end.x - previous.x) * tangent1Scale) / 3,
      y: start.y + ((end.y - previous.y) * tangent1Scale) / 3,
    };
    let control2 = {
      x: end.x - ((next.x - start.x) * tangent2Scale) / 3,
      y: end.y - ((next.y - start.y) * tangent2Scale) / 3,
    };
    control1 = limitControlPoint(
      control1,
      start,
      Math.min(previousLength / 2, segmentLength / 2),
      bounds,
    );
    control2 = limitControlPoint(
      control2,
      end,
      Math.min(nextLength / 2, segmentLength / 2),
      bounds,
    );
    segments.push({ start, control1, control2, end });
  }
  return segments;
}

export function smoothRoutePath(
  points: RoutePoint[],
  bounds?: ViewBoxBounds,
  tension = 0.5,
): string {
  const usable = dedupeRoutePoints(points);
  if (usable.length < 2) return "";
  if (usable.length === 2) {
    return `M ${formatCoordinate(usable[0].x)} ${formatCoordinate(usable[0].y)} L ${formatCoordinate(usable[1].x)} ${formatCoordinate(usable[1].y)}`;
  }
  const segments = smoothCubicSegments(usable, bounds, tension);
  if (segments.length !== usable.length - 1) return roundedRoutePath(usable, 0);
  const commands = [
    `M ${formatCoordinate(usable[0].x)} ${formatCoordinate(usable[0].y)}`,
  ];
  for (const segment of segments) {
    if (
      !validPoint(segment.control1) ||
      !validPoint(segment.control2) ||
      !validPoint(segment.end)
    ) {
      commands.push(
        `L ${formatCoordinate(segment.end.x)} ${formatCoordinate(segment.end.y)}`,
      );
      continue;
    }
    commands.push(
      `C ${formatCoordinate(segment.control1.x)} ${formatCoordinate(segment.control1.y)} ${formatCoordinate(segment.control2.x)} ${formatCoordinate(segment.control2.y)} ${formatCoordinate(segment.end.x)} ${formatCoordinate(segment.end.y)}`,
    );
  }
  return commands.join(" ");
}

function midpoint(left: RoutePoint, right: RoutePoint): RoutePoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function flattenCubicSegment(
  segment: CubicSegment,
  tolerance: number,
  maxDepth: number,
): RoutePoint[] {
  const output: RoutePoint[] = [{ ...segment.start }];
  const visit = (
    start: RoutePoint,
    control1: RoutePoint,
    control2: RoutePoint,
    end: RoutePoint,
    depth: number,
  ): void => {
    const chord = distance(start, end);
    const polygon =
      distance(start, control1) +
      distance(control1, control2) +
      distance(control2, end);
    if (depth >= maxDepth || polygon - chord <= tolerance) {
      output.push({ ...end });
      return;
    }
    const startControl = midpoint(start, control1);
    const controls = midpoint(control1, control2);
    const controlEnd = midpoint(control2, end);
    const leftControl = midpoint(startControl, controls);
    const rightControl = midpoint(controls, controlEnd);
    const split = midpoint(leftControl, rightControl);
    visit(start, startControl, leftControl, split, depth + 1);
    visit(split, rightControl, controlEnd, end, depth + 1);
  };
  visit(
    segment.start,
    segment.control1,
    segment.control2,
    segment.end,
    0,
  );
  return output;
}

function expandBounds(bounds: ViewBoxBounds, clearance: number): ViewBoxBounds {
  return {
    x: bounds.x - clearance,
    y: bounds.y - clearance,
    width: Math.max(0, bounds.width + clearance * 2),
    height: Math.max(0, bounds.height + clearance * 2),
  };
}

function pointInsideBounds(point: RoutePoint, bounds: ViewBoxBounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function segmentIntersectsBounds(
  start: RoutePoint,
  end: RoutePoint,
  bounds: ViewBoxBounds,
): boolean {
  if (pointInsideBounds(start, bounds) || pointInsideBounds(end, bounds)) {
    return true;
  }
  let min = 0;
  let max = 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const checks: Array<[number, number]> = [
    [-dx, start.x - bounds.x],
    [dx, bounds.x + bounds.width - start.x],
    [-dy, start.y - bounds.y],
    [dy, bounds.y + bounds.height - start.y],
  ];
  for (const [direction, distanceToSide] of checks) {
    if (Math.abs(direction) < 1e-9) {
      if (distanceToSide < 0) return false;
      continue;
    }
    const ratio = distanceToSide / direction;
    if (direction < 0) {
      if (ratio > max) return false;
      min = Math.max(min, ratio);
    } else {
      if (ratio < min) return false;
      max = Math.min(max, ratio);
    }
  }
  return min <= max;
}

export function routeIntersectsObstacles(
  points: RoutePoint[],
  obstacles: ViewBoxBounds[],
  clearance = 0,
  mode: EdgeRoutingMode = "corner",
  bounds?: ViewBoxBounds,
  tension = 0.5,
  cornerRadius = 8,
): boolean {
  const usable = dedupeRoutePoints(points);
  if (usable.length < 2) return false;
  const polylines: RoutePoint[][] =
    mode === "smooth"
      ? smoothCubicSegments(usable, bounds, tension).map((segment) =>
          flattenCubicSegment(segment, 0.5, 8),
        )
      : [roundedRoutePolyline(usable, cornerRadius)];
  for (const obstacle of obstacles) {
    if (
      !Number.isFinite(obstacle.x) ||
      !Number.isFinite(obstacle.y) ||
      !Number.isFinite(obstacle.width) ||
      !Number.isFinite(obstacle.height)
    ) {
      continue;
    }
    const expanded = expandBounds(obstacle, Math.max(0, clearance));
    for (const polyline of polylines) {
      for (let index = 1; index < polyline.length; index += 1) {
        if (
          segmentIntersectsBounds(
            polyline[index - 1],
            polyline[index],
            expanded,
          )
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function safeSmoothTension(
  points: RoutePoint[],
  obstacles: ViewBoxBounds[],
  clearance: number,
  bounds?: ViewBoxBounds,
): number | null {
  for (const tension of [0.5, 0.25, 0.125]) {
    if (
      !routeIntersectsObstacles(
        points,
        obstacles,
        clearance,
        "smooth",
        bounds,
        tension,
      )
    ) {
      return tension;
    }
  }
  return null;
}

export function edgeRoutePath(
  points: RoutePoint[],
  mode: EdgeRoutingMode,
  bounds?: ViewBoxBounds,
  obstacles: ViewBoxBounds[] = [],
  clearance = 0,
): string {
  if (mode === "corner") {
    for (const radius of [8, 4, 2, 1, 0]) {
      if (!routeIntersectsObstacles(points, obstacles, clearance, "corner", bounds, 0.5, radius)) {
        return roundedRoutePath(points, radius);
      }
    }
    return "";
  }
  const tension = obstacles.length
    ? safeSmoothTension(points, obstacles, clearance, bounds)
    : 0.5;
  return tension == null ? "" : smoothRoutePath(points, bounds, tension);
}

function routeLength(points: RoutePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index]);
  }
  return total;
}

function routeBends(points: RoutePoint[]): number {
  let count = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x);
    if (Math.abs(cross) > 0.001) count += 1;
  }
  return count;
}

function normalizeCandidate(
  points: RoutePoint[],
  bounds?: ViewBoxBounds,
): RoutePoint[] {
  return dedupeRoutePoints(
    bounds ? points.map((point) => clampRoutePoint(point, bounds)) : points,
  );
}

export function autoRoute(
  start: RoutePoint,
  end: RoutePoint,
  obstacles: ViewBoxBounds[],
  options: AutoRouteOptions = {},
): RoutePoint[] | null {
  if (!validPoint(start) || !validPoint(end)) return null;
  const clearance = Math.max(0, options.clearance ?? 8);
  const mode = options.mode ?? "corner";
  const candidates: RoutePoint[][] = [
    [start, end],
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ];

  const blocking = obstacles.find((obstacle) =>
    routeIntersectsObstacles([start, end], [obstacle], clearance),
  ) ?? obstacles.find((obstacle) =>
    candidates.some((candidate) =>
      routeIntersectsObstacles(candidate, [obstacle], clearance),
    ),
  );
  if (blocking) {
    const expanded = expandBounds(blocking, clearance);
    const epsilon = 0.5;
    const top = expanded.y - epsilon;
    const bottom = expanded.y + expanded.height + epsilon;
    const left = expanded.x - epsilon;
    const right = expanded.x + expanded.width + epsilon;
    candidates.push(
      [start, { x: start.x, y: top }, { x: end.x, y: top }, end],
      [start, { x: start.x, y: bottom }, { x: end.x, y: bottom }, end],
      [start, { x: left, y: start.y }, { x: left, y: end.y }, end],
      [start, { x: right, y: start.y }, { x: right, y: end.y }, end],
    );
  }

  const scored = candidates
    .map((candidate, index) => {
      const points = normalizeCandidate(candidate, options.bounds);
      const path = edgeRoutePath(
        points,
        mode,
        options.bounds,
        obstacles,
        clearance,
      );
      return {
        points,
        index,
        valid: Boolean(path),
        bends: routeBends(points),
        length: routeLength(points),
        previousDelta: options.previous
          ? Math.abs(routeLength(points) - routeLength(options.previous))
          : 0,
      };
    })
    .filter((candidate) => candidate.valid);
  scored.sort(
    (left, right) =>
      left.bends - right.bends ||
      left.length - right.length ||
      left.previousDelta - right.previousDelta ||
      left.index - right.index,
  );
  return scored[0]?.points ?? null;
}

function fallbackBoundaryPoint(
  fallback: RoutePoint | undefined,
): RoutePoint | null {
  return fallback && validPoint(fallback) ? { ...fallback } : null;
}

export function intersectNodeBoundary(
  center: RoutePoint,
  target: RoutePoint,
  boundary: NodeBoundary,
  fallback?: RoutePoint,
): RoutePoint | null {
  if (
    !validPoint(center) ||
    !validPoint(target) ||
    !Number.isFinite(boundary.x) ||
    !Number.isFinite(boundary.y) ||
    !Number.isFinite(boundary.width) ||
    !Number.isFinite(boundary.height) ||
    boundary.width < 0 ||
    boundary.height < 0
  ) {
    return fallbackBoundaryPoint(fallback);
  }
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (Math.hypot(dx, dy) < 0.001) return fallbackBoundaryPoint(fallback);

  let ratio = Number.POSITIVE_INFINITY;
  if (boundary.kind === "circle" || boundary.kind === "ellipse") {
    const radiusX = boundary.width / 2;
    const radiusY =
      boundary.kind === "circle" ? boundary.width / 2 : boundary.height / 2;
    if (radiusX > 0 && radiusY > 0) {
      const denominator = Math.sqrt(
        (dx * dx) / (radiusX * radiusX) +
          (dy * dy) / (radiusY * radiusY),
      );
      if (denominator > 0) ratio = 1 / denominator;
    }
  } else if (boundary.kind === "polygon" && boundary.points?.length) {
    const points = boundary.points.filter(validPoint);
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      const sideX = end.x - start.x;
      const sideY = end.y - start.y;
      const denominator = dx * sideY - dy * sideX;
      if (Math.abs(denominator) < 1e-9) continue;
      const fromCenterX = start.x - center.x;
      const fromCenterY = start.y - center.y;
      const rayRatio =
        (fromCenterX * sideY - fromCenterY * sideX) / denominator;
      const sideRatio =
        (fromCenterX * dy - fromCenterY * dx) / denominator;
      if (
        rayRatio >= 0 &&
        sideRatio >= 0 &&
        sideRatio <= 1 &&
        rayRatio < ratio
      ) {
        ratio = rayRatio;
      }
    }
  } else {
    const minX = boundary.x;
    const maxX = boundary.x + boundary.width;
    const minY = boundary.y;
    const maxY = boundary.y + boundary.height;
    if (Math.abs(dx) > 1e-9) {
      for (const x of [minX, maxX]) {
        const candidate = (x - center.x) / dx;
        const y = center.y + candidate * dy;
        if (
          candidate >= 0 &&
          candidate < ratio &&
          y >= minY - 0.001 &&
          y <= maxY + 0.001
        ) {
          ratio = candidate;
        }
      }
    }
    if (Math.abs(dy) > 1e-9) {
      for (const y of [minY, maxY]) {
        const candidate = (y - center.y) / dy;
        const x = center.x + candidate * dx;
        if (
          candidate >= 0 &&
          candidate < ratio &&
          x >= minX - 0.001 &&
          x <= maxX + 0.001
        ) {
          ratio = candidate;
        }
      }
    }
  }
  return Number.isFinite(ratio)
    ? { x: center.x + dx * ratio, y: center.y + dy * ratio }
    : fallbackBoundaryPoint(fallback);
}

function squaredDistanceToSegment(
  point: RoutePoint,
  start: RoutePoint,
  end: RoutePoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!dx && !dy) return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  const closestX = start.x + ratio * dx;
  const closestY = start.y + ratio * dy;
  return (point.x - closestX) ** 2 + (point.y - closestY) ** 2;
}

/** Return the array index where a new point should be inserted. */
export function nearestRouteInsertionIndex(
  route: RoutePoint[],
  point: RoutePoint,
): number {
  if (route.length < 2) return route.length;
  let bestIndex = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length - 1; index += 1) {
    const candidate = squaredDistanceToSegment(point, route[index], route[index + 1]);
    if (candidate < bestDistance) {
      bestDistance = candidate;
      bestIndex = index + 1;
    }
  }
  return bestIndex;
}

export function clampRoutePoint(point: RoutePoint, bounds: ViewBoxBounds): RoutePoint {
  const minX = bounds.x;
  const maxX = bounds.x + Math.max(0, bounds.width);
  const minY = bounds.y;
  const maxY = bounds.y + Math.max(0, bounds.height);
  return {
    x: Math.min(maxX, Math.max(minX, point.x)),
    y: Math.min(maxY, Math.max(minY, point.y)),
  };
}

/**
 * Snap a dragged route point horizontally to the nearest adjacent point.
 *
 * The route includes edge endpoints. Previous is evaluated before next and
 * therefore wins an exact y-distance tie.
 */
export function snapCornerRoutePoint(
  route: readonly RoutePoint[],
  pointIndex: number,
  pointer: RoutePoint,
  shiftKey = true,
  mode: EdgeRoutingMode = "corner",
): RoutePoint {
  const free = { x: pointer.x, y: pointer.y };
  if (!shiftKey || mode !== "corner") return free;

  let snappedY: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidateIndex of [pointIndex - 1, pointIndex + 1]) {
    const candidate = route[candidateIndex];
    if (!candidate) continue;
    const candidateDistance = Math.abs(candidate.y - pointer.y);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      snappedY = candidate.y;
    }
  }
  return snappedY === undefined ? free : { x: pointer.x, y: snappedY };
}
