// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { listParts, parseXml, transposeScoreForTenor } from '../src/music/musicxml-transpose';

const note = (step: string, octave: number, alter?: number, extra = '') =>
  `<note><pitch><step>${step}</step>${alter !== undefined ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type>${extra}</note>`;

function score(parts: { id: string; name: string; attrs: string; measures: string[] }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>${parts.map((p) => `<score-part id="${p.id}"><part-name>${p.name}</part-name></score-part>`).join('')}</part-list>
  ${parts
    .map(
      (p) =>
        `<part id="${p.id}">${p.measures
          .map((m, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes><divisions>1</divisions>${p.attrs}</attributes>` : ''}${m}</measure>`)
          .join('')}</part>`,
    )
    .join('')}
</score-partwise>`;
}

const pitches = (xml: string) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.getElementsByTagName('pitch')).map((p) => {
    const alter = p.getElementsByTagName('alter')[0]?.textContent;
    const acc = alter === '1' ? '#' : alter === '-1' ? 'b' : alter === '2' ? '##' : alter === '-2' ? 'bb' : '';
    return p.getElementsByTagName('step')[0].textContent + acc + p.getElementsByTagName('octave')[0].textContent;
  });
};

describe('transposeScoreForTenor', () => {
  it('in C (F major) のリードシートをテナー用 (G major) に', () => {
    const xml = score([
      {
        id: 'P1',
        name: 'Melody',
        attrs: '<key><fifths>-1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef>',
        measures: [
          note('F', 4) + note('A', 4) + note('C', 5) + note('B', 4, -1, '<accidental>flat</accidental>'),
          `<harmony><root><root-step>B</root-step><root-alter>-1</root-alter></root><kind>dominant</kind></harmony>` +
            note('E', 5, -1) + note('D', 5) + note('C', 5) + note('A', 4),
        ],
      },
    ]);
    const doc = parseXml(xml);
    const r = transposeScoreForTenor(doc, { partIds: ['P1'], source: 'auto', octave: 'auto' });
    expect(r.concertKey).toBe('F');
    expect(r.writtenKey).toBe('G');
    // Real Book (B♭版) と同じく、長2度上の位置になる
    expect(r.octaveShift).toBe(-1);
    expect(pitches(r.xml)).toEqual(['G4', 'B4', 'D5', 'C5', 'F5', 'E5', 'D5', 'B4']);
    expect(r.xml).toContain('<fifths>1</fifths>');
    // B♭7 → C7
    expect(r.xml).toMatch(/<root-step>C<\/root-step><\/root>/);
    expect(r.xml).toContain('<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>');
    // 元の B♭ の臨時記号は G major では不要 (C ナチュラルは調号どおり)
    expect(r.xml).not.toContain('<accidental>flat</accidental>');
    expect(r.outOfRange).toBe(0);
  });

  it('アルト譜 (in E♭, <transpose> 付き) を自動判定してテナー譜に (完全4度上)', () => {
    const xml = score([
      {
        id: 'P1',
        name: 'Alto Saxophone',
        attrs: '<key><fifths>0</fifths></key><clef><sign>G</sign><line>2</line></clef><transpose><diatonic>-5</diatonic><chromatic>-9</chromatic><octave-change>-1</octave-change></transpose>',
        measures: [note('C', 5) + note('E', 5) + note('G', 5) + note('F', 5, 1)],
      },
    ]);
    const doc = parseXml(xml);
    expect(listParts(doc)[0].detectedSource).toBe('Eb');
    const r = transposeScoreForTenor(doc, { partIds: ['P1'], source: 'auto', octave: 'auto' });
    // アルトの記譜 C → 実音 E♭ → テナー記譜 F (調号 C → F)
    expect(r.writtenKey).toBe('F');
    expect(pitches(r.xml)[0].slice(0, 1)).toBe('F');
    expect(pitches(r.xml).map((p) => p.replace(/\d/, ''))).toEqual(['F', 'A', 'C', 'B']);
    expect(r.xml).toContain('<accidental>natural</accidental>');
  });

  it('ヘ音記号のパートはト音記号になり、選ばなかったパートは消える', () => {
    const xml = score([
      { id: 'P1', name: 'Piano', attrs: '<key><fifths>0</fifths></key><clef><sign>G</sign><line>2</line></clef>', measures: [note('C', 5)] },
      {
        id: 'P2',
        name: 'Bass',
        attrs: '<key><fifths>0</fifths></key><clef><sign>F</sign><line>4</line><clef-octave-change>-1</clef-octave-change></clef>',
        measures: [note('C', 3) + note('G', 2)],
      },
    ]);
    const doc = parseXml(xml);
    const r = transposeScoreForTenor(doc, { partIds: ['P2'], source: 'C', octave: 'auto' });
    expect(r.xml).not.toContain('Piano');
    expect(r.xml).toContain('<clef><sign>G</sign><line>2</line></clef>');
    expect(r.outOfRange).toBe(0);
    expect(pitches(r.xml)).toEqual(['D5', 'A4']);
  });

  it('コンサート B major → テナー D♭ major で音符も ♭ で綴る', () => {
    const xml = score([
      { id: 'P1', name: 'Melody', attrs: '<key><fifths>5</fifths></key>', measures: [note('B', 4) + note('D', 5, 1) + note('F', 5, 1)] },
    ]);
    const r = transposeScoreForTenor(parseXml(xml), { partIds: ['P1'], source: 'C', octave: 'auto' });
    expect(r.writtenKey).toBe('D♭');
    expect(pitches(r.xml).map((p) => p.replace(/\d/, ''))).toEqual(['Db', 'F', 'Ab']);
  });
});
