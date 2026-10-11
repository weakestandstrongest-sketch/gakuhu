import JSZip from 'jszip';

/** .musicxml / .xml / .mxl (圧縮 MusicXML) を読み込んで XML 文字列を返す */
export async function readScoreFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // ZIP のマジックナンバー "PK"
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return unzipMxl(buf);
  return new TextDecoder(detectEncoding(bytes)).decode(bytes);
}

function detectEncoding(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return 'utf-8';
}

async function unzipMxl(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  let path: string | undefined;
  const container = zip.file('META-INF/container.xml');
  if (container) {
    const xml = await container.async('string');
    path = /full-path="([^"]+)"/.exec(xml)?.[1];
  }
  if (!path) {
    path = Object.keys(zip.files).find((n) => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
  }
  const entry = path ? zip.file(path) : null;
  if (!entry) throw new Error('.mxl ファイルの中に MusicXML が見つかりませんでした。');
  const bytes = await entry.async('uint8array');
  return new TextDecoder(detectEncoding(bytes)).decode(bytes);
}
