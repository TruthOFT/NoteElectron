export type BrushPoint = {
  /** 画布像素坐标 */
  x: number;
  y: number;
  /** 半径（画布像素） */
  r: number;
  pressure: number;
  time: number;
};

export type BrushStroke = {
  color: string;
  size: number;
  /** 0～1，越大轻重差越明显 */
  pressureSensitivity: number;
  points: BrushPoint[];
};

export type BrushSettings = {
  color: string;
  size: number;
  /** 0～1，默认 0.75 */
  pressureSensitivity: number;
};
