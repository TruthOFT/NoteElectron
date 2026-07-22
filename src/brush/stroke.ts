import type { BrushPoint, BrushSettings, BrushStroke } from './types';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** 屏/画布像素：过近丢弃，去掉亚像素抖 */
const MIN_STEP = 0.55;
/** 抬笔等距步长 */
const RESAMPLE_STEP = 0.7;
/** 抬笔位置平滑遍数 / 权重（对称三点） */
const SMOOTH_PASSES = 2;
const SMOOTH_WEIGHT = 0.22;

/**
 * One-Euro 风格位置滤波：
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
) {
  if (!previous) return { x: sampleX, y: sampleY };

  const speed = step / Math.max(1, deltaTime);
  const cutoff = 1.0 + speed * 3.0;
  const tau = 1 / (2 * Math.PI * cutoff);
  const te = Math.max(1, deltaTime);
  const alpha = clamp(1 / (1 + tau / te), 0.62, 0.96);

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
  },
): boolean {
  const previous = stroke.points.at(-1);
  const rawStep = previous
    ? Math.hypot(sample.x - previous.x, sample.y - previous.y)
    : 0;
  if (previous && rawStep < MIN_STEP) return false;

  const deltaTime = previous ? Math.max(1, sample.time - previous.time) : 1;
  const { x, y } = filterPosition(
    sample.x,
    sample.y,
    previous,
    rawStep,
    deltaTime,
  );

  // 若滤波后几乎不动，也丢（避免叠点）
  if (previous && Math.hypot(x - previous.x, y - previous.y) < MIN_STEP * 0.35) {
    return false;
  }

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

function smoothPass(
  points: readonly BrushPoint[],
  weight: number,
): BrushPoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { ...point };
    const previous = points[index - 1];
    const next = points[index + 1];

    const inX = point.x - previous.x;
    const inY = point.y - previous.y;
    const outX = next.x - point.x;
    const outY = next.y - point.y;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    const cosine = inLen > 1e-4 && outLen > 1e-4
      ? clamp((inX * outX + inY * outY) / (inLen * outLen), -1, 1)
      : 1;
    // 真转角少抹
    const corner = clamp((Math.acos(cosine) - 0.4) / 0.9, 0, 1);
    const w = weight * (1 - corner * 0.85);

    return {
      ...point,
      x: previous.x * w + point.x * (1 - 2 * w) + next.x * w,
      y: previous.y * w + point.y * (1 - 2 * w) + next.y * w,
      r: previous.r * w * 0.5 + point.r * (1 - w) + next.r * w * 0.5,
    };
  });
}

/**
 * 构建显示轨：等距重采样 + 轻平滑。
 * 纯函数；实时预览和抬笔定稿共用，避免渲染切换造成跳变。
 */
export function buildDisplayPoints(
  points: readonly BrushPoint[],
): BrushPoint[] {
  if (points.length < 2) return points.map((point) => ({ ...point }));

  let displayPoints = resample(points, RESAMPLE_STEP);
  for (let pass = 0; pass < SMOOTH_PASSES; pass += 1) {
    displayPoints = smoothPass(displayPoints, SMOOTH_WEIGHT);
  }
  return displayPoints;
}

/** 抬笔定稿：写入与实时预览完全相同的显示轨。 */
export function finishStroke(stroke: BrushStroke): void {
  stroke.points = buildDisplayPoints(stroke.points);
}
