import type { BrushPoint, BrushStroke } from './types';

/**
 * 圆头线段描边：无轮廓法线噪声，稳定优先。
 * 每段用两端半径均值作线宽。
 */
export function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: BrushStroke,
) {
  const { points, color } = stroke;
  if (points.length === 0) return;

  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (points.length === 1) {
    const point = points[0];
    context.beginPath();
    context.arc(point.x, point.y, point.r, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(current.x, current.y);
    context.lineWidth = previous.r + current.r;
    context.stroke();
  }

  context.restore();
}

export function drawStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly BrushStroke[],
) {
  strokes.forEach((stroke) => drawStroke(context, stroke));
}

export function strokeBounds(points: readonly BrushPoint[], padding = 2) {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  let maxR = points[0].r;

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxR = Math.max(maxR, point.r);
  });

  const pad = maxR + padding;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}
