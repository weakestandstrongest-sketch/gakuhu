export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

export function download(content: string, fileName: string, type = 'application/vnd.recordare.musicxml+xml'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(name: string): string {
  return (name.trim() || 'tenor').replace(/[\\/:*?"<>|]+/g, '_');
}

/** 楽譜 (SVG) だけを新しいウィンドウで開いて印刷する。PDF 保存もここから */
export function printScore(container: HTMLElement, title: string): void {
  const w = window.open('', '_blank');
  if (!w) {
    alert('ポップアップがブロックされました。ブラウザの設定で許可してください。');
    return;
  }
  const esc = title.replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[c]!);
  w.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc}</title>
<style>body{margin:0;background:#fff}svg{width:100%;height:auto;display:block;page-break-inside:avoid}@page{margin:12mm}</style>
</head><body>${container.innerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

export function setStatus(el: HTMLElement, text: string, error = false): void {
  el.textContent = text;
  el.classList.toggle('error', error);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t = 0;
  return (...args: A) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...args), ms);
  };
}

/** CSS 変数の値 (キャンバス描画用) */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
