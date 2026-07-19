import type { InkPoint } from '../types';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function stabilizePoint(
  previous: InkPoint,
  current: InkPoint,
  next: InkPoint,
  stability: number,
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
  const stabilityRatio = stability / 100;
  const maximumWeight = 0.04 + stabilityRatio * 0.24;
  const minimumWeight = 0.01 + stabilityRatio * 0.025;
  const basePositionWeight = clamp(
    maximumWeight * (1 - turn / (Math.PI * 0.72)),
    minimumWeight,
    maximumWeight,
  );
  const thinStrokeRatio = clamp((5 - current.width) / 4.2, 0, 1);
  const sampleSpan = Math.max(incomingLength, outgoingLength);
  const jitterScale = Math.max(2.5, current.width * 1.25);
  const shortSampleRatio = clamp(
    (jitterScale - sampleSpan) / (jitterScale * 0.75),
    0,
    1,
  );
  const sharpJitterRatio = clamp(
    (turn - 0.28) / (Math.PI - 0.28),
    0,
    1,
  );
  const jitterBoost = thinStrokeRatio
    * shortSampleRatio
    * (0.08 + sharpJitterRatio * 0.22);
  const positionWeight = Math.min(
    0.38,
    basePositionWeight + jitterBoost,
  );
  const thinWidthRatio = clamp((3 - current.width) / 2.5, 0, 1);
  const widthWeight = Math.min(
    0.28,
    stabilityRatio * 0.12 + thinWidthRatio * 0.16,
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
