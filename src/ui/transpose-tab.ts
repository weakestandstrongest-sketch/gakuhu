import { SOURCE_INSTRUMENTS, SourceInstrument } from '../music/instruments';
import { readScoreFile } from '../music/load-score';
import { PartInfo, listParts, parseXml, transposeScoreForTenor } from '../music/musicxml-transpose';
import { isIOS } from '../platform';
import { $, download, printScore, safeFileName, setStatus } from './dom';
import { ScoreView } from './score-view';

export function setupTransposeTab(): void {
  const el = {
    file: $<HTMLInputElement>('score-file'),
    status: $('score-status'),
    options: $('transpose-options'),
    parts: $('parts'),
    source: $<HTMLSelectElement>('source'),
    octave: $<HTMLSelectElement>('transpose-octave'),
    download: $<HTMLButtonElement>('dl-transpose'),
    print: $<HTMLButtonElement>('print-transpose'),
    info: $('transpose-info'),
  };
  const view = new ScoreView($('score-transpose'));
  for (const s of SOURCE_INSTRUMENTS) el.source.add(new Option(s.label, s.id));
  // iPhone は .musicxml / .mxl の種類を知らないため、accept を付けるとファイルが選べなくなる
  if (isIOS) el.file.removeAttribute('accept');

  let originalXml = '';
  let fileName = '';
  let parts: PartInfo[] = [];
  let result = '';

  el.file.addEventListener('change', async () => {
    const f = el.file.files?.[0];
    el.file.value = '';
    if (!f) return;
    try {
      originalXml = await readScoreFile(f);
      parts = listParts(parseXml(originalXml));
    } catch (e) {
      setStatus(el.status, (e as Error).message, true);
      el.options.hidden = true;
      return;
    }
    fileName = f.name.replace(/\.[^.]+$/, '');
    if (parts.length === 0) {
      setStatus(el.status, 'パートが見つかりませんでした。', true);
      return;
    }
    setStatus(el.status, `「${f.name}」を読み込みました（${parts.length} パート）`);
    renderPartList();
    el.options.hidden = false;
    update();
  });

  function renderPartList() {
    el.parts.innerHTML = '';
    // 最初はメロディらしいパート (1つ目の音符があるパート) だけを選ぶ
    const firstWithNotes = parts.find((p) => p.noteCount > 0)?.id ?? parts[0].id;
    for (const p of parts) {
      const label = document.createElement('label');
      label.className = 'toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = p.id;
      cb.checked = p.id === firstWithNotes;
      cb.addEventListener('change', update);
      const ui = document.createElement('span');
      ui.className = 'toggle-ui';
      const text = document.createElement('span');
      text.textContent = `${p.name}（${p.noteCount} 音）`;
      label.append(cb, ui, text);
      el.parts.appendChild(label);
    }
  }

  function selectedParts(): string[] {
    return Array.from(el.parts.querySelectorAll<HTMLInputElement>('input:checked')).map((c) => c.value);
  }

  function update() {
    if (!originalXml) return;
    const ids = selectedParts();
    if (ids.length === 0) {
      setStatus(el.info, 'パートを1つ以上選んでください。', true);
      view.clear();
      result = '';
      return;
    }
    try {
      // 毎回元の楽譜から移調し直す
      const doc = parseXml(originalXml);
      const octave = el.octave.value === 'auto' ? 'auto' : Number(el.octave.value);
      const r = transposeScoreForTenor(doc, { partIds: ids, source: el.source.value as 'auto' | SourceInstrument, octave });
      result = r.xml;
      const shiftText = r.octaveShift === 0 ? '実音の長9度上' : r.octaveShift === -1 ? '実音の長2度上（Real Book の B♭版と同じ高さ）' : `標準から${r.octaveShift}オクターブ`;
      setStatus(
        el.info,
        `元の楽譜: ${r.sourceLabel}` +
          (r.concertKey ? ` ／ コンサートキー ${r.concertKey} → テナー譜 ${r.writtenKey}` : '') +
          ` ／ ${shiftText}` +
          (r.outOfRange > 0 ? ` ／ ⚠ テナーの通常音域外の音が ${r.outOfRange} 個あります` : ''),
      );
      view.render(result).catch((e) => setStatus(el.info, `楽譜の表示に失敗しました: ${(e as Error).message}`, true));
    } catch (e) {
      setStatus(el.info, (e as Error).message, true);
    }
  }

  el.source.addEventListener('change', update);
  el.octave.addEventListener('change', update);
  el.download.addEventListener('click', () => {
    if (result) download(result, `${safeFileName(fileName)}_tenor.musicxml`);
  });
  el.print.addEventListener('click', () => printScore($('score-transpose'), `${fileName} (Tenor Sax)`));
}
