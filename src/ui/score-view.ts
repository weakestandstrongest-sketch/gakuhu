import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

// 楽譜の表示 (OpenSheetMusicDisplay)。ライブラリは最初に使うときに読み込む。
// OSMD の autoResize はタブが非表示でも描き直してしまうので、
// 表示中に幅が変わったときだけ自前で描き直す。

export class ScoreView {
  private osmd: Promise<OpenSheetMusicDisplay> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private loaded = false;
  private lastWidth = 0;

  constructor(private readonly container: HTMLElement) {
    new ResizeObserver(() => {
      const w = container.clientWidth;
      if (!this.loaded || w === 0 || Math.abs(w - this.lastWidth) < 2) return;
      this.enqueue(async (osmd) => osmd.render());
    }).observe(container);
  }

  private instance(): Promise<OpenSheetMusicDisplay> {
    if (!this.osmd) {
      this.osmd = import('opensheetmusicdisplay').then(
        ({ OpenSheetMusicDisplay }) =>
          new OpenSheetMusicDisplay(this.container, {
            autoResize: false,
            backend: 'svg',
            drawTitle: true,
            drawSubtitle: false,
            drawComposer: false,
            drawLyricist: false,
            drawCredits: false,
            drawPartNames: false,
            autoBeam: true,
            newSystemFromXML: true,
            drawMetronomeMarks: true,
          }),
      );
    }
    return this.osmd;
  }

  /** 描画要求を順番に処理する (前の描画が失敗しても次は実行する) */
  private enqueue(job: (osmd: OpenSheetMusicDisplay) => Promise<void> | void): Promise<void> {
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const osmd = await this.instance();
        await job(osmd);
        this.lastWidth = this.container.clientWidth;
      });
    return this.queue;
  }

  render(xml: string): Promise<void> {
    return this.enqueue(async (osmd) => {
      await osmd.load(xml);
      this.loaded = true;
      osmd.render();
    });
  }

  clear(): void {
    this.loaded = false;
    if (!this.osmd) return;
    void this.enqueue((osmd) => osmd.clear());
  }
}
