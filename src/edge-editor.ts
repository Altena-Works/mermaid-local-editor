import {
  EDGE_ROUTING_STORAGE_KEY,
  EDGE_ROUTING_STORAGE_KEY_V2,
  autoRoute,
  clampRoutePoint,
  clearDiagramRoutesV2,
  clearEdgePointsV2,
  decodeMermaidPoints,
  edgeRoutePath,
  effectiveEdgeMode,
  getDiagramRoutingConfig,
  intersectNodeBoundary,
  loadEdgeRoutingStoreV2,
  nearestRouteInsertionIndex,
  removeEdgeRouteV2,
  removeNodeOffset,
  setDiagramDefaultMode,
  setEdgeModeV2,
  setEdgeRouteV2,
  setNodeOffset,
  snapCornerRoutePoint,
  type DiagramRoutesV2,
  type EdgeRoutingMode,
  type EdgeRoutingStoreV2,
  type NodeBoundary,
  type NodeOffset,
  type RoutePoint,
  type ViewBoxBounds,
} from "./edge-routing";
import { decodeFlowchartNodeDomId } from "./mermaid-source";

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_MATCH_TOLERANCE = 8;

interface EdgeEditorControls {
  mode: HTMLButtonElement;
  tools: HTMLElement;
  reset: HTMLButtonElement;
  resetAll: HTMLButtonElement;
  defaultMode: HTMLSelectElement;
  edgeSelection: HTMLElement;
  selectedMode: HTMLSelectElement;
  reroute: HTMLButtonElement;
  nodeSelection: HTMLElement;
  nodeReset: HTMLButtonElement;
}

interface EdgeEditorOptions {
  canvas: HTMLElement;
  controls: EdgeEditorControls;
  storage: Storage;
  t: (key: string) => string;
  setStatus: (key: string) => void;
  revealNodeSource: (sourceId: string) => boolean;
}

interface OriginalInteractiveAttributes {
  tabindex: string | null;
  role: string | null;
  ariaLabel: string | null;
}

interface OriginalEdge extends OriginalInteractiveAttributes {
  pathData: string;
  labelTransform: string | null;
  endpoints: [RoutePoint, RoutePoint] | null;
  route: RoutePoint[];
}

interface NodeInfo extends OriginalInteractiveAttributes {
  element: SVGGElement;
  originalTransform: string | null;
  boundary: NodeBoundary;
}

interface EdgeAttachment {
  sourceNodeId: string;
  targetNodeId: string;
}

interface EdgeVisualSnapshot {
  pathData: string;
  hasLabel: boolean;
  labelTransform: string | null;
  autoRoute: RoutePoint[] | null;
}

interface SelectionSnapshot {
  points: RoutePoint[];
  pointIndex: number | null;
}

interface EdgeOperationSnapshot {
  edgeId: string;
  store: EdgeRoutingStoreV2;
  visual: EdgeVisualSnapshot | null;
  selection: SelectionSnapshot;
}

interface PointDragState {
  kind: "point";
  pointerId: number;
  pointIndex: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  snapshot: EdgeOperationSnapshot;
}

interface NodeDragState {
  kind: "node";
  pointerId: number;
  nodeId: string;
  startPointer: RoutePoint;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  startOffset: NodeOffset;
  lastValidOffset: NodeOffset;
  pendingPointer: RoutePoint | null;
  routeFailed: boolean;
}

type DragState = PointDragState | NodeDragState;

interface EdgePressState {
  edgeId: string;
  selectedAtPointerDown: boolean;
  startClientX: number;
  startClientY: number;
}

function offsetIsZero(offset: NodeOffset): boolean {
  return Math.abs(offset.dx) < 0.001 && Math.abs(offset.dy) < 0.001;
}

function pointDistanceToBounds(point: RoutePoint, bounds: ViewBoxBounds): number {
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  const outsideX = Math.max(bounds.x - point.x, 0, point.x - maxX);
  const outsideY = Math.max(bounds.y - point.y, 0, point.y - maxY);
  if (outsideX || outsideY) return Math.hypot(outsideX, outsideY);
  return Math.min(
    Math.abs(point.x - bounds.x),
    Math.abs(maxX - point.x),
    Math.abs(point.y - bounds.y),
    Math.abs(maxY - point.y),
  );
}

function translatedBoundary(
  boundary: NodeBoundary,
  offset: NodeOffset,
): NodeBoundary {
  return {
    ...boundary,
    x: boundary.x + offset.dx,
    y: boundary.y + offset.dy,
    points: boundary.points?.map((point) => ({
      x: point.x + offset.dx,
      y: point.y + offset.dy,
    })),
  };
}

export class EdgeRoutingEditor {
  private svg: SVGSVGElement | null = null;
  private diagramKey: string | null = null;
  private overlay: SVGSVGElement | null = null;
  private overlayHitLayer: SVGGElement | null = null;
  private overlayControlsLayer: SVGGElement | null = null;
  private hitPaths = new Map<string, SVGPathElement>();
  private supported = false;
  private nodeMovementSupported = false;
  private edgeIdsUnique = true;
  private edgeContractValid = true;
  private nodeContractValid = true;
  private enabled = false;
  private selectedEdgeId: string | null = null;
  private selectedNodeId: string | null = null;
  private selectedPointIndex: number | null = null;
  private selectedPoints: RoutePoint[] = [];
  private drag: DragState | null = null;
  private edgePress: EdgePressState | null = null;
  private suppressNodeDoubleClickUntil = 0;
  private nodeFrame: number | null = null;
  private paths = new Map<string, SVGPathElement>();
  private labels = new Map<string, SVGGElement>();
  private originals = new Map<string, OriginalEdge>();
  private nodes = new Map<string, NodeInfo>();
  private liveNodeOffsets = new Map<string, NodeOffset>();
  private attachments = new Map<string, EdgeAttachment>();
  private autoRoutes = new Map<string, RoutePoint[]>();
  private store: EdgeRoutingStoreV2;

  constructor(private options: EdgeEditorOptions) {
    this.store = this.readStore();
    const controls = options.controls;
    controls.mode.addEventListener("click", () => this.setEnabled(!this.enabled));
    controls.reset.addEventListener("click", () => this.resetSelectedEdge());
    controls.resetAll.addEventListener("click", () => this.resetAll());
    controls.defaultMode.addEventListener("change", () => this.changeDefaultMode());
    controls.selectedMode.addEventListener("change", () => this.changeSelectedMode());
    controls.reroute.addEventListener("click", () => this.rerouteSelectedEdge());
    controls.nodeReset.addEventListener("click", () => this.resetSelectedNode());
    options.canvas.addEventListener("pointerdown", this.onCanvasPointerDown);
    options.canvas.addEventListener("click", this.onCanvasClick);
    options.canvas.addEventListener("dblclick", this.onCanvasDoubleClick);
    options.canvas.addEventListener("keydown", this.onCanvasKeyDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
    this.updateControls();
  }

  attach(svg: SVGSVGElement, diagramKey: string): string | null {
    this.cancelDrag();
    this.edgePress = null;
    this.removeOverlay();
    this.restoreInteractiveAttributes();
    this.svg = svg;
    this.diagramKey = diagramKey;
    this.selectedEdgeId = null;
    this.selectedNodeId = null;
    this.selectedPointIndex = null;
    this.selectedPoints = [];
    this.paths.clear();
    this.labels.clear();
    this.originals.clear();
    this.nodes.clear();
    this.liveNodeOffsets.clear();
    this.attachments.clear();
    this.autoRoutes.clear();
    this.edgeIdsUnique = true;
    this.edgeContractValid = true;
    this.nodeContractValid = true;
    this.store = this.readStore();

    this.collectLabels();
    this.collectEdges();
    this.collectNodes();
    this.nodeMovementSupported = this.buildAttachments();
    this.supported = this.paths.size > 0;

    const config = this.currentConfig();
    if (this.nodeMovementSupported) {
      for (const [nodeId, offset] of Object.entries(config.nodes)) {
        this.applyNodeOffset(nodeId, offset);
      }
    }
    this.applyStoredRouting(config);

    let status: string | null = null;
    if (this.enabled && !this.supported) {
      this.enabled = false;
      status = "status.edgeUnsupported";
    } else if (this.enabled && !this.nodeMovementSupported) {
      status = "status.nodeMoveUnsupported";
    }
    this.options.canvas.classList.toggle("is-edge-routing", this.enabled);
    this.refreshInteractiveState();
    if (this.enabled) this.createOverlay();
    this.updateControls();
    return status;
  }

  refreshAccessibilityLabels(): void {
    if (this.enabled) {
      for (const [edgeId, path] of this.paths) {
        path.setAttribute("aria-label", `${this.options.t("edge.path")} ${edgeId}`);
      }
    }
    for (const [nodeId, node] of this.nodes) {
      const label = this.nodeAccessibilityLabel(nodeId, node);
      if (label == null) node.element.removeAttribute("aria-label");
      else node.element.setAttribute("aria-label", label);
    }
    this.options.controls.mode.setAttribute(
      "aria-label",
      this.options.t("title.edgeRouting"),
    );
    this.drawOverlay();
  }

  private collectLabels(): void {
    if (!this.svg) return;
    for (const innerLabel of this.svg.querySelectorAll<SVGGElement>(
      ".edgeLabel .label[data-id]",
    )) {
      const edgeId = innerLabel.dataset.id;
      const label = innerLabel.closest<SVGGElement>("g.edgeLabel");
      if (edgeId && label) this.labels.set(edgeId, label);
    }
  }

  private collectEdges(): void {
    if (!this.svg) return;
    for (const path of this.svg.querySelectorAll<SVGPathElement>(
      "path.flowchart-link",
    )) {
      const edgeId = path.dataset.id;
      const mermaidPoints = decodeMermaidPoints(path.dataset.points);
      if (!edgeId || edgeId.length > 256) {
        this.edgeContractValid = false;
        continue;
      }
      if (mermaidPoints.length < 2) this.edgeContractValid = false;
      if (this.paths.has(edgeId)) {
        this.edgeIdsUnique = false;
        this.edgeContractValid = false;
        continue;
      }
      const label = this.labels.get(edgeId);
      const endpoints = this.livePathEndpoints(path);
      const route =
        mermaidPoints.length >= 2
          ? mermaidPoints
          : endpoints
            ? [endpoints[0], endpoints[1]]
            : [];
      this.paths.set(edgeId, path);
      this.originals.set(edgeId, {
        pathData: path.getAttribute("d") ?? "",
        labelTransform: label?.getAttribute("transform") ?? null,
        endpoints,
        route: route.map((point) => ({ ...point })),
        tabindex: path.getAttribute("tabindex"),
        role: path.getAttribute("role"),
        ariaLabel: path.getAttribute("aria-label"),
      });
      this.autoRoutes.set(edgeId, route.map((point) => ({ ...point })));
    }
  }

  private collectNodes(): void {
    if (!this.svg) return;
    for (const element of this.svg.querySelectorAll<SVGGElement>("g.node")) {
      const nodeId = element.id;
      if (!nodeId || nodeId.length > 256 || this.nodes.has(nodeId)) {
        this.nodeContractValid = false;
        this.nodes.clear();
        return;
      }
      const boundary = this.measureNodeBoundary(element);
      if (!boundary) {
        this.nodeContractValid = false;
        this.nodes.clear();
        return;
      }
      this.nodes.set(nodeId, {
        element,
        originalTransform: element.getAttribute("transform"),
        boundary,
        tabindex: element.getAttribute("tabindex"),
        role: element.getAttribute("role"),
        ariaLabel: element.getAttribute("aria-label"),
      });
    }
  }

  private buildAttachments(): boolean {
    if (
      !this.edgeIdsUnique ||
      !this.edgeContractValid ||
      !this.nodeContractValid ||
      !this.nodes.size ||
      !this.paths.size
    ) return false;
    const attachments = new Map<string, EdgeAttachment>();
    for (const [edgeId, original] of this.originals) {
      if (!original.endpoints) return false;
      const sourceNodeId = this.matchNode(original.endpoints[0]);
      const targetNodeId = this.matchNode(original.endpoints[1]);
      if (!sourceNodeId || !targetNodeId) return false;
      attachments.set(edgeId, { sourceNodeId, targetNodeId });
    }
    this.attachments = attachments;
    return attachments.size === this.paths.size;
  }

  private matchNode(point: RoutePoint): string | null {
    const matches = Array.from(this.nodes.entries())
      .map(([nodeId, node]) => ({
        nodeId,
        distance: pointDistanceToBounds(point, node.boundary),
      }))
      .filter((match) => match.distance <= NODE_MATCH_TOLERANCE)
      .sort(
        (left, right) =>
          left.distance - right.distance ||
          left.nodeId.localeCompare(right.nodeId),
      );
    if (!matches.length) return null;
    if (
      matches[1] &&
      Math.abs(matches[0].distance - matches[1].distance) < 0.001
    ) {
      return null;
    }
    return matches[0].nodeId;
  }

  private measureNodeBoundary(element: SVGGElement): NodeBoundary | null {
    if (!this.svg) return null;
    try {
      const box = element.getBBox();
      const matrix = element.getCTM();
      if (!matrix) return null;
      const corners = [
        this.transformLocalPoint(box.x, box.y, matrix),
        this.transformLocalPoint(box.x + box.width, box.y, matrix),
        this.transformLocalPoint(box.x, box.y + box.height, matrix),
        this.transformLocalPoint(box.x + box.width, box.y + box.height, matrix),
      ];
      const xs = corners.map((point) => point.x);
      const ys = corners.map((point) => point.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const width = Math.max(...xs) - x;
      const height = Math.max(...ys) - y;
      const shape = element.querySelector<SVGGraphicsElement>(
        "rect, circle, ellipse, polygon",
      );
      const tag = shape?.tagName.toLowerCase();
      const kind: NodeBoundary["kind"] =
        tag === "circle" ||
        tag === "ellipse" ||
        tag === "polygon" ||
        tag === "rect"
          ? tag
          : "unknown";
      const points =
        kind === "polygon" && shape
          ? this.polygonPoints(shape as SVGPolygonElement)
          : undefined;
      return { kind, x, y, width, height, points };
    } catch {
      return null;
    }
  }

  private polygonPoints(polygon: SVGPolygonElement): RoutePoint[] | undefined {
    const matrix = polygon.getCTM();
    if (!matrix) return undefined;
    const points: RoutePoint[] = [];
    for (let index = 0; index < polygon.points.numberOfItems; index += 1) {
      const point = polygon.points.getItem(index);
      points.push(this.transformLocalPoint(point.x, point.y, matrix));
    }
    return points.length >= 3 ? points : undefined;
  }

  private transformLocalPoint(
    x: number,
    y: number,
    matrix: DOMMatrix,
  ): RoutePoint {
    const point = this.svg!.createSVGPoint();
    point.x = x;
    point.y = y;
    const transformed = point.matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  }

  private readStore(): EdgeRoutingStoreV2 {
    try {
      return loadEdgeRoutingStoreV2(
        this.options.storage.getItem(EDGE_ROUTING_STORAGE_KEY_V2),
        this.options.storage.getItem(EDGE_ROUTING_STORAGE_KEY),
      );
    } catch {
      return loadEdgeRoutingStoreV2(null, null);
    }
  }

  private writeStore(next: EdgeRoutingStoreV2): boolean {
    try {
      this.options.storage.setItem(
        EDGE_ROUTING_STORAGE_KEY_V2,
        JSON.stringify(next),
      );
      this.store = next;
      return true;
    } catch {
      this.options.setStatus("status.edgeSaveFailed");
      return false;
    }
  }

  private currentConfig(): DiagramRoutesV2 {
    return (
      (this.diagramKey
        ? getDiagramRoutingConfig(this.store, this.diagramKey)
        : undefined) ?? {
        touchedAt: 0,
        defaultMode: "corner",
        nodes: {},
        edges: {},
      }
    );
  }

  private applyStoredRouting(config: DiagramRoutesV2): void {
    for (const edgeId of this.paths.keys()) {
      const stored = config.edges[edgeId];
      if (stored?.points.length) this.applyManualRoute(edgeId, stored.points);
      else if (this.takesOverEdgeGeometry(edgeId)) this.autoRouteEdge(edgeId);
    }
  }

  /**
   * Whether a re-render would replace Mermaid's own geometry for this edge.
   *
   * Automatic routes are deliberately not persisted, so an edge with no manual
   * points on unmoved nodes is drawn by Mermaid after every render. Reset,
   * reroute and mode changes must agree with this or the shape shown right
   * after the action silently changes on the next render.
   */
  private takesOverEdgeGeometry(edgeId: string): boolean {
    const config = this.currentConfig();
    const attachment = this.attachments.get(edgeId);
    const moved =
      attachment !== undefined &&
      (!offsetIsZero(this.nodeOffset(attachment.sourceNodeId)) ||
        !offsetIsZero(this.nodeOffset(attachment.targetNodeId)));
    return (
      moved ||
      config.defaultMode === "smooth" ||
      config.edges[edgeId]?.mode !== undefined
    );
  }

  /** Draw an edge that has no manual points, matching what a re-render shows. */
  private applyAutomaticEdge(edgeId: string): boolean {
    if (this.takesOverEdgeGeometry(edgeId)) return this.autoRouteEdge(edgeId);
    this.restoreOriginalEdge(edgeId);
    return true;
  }

  private setEnabled(enabled: boolean): void {
    if (enabled && !this.supported) {
      this.options.setStatus("status.edgeUnsupported");
      this.enabled = false;
      this.updateControls();
      return;
    }
    this.enabled = enabled;
    this.options.canvas.classList.toggle("is-edge-routing", enabled);
    this.refreshInteractiveState();
    if (enabled) {
      this.createOverlay();
      this.options.setStatus("status.edgeModeEnabled");
    } else {
      this.deselect();
      this.removeOverlay();
      this.options.setStatus("status.edgeModeDisabled");
    }
    this.updateControls();
  }

  private refreshInteractiveState(): void {
    for (const [edgeId, path] of this.paths) {
      const original = this.originals.get(edgeId);
      if (this.enabled) {
        path.setAttribute("tabindex", "0");
        path.setAttribute("role", "button");
        path.dataset.mleEdgeInteractive = "true";
        path.setAttribute("aria-label", `${this.options.t("edge.path")} ${edgeId}`);
      } else if (original) {
        this.restoreAttribute(path, "tabindex", original.tabindex);
        this.restoreAttribute(path, "role", original.role);
        this.restoreAttribute(path, "aria-label", original.ariaLabel);
        delete path.dataset.mleEdgeInteractive;
      }
    }
    for (const [nodeId, node] of this.nodes) {
      const navigationLabel = this.nodeAccessibilityLabel(nodeId, node);
      if (this.enabled && this.nodeMovementSupported) {
        node.element.setAttribute("tabindex", "0");
        node.element.setAttribute("role", "button");
        node.element.dataset.mleEdgeInteractive = "true";
        node.element.setAttribute("aria-label", navigationLabel ?? nodeId);
      } else {
        this.restoreAttribute(node.element, "tabindex", node.tabindex);
        this.restoreAttribute(node.element, "role", node.role);
        if (navigationLabel == null) node.element.removeAttribute("aria-label");
        else node.element.setAttribute("aria-label", navigationLabel);
        delete node.element.dataset.mleEdgeInteractive;
      }
    }
  }

  private restoreInteractiveAttributes(): void {
    for (const [edgeId, path] of this.paths) {
      const original = this.originals.get(edgeId);
      if (!original) continue;
      this.restoreAttribute(path, "tabindex", original.tabindex);
      this.restoreAttribute(path, "role", original.role);
      this.restoreAttribute(path, "aria-label", original.ariaLabel);
      delete path.dataset.mleEdgeInteractive;
    }
    for (const node of this.nodes.values()) {
      this.restoreAttribute(node.element, "tabindex", node.tabindex);
      this.restoreAttribute(node.element, "role", node.role);
      this.restoreAttribute(node.element, "aria-label", node.ariaLabel);
      delete node.element.dataset.mleEdgeInteractive;
    }
  }

  private restoreAttribute(
    element: Element,
    name: string,
    value: string | null,
  ): void {
    if (value == null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }

  private nodeAccessibilityLabel(nodeId: string, node: NodeInfo): string | null {
    const base = node.ariaLabel ?? nodeId;
    return this.sourceNodeId(nodeId)
      ? `${base}. ${this.options.t("node.sourceJumpHint")}`
      : node.ariaLabel;
  }

  /** Mermaid prefixes node DOM IDs with the SVG root ID it was rendered under. */
  private sourceNodeId(nodeDomId: string): string | null {
    return decodeFlowchartNodeDomId(nodeDomId, this.svg?.id ?? null);
  }

  private updateControls(): void {
    const controls = this.options.controls;
    controls.mode.setAttribute("aria-pressed", String(this.enabled));
    controls.mode.classList.toggle("is-active", this.enabled);
    controls.tools.hidden = !this.enabled;
    controls.edgeSelection.hidden = !this.enabled || !this.selectedEdgeId;
    controls.nodeSelection.hidden = !this.enabled || !this.selectedNodeId;
    const config = this.currentConfig();
    controls.defaultMode.value = config.defaultMode;
    controls.selectedMode.value = this.selectedEdgeId
      ? config.edges[this.selectedEdgeId]?.mode ?? "inherit"
      : "inherit";
    controls.reset.disabled =
      !this.selectedEdgeId || !config.edges[this.selectedEdgeId];
    controls.reroute.disabled = !this.selectedEdgeId;
    controls.nodeReset.disabled =
      !this.selectedNodeId || !config.nodes[this.selectedNodeId];
    controls.resetAll.disabled =
      config.defaultMode === "corner" &&
      Object.keys(config.nodes).length === 0 &&
      Object.keys(config.edges).length === 0;
  }

  private edgeFromTarget(target: EventTarget | null): SVGPathElement | null {
    if (!(target instanceof Element) || !this.svg) return null;
    const hitPath = target.closest<SVGPathElement>(
      "path.edge-route-hit[data-edge-id]",
    );
    if (hitPath?.ownerSVGElement === this.overlay) {
      const edgeId = hitPath.dataset.edgeId;
      return edgeId ? this.paths.get(edgeId) ?? null : null;
    }
    const path = target.closest<SVGPathElement>(
      "path.flowchart-link[data-id]",
    );
    return path?.ownerSVGElement === this.svg ? path : null;
  }

  private nodeFromTarget(target: EventTarget | null): SVGGElement | null {
    if (!(target instanceof Element) || !this.svg) return null;
    const node = target.closest<SVGGElement>("g.node[id]");
    return node?.ownerSVGElement === this.svg ? node : null;
  }

  private onCanvasPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return;
    this.edgePress = null;
    const node = this.nodeFromTarget(event.target);
    if (node) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.nodeMovementSupported) {
        this.options.setStatus("status.nodeMoveUnsupported");
        return;
      }
      this.selectNode(node.id);
      const startPointer = this.toSvgPoint(event.clientX, event.clientY, false);
      if (!startPointer) return;
      this.drag = {
        kind: "node",
        pointerId: event.pointerId,
        nodeId: node.id,
        startPointer,
        startClientX: event.clientX,
        startClientY: event.clientY,
        moved: false,
        startOffset: this.nodeOffset(node.id),
        lastValidOffset: this.nodeOffset(node.id),
        pendingPointer: null,
        routeFailed: false,
      };
      node.focus();
      return;
    }
    const path = this.edgeFromTarget(event.target);
    if (!path) return;
    event.stopPropagation();
    const edgeId = path.dataset.id;
    if (!edgeId) return;
    const selectedAtPointerDown = this.selectedEdgeId === edgeId;
    this.edgePress = {
      edgeId,
      selectedAtPointerDown,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    this.selectEdge(edgeId);
    path.focus();
  };

  private onCanvasClick = (event: MouseEvent): void => {
    const press = this.edgePress;
    this.edgePress = null;
    if (!this.enabled || !press || event.detail !== 1) return;
    const path = this.edgeFromTarget(event.target);
    const edgeId = path?.dataset.id;
    if (!path || edgeId !== press.edgeId || !press.selectedAtPointerDown) return;
    const dx = event.clientX - press.startClientX;
    const dy = event.clientY - press.startClientY;
    if (dx * dx + dy * dy > 16) return;
    event.preventDefault();
    event.stopPropagation();
    this.addPointToSelectedEdge(path, event.clientX, event.clientY);
  };

  private onCanvasDoubleClick = (event: MouseEvent): void => {
    const node = this.nodeFromTarget(event.target);
    if (node) {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < this.suppressNodeDoubleClickUntil) return;
      const sourceId = this.sourceNodeId(node.id);
      if (!sourceId) {
        this.options.setStatus("status.nodeSourceUnsupported");
        return;
      }
      this.options.setStatus(
        this.options.revealNodeSource(sourceId)
          ? "status.nodeSourceRevealed"
          : "status.nodeSourceNotFound",
      );
      return;
    }
    if (!this.enabled) return;
    const path = this.edgeFromTarget(event.target);
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
  };

  private onCanvasKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.deselect();
      return;
    }
    const node = this.nodeFromTarget(event.target);
    if (node) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectNode(node.id);
        return;
      }
      const movement = this.keyboardMovement(event);
      if (movement) {
        event.preventDefault();
        this.selectNode(node.id);
        this.moveNodeBy(node.id, movement);
      }
      return;
    }
    const path = this.edgeFromTarget(event.target);
    if (path && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      const edgeId = path.dataset.id;
      if (edgeId) this.selectEdge(edgeId);
    }
  };

  private keyboardMovement(event: KeyboardEvent): RoutePoint | null {
    const delta = event.shiftKey ? 10 : 1;
    const movement: Record<string, RoutePoint> = {
      ArrowLeft: { x: -delta, y: 0 },
      ArrowRight: { x: delta, y: 0 },
      ArrowUp: { x: 0, y: -delta },
      ArrowDown: { x: 0, y: delta },
    };
    return movement[event.key] ?? null;
  }

  private selectEdge(edgeId: string): void {
    if (!this.paths.has(edgeId)) return;
    this.selectedNodeId = null;
    this.selectedEdgeId = edgeId;
    this.selectedPointIndex = null;
    const stored = this.currentConfig().edges[edgeId]?.points;
    const automatic = this.autoRoutes.get(edgeId)?.slice(1, -1);
    this.selectedPoints = (stored?.length ? stored : automatic ?? [])
      .map((point) => this.clampPoint(point));
    for (const [candidateId, path] of this.paths) {
      path.classList.toggle("mle-edge-selected", candidateId === edgeId);
    }
    for (const node of this.nodes.values()) {
      node.element.classList.remove("mle-node-selected");
    }
    this.drawOverlay();
    this.updateControls();
    this.options.setStatus("status.edgeSelected");
  }

  private selectNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) return;
    this.selectedEdgeId = null;
    this.selectedNodeId = nodeId;
    this.selectedPointIndex = null;
    this.selectedPoints = [];
    for (const path of this.paths.values()) {
      path.classList.remove("mle-edge-selected");
    }
    for (const [candidateId, node] of this.nodes) {
      node.element.classList.toggle(
        "mle-node-selected",
        candidateId === nodeId,
      );
    }
    this.drawOverlay();
    this.updateControls();
    this.options.setStatus("status.nodeSelected");
  }

  private deselect(): void {
    this.selectedEdgeId = null;
    this.selectedNodeId = null;
    this.selectedPointIndex = null;
    this.selectedPoints = [];
    for (const path of this.paths.values()) {
      path.classList.remove("mle-edge-selected");
    }
    for (const node of this.nodes.values()) {
      node.element.classList.remove("mle-node-selected");
    }
    this.drawOverlay();
    this.updateControls();
  }

  private nodeOffset(nodeId: string): NodeOffset {
    return this.liveNodeOffsets.get(nodeId) ?? this.currentConfig().nodes[nodeId] ?? { dx: 0, dy: 0 };
  }

  private nodeBoundary(nodeId: string): NodeBoundary | null {
    const node = this.nodes.get(nodeId);
    return node
      ? translatedBoundary(node.boundary, this.nodeOffset(nodeId))
      : null;
  }

  private nodeCenter(nodeId: string): RoutePoint | null {
    const boundary = this.nodeBoundary(nodeId);
    return boundary
      ? {
          x: boundary.x + boundary.width / 2,
          y: boundary.y + boundary.height / 2,
        }
      : null;
  }

  private fullManualRoute(
    edgeId: string,
    interior: RoutePoint[],
  ): RoutePoint[] | null {
    const attachment = this.attachments.get(edgeId);
    const original = this.originals.get(edgeId);
    if (!attachment) {
      return original?.endpoints
        ? [original.endpoints[0], ...interior, original.endpoints[1]]
        : null;
    }
    const sourceBoundary = this.nodeBoundary(attachment.sourceNodeId);
    const targetBoundary = this.nodeBoundary(attachment.targetNodeId);
    const sourceCenter = this.nodeCenter(attachment.sourceNodeId);
    const targetCenter = this.nodeCenter(attachment.targetNodeId);
    if (!sourceBoundary || !targetBoundary || !sourceCenter || !targetCenter) {
      return null;
    }
    const sourceTarget = interior[0] ?? targetCenter;
    const targetTarget = interior[interior.length - 1] ?? sourceCenter;
    const source = intersectNodeBoundary(
      sourceCenter,
      sourceTarget,
      sourceBoundary,
      original?.endpoints?.[0],
    );
    const target = intersectNodeBoundary(
      targetCenter,
      targetTarget,
      targetBoundary,
      original?.endpoints?.[1],
    );
    return source && target ? [source, ...interior, target] : null;
  }

  private edgeObstacles(edgeId: string): ViewBoxBounds[] {
    const attachment = this.attachments.get(edgeId);
    if (!attachment) return [];
    const excluded = new Set([
      attachment.sourceNodeId,
      attachment.targetNodeId,
    ]);
    const obstacles: ViewBoxBounds[] = [];
    for (const nodeId of this.nodes.keys()) {
      if (excluded.has(nodeId)) continue;
      const boundary = this.nodeBoundary(nodeId);
      if (boundary) {
        obstacles.push({
          x: boundary.x,
          y: boundary.y,
          width: boundary.width,
          height: boundary.height,
        });
      }
    }
    return obstacles;
  }

  private applyManualRoute(edgeId: string, interior: RoutePoint[]): boolean {
    const fullRoute = this.fullManualRoute(
      edgeId,
      interior.map((point) => this.clampPoint(point)),
    );
    return fullRoute ? this.applyFullRoute(edgeId, fullRoute, false) : false;
  }

  private applyFullRoute(
    edgeId: string,
    fullRoute: RoutePoint[],
    automatic: boolean,
  ): boolean {
    const path = this.paths.get(edgeId);
    if (!path) return false;
    const mode = effectiveEdgeMode(this.currentConfig(), edgeId);
    const pathData = edgeRoutePath(
      fullRoute,
      mode,
      this.viewBoxBounds(),
      automatic ? this.edgeObstacles(edgeId) : [],
      automatic ? 8 : 0,
    );
    if (!pathData) return false;
    path.setAttribute("d", pathData);
    this.updateHitPath(edgeId, pathData);
    this.moveLabelToPathMidpoint(edgeId, path);
    return true;
  }

  private autoRouteEdge(edgeId: string): boolean {
    const attachment = this.attachments.get(edgeId);
    const original = this.originals.get(edgeId);
    if (!original) return false;
    const mode = effectiveEdgeMode(this.currentConfig(), edgeId);
    if (!attachment) {
      const fallbackRoute =
        original.route.length >= 2
          ? original.route.map((point) => ({ ...point }))
          : original.endpoints
            ? original.endpoints.map((point) => ({ ...point }))
            : [];
      if (
        fallbackRoute.length < 2 ||
        !this.applyFullRoute(edgeId, fallbackRoute, false)
      ) {
        return false;
      }
      this.autoRoutes.set(edgeId, fallbackRoute);
      if (
        this.selectedEdgeId === edgeId &&
        !this.currentConfig().edges[edgeId]?.points.length
      ) {
        this.selectedPoints = fallbackRoute.slice(1, -1);
      }
      return true;
    }
    if (attachment.sourceNodeId === attachment.targetNodeId) {
      const offset = this.nodeOffset(attachment.sourceNodeId);
      const translated = original.route.map((point) => ({
        x: point.x + offset.dx,
        y: point.y + offset.dy,
      }));
      this.autoRoutes.set(edgeId, translated);
      return this.applyFullRoute(edgeId, translated, false);
    }
    const initial = this.fullManualRoute(edgeId, []);
    if (!initial) return false;
    const route = autoRoute(
      initial[0],
      initial[initial.length - 1],
      this.edgeObstacles(edgeId),
      {
        clearance: 8,
        mode,
        bounds: this.viewBoxBounds(),
        previous: this.autoRoutes.get(edgeId),
      },
    );
    if (!route) return false;
    const refined = this.fullManualRoute(edgeId, route.slice(1, -1));
    if (!refined || !this.applyFullRoute(edgeId, refined, true)) return false;
    this.autoRoutes.set(edgeId, refined);
    if (
      this.selectedEdgeId === edgeId &&
      !this.currentConfig().edges[edgeId]?.points.length
    ) {
      this.selectedPoints = refined.slice(1, -1);
    }
    return true;
  }

  private applySelectedRoute(): boolean {
    if (!this.selectedEdgeId) return false;
    if (!this.selectedPoints.length) {
      return this.autoRouteEdge(this.selectedEdgeId);
    }
    return this.applyManualRoute(this.selectedEdgeId, this.selectedPoints);
  }

  private moveLabelToPathMidpoint(
    edgeId: string,
    path: SVGPathElement,
  ): void {
    const label = this.labels.get(edgeId);
    if (!label) return;
    try {
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      label.setAttribute("transform", `translate(${point.x}, ${point.y})`);
    } catch {
      // A malformed label or path must not fail the diagram render.
    }
  }

  private restoreOriginalEdge(edgeId: string): void {
    const path = this.paths.get(edgeId);
    const original = this.originals.get(edgeId);
    if (!path || !original) return;
    path.setAttribute("d", original.pathData);
    this.updateHitPath(edgeId, original.pathData);
    this.autoRoutes.set(
      edgeId,
      original.route.map((point) => ({ ...point })),
    );
    const label = this.labels.get(edgeId);
    if (label) {
      if (original.labelTransform == null) label.removeAttribute("transform");
      else label.setAttribute("transform", original.labelTransform);
    }
  }

  private nearestPathPoint(
    path: SVGPathElement,
    clientX: number,
    clientY: number,
  ): RoutePoint | null {
    const pointer = this.toSvgPoint(clientX, clientY);
    if (!pointer) return null;
    try {
      const total = path.getTotalLength();
      if (!Number.isFinite(total) || total <= 0) return null;
      const sampleCount = Math.max(8, Math.min(256, Math.ceil(total / 8)));
      let step = total / sampleCount;
      let bestLength = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      const consider = (length: number): void => {
        const bounded = Math.max(0, Math.min(total, length));
        const candidate = path.getPointAtLength(bounded);
        const distance =
          (candidate.x - pointer.x) ** 2 + (candidate.y - pointer.y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLength = bounded;
        }
      };
      for (let index = 0; index <= sampleCount; index += 1) {
        consider(index * step);
      }
      for (let iteration = 0; iteration < 8; iteration += 1) {
        step /= 2;
        const center = bestLength;
        consider(center - step);
        consider(center + step);
      }
      const nearest = path.getPointAtLength(bestLength);
      return this.clampPoint({ x: nearest.x, y: nearest.y });
    } catch {
      return null;
    }
  }

  private addPointToSelectedEdge(
    path: SVGPathElement,
    clientX: number,
    clientY: number,
  ): void {
    const edgeId = path.dataset.id;
    if (!edgeId || this.selectedEdgeId !== edgeId) return;
    const point = this.nearestPathPoint(path, clientX, clientY);
    const fullRoute = this.fullManualRoute(edgeId, this.selectedPoints);
    if (!point || !fullRoute) return;
    const snapshot = this.captureEdgeOperation(edgeId);
    if (!snapshot) return;
    const insertionIndex = nearestRouteInsertionIndex(fullRoute, point);
    const interiorIndex = Math.max(
      0,
      Math.min(this.selectedPoints.length, insertionIndex - 1),
    );
    this.selectedPoints.splice(interiorIndex, 0, point);
    this.selectedPointIndex = interiorIndex;
    if (!this.applyAndPersistSelectedPoints(snapshot)) return;
    this.drawOverlay();
    this.options.setStatus("status.edgePointAdded");
  }

  private captureEdgeVisual(edgeId: string): EdgeVisualSnapshot | null {
    const path = this.paths.get(edgeId);
    if (!path) return null;
    const label = this.labels.get(edgeId);
    const autoRoute = this.autoRoutes.get(edgeId);
    return {
      pathData: path.getAttribute("d") ?? "",
      hasLabel: Boolean(label),
      labelTransform: label?.getAttribute("transform") ?? null,
      autoRoute: autoRoute
        ? autoRoute.map((point) => ({ ...point }))
        : null,
    };
  }

  private restoreEdgeVisual(
    edgeId: string,
    snapshot: EdgeVisualSnapshot | null,
  ): void {
    if (!snapshot) return;
    this.paths.get(edgeId)?.setAttribute("d", snapshot.pathData);
    this.updateHitPath(edgeId, snapshot.pathData);
    const label = this.labels.get(edgeId);
    if (snapshot.hasLabel && label) {
      if (snapshot.labelTransform == null) label.removeAttribute("transform");
      else label.setAttribute("transform", snapshot.labelTransform);
    }
    if (snapshot.autoRoute) {
      this.autoRoutes.set(
        edgeId,
        snapshot.autoRoute.map((point) => ({ ...point })),
      );
    } else {
      this.autoRoutes.delete(edgeId);
    }
  }

  private captureSelection(): SelectionSnapshot {
    return {
      points: this.selectedPoints.map((point) => ({ ...point })),
      pointIndex: this.selectedPointIndex,
    };
  }

  private restoreSelection(snapshot: SelectionSnapshot): void {
    this.selectedPoints = snapshot.points.map((point) => ({ ...point }));
    this.selectedPointIndex = snapshot.pointIndex;
  }

  private captureEdgeOperation(
    edgeId: string,
  ): EdgeOperationSnapshot | null {
    if (this.selectedEdgeId !== edgeId) return null;
    return {
      edgeId,
      store: this.store,
      visual: this.captureEdgeVisual(edgeId),
      selection: this.captureSelection(),
    };
  }

  private restoreEdgeOperation(snapshot: EdgeOperationSnapshot): void {
    this.store = snapshot.store;
    this.restoreEdgeVisual(snapshot.edgeId, snapshot.visual);
    this.restoreSelection(snapshot.selection);
    this.drawOverlay();
    this.updateControls();
  }

  private applyAndPersistSelectedPoints(
    snapshot: EdgeOperationSnapshot,
  ): boolean {
    if (!this.applySelectedRoute()) {
      this.restoreEdgeOperation(snapshot);
      this.options.setStatus("status.edgeAutoRouteFailed");
      return false;
    }
    if (!this.persistSelectedPoints()) {
      this.restoreEdgeOperation(snapshot);
      return false;
    }
    return true;
  }

  private persistSelectedPoints(): boolean {
    if (!this.diagramKey || !this.selectedEdgeId) return false;
    const next = this.selectedPoints.length
      ? setEdgeRouteV2(
          this.store,
          this.diagramKey,
          this.selectedEdgeId,
          this.selectedPoints,
        )
      : clearEdgePointsV2(
          this.store,
          this.diagramKey,
          this.selectedEdgeId,
        );
    if (!this.writeStore(next)) return false;
    this.updateControls();
    return true;
  }

  private changeDefaultMode(): void {
    if (!this.diagramKey) return;
    const value = this.options.controls.defaultMode.value;
    if (value !== "corner" && value !== "smooth") return;
    const previousStore = this.store;
    const candidate = setDiagramDefaultMode(
      previousStore,
      this.diagramKey,
      value,
    );
    const snapshots = new Map<string, EdgeVisualSnapshot | null>();
    const selection = this.captureSelection();
    for (const edgeId of this.paths.keys()) {
      snapshots.set(edgeId, this.captureEdgeVisual(edgeId));
    }
    this.store = candidate;
    const applied = [...this.paths.keys()].every((edgeId) =>
      this.reapplyEdge(edgeId, true),
    );
    if (!applied) {
      this.store = previousStore;
      for (const [edgeId, snapshot] of snapshots) {
        this.restoreEdgeVisual(edgeId, snapshot);
      }
      this.restoreSelection(selection);
      this.drawOverlay();
      this.updateControls();
      this.options.setStatus("status.edgeAutoRouteFailed");
      return;
    }
    if (!this.writeStore(candidate)) {
      this.store = previousStore;
      for (const [edgeId, snapshot] of snapshots) {
        this.restoreEdgeVisual(edgeId, snapshot);
      }
      this.restoreSelection(selection);
      this.drawOverlay();
      this.updateControls();
      return;
    }
    this.drawOverlay();
    this.updateControls();
    this.options.setStatus("status.edgeModeChanged");
  }

  private changeSelectedMode(): void {
    if (!this.diagramKey || !this.selectedEdgeId) return;
    const value = this.options.controls.selectedMode.value;
    const mode: EdgeRoutingMode | undefined =
      value === "corner" || value === "smooth" ? value : undefined;
    const edgeId = this.selectedEdgeId;
    const previousStore = this.store;
    const candidate = setEdgeModeV2(
      previousStore,
      this.diagramKey,
      edgeId,
      mode,
    );
    const snapshot = this.captureEdgeVisual(edgeId);
    const selection = this.captureSelection();
    this.store = candidate;
    if (!this.reapplyEdge(edgeId, true)) {
      this.store = previousStore;
      this.restoreEdgeVisual(edgeId, snapshot);
      this.restoreSelection(selection);
      this.drawOverlay();
      this.updateControls();
      this.options.setStatus("status.edgeAutoRouteFailed");
      return;
    }
    if (!this.writeStore(candidate)) {
      this.store = previousStore;
      this.restoreEdgeVisual(edgeId, snapshot);
      this.restoreSelection(selection);
      this.drawOverlay();
      this.updateControls();
      return;
    }
    this.drawOverlay();
    this.updateControls();
    this.options.setStatus("status.edgeModeChanged");
  }

  private reapplyEdge(edgeId: string, forceAutomatic: boolean): boolean {
    const points = this.currentConfig().edges[edgeId]?.points;
    if (points?.length) return this.applyManualRoute(edgeId, points);
    if (this.applyAutomaticEdge(edgeId)) return true;
    return !forceAutomatic;
  }

  private rerouteSelectedEdge(): void {
    if (!this.diagramKey || !this.selectedEdgeId) return;
    const edgeId = this.selectedEdgeId;
    const previousStore = this.store;
    const candidate = clearEdgePointsV2(
      previousStore,
      this.diagramKey,
      edgeId,
    );
    const snapshot = this.captureEdgeVisual(edgeId);
    const selection = this.captureSelection();
    this.store = candidate;
    if (!this.applyAutomaticEdge(edgeId)) {
      this.store = previousStore;
      this.restoreEdgeVisual(edgeId, snapshot);
      this.restoreSelection(selection);
      this.options.setStatus("status.edgeAutoRouteFailed");
      return;
    }
    if (!this.writeStore(candidate)) {
      this.store = previousStore;
      this.restoreEdgeVisual(edgeId, snapshot);
      this.restoreSelection(selection);
      return;
    }
    this.selectedPoints = this.autoRoutes.get(edgeId)?.slice(1, -1) ?? [];
    this.selectedPointIndex = null;
    this.drawOverlay();
    this.updateControls();
    this.options.setStatus("status.edgeAutoRerouted");
  }

  private resetSelectedEdge(): void {
    if (!this.diagramKey || !this.selectedEdgeId) return;
    const edgeId = this.selectedEdgeId;
    const previousStore = this.store;
    const snapshot = this.captureEdgeVisual(edgeId);
    const selection = this.captureSelection();
    const candidate = removeEdgeRouteV2(previousStore, this.diagramKey, edgeId);
    this.store = candidate;
    if (!this.applyAutomaticEdge(edgeId)) {
      this.store = previousStore;
      this.restoreEdgeVisual(edgeId, snapshot);
      this.restoreSelection(selection);
      this.options.setStatus("status.edgeAutoRouteFailed");
      return;
    }
    if (!this.writeStore(candidate)) {
      this.store = previousStore;
      this.restoreEdgeVisual(edgeId, snapshot);
      this.restoreSelection(selection);
      return;
    }
    this.selectedPoints = this.autoRoutes.get(edgeId)?.slice(1, -1) ?? [];
    this.selectedPointIndex = null;
    this.drawOverlay();
    this.updateControls();
    this.options.setStatus("status.edgeReset");
  }

  private resetSelectedNode(): void {
    if (!this.diagramKey || !this.selectedNodeId) return;
    const nodeId = this.selectedNodeId;
    const previousOffset = this.nodeOffset(nodeId);
    this.applyNodeOffset(nodeId, { dx: 0, dy: 0 });
    if (!this.rerouteIncidentEdgesWithOffset(nodeId, { dx: 0, dy: 0 })) {
      this.applyNodeOffset(nodeId, previousOffset);
      this.rerouteIncidentEdgesWithOffset(nodeId, previousOffset);
      this.options.setStatus("status.edgeAutoRouteFailed");
      return;
    }
    const nextStore = this.translateSelfLoopPoints(
      removeNodeOffset(this.store, this.diagramKey, nodeId),
      nodeId,
      { dx: -previousOffset.dx, dy: -previousOffset.dy },
    );
    if (!this.writeStore(nextStore)) {
      this.applyNodeOffset(nodeId, previousOffset);
      this.rerouteIncidentEdgesWithOffset(nodeId, previousOffset);
      return;
    }
    this.updateControls();
    this.options.setStatus("status.nodeReset");
  }

  private resetAll(): void {
    if (!this.diagramKey) return;
    if (
      !this.writeStore(
        clearDiagramRoutesV2(this.store, this.diagramKey),
      )
    ) {
      return;
    }
    for (const nodeId of this.nodes.keys()) {
      this.applyNodeOffset(nodeId, { dx: 0, dy: 0 });
    }
    for (const edgeId of this.paths.keys()) this.restoreOriginalEdge(edgeId);
    if (this.selectedEdgeId) {
      this.selectedPoints =
        this.autoRoutes.get(this.selectedEdgeId)?.slice(1, -1) ?? [];
    }
    this.selectedPointIndex = null;
    this.drawOverlay();
    this.updateControls();
    this.options.setStatus("status.edgeAllReset");
  }

  private applyNodeOffset(nodeId: string, offset: NodeOffset): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.liveNodeOffsets.set(nodeId, { ...offset });
    if (offsetIsZero(offset)) {
      if (node.originalTransform == null) node.element.removeAttribute("transform");
      else node.element.setAttribute("transform", node.originalTransform);
      return;
    }
    const translate = `translate(${offset.dx} ${offset.dy})`;
    node.element.setAttribute(
      "transform",
      node.originalTransform
        ? `${translate} ${node.originalTransform}`
        : translate,
    );
  }

  private clampNodeOffset(nodeId: string, offset: NodeOffset): NodeOffset {
    const node = this.nodes.get(nodeId);
    if (!node) return offset;
    const viewBox = this.viewBoxBounds();
    return {
      dx: Math.min(
        viewBox.x + viewBox.width - (node.boundary.x + node.boundary.width),
        Math.max(viewBox.x - node.boundary.x, offset.dx),
      ),
      dy: Math.min(
        viewBox.y + viewBox.height - (node.boundary.y + node.boundary.height),
        Math.max(viewBox.y - node.boundary.y, offset.dy),
      ),
    };
  }

  private moveNodeBy(nodeId: string, movement: RoutePoint): void {
    if (!this.nodeMovementSupported || !this.diagramKey) {
      this.options.setStatus("status.nodeMoveUnsupported");
      return;
    }
    const current = this.nodeOffset(nodeId);
    const nextOffset = this.clampNodeOffset(nodeId, {
      dx: current.dx + movement.x,
      dy: current.dy + movement.y,
    });
    this.applyNodeOffset(nodeId, nextOffset);
    if (!this.rerouteIncidentEdgesWithOffset(nodeId, nextOffset)) {
      this.applyNodeOffset(nodeId, current);
      this.rerouteIncidentEdgesWithOffset(nodeId, current);
      this.options.setStatus("status.edgeAutoRouteFailed");
      return;
    }
    let nextStore = offsetIsZero(nextOffset)
      ? removeNodeOffset(this.store, this.diagramKey, nodeId)
      : setNodeOffset(this.store, this.diagramKey, nodeId, nextOffset);
    nextStore = this.translateSelfLoopPoints(nextStore, nodeId, {
      dx: nextOffset.dx - current.dx,
      dy: nextOffset.dy - current.dy,
    });
    if (!this.writeStore(nextStore)) {
      this.applyNodeOffset(nodeId, current);
      this.rerouteIncidentEdgesWithOffset(nodeId, current);
      return;
    }
    this.updateControls();
    this.options.setStatus("status.nodeMoved");
  }

  private rerouteIncidentEdges(nodeId: string): boolean {
    let succeeded = true;
    for (const [edgeId, attachment] of this.attachments) {
      if (
        attachment.sourceNodeId !== nodeId &&
        attachment.targetNodeId !== nodeId
      ) {
        continue;
      }
      const points = this.currentConfig().edges[edgeId]?.points;
      const selfLoop =
        attachment.sourceNodeId === nodeId && attachment.targetNodeId === nodeId;
      const baseOffset = this.currentConfig().nodes[nodeId] ?? { dx: 0, dy: 0 };
      const liveOffset = this.nodeOffset(nodeId);
      const manualPoints = selfLoop && points?.length
        ? points.map((point) => ({
            x: point.x + liveOffset.dx - baseOffset.dx,
            y: point.y + liveOffset.dy - baseOffset.dy,
          }))
        : points;
      const applied = manualPoints?.length
        ? this.applyManualRoute(edgeId, manualPoints)
        : this.applyAutomaticEdge(edgeId);
      succeeded = applied && succeeded;
    }
    this.drawOverlay();
    return succeeded;
  }

  private translateSelfLoopPoints(
    store: EdgeRoutingStoreV2,
    nodeId: string,
    delta: NodeOffset,
  ): EdgeRoutingStoreV2 {
    if (!this.diagramKey || offsetIsZero(delta)) return store;
    let next = store;
    for (const [edgeId, attachment] of this.attachments) {
      if (attachment.sourceNodeId !== nodeId || attachment.targetNodeId !== nodeId) continue;
      const points = next.diagrams[this.diagramKey]?.edges[edgeId]?.points;
      if (!points?.length) continue;
      next = setEdgeRouteV2(next, this.diagramKey, edgeId, points.map((point) => ({
        x: point.x + delta.dx,
        y: point.y + delta.dy,
      })));
    }
    return next;
  }

  private createOverlay(): void {
    if (!this.svg || this.overlay?.isConnected) return;
    const overlay = document.createElementNS(SVG_NS, "svg");
    overlay.classList.add("edge-route-overlay");
    overlay.dataset.mleEdgeInteractive = "true";
    overlay.setAttribute("role", "group");
    overlay.setAttribute("aria-label", this.options.t("edge.overlay"));
    const viewBox = this.svg.getAttribute("viewBox");
    if (viewBox) overlay.setAttribute("viewBox", viewBox);
    overlay.setAttribute("width", this.svg.getAttribute("width") ?? "100%");
    overlay.setAttribute("height", this.svg.getAttribute("height") ?? "100%");
    const hitLayer = document.createElementNS(SVG_NS, "g");
    hitLayer.classList.add("edge-route-hit-layer");
    const controlsLayer = document.createElementNS(SVG_NS, "g");
    controlsLayer.classList.add("edge-route-controls-layer");
    controlsLayer.addEventListener("dblclick", this.onHandleDoubleClick);
    overlay.append(hitLayer, controlsLayer);
    this.options.canvas.appendChild(overlay);
    this.overlay = overlay;
    this.overlayHitLayer = hitLayer;
    this.overlayControlsLayer = controlsLayer;
    this.rebuildHitPaths();
    this.drawOverlay();
  }

  private removeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.overlayHitLayer = null;
    this.overlayControlsLayer = null;
    this.hitPaths.clear();
  }

  private rebuildHitPaths(): void {
    if (!this.overlayHitLayer) return;
    this.overlayHitLayer.replaceChildren();
    this.hitPaths.clear();
    for (const [edgeId, path] of this.paths) {
      const hitPath = document.createElementNS(SVG_NS, "path");
      hitPath.classList.add("edge-route-hit");
      hitPath.dataset.edgeId = edgeId;
      hitPath.dataset.mleEdgeInteractive = "true";
      hitPath.setAttribute("d", path.getAttribute("d") ?? "");
      hitPath.setAttribute("aria-hidden", "true");
      this.overlayHitLayer.appendChild(hitPath);
      this.hitPaths.set(edgeId, hitPath);
    }
  }

  private updateHitPath(edgeId: string, pathData: string): void {
    this.hitPaths.get(edgeId)?.setAttribute("d", pathData);
  }

  private drawOverlay(): void {
    if (!this.overlayControlsLayer || !this.enabled) return;
    this.overlayControlsLayer.replaceChildren();
    if (!this.selectedEdgeId) return;
    const path = this.paths.get(this.selectedEdgeId);
    if (!path) return;

    const selection = document.createElementNS(SVG_NS, "path");
    selection.classList.add("edge-route-selection");
    selection.setAttribute("d", path.getAttribute("d") ?? "");
    this.overlayControlsLayer.appendChild(selection);

    this.selectedPoints.forEach((point, index) => {
      const handle = document.createElementNS(SVG_NS, "circle");
      handle.classList.add("edge-route-handle");
      if (index === this.selectedPointIndex) handle.classList.add("is-selected");
      handle.setAttribute("cx", String(point.x));
      handle.setAttribute("cy", String(point.y));
      handle.setAttribute("r", "6");
      handle.setAttribute("tabindex", "0");
      handle.setAttribute("role", "button");
      handle.setAttribute(
        "aria-label",
        `${this.options.t("edge.handle")} ${index + 1}. ${this.options.t("edge.handleDeleteHint")}`,
      );
      handle.dataset.pointIndex = String(index);
      handle.dataset.mleEdgeInteractive = "true";
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.selectedEdgeId) return;
        const snapshot = this.captureEdgeOperation(this.selectedEdgeId);
        if (!snapshot) return;
        this.selectedPointIndex = index;
        this.drag = {
          kind: "point",
          pointerId: event.pointerId,
          pointIndex: index,
          startClientX: event.clientX,
          startClientY: event.clientY,
          moved: false,
          snapshot,
        };
        handle.focus();
        this.updateHandleSelection();
      });
      handle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectedPointIndex = index;
        this.updateHandleSelection();
      });
      handle.addEventListener("keydown", (event) =>
        this.onHandleKeyDown(event, index),
      );
      this.overlayControlsLayer?.appendChild(handle);
    });
  }

  private updateHandleSelection(): void {
    for (const handle of this.overlayControlsLayer?.querySelectorAll<
      SVGCircleElement
    >(".edge-route-handle[data-point-index]") ?? []) {
      handle.classList.toggle(
        "is-selected",
        Number(handle.dataset.pointIndex) === this.selectedPointIndex,
      );
    }
  }

  private onHandleDoubleClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const handle = event.target.closest<SVGCircleElement>(
      ".edge-route-handle[data-point-index]",
    );
    if (!handle || handle.parentElement !== this.overlayControlsLayer) return;
    const pointIndex = Number(handle.dataset.pointIndex);
    if (!Number.isInteger(pointIndex)) return;
    event.preventDefault();
    event.stopPropagation();
    this.deletePoint(pointIndex);
  };

  private deletePoint(pointIndex: number): void {
    if (
      !this.selectedEdgeId ||
      pointIndex < 0 ||
      pointIndex >= this.selectedPoints.length
    ) {
      return;
    }
    const snapshot = this.captureEdgeOperation(this.selectedEdgeId);
    if (!snapshot) return;
    this.selectedPoints.splice(pointIndex, 1);
    this.selectedPointIndex = this.selectedPoints.length
      ? Math.min(pointIndex, this.selectedPoints.length - 1)
      : null;
    if (!this.applyAndPersistSelectedPoints(snapshot)) return;
    this.drawOverlay();
    this.focusSelectedHandle();
    this.options.setStatus("status.edgePointDeleted");
  }

  private onHandleKeyDown(event: KeyboardEvent, pointIndex: number): void {
    if (!this.selectedEdgeId) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deletePoint(pointIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.deselect();
      return;
    }
    const move = this.keyboardMovement(event);
    if (!move) return;
    event.preventDefault();
    const current = this.selectedPoints[pointIndex];
    if (!current) return;
    const snapshot = this.captureEdgeOperation(this.selectedEdgeId);
    if (!snapshot) return;
    this.selectedPointIndex = pointIndex;
    this.selectedPoints[pointIndex] = this.clampPoint({
      x: current.x + move.x,
      y: current.y + move.y,
    });
    const saved = this.applyAndPersistSelectedPoints(snapshot);
    if (!saved) return;
    this.drawOverlay();
    this.focusSelectedHandle();
    this.options.setStatus("status.edgePointMoved");
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (this.drag.kind === "point") {
      const dx = event.clientX - this.drag.startClientX;
      const dy = event.clientY - this.drag.startClientY;
      if (!this.drag.moved && dx * dx + dy * dy <= 16) return;
      this.drag.moved = true;
      const point = this.toSvgPoint(event.clientX, event.clientY);
      const edgeId = this.selectedEdgeId;
      if (!point || !edgeId || !this.selectedPoints[this.drag.pointIndex]) return;
      const fullRoute = this.fullManualRoute(edgeId, this.selectedPoints);
      if (!fullRoute) return;
      this.selectedPoints[this.drag.pointIndex] = snapCornerRoutePoint(
        fullRoute,
        this.drag.pointIndex + 1,
        point,
        event.shiftKey,
        effectiveEdgeMode(this.currentConfig(), edgeId),
      );
      this.selectedPointIndex = this.drag.pointIndex;
      if (!this.applySelectedRoute()) {
        const snapshot = this.drag.snapshot;
        this.drag = null;
        this.restoreEdgeOperation(snapshot);
        this.options.setStatus("status.edgeAutoRouteFailed");
        return;
      }
      this.drawOverlay();
      return;
    }
    const dx = event.clientX - this.drag.startClientX;
    const dy = event.clientY - this.drag.startClientY;
    if (!this.drag.moved && dx * dx + dy * dy <= 16) return;
    this.drag.moved = true;
    this.suppressNodeDoubleClickUntil = performance.now() + 500;
    const point = this.toSvgPoint(event.clientX, event.clientY, false);
    if (!point) return;
    this.drag.pendingPointer = point;
    if (this.nodeFrame == null) {
      this.nodeFrame = window.requestAnimationFrame(() => {
        this.nodeFrame = null;
        this.flushNodeDrag();
      });
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (this.drag.kind === "point") {
      const drag = this.drag;
      this.drag = null;
      if (!drag.moved) return;
      const saved = this.applyAndPersistSelectedPoints(drag.snapshot);
      if (!saved) return;
      this.drawOverlay();
      this.focusSelectedHandle();
      this.options.setStatus("status.edgePointMoved");
      return;
    }
    if (!this.drag.moved) {
      this.drag = null;
      return;
    }
    this.flushNodeDrag();
    const drag = this.drag;
    const nodeId = drag.nodeId;
    if (drag.routeFailed) {
      this.applyNodeOffset(nodeId, drag.startOffset);
      this.rerouteIncidentEdgesWithOffset(nodeId, drag.startOffset);
      this.drag = null;
      this.updateControls();
      this.options.setStatus("status.edgeAutoRouteFailed");
      return;
    }
    this.drag = null;
    if (!this.diagramKey) return;
    const offset = drag.lastValidOffset;
    let next = offsetIsZero(offset)
      ? removeNodeOffset(this.store, this.diagramKey, nodeId)
      : setNodeOffset(this.store, this.diagramKey, nodeId, offset);
    next = this.translateSelfLoopPoints(next, nodeId, {
      dx: offset.dx - drag.startOffset.dx,
      dy: offset.dy - drag.startOffset.dy,
    });
    if (!this.writeStore(next)) {
      this.applyNodeOffset(nodeId, drag.startOffset);
      this.rerouteIncidentEdgesWithOffset(nodeId, drag.startOffset);
      this.updateControls();
      return;
    }
    this.updateControls();
    this.options.setStatus("status.nodeMoved");
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (this.drag.kind === "node") {
      if (!this.drag.moved) {
        this.drag = null;
        return;
      }
      const { nodeId, startOffset } = this.drag;
      this.drag = null;
      this.applyNodeOffset(nodeId, startOffset);
      this.rerouteIncidentEdges(nodeId);
    } else {
      const snapshot = this.drag.snapshot;
      this.drag = null;
      this.restoreEdgeOperation(snapshot);
    }
  };

  private flushNodeDrag(): void {
    if (!this.drag || this.drag.kind !== "node" || !this.drag.pendingPointer) {
      return;
    }
    const pointer = this.drag.pendingPointer;
    this.drag.pendingPointer = null;
    const offset = this.clampNodeOffset(this.drag.nodeId, {
      dx:
        this.drag.startOffset.dx +
        pointer.x -
        this.drag.startPointer.x,
      dy:
        this.drag.startOffset.dy +
        pointer.y -
        this.drag.startPointer.y,
    });
    this.applyNodeOffset(this.drag.nodeId, offset);
    if (this.rerouteIncidentEdgesWithOffset(this.drag.nodeId, offset)) {
      this.drag.lastValidOffset = offset;
      this.drag.routeFailed = false;
    } else {
      this.drag.routeFailed = true;
      this.applyNodeOffset(this.drag.nodeId, this.drag.lastValidOffset);
      this.rerouteIncidentEdgesWithOffset(
        this.drag.nodeId,
        this.drag.lastValidOffset,
      );
    }
  }

  private rerouteIncidentEdgesWithOffset(
    nodeId: string,
    offset: NodeOffset,
  ): boolean {
    if (!this.diagramKey) return false;
    const previousOffset = this.liveNodeOffsets.get(nodeId);
    this.liveNodeOffsets.set(nodeId, { ...offset });
    const succeeded = this.rerouteIncidentEdges(nodeId);
    if (previousOffset) this.liveNodeOffsets.set(nodeId, previousOffset);
    else this.liveNodeOffsets.delete(nodeId);
    return succeeded;
  }

  private cancelDrag(): void {
    if (this.nodeFrame != null) {
      window.cancelAnimationFrame(this.nodeFrame);
      this.nodeFrame = null;
    }
    this.drag = null;
  }

  private focusSelectedHandle(): void {
    if (this.selectedPointIndex == null) return;
    this.overlay
      ?.querySelector<SVGCircleElement>(
        `.edge-route-handle[data-point-index="${this.selectedPointIndex}"]`,
      )
      ?.focus();
  }

  private livePathEndpoints(
    path: SVGPathElement,
  ): [RoutePoint, RoutePoint] | null {
    try {
      const total = path.getTotalLength();
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(total);
      return [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
      ];
    } catch {
      return null;
    }
  }

  private toSvgPoint(
    clientX: number,
    clientY: number,
    clamp = true,
  ): RoutePoint | null {
    if (!this.svg) return null;
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return null;
    const point = this.svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    const result = { x: transformed.x, y: transformed.y };
    return clamp ? this.clampPoint(result) : result;
  }

  private clampPoint(point: RoutePoint): RoutePoint {
    return clampRoutePoint(point, this.viewBoxBounds());
  }

  private viewBoxBounds(): ViewBoxBounds {
    const viewBox = this.svg?.viewBox.baseVal;
    if (viewBox?.width && viewBox.height) {
      return {
        x: viewBox.x,
        y: viewBox.y,
        width: viewBox.width,
        height: viewBox.height,
      };
    }
    return {
      x: 0,
      y: 0,
      width: this.svg?.width.baseVal.value || 0,
      height: this.svg?.height.baseVal.value || 0,
    };
  }
}
