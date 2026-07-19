import type { Stroke, ViewTransform } from '../types';
import { createStrokeOutlinePath } from './strokeOutline';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const ROOT_ATTRIBUTE = 'data-ink-root';

function setViewTransform(root: SVGGElement, view: ViewTransform) {
  root.setAttribute(
    'transform',
    `translate(${view.offsetX} ${view.offsetY}) scale(${view.scale})`,
  );
}

function createStrokePath(stroke: Stroke) {
  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('data-ink-stroke', 'true');
  path.setAttribute('d', createStrokeOutlinePath(stroke.points));
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
