import type { BrushPoint, BrushStroke } from './types';

const TAU = Math.PI * 2;
const MAX_DAB_SPACING = 0.2;
const DAB_RADIUS_RATIO = 0.12;
const TARGET_PIXEL_RATIO = 3;
const MAX_SURFACE_SCALE = 3;
const MAX_SURFACE_EDGE = 8192;
const MIN_VISIBLE_DIAMETER_CSS = 1.25;
/** dab 边缘抗锯齿模糊（CSS 像素）。抹掉弧线在像素边界的硬切。 */
const EDGE_SMOOTH_BLUR_PX = 0.6;

export type BrushRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function segmentTouchesRect(
  start: BrushPoint,
  end: BrushPoint,
  padding: number,
  rect: BrushRect | undefined,
) {
  if (!rect) return true;
  const minX = Math.min(start.x, end.x) - padding;
  const minY = Math.min(start.y, end.y) - padding;
  const maxX = Math.max(start.x, end.x) + padding;
  const maxY = Math.max(start.y, end.y) + padding;
  return maxX >= rect.x
    && maxY >= rect.y
    && minX <= rect.x + rect.width
    && minY <= rect.y + rect.height;
}

function appendDab(
  path: Path2D,
  x: number,
  y: number,
  radius: number,
) {
  const safeRadius = Math.max(0.01, radius);
  path.moveTo(x + safeRadius, y);
  path.arc(x, y, safeRadius, 0, TAU);
}

function buildCenterlinePath(
  points: readonly BrushPoint[],
  minimumRadius: number,
  dirtyRect?: BrushRect,
) {
  const path = new Path2D();
  if (points.length === 0) return path;
  if (!dirtyRect) {
    path.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      path.lineTo(points[index].x, points[index].y);
    }
    return path;
  }
  let continuing = false;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (!segmentTouchesRect(start, end, minimumRadius, dirtyRect)) {
      continuing = false;
      continue;
    }
    if (!continuing) path.moveTo(start.x, start.y);
    path.lineTo(end.x, end.y);
    continuing = true;
  }
  return path;
}

/**
 * 密集圆形笔触：重叠圆天然形成连续圆角和圆端。
 * 不计算轮廓法线，急转弯和半径变化不会产生翻转尖刺。
 */
function buildDabPath(
  points: readonly BrushPoint[],
  minimumRadius: number,
  dirtyRect?: BrushRect,
): { path: Path2D; hasDabs: boolean } {
  const path = new Path2D();
  let hasDabs = false;
  if (points.length === 0) return { path, hasDabs };
  if (points.length === 1 && points[0].r > minimumRadius) {
    appendDab(path, points[0].x, points[0].y, points[0].r);
    return { path, hasDabs: true };
  }

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (Math.max(start.r, end.r) <= minimumRadius) continue;
    if (!segmentTouchesRect(
      start,
      end,
      Math.max(start.r, end.r),
      dirtyRect,
    )) continue;

    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const effectiveRadius = Math.max(
      minimumRadius,
      Math.min(start.r, end.r),
    );
    const spacing = Math.max(
      0.01,
      Math.min(MAX_DAB_SPACING, effectiveRadius * DAB_RADIUS_RATIO),
    );
    const steps = Math.max(1, Math.ceil(distance / spacing));

    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const radius = start.r + (end.r - start.r) * t;
      if (radius > minimumRadius) {
        appendDab(
          path,
          start.x + (end.x - start.x) * t,
          start.y + (end.y - start.y) * t,
          radius,
        );
        hasDabs = true;
      }
    }
  }

  return { path, hasDabs };
}

export function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: BrushStroke,
  minimumRadius = 0.01,
  dirtyRect?: BrushRect,
) {
  if (stroke.points.length === 0) return;

  const centerline = buildCenterlinePath(
    stroke.points,
    minimumRadius,
    dirtyRect,
  );
  const { path: dabPath, hasDabs } = buildDabPath(
    stroke.points,
    minimumRadius,
    dirtyRect,
  );
  context.save();
  if (dirtyRect) {
    context.beginPath();
    context.rect(
      dirtyRect.x,
      dirtyRect.y,
      dirtyRect.width,
      dirtyRect.height,
    );
    context.clip();
  }
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = minimumRadius * 2;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = `blur(${EDGE_SMOOTH_BLUR_PX}px)`;

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    const radius = Math.max(minimumRadius, point.r);
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, TAU);
    context.fill();
  } else {
    context.stroke(centerline);
    if (hasDabs) context.fill(dabPath, 'nonzero');
  }
  context.restore();
}

export function drawStrokes(
  context: CanvasRenderingContext2D,
  strokes: readonly BrushStroke[],
  minimumRadius = 0.01,
) {
  strokes.forEach((stroke) => drawStroke(context, stroke, minimumRadius));
}

/**
 * 可见 Canvas 的复用高清表面。
 * 先在离屏 Canvas 超采样，再缩回目标尺寸；不改变笔迹坐标和半径。
 */
export class BrushRenderSurface {
  private readonly target: HTMLCanvasElement;

  private readonly targetContext: CanvasRenderingContext2D;

  private readonly qualityCanvas: HTMLCanvasElement;

  private readonly qualityContext: CanvasRenderingContext2D;

  private qualityScale = 1;

  private dpr = 1;

  constructor(target: HTMLCanvasElement) {
    const targetContext = target.getContext('2d');
    if (!targetContext) throw new Error('无法创建目标 2D 上下文');
    const qualityCanvas = document.createElement('canvas');
    const qualityContext = qualityCanvas.getContext('2d');
    if (!qualityContext) throw new Error('无法创建高清 2D 上下文');
    this.target = target;
    this.targetContext = targetContext;
    this.qualityCanvas = qualityCanvas;
    this.qualityContext = qualityContext;
  }

  syncSize(dpr: number) {
    const safeDpr = Math.max(1, dpr);
    this.dpr = safeDpr;
    const desiredScale = Math.min(MAX_SURFACE_SCALE, Math.max(1, TARGET_PIXEL_RATIO / safeDpr));
    const maxScale = Math.min(
      MAX_SURFACE_EDGE / this.target.width,
      MAX_SURFACE_EDGE / this.target.height,
    );
    const minimumScale = 1 / Math.max(this.target.width, this.target.height);
    const nextScale = Math.max(
      minimumScale,
      Math.min(desiredScale, maxScale),
    );
    const width = Math.max(1, Math.floor(this.target.width * nextScale));
    const height = Math.max(1, Math.floor(this.target.height * nextScale));
    const changed = this.qualityCanvas.width !== width
      || this.qualityCanvas.height !== height;

    this.qualityScale = Math.min(
      width / this.target.width,
      height / this.target.height,
    );

    if (changed) {
      this.qualityCanvas.width = width;
      this.qualityCanvas.height = height;
    }
    this.configureQualityContext();
    return changed;
  }

  clear() {
    this.qualityContext.save();
    this.qualityContext.setTransform(1, 0, 0, 1, 0, 0);
    this.qualityContext.clearRect(
      0,
      0,
      this.qualityCanvas.width,
      this.qualityCanvas.height,
    );
    this.qualityContext.restore();

    this.targetContext.save();
    this.targetContext.setTransform(1, 0, 0, 1, 0, 0);
    this.targetContext.clearRect(0, 0, this.target.width, this.target.height);
    this.targetContext.restore();
  }

  clearRect(rect: BrushRect) {
    const source = this.toPixelRect(
      rect,
      this.qualityScale,
      this.qualityCanvas.width,
      this.qualityCanvas.height,
    );
    if (!source) return;

    this.qualityContext.save();
    this.qualityContext.setTransform(1, 0, 0, 1, 0, 0);
    this.qualityContext.clearRect(
      source.x,
      source.y,
      source.width,
      source.height,
    );
    this.qualityContext.restore();

    const target = this.toPixelRect(
      rect,
      1,
      this.target.width,
      this.target.height,
    );
    if (!target) return;
    this.targetContext.save();
    this.targetContext.setTransform(1, 0, 0, 1, 0, 0);
    this.targetContext.clearRect(
      target.x,
      target.y,
      target.width,
      target.height,
    );
    this.targetContext.restore();
  }

  drawStroke(stroke: BrushStroke, dirtyRect?: BrushRect) {
    this.configureQualityContext();
    const minimumRadius = this.dpr * MIN_VISIBLE_DIAMETER_CSS / 2;
    const renderRect = dirtyRect
      ? this.alignRectToQualityPixels(dirtyRect)
      : undefined;
    if (dirtyRect && !renderRect) return;
    drawStroke(this.qualityContext, stroke, minimumRadius, renderRect);
  }

  drawStrokes(strokes: readonly BrushStroke[]) {
    strokes.forEach((stroke) => this.drawStroke(stroke));
  }

  present(dirtyRect?: BrushRect) {
    this.targetContext.save();
    this.targetContext.setTransform(1, 0, 0, 1, 0, 0);
    this.targetContext.imageSmoothingEnabled = true;
    this.targetContext.imageSmoothingQuality = 'high';
    if (!dirtyRect) {
      this.targetContext.clearRect(0, 0, this.target.width, this.target.height);
      this.targetContext.drawImage(
        this.qualityCanvas,
        0,
        0,
        this.qualityCanvas.width,
        this.qualityCanvas.height,
        0,
        0,
        this.target.width,
        this.target.height,
      );
    } else {
      const destination = this.toPixelRect(
        dirtyRect,
        1,
        this.target.width,
        this.target.height,
      );
      if (destination) {
        const sourceX = destination.x * this.qualityScale;
        const sourceY = destination.y * this.qualityScale;
        const sourceWidth = destination.width * this.qualityScale;
        const sourceHeight = destination.height * this.qualityScale;
        this.targetContext.clearRect(
          destination.x,
          destination.y,
          destination.width,
          destination.height,
        );
        this.targetContext.drawImage(
          this.qualityCanvas,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          destination.x,
          destination.y,
          destination.width,
          destination.height,
        );
      }
    }
    this.targetContext.restore();
  }

  private configureQualityContext() {
    this.qualityContext.setTransform(
      this.qualityScale,
      0,
      0,
      this.qualityScale,
      0,
      0,
    );
    this.qualityContext.imageSmoothingEnabled = true;
    this.qualityContext.imageSmoothingQuality = 'high';
  }

  private toPixelRect(
    rect: BrushRect,
    scale: number,
    width: number,
    height: number,
  ): BrushRect | null {
    const x = Math.max(0, Math.floor(rect.x * scale));
    const y = Math.max(0, Math.floor(rect.y * scale));
    const right = Math.min(width, Math.ceil((rect.x + rect.width) * scale));
    const bottom = Math.min(height, Math.ceil((rect.y + rect.height) * scale));
    if (right <= x || bottom <= y) return null;
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
    };
  }

  private alignRectToQualityPixels(rect: BrushRect): BrushRect | null {
    const pixels = this.toPixelRect(
      rect,
      this.qualityScale,
      this.qualityCanvas.width,
      this.qualityCanvas.height,
    );
    if (!pixels) return null;
    return {
      x: pixels.x / this.qualityScale,
      y: pixels.y / this.qualityScale,
      width: pixels.width / this.qualityScale,
      height: pixels.height / this.qualityScale,
    };
  }
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
