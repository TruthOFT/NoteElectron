import useBrushCanvas from '../brush/useBrushCanvas';
import './NoteCanvas.css';

/** 基础稳定笔刷：写时低延迟，抬笔等距轻平滑 */
export default function NoteCanvas() {
  const { committedRef, liveRef } = useBrushCanvas({
    color: '#111827',
    size: 6,
  });

  return (
    <div className="note-canvas-root">
      <canvas ref={committedRef} className="note-canvas note-canvas-committed" />
      <canvas ref={liveRef} className="note-canvas note-canvas-live" />
    </div>
  );
}
