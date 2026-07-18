import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  ColorSwatch,
  Divider,
  Group,
  Paper,
  Popover,
  Slider,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconArrowBackUp, IconPencil, IconTrash } from '@tabler/icons-react';
import './InkCanvas.css';

type InkPoint = {
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  pressure: number;
  velocity: number;
  width: number;
  time: number;
};

type Stroke = {
  color: string;
  size: number;
  sharpness: number;
  pressureSensitivity: number;
  stability: number;
  liveTailPoints: number;
  rawPoints: InkPoint[];
  points: InkPoint[];
};

type DirtyRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const COLORS = ['#111827', '#4263eb', '#0ca678', '#e03131', '#9c36b5'];
const FIXED_STABILITY = 80;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getRenderScale = () =>
  clamp((window.devicePixelRatio || 1) * 1.5, 1.5, 2);

function prepareContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('无法创建 Canvas 2D 上下文');
  const scale = getRenderScale();
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
}

function getDirtyRect(points: InkPoint[]): DirtyRect | null {
  if (points.length === 0) return null;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  let maxWidth = points[0].width;

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxWidth = Math.max(maxWidth, point.width);
  });

  const padding = maxWidth / 2 + 3;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

function clearCanvas(canvas: HTMLCanvasElement) {
  const context = prepareContext(canvas);
  const bounds = canvas.getBoundingClientRect();
  context.clearRect(0, 0, bounds.width, bounds.height);
  return context;
}

function resizeCanvas(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  const scale = getRenderScale();
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));

  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

function drawDot(context: CanvasRenderingContext2D, point: InkPoint, color: string) {
  context.beginPath();
  context.arc(point.x, point.y, point.width / 2, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

function drawSegment(
  context: CanvasRenderingContext2D,
  start: InkPoint,
  end: InkPoint,
  color: string,
) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.01) {
    drawDot(context, end, color);
    return;
  }

  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.strokeStyle = color;
  context.lineWidth = (start.width + end.width) / 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke();
}

function drawPoints(
  context: CanvasRenderingContext2D,
  points: InkPoint[],
  color: string,
) {
  if (points.length === 0) return;
  drawDot(context, points[0], color);
  for (let index = 1; index < points.length; index += 1) {
    drawSegment(context, points[index - 1], points[index], color);
  }
}

function stabilizePoint(
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

function stabilizeStrokeStart(points: InkPoint[], stability: number): InkPoint {
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

export default function InkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const colorRef = useRef(COLORS[0]);
  const brushSizeRef = useRef(8);
  const sharpnessRef = useRef(75);
  const pressureSensitivityRef = useRef(55);
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(8);
  const [sharpness, setSharpness] = useState(75);
  const [pressureSensitivity, setPressureSensitivity] = useState(55);
  const [, setHistoryVersion] = useState(0);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  useEffect(() => {
    brushSizeRef.current = brushSize;
  }, [brushSize]);

  useEffect(() => {
    sharpnessRef.current = sharpness;
  }, [sharpness]);

  useEffect(() => {
    pressureSensitivityRef.current = pressureSensitivity;
  }, [pressureSensitivity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    const cursor = cursorRef.current;
    if (!canvas || !previewCanvas || !cursor) return undefined;
    let previewDirtyRect: DirtyRect | null = null;

    const redrawBase = () => {
      const context = clearCanvas(canvas);
      strokesRef.current.forEach((stroke) => drawPoints(context, stroke.points, stroke.color));
    };

    const clearPreview = () => {
      if (!previewDirtyRect) return;
      const context = prepareContext(previewCanvas);
      context.clearRect(
        previewDirtyRect.x,
        previewDirtyRect.y,
        previewDirtyRect.width,
        previewDirtyRect.height,
      );
      previewDirtyRect = null;
    };

    const drawPreview = (stroke: Stroke | null) => {
      clearPreview();
      if (!stroke || stroke.rawPoints.length === 0) return;

      const tip = stroke.rawPoints.at(-1);
      if (!tip) return;
      const stableTail = stroke.points.at(-1);
      const context = prepareContext(previewCanvas);

      if (stableTail) {
        const tailPoints = [
          stableTail,
          ...stroke.rawPoints.slice(stroke.points.length),
        ];
        drawPoints(context, tailPoints, stroke.color);
        previewDirtyRect = getDirtyRect(tailPoints);
      } else {
        drawPoints(context, stroke.rawPoints, stroke.color);
        previewDirtyRect = getDirtyRect(stroke.rawPoints);
      }
    };

    const resizeCanvases = () => {
      const baseChanged = resizeCanvas(canvas);
      const previewChanged = resizeCanvas(previewCanvas);
      if (!baseChanged && !previewChanged) return;
      if (previewChanged) previewDirtyRect = null;
      redrawBase();
      drawPreview(activeStrokeRef.current);
    };

    const updateCursor = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const size = Math.max(1.5, brushSizeRef.current * 0.75);
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      cursor.style.width = `${size}px`;
      cursor.style.height = `${size}px`;
      cursor.style.borderColor = colorRef.current;
      cursor.style.backgroundColor = `${colorRef.current}1f`;
      cursor.style.transform = `translate3d(${x - size / 2}px, ${y - size / 2}px, 0)`;
      cursor.dataset.visible = activePointerRef.current === null ? 'true' : 'false';
    };

    const toPoint = (event: PointerEvent, stroke: Stroke, previous?: InkPoint): InkPoint => {
      const bounds = canvas.getBoundingClientRect();
      const rawX = event.clientX - bounds.left;
      const rawY = event.clientY - bounds.top;
      const fallbackPressure = event.pointerType === 'mouse' ? 0.5 : 0.12;
      const rawPressure = clamp(event.pressure > 0 ? event.pressure : fallbackPressure, 0, 1);
      const deltaTime = previous ? Math.max(1, event.timeStamp - previous.time) : 1;
      const distance = previous ? Math.hypot(rawX - previous.rawX, rawY - previous.rawY) : 0;
      const rawVelocity = distance / deltaTime;
      const dampingResponse = 1 - stroke.stability / 100 * 0.55;
      const x = previous
        ? previous.x + (rawX - previous.x) * dampingResponse
        : rawX;
      const y = previous
        ? previous.y + (rawY - previous.y) * dampingResponse
        : rawY;
      const pressure = previous
        ? previous.pressure * 0.15 + rawPressure * 0.85
        : rawPressure;
      const velocity = previous
        ? previous.velocity * 0.25 + rawVelocity * 0.75
        : 0;
      const sharpnessRatio = stroke.sharpness / 100;
      const sensitivityRatio = stroke.pressureSensitivity / 100;
      const minimumWidthRatio = 0.42 - sharpnessRatio * 0.34;
      const pressureExponent = 0.25 + sensitivityRatio * 1.55;
      const pressureFactor = minimumWidthRatio
        + (1 - minimumWidthRatio) * Math.pow(pressure, pressureExponent);
      const speedStrength = 0.03 + sharpnessRatio * 0.27;
      const speedFloor = 0.85 - sharpnessRatio * 0.6;
      const speedFactor = clamp(1.06 - velocity * speedStrength, speedFloor, 1);
      const targetWidth = Math.max(0.8, stroke.size * pressureFactor * speedFactor);
      const widthResponse = previous && targetWidth < previous.width ? 0.52 : 0.84;
      const width = previous
        ? previous.width + (targetWidth - previous.width) * widthResponse
        : targetWidth;

      return { x, y, rawX, rawY, pressure, velocity, width, time: event.timeStamp };
    };

    const appendPoint = (event: PointerEvent) => {
      const stroke = activeStrokeRef.current;
      if (!stroke) return;

      const previous = stroke.rawPoints.at(-1);
      const point = toPoint(event, stroke, previous);
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.1) return;
      stroke.rawPoints.push(point);

      const count = stroke.rawPoints.length;
      if (count < stroke.liveTailPoints + 2) return;

      if (stroke.points.length === 0) {
        const stableStart = stabilizeStrokeStart(stroke.rawPoints, stroke.stability);
        stroke.points.push(stableStart);
        drawDot(prepareContext(canvas), stableStart, stroke.color);
      }

      const stableIndex = count - stroke.liveTailPoints - 1;
      const stablePoint = stabilizePoint(
        stroke.rawPoints[stableIndex - 1],
        stroke.rawPoints[stableIndex],
        stroke.rawPoints[stableIndex + 1],
        stroke.stability,
      );
      const stablePrevious = stroke.points.at(-1);
      if (stablePrevious) {
        drawSegment(prepareContext(canvas), stablePrevious, stablePoint, stroke.color);
      }
      stroke.points.push(stablePoint);
    };

    const finishActiveStroke = () => {
      const stroke = activeStrokeRef.current;
      if (!stroke || stroke.rawPoints.length === 0) return;
      const context = prepareContext(canvas);

      for (let index = stroke.points.length; index < stroke.rawPoints.length; index += 1) {
        const point = index === 0
          ? stabilizeStrokeStart(stroke.rawPoints, stroke.stability)
          : index < stroke.rawPoints.length - 1
          ? stabilizePoint(
            stroke.rawPoints[index - 1],
            stroke.rawPoints[index],
            stroke.rawPoints[index + 1],
            stroke.stability,
          )
          : stroke.rawPoints[index];
        const previous = stroke.points.at(-1);
        if (previous) drawSegment(context, previous, point, stroke.color);
        else drawDot(context, point, stroke.color);
        stroke.points.push(point);
      }

      clearPreview();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      activePointerRef.current = event.pointerId;
      const stroke: Stroke = {
        color: colorRef.current,
        size: brushSizeRef.current,
        sharpness: sharpnessRef.current,
        pressureSensitivity: pressureSensitivityRef.current,
        stability: FIXED_STABILITY,
        liveTailPoints: 2 + Math.round(FIXED_STABILITY / 25),
        rawPoints: [],
        points: [],
      };
      strokesRef.current.push(stroke);
      activeStrokeRef.current = stroke;
      appendPoint(event);
      drawPreview(stroke);
      updateCursor(event);
    };

    const processActiveInput = (event: PointerEvent) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      const samples = event.getCoalescedEvents?.() ?? [event];
      samples.forEach(appendPoint);
      drawPreview(activeStrokeRef.current);
    };

    const supportsRawUpdate = 'onpointerrawupdate' in window;

    const handlePointerMove = (event: PointerEvent) => {
      updateCursor(event);
      if (!supportsRawUpdate) processActiveInput(event);
    };

    const handlePointerRawUpdate = (event: Event) => {
      if (!(event instanceof PointerEvent)) return;
      updateCursor(event);
      processActiveInput(event);
    };

    const finishStroke = (event: PointerEvent) => {
      if (activePointerRef.current !== event.pointerId) return;
      finishActiveStroke();
      activePointerRef.current = null;
      activeStrokeRef.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      updateCursor(event);
      setHistoryVersion((version) => version + 1);
    };

    const hideCursor = () => {
      if (activePointerRef.current === null) cursor.dataset.visible = 'false';
    };

    const observer = new ResizeObserver(resizeCanvases);
    observer.observe(canvas);
    window.addEventListener('resize', resizeCanvases);
    resizeCanvases();

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    if (supportsRawUpdate) canvas.addEventListener('pointerrawupdate', handlePointerRawUpdate);
    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);
    canvas.addEventListener('pointerenter', updateCursor);
    canvas.addEventListener('pointerleave', hideCursor);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeCanvases);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      if (supportsRawUpdate) canvas.removeEventListener('pointerrawupdate', handlePointerRawUpdate);
      canvas.removeEventListener('pointerup', finishStroke);
      canvas.removeEventListener('pointercancel', finishStroke);
      canvas.removeEventListener('pointerenter', updateCursor);
      canvas.removeEventListener('pointerleave', hideCursor);
    };
  }, []);

  const redrawAll = () => {
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!canvas || !previewCanvas) return;
    const context = clearCanvas(canvas);
    strokesRef.current.forEach((stroke) => drawPoints(context, stroke.points, stroke.color));
    clearCanvas(previewCanvas);
  };

  const undo = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current.pop();
    redrawAll();
    setHistoryVersion((version) => version + 1);
  };

  const clear = () => {
    if (strokesRef.current.length === 0) return;
    strokesRef.current = [];
    activeStrokeRef.current = null;
    activePointerRef.current = null;
    redrawAll();
    setHistoryVersion((version) => version + 1);
  };

  return (
    <Paper className="ink-panel" radius="xl" withBorder>
      <div className="ink-toolbar">
        <Group gap="sm" wrap="nowrap">
          <Popover width={310} position="bottom-start" shadow="md" withArrow>
            <Popover.Target>
              <ActionIcon variant="light" size="lg" radius="md" aria-label="钢笔设置">
                <IconPencil size={20} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown className="brush-settings">
              <Text fw={700} mb="md">钢笔参数</Text>
              <Stack gap="lg">
                <div>
                  <Group justify="space-between" mb={6}>
                    <Text size="sm">笔尖锐度</Text>
                    <Text size="xs" c="dimmed">{sharpness}%</Text>
                  </Group>
                  <Slider
                    value={sharpness}
                    onChange={(value) => {
                      sharpnessRef.current = value;
                      setSharpness(value);
                    }}
                    min={0}
                    max={100}
                    step={5}
                    label={(value) => `${value}%`}
                    aria-label="笔尖锐度"
                  />
                </div>
                <div>
                  <Group justify="space-between" mb={6}>
                    <Text size="sm">压力灵敏度</Text>
                    <Text size="xs" c="dimmed">{pressureSensitivity}% · 越小越省力</Text>
                  </Group>
                  <Slider
                    value={pressureSensitivity}
                    onChange={(value) => {
                      pressureSensitivityRef.current = value;
                      setPressureSensitivity(value);
                    }}
                    min={0}
                    max={100}
                    step={5}
                    label={(value) => `${value}%`}
                    aria-label="压力灵敏度"
                  />
                </div>
              </Stack>
            </Popover.Dropdown>
          </Popover>
          <Divider orientation="vertical" />
          <Group gap={7} wrap="nowrap">
            {COLORS.map((item) => (
              <ColorSwatch
                className="ink-color"
                component="button"
                color={item}
                key={item}
                onClick={() => setColor(item)}
                size={color === item ? 25 : 21}
                aria-label={`选择颜色 ${item}`}
              />
            ))}
          </Group>
          <Divider orientation="vertical" />
          <Text size="xs" c="dimmed" w={38}>{brushSize}px</Text>
          <Slider
            value={brushSize}
            onChange={setBrushSize}
            min={2}
            max={24}
            step={1}
            w={150}
            size="sm"
            aria-label="笔刷粗细"
          />
        </Group>

        <Group gap={4} wrap="nowrap">
          <Tooltip label="撤销">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={undo}
              disabled={strokesRef.current.length === 0}
              aria-label="撤销"
            >
              <IconArrowBackUp size={20} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="清空画布">
            <ActionIcon
              variant="subtle"
              color="red"
              size="lg"
              onClick={clear}
              disabled={strokesRef.current.length === 0}
              aria-label="清空画布"
            >
              <IconTrash size={19} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      <div className="canvas-stage">
        <canvas ref={canvasRef} className="ink-canvas ink-base-canvas" />
        <canvas ref={previewCanvasRef} className="ink-canvas ink-preview-canvas" />
        <div ref={cursorRef} className="brush-cursor" />
      </div>
    </Paper>
  );
}
