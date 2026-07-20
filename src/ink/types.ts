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
  inputScale: number;
  liveTailPoints: number;
  /** 当前笔画已走过的屏幕弧长（px），用于启动速度区 */
  screenLength: number;
  /** 起笔 7～12px 内共用的速度系数基准；无有效速度时为 null */
  startupSpeedFactor: number | null;
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
