// 耳コピ用プレーヤー: 音程を変えずにスロー再生、A-B ループ

export class Player {
  readonly audio = new Audio();
  private url: string | null = null;
  private raf = 0;
  loop: { start: number; end: number } | null = null;
  onTick: (time: number) => void = () => {};
  onStateChange: (playing: boolean) => void = () => {};

  constructor() {
    const a = this.audio as HTMLAudioElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
    a.preservesPitch = true;
    a.webkitPreservesPitch = true;
    a.mozPreservesPitch = true;
    this.audio.addEventListener('play', () => {
      this.onStateChange(true);
      this.tick();
    });
    this.audio.addEventListener('pause', () => {
      cancelAnimationFrame(this.raf);
      this.onStateChange(false);
      this.onTick(this.audio.currentTime);
    });
    this.audio.addEventListener('seeked', () => this.onTick(this.audio.currentTime));
  }

  load(blob: Blob): void {
    this.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.audio.src = this.url;
    this.loop = null;
  }

  get playing(): boolean {
    return !this.audio.paused;
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }

  play(): void {
    if (this.loop && (this.audio.currentTime < this.loop.start || this.audio.currentTime >= this.loop.end)) {
      this.audio.currentTime = this.loop.start;
    }
    void this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    this.audio.currentTime = Math.max(0, t);
  }

  setRate(rate: number): void {
    this.audio.playbackRate = rate;
  }

  private tick = () => {
    const t = this.audio.currentTime;
    if (this.loop && t >= this.loop.end) this.audio.currentTime = this.loop.start;
    this.onTick(this.audio.currentTime);
    if (this.playing) this.raf = requestAnimationFrame(this.tick);
  };
}
