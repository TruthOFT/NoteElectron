import type { BrushPoint } from './types';

type OutlinePoint = {
  x: number;
  y: number;
};

const MIN_DISTANCE = 0.05;
const MAX_SUBDIVISIONS = 8;
const SHARP_TURN_THRESHOLD = Math.PI * 0.75;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const formatNumber = (value: number) =>
  String(Math.round(value * 1000) / 1000);

const formatPoint = (point: OutlinePoint) =>
  `${formatNumber(point.x)} ${formatNumber(point.y)}`;

function createCirclePath(point: BrushPoint) {
  const radius = Math.max(0.01, point.r);
  const right = { x: point.x + radius, y: point.y };
  const left = { x: point.x - radius, y: point.y };
  const formattedRadius = formatNumber(radius);

  return [
    `M ${formatPoint(right)}`,
    `A ${formattedRadius} ${formattedRadius} 0 1 0 ${formatPoint(left)}`,
    `A ${formattedRadius} ${formattedRadius} 0 1 0 ${formatPoint(right)}`,
    'Z',
  ].join(' ');
}

function removeDuplicatePoints(points: readonly BrushPoint[]) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return Math.hypot(point.x - previous.x, point.y - previous.y) >= MIN_DISTANCE;
  });
}

/**
 * 按当前半径加密中心线，防止相邻点过远时轮廓法线翻折。
 * 只插值位置与半径，不改变 dev 分支已有的手感模型。
 */
function densifyPoints(points: readonly BrushPoint[]) {
  if (points.length < 2) return points.map((point) => ({ ...point }));

  const result: BrushPoint[] = [{ ...points[0] }];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const maximumStep = clamp(Math.min(start.r, end.r) * 0.9, 0.35, 1.2);
    const subdivisions = Math.min(
      MAX_SUBDIVISIONS,
      Math.max(1, Math.ceil(distance / maximumStep)),
    );

    for (let step = 1; step <= subdivisions; step += 1) {
      const progress = step / subdivisions;
      result.push({
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        r: start.r + (end.r - start.r) * progress,
        pressure: start.pressure + (end.pressure - start.pressure) * progress,
        time: start.time + (end.time - start.time) * progress,
      });
    }
  }

  return result;
}

/**
 * 使用前后多个点的加权平均方向计算法线，减少可变宽边缘抖动。
 */
function getNormal(points: readonly BrushPoint[], index: number) {
  const span = 3;
  let directionX = 0;
  let directionY = 0;
  let weightSum = 0;

  for (let offset = 1; offset <= span; offset += 1) {
    const previous = points[Math.max(0, index - offset)];
    const next = points[Math.min(points.length - 1, index + offset)];
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const length = Math.hypot(dx, dy);
    if (length < MIN_DISTANCE) continue;

    const weight = 1 / offset;
    directionX += (dx / length) * weight;
    directionY += (dy / length) * weight;
    weightSum += weight;
  }

  if (weightSum < 1e-6) return { x: 0, y: 1 };

  directionX /= weightSum;
  directionY /= weightSum;
  const length = Math.hypot(directionX, directionY);
  if (length < MIN_DISTANCE) return { x: 0, y: 1 };

  return {
    x: -directionY / length,
    y: directionX / length,
  };
}

function createSide(points: readonly BrushPoint[], direction: 1 | -1) {
  return points.map((point, index) => {
    const normal = getNormal(points, index);
    return {
      x: point.x + normal.x * point.r * direction,
      y: point.y + normal.y * point.r * direction,
    };
  });
}

/** 使用二次曲线经过边界点，避免逐点直线连接产生硬折。 */
function appendSmoothSide(parts: string[], points: readonly OutlinePoint[]) {
  if (points.length < 2) return;

  if (points.length === 2) {
    parts.push(`L ${formatPoint(points[1])}`);
    return;
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    parts.push(
      `Q ${formatPoint(current)} ${formatPoint({
        x: (current.x + next.x) / 2,
        y: (current.y + next.y) / 2,
      })}`,
    );
  }

  const end = points.at(-1);
  if (end) parts.push(`Q ${formatPoint(end)} ${formatPoint(end)}`);
}

function getTurn(points: readonly BrushPoint[], index: number) {
  const previous = points[index - 1];
  const current = points[index];
  const next = points[index + 1];
  const incomingX = current.x - previous.x;
  const incomingY = current.y - previous.y;
  const outgoingX = next.x - current.x;
  const outgoingY = next.y - current.y;
  const incomingLength = Math.hypot(incomingX, incomingY);
  const outgoingLength = Math.hypot(outgoingX, outgoingY);

  if (incomingLength < MIN_DISTANCE || outgoingLength < MIN_DISTANCE) return 0;

  return Math.acos(clamp(
    (incomingX * outgoingX + incomingY * outgoingY)
      / (incomingLength * outgoingLength),
    -1,
    1,
  ));
}

/**
 * 只在接近折返的尖角处分段，避免左右轮廓交叉形成长尖刺。
 * 普通汉字转折保持连续，不额外制造圆形墨团。
 */
function splitSharpRuns(points: readonly BrushPoint[]) {
  const runs: BrushPoint[][] = [];
  let start = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    if (getTurn(points, index) < SHARP_TURN_THRESHOLD) continue;
    runs.push(points.slice(start, index + 1));
    start = index;
  }

  runs.push(points.slice(start));
  return runs.filter((run) => run.length >= 2);
}

function createRunPath(points: readonly BrushPoint[]) {
  const leftSide = createSide(points, 1);
  const rightSide = createSide(points, -1).reverse();
  const start = points[0];
  const end = points.at(-1) ?? start;
  const parts = [`M ${formatPoint(leftSide[0])}`];

  appendSmoothSide(parts, leftSide);
  parts.push(
    `A ${formatNumber(end.r)} ${formatNumber(end.r)}`
      + ` 0 0 0 ${formatPoint(rightSide[0])}`,
  );
  appendSmoothSide(parts, rightSide);
  parts.push(
    `A ${formatNumber(start.r)} ${formatNumber(start.r)}`
      + ` 0 0 0 ${formatPoint(leftSide[0])}`,
    'Z',
  );

  return parts.join(' ');
}

/**
 * 将定稿后的稳定中心线转换为可变宽 SVG 闭合轮廓。
 * 输入点不再做位置滤波，避免破坏 dev 分支已经稳定的手感。
 */
export function createStrokeOutlinePath(sourcePoints: readonly BrushPoint[]) {
  const points = densifyPoints(removeDuplicatePoints(sourcePoints));
  if (points.length === 0) return '';
  if (points.length === 1) return createCirclePath(points[0]);

  return splitSharpRuns(points).map(createRunPath).join(' ');
}
