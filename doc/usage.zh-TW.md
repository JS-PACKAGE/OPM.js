# OPM.js 使用說明（繁體中文）

[English](./usage.en.md) · [專案 README](../README.md) · [原始碼儲存庫](https://github.com/YueyuHoshizora/OPM.js)

OPM.js 1.4 提供瀏覽器 AudioWorklet 即時合成的 `OPM`、Node.js 離線立體聲 PCM 渲染的 `Synth`／`renderNote`、PCM16 WAV 匯出、近似 DX7 音色匯入、即時控制、絕對時鐘排程、預備音色與版本 3 音色功能。套件版本為 1.4.0；GitHub Release 不代表已上架 npm registry。公開 ESM 入口皆附 TypeScript 型別宣告。請先取得包含本文件的 checkout／封存檔；以下路徑皆以明示的工作目錄為準。

- [安裝與範例頁面](#安裝與範例頁面)
- [瀏覽器靜態部署](#瀏覽器靜態部署)
- [瀏覽器 API 與自訂音色](#瀏覽器-api-與自訂音色)
- [Node.js 離線渲染](#nodejs-離線渲染)
- [音色格式與銀行載入](#音色格式與銀行載入)
- [壓縮部署](#壓縮部署)
- [疑難排解](#疑難排解)

## 安裝與範例頁面

需要 Node.js 22+ 與 npm。下列指令先在 **OPM.js 儲存庫根目錄** 執行，`npm pack` 會自行執行建置（`prepack`），不必預先重複執行 `npm run build`：

```sh
npm ci
npm pack
```

此 checkout 的套件版本產生 `opm.js-1.4.0.tgz`。以下從儲存庫根目錄建立**同層的新專案** `opm-app`，假設 checkout 目錄名為 `OPM.js`；若名稱不同，請調整安裝指令中的路徑：

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.4.0.tgz
```

既有專案只需在該目錄以 tarball 的實際路徑執行 `npm install`，不需 `npm init`。此流程不假設已上架 npm registry；使用端不需建置依賴。封裝含 `dist` 的最小化 `.js` 模組、內嵌 TypeScript 原始碼的 `.js.map`、`.d.ts`、demo scripts、文件與法律檔案，不含獨立 TypeScript 原始碼檔案、開發 scripts 或 HTML 範例頁面；維護指令應在 checkout 執行。

要直接試用儲存庫的範例，請在 **OPM.js 儲存庫根目錄** 啟動伺服器：

```sh
python3 -m http.server 8000
```

開啟 `http://localhost:8000/index.html` 查看英文範例索引，包含基本音符、有界前瞻旋律／和弦排程、即時音高／表情／聲像／調變、共用 AudioContext 接線、離線 WAV、進階控制台與音色試聽七個範例。歌曲位於 `http://localhost:8000/examples/song.html`；即時控制位於 `http://localhost:8000/examples/modulation.html`；進階控制與 DX7 匯入位於 `http://localhost:8000/examples/playground.html`；預設音色與 DX7 A/B 試聽、原始 peak／RMS dBFS 及 WAV 下載位於 `http://localhost:8000/examples/audition.html`。頁面與執行時訊息皆為英文。此處 Python 3 僅用於本機 HTTP 服務；已提交的 `dist` 不必先建置。只有 `dist` 缺失或原始碼／helper 有修改時，才在 checkout 執行 `npm ci`、`npm run build`。瀏覽器必須支援 ES modules 與 AudioWorklet，並使用 HTTPS 或 localhost，不能直接開啟 `file://`。

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

開啟 `http://localhost:8000/`，點擊按鈕播放。上述複製指令適用 POSIX shell；其他系統可手動複製相同檔案。若完全不使用 npm，亦可將 checkout 的完整 `dist/` **內容**複製到網站根目錄的 `site/opm/`，將 checkout 的 `LICENSE` 複製為 `site/opm/LICENSE`，把同一 HTML 存成 `site/index.html`，並以網站根目錄 `site/` 提供服務。務必連同 `api/`、`core/`、`worklet/`、`voices/` 一起保留，不能單獨重新命名或移動 worklet 及其相依模組。引擎保留來源模組路徑，不再產生 hashed chunks。純 HTML 無 import map 時不能直接解析 `import 'opm.js'`；即便使用 bundler，也不能假定它會複製 worklet URL 的模組相依樹。上述靜態複製與站內相對 URL 不依賴 bundler。

使用 Vite 的獨立、子路徑部署範例見 [examples/vite/README.md](../examples/vite/README.md)：它安裝本機 tarball 並複製完整 `dist` 與 LICENSE，不依賴 npm registry 是否已上架。正式站點須提供正確 JavaScript MIME、真正的資產 404，且不得把 worklet 請求改寫成 SPA HTML；設定 CSP 時應使用外部 module script 與適當來源政策，不要為了範例的行內 script 放寬正式站點防護。部署安全細節見 [SECURITY.md](../SECURITY.md)。

## 瀏覽器 API 與自訂音色

| API | 用法與限制 |
| --- | --- |
| `new OPM({ sampleRate, context, destination, onEvent } = {})` | 可指定整數 8000–96000 Hz。傳入 `AudioContext` 代表借用，OPM 絕不關閉或暫停它。省略 destination 會接到 context.destination；`null` 則不自動接線。 |
| `await opm.start()`／`await opm.resume()` | 在使用者互動中啟動／恢復並等待，再播放。並行啟動會合併；既有 context 被瀏覽器暫停後可恢復。 |
| `opm.connect(destination)`／`opm.disconnect(destination?)` | 對已啟動的輸出接線／斷線，回傳 opm；目的節點必須來自相同 context。省略斷線目的地會移除所有輸出連線。 |
| `opm.loadVoice(name, voice)` | 啟動前即可驗證、複製並註冊音色；名稱為 1–64 個 ASCII 英文字母、數字、`_` 或 `-`。覆蓋只影響未來音符。 |
| `opm.voices` | `ReadonlyMap` 的防禦性快照；音色深度凍結。更換音色須用 `loadVoice`，修改取得的 Map 不會改變引擎。 |
| `opm.playNote({ voice='brass', note, time=0, at, duration=null, velocity=1, pan=0, late='start' })` | MIDI 整數 0–127；`time` 是從現在起的延遲 0–60 秒，與絕對 AudioContext 秒數 `at` 互斥。`at` 須有限、非負、可安全換算影格，最多提前 60 秒，可在過去。duration 為 `(0,60]` 或預設 `null` 持續到 stop；力度 0–1，聲像 −1–1。回傳不循環重用的正安全整數 ID，不代表排程已被接收。 |
| `opm.stop(id, { at } = {})` | 不指定 at 時取消未來音符或立即開始 release；指定 at 則排程停止，不會在呼叫時取消。停止時點早於或等於 onset 會取消音符。未知／終止 ID 不再產生事件；無回傳值，release 不會立即靜音。 |
| `opm.updateNote(id, controls, { at } = {})` | 對待開始或仍存活（含 release）的音符更新；省略 at 立即派送，指定 at 使用同一絕對時鐘與 60 秒上限。未知／終止 ID 無效果；無回傳值。 |
| `await opm.getDiagnostics()` | 回傳 `{type:'diagnostics',requestId,activeVoices,pendingEvents,errors,rejectedNotes}`；context 須在 running，最多 64 個未完成請求。暫停／關閉／processor 失敗會拒絕待回覆請求，請先 resume 再重試。 |
| `await opm.close()` | 與初始化依序處理，斷開 node，只關閉自行建立的 context。再次啟動會重建自有 context；借用的 context 仍可由宿主使用。 |

`onEvent` 會收到 `{type:'note',id,state,reason?,frame,time}`，state 為 `accepted`、`started`、`released`、`ended`、`stolen`、`cancelled` 或 `rejected`；`frame`／`time` 是接收、派送或結束的實際音訊影格／AudioContext 秒數，不是頁面收到訊息的時間。也會收到診斷回覆與 `{type:'error',error}` processor 失敗事件。回呼拋出的例外不會破壞引擎。請監聽拒絕事件，不要把 ID 當作接收確認。

遲到音符預設 `late:'start'`：在可用的第一個影格開始，數值 duration 從實際開始保留完整 gate；`late:'drop'` 則以 `reason:'late'` 拒絕，包含訊息處理延遲造成的遲到。同影格依序處理 stop、onset、controls；onset 前收到的控制保留到開始。

`controls` 是非空、僅含自有資料欄位的嚴格物件：`pitch` 為相對原始音符的 −48–48 半音；`glide` 為 0–10 秒且必須搭配 pitch，從當前音高以半音線性滑至目標；`expression` 為 0–1；`pan` 為 −1–1；`modulation` 為 0–2，縮放 FM 強度與 LFO 深度（AM 上限 1、PM 上限 1200 音分）。除滑音外於派送時生效；未知欄位、存取器、非有限／超界值會拒絕。expression 與 modulation 預設皆為 1。

最多八個邏輯聲部（含 release），另有最多八個約 5 ms 的搶音淡出；滿額取代最早聲部。待處理事件與追蹤 ID 各最多 256 筆；未來定時音符佔兩筆、持續音符一筆，排程控制與 stop 也佔事件額度。重複／溢出在入列前拒絕，終止事件移除該音符剩餘排程。瀏覽器每個 node 快取最多 128 個預備音色，超出後仍走驗證過的內嵌音色路徑；沒有 setLFO，請設定音色 lfo 並以 modulation 即時縮放。

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
      const at = opm.context.currentTime + 0.1;
      const id = opm.playNote({ voice: 'my-brass', note: 64, at, velocity: 0.7, pan: -0.5 });
      opm.updateNote(id, { pitch: 7, glide: 0.1, expression: 0.8, pan: 0.5, modulation: 1.2 }, { at: at + 0.1 });
      opm.stop(id, { at: at + 0.3 });
      status.textContent = 'Scheduled custom brass note and controls';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      play.disabled = false;
    }
  });
</script>
```

上述 onset、控制與 release 皆由音訊時鐘執行，不靠頁面計時器停止；單次僅排三筆事件，且皆在 60 秒範圍內。完成使用後可在應用程式生命週期中 `await opm.close()`，下次要播放時再由使用者互動呼叫 `start()`。

### 有界前瞻排程

長曲用 `createLookaheadScheduler` 分批排程，而非一次塞滿 queue。將同一 **`opm-app/public/index.html`** 的 module script 完整替換如下，再從 `opm-app` 根目錄提供 `public/`。點擊播放會安排有限的八個音符；主執行緒停頓時跳過已錯過的窗口，不補塞過期音符：

```html
<script type="module">
  import { OPM, createLookaheadScheduler } from './opm/api/index.js';
  const status = document.querySelector('#status');
  const opm = new OPM();
  const melody = [60, 64, 67, 72, 67, 64, 62, 60];
  let origin;
  const scheduler = createLookaheadScheduler(opm, ({ from, to, maxNotes }) => {
    origin ??= from + 0.1;
    return melody.flatMap((note, index) => {
      const at = origin + index * 0.3;
      return at >= from && at < to
        ? [{ note, at, duration: 0.2, velocity: 0.6, late: 'drop' }]
        : [];
    }).slice(0, maxNotes);
  }, {
    horizon: 0.2, interval: 0.025, maxNotes: 8,
    onError(error) { status.textContent = error.message; }
  });
  const play = document.querySelector('#play');
  play.textContent = 'Play finite melody';
  play.addEventListener('click', async () => {
    try {
      scheduler.stop();
      origin = undefined;
      await scheduler.start();
      status.textContent = 'Scheduling eight notes';
    } catch (error) { status.textContent = error.message; }
  });
  const stop = document.createElement('button');
  stop.textContent = 'Stop melody';
  document.body.append(stop);
  stop.addEventListener('click', () => scheduler.stop());
  window.disposeOPM = async () => {
    scheduler.dispose();
    await opm.close();
  };
</script>
```

回呼同步回傳陣列，每筆必須有窗口 `[from,to)` 內的絕對 `at` 與 `(0,60]` 數值 duration，不能用相對 time 或持續音。`onError` 必填；計時器／回呼失敗會停止排程並通知它。預設 horizon 為 0.2 秒（範圍 0.02–10），interval 為 0.025 秒（0.005–1），且 horizon 必須大於 interval；maxNotes 預設 32（整數 1–128），最多追蹤 128 個尚未關 gate 的自有音符。本例每個窗口至多一音，全部音符播放後回呼回傳空陣列，計時器仍運作直到 stop／dispose。兩者只取消／釋放自己的音符，不關閉 OPM；dispose 後不可重啟。移除介面時呼叫 `await window.disposeOPM()`。


### 共用 context 與輸出接線

若宿主已有 AudioContext，可將快速範例的 module script 替換成以下區塊。按播放後音符持續到按停止；`disposeOPM()` 只清除本合成器，不會關閉宿主 context：

```html
<script type="module">
  import { OPM } from './opm/api/index.js';
  const context = new AudioContext();
  const gain = context.createGain();
  gain.gain.value = 0.3;
  gain.connect(context.destination);
  const status = document.querySelector('#status');
  const opm = new OPM({
    context, destination: null,
    onEvent(event) {
      status.textContent = event.type === 'error'
        ? event.error.message
        : event.type === 'note' ? `${event.id}: ${event.state}` : `Voices: ${event.activeVoices}`;
    }
  });
  const stop = document.createElement('button');
  stop.textContent = 'Stop held note';
  document.body.append(stop);
  let id;
  let connected = false;
  document.querySelector('#play').addEventListener('click', async () => {
    try {
      await opm.resume();
      if (!connected) { opm.connect(gain); connected = true; }
      if (id !== undefined) opm.stop(id);
      id = opm.playNote({ note: 60, velocity: 0.7, pan: 0.5 });
      console.log(await opm.getDiagnostics());
    } catch (error) { status.textContent = error.message; }
  });
  stop.addEventListener('click', () => { if (id !== undefined) opm.stop(id); });
  window.disposeOPM = async () => {
    await opm.close();
    connected = false;
    id = undefined;
    gain.disconnect();
  };
</script>
```

移除此應用程式的音訊介面時呼叫 `await window.disposeOPM()`。context／下游節點由宿主管理；不要為了停止單一合成器而暫停整個共用 context。

## Node.js 離線渲染

在**已安裝套件的 `opm-app` 根目錄**建立 `render.mjs`：

```js
import { Synth, prepareVoice } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';

const sampleRate = 44100;
const synth = new Synth(sampleRate);
const prepared = prepareVoice(brass);
const id = synth.noteOn(prepared, 60);
const left = new Float32Array(sampleRate);
const right = new Float32Array(sampleRate);
synth.render(left, right, 0, 22050);
synth.updateNote(id, { pitch: 7, glide: 0.1, expression: 0.8 });
synth.noteOff(id);
synth.render(left, right, 22050, 22050);
console.log(left.some(sample => sample !== 0), synth.errorCount);
```

在同一目錄執行 `node render.mjs`，預期顯示 `true 0`。中央聲像為左右相同，其他位置產生立體聲；此例只產生記憶體 PCM，不會自動播放或寫檔。checkout 匯入改為 `./dist/core/index.js` 與 `./dist/voices/brass.js`。使用 `.mjs` 或 `"type":"module"`，沒有 CommonJS 入口。

`new Synth(sampleRate,maxVoices=8)` 需要有限的 8000–192000 Hz 與整數 1–8 聲部。`noteOn(voice,note,id?,{velocity=1,pan=0}={})` 嚴格驗證／複製音色；核心允許有限的 MIDI 小數 0–127，力度 0–1、聲像 −1–1 超界則拒絕。ID 為目前未占用的正安全整數。`noteOff(id)` 首次 release 回傳 true，未知／已釋放則 false。`lastStolenId` 為最後成功 note-on 搶走的 ID，沒有搶音則 null；可設定 `onVoiceEnded(id,reason)`，每個邏輯音符只收到一次 `stolen`／`ended`／`error` 終止通知。

`prepareVoice(input)` 一次嚴格驗證並建立不可變的可信任快照；不能用型別斷言或自製物件偽造。`Synth.noteOn` 可重用此快照，原始音色輸入則仍逐次驗證。預設核心預先配置 17 個狀態槽（八個邏輯聲部、八個淡出與一個入列暫存槽），重用預備音色不需每音符配置 Float64 狀態陣列，但這不是整個 JavaScript／瀏覽器零配置保證。`synth.updateNote(id, controls)` 使用前述控制範圍，成功回傳 true，未知／已終止 ID 回傳 false。

`onVoiceEnded` 可呼叫 noteOn／noteOff；回呼中新增的音符最早在下一影格渲染，不回頭改寫已計算的當前影格。不可在回呼中遞迴呼叫 render；引擎會拒絕。通知有固定工作上限，應保持回呼簡短。

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

執行 `node render-note.mjs`；checkout 改用 `./dist/...` 匯入。`renderNote({voice,note=60,duration=0.5,velocity=1,pan=0,sampleRate=44100})` 回傳 `{samples,left,right,sampleRate,diagnostics:{errors}}`，`samples === left`。要求完整 Schema 音色；有限的音色數值會限制到範圍，但無效版本／algorithm／feedback 仍拒絕。有限 note／duration／velocity／pan 分別限制至 0–127／0–30 秒／0–1／−1–1；note 可為小數，sampleRate 必須是整數 8000–96000。

此函式與 `Synth` 使用相同的包絡時序、LFO、濾波、力度、聲像與飽和路徑。長度維持 `ceil((duration+最長release+0.01)*sampleRate)`，上限 4,000,000 影格。飽和前左右聲像增益為 `sqrt(2)*cos/sin((pan+1)*pi/4)`；中央保留原本每聲道增益，最左／右會關閉另一側並以 `sqrt(2)` 提升選定側。飽和後不保證感知音量恆定。

其他 `opm.js/core` 公開項目：`normalizeVoice`（嚴格驗證並產生獨立複本）、`prepareVoice`、`NoteControls`／`PreparedVoice` 型別、`envelopeAt(time, gate, adsr)`（以秒為單位的時間／gate 計算 dB 包絡對應振幅）、不可變的八種訊號圖 `ALGORITHMS`、`HEADROOM = 0.7`、`OVERSAMPLE = 4`、`MAX_RENDER_SAMPLES = 4000000`，以及整數 8000–96000 取樣率驗證器 `sampleRateValue`。

## 音色格式與銀行載入

參考 [voice.schema.js](../dist/voices/voice.schema.js) 的 `voiceSchema` 與 [examples.js](../dist/voices/examples.js) 的 `examples` 匯出。下列為**單一音色 JSON 物件**，四個 `ops` 順序是訊號演算法的運算子順序；若要作為銀行，必須用 `[` 和 `]` 包成**陣列**：

```json
{
  "version": 3,
  "name": "simple",
  "algorithm": 7,
  "feedback": 0,
  "modIndex": 4,
  "lfo": { "rate": 0, "amDepth": 0, "pmDepth": 0 },
  "ops": [
    { "ratio": 1, "level": 0.8, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.6, "r": 0.2 }, "keyScale": { "breakpoint": 60, "leftDbPerOctave": 0, "rightDbPerOctave": 6 } },
    { "ratio": 2, "level": 0.4, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } },
    { "ratio": 3, "level": 0.3, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } },
    { "ratio": 4, "level": 0.2, "detune": 0, "adsr": { "a": 0.01, "d": 0.2, "s": 0.5, "r": 0.2 } }
  ]
}
```

| 欄位 | 範圍 |
| --- | --- |
| `version`／`name` | 完整音色使用版本 `3`；舊版 `1`／`2` 仍可匯入原有欄位。版本 1 不接受 keyScale，版本 1／2 不接受 velocitySensitivity。名稱為 1–64 個 ASCII 英文字母、數字、`_` 或 `-`。 |
| `algorithm`／`feedback`／`modIndex` | 前兩者是 0–7 的整數；調變強度 `modIndex` 是 0–16。 |
| 四個 `ops` 各項 | 必須提供 `ratio` 0.125–32、`level` 0–1、`detune` -1200–1200 音分，以及 `adsr` 的 `a`、`d`、`s`、`r`；`a`／`d`／`r` 是 0–10 秒，`s` 是 0–1。 |
| `lfo` | `rate` 0–20 Hz、`amDepth` 0–1、`pmDepth` 0–1200 音分。 |
| `ops[i].keyScale` | 可省略表示平坦；breakpoint 為 MIDI 整數 0–127，leftDbPerOctave／rightDbPerOctave 為 0–24 dB／八度。 |
| `ops[i].velocitySensitivity` | 版本 3 可選，0–48 dB，省略為 0；定義 velocity=0 時對該運算子的衰減。 |

交給 `OPM`、`Synth.noteOn()`、`prepareVoice()` 或 `normalizeVoice()` 的單一音色可省略 version／name／lfo／modIndex，但須提供 algorithm／feedback 與四個完整運算子。預設 modIndex 為 4、LFO 停用；省略版本使用目前欄位格式，明示版本接受 1／2／3 且嚴守各版欄位，正規化輸出統一為 3。嚴格路徑拒絕超界／非有限數值、錯誤型別、未知欄位、存取器與稀疏陣列。鍵位縮放依音高距離，以 `10 ** (-斜率*abs(note-breakpoint)/12/20)` 衰減該運算子 level。力度敏感度另乘 `10 ** (-velocitySensitivity*(1-velocity)/20)`；放在調變運算子可讓力度改變亮度，不只音量。最終輸出仍乘音符 velocity。聲像屬於音符選項，不是音色欄位。

`parseVoiceBank()` 由 `opm.js/voices/schema.js`（瀏覽器靜態樹中為 `./opm/voices/schema.js`）匯出，可接受 JSON 字串或音色陣列，要求 **1–128 筆完整音色**且名稱不重複，回傳 `Map<name, voice>`，其音色為已驗證且凍結的完整物件。字串輸入最多 256 KiB（UTF-8）；陣列輸入也有數量限制。和 `validateVoice()`、`renderNote()` 相同，此路徑將**有限但超界**的數值限制在範圍內，與嚴格的單音色 `normalizeVoice()` 不同；不合法的 `version`／`algorithm`／`feedback`、非有限數值、錯誤型別、未知欄位仍會拒絕。`schema.js` 也提供 `validateVoice(voice)`、有限數值邊界函式 `bounded(value, min, max, label = 'number')`、`LIMITS`、`MAX_BANK_BYTES` 與 `MAX_BANK_VOICES`。

要載入已部署的可信任 `examples.js` 模組，保留先前 **`opm-app/public/index.html`** 的 `#play` 與 `#status`，將其原本 module script **完整替換**為：

```html
<script type="module">
  import { OPM } from './opm/api/index.js';
  import { parseVoiceBank } from './opm/voices/schema.js';
  import { examples } from './opm/voices/examples.js';

  const opm = new OPM();
  const play = document.querySelector('#play');
  play.textContent = 'Play bank brass note';
  const status = document.querySelector('#status');
  play.addEventListener('click', async () => {
    play.disabled = true;
    try {
      await opm.start();
      const bank = parseVoiceBank(examples);
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

仍在 `opm-app` 根目錄以 `python3 -m http.server 8000 --directory public` 提供頁面。此例匯入套件所附的可信任模組；`parseVoiceBank` 仍支援外部 JSON 銀行。若接收不可信任的遠端下載，應由應用程式先限制來源、Content-Type 與下載大小，再讀取回應內容；合成引擎沒有內建網路下載 API。

## WAV 匯出與 DX7 匯入

在 **opm-app** 建立 `export.mjs`，執行 `node export.mjs` 會寫出立體聲 WAV：

```js
import { writeFile, readFile } from 'node:fs/promises';
import { renderNote, encodeWav } from 'opm.js/core';
import { brass } from 'opm.js/voices/brass.js';
import { importDX7, describeDX7 } from 'opm.js/voices/dx7.js';
const audio = renderNote({ voice: brass, duration: 0.7, velocity: 0.8, pan: -0.5 });
await writeFile('brass.wav', encodeWav({ left: audio.left, right: audio.right, sampleRate: audio.sampleRate }));
// 有檔案時：node export.mjs /實際路徑/voice.syx
if (process.argv[2]) {
  const bytes = new Uint8Array(await readFile(process.argv[2]));
  const voices = importDX7(bytes);
  console.log(describeDX7(bytes));
  const imported = renderNote({ voice: voices[0], duration: 1 });
  await writeFile('imported.wav', encodeWav({ left: imported.left, right: imported.right, sampleRate: imported.sampleRate }));
}
```

checkout 匯入改為 `./dist/core/index.js`、`./dist/voices/brass.js` 與 `./dist/voices/dx7.js`。`encodeWav({left,right?,sampleRate})` 回傳 PCM16 小端序 RIFF 位元組；省略 right 為單聲道。Float32Array 樣本須有限且在 −1–1，超界拒絕而非削波；立體聲長度須相同。取樣率整數 8000–192000，上限 4,000,000 影格。只傳這些自有資料欄位：整個 renderNote 結果有額外欄位，會被拒絕。編碼不會自動寫檔，範例頁使用 Blob 下載。

`importDX7(Uint8Array)` 只接受一個標準、完整框架的 **163-byte 單音色**或 **4104-byte／32 音色銀行** SysEx 訊息，驗證長度、框架、7-bit 資料與 checksum。原始 payload、串接訊息與其他格式會拒絕；結果是完整、正規化的版本 3 音色。`describeDX7` 對同一資料回傳各音色的 `{name,sourceAlgorithm,algorithm,selectedOperators,droppedOperators,warnings}`：原始 algorithm 為 1–32，轉換後 0–7；operator 編號為 DX7 的 1–6，selected 順序為 OPM 訊號順序。

這是以音樂實用性為目標的**六運算子轉四運算子有損啟發式轉換**，不是忠實 DX7 合成／模擬或無損音色交換。運算子與路由會縮減，包絡、力度敏感度、鍵位縮放、detune、LFO 皆近似；固定頻率以 MIDI 60 為參考轉比例並限制範圍，因此跨音域不會維持 DX7 的固定頻率行為。音高包絡、速率縮放、LFO 延遲／波形／同步不支援。請查看 warnings 並以[音色品質工具](./voice-quality.md)與試聽頁比較；轉換說明與音色 schema 分開。瀏覽器使用 `./opm/voices/dx7.js`、`new Uint8Array(await file.arrayBuffer())`，再以 `opm.loadVoice(voice.name,voice)` 註冊；不可信任檔案或下載須先限制大小再緩衝。

## 品質與發佈驗收

在 checkout 執行維護指令，不是在已安裝的套件中：

所有程式皆使用 strict TypeScript，包含 DSP、AudioWorklet、demo、測試與開發工具。`npm run compile` 將開發程式編譯到忽略追蹤的 `.dev/`，最低支援 Node.js 22；npm 指令會先編譯再執行。請使用 `npm test`，不要直接執行 `node --test`：它會選取編譯後的行為測試，不將 fixture 模組計為測試。`npm run build` 從實作產生 `.d.ts`、保留引擎模組路徑，並建置七個 HTML 範例所需的 `dist/demo/`；每個發佈 JS 都有對應 source map 與型別宣告。`npm run typecheck` 檢查原始碼、工具、測試、demo 及公開型別使用範例。使用者仍匯入 `.js`，不需要 TypeScript 或建置工具鏈。

```sh
npm ci
npm run build
npm test
npm run typecheck
npm run security -- --package-smoke
npx --no-install playwright install --with-deps chromium
npm run browser-smoke -- chromium
npm run benchmark
```

可改用 firefox／webkit 安裝與測試其他引擎。CI 設定 Node 22／24／26 與三種瀏覽器，但設定本身不代表執行成功；實測版本與結果以 CHANGELOG 為準。瀏覽器驗收觀察真正 AudioWorklet 訊號、有限輸出、生命週期／release 與發佈路徑。發佈前置條件、手動工作流程與 trusted publishing 設定見[發佈指南](./publishing.md)；本文件不表示已設定 registry 授權或已執行 npm publish。

Headless Linux Firefox 還需要運作中的原生音訊服務，只安裝瀏覽器函式庫並不足夠。CI 安裝 `pulseaudio`，執行 `pulseaudio --start --exit-idle-time=-1`、`pactl load-module module-null-sink sink_name=opm_ci`、`pactl set-default-sink opm_ci`，並以 `pactl info` 確認就緒後才執行 smoke。Null sink 僅丟棄喇叭輸出，仍保留原生音訊時鐘與真正 worklet graph；若初始化／resume 卡住，log 會列出等待階段及 context 狀態。

效能報告列出暖機後 128 影格區塊 p95／p99／最慢值與超過 `128/sampleRate` 秒的次數；`OPM_BENCH_BLOCKS`、`OPM_BENCH_WARMUP`、`OPM_BENCH_SAMPLE_RATE` 調整負載，p99／worst budget ratio 可設主機相關門檻。本機預設只報告；CI 設定 48 kHz 的 `OPM_BENCH_P99_BUDGET_RATIO=1`（2.667 ms），最慢值／GC 停頓僅報告，非所有平台即時保證。頻譜驗收比較 48 kHz 下折疊到 18 kHz 的 30 kHz 振盪器與同強度 1760 Hz 控制，要求至少 30 dB 衰減，不能宣稱所有 FM 無混疊。

另可在 checkout 執行 `npm run sound-quality`、`npm run voice-quality`、`npm run browser-stress -- chromium` 與 `npm run vite-smoke -- chromium`。品質矩陣涵蓋多取樣率、演算法、回授、音高、力度與多音；音色工具提供低／中／高音域與力度的 peak／RMS dBFS、建議宿主 trim 及 DX7 限制報告，並不自動重寫音色音量。詳細方法見[音色品質指南](./voice-quality.md)。已觀察到的矩陣通過與瀏覽器有限訊號，只證明所測條件；主執行緒事件間隔不等於 worklet CPU／GC 時間，也不能證明所有平台零爆音、任意 FM 無混疊或全部音色等響度。

## 壓縮部署

`dist/` 每個最小化 `.js` 都有對應 `.js.map` 與 TypeScript 自動產生的 `.d.ts`，包含 demo scripts。引擎保留來源模組路徑，不產生 hashed chunks；demo 無公開匯出，其宣告如實為 `export {};`。建置不產生 JSON 資產或壓縮側檔。Source maps 映射回並內嵌原始 TypeScript；發佈 maps 即公開這些原始碼供除錯。需要壓縮時由網站主機處理，程式仍匯入原本的 `.js` URL。伺服器送出壓縮內容時，須提供對應 `Content-Encoding`、`Vary: Accept-Encoding` 與 JavaScript MIME 類型；未壓縮回應不可標示為已壓縮。基本的 Python HTTP 伺服器可直接提供一般模組。整套 `dist` 須維持同一建置版本；詳見 README 的[最佳化發佈](../README.md#optimized-distribution)。

## 疑難排解

| 現象 | 修正方式 |
| --- | --- |
| `file://`、非安全來源或 AudioWorklet 不可用 | 使用支援 AudioWorklet 的現代瀏覽器，由 HTTPS 或 localhost 提供整個頁面與檔案。 |
| 瀏覽器無法解析 `opm.js` 裸套件名稱 | 使用複製的 `./opm/api/index.js` 相對 URL；如自行設定 import map，也要確保 worklet 的完整模組樹可讀取。 |
| worklet／模組 404，或拿到 HTML、MIME 類型錯誤 | 重新複製完整 `dist` 目錄並確認站點路徑；不要讓 SPA rewrite 將資產請求改送 `index.html`。 |
| 尚未啟動就播放、瀏覽器自動播放被擋 | 在點擊事件內 `await opm.start()` 後才呼叫 `playNote()`。 |
| 音高、名稱、延遲、時長或未知音色出錯 | 依[瀏覽器 API](#瀏覽器-api-與自訂音色)檢查範圍，先註冊自訂音色。 |
| 多音符遺失 | 檢查事件的 rejected／stolen 與診斷；注意八個邏輯聲部及有界事件／ID，分批排程。 |
| Node 無聲、找不到 WAV | PCM 不會自動播放／寫檔；依上方 WAV 範例編碼並儲存。 |
| Processor 失敗 | 處理 onEvent error 與拒絕的診斷請求，關閉／重啟；不要以不安全 fallback 掩蓋錯誤。 |
| npm 回報 E404 | 不假設 registry 有此套件；依[安裝步驟](#安裝與範例頁面)打包並安裝 checkout 的本機 tarball。 |
| 音色銀行格式錯誤 | 必須是完整音色組成的**陣列**，並符合名稱、欄位、數量與大小限制；單一 JSON 物件須包入 `[...]`。 |
| 壓縮回應顯示亂碼 | 設定正確的 `Content-Encoding` 與 MIME 類型，或直接提供未壓縮的 `.js` 模組。 |
