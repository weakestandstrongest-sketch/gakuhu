import { Pitch, keyAlterations } from './pitch';

// 小節内で臨時記号を表示すべきかを決める。
// 調号と、同じ小節で直前に出た同じ高さの音の変化記号を覚えておく。

export type AccidentalName = 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'flat-flat';

const NAMES: Record<number, AccidentalName> = {
  [-2]: 'flat-flat',
  [-1]: 'flat',
  0: 'natural',
  1: 'sharp',
  2: 'double-sharp',
};

export class AccidentalTracker {
  private keyAlters: number[];
  private current = new Map<string, number>();

  constructor(keyFifths: number) {
    this.keyAlters = keyAlterations(keyFifths);
  }

  setKey(keyFifths: number): void {
    this.keyAlters = keyAlterations(keyFifths);
    this.current.clear();
  }

  newMeasure(): void {
    this.current.clear();
  }

  /**
   * 表示すべき臨時記号 (不要なら null)。
   * タイで繋がった後ろの音は表示せず、状態も更新しない
   * (小節をまたいだタイの後に同じ音が出たら改めて臨時記号を付けるため)。
   */
  next(p: Pitch, staff = 1, tieStop = false): AccidentalName | null {
    if (tieStop) return null;
    const id = `${staff}:${p.step}:${p.octave}`;
    const prev = this.current.has(id) ? this.current.get(id)! : this.keyAlters[p.step];
    this.current.set(id, p.alter);
    return prev === p.alter ? null : NAMES[p.alter] ?? null;
  }
}
