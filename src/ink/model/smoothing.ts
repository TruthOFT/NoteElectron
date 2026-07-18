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
  const positionWeight = clamp(
    maximumWeight * (1 - turn / (Math.PI * 0.72)),
    minimumWeight,
    maximumWeight,
  );
  const widthWeight = Math.min(stabilityRatio * 0.12, positionWeight);

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

export function stabilizeStrokeStart(points: InkPoint[], stability: number): InkPoint {
  const start = points[0];
  if (points.length < 3) return start;

  const next = points[1];
  const guide = points[Math.min(3, points.length - 1)];
  const directionX = guide.x - next.x;
  const directionY = guide.y - next.y;
  const directionLength = Math.hypot(directionX, directionY);
  if (directionLength < 0.01) return start;

  const unitX = directionX / directionLength;
  const unitY = directionY / directionLength;
  const startOffsetX = start.x - next.x;
  const startOffsetY = start.y - next.y;
  const projectionLength = startOffsetX * unitX + startOffsetY * unitY;
  const projectedX = next.x + unitX * projectionLength;
  const projectedY = next.y + unitY * projectionLength;
  const lateralError = Math.hypot(projectedX - start.x, projectedY - start.y);

  const firstDirectionX = next.x - start.x;
  const firstDirectionY = next.y - start.y;
  const firstDirectionLength = Math.hypot(firstDirectionX, firstDirectionY);
  const cosine = firstDirectionLength > 0
    ? clamp(
      (firstDirectionX * directionX + firstDirectionY * directionY)
        / (firstDirectionLength * directionLength),
      -1,
      1,
    )
    : 1;
  const turn = Math.acos(cosine);
  const turnFactor = clamp((turn - 0.12) / 1.05, 0, 1);
  const errorFactor = clamp(lateralError / Math.max(0.6, start.width * 0.28), 0, 1);
  const correction = Math.max(turnFactor, errorFactor * 0.72)
    * (0.68 + stability / 100 * 0.2);

  return {
    ...start,
    x: start.x + (projectedX - start.x) * correction,
    y: start.y + (projectedY - start.y) * correction,
  };
}
