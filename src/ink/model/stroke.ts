import type {
  BrushSettings,
  InkPoint,
  PointerSample,
  Stroke,
} from '../types';
import { stabilizePoint } from './smoothing';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function createInkPoint(
  sample: PointerSample,
  stroke: Stroke,
  previous?: InkPoint,
): InkPoint {
  const deltaTime = previous ? Math.max(1, sample.time - previous.time) : 1;
  const distance = previous
    ? Math.hypot(sample.x - previous.rawX, sample.y - previous.rawY)
    : 0;
  const rawVelocity = distance / deltaTime;
  const dampingResponse = 1 - stroke.stability / 100 * 0.55;
  const x = previous
    ? previous.x + (sample.x - previous.x) * dampingResponse
    : sample.x;
  const y = previous
    ? previous.y + (sample.y - previous.y) * dampingResponse
    : sample.y;
  const pressure = previous
    ? previous.pressure * 0.15 + sample.pressure * 0.85
    : sample.pressure;
  const velocity = previous
    ? previous.velocity * 0.25 + rawVelocity * 0.75
    : 0;
  const sharpnessRatio = stroke.sharpness / 100;
  const sensitivityRatio = stroke.pressureSensitivity / 100;
  const minimumWidthRatio = 0.42 - sharpnessRatio * 0.34;
  const pressureExponent = 0.25 + sensitivityRatio * 1.55;
  const pressureFactor = minimumWidthRatio
    + (1 - minimumWidthRatio) * Math.pow(pressure, pressureExponent);
  const speedStrength = 0.03 + sharpnessRatio * 0.27;
  const speedFloor = 0.85 - sharpnessRatio * 0.6;
  const speedFactor = clamp(1.06 - velocity * speedStrength, speedFloor, 1);
  const highSensitivity = clamp((sensitivityRatio - 0.55) / 0.45, 0, 1);
  const minimumWidth = 0.8 - highSensitivity * sharpnessRatio * 0.6;
  const targetWidth = Math.max(
    minimumWidth,
    stroke.size * pressureFactor * speedFactor,
  );
  const widthResponse = targetWidth < (previous?.width ?? targetWidth)
    ? 0.68 + sensitivityRatio * 0.16
    : 0.58 - sensitivityRatio * 0.12;
  const width = previous
    ? previous.width + (targetWidth - previous.width) * widthResponse
    : targetWidth;

  return {
    x,
    y,
    rawX: sample.x,
    rawY: sample.y,
    pressure,
    velocity,
    width,
    time: sample.time,
  };
}

export function createStroke(settings: BrushSettings): Stroke {
  return {
    ...settings,
    liveTailPoints: 2 + Math.round(settings.stability / 25),
    rawPoints: [],
    points: [],
  };
}

export function appendSample(stroke: Stroke, sample: PointerSample): InkPoint[] {
  const previous = stroke.rawPoints.at(-1);
  const point = createInkPoint(sample, stroke, previous);
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.1) {
    return [];
  }
  stroke.rawPoints.push(point);

  const count = stroke.rawPoints.length;
  if (count < stroke.liveTailPoints + 2) return [];

  if (stroke.points.length === 0) {
    const stableStart = stroke.rawPoints.slice(0, 2).map((item) => ({ ...item }));
    stroke.points.push(...stableStart);
    return stableStart;
  }

  const stableIndex = count - stroke.liveTailPoints - 1;
  const stablePoint = stabilizePoint(
    stroke.rawPoints[stableIndex - 1],
    stroke.rawPoints[stableIndex],
    stroke.rawPoints[stableIndex + 1],
    stroke.stability,
  );
  stroke.points.push(stablePoint);
  return [stablePoint];
}

export function finishStroke(stroke: Stroke): InkPoint[] {
  const tailStart = stroke.points.length === 0
    ? 0
    : Math.max(0, stroke.rawPoints.length - stroke.liveTailPoints);
  const addedPoints = stroke.rawPoints
    .slice(tailStart)
    .map((point) => ({ ...point }));

  stroke.points.push(...addedPoints);
  return addedPoints;
}
