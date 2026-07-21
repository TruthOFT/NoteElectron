import './NoteCanvas.css';

/** 空白画布，笔迹架构待重建 */
export default function NoteCanvas() {
  return (
    <div className="note-canvas-root">
      <canvas className="note-canvas" />
    </div>
  );
}
