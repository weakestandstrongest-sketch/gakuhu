import { Interval, MAJOR_NINTH, UNISON, negate } from './pitch';

export type SourceInstrument = 'C' | 'Bb' | 'Eb' | 'F' | 'BbTenor';

export interface SourceInstrumentInfo {
  id: SourceInstrument;
  label: string;
  /** 記譜音 → 実音 の音程 */
  writtenToConcert: Interval;
}

export const SOURCE_INSTRUMENTS: SourceInstrumentInfo[] = [
  { id: 'C', label: 'in C（コンサートキー / ピアノ・ギター・ボーカル・フルート等）', writtenToConcert: UNISON },
  { id: 'Bb', label: 'in B♭（トランペット・クラリネット・ソプラノサックス）', writtenToConcert: { steps: -1, semitones: -2 } },
  { id: 'Eb', label: 'in E♭（アルトサックス・バリトンサックス）', writtenToConcert: { steps: -5, semitones: -9 } },
  { id: 'F', label: 'in F（ホルン）', writtenToConcert: { steps: -4, semitones: -7 } },
  { id: 'BbTenor', label: 'in B♭ テナー（すでにテナー譜）', writtenToConcert: negate(MAJOR_NINTH) },
];

export function sourceInstrument(id: SourceInstrument): SourceInstrumentInfo {
  return SOURCE_INSTRUMENTS.find((s) => s.id === id)!;
}

/** テナーサックスの記譜音 = 実音 + 長9度 */
export const TENOR_CONCERT_TO_WRITTEN = MAJOR_NINTH;

/** テナーサックスの通常音域 (記譜音): B♭3 〜 F♯6 */
export const TENOR_WRITTEN_RANGE = { low: 58, high: 90 };
/** 記譜上いちばん読みやすい中心 (D5 あたり) */
const COMFORT_CENTER = 74;

export function countOutOfRange(writtenMidis: number[]): number {
  return writtenMidis.filter((m) => m < TENOR_WRITTEN_RANGE.low || m > TENOR_WRITTEN_RANGE.high).length;
}

/**
 * 標準の移調 (実音+長9度) を基準に、何オクターブずらすとテナーで吹きやすいかを選ぶ。
 * 音域外の音が最少になるものを選び、同数なら中央値が中心に近いもの、
 * それも同じなら標準 (0) に近いものを選ぶ。
 */
export function chooseOctaveShift(writtenMidisAtStandard: number[]): number {
  if (writtenMidisAtStandard.length === 0) return 0;
  const sorted = [...writtenMidisAtStandard].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let best = 0;
  let bestScore: [number, number, number] = [Infinity, Infinity, Infinity];
  for (const k of [0, -1, 1, -2, 2]) {
    const shifted = writtenMidisAtStandard.map((m) => m + 12 * k);
    const score: [number, number, number] = [countOutOfRange(shifted), Math.abs(median + 12 * k - COMFORT_CENTER), Math.abs(k)];
    if (
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))
    ) {
      best = k;
      bestScore = score;
    }
  }
  return best;
}
