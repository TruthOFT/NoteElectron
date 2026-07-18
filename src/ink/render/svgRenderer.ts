import type { InkPoint, Stroke, ViewTransform } from '../types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ROOT_ATTRIBUTE = 'data-ink-root';

function setViewTransform(root: SVGGElement, view: ViewTransform) {
  root.setAttribute(
    'transform',
    `translate(${view.offsetX} ${view.offsetY}) scale(${view.scale})`,
  );
}

const formatNumber = (value: number) => String(Math.round(value * 1000) / 1000);

function appendCirclePath(parts: string[], point: InkPoint) {
  const y = formatNumber(point.y);
  const radius = formatNumber(point.width / 2);
  const right = formatNumber(point.x + point.width / 2);
  const left = formatNumber(point.x - point.width / 2);
  parts.push(
    `M ${right} ${y}`,
    `A ${radius} ${radius} 0 1 0 ${left} ${y}`,
    `A ${radius} ${radius} 0 1 0 ${right} ${y}`,
    'Z',
  );
}

function appendCapsulePath(parts: string[], start: InkPoint, end: InkPoint) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < 0.01) {
    appendCirclePath(parts, end);
    return;
  }

  const radius = (start.width + end.width) / 4;
  const normalX = -deltaY / length * radius;
  const normalY = deltaX / length * radius;
  const startLeftX = formatNumber(start.x + normalX);
  const startLeftY = formatNumber(start.y + normalY);
  const endLeftX = formatNumber(end.x + normalX);
  const endLeftY = formatNumber(end.y + normalY);
  const endRightX = formatNumber(end.x - normalX);
  const endRightY = formatNumber(end.y - normalY);
  const startRightX = formatNumber(start.x - normalX);
  const startRightY = formatNumber(start.y - normalY);
  const formattedRadius = formatNumber(radius);

  parts.push(
    `M ${startLeftX} ${startLeftY}`,
    `L ${endLeftX} ${endLeftY}`,
    `A ${formattedRadius} ${formattedRadius} 0 0 0 ${endRightX} ${endRightY}`,
    `L ${startRightX} ${startRightY}`,
    `A ${formattedRadius} ${formattedRadius} 0 0 0 ${startLeftX} ${startLeftY}`,
    'Z',
  );
}

function createStrokePath(stroke: Stroke) {
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  const parts: string[] = [];
  if (stroke.points.length > 0) appendCirclePath(parts, stroke.points[0]);
  for (let index = 1; index < stroke.points.length; index += 1) {
    appendCapsulePath(parts, stroke.points[index - 1], stroke.points[index]);
  }
  path.setAttribute('data-ink-stroke', 'true');
  path.setAttribute('d', parts.join(' '));
  path.setAttribute('fill', stroke.color);
  path.setAttribute('fill-rule', 'nonzero');
  return path;
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
  root.append(createStrokePath(stroke));
}

export function redrawVectorStrokes(
  svg: SVGSVGElement,
  strokes: readonly Stroke[],
  view: ViewTransform,
) {
  const root = createRoot(view);
  const fragment = document.createDocumentFragment();
  strokes.forEach((stroke) => fragment.append(createStrokePath(stroke)));
  root.append(fragment);
  svg.replaceChildren(root);
}
