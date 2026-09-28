# OPM.js 使用說明（繁體中文）

[English](./usage.en.md) · [專案 README](../README.md) · [原始碼儲存庫](https://github.com/YueyuHoshizora/OPM.js)

OPM.js 提供瀏覽器 AudioWorklet 即時合成的 `OPM`，以及 Node.js 離線 PCM 渲染的 `Synth` 與 `renderNote`。請先取得包含本文件的儲存庫 checkout／封存檔；以下路徑皆以明示的工作目錄為準。

- [安裝與範例頁面](#安裝與範例頁面)
- [瀏覽器靜態部署](#瀏覽器靜態部署)
- [瀏覽器 API 與自訂音色](#瀏覽器-api-與自訂音色)
- [Node.js 離線渲染](#nodejs-離線渲染)
- [音色格式與銀行載入](#音色格式與銀行載入)
- [壓縮部署](#壓縮部署)
- [疑難排解](#疑難排解)

## 安裝與範例頁面

需要 Node.js 18+ 與 npm。下列指令先在 **OPM.js 儲存庫根目錄** 執行，`npm pack` 會自行執行建置（`prepack`），不必預先重複執行 `npm run build`：

```sh
npm ci
npm pack
```

此 checkout 的套件版本產生 `opm.js-1.0.0.tgz`。以下從儲存庫根目錄建立**同層的新專案** `opm-app`，假設 checkout 目錄名為 `OPM.js`；若名稱不同，請調整安裝指令中的路徑：

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.0.0.tgz
```

既有專案只需在該專案目錄以 tarball 的實際相對或絕對路徑執行 `npm install`，不需 `npm init`。此流程不假設套件已上架 npm registry；套件使用端不需要安裝建置用依賴。封裝內容有 `dist` 的 JS／JSON、文件與法律檔案，沒有 `src`、`scripts`、範例頁面或 `.br`／`.gz`；維護者的建置指令應在 checkout 執行，而非已安裝的套件內。

要直接試用儲存庫的範例，請在 **OPM.js 儲存庫根目錄** 啟動伺服器：

```sh
python3 -m http.server 8000
```

開啟 `http://localhost:8000/index.html` 聽歌曲，或 `http://localhost:8000/demo/index.html` 聽和弦。此處 Python 3 僅用於本機 HTTP 服務；已提交的 `dist` 不必先建置。只有 `dist` 缺失或原始碼有修改時，才在 checkout 執行 `npm ci`、`npm run build`。瀏覽器必須支援 ES modules 與 AudioWorklet，並使用 HTTPS 或 localhost，不能直接開啟 `file://`。

## 瀏覽器靜態部署

在**已安裝套件的 `opm-app` 根目錄**複製完整發佈樹與授權檔：

```sh
mkdir -p public/opm
cp -R node_modules/opm.js/dist/. public/opm/
cp node_modules/opm.js/LICENSE public/opm/LICENSE
```

將下列頁面存為 **`opm-app/public/index.html`**：

```html
<!doctype html>
<html lang="zh-Hant">
<meta charset="utf-8">
<title>OPM.js example</title>
<button id="play" type="button">Play brass chord</button>
<output id="status" aria-live="polite">Ready</output>
<script type="module">
  import { OPM } from './opm/api/index.js';

  const opm = new OPM();
  const play = document.querySelector('#play');
  const status = document.querySelector('#status');
  play.addEventListener('click', async () => {
    play.disabled = true;
    try {
      await opm.start();
      for (const note of [60, 64, 67]) opm.playNote({ note, duration: 0.7 });
      status.textContent = 'Playing brass chord';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      play.disabled = false;
    }
  });
</script>
</html>
```

在 **`opm-app` 根目錄**執行：

```sh
python3 -m http.server 8000 --directory public
```

開啟 `http://localhost:8000/`，點擊按鈕播放。上述複製指令適用 POSIX shell；其他系統可手動複製相同檔案。若完全不使用 npm，亦可將 checkout 的完整 `dist/` **內容**複製到網站根目錄的 `site/opm/`，將 checkout 的 `LICENSE` 複製為 `site/opm/LICENSE`，把同一 HTML 存成 `site/index.html`，並以網站根目錄 `site/` 提供服務。務必連同 `api/`、`core/`、`worklet/`、`voices/`、`chunks/` 一起保留，不能單獨重新命名或移動 worklet、帶雜湊的 chunk。純 HTML 無 import map 時不能直接解析 `import 'opm.js'`；即便使用 bundler，也不能假定它會複製 worklet URL 的模組相依樹。上述靜態複製與站內相對 URL 不依賴 bundler。

## 瀏覽器 API 與自訂音色

| API | 用法與限制 |
| --- | --- |
| `new OPM({ sampleRate } = {})` | 可省略採用瀏覽器預設取樣率；指定時須為 8000–96000 的整數，瀏覽器硬體也可能拒絕指定值。 |
| `await opm.start()` | 從點擊等使用者互動中呼叫並等待；已啟動後依序重複呼叫無妨。`start()`／`close()` 應依序等待，並行的 `start()` 不會自動合併。 |
| `opm.loadVoice(name, voice)` | 在 `start()` 前即可註冊；驗證並複製音色。名稱為 1–64 個 ASCII 英文字母、數字、`_` 或 `-`；重複名稱會取代後續音符使用的音色。 |
| `opm.playNote({ voice = 'brass', note, time = 0, duration })` | `note` 必須是 MIDI 整數 0–127；`time` 是**從現在起算的延遲** 0–60 秒，不是絕對 AudioContext 時間；必填 `duration` 為 `(0, 60]` 秒，**不含 release 尾音**。`voice` 可為已註冊名稱或音色物件。回傳正的安全整數 ID，並非完成 Promise 或排程確定被接收的證明。 |
| `opm.stop(id)` | 需已啟動且 ID 為正的安全整數；取消待開始的音符，或讓發聲中的音符進入 release。回傳 `undefined`，不是立即靜音。 |
| `await opm.close()` | 斷線並關閉 AudioContext，停止音效與佇列中的工作；再次使用須呼叫 `start()`。 |

最多同時八個音符（含 release 尾音），第九個會取代最早的音符。Worklet 待處理事件最多 256 筆，單一未來音符需佔開始與結束兩筆；空佇列至多容納 128 個完整的未來音符，溢出事件會被忽略。請勿把 `playNote()` 回傳 ID 當成事件已被接收的確認。沒有全域 `setLFO()`：應在載入或播放音色前設定音色本身的 `lfo`。

要自訂 LFO、排程與提早停止，保留上方 **`public/index.html`** 的 `#play` 按鈕與 `#status` 輸出，將其原本的 `<script type="module">…</script>` **完整替換**為以下區塊；從 `opm-app` 根目錄照前節提供 `public/`：

```html
<script type="module">
  import { OPM } from './opm/api/index.js';
  import { brass } from './opm/voices/brass.js';

  const opm = new OPM();
  const voice = structuredClone(brass);
  voice.lfo.rate = 5;
  voice.lfo.amDepth = 0.2;
  voice.ops[0].level = 0.6;
  opm.loadVoice('my-brass', voice);

  const play = document.querySelector('#play');
  play.textContent = 'Play custom brass note';
  const status = document.querySelector('#status');
  play.addEventListener('click', async () => {
    play.disabled = true;
    try {
      await opm.start();
      const id = opm.playNote({ voice: 'my-brass', note: 64, time: 0.1, duration: 1 });
      setTimeout(() => opm.stop(id), 300);
      status.textContent = 'Playing custom brass note';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      play.disabled = false;
    }
  });
</script>
```

`setTimeout` 只是頁面側的提早停止示範；真正的排程延遲由 `time` 指定。完成使用後可在應用程式生命週期中 `await opm.close()`，下次要播放時再由使用者互動呼叫 `start()`。

## Node.js 離線渲染

在**已安裝套件的 `opm-app` 根目錄**建立 `render.mjs`：

```js
import { Synth } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const sampleRate = 44100;
const synth = new Synth(sampleRate);
const id = synth.noteOn(brass, 60);
const left = new Float32Array(sampleRate);
const right = new Float32Array(sampleRate);
synth.render(left, right, 0, 22050);
synth.noteOff(id);
synth.render(left, right, 22050, 22050);
console.log(left.some(sample => sample !== 0), synth.errorCount);
```

在同一目錄執行 `node render.mjs`，預期顯示 `true 0`。左右聲道目前輸出相同；此例只產生記憶體內的 PCM 緩衝區，**不會**播放至喇叭或寫出 WAV。在 checkout 根目錄直接執行時，將上述兩行匯入路徑分別改為 `./dist/core/index.js` 與 `./dist/voices/brass.js`。使用 ESM 的 `.mjs` 或專案的 `"type": "module"`；沒有宣告 CommonJS 入口。

`new Synth(sampleRate, maxVoices = 8)` **必須**提供有限且 8000–192000 的取樣率；`maxVoices` 是 1–8 的整數。`noteOn(voice, note, id?)` 嚴格驗證音色與整數 MIDI 音高 0–127；可選 ID 必須是目前未被使用中音符占用的正安全整數，不給則自動產生，回傳 ID。超過同時發聲數會取代最早的音符。`noteOff(id)` 僅首次成功進入 release 回傳 `true`，未知或已釋放 ID 回傳 `false`。

`render(left, right, offset = 0, length = left.length - offset)` 寫入 `Float32Array`：`offset`／`length` 須為非負安全整數且區間須容納於**兩個**陣列內，陣列總長可不同。自行分段呼叫 `render` 來排程，沒有即時定時器；`currentFrame` 為累計渲染影格，`errorCount` 記錄數值計算失敗次數。release 仍須足夠長的後續緩衝區與渲染時間。

若只需要單音的輔助渲染函式，在 **`opm-app` 根目錄**另存 `render-note.mjs`：

```js
import { renderNote } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const { samples, sampleRate, diagnostics } = renderNote({
  voice: brass,
  note: 60,
  duration: 0.1,
  sampleRate: 44100
});
console.log(samples.length, sampleRate, diagnostics.errors);
```

在同一目錄執行 `node render-note.mjs`；若改在 checkout 根目錄執行，將匯入路徑改成 `./dist/core/index.js` 與 `./dist/voices/brass.js`。`renderNote({ voice, note = 60, duration = 0.5, velocity = 1, sampleRate = 44100 })` 回傳 `{ samples, sampleRate, diagnostics: { errors } }`，其中 `samples` 為單聲道 PCM。它要求**完整 Schema 音色**，包含 `version`、`name`、`modIndex`、`lfo`。`voice` 的有限但超界數值會被限制到有效範圍，但不合法的 `version`、`algorithm`、`feedback` 仍會拒絕；`note` 必須有限，限制於 0–127 且可為小數；`duration` 必須有限，限制於 0–30 秒；`velocity` 必須有限，限制於 0–1。`sampleRate` 則必須是 8000–96000 的整數，超界會拒絕。

它會配置 `ceil((duration + 最長 release + 0.01) × sampleRate)` 個樣本，超過 4,000,000 個會拒絕。此輔助函式雖驗證 LFO 欄位，**並不套用 LFO**，且輸出／混音與 `Synth` 不相同；需要對應瀏覽器引擎的 LFO 或複音行為時，請用 `Synth`。

其他 `opm.js/core` 公開項目：`normalizeVoice`（嚴格驗證並產生獨立複本）、`envelopeAt(time, gate, adsr)`（以秒為單位的時間／gate 計算 dB 包絡對應振幅）、不可變的八種訊號圖 `ALGORITHMS`、`HEADROOM = 0.7`、`OVERSAMPLE = 4`、`MAX_RENDER_SAMPLES = 4000000`，以及整數 8000–96000 取樣率驗證器 `sampleRateValue`。

## 音色格式與銀行載入

參考完整的 [voice.schema.json](../dist/voices/voice.schema.json) 與 [examples.json](../dist/voices/examples.json)。下列為**單一音色 JSON 物件**，四個 `ops` 順序是訊號演算法的運算子順序；若要作為銀行，必須用 `[` 和 `]` 包成**陣列**：

```json
{
  "version": 1,
  "name": "simple",
  "algorithm": 7,
  "feedback": 0,
  "modIndex": 4,
  "lfo": { "rate": 0, "amDepth": 0, "pmDepth": 0 },
  "ops": [
    { "ratio": 1, "level": 0.8, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.6, "r": 0.2 } },
    { "ratio": 2, "level": 0.4, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } },
    { "ratio": 3, "level": 0.3, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } },
    { "ratio": 4, "level": 0.2, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } }
  ]
}
```

| 欄位 | 範圍 |
| --- | --- |
| `version`／`name` | 完整音色的版本固定為 `1`；名稱為 1–64 個 ASCII 英文字母、數字、`_` 或 `-`。 |
| `algorithm`／`feedback`／`modIndex` | 前兩者是 0–7 的整數；調變強度 `modIndex` 是 0–16。 |
| 四個 `ops` 各項 | 必須提供 `ratio` 0.125–32、`level` 0–1、`detune` -1200–1200 音分，以及 `adsr` 的 `a`、`d`、`s`、`r`；`a`／`d`／`r` 是 0–10 秒，`s` 是 0–1。 |
| `lfo` | `rate` 0–20 Hz、`amDepth` 0–1、`pmDepth` 0–1200 音分。 |

直接交給 `OPM.playNote()`、`OPM.loadVoice()`、`Synth.noteOn()` 或 `normalizeVoice()` 的**單一音色**，可省略 `version`、`name`、`lfo`、`modIndex`；但須提供 `algorithm`、`feedback` 與四個完整運算子。省略時 `modIndex` 預設 4、LFO 停用；若提供 `version`，必須是 1。此嚴格路徑會拒絕超界數值。欄位型別錯誤、非有限數值、未知欄位、存取器或稀疏欄位亦不符合要求。

`parseVoiceBank()` 由 `opm.js/voices/schema.js`（瀏覽器靜態樹中為 `./opm/voices/schema.js`）匯出，可接受 JSON 字串或音色陣列，要求 **1–128 筆完整音色**且名稱不重複，回傳 `Map<name, voice>`，其音色為已驗證且凍結的完整物件。字串輸入最多 256 KiB（UTF-8）；陣列輸入也有數量限制。和 `validateVoice()`、`renderNote()` 相同，此路徑將**有限但超界**的數值限制在範圍內，與嚴格的單音色 `normalizeVoice()` 不同；不合法的 `version`／`algorithm`／`feedback`、非有限數值、錯誤型別、未知欄位仍會拒絕。`schema.js` 也提供 `validateVoice(voice)`、有限數值邊界函式 `bounded(value, min, max, label = 'number')`、`LIMITS`、`MAX_BANK_BYTES` 與 `MAX_BANK_VOICES`。

要載入已部署的可信任 `examples.json`，保留先前 **`opm-app/public/index.html`** 的 `#play` 與 `#status`，將其原本 module script **完整替換**為：

```html
<script type="module">
  import { OPM } from './opm/api/index.js';
  import { parseVoiceBank } from './opm/voices/schema.js';

  const opm = new OPM();
  const play = document.querySelector('#play');
  play.textContent = 'Play bank brass note';
  const status = document.querySelector('#status');
  play.addEventListener('click', async () => {
    play.disabled = true;
    try {
      await opm.start();
      const response = await fetch('./opm/voices/examples.json');
      if (!response.ok) throw new Error(`Voice bank HTTP ${response.status}`);
      const bank = parseVoiceBank(await response.text());
      for (const [name, voice] of bank) opm.loadVoice(name, voice);
      opm.playNote({ voice: 'brass', note: 60, duration: 0.7 });
      status.textContent = 'Playing bank brass note';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      play.disabled = false;
    }
  });
</script>
```

仍在 `opm-app` 根目錄以 `python3 -m http.server 8000 --directory public` 提供頁面。此例只下載套件所附、站內可信任的資產；銀行大小限制在取得回應文字**之後**才生效。若接收不可信任的遠端下載，服務端必須自行限制來源、Content-Type 與下載大小；合成引擎沒有內建網路下載 API。

## 壓縮部署

原始縮小版 `.js`／`.json` 可直接使用。checkout 建置時會產生 Brotli `.br`（品質 11）與 gzip `.gz`（等級 9）側檔，但 npm tarball 不包含這些檔案；選用壓縮可在 checkout 建置，或由網站主機自行壓縮。程式始終匯入 `.js` URL，**不要**匯入 `.br`／`.gz`。只有當伺服器實際送出對應壓縮位元組時才設定正確的 `Content-Encoding` 與 `Vary: Accept-Encoding`，並提供適當 JS／JSON MIME 類型。基本的 Python HTTP 伺服器不會協商側檔。整套 `dist` 與 chunks 須維持同一建置版本；詳見 README 的[最佳化發佈](../README.md#optimized-distribution)。

## 疑難排解

| 現象 | 修正方式 |
| --- | --- |
| `file://`、非安全來源或 AudioWorklet 不可用 | 使用支援 AudioWorklet 的現代瀏覽器，由 HTTPS 或 localhost 提供整個頁面與檔案。 |
| 瀏覽器無法解析 `opm.js` 裸套件名稱 | 使用複製的 `./opm/api/index.js` 相對 URL；如自行設定 import map，也要確保 worklet 的完整模組樹可讀取。 |
| worklet／chunk 404，或拿到 HTML、MIME 類型錯誤 | 重新複製完整 `dist` 目錄並確認站點路徑；不要讓 SPA rewrite 將資產請求改送 `index.html`。 |
| 尚未啟動就播放、瀏覽器自動播放被擋 | 在點擊事件內 `await opm.start()` 後才呼叫 `playNote()`。 |
| 音高、名稱、延遲、時長或未知音色出錯 | 依[瀏覽器 API](#瀏覽器-api-與自訂音色)檢查範圍，先註冊自訂音色。 |
| 多音符遺失 | 考慮八聲部上限與 256 筆待處理事件限制；ID 並非事件接收回執。 |
| Node 無聲、找不到 WAV | `Synth`／`renderNote` 只產生 PCM 資料，需自行播放或編碼檔案；release 需額外渲染。 |
| `renderNote` 的 LFO 無效 | 此輔助函式不套用 LFO；改用 `Synth`。 |
| npm 回報 E404 | 不假設 registry 有此套件；依[安裝步驟](#安裝與範例頁面)打包並安裝 checkout 的本機 tarball。 |
| 音色銀行格式錯誤 | 必須是完整音色組成的**陣列**，並符合名稱、欄位、數量與大小限制；單一 JSON 物件須包入 `[...]`。 |
| `.br` 回傳亂碼 | 設定正確的壓縮協商與 `Content-Encoding`，或直接提供原始 `.js`／`.json`。 |
