import { DetectedNote } from '../music/notes';
import { pitchName, spellMidi } from '../music/pitch';
import { cssVar } from './dom';

// 検出した音のピアノロール。クリックで音を除外/復活できる。
// 音名はテナー譜での音名 (実音 + 長2度) で表示する。

export interface Grid {
  bpm: number;
  downbeat: number;
  beatsPerMeasure: number;
}

const MAX_PX_PER_SEC = 120;
const ROW = 9;
const LABEL_W = 36;

export class PianoRoll {
  private notes: DetectedNote[] = [];
  private range = { start: 0, end: 1 };
  private grid: Grid | null = null;
  private writtenKeyFifths = 0;
  private pxPerSec = MAX_PX_PER_SEC;
  private readonly playheadEl: HTMLDivElement;
  private minMidi = 48;
  private maxMidi = 84;
  onToggle: (note: DetectedNote) => void = () => {};
  onSeek: (t: number) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    // 再生位置の線はキャンバスを描き直さずに動かせるよう別要素にする
    this.playheadEl = document.createElement('div');
    this.playheadEl.className = 'roll-playhead';
    canvas.parentElement!.appendChild(this.playheadEl);
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const t = this.timeAt(x);
      const midi = this.maxMidi - Math.floor(y / ROW);
      const hit = this.notes.find((n) => n.midi === midi && t >= n.start - 0.02 && t <= n.start + n.duration + 0.02);
      if (hit) {
        hit.excluded = !hit.excluded;
        this.onToggle(hit);
        this.draw();
      } else if (x > LABEL_W) {
        this.onSeek(t);
      }
    });
  }

  private timeAt(x: number): number {
    return this.range.start + (x - LABEL_W) / this.pxPerSec;
  }

  set(notes: DetectedNote[], range: { start: number; end: number }): void {
    this.notes = notes;
    this.range = range;
    // キャンバスの最大サイズを超えないよう、長い区間は横を縮める
    const dpr = window.devicePixelRatio || 1;
    this.pxPerSec = Math.min(MAX_PX_PER_SEC, (30000 / dpr - LABEL_W) / Math.max(1, range.end - range.start));
    const midis = notes.map((n) => n.midi);
    this.minMidi = Math.min(...midis, 60) - 2;
    this.maxMidi = Math.max(...midis, 72) + 2;
    this.draw();
  }

  setGrid(grid: Grid | null, writtenKeyFifths: number): void {
    this.grid = grid;
    this.writtenKeyFifths = writtenKeyFifths;
    this.draw();
  }

  setPlayhead(t: number): void {
    const visible = t >= this.range.start && t <= this.range.end;
    this.playheadEl.style.display = visible ? 'block' : 'none';
    if (visible) this.playheadEl.style.transform = `translateX(${LABEL_W + (t - this.range.start) * this.pxPerSec}px)`;
  }

  /** 再生位置が見えるようにスクロールする */
  follow(t: number): void {
    const wrap = this.canvas.parentElement!;
    const x = LABEL_W + (t - this.range.start) * this.pxPerSec;
    if (x < wrap.scrollLeft + LABEL_W || x > wrap.scrollLeft + wrap.clientWidth - 40) {
      wrap.scrollLeft = Math.max(0, x - wrap.clientWidth * 0.25);
    }
  }

  draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = LABEL_W + Math.max(1, this.range.end - this.range.start) * this.pxPerSec;
    const rows = this.maxMidi - this.minMidi + 1;
    const h = rows * ROW;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssVar('--roll-bg');
    g.fillRect(0, 0, w, h);
    const y = (midi: number) => (this.maxMidi - midi) * ROW;
    const x = (t: number) => LABEL_W + (t - this.range.start) * this.pxPerSec;

    // 横線 (黒鍵の行を少し暗く)
    for (let m = this.minMidi; m <= this.maxMidi; m++) {
      if ([1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)) {
        g.fillStyle = cssVar('--roll-grid');
        g.fillRect(LABEL_W, y(m), w, ROW);
      }
    }

    // 拍と小節の線
    if (this.grid) {
      const spb = 60 / this.grid.bpm;
      const first = Math.ceil((this.range.start - this.grid.downbeat) / spb);
      const last = Math.floor((this.range.end - this.grid.downbeat) / spb);
      for (let b = first; b <= last && last - first < 4000; b++) {
        const t = this.grid.downbeat + b * spb;
        const isBar = ((b % this.grid.beatsPerMeasure) + this.grid.beatsPerMeasure) % this.grid.beatsPerMeasure === 0;
        g.fillStyle = cssVar(isBar ? '--roll-bar' : '--roll-beat');
        g.fillRect(x(t), 0, isBar ? 2 : 1, h);
        if (isBar) {
          g.fillStyle = cssVar('--muted');
          g.font = '10px system-ui, sans-serif';
          g.fillText(String(Math.floor(b / this.grid.beatsPerMeasure) + 1), x(t) + 3, 10);
        }
      }
    }

    // 音
    g.font = 'bold 9px system-ui, sans-serif';
    for (const n of this.notes) {
      const nx = x(n.start);
      const nw = Math.max(3, n.duration * this.pxPerSec);
      g.globalAlpha = n.excluded ? 1 : 0.45 + 0.55 * Math.min(1, n.amplitude * 1.5);
      g.fillStyle = cssVar(n.excluded ? '--note-off' : '--note');
      g.fillRect(nx, y(n.midi) + 1, nw, ROW - 2);
      g.globalAlpha = 1;
      if (nw > 14 && !n.excluded) {
        g.fillStyle = '#fff';
        g.fillText(pitchName(spellMidi(n.midi + 2, this.writtenKeyFifths)), nx + 2, y(n.midi) + ROW - 2);
      }
    }

    // 左の音名 (テナー譜の C の位置)
    g.fillStyle = cssVar('--roll-bg');
    g.fillRect(0, 0, LABEL_W, h);
    g.fillStyle = cssVar('--muted');
    g.font = '10px system-ui, sans-serif';
    for (let m = this.minMidi; m <= this.maxMidi; m++) {
      const written = m + 14;
      if (((written % 12) + 12) % 12 === 0) {
        g.fillText(`C${Math.floor(written / 12) - 1}`, 4, y(m) + ROW - 1);
        g.fillRect(LABEL_W - 4, y(m) + ROW, 4, 1);
      }
    }
    this.playheadEl.style.height = `${h}px`;
  }
}
