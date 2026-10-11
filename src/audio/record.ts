// マイク録音と、ブラウザのタブ (YouTube など) の音の録音

export function canCaptureTab(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function' && !/Android|iPhone|iPad/i.test(navigator.userAgent);
}

function pickMimeType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private done: ((b: Blob) => void) | null = null;
  /** ユーザーがブラウザ側で共有を止めたときなど */
  onAutoStop: (blob: Blob) => void = () => {};

  get recording(): boolean {
    return this.recorder !== null;
  }

  async startMic(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.begin(stream, stream);
  }

  async startTab(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome 向けのヒント: タブを選びやすくし、このタブ自体は候補から外す
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      systemAudio: 'include',
    } as DisplayMediaStreamOptions);
    const audio = stream.getAudioTracks();
    if (audio.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('音声が共有されませんでした。共有するタブを選ぶ画面で「タブの音声も共有する」をオンにしてください。');
    }
    this.begin(new MediaStream(audio), stream);
  }

  private begin(audioStream: MediaStream, fullStream: MediaStream): void {
    this.stream = fullStream;
    this.chunks = [];
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.recorder = null;
      if (this.done) this.done(blob);
      else this.onAutoStop(blob);
      this.done = null;
    };
    for (const t of fullStream.getTracks()) t.addEventListener('ended', () => this.recorder?.state === 'recording' && this.recorder.stop());
    rec.start(1000);
    this.recorder = rec;
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      if (!this.recorder) return resolve(new Blob());
      this.done = resolve;
      this.recorder.stop();
    });
  }
}
