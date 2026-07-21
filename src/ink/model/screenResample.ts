import type { InkPoint } from '../types';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const SCREEN_STEP = 0.7;
const POSITION_SMOOTH_WEIGHT = 0.24;
const POSITION_SMOOTH_PASSES = 2;
const WIDTH_SMOOTH_WEIGHT = 0.28;
const WIDTH_SMOOTH_PASSES = 2;

type ScreenSample = {
  sx: number;
  sy: number;
  sw: number;
  pressure: number;
  velocity: number;
  time: number;
};

/**
 * 抬笔定稿专用。写时不要调用。
 * 屏空间等距 + 对称平滑位置 + 平滑宽度。
 */
export function rebuildStrokeInScreenSpace(
  points: readonly InkPoint[],
  inputScale: number,
): InkPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ ...points[0] }];

  const scale = Math.max(0.01, inputScale);
  let screen: ScreenSample[] = points.map((point) => ({
    sx: point.x * scale,
    sy: point.y * scale,
    sw: point.width * scale,
    pressure: point.pressure,
    velocity: point.velocity,
    time: point.time,
  }));

  screen = resampleArc(screen, SCREEN_STEP);
  for (let pass = 0; pass < POSITION_SMOOTH_PASSES; pass += 1) {
    screen = smoothPosition(screen, POSITION_SMOOTH_WEIGHT);
  }
  for (let pass = 0; pass < WIDTH_SMOOTH_PASSES; pass += 1) {
    screen = smoothWidth(screen, WIDTH_SMOOTH_WEIGHT);
  }

  const inv = 1 / scale;
  return screen.map((point) => {
    const x = point.sx * inv;
    const y = point.sy * inv;
    return {
      x,
      y,
      rawX: x,
      rawY: y,
      pressure: point.pressure,
      velocity: point.velocity,
      width: Math.max(0.15 * inv, point.sw * inv),
      time: point.time,
    };
  });
}

export function resampleStrokeInScreenSpace(
  points: readonly InkPoint[],
  inputScale: number,
): InkPoint[] {
  return rebuildStrokeInScreenSpace(points, inputScale);
}

function resampleArc(
  points: readonly ScreenSample[],
  step: number,
): ScreenSample[] {
  const result: ScreenSample[] = [{ ...points[0] }];
  let carry = 0;

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segment = Math.hypot(end.sx - start.sx, end.sy - start.sy);
    if (segment < 1e-6) continue;

    let traveled = step - carry;
    while (traveled <= segment) {
      const t = traveled / segment;
      result.push({
        sx: start.sx + (end.sx - start.sx) * t,
        sy: start.sy + (end.sy - start.sy) * t,
        sw: start.sw + (end.sw - start.sw) * t,
        pressure: start.pressure + (end.pressure - start.pressure) * t,
        velocity: start.velocity + (end.velocity - start.velocity) * t,
        time: start.time + (end.time - start.time) * t,
      });
      traveled += step;
    }
    carry = segment - (traveled - step);
  }

  const last = points[points.length - 1];
  const tip = result[result.length - 1];
  if (Math.hypot(last.sx - tip.sx, last.sy - tip.sy) > step * 0.2) {
    result.push({ ...last });
  }

  return result;
}

function smoothPosition(
  points: readonly ScreenSample[],
  weight: number,
): ScreenSample[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { ...point };

    const previous = points[index - 1];
    const next = points[index + 1];
    const inX = point.sx - previous.sx;
    const inY = point.sy - previous.sy;
    const outX = next.sx - point.sx;
    const outY = next.sy - point.sy;
    const inLen = Math.hypot(inX, inY);
    const outLen = Math.hypot(outX, outY);
    const cosine = inLen > 1e-4 && outLen > 1e-4
      ? clamp((inX * outX + inY * outY) / (inLen * outLen), -1, 1)
      : 1;
    const corner = clamp((Math.acos(cosine) - 0.4) / 0.85, 0, 1);
    const w = weight * (1 - corner * 0.8);

    return {
      ...point,
      sx: previous.sx * w + point.sx * (1 - 2 * w) + next.sx * w,
      sy: previous.sy * w + point.sy * (1 - 2 * w) + next.sy * w,
    };
  });
}

function smoothWidth(
  points: readonly ScreenSample[],
  weight: number,
): ScreenSample[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { ...point };
    const previous = points[index - 1];
    const next = points[index + 1];
    return {
      ...point,
      sw: previous.sw * weight
        + point.sw * (1 - 2 * weight)
        + next.sw * weight,
    };
  });
}
