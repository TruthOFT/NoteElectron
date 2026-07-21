import type { InkPoint } from '../types';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * 实时三点稳定：故意轻。
 * 重稳定 = 笔迹落后笔尖 = 粘手 = 手去追 = 看起来更抖。
 * 重整理放在抬笔 rebuild，不放在写时。
 */
export function stabilizePoint(
  previous: InkPoint,
  current: InkPoint,
  next: InkPoint,
  stability: number,
  inputScale: number,
): InkPoint {
  const incomingX = current.x - previous.x;
  const incomingY = current.y - previous.y;
  const outgoingX = next.x - current.x;
  const outgoingY = next.y - current.y;
  const incomingLength = Math.hypot(incomingX, incomingY);
  const outgoingLength = Math.hypot(outgoingX, outgoingY);
  const cosine = incomingLength > 0 && outgoingLength > 0
    ? clamp(
      (incomingX * outgoingX + incomingY * outgoingY)
        / (incomingLength * outgoingLength),
      -1,
      1,
    )
    : 1;
  const turn = Math.acos(cosine);
  const stabilityRatio = clamp(stability / 100, 0, 1);

  // 上限约 0.22：当前点仍占大头，跟手
  const maximumWeight = 0.08 + stabilityRatio * 0.14;
  const minimumWeight = 0.02 + stabilityRatio * 0.03;
  const basePositionWeight = clamp(
    maximumWeight * (1 - turn / (Math.PI * 0.72)),
    minimumWeight,
    maximumWeight,
  );

  const sampleSpan = Math.max(incomingLength, outgoingLength) * inputScale;
  const shortSampleRatio = clamp((2.2 - sampleSpan) / 2.2, 0, 1);
  const cornerRatio = clamp((turn - 0.28) / 0.9, 0, 1);
  const jitterBoost = shortSampleRatio * 0.04 * (1 - cornerRatio * 0.85);
  const positionWeight = Math.min(
    0.22,
    basePositionWeight + jitterBoost,
  );

  return {
    x: previous.x * positionWeight
      + current.x * (1 - positionWeight * 2)
      + next.x * positionWeight,
    y: previous.y * positionWeight
      + current.y * (1 - positionWeight * 2)
      + next.y * positionWeight,
    rawX: current.rawX,
    rawY: current.rawY,
    pressure: current.pressure,
    velocity: current.velocity,
    width: current.width,
    time: current.time,
  };
}
