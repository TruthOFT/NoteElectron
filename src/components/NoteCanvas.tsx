import { useState } from 'react';
import useBrushCanvas from '../brush/useBrushCanvas';
import './NoteCanvas.css';

/** 基础稳定笔刷 + 压感 */
export default function NoteCanvas() {
  const [pressureSensitivity, setPressureSensitivity] = useState(0.75);
  const { committedRef, liveRef } = useBrushCanvas({
    color: '#111827',
    size: 6,
    pressureSensitivity,
  });

  return (
    <div className="note-canvas-root">
      <div className="brush-hud" onPointerDown={(event) => event.stopPropagation()}>
        <label className="brush-hud-label">
          压感 {Math.round(pressureSensitivity * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(pressureSensitivity * 100)}
            onChange={(event) => {
              setPressureSensitivity(Number(event.target.value) / 100);
            }}
          />
        </label>
        <span className="brush-hud-hint">0 匀粗 · 100 轻重差大</span>
      </div>
      <canvas ref={committedRef} className="note-canvas note-canvas-committed" />
      <canvas ref={liveRef} className="note-canvas note-canvas-live" />
    </div>
  );
}
