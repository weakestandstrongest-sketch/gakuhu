import { AccidentalTracker } from './accidentals';
import { QuantizedScore, TICKS_PER_BEAT } from './notes';
import { STEP_NAMES, spellMidi } from './pitch';

// 量子化した音から、テナーサックス用 (in B♭) の MusicXML を書き出す。

export interface WriteOptions {
  title: string;
  bpm: number;
  beatsPerMeasure: number;
  /** テナー譜の調号 */
  writtenKeyFifths: number;
  /** 標準 (実音+長9度) から何オクターブずらすか */
  octaveShift: number;
  swing: boolean;
  /** 何小節ごとに改段するか (0 なら自動) */
  measuresPerSystem: number;
}

interface Segment {
  start: number;
  end: number;
  /** 記譜音の MIDI、休符なら null */
  midi: number | null;
  tieStop: boolean;
  tieStart: boolean;
}

interface Piece {
  dur: number;
  midi: number | null;
  tieStop: boolean;
  tieStart: boolean;
  type: string;
  dots: number;
  triplet: boolean;
  tuplet?: 'start' | 'stop';
}

const REGULAR_TYPES: Record<number, [string, number]> = {
  48: ['whole', 0],
  36: ['half', 1],
  24: ['half', 0],
  18: ['quarter', 1],
  12: ['quarter', 0],
  9: ['eighth', 1],
  6: ['eighth', 0],
  3: ['16th', 0],
};
const REGULAR_DURATIONS = [48, 36, 24, 18, 12, 9, 6, 3];
const B = TICKS_PER_BEAT;

const sameBeat = (a: number, b: number) => Math.floor(a / B) === Math.floor((b - 1) / B);

/** 小節内の位置 p から長さ d の音符/休符を1つの記号で書いてよいか */
export function allowedDuration(p: number, d: number, isRest: boolean, tpm: number): boolean {
  const onBeat = p % B === 0;
  const crossesMiddle = tpm === 48 && p < 24 && p + d > 24;
  switch (d) {
    case 48:
      return p === 0 && tpm === 48;
    case 36:
      return p === 0 || (!isRest && p === 12);
    case 24:
      return onBeat && (!isRest || tpm !== 48 || p % 24 === 0);
    case 18:
      return isRest ? onBeat && !crossesMiddle : p % 6 === 0;
    case 12:
      return isRest ? onBeat : p % 6 === 0;
    case 9:
    case 6:
      return p % 3 === 0 && sameBeat(p, p + d);
    case 3:
      return true;
    default:
      return false;
  }
}

function decomposeRegular(p: number, len: number, isRest: boolean, tpm: number): number[] {
  const out: number[] = [];
  while (len > 0) {
    const d = REGULAR_DURATIONS.find((d) => d <= len && allowedDuration(p, d, isRest, tpm)) ?? len;
    out.push(d);
    p += d;
    len -= d;
  }
  return out;
}

function decomposeTriplet(a: number, len: number): number[] {
  const out: number[] = [];
  while (len > 0) {
    const d = (a % B === 0 || a % B === 4) && len >= 8 ? 8 : Math.min(4, len);
    out.push(d);
    a += d;
    len -= d;
  }
  return out;
}

function typeOf(d: number, triplet: boolean): [string, number] {
  if (triplet) return d >= 8 ? ['quarter', 0] : ['eighth', 0];
  if (REGULAR_TYPES[d]) return REGULAR_TYPES[d];
  // 想定外の長さ (通常は起きない) は近い音価で表示する
  const near = REGULAR_DURATIONS.find((x) => x <= d) ?? 3;
  return REGULAR_TYPES[near];
}

/** 1小節分の音を、楽譜に書ける音符・休符の並びにする */
export function layoutMeasure(segments: Segment[], tpm: number): Piece[] {
  // 3連で書く拍: 区切りが拍の 1/3, 2/3 の位置にある拍
  const tripletBeats = new Set<number>();
  for (const s of segments) {
    for (const t of [s.start, s.end]) {
      if (t % B === 4 || t % B === 8) tripletBeats.add(Math.floor(t / B));
    }
  }

  const pieces: Piece[] = [];
  for (const seg of segments) {
    // 3連の拍の境目で区切る
    const cuts = new Set<number>([seg.start, seg.end]);
    for (const b of tripletBeats) {
      for (const c of [b * B, (b + 1) * B]) if (c > seg.start && c < seg.end) cuts.add(c);
    }
    const points = [...cuts].sort((a, b) => a - b);
    const durs: { d: number; triplet: boolean }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const s = points[i];
      const len = points[i + 1] - s;
      const triplet = tripletBeats.has(Math.floor(s / B));
      const parts = triplet ? decomposeTriplet(s % B, len) : decomposeRegular(s, len, seg.midi === null, tpm);
      for (const d of parts) durs.push({ d, triplet });
    }
    durs.forEach(({ d, triplet }, i) => {
      const [type, dots] = typeOf(d, triplet);
      pieces.push({
        dur: d,
        midi: seg.midi,
        tieStop: seg.midi !== null && (i > 0 || seg.tieStop),
        tieStart: seg.midi !== null && (i < durs.length - 1 || seg.tieStart),
        type,
        dots,
        triplet,
      });
    });
  }

  // 3連のカッコ (拍ごと)
  let pos = 0;
  let current: Piece[] = [];
  let currentBeat = -1;
  const flush = () => {
    if (current.length > 0) {
      current[0].tuplet = 'start';
      current[current.length - 1].tuplet = current.length > 1 ? 'stop' : undefined;
    }
    current = [];
  };
  for (const p of pieces) {
    const beat = Math.floor(pos / B);
    if (p.triplet) {
      if (beat !== currentBeat) flush();
      currentBeat = beat;
      current.push(p);
    } else {
      flush();
      currentBeat = -1;
    }
    pos += p.dur;
  }
  flush();
  return pieces;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function writeTenorMusicXml(score: QuantizedScore, opts: WriteOptions): string {
  const tpm = score.ticksPerMeasure;
  const concertToWritten = 14 + 12 * opts.octaveShift;
  const tracker = new AccidentalTracker(opts.writtenKeyFifths);
  const measures: string[] = [];

  for (let m = 0; m < score.measureCount; m++) {
    const mStart = m * tpm;
    const mEnd = mStart + tpm;
    const segments: Segment[] = [];
    let cursor = 0;
    for (const n of score.notes) {
      if (n.end <= mStart || n.start >= mEnd) continue;
      const s = Math.max(n.start, mStart) - mStart;
      const e = Math.min(n.end, mEnd) - mStart;
      if (s > cursor) segments.push({ start: cursor, end: s, midi: null, tieStart: false, tieStop: false });
      segments.push({ start: s, end: e, midi: n.midi + concertToWritten, tieStop: n.start < mStart, tieStart: n.end > mEnd });
      cursor = e;
    }
    if (cursor < tpm) segments.push({ start: cursor, end: tpm, midi: null, tieStart: false, tieStop: false });

    tracker.newMeasure();
    const body: string[] = [];
    if (m === 0) body.push(firstMeasureHeader(opts));
    if (m > 0 && opts.measuresPerSystem > 0 && m % opts.measuresPerSystem === 0) body.push('<print new-system="yes"/>');

    if (segments.length === 1 && segments[0].midi === null) {
      body.push(`<note><rest measure="yes"/><duration>${tpm}</duration><voice>1</voice></note>`);
    } else {
      for (const p of layoutMeasure(segments, tpm)) body.push(noteXml(p, opts.writtenKeyFifths, tracker));
    }
    if (m === score.measureCount - 1) body.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
    measures.push(`<measure number="${m + 1}">${body.join('')}</measure>`);
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${esc(opts.title)}</work-title></work>
<identification><encoding><software>gakuhu</software></encoding></identification>
<part-list><score-part id="P1"><part-name>Tenor Sax in B♭</part-name><score-instrument id="P1-I1"><instrument-name>Tenor Saxophone</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>67</midi-program></midi-instrument></score-part></part-list>
<part id="P1">${measures.join('\n')}</part>
</score-partwise>`;
}

function firstMeasureHeader(opts: WriteOptions): string {
  const octaveChange = -1 - opts.octaveShift;
  const transpose = `<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic>${octaveChange !== 0 ? `<octave-change>${octaveChange}</octave-change>` : ''}</transpose>`;
  const attrs = `<attributes><divisions>${B}</divisions><key><fifths>${opts.writtenKeyFifths}</fifths></key><time><beats>${opts.beatsPerMeasure}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>${transpose}</attributes>`;
  const bpm = Math.round(opts.bpm);
  const tempo = `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type>${opts.swing ? '<direction-type><words>Swing</words></direction-type>' : ''}<sound tempo="${bpm}"/></direction>`;
  return attrs + tempo;
}

function noteXml(p: Piece, keyFifths: number, tracker: AccidentalTracker): string {
  const parts: string[] = ['<note>'];
  let accidental: string | null = null;
  if (p.midi === null) {
    parts.push('<rest/>');
  } else {
    const pitch = spellMidi(p.midi, keyFifths);
    accidental = tracker.next(pitch, 1, p.tieStop);
    parts.push(
      `<pitch><step>${STEP_NAMES[pitch.step]}</step>${pitch.alter !== 0 ? `<alter>${pitch.alter}</alter>` : ''}<octave>${pitch.octave}</octave></pitch>`,
    );
  }
  parts.push(`<duration>${p.dur}</duration>`);
  if (p.tieStop) parts.push('<tie type="stop"/>');
  if (p.tieStart) parts.push('<tie type="start"/>');
  parts.push('<voice>1</voice>', `<type>${p.type}</type>`, '<dot/>'.repeat(p.dots));
  if (accidental) parts.push(`<accidental>${accidental}</accidental>`);
  if (p.triplet) parts.push('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
  const notations: string[] = [];
  if (p.tieStop) notations.push('<tied type="stop"/>');
  if (p.tieStart) notations.push('<tied type="start"/>');
  if (p.tuplet) notations.push(`<tuplet type="${p.tuplet}"${p.tuplet === 'start' ? ' bracket="yes"' : ''}/>`);
  if (notations.length) parts.push(`<notations>${notations.join('')}</notations>`);
  parts.push('</note>');
  return parts.join('');
}
