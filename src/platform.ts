// 端末ごとの違いを吸収するための判定

/** iPhone / iPad (iPadOS は Mac のふりをするのでタッチ対応かどうかでも判定) */
export const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 指で操作する端末か (マウスが無い) */
export const isTouch = window.matchMedia('(pointer: coarse)').matches;

/**
 * iPhone ではマナーモード (消音スイッチ) にすると Web Audio の音が消えるので、
 * 再生用の音声セッションにして鳴るようにする (Safari 16.4+)
 */
export function preferPlaybackAudioSession(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) {
    try {
      nav.audioSession.type = 'playback';
    } catch {
      // 未対応のブラウザでは何もしない
    }
  }
}
