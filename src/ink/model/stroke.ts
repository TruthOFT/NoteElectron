import type {
  BrushSettings,
  InkPoint,
  PointerSample,
  Stroke,
} from '../types';
import { stabilizePoint } from './smoothing';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const TURN_WINDOW_DISTANCE = 16;
const MAX_TURN_WIDTH_BOOST = 0.35;

const smoothstep = (start: number, end: number, value: number) => {
  const progress = clamp((value - start) / (end - start), 0, 1);
  return progress * progress * (3 - 2 * progress);
};

function getTurnScore(sample: PointerSample, stroke: Stroke) {
  if (stroke.rawPoints.length < 2) return 0;

  let cursorX = sample.x;
  let cursorY = sample.y;
  let newerDirection: { x: number; y: number } | null = null;
  let pathLength = 0;
  let signedTurn = 0;
  let absoluteTurn = 0;
  let earliestTime = sample.time;

  for (
    let index = stroke.rawPoints.length - 1;
    index >= 0 && pathLength < TURN_WINDOW_DISTANCE;
    index -= 1
  ) {
    const point = stroke.rawPoints[index];
    const deltaX = (cursorX - point.rawX) * stroke.inputScale;
    const deltaY = (cursorY - point.rawY) * stroke.inputScale;
    const segmentLength = Math.hypot(deltaX, deltaY);
    cursorX = point.rawX;
    cursorY = point.rawY;
    earliestTime = point.time;
    if (segmentLength < 0.1) continue;

    const directionX = deltaX / segmentLength;
    const directionY = deltaY / segmentLength;
    if (newerDirection) {
      const cross = directionX * newerDirection.y
        - directionY * newerDirection.x;
      const dot = directionX * newerDirection.x
        + directionY * newerDirection.y;
      const turn = clamp(
        Math.atan2(cross, dot),
        -Math.PI / 2,
        Math.PI / 2,
      );
      signedTurn += turn;
      absoluteTurn += Math.abs(turn);
    }
    newerDirection = { x: directionX, y: directionY };
    pathLength += segmentLength;
  }

  if (pathLength < 2 || absoluteTurn < 0.01) return 0;

  const cumulativeTurn = Math.abs(signedTurn);
  const consistency = cumulativeTurn / absoluteTurn;
  const consistencyScore = smoothstep(0.55, 0.9, consistency);
  const curvature = cumulativeTurn / pathLength;
  const duration = Math.max(1, sample.time - earliestTime);
  const angularSpeed = cumulativeTurn / duration;
  const angleScore = smoothstep(0.08, 0.5, cumulativeTurn);
  const curvatureScore = smoothstep(0.006, 0.05, curvature);
  const angularSpeedScore = smoothstep(0.001, 0.015, angularSpeed);

  return angleScore
    * (0.35 + curvatureScore * 0.65)
    * (0.75 + angularSpeedScore * 0.25)
    * consistencyScore;
}

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
        0.54
          - thinStrokeSmoothing * 0.04
          - thinStrokeRatio * 0.1
          + turnConfidence * 0.36,
        0.32,
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
  const minimumWidthRatio = 0.42 - sharpnessRatio * 0.28;
  const pressureExponent = (0.2 + sensitivityRatio * 0.9)
    * (1 - thinStrokeRatio * 0.4);
  const pressureFactor = minimumWidthRatio
    + (1 - minimumWidthRatio) * Math.pow(pressure, pressureExponent);
  const speedStrength = 0.03 + sharpnessRatio * 0.21;
  const speedFloor = 0.85 - sharpnessRatio * 0.46;
  const speedFactor = clamp(1.06 - velocity * speedStrength, speedFloor, 1);
  const turnFactor = 1
    + getTurnScore(sample, stroke)
      * sharpnessRatio
      * MAX_TURN_WIDTH_BOOST;
  const highSensitivity = clamp((sensitivityRatio - 0.55) / 0.45, 0, 1);
  const minimumWidth = 0.8 - highSensitivity * sharpnessRatio * 0.4;
  const targetWidth = Math.max(
    minimumWidth,
    stroke.size * pressureFactor * speedFactor * turnFactor,
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
