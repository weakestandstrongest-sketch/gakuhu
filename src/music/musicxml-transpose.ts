import { AccidentalTracker } from './accidentals';
import { simplifyRoot } from './chords';
import {
  SOURCE_INSTRUMENTS,
  SourceInstrument,
  TENOR_CONCERT_TO_WRITTEN,
  TENOR_WRITTEN_RANGE,
  chooseOctaveShift,
  countOutOfRange,
  sourceInstrument,
} from './instruments';
import {
  Interval,
  Pitch,
  STEP_NAMES,
  UNISON,
  addIntervals,
  keyName,
  mod,
  octaves,
  pitchToMidi,
  transposeKey,
  transposePitch,
} from './pitch';

// MusicXML の楽譜をテナーサックス (in B♭) 用に移調する。
// DOM を直接書き換えるので、強弱記号・歌詞・アーティキュレーション等はそのまま残る。

export interface PartInfo {
  id: string;
  name: string;
  noteCount: number;
  /** <transpose> 要素から判定した元の楽器 (無ければ null = in C とみなす) */
  detectedSource: SourceInstrument | null;
}

export interface TransposeOptions {
  partIds: string[];
  /** 'auto' なら <transpose> 要素から判定し、無ければ in C とみなす */
  source: 'auto' | SourceInstrument;
  /** 標準 (実音+長9度) から何オクターブずらすか。'auto' ならテナーの音域に収まるよう自動で選ぶ */
  octave: 'auto' | number;
}

export interface TransposeResult {
  xml: string;
  /** 標準 (実音+長9度) から何オクターブずらしたか */
  octaveShift: number;
  autoOctaveShift: number;
  noteCount: number;
  outOfRange: number;
  concertKey: string | null;
  writtenKey: string | null;
  sourceLabel: string;
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('MusicXML として読み込めませんでした: ' + (err.textContent ?? '').slice(0, 200));
  const root = doc.documentElement.tagName;
  if (root === 'score-timewise') {
    throw new Error('score-timewise 形式には未対応です。MuseScore 等で開いて MusicXML として保存し直してください。');
  }
  if (root !== 'score-partwise') throw new Error('MusicXML (score-partwise) ではないファイルです。');
  return doc;
}

const children = (el: Element, tag: string): Element[] => Array.from(el.children).filter((c) => c.tagName === tag);
const child = (el: Element, tag: string): Element | undefined => Array.from(el.children).find((c) => c.tagName === tag);
const childText = (el: Element, tag: string): string | undefined => child(el, tag)?.textContent?.trim();
const childNum = (el: Element, tag: string, fallback = 0): number => {
  const t = childText(el, tag);
  const n = t === undefined ? NaN : Number(t);
  return Number.isFinite(n) ? n : fallback;
};

function readTranspose(el: Element): Interval {
  const oct = childNum(el, 'octave-change');
  return { steps: childNum(el, 'diatonic') + 7 * oct, semitones: childNum(el, 'chromatic') + 12 * oct };
}

function sourceFromInterval(iv: Interval): SourceInstrument {
  if (iv.semitones === -14 || iv.semitones === -26) return 'BbTenor';
  const pc = mod(iv.semitones, 12);
  if (pc === 10) return 'Bb';
  if (pc === 3) return 'Eb';
  if (pc === 5) return 'F';
  return 'C';
}

function readPitch(el: Element): Pitch {
  return {
    step: STEP_NAMES.indexOf(childText(el, 'step') as (typeof STEP_NAMES)[number]),
    alter: Math.round(childNum(el, 'alter')),
    octave: childNum(el, 'octave', 4),
  };
}

function setText(parent: Element, tag: string, value: string, before?: string[]): Element {
  let el = child(parent, tag);
  if (!el) {
    el = parent.ownerDocument.createElement(tag);
    const ref = before?.map((t) => child(parent, t)).find(Boolean);
    parent.insertBefore(el, ref ?? null);
  }
  el.textContent = value;
  return el;
}

function writePitch(el: Element, p: Pitch): void {
  setText(el, 'step', STEP_NAMES[p.step], ['alter', 'octave']);
  if (p.alter === 0) child(el, 'alter')?.remove();
  else setText(el, 'alter', String(p.alter), ['octave']);
  setText(el, 'octave', String(p.octave));
}

/** <note> 内で <accidental> を置くべき位置の後ろにある要素 */
const AFTER_ACCIDENTAL = ['time-modification', 'stem', 'notehead', 'notehead-text', 'staff', 'beam', 'notations', 'lyric', 'play', 'listen'];

function setAccidental(note: Element, name: string | null): void {
  child(note, 'accidental')?.remove();
  if (!name) return;
  setText(note, 'accidental', name, AFTER_ACCIDENTAL);
}

const TRANSPOSE_BEFORE = ['directive', 'measure-style'];
const CLEF_BEFORE = ['staff-details', 'transpose', 'for-part', 'directive', 'measure-style'];

function partName(doc: Document, id: string): string {
  const sp = Array.from(doc.getElementsByTagName('score-part')).find((e) => e.getAttribute('id') === id);
  return (sp && (childText(sp, 'part-name') || childText(sp, 'part-abbreviation'))) || id;
}

interface WalkState {
  srcInterval: Interval;
}

/**
 * パート内の要素を順番に辿る。<transpose> を読んで「記譜→実音」の音程を追跡する。
 * manual が指定されたら <transpose> は無視してその音程を使う。
 */
function walkPart(
  part: Element,
  manual: Interval | null,
  visit: (el: Element, state: WalkState, measureStart: boolean) => void,
): void {
  const state: WalkState = { srcInterval: manual ?? UNISON };
  for (const measure of children(part, 'measure')) {
    let first = true;
    for (const el of Array.from(measure.children)) {
      if (el.tagName === 'attributes' && !manual) {
        const tr = child(el, 'transpose');
        if (tr) state.srcInterval = readTranspose(tr);
      }
      visit(el, state, first);
      first = false;
    }
  }
}

const isPitchedNote = (el: Element) => el.tagName === 'note' && child(el, 'pitch') !== undefined;

export function listParts(doc: Document): PartInfo[] {
  return Array.from(doc.getElementsByTagName('part')).map((part) => {
    const id = part.getAttribute('id') ?? '';
    let noteCount = 0;
    const found: { src: SourceInstrument | null } = { src: null };
    walkPart(part, null, (el, state) => {
      if (isPitchedNote(el)) noteCount++;
      if (el.tagName === 'attributes' && child(el, 'transpose') && found.src === null) {
        found.src = sourceFromInterval(state.srcInterval);
      }
    });
    return { id, name: partName(doc, id), noteCount, detectedSource: found.src };
  });
}

export function transposeScoreForTenor(doc: Document, opts: TransposeOptions): TransposeResult {
  const selected = new Set(opts.partIds);
  const allParts = Array.from(doc.getElementsByTagName('part'));
  const parts = allParts.filter((p) => selected.has(p.getAttribute('id') ?? ''));
  if (parts.length === 0) throw new Error('パートが選択されていません。');
  const manual = opts.source === 'auto' ? null : sourceInstrument(opts.source).writtenToConcert;

  // 1回目: 実音を集めてオクターブを決める
  const standardWritten: number[] = [];
  const found: { src: SourceInstrument | null } = { src: null };
  for (const part of parts) {
    walkPart(part, manual, (el, state) => {
      if (el.tagName === 'attributes' && child(el, 'transpose') && found.src === null) found.src = sourceFromInterval(state.srcInterval);
      if (!isPitchedNote(el)) return;
      const concert = transposePitch(readPitch(child(el, 'pitch')!), state.srcInterval);
      standardWritten.push(pitchToMidi(concert) + TENOR_CONCERT_TO_WRITTEN.semitones);
    });
  }
  const autoShift = chooseOctaveShift(standardWritten);
  const shift = opts.octave === 'auto' ? autoShift : opts.octave;
  const concertToWritten = addIntervals(TENOR_CONCERT_TO_WRITTEN, octaves(shift));

  // 2回目: 書き換え
  let concertKey: string | null = null;
  let writtenKey: string | null = null;
  const writtenMidis: number[] = [];
  for (const part of parts) {
    let originalFifths = 0;
    let lastSrc: Interval | null = null;
    let respell = UNISON;
    let total = UNISON;
    const tracker = new AccidentalTracker(0);
    const recompute = (state: WalkState) => {
      total = addIntervals(state.srcInterval, concertToWritten);
      respell = transposeKey(originalFifths, total).respell;
      lastSrc = state.srcInterval;
    };

    walkPart(part, manual, (el, state, measureStart) => {
      if (measureStart) tracker.newMeasure();
      if (lastSrc !== state.srcInterval) recompute(state);

      if (el.tagName === 'attributes') {
        for (const key of children(el, 'key')) {
          if (!child(key, 'fifths')) continue;
          originalFifths = childNum(key, 'fifths');
          const t = transposeKey(originalFifths, total);
          respell = t.respell;
          setText(key, 'fifths', String(t.fifths));
          child(key, 'cancel')?.remove();
          tracker.setKey(t.fifths);
          if (concertKey === null) {
            const minor = childText(key, 'mode') === 'minor';
            concertKey = keyName(transposeKey(originalFifths, state.srcInterval).fifths, minor);
            writtenKey = keyName(t.fifths, minor);
          }
        }
        for (const clef of children(el, 'clef')) {
          const sign = childText(clef, 'sign');
          if (sign === 'percussion' || sign === 'TAB' || sign === 'jianpu' || sign === 'none') continue;
          setText(clef, 'sign', 'G');
          setText(clef, 'line', '2', ['clef-octave-change']);
          child(clef, 'clef-octave-change')?.remove();
        }
        for (const tr of children(el, 'transpose')) tr.remove();
      } else if (el.tagName === 'note') {
        const pitchEl = child(el, 'pitch');
        if (pitchEl) {
          const written = transposePitch(transposePitch(readPitch(pitchEl), total), respell);
          writePitch(pitchEl, written);
          writtenMidis.push(pitchToMidi(written));
          const tieStop = children(el, 'tie').some((t) => t.getAttribute('type') === 'stop');
          const staff = childNum(el, 'staff', 1);
          if (child(el, 'grace')) setAccidental(el, null);
          else setAccidental(el, tracker.next(written, staff, tieStop));
        }
        const rest = child(el, 'rest');
        if (rest) {
          child(rest, 'display-step')?.remove();
          child(rest, 'display-octave')?.remove();
        }
      } else if (el.tagName === 'harmony') {
        transposeHarmony(el, addIntervals(total, respell));
      }
    });

    addTenorTranspose(part, shift);
  }

  // 選ばれなかったパートを削除し、選んだパートの楽器名を変える
  for (const part of allParts) {
    const id = part.getAttribute('id') ?? '';
    const sp = Array.from(doc.getElementsByTagName('score-part')).find((e) => e.getAttribute('id') === id);
    if (!selected.has(id)) {
      part.remove();
      sp?.remove();
    } else if (sp) {
      renameScorePart(sp);
    }
  }

  const sourceLabel = opts.source === 'auto'
    ? (found.src ? SOURCE_INSTRUMENTS.find((s) => s.id === found.src)!.label + '（楽譜から自動判定）' : 'in C（移調楽器の指定が無いためコンサートキーとみなしました）')
    : sourceInstrument(opts.source).label;

  return {
    xml: new XMLSerializer().serializeToString(doc),
    octaveShift: shift,
    autoOctaveShift: autoShift,
    noteCount: writtenMidis.length,
    outOfRange: countOutOfRange(writtenMidis),
    concertKey,
    writtenKey,
    sourceLabel,
  };
}

function transposeHarmony(harmony: Element, iv: Interval): void {
  const fix = (container: Element | undefined, prefix: 'root' | 'bass') => {
    if (!container) return;
    const stepEl = child(container, `${prefix}-step`);
    if (!stepEl) return;
    const step = STEP_NAMES.indexOf(stepEl.textContent?.trim() as (typeof STEP_NAMES)[number]);
    if (step < 0) return;
    const alter = Math.round(childNum(container, `${prefix}-alter`));
    const p = transposePitch({ step, alter, octave: 4 }, iv);
    const n = Math.abs(p.alter) >= 2 ? simplifyRoot(p) : p;
    stepEl.textContent = STEP_NAMES[n.step];
    // 表示用テキストが元の音名のまま残らないようにする
    stepEl.removeAttribute('text');
    if (n.alter === 0) child(container, `${prefix}-alter`)?.remove();
    else setText(container, `${prefix}-alter`, String(n.alter));
  };
  fix(child(harmony, 'root'), 'root');
  fix(child(harmony, 'bass'), 'bass');
  child(harmony, 'frame')?.remove();
}

function addTenorTranspose(part: Element, shift: number): void {
  const doc = part.ownerDocument;
  const firstMeasure = child(part, 'measure');
  if (!firstMeasure) return;
  let attrs = child(firstMeasure, 'attributes');
  if (!attrs) {
    attrs = doc.createElement('attributes');
    const firstNote = Array.from(firstMeasure.children).find((c) => c.tagName !== 'print');
    firstMeasure.insertBefore(attrs, firstNote ?? null);
  }
  if (!child(attrs, 'clef')) {
    const clef = doc.createElement('clef');
    setText(clef, 'sign', 'G');
    setText(clef, 'line', '2');
    const ref = CLEF_BEFORE.map((t) => child(attrs!, t)).find(Boolean);
    attrs.insertBefore(clef, ref ?? null);
  }
  // 記譜音 = 実音 + 長9度 + shift オクターブ なので、実音 = 記譜音 - 長2度 - (1 + shift) オクターブ
  const tr = doc.createElement('transpose');
  setText(tr, 'diatonic', '-1');
  setText(tr, 'chromatic', '-2');
  if (-1 - shift !== 0) setText(tr, 'octave-change', String(-1 - shift));
  const ref = TRANSPOSE_BEFORE.map((t) => child(attrs!, t)).find(Boolean);
  attrs.insertBefore(tr, ref ?? null);
}

function renameScorePart(sp: Element): void {
  const name = childText(sp, 'part-name') ?? '';
  setText(sp, 'part-name', name ? `${name} (Tenor Sax in B♭)` : 'Tenor Sax in B♭');
  for (const inst of children(sp, 'score-instrument')) setText(inst, 'instrument-name', 'Tenor Saxophone');
  for (const midi of children(sp, 'midi-instrument')) {
    if (child(midi, 'midi-unpitched')) continue;
    setText(midi, 'midi-program', '67', ['volume', 'pan', 'elevation']);
  }
}

export { TENOR_WRITTEN_RANGE };
