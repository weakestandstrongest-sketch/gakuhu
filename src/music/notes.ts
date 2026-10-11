/** 音声から検出した音 (実音) */
export interface DetectedNote {
  id: number;
  /** 秒 */
  start: number;
  /** 秒 */
  duration: number;
  /** 実音の MIDI ノート番号 */
  midi: number;
  /** 0..1 */
  amplitude: number;
  /** ピアノロールでユーザーが除外した音 */
  excluded?: boolean;
}

/** 1拍 (4分音符) あたりの tick 数。8分=6, 16分=3, 3連8分=4 */
export const TICKS_PER_BEAT = 12;

/** 量子化済みの音 (tick 単位、実音) */
export interface QuantizedNote {
  start: number;
  end: number;
  midi: number;
}

export interface QuantizedScore {
  notes: QuantizedNote[];
  ticksPerMeasure: number;
  measureCount: number;
  /** 1小節目の開始時刻 (秒) — シンセ再生や表示用 */
  startTime: number;
}
