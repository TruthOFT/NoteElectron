export type PointerSample = {
  x: number;
  y: number;
  pressure: number;
  time: number;
};

export type InkPoint = {
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  pressure: number;
  velocity: number;
  width: number;
  time: number;
};

export type BrushSettings = {
  color: string;
  size: number;
  sharpness: number;
  pressureSensitivity: number;
  stability: number;
};

export type Stroke = BrushSettings & {
  liveTailPoints: number;
  rawPoints: InkPoint[];
  points: InkPoint[];
};

export type DirtyRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};
