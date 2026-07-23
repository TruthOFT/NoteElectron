import { useEffect, useRef } from 'react';
import {
  BrushRenderSurface,
  strokeBounds,
  type BrushRect,
} from './render';
import {
  appendPoint,
  BrushDisplayCache,
  createStroke,
  finishStroke,
} from './stroke';
import type { BrushPoint, BrushSettings, BrushStroke } from './types';

const DEFAULT_SETTINGS: BrushSettings = {
  color: '#111827',
  size: 6,
  pressureSensitivity: 0.75,
};

const DIRTY_PADDING_CSS = 3;
const DIRTY_OVERLAP_POINTS = 2;

function unionRects(
  first: BrushRect | null,
  second: BrushRect | null,
): BrushRect | null {
  if (!first) return second;
  if (!second) return first;
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return { x, y, width: right - x, height: bottom - y };
}

function resizeCanvas(canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(bounds.width * dpr));
  const height = Math.max(1, Math.round(bounds.height * dpr));
  if (canvas.width === width && canvas.height === height) return dpr;
  canvas.width = width;
  canvas.height = height;
  return dpr;
}

function sampleEvent(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  dpr: number,
) {
  const bounds = canvas.getBoundingClientRect();
  const fallback = event.pointerType === 'mouse' ? 0.5 : 0;
  const pressure = Math.min(
    1,
    Math.max(0, event.pressure > 0 ? event.pressure : fallback),
  );
  return {
    x: (event.clientX - bounds.left) * dpr,
    y: (event.clientY - bounds.top) * dpr,
    pressure,
    time: event.timeStamp,
    inputScale: dpr,
  };
}

export default function useBrushCanvas(settings: Partial<BrushSettings> = {}) {
  const committedRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const clearCanvasRef = useRef<() => void>(() => {});
  const settingsRef = useRef({ ...DEFAULT_SETTINGS, ...settings });
  settingsRef.current = { ...DEFAULT_SETTINGS, ...settings };

  useEffect(() => {
    const committed = committedRef.current;
    const live = liveRef.current;
    if (!committed || !live) return undefined;

    let dpr = 1;
    let active: BrushStroke | null = null;
    let pointerId: number | null = null;
    const history: BrushStroke[] = [];
    let frame: number | null = null;
    let liveDisplayPoints: BrushPoint[] = [];
    const displayCache = new BrushDisplayCache();
    const committedSurface = new BrushRenderSurface(committed);
    const liveSurface = new BrushRenderSurface(live);

    const redrawCommitted = () => {
      committedSurface.clear();
      committedSurface.drawStrokes(history);
      committedSurface.present();
    };

    const clearLive = () => {
      liveDisplayPoints = [];
      displayCache.reset();
      liveSurface.clear();
    };

    clearCanvasRef.current = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      if (pointerId !== null && live.hasPointerCapture(pointerId)) {
        live.releasePointerCapture(pointerId);
      }
      active = null;
      pointerId = null;
      history.length = 0;
      clearLive();
      committedSurface.clear();
    };

    const paintLive = () => {
      frame = null;
      if (!active || active.points.length === 0) {
        clearLive();
        return;
      }
      const displayUpdate = displayCache.update(active.points, dpr);
      const nextDisplayPoints = displayUpdate.points;
      if (displayUpdate.changedStart === null) {
        liveDisplayPoints = nextDisplayPoints;
        return;
      }
      const dirtyStart = Math.max(
        0,
        displayUpdate.changedStart - DIRTY_OVERLAP_POINTS,
      );
      const padding = DIRTY_PADDING_CSS * dpr;
      const previousBounds = strokeBounds(
        liveDisplayPoints.slice(dirtyStart),
        padding,
      );
      const nextBounds = strokeBounds(
        nextDisplayPoints.slice(dirtyStart),
        padding,
      );
      const dirtyRect = unionRects(previousBounds, nextBounds);
      liveDisplayPoints = nextDisplayPoints;
      if (!dirtyRect) return;

      liveSurface.clearRect(dirtyRect);
      const displayStroke: BrushStroke = {
        ...active,
        points: liveDisplayPoints,
      };
      liveSurface.drawStroke(displayStroke, dirtyRect);
      liveSurface.present(dirtyRect);
    };

    const scheduleLive = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(paintLive);
    };

    const resize = () => {
      dpr = resizeCanvas(committed);
      resizeCanvas(live);
      committedSurface.syncSize(dpr);
      liveSurface.syncSize(dpr);
      liveDisplayPoints = [];
      displayCache.reset();
      redrawCommitted();
      paintLive();
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      live.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
      active = createStroke(settingsRef.current);
      liveDisplayPoints = [];
      displayCache.reset();
      appendPoint(active, sampleEvent(event, live, dpr));
      scheduleLive();
    };

    const onMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId || !active) return;
      event.preventDefault();
      const coalesced = event.getCoalescedEvents?.() ?? [];
      const samples = coalesced.length > 0 ? coalesced : [event];
      let changed = false;
      samples.forEach((sample) => {
        if (appendPoint(active!, sampleEvent(sample, live, dpr))) {
          changed = true;
        }
      });
      if (changed) scheduleLive();
    };

    const onRaw = (event: Event) => {
      if (!(event instanceof PointerEvent)) return;
      onMove(event);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (supportsRaw && event.pointerType !== 'mouse') return;
      onMove(event);
    };

    const onUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId || !active) return;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }

      finishStroke(active, dpr);
      if (active.points.length > 0) {
        history.push(active);
        committedSurface.drawStroke(active);
        committedSurface.present();
      }
      active = null;
      pointerId = null;
      clearLive();

      if (live.hasPointerCapture(event.pointerId)) {
        live.releasePointerCapture(event.pointerId);
      }
    };

    const supportsRaw = 'onpointerrawupdate' in window;
    const observer = new ResizeObserver(resize);
    observer.observe(live);
    resize();

    live.addEventListener('pointerdown', onDown);
    live.addEventListener('pointermove', onPointerMove);
    // 手写笔有 rawupdate 时只用它采点；鼠标保留 pointermove 回退。
    if (supportsRaw) {
      live.addEventListener('pointerrawupdate', onRaw);
    }
    live.addEventListener('pointerup', onUp);
    live.addEventListener('pointercancel', onUp);

    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      clearCanvasRef.current = () => {};
      live.removeEventListener('pointerdown', onDown);
      live.removeEventListener('pointermove', onPointerMove);
      if (supportsRaw) {
        live.removeEventListener('pointerrawupdate', onRaw);
      }
      live.removeEventListener('pointerup', onUp);
      live.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return {
    committedRef,
    liveRef,
    clearCanvas: () => clearCanvasRef.current(),
  };
}
