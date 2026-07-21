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
  points: BrushPoint[];
};

export type BrushSettings = {
  color: string;
  size: number;
};
