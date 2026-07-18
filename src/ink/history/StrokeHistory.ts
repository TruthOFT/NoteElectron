import type { Stroke } from '../types';

export default class StrokeHistory {
  private strokes: Stroke[] = [];

  get all(): readonly Stroke[] {
    return this.strokes;
  }

  get isEmpty() {
    return this.strokes.length === 0;
  }

  add(stroke: Stroke) {
    this.strokes.push(stroke);
  }

  undo() {
    if (this.isEmpty) return false;
    this.strokes.pop();
    return true;
  }

  clear() {
    if (this.isEmpty) return false;
    this.strokes = [];
    return true;
  }
}
