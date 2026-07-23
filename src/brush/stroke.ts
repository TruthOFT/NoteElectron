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
const POSITION_FIT_SIGMA_MIN_CSS = 1.5;
const POSITION_FIT_SIGMA_MAX_CSS = 10;
const POSITION_FIT_CURVATURE_START = Math.PI * 8 / 180;
const POSITION_FIT_CURVATURE_END = Math.PI * 35 / 180;
const CURVATURE_NEIGHBORHOOD_CSS = 5;
const ROBUST_FIT_CURVATURE_START = 0.12;
const ROBUST_RESIDUAL_CSS = 0.3;
const MAX_WINDOW_ASYMMETRY = 3;
const LIVE_FREEZE_LOOKAHEAD_CSS = 4;
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

type LocalQuadraticFit = {
  x0: number;
  x1: number;
  x2: number;
  y0: number;
  y1: number;
  y2: number;
};

function solveLocalQuadratic(
  moments: readonly number[],
  xTerms: readonly number[],
  yTerms: readonly number[],
): LocalQuadraticFit | null {
  const matrix = [
    [moments[0], moments[1], moments[2], xTerms[0], yTerms[0]],
    [moments[1], moments[2], moments[3], xTerms[1], yTerms[1]],
    [moments[2], moments[3], moments[4], xTerms[2], yTerms[2]],
  ];

  for (let column = 0; column < 3; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(matrix[pivot][column]) < 1e-8) return null;
    if (pivot !== column) {
      [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    }

    const divisor = matrix[column][column];
    for (let cursor = column; cursor < 5; cursor += 1) {
      matrix[column][cursor] /= divisor;
    }
    for (let row = 0; row < 3; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      for (let cursor = column; cursor < 5; cursor += 1) {
        matrix[row][cursor] -= factor * matrix[column][cursor];
      }
    }
  }

  return {
    x0: matrix[0][3],
    x1: matrix[1][3],
    x2: matrix[2][3],
    y0: matrix[0][4],
    y1: matrix[1][4],
    y2: matrix[2][4],
  };
}

function fitLocalQuadratic(
  points: readonly BrushPoint[],
  index: number,
  previousWindow: number,
  nextWindow: number,
  step: number,
  inputScale: number,
  sigmaCss: number,
  closed: boolean,
  reference?: LocalQuadraticFit,
) {
  const moments = [0, 0, 0, 0, 0];
  const xTerms = [0, 0, 0];
  const yTerms = [0, 0, 0];

  for (let offset = -previousWindow; offset <= nextWindow; offset += 1) {
    const cursor = closed
      ? (index + offset + points.length) % points.length
      : index + offset;
    const distanceCss = offset * step / inputScale;
    const normalized = distanceCss / sigmaCss;
    let weight = Math.exp(-0.5 * normalized * normalized);

    if (reference) {
      const fittedX = reference.x0
        + reference.x1 * distanceCss
        + reference.x2 * distanceCss * distanceCss;
      const fittedY = reference.y0
        + reference.y1 * distanceCss
        + reference.y2 * distanceCss * distanceCss;
      const tangentX = reference.x1 + 2 * reference.x2 * distanceCss;
      const tangentY = reference.y1 + 2 * reference.y2 * distanceCss;
      const tangentLength = Math.hypot(tangentX, tangentY);
      if (tangentLength > 1e-6) {
        const normalResidual = Math.abs(
          (points[cursor].x - fittedX) * (-tangentY / tangentLength)
            + (points[cursor].y - fittedY) * (tangentX / tangentLength),
        ) / inputScale;
        const ratio = normalResidual / ROBUST_RESIDUAL_CSS;
        weight /= 1 + ratio * ratio * ratio * ratio;
      }
    }

    let power = 1;
    for (let moment = 0; moment < moments.length; moment += 1) {
      moments[moment] += weight * power;
      if (moment < xTerms.length) {
        xTerms[moment] += weight * points[cursor].x * power;
        yTerms[moment] += weight * points[cursor].y * power;
      }
      power *= distanceCss;
    }
  }

  return solveLocalQuadratic(moments, xTerms, yTerms);
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
  const curvatureNeighborhoodSamples = Math.max(
    1,
    Math.round(CURVATURE_NEIGHBORHOOD_CSS * inputScale / step),
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
  const curvatureStrengths = longAngles.map((angle) => clamp(
    (angle - POSITION_FIT_CURVATURE_START)
      / (POSITION_FIT_CURVATURE_END - POSITION_FIT_CURVATURE_START),
    0,
    1,
  ));
  const localCurvatureStrengths = points.map((_, index) => {
    let strength = curvatureStrengths[index];
    const previousLimit = closed
      ? curvatureNeighborhoodSamples
      : Math.min(curvatureNeighborhoodSamples, index);
    const nextLimit = closed
      ? curvatureNeighborhoodSamples
      : Math.min(curvatureNeighborhoodSamples, points.length - 1 - index);
    for (let offset = 1; offset <= previousLimit; offset += 1) {
      const cursor = closed
        ? (index - offset + points.length) % points.length
        : index - offset;
      strength = Math.max(strength, curvatureStrengths[cursor]);
    }
    for (let offset = 1; offset <= nextLimit; offset += 1) {
      const cursor = closed
        ? (index + offset) % points.length
        : index + offset;
      strength = Math.max(strength, curvatureStrengths[cursor]);
    }
    return strength;
  });

  return points.map((point, index) => {
    if (!closed && (index === 0 || index === points.length - 1)) {
      return { ...point };
    }
    if (hardCorners[index]) return { ...point };

    const curvatureStrength = localCurvatureStrengths[index];
    const sigmaCss = POSITION_FIT_SIGMA_MAX_CSS
      + (POSITION_FIT_SIGMA_MIN_CSS - POSITION_FIT_SIGMA_MAX_CSS)
        * curvatureStrength;
    const localRadiusSamples = Math.min(
      radiusSamples,
      Math.max(2, Math.ceil(3 * sigmaCss * inputScale / step)),
    );
    let previousWindow = closed
      ? Math.min(localRadiusSamples, Math.floor((points.length - 1) / 2))
      : Math.min(localRadiusSamples, index);
    let nextWindow = closed
      ? previousWindow
      : Math.min(localRadiusSamples, points.length - 1 - index);
    if (!closed && previousWindow > 0 && nextWindow > 0) {
      previousWindow = Math.min(
        previousWindow,
        Math.max(2, Math.floor(nextWindow * MAX_WINDOW_ASYMMETRY)),
      );
      nextWindow = Math.min(
        nextWindow,
        Math.max(2, Math.floor(previousWindow * MAX_WINDOW_ASYMMETRY)),
      );
    }
    for (let offset = 1; offset <= previousWindow; offset += 1) {
      const cursor = closed
        ? (index - offset + points.length) % points.length
        : index - offset;
      if (hardCorners[cursor]) {
        previousWindow = offset - 1;
        break;
      }
    }
    for (let offset = 1; offset <= nextWindow; offset += 1) {
      const cursor = closed
        ? (index + offset) % points.length
        : index + offset;
      if (hardCorners[cursor]) {
        nextWindow = offset - 1;
        break;
      }
    }
    if (previousWindow + nextWindow < 2) return { ...point };

    const initialFit = fitLocalQuadratic(
      points,
      index,
      previousWindow,
      nextWindow,
      step,
      inputScale,
      sigmaCss,
      closed,
    );
    if (!initialFit) return { ...point };
    const robustFit = curvatureStrength >= ROBUST_FIT_CURVATURE_START
      ? fitLocalQuadratic(
        points,
        index,
        previousWindow,
        nextWindow,
        step,
        inputScale,
        sigmaCss,
        closed,
        initialFit,
      )
      : null;
    const fit = robustFit ?? initialFit;

    // 等弧长轨迹无需沿切线前后挪点；只去除法线方向的横向起伏。
    const tangentX = fit.x1;
    const tangentY = fit.y1;
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength < 1e-6) return { ...point };

    const normalX = -tangentY / tangentLength;
    const normalY = tangentX / tangentLength;
    const fittedNormalShift = (fit.x0 - point.x) * normalX
      + (fit.y0 - point.y) * normalY;
    const maxNormalShift = POSITION_MAX_NORMAL_SHIFT_CSS * inputScale;
    const normalShift = clamp(
      fittedNormalShift,
      -maxNormalShift,
      maxNormalShift,
    ) * (1 - cornerStrengths[index]);

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

function resampleDisplaySource(
  points: readonly BrushPoint[],
  step: number,
  closed: boolean,
) {
  const source = closed
    ? [...points, { ...points[0], time: points[points.length - 1].time }]
    : points;
  const displayPoints = resample(source, step);
  if (closed && displayPoints.length > 2) {
    const first = displayPoints[0];
    const last = displayPoints[displayPoints.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) <= step * 1.1) {
      displayPoints.pop();
    }
  }
  return displayPoints;
}

function smoothDisplayPoints(
  points: readonly BrushPoint[],
  step: number,
  inputScale: number,
  closed: boolean,
) {
  let displayPoints = smoothPositionWindow(
    points,
    step,
    inputScale,
    closed,
  );
  displayPoints = smoothRadiusWindow(
    displayPoints,
    step,
    inputScale,
    closed,
  );
  return displayPoints;
}

function sameDisplaySourcePoint(first: BrushPoint, second: BrushPoint) {
  return first.x === second.x
    && first.y === second.y
    && first.r === second.r
    && first.pressure === second.pressure
    && first.time === second.time;
}

function firstChangedPoint(
  previous: readonly BrushPoint[],
  next: readonly BrushPoint[],
) {
  const limit = Math.min(previous.length, next.length);
  let index = 0;
  while (
    index < limit
    && sameDisplaySourcePoint(previous[index], next[index])
  ) {
    index += 1;
  }
  if (index === previous.length && index === next.length) return -1;
  return index;
}

function displayInfluenceSamples(step: number, inputScale: number) {
  const positionRadius = Math.ceil(
    POSITION_FIT_RADIUS_CSS * inputScale / step,
  );
  const cornerLookahead = Math.round(
    CORNER_LONG_LOOKAHEAD_CSS * inputScale / step,
  );
  const radiusWindow = Math.ceil(
    RADIUS_FIT_RADIUS_CSS * inputScale / step,
  );
  return Math.max(
    positionRadius + cornerLookahead,
    radiusWindow,
  ) + 2;
}

export type BrushDisplayUpdate = {
  points: BrushPoint[];
  changedStart: number | null;
};

/**
 * 写时显示轨缓存。等距采样仍按原算法生成；只有受新输入影响的尾部
 * 重新执行原有位置与半径滤波，已经越过最大滤波窗口的前缀直接复用。
 */
export class BrushDisplayCache {
  private inputScale = 0;

  private closed = false;

  private resampledPoints: BrushPoint[] = [];

  private displayPoints: BrushPoint[] = [];

  private frozenPrefixLength = 0;

  reset() {
    this.inputScale = 0;
    this.closed = false;
    this.resampledPoints = [];
    this.displayPoints = [];
    this.frozenPrefixLength = 0;
  }

  private storeDisplayPoints(
    next: BrushPoint[],
    step: number,
    freezePrefix: boolean,
  ): BrushDisplayUpdate {
    const previous = this.displayPoints;
    const retained = freezePrefix
      ? Math.min(
        this.frozenPrefixLength,
        previous.length,
        next.length,
      )
      : 0;
    const displayPoints = retained > 0
      ? [...previous.slice(0, retained), ...next.slice(retained)]
      : next;
    const changed = firstChangedPoint(previous, displayPoints);

    if (freezePrefix) {
      const lookaheadSamples = Math.max(
        1,
        Math.ceil(LIVE_FREEZE_LOOKAHEAD_CSS * this.inputScale / step),
      );
      this.frozenPrefixLength = Math.max(
        retained,
        displayPoints.length - 1 - lookaheadSamples,
      );
    } else {
      this.frozenPrefixLength = 0;
    }
    this.displayPoints = displayPoints;
    return {
      points: displayPoints,
      changedStart: changed < 0 ? null : changed,
    };
  }

  update(
    points: readonly BrushPoint[],
    inputScale = 1,
  ): BrushDisplayUpdate {
    if (points.length < 2) {
      const next = points.map((point) => ({ ...point }));
      const changed = firstChangedPoint(this.displayPoints, next);
      this.inputScale = Math.max(1, inputScale);
      this.closed = false;
      this.resampledPoints = next.map((point) => ({ ...point }));
      this.displayPoints = next;
      this.frozenPrefixLength = 0;
      return {
        points: next,
        changedStart: changed < 0 ? null : changed,
      };
    }

    const safeInputScale = Math.max(1, inputScale);
    const step = RESAMPLE_STEP_CSS * safeInputScale;
    const closed = isClosedPath(points, safeInputScale);
    const resampledPoints = resampleDisplaySource(points, step, closed);
    const scaleChanged = this.inputScale !== safeInputScale;
    const requiresFullBuild = scaleChanged
      || closed
      || this.closed
      || this.resampledPoints.length === 0;

    if (requiresFullBuild) {
      let displayPoints = smoothDisplayPoints(
        resampledPoints,
        step,
        safeInputScale,
        closed,
      );
      if (closed && displayPoints.length > 0) {
        displayPoints = [
          ...displayPoints,
          {
            ...displayPoints[0],
            time: points[points.length - 1].time,
          },
        ];
      }
      this.inputScale = safeInputScale;
      this.closed = closed;
      this.resampledPoints = resampledPoints;
      this.frozenPrefixLength = 0;
      return this.storeDisplayPoints(displayPoints, step, !closed);
    }

    const changedSource = firstChangedPoint(
      this.resampledPoints,
      resampledPoints,
    );
    if (changedSource < 0) {
      return { points: this.displayPoints, changedStart: null };
    }

    const influence = displayInfluenceSamples(step, safeInputScale);
    const stablePrefixEnd = Math.max(
      0,
      Math.min(
        changedSource - influence,
        this.displayPoints.length,
      ),
    );
    const sourceStart = Math.max(0, stablePrefixEnd - influence);
    const smoothedTail = smoothDisplayPoints(
      resampledPoints.slice(sourceStart),
      step,
      safeInputScale,
      false,
    );
    const localTailStart = stablePrefixEnd - sourceStart;
    const displayPoints = [
      ...this.displayPoints.slice(0, stablePrefixEnd),
      ...smoothedTail.slice(localTailStart),
    ];

    this.inputScale = safeInputScale;
    this.closed = false;
    this.resampledPoints = resampledPoints;
    return this.storeDisplayPoints(displayPoints, step, true);
  }
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
  const resampledPoints = resampleDisplaySource(points, step, closed);
  const displayPoints = smoothDisplayPoints(
    resampledPoints,
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
