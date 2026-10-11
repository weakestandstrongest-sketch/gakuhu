import { Interval, STEP_NAMES, mod, transposePitch } from './pitch';

// コード譜 (テキスト) の移調。
// 例: "| Dm7 G7 | Cmaj7 |" → "| Em7 A7 | Dmaj7 |"

const ACC_PATTERN = '(?:#|b|♯|♭)?';
const ROOT = `[A-G]${ACC_PATTERN}`;
// コードの種類部分 (m7, maj7, 7(b9), m7b5, 6/9, sus4, alt など)。
// 英単語 ("Blues" など) をコードと誤認しないよう、使える記号を限定する。
const QUALITY = `(?:maj|min|dim|aug|sus|add|alt|omit|no|ma|mi|m|M|Δ|ø|°|o|\\+|-|\\^|\\d+|#|b|♯|♭|\\(|\\)|,|/(?=\\d))*`;
const CHORD_RE = new RegExp(`^(${ROOT})(${QUALITY})(?:/(${ROOT}))?$`);
const TOKEN_RE = /(\S+)/g;

interface ParsedNote {
  step: number;
  alter: number;
}

export interface ChordStyle {
  /** true なら ♯/♭、false なら #/b で出力 */
  unicode: boolean;
}

function parseNote(s: string): ParsedNote {
  const step = STEP_NAMES.indexOf(s[0] as (typeof STEP_NAMES)[number]);
  const acc = s.slice(1);
  const alter = acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0;
  return { step, alter };
}

function formatNote(n: ParsedNote, style: ChordStyle): string {
  const sharp = style.unicode ? '♯' : '#';
  const flat = style.unicode ? '♭' : 'b';
  return STEP_NAMES[n.step] + (n.alter > 0 ? sharp.repeat(n.alter) : flat.repeat(-n.alter));
}

// E♯ B♯ C♭ F♭ や ダブルシャープ等はコード譜では読みにくいので普通の綴りに直す
const SIMPLE_SPELLING_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SIMPLE_SPELLING_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function simplifyRoot(n: ParsedNote): ParsedNote {
  const awkward = Math.abs(n.alter) >= 2 || (n.alter === 1 && (n.step === 2 || n.step === 6)) || (n.alter === -1 && (n.step === 0 || n.step === 3));
  if (!awkward) return n;
  const pc = mod([0, 2, 4, 5, 7, 9, 11][n.step] + n.alter, 12);
  const name = (n.alter > 0 ? SIMPLE_SPELLING_SHARP : SIMPLE_SPELLING_FLAT)[pc];
  return parseNote(name);
}

export function transposeRoot(n: ParsedNote, iv: Interval): ParsedNote {
  const p = transposePitch({ step: n.step, alter: n.alter, octave: 4 }, iv);
  return simplifyRoot({ step: p.step, alter: p.alter });
}

/** コード1つを移調。コードとして読めなければ null */
export function transposeChord(symbol: string, iv: Interval, style?: ChordStyle): string | null {
  const m = CHORD_RE.exec(symbol);
  if (!m) return null;
  const st: ChordStyle = style ?? { unicode: /[♯♭]/.test(symbol) };
  const root = formatNote(transposeRoot(parseNote(m[1]), iv), st);
  const bass = m[3] ? '/' + formatNote(transposeRoot(parseNote(m[3]), iv), st) : '';
  return root + m[2] + bass;
}

/** 括弧や小節線がくっついたトークン ("(Am7)" "|C7" など) から中身を取り出す */
function splitToken(token: string): [string, string, string] {
  const m = /^([|(\[:]*)(.*?)([|)\]:,.]*)$/.exec(token)!;
  let [, pre, core, post] = m;
  // "C7(b9)" の閉じ括弧はコードの一部
  const open = (core.match(/\(/g) ?? []).length;
  const close = (core.match(/\)/g) ?? []).length;
  if (open > close && post.startsWith(')')) {
    core += ')';
    post = post.slice(1);
  }
  return [pre, core, post];
}

function isChordToken(token: string): boolean {
  const [, core] = splitToken(token);
  return core !== '' && CHORD_RE.test(core);
}

function isNeutralToken(token: string): boolean {
  // 小節線・反復記号・N.C. ・ % など、コード行にもよく出てくるもの
  return /^[|:\[\]%/\-x.]+$/i.test(token) || /^N\.?C\.?$/i.test(token) || /^\(?\d+[.)]?$/.test(token);
}

/** その行がコード行か (タイトルや歌詞を誤って移調しないための判定) */
export function isChordLine(line: string): boolean {
  const tokens = line.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  let chords = 0;
  let others = 0;
  for (const t of tokens) {
    if (isChordToken(t)) chords++;
    else if (!isNeutralToken(t)) others++;
  }
  return chords > 0 && chords >= others * 2;
}

export function transposeChordText(text: string, iv: Interval): string {
  return text
    .split('\n')
    .map((line) => {
      if (!isChordLine(line)) return line;
      return line.replace(TOKEN_RE, (token) => {
        const [pre, core, post] = splitToken(token);
        const t = transposeChord(core, iv);
        return t === null ? token : pre + t + post;
      });
    })
    .join('\n');
}
