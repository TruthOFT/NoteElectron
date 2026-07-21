import type { InkPoint } from '../types';

type OutlinePoint = {
  x: number;
  y: number;
};

const MIN_DISTANCE = 0.05;
const MAX_SUBDIVISIONS = 4;

const formatNumber = (value: number) => String(Math.round(value * 1000) / 1000);

const formatPoint = (point: OutlinePoint) =>
  `${formatNumber(point.x)} ${formatNumber(point.y)}`;

function createCirclePath(point: InkPoint) {
  const radius = point.width / 2;
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

function removeDuplicatePoints(points: readonly InkPoint[]) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return Math.hypot(point.x - previous.x, point.y - previous.y) >= MIN_DISTANCE;
  });
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function densifyPoints(points: readonly InkPoint[]) {
  if (points.length < 2) return [...points];
  const result: InkPoint[] = [{ ...points[0] }];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const maximumStep = clamp(Math.min(start.width, end.width) * 0.8, 0.7, 2);
    const subdivisions = Math.min(
      MAX_SUBDIVISIONS,
      Math.max(1, Math.ceil(distance / maximumStep)),
    );

    for (let step = 1; step <= subdivisions; step += 1) {
      const progress = step / subdivisions;
      result.push({
        ...end,
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        width: start.width + (end.width - start.width) * progress,
      });
    }
  }

  return result;
}

function smoothStrokePass(points: readonly InkPoint[]) {
  if (points.length < 5) return [...points];
  return points.map((point, index) => {
    if (index < 2 || index > points.length - 3) return { ...point };
    const previous2 = points[index - 2];
    const previous = points[index - 1];
    const next = points[index + 1];
    const next2 = points[index + 2];
    const incomingX = point.x - previous.x;
    const incomingY = point.y - previous.y;
    const outgoingX = next.x - point.x;
    const outgoingY = next.y - point.y;
    const incomingLength = Math.hypot(incomingX, incomingY);
    const outgoingLength = Math.hypot(outgoingX, outgoingY);
    const turn = incomingLength > MIN_DISTANCE && outgoingLength > MIN_DISTANCE
      ? Math.acos(clamp(
        (incomingX * outgoingX + incomingY * outgoingY)
          / (incomingLength * outgoingLength),
        -1,
        1,
      ))
      : 0;
    const cornerRatio = clamp((turn - 0.28) / 0.9, 0, 1);
    // 轮廓只轻修几何；少抹 = 少软、少粘
    const positionBlend = 0.32 * (1 - cornerRatio * 0.9);
    const averageX = previous2.x * 0.1
      + previous.x * 0.2
      + point.x * 0.4
      + next.x * 0.2
      + next2.x * 0.1;
    const averageY = previous2.y * 0.1
      + previous.y * 0.2
      + point.y * 0.4
      + next.y * 0.2
      + next2.y * 0.1;
    return {
      ...point,
      x: point.x + (averageX - point.x) * positionBlend,
      y: point.y + (averageY - point.y) * positionBlend,
      width: point.width,
    };
  });
}

// 一遍即可；宽度忠于模型层
function smoothStroke(points: readonly InkPoint[]) {
  return smoothStrokePass(points);
}

function getNormal(points: readonly InkPoint[], index: number) {
  const previous = points[Math.max(0, index - 2)];
  const next = points[Math.min(points.length - 1, index + 2)];
  const directionX = next.x - previous.x;
  const directionY = next.y - previous.y;
  const length = Math.hypot(directionX, directionY);
  if (length < MIN_DISTANCE) return { x: 0, y: 1 };
  return {
    x: -directionY / length,
    y: directionX / length,
  };
}

function createSide(points: readonly InkPoint[], direction: 1 | -1) {
  return points.map((point, index) => {
    const normal = getNormal(points, index);
    const radius = point.width / 2;
    return {
      x: point.x + normal.x * radius * direction,
      y: point.y + normal.y * radius * direction,
    };
  });
}

function appendSmoothSide(parts: string[], points: readonly OutlinePoint[]) {
  if (points.length < 2) return;
  if (points.length === 2) {
    parts.push(`L ${formatPoint(points[1])}`);
    return;
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    parts.push(`Q ${formatPoint(current)} ${formatPoint({
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
    })}`);
  }
  const end = points.at(-1);
  if (end) parts.push(`Q ${formatPoint(end)} ${formatPoint(end)}`);
}

function getTurn(points: readonly InkPoint[], index: number) {
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

function splitSmoothRuns(points: readonly InkPoint[]) {
  const runs: InkPoint[][] = [];
  let start = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    if (getTurn(points, index) < Math.PI * 0.32) continue;
    runs.push(points.slice(start, index + 1));
    start = index;
  }
  runs.push(points.slice(start));
  return runs.filter((run) => run.length >= 2);
}

function createSmoothRunPath(points: readonly InkPoint[]) {
  const leftSide = createSide(points, 1);
  const rightSide = createSide(points, -1).reverse();
  const start = points[0];
  const end = points.at(-1) ?? start;
  const parts = [`M ${formatPoint(leftSide[0])}`];

  appendSmoothSide(parts, leftSide);
  parts.push(
    `A ${formatNumber(end.width / 2)} ${formatNumber(end.width / 2)}`
      + ` 0 0 0 ${formatPoint(rightSide[0])}`,
  );
  appendSmoothSide(parts, rightSide);
  parts.push(
    `A ${formatNumber(start.width / 2)} ${formatNumber(start.width / 2)}`
      + ` 0 0 0 ${formatPoint(leftSide[0])}`,
    'Z',
  );
  return parts.join(' ');
}

export function createStrokeOutlinePath(sourcePoints: readonly InkPoint[]) {
  const points = smoothStroke(
    densifyPoints(removeDuplicatePoints(sourcePoints)),
  );
  if (points.length === 0) return '';
  if (points.length === 1) return createCirclePath(points[0]);

  const runs = splitSmoothRuns(points);
  // 转角不补整圆，避免横折/交接「墨团粘连」
  return runs.map(createSmoothRunPath).join(' ');
}
