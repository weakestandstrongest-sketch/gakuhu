import { midiToFrequency } from '../music/pitch';
import { audioContext } from './load';

// 書き起こした楽譜を音で確認するための簡単なシンセ

export interface SynthNote {
  /** 再生開始からの秒 */
  time: number;
  duration: number;
  /** 実音 */
  midi: number;
}

export class NoteSynth {
  private nodes: AudioScheduledSourceNode[] = [];
  private timer = 0;

  play(notes: SynthNote[], onEnd: () => void): void {
    this.stop();
    const ctx = audioContext();
    const t0 = ctx.currentTime + 0.1;
    const out = ctx.createGain();
    out.gain.value = 0.25;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2500;
    filter.connect(out).connect(ctx.destination);

    let end = 0;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToFrequency(n.midi);
      const g = ctx.createGain();
      const s = t0 + n.time;
      const e = s + Math.max(0.05, n.duration);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.5, s + 0.02);
      g.gain.setValueAtTime(0.4, e - 0.03);
      g.gain.linearRampToValueAtTime(0, e);
      osc.connect(g).connect(filter);
      osc.start(s);
      osc.stop(e + 0.01);
      this.nodes.push(osc);
      end = Math.max(end, n.time + n.duration);
    }
    this.timer = window.setTimeout(() => {
      this.nodes = [];
      onEnd();
    }, (end + 0.2) * 1000);
  }

  stop(): void {
    clearTimeout(this.timer);
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        // まだ開始前のノードなど
      }
    }
    this.nodes = [];
  }

  get playing(): boolean {
    return this.nodes.length > 0;
  }
}
