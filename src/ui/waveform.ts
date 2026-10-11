import { computePeaks } from '../audio/load';
import { cssVar } from './dom';

// 音源全体の波形。ドラッグで範囲選択、クリックで再生位置の移動。

export class WaveformView {
  private peaks: Float32Array | null = null;
  private duration = 0;
  private playhead = 0;
  selection: { start: number; end: number } | null = null;
  onSeek: (t: number) => void = () => {};
  onSelect: (sel: { start: number; end: number } | null) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    let dragFrom: number | null = null;
    let moved = false;
    const timeAt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return Math.min(this.duration, Math.max(0, ((e.clientX - r.left) / r.width) * this.duration));
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.peaks) return;
      canvas.setPointerCapture(e.pointerId);
      dragFrom = timeAt(e);
      moved = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (dragFrom === null) return;
      const t = timeAt(e);
      if (Math.abs(t - dragFrom) > this.duration * 0.003) moved = true;
      if (moved) {
        this.selection = { start: Math.min(dragFrom, t), end: Math.max(dragFrom, t) };
        this.draw();
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (dragFrom === null) return;
      const t = timeAt(e);
      if (moved) this.onSelect(this.selection);
      else this.onSeek(t);
      dragFrom = null;
    });
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setBuffer(buffer: AudioBuffer): void {
    this.peaks = computePeaks(buffer, 2000);
    this.duration = buffer.duration;
    this.selection = null;
    this.playhead = 0;
    this.draw();
  }

  setPlayhead(t: number): void {
    this.playhead = t;
    this.draw();
  }

  setSelection(sel: { start: number; end: number } | null): void {
    this.selection = sel;
    this.draw();
  }

  draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!this.peaks || this.duration === 0) return;
    const x = (t: number) => (t / this.duration) * w;

    if (this.selection) {
      g.fillStyle = cssVar('--selection');
      g.fillRect(x(this.selection.start), 0, x(this.selection.end) - x(this.selection.start), h);
    }

    g.fillStyle = cssVar('--wave');
    const n = this.peaks.length;
    let max = 0;
    for (const p of this.peaks) max = Math.max(max, p);
    const scale = max > 0 ? (h / 2 - 4) / max : 0;
    for (let px = 0; px < w; px++) {
      const from = Math.floor((px / w) * n);
      const to = Math.max(from + 1, Math.floor(((px + 1) / w) * n));
      let p = 0;
      for (let i = from; i < to; i++) p = Math.max(p, this.peaks[i]);
      const hh = Math.max(1, p * scale);
      g.fillRect(px, h / 2 - hh, 1, hh * 2);
    }

    // 時間の目盛り (10秒ごと)
    g.fillStyle = cssVar('--muted');
    g.font = '10px system-ui, sans-serif';
    const step = this.duration > 240 ? 30 : this.duration > 60 ? 10 : 5;
    for (let t = step; t < this.duration; t += step) {
      g.fillRect(x(t), h - 6, 1, 6);
      g.fillText(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`, x(t) + 2, h - 2);
    }

    g.fillStyle = cssVar('--playhead');
    g.fillRect(x(this.playhead) - 1, 0, 2, h);
  }
}
