import { DetectedNote } from '../music/notes';
import { pitchName, spellMidi } from '../music/pitch';
import { isTouch } from '../platform';
import { cssVar } from './dom';

// 検出した音のピアノロール。クリックで音を除外/復活できる。
// 音名はテナー譜での音名 (実音 + 長2度) で表示する。

export interface Grid {
  bpm: number;
  downbeat: number;
  beatsPerMeasure: number;
}

const MAX_PX_PER_SEC = 120;
/** 1半音の行の高さ。指で操作する端末ではタップしやすいよう大きくする */
const ROW = isTouch ? 15 : 9;
const LABEL_W = 46;
/** iPhone の Safari はキャンバスの面積が約1677万ピクセルまでなので、それより小さく抑える */
const MAX_CANVAS_PIXELS = 16_000_000;

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
      // 指だとずれやすいので、時間方向に少し余裕を持たせ、ちょうどの行が無ければ上下1行も探す
      const slack = isTouch ? 0.08 : 0.02;
      const inTime = (n: DetectedNote) => t >= n.start - slack && t <= n.start + n.duration + slack;
      const hit =
        this.notes.find((n) => n.midi === midi && inTime(n)) ??
        (isTouch ? this.notes.find((n) => Math.abs(n.midi - midi) === 1 && inTime(n)) : undefined);
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
    this.pxPerSec = Math.min(MAX_PX_PER_SEC, (16000 - LABEL_W) / Math.max(1, range.end - range.start));
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
    const w = LABEL_W + Math.max(1, this.range.end - this.range.start) * this.pxPerSec;
    const rows = this.maxMidi - this.minMidi + 1;
    const h = rows * ROW;
    const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));
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

    // 鍵盤の白黒は、表示している音名 (テナー譜 = 実音 + 長2度) に合わせる
    const isBlack = (m: number) => [1, 3, 6, 8, 10].includes((((m + 2) % 12) + 12) % 12);

    // 黒鍵の行を少し暗く
    g.fillStyle = cssVar('--roll-grid');
    for (let m = this.minMidi; m <= this.maxMidi; m++) {
      if (isBlack(m)) g.fillRect(LABEL_W, y(m), w, ROW);
    }

    // 拍と小節の線
    if (this.grid) {
      const spb = 60 / this.grid.bpm;
      const first = Math.ceil((this.range.start - this.grid.downbeat) / spb);
      const last = Math.floor((this.range.end - this.grid.downbeat) / spb);
      const beatColor = cssVar('--roll-beat');
      const barColor = cssVar('--roll-bar');
      g.font = 'italic 600 11px "Playfair Display", Georgia, serif';
      for (let b = first; b <= last && last - first < 4000; b++) {
        const t = this.grid.downbeat + b * spb;
        const isBar = ((b % this.grid.beatsPerMeasure) + this.grid.beatsPerMeasure) % this.grid.beatsPerMeasure === 0;
        g.fillStyle = isBar ? barColor : beatColor;
        g.fillRect(x(t), 0, 1, h);
        if (isBar) g.fillText(String(Math.floor(b / this.grid.beatsPerMeasure) + 1), x(t) + 4, 12);
      }
    }

    // 音 (金色のバー。音の強さで明るさを変える)
    const note = cssVar('--note');
    const noteHi = cssVar('--note-hi');
    const noteOff = cssVar('--note-off');
    g.font = '600 9px -apple-system, system-ui, sans-serif';
    for (const n of this.notes) {
      const nx = x(n.start);
      const nw = Math.max(4, n.duration * this.pxPerSec - 1);
      const ny = y(n.midi) + 1.5;
      const nh = ROW - 3;
      if (n.excluded) {
        g.fillStyle = noteOff;
        g.globalAlpha = 1;
      } else {
        const grad = g.createLinearGradient(0, ny, 0, ny + nh);
        grad.addColorStop(0, noteHi);
        grad.addColorStop(1, note);
        g.fillStyle = grad;
        g.globalAlpha = 0.55 + 0.45 * Math.min(1, n.amplitude * 1.5);
        g.shadowColor = note;
        g.shadowBlur = 6;
      }
      g.beginPath();
      if (g.roundRect) g.roundRect(nx, ny, nw, nh, Math.min(3, nh / 2));
      else g.rect(nx, ny, nw, nh);
      g.fill();
      g.shadowBlur = 0;
      g.globalAlpha = 1;
      if (nw > 16 && !n.excluded) {
        g.fillStyle = '#241a08';
        g.fillText(pitchName(spellMidi(n.midi + 2, this.writtenKeyFifths)), nx + 3, ny + nh - 2);
      }
    }

    // 左端の鍵盤
    const white = cssVar('--key-white');
    const black = cssVar('--key-black');
    g.fillStyle = white;
    g.fillRect(0, 0, LABEL_W, h);
    for (let m = this.minMidi; m <= this.maxMidi; m++) {
      const written = m + 14;
      const pc = ((written % 12) + 12) % 12;
      if (isBlack(m)) {
        g.fillStyle = black;
        g.beginPath();
        if (g.roundRect) g.roundRect(0, y(m) + 1, LABEL_W * 0.62, ROW - 2, [0, 3, 3, 0]);
        else g.rect(0, y(m) + 1, LABEL_W * 0.62, ROW - 2);
        g.fill();
      } else if (pc === 0 || pc === 5) {
        // C と F の下 (B-C, E-F の間) に鍵盤の切れ目
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(0, y(m) + ROW - 0.5, LABEL_W, 1);
      }
      if (pc === 0) {
        g.fillStyle = cssVar('--key-label');
        g.font = '600 9px -apple-system, system-ui, sans-serif';
        g.fillText(`C${Math.floor(written / 12) - 1}`, LABEL_W - 20, y(m) + ROW - 2);
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(LABEL_W - 1, 0, 1, h);
    this.playheadEl.style.height = `${h}px`;
  }
}
