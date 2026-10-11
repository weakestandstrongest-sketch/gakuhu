import { transposeChordText } from '../music/chords';
import { SOURCE_INSTRUMENTS, SourceInstrument, TENOR_CONCERT_TO_WRITTEN, sourceInstrument } from '../music/instruments';
import { MAJOR_SECOND, addIntervals, fromLineOfFifths, keyName, pitchName, transposeKey, transposePitch } from '../music/pitch';
import { $ } from './dom';

export function setupChordsTab(): void {
  const input = $<HTMLTextAreaElement>('chord-in');
  const output = $<HTMLTextAreaElement>('chord-out');
  const source = $<HTMLSelectElement>('chord-source');
  const copy = $<HTMLButtonElement>('chord-copy');

  for (const s of SOURCE_INSTRUMENTS) source.add(new Option(s.label, s.id));

  const update = () => {
    const iv = addIntervals(sourceInstrument(source.value as SourceInstrument).writtenToConcert, TENOR_CONCERT_TO_WRITTEN);
    output.value = transposeChordText(input.value, iv);
  };
  input.addEventListener('input', update);
  source.addEventListener('change', update);

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      copy.textContent = '✅ コピーしました';
    } catch {
      output.select();
      document.execCommand('copy');
      copy.textContent = '✅ コピーしました';
    }
    setTimeout(() => (copy.textContent = '📋 コピー'), 1500);
  });

  renderCheatsheet($('cheatsheet'));
}

function renderCheatsheet(container: HTMLElement): void {
  // 調: ジャズでよく使う ♭ 系から並べる
  const keys = [0, -1, -2, -3, -4, -5, -6, 1, 2, 3, 4, 5];
  const keyRow = keys.map((f) => `<td>${keyName(f)}</td>`).join('');
  const tenorKeyRow = keys.map((f) => `<td><strong>${keyName(transposeKey(f, TENOR_CONCERT_TO_WRITTEN).fifths)}</strong></td>`).join('');

  // 音名: 半音ずつ (よく使う綴り)
  const notes = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5].map((pos) => fromLineOfFifths(pos));
  notes.sort((a, b) => [0, 2, 4, 5, 7, 9, 11][a.step] + a.alter - ([0, 2, 4, 5, 7, 9, 11][b.step] + b.alter));
  const noteRow = notes.map((n) => `<td>${pitchName(n)}</td>`).join('');
  const tenorNoteRow = notes
    .map((n) => {
      const t = transposePitch({ ...n, octave: 4 }, MAJOR_SECOND);
      return `<td><strong>${pitchName(t)}</strong></td>`;
    })
    .join('');

  container.innerHTML = `
    <table>
      <tr><th>コンサートキー (in C)</th>${keyRow}</tr>
      <tr><th>テナーで読む調</th>${tenorKeyRow}</tr>
    </table>
    <br />
    <table>
      <tr><th>実音 (in C の音名)</th>${noteRow}</tr>
      <tr><th>テナーで読む音名</th>${tenorNoteRow}</tr>
    </table>
    <p class="small muted">例: ピアノ譜で「F」の音は、テナーでは「G」の運指で吹くと同じ音になります（実際には1オクターブと長2度＝長9度低い音が出ます）。</p>`;
}
