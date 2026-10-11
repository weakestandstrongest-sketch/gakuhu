import { decodeAudio, renderMono } from '../audio/load';
import { Player } from '../audio/player';
import { Recorder, canCaptureTab } from '../audio/record';
import { NoteSynth, SynthNote } from '../audio/synth';
import { detectTempo, transcribeMonophonic, transcribePolyphonic } from '../audio/transcribe';
import { KeyEstimate, estimateKey, extractMelody } from '../music/analysis';
import { TENOR_CONCERT_TO_WRITTEN, chooseOctaveShift, countOutOfRange } from '../music/instruments';
import { writeTenorMusicXml } from '../music/musicxml-write';
import { DetectedNote, QuantizedScore, TICKS_PER_BEAT } from '../music/notes';
import { keyName, transposeKey } from '../music/pitch';
import { Subdivision, quantize } from '../music/quantize';
import { $, debounce, download, formatTime, printScore, safeFileName, setStatus } from './dom';
import { PianoRoll } from './pianoroll';
import { ScoreView } from './score-view';
import { WaveformView } from './waveform';

interface RangePreset {
  id: string;
  label: string;
  min: number;
  max: number;
}

// 実音の音域 (MIDI)
const RANGE_PRESETS: RangePreset[] = [
  { id: 'tenor', label: 'テナーサックス', min: 44, max: 81 },
  { id: 'alto', label: 'アルトサックス', min: 49, max: 84 },
  { id: 'trumpet', label: 'トランペット', min: 52, max: 86 },
  { id: 'trombone', label: 'トロンボーン', min: 38, max: 74 },
  { id: 'voice', label: 'ボーカル', min: 43, max: 81 },
  { id: 'piano', label: 'ピアノ・ギター等（広め）', min: 40, max: 96 },
  { id: 'bass', label: 'ベース', min: 28, max: 62 },
];

/** 長調の主音ごとの調号 (コンサートキー選択肢用) */
const KEY_CHOICES = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5];

export function setupTranscribeTab(): void {
  const player = new Player();
  const recorder = new Recorder();
  const synth = new NoteSynth();
  const waveform = new WaveformView($<HTMLCanvasElement>('waveform'));
  const roll = new PianoRoll($<HTMLCanvasElement>('pianoroll'));
  const scoreView = new ScoreView($('score-transcribe'));

  const el = {
    file: $<HTMLInputElement>('audio-file'),
    recTab: $<HTMLButtonElement>('rec-tab'),
    recMic: $<HTMLButtonElement>('rec-mic'),
    recStatus: $('rec-status'),
    playerCard: $('player-card'),
    analyzeCard: $('analyze-card'),
    resultCard: $('result-card'),
    play: $<HTMLButtonElement>('play'),
    speed: $<HTMLInputElement>('speed'),
    speedVal: $('speed-val'),
    loop: $<HTMLInputElement>('loop'),
    time: $('time'),
    selInfo: $('sel-info'),
    clearSel: $<HTMLButtonElement>('clear-sel'),
    engine: $<HTMLSelectElement>('engine'),
    rangePreset: $<HTMLSelectElement>('range-preset'),
    sensitivity: $<HTMLInputElement>('sensitivity'),
    analyze: $<HTMLButtonElement>('analyze'),
    progress: $<HTMLProgressElement>('analyze-progress'),
    analyzeStatus: $('analyze-status'),
    bpm: $<HTMLInputElement>('bpm'),
    bpmHalf: $<HTMLButtonElement>('bpm-half'),
    bpmDouble: $<HTMLButtonElement>('bpm-double'),
    bpmTap: $<HTMLButtonElement>('bpm-tap'),
    bpmDetect: $<HTMLButtonElement>('bpm-detect'),
    downbeat: $<HTMLInputElement>('downbeat'),
    downbeatHere: $<HTMLButtonElement>('downbeat-here'),
    meter: $<HTMLSelectElement>('meter'),
    subdivision: $<HTMLSelectElement>('subdivision'),
    swing: $<HTMLInputElement>('swing'),
    swingVal: $('swing-val'),
    key: $<HTMLSelectElement>('key'),
    octave: $<HTMLSelectElement>('octave'),
    title: $<HTMLInputElement>('title'),
    legato: $<HTMLInputElement>('legato'),
    synthPlay: $<HTMLButtonElement>('synth-play'),
    download: $<HTMLButtonElement>('dl-transcribe'),
    print: $<HTMLButtonElement>('print-transcribe'),
    info: $('transcribe-info'),
  };

  for (const p of RANGE_PRESETS) el.rangePreset.add(new Option(p.label, p.id));

  let buffer: AudioBuffer | null = null;
  let selection: { start: number; end: number } | null = null;
  let notes: DetectedNote[] = [];
  let analyzedRange = { start: 0, end: 0 };
  let analyzedSamples: Float32Array | null = null;
  let detectedKey: KeyEstimate = { fifths: 0, minor: false };
  let quantized: QuantizedScore | null = null;
  let lastXml = '';
  let tapTimes: number[] = [];

  // ---------- 音源の読み込み ----------
  async function loadAudio(blob: Blob, name: string) {
    setStatus(el.recStatus, '読み込み中…');
    try {
      buffer = await decodeAudio(blob);
    } catch (e) {
      setStatus(el.recStatus, (e as Error).message, true);
      return;
    }
    player.load(blob);
    player.setRate(Number(el.speed.value));
    el.playerCard.hidden = false;
    el.analyzeCard.hidden = false;
    el.resultCard.hidden = true;
    waveform.setBuffer(buffer);
    setSelection(null);
    notes = [];
    lastXml = '';
    scoreView.clear();
    el.title.value = name.replace(/\.[^.]+$/, '');
    setStatus(el.recStatus, `「${name}」を読み込みました（${formatTime(buffer.duration)}）`);
  }

  el.file.addEventListener('change', () => {
    const f = el.file.files?.[0];
    if (f) void loadAudio(f, f.name);
    el.file.value = '';
  });

  if (!canCaptureTab()) el.recTab.hidden = true;

  async function toggleRecording(kind: 'tab' | 'mic') {
    const btn = kind === 'tab' ? el.recTab : el.recMic;
    if (recorder.recording) {
      const blob = await recorder.stop();
      finishRecording(blob);
      return;
    }
    try {
      if (kind === 'tab') await recorder.startTab();
      else await recorder.startMic();
    } catch (e) {
      const err = e as Error;
      if (err.name !== 'NotAllowedError') setStatus(el.recStatus, err.message, true);
      return;
    }
    btn.classList.add('recording');
    btn.textContent = '⏹ 録音を止める';
    (kind === 'tab' ? el.recMic : el.recTab).disabled = true;
    setStatus(el.recStatus, kind === 'tab' ? '録音中… 共有したタブで曲を再生し、終わったらここで「録音を止める」を押してください。' : '録音中…');
  }

  function finishRecording(blob: Blob) {
    el.recTab.classList.remove('recording');
    el.recMic.classList.remove('recording');
    el.recTab.textContent = '🖥️ 他のタブの音を録音（YouTube など）';
    el.recMic.textContent = '🎙️ マイクで録音';
    el.recTab.disabled = false;
    el.recMic.disabled = false;
    if (blob.size === 0) {
      setStatus(el.recStatus, '録音できませんでした。', true);
      return;
    }
    const stamp = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    void loadAudio(blob, `録音 ${stamp}`);
  }
  recorder.onAutoStop = finishRecording;
  el.recTab.addEventListener('click', () => void toggleRecording('tab'));
  el.recMic.addEventListener('click', () => void toggleRecording('mic'));

  // ---------- 再生 ----------
  player.onStateChange = (playing) => {
    el.play.textContent = playing ? '⏸ 停止' : '▶ 再生';
  };
  player.onTick = (t) => {
    waveform.setPlayhead(t);
    roll.setPlayhead(t);
    if (player.playing) roll.follow(t);
    el.time.textContent = `${formatTime(t)} / ${formatTime(buffer?.duration ?? 0)}`;
  };
  el.play.addEventListener('click', () => player.toggle());
  el.speed.addEventListener('input', () => {
    player.setRate(Number(el.speed.value));
    el.speedVal.textContent = `${Math.round(Number(el.speed.value) * 100)}%`;
  });
  el.loop.addEventListener('change', () => {
    player.loop = el.loop.checked ? selection : null;
  });
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (e.code !== 'Space' || !buffer || $('tab-transcribe').hidden) return;
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;
    e.preventDefault();
    player.toggle();
  });

  function setSelection(sel: { start: number; end: number } | null) {
    selection = sel && sel.end - sel.start > 0.2 ? sel : null;
    waveform.setSelection(selection);
    player.loop = el.loop.checked ? selection : null;
    el.clearSel.hidden = !selection;
    el.selInfo.textContent = selection
      ? `選択範囲: ${formatTime(selection.start)} 〜 ${formatTime(selection.end)}（${(selection.end - selection.start).toFixed(1)}秒）`
      : '範囲が選ばれていません（解析は全体が対象）';
    if (selection) player.seek(selection.start);
  }
  waveform.onSelect = setSelection;
  waveform.onSeek = (t) => player.seek(t);
  el.clearSel.addEventListener('click', () => setSelection(null));
  roll.onSeek = (t) => player.seek(t);

  // ---------- 解析 ----------
  el.analyze.addEventListener('click', () => void analyze());

  async function analyze() {
    if (!buffer) return;
    const range = selection ?? { start: 0, end: buffer.duration };
    const preset = RANGE_PRESETS.find((p) => p.id === el.rangePreset.value)!;
    const opts = { minMidi: preset.min, maxMidi: preset.max, sensitivity: Number(el.sensitivity.value) };
    el.analyze.disabled = true;
    el.progress.hidden = false;
    el.progress.value = 0;
    setStatus(el.analyzeStatus, '準備中…');
    try {
      const samples = await renderMono(buffer, range.start, range.end);
      let found: DetectedNote[];
      if (el.engine.value === 'poly') {
        const all = await transcribePolyphonic(samples, opts, (p, stage) => {
          el.progress.value = p;
          setStatus(el.analyzeStatus, `${stage} ${Math.round(p * 100)}%`);
        });
        found = extractMelody(all, { minMidi: preset.min, maxMidi: preset.max });
      } else {
        setStatus(el.analyzeStatus, '解析中…');
        found = await transcribeMonophonic(samples, opts, (p) => (el.progress.value = p));
      }
      notes = found.map((n, i) => ({ ...n, id: i, start: n.start + range.start }));
      analyzedRange = range;
      analyzedSamples = samples;
      if (notes.length === 0) {
        setStatus(el.analyzeStatus, '音が見つかりませんでした。感度を上げるか、音域の設定を変えてみてください。', true);
        return;
      }
      setStatus(el.analyzeStatus, `${notes.length} 個の音が見つかりました。`);

      detectedKey = estimateKey(notes);
      el.key.options[0].text = `自動（推定: ${keyName(detectedKey.fifths, false)} / ${keyName(detectedKey.fifths, true)}）`;
      await detectBpm(false);
      el.resultCard.hidden = false;
      roll.set(notes, range);
      regenerate();
      el.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      console.error(e);
      setStatus(el.analyzeStatus, `解析に失敗しました: ${(e as Error).message}`, true);
    } finally {
      el.analyze.disabled = false;
      el.progress.hidden = true;
    }
  }

  async function detectBpm(userRequested: boolean) {
    if (!analyzedSamples) return;
    el.bpmDetect.disabled = true;
    try {
      const tempo = await detectTempo(analyzedSamples);
      if (!tempo) {
        if (userRequested) alert('テンポを推定できませんでした。タップで入力してください。');
        return;
      }
      const spb = 60 / tempo.bpm;
      // 最初の音の直前 (またはちょうど) の拍を1拍目にする
      const firstBeat = analyzedRange.start + tempo.firstBeat;
      const firstNote = notes.find((n) => !n.excluded)?.start ?? firstBeat;
      const k = Math.floor((firstNote - firstBeat) / spb + 0.25);
      el.bpm.value = String(Math.round(tempo.bpm));
      el.downbeat.value = (firstBeat + k * spb).toFixed(2);
      if (userRequested) regenerate();
    } finally {
      el.bpmDetect.disabled = false;
    }
  }

  // ---------- 楽譜にする ----------
  function readSettings() {
    const bpm = Math.min(400, Math.max(30, Number(el.bpm.value) || 120));
    const beatsPerMeasure = Number(el.meter.value);
    const swing = Number(el.swing.value);
    const concertFifths = el.key.value === 'auto' ? detectedKey.fifths : Number(el.key.value);
    const writtenFifths = transposeKey(concertFifths, TENOR_CONCERT_TO_WRITTEN).fifths;
    return {
      bpm,
      downbeat: Number(el.downbeat.value) || 0,
      beatsPerMeasure,
      subdivision: el.subdivision.value as Subdivision,
      swing,
      legato: el.legato.checked,
      concertFifths,
      writtenFifths,
      octave: el.octave.value,
      title: el.title.value.trim() || 'Untitled',
    };
  }

  function updateSwingLabel() {
    const swing = Number(el.swing.value);
    el.swingVal.textContent = swing <= 0.51 ? 'イーブン（スウィングなし）' : `${Math.round(swing * 100)}%${swing >= 0.65 ? '（3連っぽい）' : ''}`;
  }
  el.swing.addEventListener('input', updateSwingLabel);
  updateSwingLabel();

  function regenerate() {
    if (notes.length === 0) return;
    const s = readSettings();
    roll.setGrid({ bpm: s.bpm, downbeat: s.downbeat, beatsPerMeasure: s.beatsPerMeasure }, s.writtenFifths);

    quantized = quantize(notes, s);
    const active = notes.filter((n) => !n.excluded);
    const octaveShift = s.octave === 'auto' ? chooseOctaveShift(active.map((n) => n.midi + 14)) : Number(s.octave);
    lastXml = writeTenorMusicXml(quantized, {
      title: s.title,
      bpm: s.bpm,
      beatsPerMeasure: s.beatsPerMeasure,
      writtenKeyFifths: s.writtenFifths,
      octaveShift,
      swing: s.swing > 0.52,
      measuresPerSystem: 4,
    });
    const out = countOutOfRange(quantized.notes.map((n) => n.midi + 14 + 12 * octaveShift));
    const minor = el.key.value === 'auto' && detectedKey.minor;
    el.info.textContent =
      `コンサートキー ${keyName(s.concertFifths, minor)} → テナー譜 ${keyName(s.writtenFifths, minor)}` +
      (el.key.value === 'auto' ? '（推定。違っていたら「調」で選び直してください）' : '') +
      ` ／ ${quantized.measureCount} 小節・${quantized.notes.length} 音` +
      (octaveShift !== 0 ? ` ／ 標準より${Math.abs(octaveShift)}オクターブ${octaveShift > 0 ? '上' : '下'}で表示` : '') +
      (out > 0 ? ` ／ ⚠ テナーの通常音域外の音が ${out} 個あります（オクターブ設定を変えてみてください）` : '');
    scoreView.render(lastXml).catch((e) => setStatus(el.info, `楽譜の表示に失敗しました: ${(e as Error).message}`, true));
  }
  const regenerateSoon = debounce(regenerate, 250);

  for (const input of [el.bpm, el.downbeat, el.meter, el.subdivision, el.swing, el.key, el.octave, el.title, el.legato]) {
    input.addEventListener(input instanceof HTMLInputElement && input.type !== 'checkbox' ? 'input' : 'change', regenerateSoon);
  }
  el.key.add(new Option('自動', 'auto'));
  for (const f of KEY_CHOICES) el.key.add(new Option(`${keyName(f)} / ${keyName(f, true)}（テナー譜: ${keyName(transposeKey(f, TENOR_CONCERT_TO_WRITTEN).fifths)}）`, String(f)));

  roll.onToggle = () => regenerateSoon();

  el.bpmHalf.addEventListener('click', () => {
    el.bpm.value = String(Math.round(Number(el.bpm.value) / 2));
    regenerate();
  });
  el.bpmDouble.addEventListener('click', () => {
    el.bpm.value = String(Math.round(Number(el.bpm.value) * 2));
    regenerate();
  });
  el.bpmTap.addEventListener('click', () => {
    const now = performance.now();
    if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
    tapTimes.push(now);
    if (tapTimes.length >= 3) {
      const intervals = tapTimes.slice(1).map((t, i) => t - tapTimes[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      el.bpm.value = String(Math.round(60000 / avg));
      regenerateSoon();
    }
  });
  el.bpmDetect.addEventListener('click', () => void detectBpm(true));
  el.downbeatHere.addEventListener('click', () => {
    el.downbeat.value = player.currentTime.toFixed(2);
    regenerate();
  });

  // ---------- 出力 ----------
  el.synthPlay.addEventListener('click', () => {
    if (synth.playing) {
      synth.stop();
      el.synthPlay.textContent = '♪ 楽譜を音で確認';
      return;
    }
    if (!quantized) return;
    const s = readSettings();
    const secPerTick = 60 / s.bpm / TICKS_PER_BEAT;
    const toSec = (tick: number) => {
      // 8分の裏拍などはスウィングして鳴らす
      const beat = Math.floor(tick / TICKS_PER_BEAT);
      const frac = (tick % TICKS_PER_BEAT) / TICKS_PER_BEAT;
      const swung = tick % 3 === 0 && s.swing > 0.5 ? (frac < 0.5 ? (frac / 0.5) * s.swing : s.swing + ((frac - 0.5) / 0.5) * (1 - s.swing)) : frac;
      return (beat + swung) * TICKS_PER_BEAT * secPerTick;
    };
    const events: SynthNote[] = quantized.notes.map((n) => ({ time: toSec(n.start), duration: toSec(n.end) - toSec(n.start) - 0.02, midi: n.midi }));
    player.pause();
    el.synthPlay.textContent = '⏹ 止める';
    synth.play(events, () => (el.synthPlay.textContent = '♪ 楽譜を音で確認'));
  });

  el.download.addEventListener('click', () => {
    if (lastXml) download(lastXml, `${safeFileName(readSettings().title)}_tenor.musicxml`);
  });
  el.print.addEventListener('click', () => printScore($('score-transcribe'), readSettings().title));

  setSelection(null);
}
