let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const buf = await blob.arrayBuffer();
  try {
    return await audioContext().decodeAudioData(buf);
  } catch {
    throw new Error('この音声ファイルは読み込めませんでした。mp3 / m4a / wav / mp4 などを試してください。');
  }
}

/** 解析用に、指定区間をモノラル・指定サンプルレートに変換する */
export async function renderMono(buffer: AudioBuffer, start: number, end: number, sampleRate = 22050): Promise<Float32Array> {
  const s = Math.max(0, start);
  const e = Math.min(buffer.duration, end);
  const length = Math.max(1, Math.ceil((e - s) * sampleRate));
  const offline = new OfflineAudioContext(1, length, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0, s, e - s);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** 波形表示用に、区間ごとの最大振幅を求める */
export function computePeaks(buffer: AudioBuffer, columns: number): Float32Array {
  const peaks = new Float32Array(columns);
  const ch = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const per = Math.max(1, Math.floor(buffer.length / columns));
  for (let c = 0; c < columns; c++) {
    let max = 0;
    const from = c * per;
    const to = Math.min(buffer.length, from + per);
    for (const data of ch) {
      for (let i = from; i < to; i += 4) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
    }
    peaks[c] = max;
  }
  return peaks;
}
