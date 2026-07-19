import { useEffect, useRef, useState } from 'react';
import StrokeHistory from '../history/StrokeHistory';
import { appendSample, createStroke, finishStroke } from '../model/stroke';
import {
  clearCanvas,
  drawAddedPoints,
  drawPoints,
  getDirtyRect,
  prepareContext,
  resizeCanvas,
} from '../render/canvasRenderer';
import {
  appendVectorStroke,
  redrawVectorStrokes,
  setVectorView,
} from '../render/svgRenderer';
import type {
  DirtyRect,
  PointerSample,
  Stroke,
  ViewTransform,
} from '../types';

type InkCanvasOptions = {
  color: string;
  brushSize: number;
  sharpness: number;
  pressureSensitivity: number;
};

const FIXED_STABILITY = 80;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;
const ZOOM_CONTROLS_TIMEOUT = 2000;

const clampZoom = (value: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 10) / 10));

function samplePointer(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  view: ViewTransform,
): PointerSample {
  const bounds = canvas.getBoundingClientRect();
  const fallbackPressure = event.pointerType === 'mouse' ? 0.5 : 0.12;
  const pressure = Math.min(
    1,
    Math.max(0, event.pressure > 0 ? event.pressure : fallbackPressure),
  );
  const screenX = event.clientX - bounds.left;
  const screenY = event.clientY - bounds.top;
  return {
    x: (screenX - view.offsetX) / view.scale,
    y: (screenY - view.offsetY) / view.scale,
    pressure,
    time: event.timeStamp,
  };
}

export default function useInkCanvas(options: InkCanvasOptions) {
  const vectorLayerRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  const viewRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const zoomAtRef = useRef<(scale: number, x?: number, y?: number) => void>(() => {});
  const zoomTimerRef = useRef<number | null>(null);
  const [history] = useState(() => new StrokeHistory());
  const [, setHistoryVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [zoomControlsVisible, setZoomControlsVisible] = useState(false);
  optionsRef.current = options;

  const showZoomControls = () => {
    setZoomControlsVisible(true);
    if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = window.setTimeout(() => {
      setZoomControlsVisible(false);
      zoomTimerRef.current = null;
    }, ZOOM_CONTROLS_TIMEOUT);
  };

  useEffect(() => () => {
    if (zoomTimerRef.current !== null) window.clearTimeout(zoomTimerRef.current);
  }, []);

  useEffect(() => {
    const vectorLayer = vectorLayerRef.current;
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    const cursor = cursorRef.current;
    if (!vectorLayer || !canvas || !previewCanvas || !cursor) return undefined;
    let previewDirtyRect: DirtyRect | null = null;

    const redrawCanvas = () => {
      const context = clearCanvas(canvas, viewRef.current);
      history.all.forEach((stroke) => drawPoints(context, stroke.points, stroke.color));
      const stroke = activeStrokeRef.current;
      if (stroke) drawPoints(context, stroke.points, stroke.color);
    };

    const updateGrid = () => {
      const stage = canvas.parentElement;
      if (!stage) return;
      const view = viewRef.current;
      stage.style.setProperty('--grid-size', `${20 * view.scale}px`);
      stage.style.setProperty('--grid-position-x', `${view.offsetX}px`);
      stage.style.setProperty('--grid-position-y', `${view.offsetY}px`);
    };

    const clearPreview = () => {
      if (!previewDirtyRect) return;
      const context = prepareContext(previewCanvas, viewRef.current);
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
      const context = prepareContext(previewCanvas, viewRef.current);
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
      redrawCanvas();
      drawPreview(activeStrokeRef.current);
      setVectorView(vectorLayer, viewRef.current);
      updateGrid();
    };

    const updateCursor = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const { brushSize, color } = optionsRef.current;
      const size = Math.max(1.5, brushSize * viewRef.current.scale * 0.5);
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      cursor.style.width = `${size}px`;
      cursor.style.height = `${size}px`;
      cursor.style.backgroundColor = color;
      cursor.style.transform = `translate3d(${x - size / 2}px, ${y - size / 2}px, 0)`;
      cursor.dataset.visible = 'true';
    };

    const appendPoint = (event: PointerEvent) => {
      const stroke = activeStrokeRef.current;
      if (!stroke) return;
      const previous = stroke.points.at(-1);
      const addedPoints = appendSample(
        stroke,
        samplePointer(event, canvas, viewRef.current),
      );
      if (addedPoints.length === 0) return;
      drawAddedPoints(
        prepareContext(canvas, viewRef.current),
        previous,
        addedPoints,
        stroke.color,
      );
    };

    const finishActiveStroke = () => {
      const stroke = activeStrokeRef.current;
      if (!stroke || stroke.rawPoints.length === 0) return false;
      const previous = stroke.points.at(-1);
      const addedPoints = finishStroke(stroke);
      if (addedPoints.length > 0) {
        drawAddedPoints(
          prepareContext(canvas, viewRef.current),
          previous,
          addedPoints,
          stroke.color,
        );
      }
      clearPreview();
      history.add(stroke);
      appendVectorStroke(vectorLayer, stroke, viewRef.current);
      return true;
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

    zoomAtRef.current = (requestedScale, anchorX, anchorY) => {
      const nextScale = clampZoom(requestedScale);
      const currentView = viewRef.current;
      const bounds = canvas.getBoundingClientRect();
      const screenX = anchorX ?? bounds.width / 2;
      const screenY = anchorY ?? bounds.height / 2;
      const worldX = (screenX - currentView.offsetX) / currentView.scale;
      const worldY = (screenY - currentView.offsetY) / currentView.scale;

      viewRef.current = {
        scale: nextScale,
        offsetX: screenX - worldX * nextScale,
        offsetY: screenY - worldY * nextScale,
      };
      setZoom(nextScale);
      showZoomControls();
      previewDirtyRect = null;
      clearCanvas(previewCanvas, viewRef.current);
      redrawCanvas();
      drawPreview(activeStrokeRef.current);
      setVectorView(vectorLayer, viewRef.current);
      updateGrid();
    };

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const direction = event.deltaY < 0 ? 1 : -1;
      zoomAtRef.current(
        viewRef.current.scale + direction * ZOOM_STEP,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
      );
    };

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
      const committed = finishActiveStroke();
      activePointerRef.current = null;
      activeStrokeRef.current = null;
      if (committed) redrawCanvas();
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      updateCursor(event);
      if (committed) setHistoryVersion((version) => version + 1);
    };

    const hideCursor = () => {
      if (activePointerRef.current === null) cursor.dataset.visible = 'false';
    };

    const observer = new ResizeObserver(resizeCanvases);
    observer.observe(canvas);
    window.addEventListener('resize', resizeCanvases);
    redrawVectorStrokes(vectorLayer, history.all, viewRef.current);
    resizeCanvases();
    updateGrid();

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
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
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('pointermove', handlePointerMove);
      if (supportsRawUpdate) {
        canvas.removeEventListener('pointerrawupdate', handlePointerRawUpdate);
      }
      canvas.removeEventListener('pointerup', finishActivePointer);
      canvas.removeEventListener('pointercancel', finishActivePointer);
      canvas.removeEventListener('pointerenter', updateCursor);
      canvas.removeEventListener('pointerleave', hideCursor);
      zoomAtRef.current = () => {};
    };
  }, [history]);

  const redrawAll = () => {
    const vectorLayer = vectorLayerRef.current;
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!vectorLayer || !canvas || !previewCanvas) return;
    redrawVectorStrokes(vectorLayer, history.all, viewRef.current);
    const context = clearCanvas(canvas, viewRef.current);
    history.all.forEach((stroke) => drawPoints(context, stroke.points, stroke.color));
    clearCanvas(previewCanvas, viewRef.current);
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

  const zoomIn = () => zoomAtRef.current(viewRef.current.scale + ZOOM_STEP);
  const zoomOut = () => zoomAtRef.current(viewRef.current.scale - ZOOM_STEP);

  const exportPdf = async () => {
    const vectorLayer = vectorLayerRef.current;
    if (!vectorLayer || history.isEmpty) return;
    const bounds = vectorLayer.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const exportSvg = vectorLayer.cloneNode(true) as SVGSVGElement;
    exportSvg.removeAttribute('class');
    exportSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    exportSvg.setAttribute('width', String(width));
    exportSvg.setAttribute('height', String(height));
    exportSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    await window.noteElectron.exportPdf({
      svg: exportSvg.outerHTML,
      width,
      height,
    });
  };

  return {
    vectorLayerRef,
    canvasRef,
    previewCanvasRef,
    cursorRef,
    canUndo: !history.isEmpty,
    zoom,
    zoomControlsVisible,
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > MIN_ZOOM,
    zoomIn,
    zoomOut,
    exportPdf,
    undo,
    clear,
  };
}
