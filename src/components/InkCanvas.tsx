import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  ColorSwatch,
  Divider,
  Group,
  Paper,
  Slider,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconArrowBackUp, IconPencil, IconTrash } from '@tabler/icons-react';
import './InkCanvas.css';

type InkPoint = {
  x: number;
  y: number;
  pressure: number;
  velocity: number;
  width: number;
  time: number;
};

type Stroke = {
  color: string;
  size: number;
  rawPoints: InkPoint[];
  points: InkPoint[];
};

const COLORS = ['#111827', '#4263eb', '#0ca678', '#e03131', '#9c36b5'];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getRenderScale = () =>
  clamp((window.devicePixelRatio || 1) * 1.5, 1.5, 2);

function prepareContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 Canvas 2D 上下文');
  const scale = getRenderScale();
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
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

function stabilizePoint(previous: InkPoint, current: InkPoint, next: InkPoint): InkPoint {
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
  const positionWeight = clamp(0.16 * (1 - turn / (Math.PI * 0.72)), 0.015, 0.16);
  const widthWeight = Math.min(0.1, positionWeight);

  return {
    x: previous.x * positionWeight
      + current.x * (1 - positionWeight * 2)
      + next.x * positionWeight,
    y: previous.y * positionWeight
      + current.y * (1 - positionWeight * 2)
      + next.y * positionWeight,
    pressure: current.pressure,
    velocity: current.velocity,
    width: previous.width * widthWeight
      + current.width * (1 - widthWeight * 2)
      + next.width * widthWeight,
    time: current.time,
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
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(8);
  const [, setHistoryVersion] = useState(0);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  useEffect(() => {
    brushSizeRef.current = brushSize;
  }, [brushSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    const cursor = cursorRef.current;
    if (!canvas || !previewCanvas || !cursor) return undefined;

    const redrawBase = () => {
      const context = clearCanvas(canvas);
      strokesRef.current.forEach((stroke) => drawPoints(context, stroke.points, stroke.color));
    };

    const drawPreview = (stroke: Stroke | null) => {
      const context = clearCanvas(previewCanvas);
      if (!stroke || stroke.rawPoints.length === 0) return;

      const tip = stroke.rawPoints.at(-1);
      if (!tip) return;
      const stableTail = stroke.points.at(-1);

      if (stableTail) {
        drawSegment(context, stableTail, tip, stroke.color);
      } else {
        drawPoints(context, stroke.rawPoints, stroke.color);
      }
    };

    const resizeCanvases = () => {
      const baseChanged = resizeCanvas(canvas);
      const previewChanged = resizeCanvas(previewCanvas);
      if (!baseChanged && !previewChanged) return;
      redrawBase();
      drawPreview(activeStrokeRef.current);
    };

    const updateCursor = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const size = brushSizeRef.current;
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      cursor.style.width = `${size}px`;
      cursor.style.height = `${size}px`;
      cursor.style.borderColor = colorRef.current;
      cursor.style.backgroundColor = `${colorRef.current}1f`;
      cursor.style.transform = `translate3d(${x - size / 2}px, ${y - size / 2}px, 0)`;
      cursor.dataset.visible = 'true';
    };

    const toPoint = (event: PointerEvent, previous?: InkPoint): InkPoint => {
      const bounds = canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const fallbackPressure = event.pointerType === 'mouse' ? 0.5 : 0.12;
      const rawPressure = clamp(event.pressure > 0 ? event.pressure : fallbackPressure, 0, 1);
      const deltaTime = previous ? Math.max(1, event.timeStamp - previous.time) : 1;
      const distance = previous ? Math.hypot(x - previous.x, y - previous.y) : 0;
      const rawVelocity = distance / deltaTime;
      const pressure = previous
        ? previous.pressure * 0.15 + rawPressure * 0.85
        : rawPressure;
      const velocity = previous
        ? previous.velocity * 0.25 + rawVelocity * 0.75
        : 0;
      const pressureFactor = 0.24 + 0.76 * Math.pow(pressure, 0.68);
      const speedFactor = clamp(1.06 - velocity * 0.18, 0.42, 1);
      const targetWidth = Math.max(0.8, brushSizeRef.current * pressureFactor * speedFactor);
      const widthResponse = previous && targetWidth < previous.width ? 0.52 : 0.84;
      const width = previous
        ? previous.width + (targetWidth - previous.width) * widthResponse
        : targetWidth;

      return { x, y, pressure, velocity, width, time: event.timeStamp };
    };

    const appendPoint = (event: PointerEvent) => {
      const stroke = activeStrokeRef.current;
      if (!stroke) return;

      const previous = stroke.rawPoints.at(-1);
      const point = toPoint(event, previous);
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.1) return;
      stroke.rawPoints.push(point);

      const count = stroke.rawPoints.length;
      if (count < 3) return;

      if (stroke.points.length === 0) {
        stroke.points.push(stroke.rawPoints[0]);
        drawDot(prepareContext(canvas), stroke.rawPoints[0], stroke.color);
      }

      const stablePoint = stabilizePoint(
        stroke.rawPoints[count - 3],
        stroke.rawPoints[count - 2],
        stroke.rawPoints[count - 1],
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

      if (stroke.points.length === 0) {
        stroke.points = [...stroke.rawPoints];
        drawPoints(context, stroke.points, stroke.color);
      } else {
        const stableTail = stroke.points.at(-1);
        const rawTip = stroke.rawPoints.at(-1);
        if (stableTail && rawTip && Math.hypot(rawTip.x - stableTail.x, rawTip.y - stableTail.y) >= 0.01) {
          drawSegment(context, stableTail, rawTip, stroke.color);
          stroke.points.push(rawTip);
        }
      }

      clearCanvas(previewCanvas);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      activePointerRef.current = event.pointerId;
      const stroke: Stroke = {
        color: colorRef.current,
        size: brushSizeRef.current,
        rawPoints: [],
        points: [],
      };
      strokesRef.current.push(stroke);
      activeStrokeRef.current = stroke;
      appendPoint(event);
      drawPreview(stroke);
      updateCursor(event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateCursor(event);
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      const samples = event.getCoalescedEvents?.() ?? [event];
      samples.forEach(appendPoint);
      drawPreview(activeStrokeRef.current);
    };

    const finishStroke = (event: PointerEvent) => {
      if (activePointerRef.current !== event.pointerId) return;
      appendPoint(event);
      finishActiveStroke();
      activePointerRef.current = null;
      activeStrokeRef.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
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
    canvas.addEventListener('pointerup', finishStroke);
    canvas.addEventListener('pointercancel', finishStroke);
    canvas.addEventListener('pointerenter', updateCursor);
    canvas.addEventListener('pointerleave', hideCursor);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeCanvases);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
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
          <Tooltip label="钢笔">
            <ActionIcon variant="light" size="lg" radius="md" aria-label="钢笔">
              <IconPencil size={20} />
            </ActionIcon>
          </Tooltip>
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
