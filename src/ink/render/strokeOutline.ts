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
  const points = densifyPoints(removeDuplicatePoints(sourcePoints));
  if (points.length === 0) return '';
  if (points.length === 1) return createCirclePath(points[0]);

  const parts: string[] = [];
  for (let index = 1; index < points.length; index += 1) {
    appendSegmentBody(parts, points[index - 1], points[index]);
  }
  points.forEach((point) => parts.push(createCirclePath(point)));
  return parts.join(' ');
}
