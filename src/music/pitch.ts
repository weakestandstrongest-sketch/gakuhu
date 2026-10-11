// 音名・音程・調号の基礎ロジック。
// 音は「幹音(step) + 変化記号(alter) + オクターブ」で表し、
// 移調は「度数(steps) + 半音数(semitones)」の音程で行うことで、
// D♯ と E♭ のような異名同音を正しく書き分ける。

export const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

export interface Pitch {
  /** 0=C, 1=D, ... 6=B */
  step: number;
  /** -2..2 (♭♭, ♭, ♮, ♯, ♯♯) */
  alter: number;
  /** 科学的オクターブ表記 (中央C = C4) */
  octave: number;
}

export interface Interval {
  /** 度数 - 1 (0=1度, 1=2度, 8=9度)。負なら下行 */
  steps: number;
  semitones: number;
}

export const mod = (n: number, m: number): number => ((n % m) + m) % m;

export const UNISON: Interval = { steps: 0, semitones: 0 };
export const MAJOR_SECOND: Interval = { steps: 1, semitones: 2 };
export const MAJOR_NINTH: Interval = { steps: 8, semitones: 14 };
export const OCTAVE: Interval = { steps: 7, semitones: 12 };
/** 異名同音の書き換え (C♯→D♭ など) に使う減2度 */
export const DIMINISHED_SECOND: Interval = { steps: 1, semitones: 0 };

export function addIntervals(...ivs: Interval[]): Interval {
  return ivs.reduce((a, b) => ({ steps: a.steps + b.steps, semitones: a.semitones + b.semitones }), UNISON);
}

export function negate(iv: Interval): Interval {
  return { steps: -iv.steps, semitones: -iv.semitones };
}

export function octaves(n: number): Interval {
  return { steps: 7 * n, semitones: 12 * n };
}

export function pitchToMidi(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONES[p.step] + p.alter;
}

export function transposePitch(p: Pitch, iv: Interval): Pitch {
  const absStep = p.octave * 7 + p.step + iv.steps;
  const octave = Math.floor(absStep / 7);
  const step = mod(absStep, 7);
  const target = pitchToMidi(p) + iv.semitones;
  const natural = (octave + 1) * 12 + STEP_SEMITONES[step];
  return simplifyIfExtreme({ step, alter: target - natural, octave });
}

/** ♯♯♯ のような3重変化記号になった場合だけ、隣の幹音に書き換える */
function simplifyIfExtreme(p: Pitch): Pitch {
  if (Math.abs(p.alter) <= 2) return p;
  return transposePitch(p, p.alter > 0 ? DIMINISHED_SECOND : negate(DIMINISHED_SECOND));
}

/** 5度圏上の位置 (C=0, G=1, F=-1, F♯=6, B♭=-2 ...) */
export function lineOfFifths(step: number, alter: number): number {
  const base = [0, 2, 4, -1, 1, 3, 5][step];
  return base + 7 * alter;
}

export function fromLineOfFifths(pos: number): { step: number; alter: number } {
  // F C G D A E B の並びで 7 つごとに ♯ が 1 つ増える
  const order = [3, 0, 4, 1, 5, 2, 6];
  return { step: order[mod(pos + 1, 7)], alter: Math.floor((pos + 1) / 7) };
}

/** 音程を移調したとき調号がいくつ ♯ 方向に動くか (長2度 = +2) */
export function intervalFifths(iv: Interval): number {
  const p = transposePitch({ step: 0, alter: 0, octave: 4 }, iv);
  return lineOfFifths(p.step, p.alter);
}

/**
 * 調号を移調する。♯/♭ が 7 個を超える調 (D♯ メジャーなど) になったら
 * 異名同音 (E♭ メジャー) に書き換え、そのとき音符に追加で掛ける音程も返す。
 */
export function transposeKey(fifths: number, iv: Interval): { fifths: number; respell: Interval } {
  let f = fifths + intervalFifths(iv);
  let respell = UNISON;
  while (f > 6) {
    f -= 12;
    respell = addIntervals(respell, DIMINISHED_SECOND);
  }
  while (f < -6) {
    f += 12;
    respell = addIntervals(respell, negate(DIMINISHED_SECOND));
  }
  return { fifths: f, respell };
}

/**
 * MIDI ノート番号を調号に合わせて綴る。
 * 調の中心から5度圏で最も近い綴りを選ぶ (同距離なら ♭ を優先)。
 */
export function spellMidi(midi: number, keyFifths: number): Pitch {
  const pc = mod(midi, 12);
  const center = keyFifths + 2;
  // pc = 7*pos mod 12 を満たす pos は 7*pc mod 12 + 12m
  const base = mod(7 * pc, 12);
  let best = base;
  let bestDist = Infinity;
  for (let m = -2; m <= 2; m++) {
    const pos = base + 12 * m;
    const d = Math.abs(pos - center);
    if (d < bestDist || (d === bestDist && pos < best)) {
      best = pos;
      bestDist = d;
    }
  }
  const { step, alter } = fromLineOfFifths(best);
  const octave = Math.floor((midi - STEP_SEMITONES[step] - alter) / 12) - 1;
  return { step, alter, octave };
}

/** 調号で ♯/♭ が付いている幹音ごとの変化量 */
export function keyAlterations(fifths: number): number[] {
  const alters = [0, 0, 0, 0, 0, 0, 0];
  for (let pos = fifths - 1; pos <= fifths + 5; pos++) {
    const { step, alter } = fromLineOfFifths(pos);
    alters[step] = alter;
  }
  return alters;
}

const ACCIDENTAL_SYMBOLS: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };

export function pitchName(p: { step: number; alter: number }, ascii = false): string {
  if (ascii) return STEP_NAMES[p.step] + (p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter));
  return STEP_NAMES[p.step] + ACCIDENTAL_SYMBOLS[p.alter];
}

export function pitchNameWithOctave(p: Pitch): string {
  return pitchName(p) + p.octave;
}

export function keyName(fifths: number, minor = false): string {
  const tonic = fromLineOfFifths(minor ? fifths + 3 : fifths);
  return pitchName(tonic) + (minor ? 'm' : '');
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToMidi(f: number): number {
  return 69 + 12 * Math.log2(f / 440);
}
