import type { InkPoint, Stroke, ViewTransform } from '../types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ROOT_ATTRIBUTE = 'data-ink-root';

function setViewTransform(root: SVGGElement, view: ViewTransform) {
  root.setAttribute(
    'transform',
    `translate(${view.offsetX} ${view.offsetY}) scale(${view.scale})`,
  );
}

function createDot(point: InkPoint, color: string) {
  const dot = document.createElementNS(SVG_NAMESPACE, 'circle');
  dot.setAttribute('cx', String(point.x));
  dot.setAttribute('cy', String(point.y));
  dot.setAttribute('r', String(point.width / 2));
  dot.setAttribute('fill', color);
  return dot;
}

function createSegment(start: InkPoint, end: InkPoint, color: string) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.01) {
    return createDot(end, color);
  }

  const segment = document.createElementNS(SVG_NAMESPACE, 'line');
  segment.setAttribute('x1', String(start.x));
  segment.setAttribute('y1', String(start.y));
  segment.setAttribute('x2', String(end.x));
  segment.setAttribute('y2', String(end.y));
  segment.setAttribute('stroke', color);
  segment.setAttribute('stroke-width', String((start.width + end.width) / 2));
  segment.setAttribute('stroke-linecap', 'round');
  segment.setAttribute('stroke-linejoin', 'round');
  return segment;
}

function createStrokeGroup(stroke: Stroke) {
  const group = document.createElementNS(SVG_NAMESPACE, 'g');
  group.setAttribute('data-ink-stroke', 'true');
  if (stroke.points.length === 0) return group;

  group.append(createDot(stroke.points[0], stroke.color));
  for (let index = 1; index < stroke.points.length; index += 1) {
    group.append(createSegment(stroke.points[index - 1], stroke.points[index], stroke.color));
  }
  return group;
}

function createRoot(view: ViewTransform) {
  const root = document.createElementNS(SVG_NAMESPACE, 'g');
  root.setAttribute(ROOT_ATTRIBUTE, 'true');
  setViewTransform(root, view);
  return root;
}

function getRoot(svg: SVGSVGElement) {
  return svg.querySelector<SVGGElement>(`g[${ROOT_ATTRIBUTE}]`);
}

export function setVectorView(svg: SVGSVGElement, view: ViewTransform) {
  const root = getRoot(svg);
  if (root) setViewTransform(root, view);
}

export function appendVectorStroke(
  svg: SVGSVGElement,
  stroke: Stroke,
  view: ViewTransform,
) {
  let root = getRoot(svg);
  if (!root) {
    root = createRoot(view);
    svg.append(root);
  }
  root.append(createStrokeGroup(stroke));
}

export function redrawVectorStrokes(
  svg: SVGSVGElement,
  strokes: readonly Stroke[],
  view: ViewTransform,
) {
  const root = createRoot(view);
  const fragment = document.createDocumentFragment();
  strokes.forEach((stroke) => fragment.append(createStrokeGroup(stroke)));
  root.append(fragment);
  svg.replaceChildren(root);
}
