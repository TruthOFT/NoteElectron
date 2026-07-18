import { useEffect, useRef, useState } from 'react';
import StrokeHistory from '../history/StrokeHistory';
import { appendSample, createStroke, finishStroke } from '../model/stroke';
import {
  clearCanvas,
  drawAddedPoints,
  drawPoints,
  getDirtyRect,
  prepareContext,
  redrawStrokes,
  resizeCanvas,
} from '../render/canvasRenderer';
import type { DirtyRect, PointerSample, Stroke } from '../types';

type InkCanvasOptions = {
  color: string;
  brushSize: number;
  sharpness: number;
  pressureSensitivity: number;
};

const FIXED_STABILITY = 80;

function samplePointer(event: PointerEvent, canvas: HTMLCanvasElement): PointerSample {
  const bounds = canvas.getBoundingClientRect();
  const fallbackPressure = event.pointerType === 'mouse' ? 0.5 : 0.12;
  const pressure = Math.min(
    1,
    Math.max(0, event.pressure > 0 ? event.pressure : fallbackPressure),
  );
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
    pressure,
    time: event.timeStamp,
  };
}

export default function useInkCanvas(options: InkCanvasOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  const [history] = useState(() => new StrokeHistory());
  const [, setHistoryVersion] = useState(0);
  optionsRef.current = options;

  useEffect(() => {
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    const cursor = cursorRef.current;
    if (!canvas || !previewCanvas || !cursor) return undefined;
    let previewDirtyRect: DirtyRect | null = null;

    const redrawBase = () => redrawStrokes(canvas, history.all);

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
      const { brushSize, color } = optionsRef.current;
      const size = Math.max(1.5, brushSize * 0.75);
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      cursor.style.width = `${size}px`;
      cursor.style.height = `${size}px`;
      cursor.style.borderColor = color;
      cursor.style.backgroundColor = `${color}1f`;
      cursor.style.transform = `translate3d(${x - size / 2}px, ${y - size / 2}px, 0)`;
      cursor.dataset.visible = activePointerRef.current === null ? 'true' : 'false';
    };

    const appendPoint = (event: PointerEvent) => {
      const stroke = activeStrokeRef.current;
      if (!stroke) return;
      const previous = stroke.points.at(-1);
      const addedPoints = appendSample(stroke, samplePointer(event, canvas));
      if (addedPoints.length === 0) return;
      drawAddedPoints(prepareContext(canvas), previous, addedPoints, stroke.color);
    };

    const finishActiveStroke = () => {
      const stroke = activeStrokeRef.current;
      if (!stroke || stroke.rawPoints.length === 0) return;
      const previous = stroke.points.at(-1);
      const addedPoints = finishStroke(stroke);
      if (addedPoints.length > 0) {
        drawAddedPoints(prepareContext(canvas), previous, addedPoints, stroke.color);
      }
      clearPreview();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      activePointerRef.current = event.pointerId;
      const settings = optionsRef.current;
      const stroke = createStroke({
        color: settings.color,
        size: settings.brushSize,
        sharpness: settings.sharpness,
        pressureSensitivity: settings.pressureSensitivity,
        stability: FIXED_STABILITY,
      });
      history.add(stroke);
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

    const finishActivePointer = (event: PointerEvent) => {
      if (activePointerRef.current !== event.pointerId) return;
      finishActiveStroke();
      activePointerRef.current = null;
      activeStrokeRef.current = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
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
    canvas.addEventListener('pointerup', finishActivePointer);
    canvas.addEventListener('pointercancel', finishActivePointer);
    canvas.addEventListener('pointerenter', updateCursor);
    canvas.addEventListener('pointerleave', hideCursor);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resizeCanvases);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      if (supportsRawUpdate) {
        canvas.removeEventListener('pointerrawupdate', handlePointerRawUpdate);
      }
      canvas.removeEventListener('pointerup', finishActivePointer);
      canvas.removeEventListener('pointercancel', finishActivePointer);
      canvas.removeEventListener('pointerenter', updateCursor);
      canvas.removeEventListener('pointerleave', hideCursor);
    };
  }, [history]);

  const redrawAll = () => {
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!canvas || !previewCanvas) return;
    redrawStrokes(canvas, history.all);
    clearCanvas(previewCanvas);
  };

  const undo = () => {
    if (!history.undo()) return;
    redrawAll();
    setHistoryVersion((version) => version + 1);
  };

  const clear = () => {
    if (!history.clear()) return;
    activeStrokeRef.current = null;
    activePointerRef.current = null;
    redrawAll();
    setHistoryVersion((version) => version + 1);
  };

  return {
    canvasRef,
    previewCanvasRef,
    cursorRef,
    canUndo: !history.isEmpty,
    undo,
    clear,
  };
}
