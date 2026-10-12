# Gakuhu 🎷 — テナーサックスの耳コピ & 移調ツール

ジャズでテナーサックス (in B♭) を吹く人のための Web アプリです。ブラウザだけで動き、音源や楽譜はどこにも送信されません。

## できること

### 1. 音源 → テナー譜（耳コピ支援）
- 音声・動画ファイル（mp3 / m4a / wav / mp4 など）を開く、マイクで録音する、**YouTube など別タブの音を録音する**（PC の Chrome / Edge）
- 耳コピ用プレーヤー：**音程を変えずにスロー再生**（25〜100%）、波形をドラッグして **A-B ループ**
- 音を拾う
  - **伴奏あり**：Spotify の AI モデル [Basic Pitch](https://github.com/spotify/basic-pitch-ts) で和音ごと検出し、指定した楽器の音域から一番目立つメロディを取り出す
  - **ソロ楽器だけ**：YIN アルゴリズムで単音をすばやく検出
- テンポ自動推定（タップ入力・×2 / ÷2 も可）、**スウィングした8分音符をふつうの8分で記譜**、3連の自動判定
- 調の推定 → **テナー用の調号・音名**（実音＋長9度）で楽譜化。音域に合わせてオクターブも自動調整
- ピアノロールで誤検出した音をクリックで除外、シンセで確認、**MusicXML 保存**（MuseScore 等で編集可）、印刷 / PDF

### 2. 楽譜 (MusicXML) を移調
- in C / in E♭ / in F / in B♭ の楽譜をテナー譜に。`<transpose>` 要素があれば元の楽器を自動判定
- コードネームも一緒に移調、ヘ音記号はト音記号に、調号が ♯/♭ 7個を超える場合は異名同音（例: D♯ → E♭）に書き換え
- オクターブは「自動」「Real Book の B♭ 版と同じ（実音の長2度上）」「標準（実音の長9度上）」から選択

## iPhone / iPad で使う

- Safari で開き、共有ボタン →「**ホーム画面に追加**」でアプリのように使えます（一度使った機能はオフラインでも動きます）
- YouTube の音は、iPhone の「**画面収録**」で録画 →「音声・動画ファイルを開く」→「写真ライブラリ」から読み込みます（タブ録音は PC のみ）
- iPhone で撮った .mov 動画など、Safari が直接読めない動画は「動画を再生して音声を取り出す」ボタンで読み込めます（動画の長さぶん時間がかかります）
- マナーモードでも「楽譜を音で確認」の音が鳴るようにしています（iOS 16.4 以降）
- 長い曲はメモリ不足になりやすいので、30秒〜1分程度ずつ解析するのがおすすめです

## 使い方（開発）

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # 単体テスト (vitest)
npm run build    # dist/ に静的ファイルを出力
```

公開先: https://weakestandstrongest-sketch.github.io/gakuhu/

- GitHub Pages の Source が「**Deploy from a branch**」の場合: 組み立て済みのアプリを `app/` フォルダに入れてコミットしておき、トップページから自動でそこへ移動します。**コードを変えたら `npm run build:app` を実行して `app/` もコミットしてください。**
- Source が「**GitHub Actions**」の場合: 既定のブランチに push すると自動で組み立てて公開します（`app/` は使いません）。

## 仕組み

| 場所 | 内容 |
| --- | --- |
| `src/music/pitch.ts` | 音名・音程・調号。異名同音を正しく扱うため「度数＋半音数」で移調 |
| `src/music/musicxml-transpose.ts` | MusicXML の DOM を直接書き換えて移調（強弱・歌詞などはそのまま） |
| `src/music/chords.ts` | コードネームの移調 |
| `src/music/quantize.ts` | 検出した音をスウィング・3連を考慮して拍に合わせる |
| `src/music/musicxml-write.ts` | 量子化した音から読みやすいテナー譜（タイ・3連・臨時記号）を生成 |
| `src/audio/` | 音声読み込み・録音・スロー再生・YIN・テンポ推定・Basic Pitch |
| `src/ui/` | 画面（波形、ピアノロール、楽譜表示 = OpenSheetMusicDisplay） |

## 制限・今後の課題

- **PDF・画像の楽譜は直接読めません**。MuseScore の PDF 読み込みや [Audiveris](https://github.com/Audiveris/audiveris) などの楽譜認識 (OMR) で MusicXML にしてから使ってください
- YouTube の URL を貼るだけで取り込む機能はありません（YouTube の規約上、音声のダウンロードは行わず、タブの音声を録音する方式にしています）
- 自動書き起こしは完璧ではありません。ゴーストノート・速いパッセージ・ベンドなどは誤検出しやすいので、スロー再生やピアノロールで確認し、MuseScore などで仕上げる前提です
- ブルースなど ♭3・♭7 を多く含む曲は短調と推定されることがあります（「調」で選び直せます）
- 録音した音源や作成した楽譜は個人の練習用にとどめ、著作権に注意してください

## ライセンス表記

- AI 音程解析モデル: [Spotify Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Apache-2.0) — `public/models/basic-pitch/`
- 楽譜表示: [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) (BSD-3-Clause)
