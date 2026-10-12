import { BeatMap } from '../music/beats';
import { DetectedNote } from '../music/notes';
import { pitchName, spellMidi } from '../music/pitch';
import { isTouch } from '../platform';
import { cssVar } from './dom';

// 検出した音のピアノロール。
// - 音をタップ/クリックで選択 (選んだ音はツールバーで高さ・位置・長さを直せる)
// - マウスなら、音をドラッグして移動、右端をドラッグして長さを変えられる
// 音名はテナー譜での音名 (実音 + 長2度) で表示する。

export interface Grid {
  beatsPerMeasure: number;
  /** 拍の位置 (テンポの揺れに追従したもの、または等間隔) */
  beats: BeatMap;
  /** 1小節目の1拍目が beats の何拍目か */
  origin: number;
}

const MAX_PX_PER_SEC = 120;
/** 1半音の行の高さ。指で操作する端末ではタップしやすいよう大きくする */
const ROW = isTouch ? 15 : 9;
const LABEL_W = 46;
/** iPhone の Safari はキャンバスの面積が約1677万ピクセルまでなので、それより小さく抑える */
const MAX_CANVAS_PIXELS = 16_000_000;
/** 右端から何 px 以内をつかむと長さを変えるか */
const RESIZE_EDGE = 7;

type Drag = { note: DetectedNote; mode: 'move' | 'resize'; x0: number; y0: number; start0: number; dur0: number; midi0: number; moved: boolean };

export class PianoRoll {
  private notes: DetectedNote[] = [];
  private range = { start: 0, end: 1 };
  private grid: Grid | null = null;
  private writtenKeyFifths = 0;
  private pxPerSec = MAX_PX_PER_SEC;
  private readonly playheadEl: HTMLDivElement;
  private minMidi = 48;
  private maxMidi = 84;
  private drag: Drag | null = null;
  selected: DetectedNote | null = null;
  onSelect: (note: DetectedNote | null) => void = () => {};
  /** マウスのドラッグで音を変える直前 (元に戻す用) */
  onBeforeChange: () => void = () => {};
  onChange: (note: DetectedNote) => void = () => {};
  onSeek: (t: number) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    // 再生位置の線はキャンバスを描き直さずに動かせるよう別要素にする
    this.playheadEl = document.createElement('div');
    this.playheadEl.className = 'roll-playhead';
    canvas.parentElement!.appendChild(this.playheadEl);

    canvas.addEventListener('pointerdown', (e) => {
      const { x, y } = this.local(e);
      const hit = this.hitTest(x, y);
      if (e.pointerType === 'mouse' && hit) {
        // マウスはドラッグで編集できる
        const right = this.xOf(hit.start + hit.duration);
        this.drag = {
          note: hit,
          mode: right - x <= RESIZE_EDGE ? 'resize' : 'move',
          x0: x,
          y0: y,
          start0: hit.start,
          dur0: hit.duration,
          midi0: hit.midi,
          moved: false,
        };
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const { x, y } = this.local(e);
      if (!this.drag) {
        if (e.pointerType === 'mouse') {
          const hit = this.hitTest(x, y);
          canvas.style.cursor = hit ? (this.xOf(hit.start + hit.duration) - x <= RESIZE_EDGE ? 'ew-resize' : 'grab') : 'pointer';
        }
        return;
      }
      const d = this.drag;
      const dx = (x - d.x0) / this.pxPerSec;
      const dRows = Math.round((d.y0 - y) / ROW);
      if (!d.moved && Math.abs(x - d.x0) < 3 && Math.abs(y - d.y0) < 3) return;
      if (!d.moved) this.onBeforeChange();
      d.moved = true;
      if (d.mode === 'resize') {
        d.note.duration = Math.max(0.03, d.dur0 + dx);
      } else {
        d.note.start = Math.max(this.range.start, d.start0 + dx);
        d.note.midi = d.midi0 + dRows;
      }
      this.selected = d.note;
      this.draw();
    });
    canvas.addEventListener('pointerup', () => {
      const d = this.drag;
      this.drag = null;
      if (d?.moved) {
        // ドラッグのあとに来る click では選択を切り替えない
        this.suppressClick = true;
        this.onChange(d.note);
        this.onSelect(d.note);
      }
    });
    canvas.addEventListener('click', (e) => {
      const { x, y } = this.local(e);
      if (this.suppressClick) {
        this.suppressClick = false;
        return;
      }
      const hit = this.hitTest(x, y);
      if (hit) {
        this.select(hit === this.selected ? null : hit);
      } else if (x > LABEL_W) {
        this.select(null);
        this.onSeek(this.timeAt(x));
      }
    });
  }

  private suppressClick = false;

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private xOf(t: number): number {
    return LABEL_W + (t - this.range.start) * this.pxPerSec;
  }

  private timeAt(x: number): number {
    return this.range.start + (x - LABEL_W) / this.pxPerSec;
  }

  private hitTest(x: number, y: number): DetectedNote | undefined {
    const t = this.timeAt(x);
    const midi = this.maxMidi - Math.floor(y / ROW);
    // 指だとずれやすいので、時間方向に少し余裕を持たせ、ちょうどの行が無ければ上下1行も探す
    const slack = isTouch ? 0.08 : 0.02;
    const inTime = (n: DetectedNote) => t >= n.start - slack && t <= n.start + n.duration + slack;
    return this.notes.find((n) => n.midi === midi && inTime(n)) ?? (isTouch ? this.notes.find((n) => Math.abs(n.midi - midi) === 1 && inTime(n)) : undefined);
  }

  select(note: DetectedNote | null): void {
    this.selected = note;
    this.draw();
    this.onSelect(note);
    if (note) this.reveal(note.start);
  }

  set(notes: DetectedNote[], range: { start: number; end: number }): void {
    this.notes = notes;
    this.range = range;
    this.selected = null;
    // キャンバスの最大サイズを超えないよう、長い区間は横を縮める
    this.pxPerSec = Math.min(MAX_PX_PER_SEC, (16000 - LABEL_W) / Math.max(1, range.end - range.start));
    this.draw();
  }

  /** 音を追加・削除したあとなど、配列ごと差し替える */
  replaceNotes(notes: DetectedNote[], selected: DetectedNote | null): void {
    this.notes = notes;
    this.selected = selected;
    this.draw();
  }

  get timeRange(): { start: number; end: number } {
    return this.range;
  }

  setGrid(grid: Grid | null, writtenKeyFifths: number): void {
    this.grid = grid;
    this.writtenKeyFifths = writtenKeyFifths;
    this.draw();
  }

  setPlayhead(t: number): void {
    const visible = t >= this.range.start && t <= this.range.end;
    this.playheadEl.style.display = visible ? 'block' : 'none';
    if (visible) this.playheadEl.style.transform = `translateX(${this.xOf(t)}px)`;
  }

  /** 再生位置が見えるようにスクロールする */
  follow(t: number): void {
    this.reveal(t);
  }

  private reveal(t: number): void {
    const wrap = this.canvas.parentElement!;
    const x = this.xOf(t);
    if (x < wrap.scrollLeft + LABEL_W || x > wrap.scrollLeft + wrap.clientWidth - 40) {
      wrap.scrollLeft = Math.max(0, x - wrap.clientWidth * 0.25);
    }
  }

  draw(): void {
    // 編集で音域の外に出ても見えるよう、毎回表示範囲を決め直す
    const midis = this.notes.map((n) => n.midi);
    this.minMidi = Math.min(...midis, 60) - 2;
    this.maxMidi = Math.max(...midis, 72) + 2;

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
    const x = (t: number) => this.xOf(t);

    // 鍵盤の白黒は、表示している音名 (テナー譜 = 実音 + 長2度) に合わせる
    const isBlack = (m: number) => [1, 3, 6, 8, 10].includes((((m + 2) % 12) + 12) % 12);

    // 黒鍵の行を少し暗く
    g.fillStyle = cssVar('--roll-grid');
    for (let m = this.minMidi; m <= this.maxMidi; m++) {
      if (isBlack(m)) g.fillRect(LABEL_W, y(m), w, ROW);
    }

    // 拍と小節の線 (テンポの揺れに追従した位置)
    if (this.grid) {
      const { beats, origin, beatsPerMeasure } = this.grid;
      const first = Math.ceil(beats.toBeats(this.range.start));
      const last = Math.floor(beats.toBeats(this.range.end));
      const beatColor = cssVar('--roll-beat');
      const barColor = cssVar('--roll-bar');
      g.font = 'italic 600 11px "Playfair Display", Georgia, serif';
      for (let b = first; b <= last && last - first < 4000; b++) {
        const t = beats.toTime(b);
        const rel = b - origin;
        const isBar = ((rel % beatsPerMeasure) + beatsPerMeasure) % beatsPerMeasure === 0;
        g.fillStyle = isBar ? barColor : beatColor;
        g.fillRect(x(t), 0, 1, h);
        if (isBar) g.fillText(String(Math.floor(rel / beatsPerMeasure) + 1), x(t) + 4, 12);
      }
    }

    // 音 (金色のバー。音の強さで明るさを変える。選んだ音は青く縁取る)
    const note = cssVar('--note');
    const noteHi = cssVar('--note-hi');
    const noteOff = cssVar('--note-off');
    const blue = cssVar('--playhead');
    g.font = '600 9px -apple-system, system-ui, sans-serif';
    for (const n of this.notes) {
      const nx = x(n.start);
      const nw = Math.max(4, n.duration * this.pxPerSec - 1);
      const ny = y(n.midi) + 1.5;
      const nh = ROW - 3;
      const isSel = n === this.selected;
      if (n.excluded) {
        g.fillStyle = noteOff;
        g.globalAlpha = 1;
      } else {
        const grad = g.createLinearGradient(0, ny, 0, ny + nh);
        grad.addColorStop(0, noteHi);
        grad.addColorStop(1, note);
        g.fillStyle = grad;
        g.globalAlpha = isSel ? 1 : 0.55 + 0.45 * Math.min(1, n.amplitude * 1.5);
        g.shadowColor = isSel ? blue : note;
        g.shadowBlur = isSel ? 12 : 6;
      }
      g.beginPath();
      if (g.roundRect) g.roundRect(nx, ny, nw, nh, Math.min(3, nh / 2));
      else g.rect(nx, ny, nw, nh);
      g.fill();
      g.shadowBlur = 0;
      g.globalAlpha = 1;
      if (isSel) {
        g.strokeStyle = blue;
        g.lineWidth = 2;
        g.stroke();
      }
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
