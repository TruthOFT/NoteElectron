import type { InkPoint } from '../types';

type OutlinePoint = {
  x: number;
  y: number;
};

const MIN_DISTANCE = 0.05;

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

function getNormal(points: readonly InkPoint[], index: number) {
  const current = points[index];
  const previous = points[Math.max(0, index - 1)];
  const next = points[Math.min(points.length - 1, index + 1)];
  let directionX = next.x - previous.x;
  let directionY = next.y - previous.y;
  let length = Math.hypot(directionX, directionY);

  if (length < MIN_DISTANCE && index < points.length - 1) {
    directionX = next.x - current.x;
    directionY = next.y - current.y;
    length = Math.hypot(directionX, directionY);
  }
  if (length < MIN_DISTANCE && index > 0) {
    directionX = current.x - previous.x;
    directionY = current.y - previous.y;
    length = Math.hypot(directionX, directionY);
  }
  if (length < MIN_DISTANCE) return { x: 0, y: 1 };

  return {
    x: -directionY / length,
    y: directionX / length,
  };
}

function createSide(
  points: readonly InkPoint[],
  direction: 1 | -1,
): OutlinePoint[] {
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
    const midpoint = {
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
    };
    parts.push(`Q ${formatPoint(current)} ${formatPoint(midpoint)}`);
  }
  const end = points.at(-1);
  if (end) parts.push(`Q ${formatPoint(end)} ${formatPoint(end)}`);
}

export function createStrokeOutlinePath(sourcePoints: readonly InkPoint[]) {
  const points = removeDuplicatePoints(sourcePoints);
  if (points.length === 0) return '';
  if (points.length === 1) return createCirclePath(points[0]);

  const leftSide = createSide(points, 1);
  const rightSide = createSide(points, -1).reverse();
  const start = points[0];
  const end = points.at(-1) ?? start;
  const endRadius = formatNumber(end.width / 2);
  const startRadius = formatNumber(start.width / 2);
  const parts = [`M ${formatPoint(leftSide[0])}`];

  appendSmoothSide(parts, leftSide);
  parts.push(
    `A ${endRadius} ${endRadius} 0 0 0 ${formatPoint(rightSide[0])}`,
  );
  appendSmoothSide(parts, rightSide);
  parts.push(
    `A ${startRadius} ${startRadius} 0 0 0 ${formatPoint(leftSide[0])}`,
    'Z',
  );
  return parts.join(' ');
}
