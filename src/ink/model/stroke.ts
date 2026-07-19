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
  const screenDistance = distance * stroke.inputScale;
  const rawVelocity = screenDistance / deltaTime;
  const sharpnessRatio = stroke.sharpness / 100;
  const sensitivityRatio = stroke.pressureSensitivity / 100;
  const lowPressureRatio = clamp((0.5 - sample.pressure) / 0.44, 0, 1);
  const thinStrokeSmoothing = sharpnessRatio
    * sensitivityRatio
    * lowPressureRatio;
  const referenceWidth = previous?.width ?? stroke.size;
  const thinStrokeRatio = clamp((5 - referenceWidth) / 4, 0, 1);
  let x = sample.x;
  let y = sample.y;
  if (previous) {
    const previous2 = stroke.rawPoints.at(-2);
    const previous3 = stroke.rawPoints.at(-3);
    const directionStart = previous3 ?? previous2 ?? previous;
    let tangentX = previous.rawX - directionStart.rawX;
    let tangentY = previous.rawY - directionStart.rawY;
    let tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength < 0.01) {
      tangentX = sample.x - previous.rawX;
      tangentY = sample.y - previous.rawY;
      tangentLength = Math.hypot(tangentX, tangentY);
    }
    if (tangentLength > 0.01) {
      tangentX /= tangentLength;
      tangentY /= tangentLength;
      const errorX = sample.x - previous.x;
      const errorY = sample.y - previous.y;
      const along = errorX * tangentX + errorY * tangentY;
      const lateralX = errorX - tangentX * along;
      const lateralY = errorY - tangentY * along;
      let turnConfidence = 0;
      if (previous2 && previous3) {
        const firstX = previous2.rawX - previous3.rawX;
        const firstY = previous2.rawY - previous3.rawY;
        const secondX = previous.rawX - previous2.rawX;
        const secondY = previous.rawY - previous2.rawY;
        const thirdX = sample.x - previous.rawX;
        const thirdY = sample.y - previous.rawY;
        const firstLength = Math.hypot(firstX, firstY);
        const secondLength = Math.hypot(secondX, secondY);
        const thirdLength = Math.hypot(thirdX, thirdY);
        const previousCross = firstX * secondY - firstY * secondX;
        const currentCross = secondX * thirdY - secondY * thirdX;
        if (
          previousCross * currentCross > 0
          && firstLength > 0.01
          && secondLength > 0.01
          && thirdLength > 0.01
        ) {
          const previousTurn = Math.abs(previousCross)
            / (firstLength * secondLength);
          const currentTurn = Math.abs(currentCross)
            / (secondLength * thirdLength);
          turnConfidence = clamp(
            Math.min(previousTurn, currentTurn) / 0.55,
            0,
            1,
          );
        }
      }
      const alongResponse = clamp(
        0.88 + Math.min(screenDistance, 2) * 0.04,
        0.88,
        0.96,
      );
      const lateralResponse = clamp(
        0.5 - thinStrokeSmoothing * 0.08 - thinStrokeRatio * 0.25 + turnConfidence * 0.4,
        0.12,
        0.9,
      );
      x = previous.x
        + tangentX * along * alongResponse
        + lateralX * lateralResponse;
      y = previous.y
        + tangentY * along * alongResponse
        + lateralY * lateralResponse;
    }
  }
  const pressureResponse = 0.78 - thinStrokeSmoothing * 0.42;
  const pressure = previous
    ? previous.pressure * (1 - pressureResponse)
      + sample.pressure * pressureResponse
    : sample.pressure;
  const velocity = previous
    ? previous.velocity * 0.25 + rawVelocity * 0.75
    : 0;
  const minimumWidthRatio = 0.42 - sharpnessRatio * 0.4;
  const pressureExponent = (0.2 + sensitivityRatio * 0.9)
    * (1 - thinStrokeRatio * 0.4);
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
  const baseWidthResponse = targetWidth < (previous?.width ?? targetWidth)
    ? 0.68 + sensitivityRatio * 0.16
    : 0.58 - sensitivityRatio * 0.12;
  const thinWidthRatio = clamp((3 - targetWidth) / 2.4, 0, 1);
  const widthResponse = baseWidthResponse
    * (1 - thinWidthRatio * 0.3);
  const respondedWidth = previous
    ? previous.width + (targetWidth - previous.width) * widthResponse
    : targetWidth;
  const thinResultRatio = previous
    ? clamp((3 - Math.min(previous.width, respondedWidth)) / 2.6, 0, 1)
    : 0;
  const maximumWidthChange = (
    0.04
    + Math.min(screenDistance, 2) * 0.12
    + (1 - thinResultRatio) * 0.3
  ) * (1 - thinResultRatio * 0.5);
  const width = previous
    ? previous.width + clamp(
      respondedWidth - previous.width,
      -maximumWidthChange,
      maximumWidthChange,
    )
    : respondedWidth;

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

export function createStroke(
  settings: BrushSettings,
  inputScale = 1,
): Stroke {
  return {
    ...settings,
    inputScale: Math.max(0.01, inputScale),
    liveTailPoints: 2 + Math.round(settings.stability / 25),
    rawPoints: [],
    points: [],
  };
}

export function appendSample(stroke: Stroke, sample: PointerSample): InkPoint[] {
  const previous = stroke.rawPoints.at(-1);
  const point = createInkPoint(sample, stroke, previous);
  if (
    previous
    && Math.hypot(point.x - previous.x, point.y - previous.y)
      * stroke.inputScale < 0.1
  ) {
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
    stroke.inputScale,
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
