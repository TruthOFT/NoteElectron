import type {
  BrushSettings,
  InkPoint,
  PointerSample,
  Stroke,
} from '../types';
import { stabilizePoint } from './smoothing';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const lerp = (start: number, end: number, amount: number) =>
  start + (end - start) * amount;

const TURN_WINDOW_DISTANCE = 16;
const MAX_TURN_WIDTH_BOOST = 0.35;
const TURN_RISE_DISTANCE = 3;
const TURN_FALL_DISTANCE = 6;
const MINIMUM_SAMPLE_DISTANCE = 0.5;
const LIVE_TAIL_POINTS = 1;

const smoothedTurnScores = new WeakMap<Stroke, number>();

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

function getSmoothedTurnScore(
  sample: PointerSample,
  stroke: Stroke,
  screenDistance: number,
) {
  const target = getTurnScore(sample, stroke);
  const previous = smoothedTurnScores.get(stroke) ?? 0;
  const responseDistance = target > previous
    ? TURN_RISE_DISTANCE
    : TURN_FALL_DISTANCE;
  const response = 1 - Math.exp(
    -Math.max(0, screenDistance) / responseDistance,
  );
  return previous + (target - previous) * response;
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
  const x = sample.x;
  const y = sample.y;
  const pressureResponse = 0.2 + sensitivityRatio * 0.18;
  const pressure = previous
    ? previous.pressure * (1 - pressureResponse)
      + sample.pressure * pressureResponse
    : sample.pressure;
  // 长笔画滤波保持；短笔画靠启动速度基准，不在这里再加硬
  const velocity = previous
    ? previous.velocity * 0.6 + rawVelocity * 0.4
    : 0;
  const normalizedPressure = clamp((pressure - 0.03) / 0.92, 0, 1);
  const pressureFloor = 0.18 + (1 - sensitivityRatio) * 0.12;
  const pressureFactor = pressureFloor
    + (1 - pressureFloor) * normalizedPressure;
  const speedStrength = 0.03 + sharpnessRatio * 0.1;
  const speedFloor = 0.78 - sharpnessRatio * 0.22;
  const currentSpeedFactor = clamp(
    1.02 - velocity * speedStrength,
    speedFloor,
    1,
  );

  // 前 7～12 屏像素共用稳定启动速度，再平滑切到正常速度动态
  const screenBaseWidth = stroke.size * stroke.inputScale;
  const startupDistance = clamp(screenBaseWidth * 1.5, 7, 12);
  if (previous) {
    if (stroke.startupSpeedFactor === null) {
      stroke.startupSpeedFactor = currentSpeedFactor;
    } else if (stroke.screenLength < startupDistance) {
      stroke.startupSpeedFactor += (
        currentSpeedFactor - stroke.startupSpeedFactor
      ) * 0.25;
    }
  }
  const startupT = smoothstep(
    startupDistance * 0.45,
    startupDistance,
    stroke.screenLength,
  );
  const speedFactor = stroke.startupSpeedFactor === null
    ? currentSpeedFactor
    : lerp(stroke.startupSpeedFactor, currentSpeedFactor, startupT);

  // 不足 3 个位置点时无可靠转向，不做转弯增粗
  const turnScore = stroke.rawPoints.length < 2
    ? 0
    : getSmoothedTurnScore(sample, stroke, screenDistance);
  const turnFactor = stroke.rawPoints.length < 2
    ? 1
    : 1 + turnScore * sharpnessRatio * MAX_TURN_WIDTH_BOOST;

  const highSensitivity = clamp((sensitivityRatio - 0.55) / 0.45, 0, 1);
  // 最小线宽按屏幕像素，避免 1x 细笔高低起伏
  const minimumWidth = (
    0.8 - highSensitivity * sharpnessRatio * 0.4
  ) / stroke.inputScale;
  const targetWidth = Math.max(
    minimumWidth,
    stroke.size * pressureFactor * speedFactor * turnFactor,
  );

  // 首点 velocity=0 偏粗；第一段有效速度算出后回填
  if (previous && stroke.rawPoints.length === 1) {
    stroke.rawPoints[0].width = targetWidth;
    if (stroke.points.length === 1) {
      stroke.points[0].width = targetWidth;
    }
  }

  const baseWidthResponse = targetWidth < (previous?.width ?? targetWidth)
    ? 0.68 + sensitivityRatio * 0.16
    : 0.58 - sensitivityRatio * 0.12;
  const screenTargetWidth = targetWidth * stroke.inputScale;
  const thinWidthRatio = clamp((3 - screenTargetWidth) / 2.4, 0, 1);
  const widthResponse = baseWidthResponse
    * (1 - thinWidthRatio * 0.35);
  const respondedWidth = previous
    ? previous.width + (targetWidth - previous.width) * widthResponse
    : targetWidth;
  const screenPrevWidth = (previous?.width ?? respondedWidth) * stroke.inputScale;
  const thinResultRatio = previous
    ? clamp(
      (3 - Math.min(screenPrevWidth, respondedWidth * stroke.inputScale)) / 2.6,
      0,
      1,
    )
    : 0;
  // 线宽变化上限按屏幕像素，再换回世界坐标
  const maximumScreenWidthChange = (
    0.05
    + Math.min(screenDistance, 2) * 0.1
    + (1 - thinResultRatio) * 0.22
  ) * (1 - thinResultRatio * 0.55);
  const maximumWidthChange = maximumScreenWidthChange / stroke.inputScale;
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
  const stroke: Stroke = {
    ...settings,
    inputScale: Math.max(0.01, inputScale),
    liveTailPoints: LIVE_TAIL_POINTS,
    screenLength: 0,
    startupSpeedFactor: null,
    rawPoints: [],
    points: [],
  };
  smoothedTurnScores.set(stroke, 0);
  return stroke;
}

export function appendSample(stroke: Stroke, sample: PointerSample): InkPoint[] {
  const previous = stroke.rawPoints.at(-1);
  const screenDistance = previous
    ? Math.hypot(sample.x - previous.rawX, sample.y - previous.rawY)
      * stroke.inputScale
    : 0;
  if (previous && screenDistance < MINIMUM_SAMPLE_DISTANCE) return [];

  // 先累计弧长再建点，启动区用到当前段
  stroke.screenLength += screenDistance;
  const point = createInkPoint(sample, stroke, previous);
  smoothedTurnScores.set(
    stroke,
    getSmoothedTurnScore(sample, stroke, screenDistance),
  );
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
