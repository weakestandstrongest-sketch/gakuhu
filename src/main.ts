import './style.css';
import { setupChordsTab } from './ui/chords-tab';
import { setupTransposeTab } from './ui/transpose-tab';
import { setupTranscribeTab } from './ui/transcribe-tab';

function setupTabs(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tabs button'));
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

setupTabs();
setupTranscribeTab();
setupTransposeTab();
setupChordsTab();
