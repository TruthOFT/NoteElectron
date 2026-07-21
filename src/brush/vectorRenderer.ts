import { createStrokeOutlinePath } from './strokeOutline';
import type { BrushStroke } from './types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function resizeVectorLayer(
  svg: SVGSVGElement,
  width: number,
  height: number,
) {
  svg.setAttribute('viewBox', `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
  svg.setAttribute('preserveAspectRatio', 'none');
}

function createStrokePath(stroke: BrushStroke) {
  const pathData = createStrokeOutlinePath(stroke.points);
  if (!pathData) return null;

  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('fill', stroke.color);
  path.setAttribute('fill-rule', 'nonzero');
  path.setAttribute('shape-rendering', 'geometricPrecision');
  path.setAttribute('data-brush-stroke', 'true');
  return path;
}

export function appendVectorStroke(svg: SVGSVGElement, stroke: BrushStroke) {
  const path = createStrokePath(stroke);
  if (path) svg.append(path);
}

export function redrawVectorStrokes(
  svg: SVGSVGElement,
  strokes: readonly BrushStroke[],
) {
  const fragment = document.createDocumentFragment();
  strokes.forEach((stroke) => {
    const path = createStrokePath(stroke);
    if (path) fragment.append(path);
  });
  svg.replaceChildren(fragment);
}
