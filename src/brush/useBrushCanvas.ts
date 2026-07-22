import { useEffect, useRef } from 'react';
import { BrushRenderSurface } from './render';
import {
  appendPoint,
  buildDisplayPoints,
  createStroke,
  finishStroke,
} from './stroke';
import type { BrushSettings, BrushStroke } from './types';

const DEFAULT_SETTINGS: BrushSettings = {
  color: '#111827',
  size: 6,
  pressureSensitivity: 0.75,
};

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
    const committedSurface = new BrushRenderSurface(committed);
    const liveSurface = new BrushRenderSurface(live);

    const redrawCommitted = () => {
      committedSurface.clear();
      committedSurface.drawStrokes(history);
      committedSurface.present();
    };

    const clearLive = () => {
      liveSurface.clear();
    };

    const paintLive = () => {
      frame = null;
      clearLive();
      if (!active || active.points.length === 0) return;
      const displayStroke: BrushStroke = {
        ...active,
        points: buildDisplayPoints(active.points),
      };
      liveSurface.drawStroke(displayStroke);
      liveSurface.present();
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
      redrawCommitted();
      paintLive();
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      live.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
      active = createStroke(settingsRef.current);
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

    const onUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId || !active) return;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }

      finishStroke(active);
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
    // 有 rawupdate 时只用它采点，避免和 pointermove 双份采样
    if (supportsRaw) {
      live.addEventListener('pointerrawupdate', onRaw);
    } else {
      live.addEventListener('pointermove', onMove);
    }
    live.addEventListener('pointerup', onUp);
    live.addEventListener('pointercancel', onUp);

    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      live.removeEventListener('pointerdown', onDown);
      if (supportsRaw) {
        live.removeEventListener('pointerrawupdate', onRaw);
      } else {
        live.removeEventListener('pointermove', onMove);
      }
      live.removeEventListener('pointerup', onUp);
      live.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return {
    committedRef,
    liveRef,
  };
}
