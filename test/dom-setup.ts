/**
 * Minimal SVG geometry stubs for jsdom.
 *
 * jsdom implements the SVG DOM but none of the layout-dependent geometry APIs.
 * Only the calls Mermaid's layout and this app's edge editor make are stubbed;
 * event ordering and state transitions still run through the real code.
 */

interface StubbedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CHARACTER_WIDTH = 8;
const LINE_HEIGHT = 20;

function textBox(element: Element): StubbedBox {
  const text = element.textContent ?? "";
  return {
    x: 0,
    y: 0,
    width: Math.max(10, text.length * CHARACTER_WIDTH),
    height: LINE_HEIGHT,
  };
}

/** Install the geometry stubs onto a jsdom window. Safe to call repeatedly. */
export function installSvgGeometryStubs(target: Window & typeof globalThis): void {
  const proto = target.SVGElement.prototype as unknown as Record<string, unknown>;

  proto.getBBox = function getBBox(this: Element): StubbedBox {
    return textBox(this);
  };
  proto.getComputedTextLength = function getComputedTextLength(
    this: Element,
  ): number {
    return (this.textContent ?? "").length * CHARACTER_WIDTH;
  };
  proto.getSubStringLength = function getSubStringLength(
    _start: number,
    length: number,
  ): number {
    return length * CHARACTER_WIDTH;
  };
  proto.getScreenCTM = function getScreenCTM(): null {
    return null;
  };
}

/**
 * CodeMirror measures text through `Range.getClientRects()`, which jsdom does
 * not implement; without it the async measure phase throws after every test.
 * Zero-sized rects are enough because no test asserts on layout.
 */
export function installTextMeasurementStubs(
  target: Window & typeof globalThis,
): void {
  const emptyRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  });
  const rangeProto = target.Range.prototype as unknown as Record<string, unknown>;
  rangeProto.getClientRects = () => Object.assign([], { item: () => null });
  rangeProto.getBoundingClientRect = emptyRect;
  const elementProto = target.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  if (typeof elementProto.getClientRects !== "function") {
    elementProto.getClientRects = () => Object.assign([], { item: () => null });
  }
}

interface StubMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  inverse(): StubMatrix;
}

function identityMatrix(): StubMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: identityMatrix };
}

/** Endpoint of each absolute M/L/Q/C command, in order. */
function pathPolyline(d: string): Array<{ x: number; y: number }> {
  const tokens = d.match(/[MLQC]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const points: Array<{ x: number; y: number }> = [];
  const arity: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6 };
  let index = 0;
  let command = "M";
  while (index < tokens.length) {
    const token = tokens[index];
    if (token in arity) {
      command = token;
      index += 1;
      continue;
    }
    const count = arity[command] ?? 2;
    const numbers = tokens
      .slice(index, index + count)
      .map((value) => Number(value));
    if (numbers.length < count || numbers.some((value) => !Number.isFinite(value))) {
      break;
    }
    points.push({ x: numbers[count - 2], y: numbers[count - 1] });
    index += count;
  }
  return points;
}

/**
 * Geometry the edge editor itself needs: pointer<->user-space conversion, node
 * boundaries and path metrics. Coordinates are 1:1 with client coordinates so
 * tests can express pointer positions directly in viewBox units.
 *
 * `getBBox` honours a `data-bbox="x,y,width,height"` attribute so fixtures can
 * state node geometry that jsdom cannot lay out.
 */
export function installEdgeEditorStubs(target: Window & typeof globalThis): void {
  const svgProto = target.SVGElement.prototype as unknown as Record<string, unknown>;
  const rootProto = target.SVGSVGElement.prototype as unknown as Record<string, unknown>;

  svgProto.getBBox = function getBBox(this: Element): StubbedBox {
    const declared = this.getAttribute("data-bbox");
    if (declared) {
      const [x, y, width, height] = declared.split(",").map(Number);
      return { x, y, width, height };
    }
    return textBox(this);
  };
  svgProto.getCTM = identityMatrix;
  svgProto.getScreenCTM = identityMatrix;
  rootProto.getCTM = identityMatrix;
  rootProto.getScreenCTM = identityMatrix;
  rootProto.createSVGPoint = function createSVGPoint() {
    return {
      x: 0,
      y: 0,
      matrixTransform(matrix: StubMatrix) {
        return {
          x: this.x * matrix.a + this.y * matrix.c + matrix.e,
          y: this.x * matrix.b + this.y * matrix.d + matrix.f,
        };
      },
    };
  };

  svgProto.getTotalLength = function getTotalLength(this: Element): number {
    const points = pathPolyline(this.getAttribute("d") ?? "");
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      );
    }
    return total;
  };
  svgProto.getPointAtLength = function getPointAtLength(
    this: Element,
    length: number,
  ): { x: number; y: number } {
    const points = pathPolyline(this.getAttribute("d") ?? "");
    if (!points.length) throw new Error("empty path");
    let remaining = Math.max(0, length);
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      const segment = Math.hypot(to.x - from.x, to.y - from.y);
      if (remaining <= segment || index === points.length - 1) {
        const ratio = segment ? Math.min(1, remaining / segment) : 0;
        return {
          x: from.x + (to.x - from.x) * ratio,
          y: from.y + (to.y - from.y) * ratio,
        };
      }
      remaining -= segment;
    }
    return { ...points[points.length - 1] };
  };
}
