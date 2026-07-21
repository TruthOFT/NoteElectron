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
  // 直笔防抖保留；上限收一点，少「果冻/粘」
  const stabilityRatio = clamp(stability / 100, 0, 1);
  const maximumWeight = 0.14 + stabilityRatio * 0.28;
  const minimumWeight = 0.03 + stabilityRatio * 0.05;
  const basePositionWeight = clamp(
    maximumWeight * (1 - turn / (Math.PI * 0.72)),
    minimumWeight,
    maximumWeight,
  );
  const screenWidth = current.width * inputScale;
  const sampleSpan = Math.max(incomingLength, outgoingLength) * inputScale;
  // 短步长才加防抖；中心线稳定不跟线宽走
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
  // 转角减弱位置抹平，横折/小钩别粘成一团
  const cornerRatio = clamp((turn - 0.28) / 0.9, 0, 1);
  const cornerProtection = 1 - cornerRatio * 0.7;
  const jitterBoost = shortSampleRatio
    * (0.07 + sharpJitterRatio * 0.08)
    * cornerProtection;
  const localMaximumWeight = 0.38 - cornerRatio * 0.12;
  const positionWeight = Math.min(
    localMaximumWeight,
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
    // 宽度只在 stroke 定；再抹宽会「墨糊粘连」
    width: current.width,
    time: current.time,
  };
}
