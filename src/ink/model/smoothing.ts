import type { InkPoint } from '../types';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

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
  // FIXED_STABILITY 可很大，压到 [0,1]；直笔 + 短采样更狠压抖
  const stabilityRatio = clamp(stability / 100, 0, 1);
  const maximumWeight = 0.18 + stabilityRatio * 0.32;
  const minimumWeight = 0.04 + stabilityRatio * 0.06;
  const basePositionWeight = clamp(
    maximumWeight * (1 - turn / (Math.PI * 0.72)),
    minimumWeight,
    maximumWeight,
  );
  const screenWidth = current.width * inputScale;
  const sampleSpan = Math.max(incomingLength, outgoingLength) * inputScale;
  // 短步长才加防抖；中心线稳定不跟线宽走（避免尖锐→变细→更抹圆）
  const jitterScale = Math.max(2.8, screenWidth * 1.4);
  const shortSampleRatio = clamp(
    (jitterScale - sampleSpan) / (jitterScale * 0.7),
    0,
    1,
  );
  const sharpJitterRatio = clamp(
    (turn - 0.22) / (Math.PI - 0.22),
    0,
    1,
  );
  const jitterBoost = shortSampleRatio * (
    0.08 + sharpJitterRatio * 0.1
  );
  const positionWeight = Math.min(
    0.42,
    basePositionWeight + jitterBoost,
  );
  // 宽度平滑仍可看细笔；位置与线宽解耦
  const thinWidthRatio = clamp((3 - screenWidth) / 2.5, 0, 1);
  const widthWeight = Math.min(
    0.36,
    stabilityRatio * 0.12
      + thinWidthRatio * 0.18
      + shortSampleRatio * 0.06,
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
    width: previous.width * widthWeight
      + current.width * (1 - widthWeight * 2)
      + next.width * widthWeight,
    time: current.time,
  };
}
