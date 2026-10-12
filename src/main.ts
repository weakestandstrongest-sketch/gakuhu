import '@fontsource/playfair-display/latin-600-italic.css';
import '@fontsource/playfair-display/latin-700-italic.css';
import '@fontsource/playfair-display/latin-600.css';
import '@fontsource/zen-old-mincho/japanese-700.css';
import '@fontsource/zen-old-mincho/latin-700.css';
import './style.css';
import { isIOS, isTouch, preferPlaybackAudioSession } from './platform';
import { enhanceSegmented } from './ui/dom';
import { setupTransposeTab } from './ui/transpose-tab';
import { setupTranscribeTab } from './ui/transcribe-tab';

function setupTabs(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.modes button'));
  const show = (id: string) => {
    for (const b of buttons) {
      const active = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(active));
      document.getElementById(`tab-${b.dataset.tab}`)!.hidden = !active;
    }
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      show(b.dataset.tab!);
      history.replaceState(null, '', `#${b.dataset.tab}`);
    });
  }
  const initial = location.hash.slice(1);
  if (buttons.some((b) => b.dataset.tab === initial)) show(initial);
}

document.documentElement.classList.toggle('ios', isIOS);
document.documentElement.classList.toggle('touch', isTouch);
preferPlaybackAudioSession();

// ホーム画面に追加したときやオフラインでも動くよう、読み込んだファイルをキャッシュする
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service Worker の登録に失敗しました', e));
  });
}

setupTabs();
setupTranscribeTab();
setupTransposeTab();
document.querySelectorAll<HTMLSelectElement>('select[data-seg]').forEach(enhanceSegmented);

// 起動できたことを index.html の見張り役に知らせる
(window as Window & { __gakuhuReady?: boolean }).__gakuhuReady = true;
