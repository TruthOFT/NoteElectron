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

function appendSegmentBody(
  parts: string[],
  start: InkPoint,
  end: InkPoint,
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < MIN_DISTANCE) return;

  const normalX = -deltaY / length;
  const normalY = deltaX / length;
  const startRadius = start.width / 2;
  const endRadius = end.width / 2;
  const startLeft = {
    x: start.x + normalX * startRadius,
    y: start.y + normalY * startRadius,
  };
  const endLeft = {
    x: end.x + normalX * endRadius,
    y: end.y + normalY * endRadius,
  };
  const endRight = {
    x: end.x - normalX * endRadius,
    y: end.y - normalY * endRadius,
  };
  const startRight = {
    x: start.x - normalX * startRadius,
    y: start.y - normalY * startRadius,
  };

  parts.push(
    `M ${formatPoint(startLeft)}`,
    `L ${formatPoint(endLeft)}`,
    `L ${formatPoint(endRight)}`,
    `L ${formatPoint(startRight)}`,
    'Z',
  );
}

export function createStrokeOutlinePath(sourcePoints: readonly InkPoint[]) {
  const points = removeDuplicatePoints(sourcePoints);
  if (points.length === 0) return '';
  if (points.length === 1) return createCirclePath(points[0]);

  const parts: string[] = [];
  for (let index = 1; index < points.length; index += 1) {
    appendSegmentBody(parts, points[index - 1], points[index]);
  }
  points.forEach((point) => parts.push(createCirclePath(point)));
  return parts.join(' ');
}
