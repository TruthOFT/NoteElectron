import type {
  DirtyRect,
  InkPoint,
  Stroke,
  ViewTransform,
} from '../types';

const IDENTITY_VIEW: ViewTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

const getRenderScale = () =>
  Math.min(2, Math.max(1.5, (window.devicePixelRatio || 1) * 1.5));

export function prepareContext(
  canvas: HTMLCanvasElement,
  view: ViewTransform = IDENTITY_VIEW,
) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('无法创建 Canvas 2D 上下文');
  const renderScale = getRenderScale();
  context.setTransform(
    renderScale * view.scale,
    0,
    0,
    renderScale * view.scale,
    renderScale * view.offsetX,
    renderScale * view.offsetY,
  );
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
}

export function getDirtyRect(points: InkPoint[]): DirtyRect | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  let maxWidth = points[0].width;

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxWidth = Math.max(maxWidth, point.width);
  });

  const padding = maxWidth / 2 + 3;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

export function clearCanvas(
  canvas: HTMLCanvasElement,
  view: ViewTransform = IDENTITY_VIEW,
) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('无法创建 Canvas 2D 上下文');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  return prepareContext(canvas, view);
}

export function resizeCanvas(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  const scale = getRenderScale();
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));

  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

function drawDot(context: CanvasRenderingContext2D, point: InkPoint, color: string) {
  context.beginPath();
  context.arc(point.x, point.y, point.width / 2, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

function drawSegment(
  context: CanvasRenderingContext2D,
  start: InkPoint,
  end: InkPoint,
  color: string,
) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.01) {
    drawDot(context, end, color);
    return;
  }

  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = (start.width + end.width) / 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke();
}

export function drawPoints(
  context: CanvasRenderingContext2D,
  points: InkPoint[],
  color: string,
) {
  if (points.length === 0) return;
  drawDot(context, points[0], color);
  for (let index = 1; index < points.length; index += 1) {
    drawSegment(context, points[index - 1], points[index], color);
  }
}

export function drawAddedPoints(
  context: CanvasRenderingContext2D,
  previous: InkPoint | undefined,
  points: InkPoint[],
  color: string,
) {
  let lastPoint = previous;
  points.forEach((point) => {
    if (lastPoint) drawSegment(context, lastPoint, point, color);
    else drawDot(context, point, color);
    lastPoint = point;
  });
}

export function redrawStrokes(
  canvas: HTMLCanvasElement,
  strokes: readonly Stroke[],
  view: ViewTransform = IDENTITY_VIEW,
) {
  const context = clearCanvas(canvas, view);
  strokes.forEach((stroke) => drawPoints(context, stroke.points, stroke.color));
}
