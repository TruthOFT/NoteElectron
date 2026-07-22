import type { BrushPoint, BrushSettings, BrushStroke } from './types';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** 屏/画布像素：过近丢弃，去掉亚像素抖 */
const MIN_STEP = 0.55;
/** 显示轨等距步长（CSS px），避免 DPR 改变几何密度。 */
const RESAMPLE_STEP_CSS = 0.4;
/**
 * 中心线使用宽高斯窗做局部二次拟合。
 * 二次项保留稳定曲率，高斯权重避免硬窗口把低频起伏重新带回轮廓。
 */
const POSITION_FIT_RADIUS_CSS = 30;
const POSITION_FIT_SIGMA_MIN_CSS = 4.5;
const POSITION_FIT_SIGMA_MAX_CSS = 10;
const POSITION_FIT_CURVATURE_START = Math.PI * 8 / 180;
const POSITION_FIT_CURVATURE_END = Math.PI * 35 / 180;
/** 只允许小幅法线修正，防止平滑器改写用户主动书写的大形。 */
const POSITION_MAX_NORMAL_SHIFT_CSS = 1.25;
const CLOSED_PATH_MAX_GAP_CSS = 3;
const CLOSED_PATH_MIN_LENGTH_CSS = 24;
const CORNER_SHORT_LOOKAHEAD_CSS = 1.6;
const CORNER_LONG_LOOKAHEAD_CSS = 4;
const CORNER_SHORT_BLEND_START = Math.PI * 25 / 180;
const CORNER_SHORT_BLEND_END = Math.PI * 45 / 180;
const CORNER_LONG_BLEND_START = Math.PI * 45 / 180;
const CORNER_LONG_BLEND_END = Math.PI * 70 / 180;
const CORNER_CONCENTRATION_START = 0.3;
const CORNER_CONCENTRATION_END = 0.65;
const HARD_CORNER_STRENGTH = 0.65;
/** 半径拟合窗口较短：滤掉宽度毛刺，保留主动压力渐变。 */
const RADIUS_FIT_RADIUS_CSS = 4;

const POSITION_ALPHA_MIN = 0.32;
const POSITION_ALPHA_MAX = 0.86;
const POSITION_SPEED_FOR_MAX_ALPHA = 1.2;
const POSITION_SPEED_EXPONENT = 0.75;

type RawInputState = {
  x: number;
  y: number;
  time: number;
};

const rawInputByStroke = new WeakMap<BrushStroke, RawInputState>();

/**
 * 速度自适应 EMA 位置滤波：
 * - 快写 alpha 高 → 跟手、不粘
 * - 慢写/静止 alpha 略低 → 压高频手抖
 * 禁止「小步强粘前点」（那是粘手元凶）
 */
function filterPosition(
  sampleX: number,
  sampleY: number,
  previous: BrushPoint | undefined,
  step: number,
  deltaTime: number,
  inputScale: number,
) {
  if (!previous) return { x: sampleX, y: sampleY };

  // CSS px/ms. The old RC formula mixed milliseconds with seconds and
  // therefore kept alpha near 1, passing almost all device jitter through.
  const speed = step / Math.max(1, inputScale) / Math.max(1, deltaTime);
  const speedFactor = Math.pow(
    clamp(speed / POSITION_SPEED_FOR_MAX_ALPHA, 0, 1),
    POSITION_SPEED_EXPONENT,
  );
  const alpha = POSITION_ALPHA_MIN
    + (POSITION_ALPHA_MAX - POSITION_ALPHA_MIN) * speedFactor;

  return {
    x: previous.x + (sampleX - previous.x) * alpha,
    y: previous.y + (sampleY - previous.y) * alpha,
  };
}

/**
 * 压感 → 半径。
 * sensitivity 高：轻更细、重更粗；低：接近匀粗（稳）。
 * 线性 + 死区，不用幂曲线（中段更好控）。
 */
function radiusFromPressure(
  size: number,
  pressure: number,
  sensitivity: number,
) {
  const sens = clamp(sensitivity, 0, 1);
  // 设备压感底部/顶部常不准
  const normalized = clamp((pressure - 0.02) / 0.93, 0, 1);
  const minFactor = 0.55 - sens * 0.32; // 0.55 → 0.23
  const maxFactor = 0.88 + sens * 0.22; // 0.88 → 1.10
  const factor = minFactor + (maxFactor - minFactor) * normalized;
  return Math.max(0.45, (size / 2) * factor);
}

export function createStroke(settings: BrushSettings): BrushStroke {
  return {
    color: settings.color,
    size: settings.size,
    pressureSensitivity: clamp(settings.pressureSensitivity, 0, 1),
    points: [],
  };
}

export function appendPoint(
  stroke: BrushStroke,
  sample: {
    x: number;
    y: number;
    pressure: number;
    time: number;
    inputScale?: number;
  },
): boolean {
  const previous = stroke.points.at(-1);
  const previousRaw = rawInputByStroke.get(stroke);
  const rawStep = previousRaw
    ? Math.hypot(sample.x - previousRaw.x, sample.y - previousRaw.y)
    : 0;
  if (previousRaw && rawStep < MIN_STEP) return false;

  const deltaTime = previousRaw
    ? Math.max(1, sample.time - previousRaw.time)
    : 1;
  const { x, y } = filterPosition(
    sample.x,
    sample.y,
    previous,
    rawStep,
    deltaTime,
    sample.inputScale ?? 1,
  );

  // 压感 EMA：跟手但滤跳点；灵敏度高时略更跟
  const pressureAlpha = 0.45 + stroke.pressureSensitivity * 0.25;
  const pressure = previous
    ? previous.pressure * (1 - pressureAlpha) + sample.pressure * pressureAlpha
    : sample.pressure;
  const targetR = radiusFromPressure(
    stroke.size,
    pressure,
    stroke.pressureSensitivity,
  );
  // 每步允许变化量随笔粗，压感能跟上但不毛刺
  const maxDelta = Math.max(0.22, stroke.size * 0.07);
  const r = previous
    ? previous.r + clamp(targetR - previous.r, -maxDelta, maxDelta)
    : targetR;

  // 首点常 pressure=0 偏细：第二点回填
  if (previous && stroke.points.length === 1) {
    stroke.points[0].r = r;
    stroke.points[0].pressure = pressure;
  }

  stroke.points.push({
    x,
    y,
    r,
    pressure,
    time: sample.time,
  });
  rawInputByStroke.set(stroke, {
    x: sample.x,
    y: sample.y,
    time: sample.time,
  });
  return true;
}

function resample(points: readonly BrushPoint[], step: number): BrushPoint[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));

  const result: BrushPoint[] = [{ ...points[0] }];
  let carry = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = Math.hypot(end.x - start.x, end.y - start.y);
    if (segment < 1e-6) continue;

    let traveled = step - carry;
    while (traveled <= segment) {
      const t = traveled / segment;
      result.push({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        r: start.r + (end.r - start.r) * t,
        pressure: start.pressure + (end.pressure - start.pressure) * t,
        time: start.time + (end.time - start.time) * t,
      });
      traveled += step;
    }
    carry = segment - (traveled - step);
  }

  const last = points[points.length - 1];
  const tip = result[result.length - 1];
  if (Math.hypot(last.x - tip.x, last.y - tip.y) > step * 0.25) {
    result.push({ ...last });
  }
  return result;
}

function turnAngleAt(
  points: readonly BrushPoint[],
  index: number,
  lookaheadSamples: number,
  closed: boolean,
) {
  const point = points[index];
  const previousIndex = closed
    ? (index - lookaheadSamples + points.length) % points.length
    : Math.max(0, index - lookaheadSamples);
  const nextIndex = closed
    ? (index + lookaheadSamples) % points.length
    : Math.min(points.length - 1, index + lookaheadSamples);
  const previous = points[previousIndex];
  const next = points[nextIndex];
  const inX = point.x - previous.x;
  const inY = point.y - previous.y;
  const outX = next.x - point.x;
  const outY = next.y - point.y;
  const inLength = Math.hypot(inX, inY);
  const outLength = Math.hypot(outX, outY);
  if (inLength < 1e-4 || outLength < 1e-4) return 0;

  const cosine = clamp(
    (inX * outX + inY * outY) / (inLength * outLength),
    -1,
    1,
  );
  return Math.acos(cosine);
}

/**
 * 等距轨上的局部二次拟合。
 * 比均值/高斯窗口更能保留弧线曲率；真实折、钩作为屏障，不跨角点拟合。
 */
function smoothPositionWindow(
  points: readonly BrushPoint[],
  step: number,
  inputScale: number,
  closed: boolean,
): BrushPoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));

  const radius = POSITION_FIT_RADIUS_CSS * inputScale;
  const radiusSamples = Math.max(1, Math.ceil(radius / step));
  const shortLookaheadSamples = Math.max(
    1,
    Math.round(CORNER_SHORT_LOOKAHEAD_CSS * inputScale / step),
  );
  const longLookaheadSamples = Math.max(
    shortLookaheadSamples + 1,
    Math.round(CORNER_LONG_LOOKAHEAD_CSS * inputScale / step),
  );
  const shortAngles = points.map((_, index) => turnAngleAt(
    points,
    index,
    shortLookaheadSamples,
    closed,
  ));
  const longAngles = points.map((_, index) => turnAngleAt(
    points,
    index,
    longLookaheadSamples,
    closed,
  ));
  const cornerStrengths = points.map((_, index) => {
    const shortAngle = shortAngles[index];
    const longAngle = longAngles[index];
    const shortStrength = clamp(
      (shortAngle - CORNER_SHORT_BLEND_START)
        / (CORNER_SHORT_BLEND_END - CORNER_SHORT_BLEND_START),
      0,
      1,
    );
    const longStrength = clamp(
      (longAngle - CORNER_LONG_BLEND_START)
        / (CORNER_LONG_BLEND_END - CORNER_LONG_BLEND_START),
      0,
      1,
    );
    const concentration = shortAngle / Math.max(longAngle, 1e-4);
    const concentrationStrength = clamp(
      (concentration - CORNER_CONCENTRATION_START)
        / (CORNER_CONCENTRATION_END - CORNER_CONCENTRATION_START),
      0,
      1,
    );
    return shortStrength * longStrength * concentrationStrength;
  });
  const hardCorners = cornerStrengths.map((strength) => (
    strength >= HARD_CORNER_STRENGTH
  ));

  return points.map((point, index) => {
    if (!closed && (index === 0 || index === points.length - 1)) {
      return { ...point };
    }
    if (hardCorners[index]) return { ...point };

    const curvatureStrength = clamp(
      (longAngles[index] - POSITION_FIT_CURVATURE_START)
        / (POSITION_FIT_CURVATURE_END - POSITION_FIT_CURVATURE_START),
      0,
      1,
    );
    const sigmaCss = POSITION_FIT_SIGMA_MAX_CSS
      + (POSITION_FIT_SIGMA_MIN_CSS - POSITION_FIT_SIGMA_MAX_CSS)
        * curvatureStrength;
    const localRadiusSamples = Math.min(
      radiusSamples,
      Math.max(2, Math.ceil(3 * sigmaCss * inputScale / step)),
    );
    let halfWindow = closed
      ? Math.min(localRadiusSamples, Math.floor((points.length - 1) / 2))
      : Math.min(
        localRadiusSamples,
        index,
        points.length - 1 - index,
      );
    for (let offset = 1; offset <= halfWindow; offset += 1) {
      const previousIndex = closed
        ? (index - offset + points.length) % points.length
        : index - offset;
      const nextIndex = closed
        ? (index + offset) % points.length
        : index + offset;
      if (hardCorners[previousIndex] || hardCorners[nextIndex]) {
        halfWindow = offset - 1;
        break;
      }
    }
    if (halfWindow < 2) return { ...point };

    let sum0 = 0;
    let sum2 = 0;
    let sum4 = 0;
    let sumX = 0;
    let sumY = 0;
    let sum2X = 0;
    let sum2Y = 0;
    for (let offset = -halfWindow; offset <= halfWindow; offset += 1) {
      const cursor = closed
        ? (index + offset + points.length) % points.length
        : index + offset;
      const distanceCss = offset * step / inputScale;
      const squared = distanceCss * distanceCss;
      const fourth = squared * squared;
      const normalized = distanceCss / sigmaCss;
      const weight = Math.exp(-0.5 * normalized * normalized);
      sum0 += weight;
      sum2 += weight * squared;
      sum4 += weight * fourth;
      sumX += weight * points[cursor].x;
      sumY += weight * points[cursor].y;
      sum2X += weight * points[cursor].x * squared;
      sum2Y += weight * points[cursor].y * squared;
    }

    const denominator = sum0 * sum4 - sum2 * sum2;
    if (Math.abs(denominator) < 1e-6) return { ...point };
    const cornerBlend = cornerStrengths[index];
    const smoothedX = (sum4 * sumX - sum2 * sum2X) / denominator;
    const smoothedY = (sum4 * sumY - sum2 * sum2Y) / denominator;

    // 等弧长轨迹无需沿切线前后挪点；只去除法线方向的横向起伏。
    const tangentOffset = Math.min(halfWindow, longLookaheadSamples);
    const previousIndex = closed
      ? (index - tangentOffset + points.length) % points.length
      : index - tangentOffset;
    const nextIndex = closed
      ? (index + tangentOffset) % points.length
      : index + tangentOffset;
    const tangentX = points[nextIndex].x - points[previousIndex].x;
    const tangentY = points[nextIndex].y - points[previousIndex].y;
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength < 1e-6) return { ...point };

    const normalX = -tangentY / tangentLength;
    const normalY = tangentX / tangentLength;
    const fittedNormalShift = (smoothedX - point.x) * normalX
      + (smoothedY - point.y) * normalY;
    const maxNormalShift = POSITION_MAX_NORMAL_SHIFT_CSS * inputScale;
    const normalShift = clamp(
      fittedNormalShift,
      -maxNormalShift,
      maxNormalShift,
    ) * (1 - cornerBlend);

    return {
      ...point,
      x: point.x + normalX * normalShift,
      y: point.y + normalY * normalShift,
    };
  });
}

function smoothRadiusWindow(
  points: readonly BrushPoint[],
  step: number,
  inputScale: number,
  closed: boolean,
): BrushPoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));

  const radiusSamples = Math.max(
    1,
    Math.ceil(RADIUS_FIT_RADIUS_CSS * inputScale / step),
  );
  return points.map((point, index) => {
    if (!closed && (index === 0 || index === points.length - 1)) {
      return { ...point };
    }
    const halfWindow = closed
      ? Math.min(radiusSamples, Math.floor((points.length - 1) / 2))
      : Math.min(radiusSamples, index, points.length - 1 - index);
    if (halfWindow < 2) return { ...point };

    let sum0 = 0;
    let sum2 = 0;
    let sum4 = 0;
    let sumRadius = 0;
    let sum2Radius = 0;
    let minimumRadius = Number.POSITIVE_INFINITY;
    let maximumRadius = 0;
    for (let offset = -halfWindow; offset <= halfWindow; offset += 1) {
      const cursor = closed
        ? (index + offset + points.length) % points.length
        : index + offset;
      const squared = offset * offset;
      sum0 += 1;
      sum2 += squared;
      sum4 += squared * squared;
      sumRadius += points[cursor].r;
      sum2Radius += points[cursor].r * squared;
      minimumRadius = Math.min(minimumRadius, points[cursor].r);
      maximumRadius = Math.max(maximumRadius, points[cursor].r);
    }
    const denominator = sum0 * sum4 - sum2 * sum2;
    if (Math.abs(denominator) < 1e-6) return { ...point };

    return {
      ...point,
      r: clamp(
        (sum4 * sumRadius - sum2 * sum2Radius) / denominator,
        minimumRadius,
        maximumRadius,
      ),
    };
  });
}

function isClosedPath(points: readonly BrushPoint[], inputScale: number) {
  if (points.length < 6) return false;
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  if (length < CLOSED_PATH_MIN_LENGTH_CSS * inputScale) return false;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.hypot(last.x - first.x, last.y - first.y)
    <= CLOSED_PATH_MAX_GAP_CSS * inputScale;
}

/**
 * 构建显示轨：等距重采样 + 轻平滑。
 * 纯函数；实时预览和抬笔定稿共用，避免渲染切换造成跳变。
 */
export function buildDisplayPoints(
  points: readonly BrushPoint[],
  inputScale = 1,
): BrushPoint[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));

  const safeInputScale = Math.max(1, inputScale);
  const step = RESAMPLE_STEP_CSS * safeInputScale;
  const closed = isClosedPath(points, safeInputScale);
  const resampleSource = closed
    ? [...points, { ...points[0], time: points[points.length - 1].time }]
    : points;
  let displayPoints = resample(resampleSource, step);
  if (closed && displayPoints.length > 2) {
    const first = displayPoints[0];
    const last = displayPoints[displayPoints.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) <= step * 1.1) {
      displayPoints.pop();
    }
  }
  displayPoints = smoothPositionWindow(
    displayPoints,
    step,
    safeInputScale,
    closed,
  );
  displayPoints = smoothRadiusWindow(
    displayPoints,
    step,
    safeInputScale,
    closed,
  );
  if (closed && displayPoints.length > 0) {
    displayPoints.push({
      ...displayPoints[0],
      time: points[points.length - 1].time,
    });
  }
  return displayPoints;
}

/** 抬笔定稿：写入与实时预览完全相同的显示轨。 */
export function finishStroke(stroke: BrushStroke, inputScale = 1): void {
  stroke.points = buildDisplayPoints(stroke.points, inputScale);
}
