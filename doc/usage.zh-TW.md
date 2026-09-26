# OPM.js 使用說明（繁體中文）

[English](./usage.en.md) · [專案 README](../README.md)

OPM.js 提供瀏覽器的 `OPM`（AudioWorklet 即時合成）與不依賴 Web Audio 的 `Synth`（Node.js 離線渲染）。目前公開 API 仍可能在 1.0 前變動。

## 啟動與瀏覽器播放

需要支援 ES modules、AudioWorklet 的瀏覽器，並透過 HTTPS 或 localhost 提供檔案；直接開啟 `file://` 頁面不適用。在專案根目錄執行：

```sh
python3 -m http.server 8000
```

開啟 `http://localhost:8000/demo/index.html`，點擊 **Play chord** 即可試聽。自行建立頁面時，可將以下內容存為 `demo/my-demo.html`，從相同伺服器開啟；`start()` 應由使用者點擊等互動觸發，以符合瀏覽器的播放政策。

```html
<button id="play" type="button">Play</button>
<script type="module">
  import { OPM } from '../src/api/index.js';

  const opm = new OPM();
  document.querySelector('#play').addEventListener('click', async () => {
    await opm.start();
    opm.playNote({ voice: 'brass', note: 60, duration: 0.5 });
  });
</script>
```

`brass` 是內建音色。`playNote({ voice, note, time, duration })` 回傳音符 ID：`note` 為 MIDI 整數 0–127；`time` 是從目前 AudioContext 時間起算的延遲秒數（預設 0，最多 60）；`duration` 為必填秒數，範圍 `(0, 60]`。`voice` 可用已註冊的名稱（預設 `brass`），也可直接傳音色物件。至多同時發聲八個音符，第九個會取代最早建立者；Worklet 最多保留 256 筆待處理事件。

若要載入自訂名稱並提前釋放音符，可將上述頁面的 `<script type="module">` 改為：

```html
<script type="module">
  import { OPM } from '../src/api/index.js';
  import { brass } from '../src/voices/brass.js';

  const opm = new OPM();
  document.querySelector('#play').addEventListener('click', async () => {
    await opm.start();
    opm.loadVoice('my-brass', brass);
    const id = opm.playNote({ voice: 'my-brass', note: 64, time: 0.1, duration: 1 });
    setTimeout(() => opm.stop(id), 300);
  });
</script>
```

`stop(id)` 可取消尚未開始的排程，或提前啟動發聲中音符的 release；不再使用時呼叫 `await opm.close()` 關閉 AudioContext。`close()` 後若要再次播放，須重新 `start()`。

## Node.js 離線渲染

需要 Node.js 18+。在專案根目錄建立 `render.mjs`：

```js
import { Synth } from './src/core/index.js';
import { brass } from './src/voices/brass.js';

const sampleRate = 44100;
const synth = new Synth(sampleRate);
const id = synth.noteOn(brass, 60);
const left = new Float32Array(sampleRate);
const right = new Float32Array(sampleRate);
synth.render(left, right, 0, sampleRate / 2); // 前 0.5 秒
synth.noteOff(id);
synth.render(left, right, sampleRate / 2, sampleRate / 2); // release
console.log(left.some(sample => sample !== 0), synth.errorCount);
```

執行 `node render.mjs`；`render(left, right, offset, length)` 寫入等長區間的 `Float32Array`（左右聲道目前輸出相同）。`noteOff(id)` 會從目前已渲染的時間啟動 release；若要收完較長的尾音，請延長後續渲染緩衝區。此範例產生 PCM 樣本，**不**會寫出 WAV 檔。

## 音色格式

完整 JSON 音色銀行項目為版本 1；請參照 [voice.schema.json](../src/voices/voice.schema.json) 和 [examples.json](../src/voices/examples.json)。四個 `ops` 按訊號順序排列：

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

- `algorithm`、`feedback` 為整數 0–7；`modIndex` 為相位調變強度 0–16。
- 每個運算子的 `ratio` 為頻率倍率（0.125–32）、`level` 為振幅（0–1）、`detune` 為音分（±1200）；ADSR 的 `a`/`d`/`r` 以秒為單位（0–10），`s` 為 0–1。
- `lfo.rate` 為 0–20 Hz，`amDepth` 為 0–1，`pmDepth` 為 0–1200 音分。
- 直接傳給 `playNote()`、`loadVoice()` 或 `Synth.noteOn()` 的單一音色可省略 `version`、`name`、`lfo`、`modIndex`；後兩者預設為停用 LFO 與 4。超界或非有限數值會被拒絕。
- 讀取完整 JSON 音色銀行時可用 `parseVoiceBank()`（`src/voices/schema.js`）：每個項目必須含上述全部欄位；最多 128 種音色，JSON 字串最多 256 KiB。此匯入路徑會將**有限**但超界的數值限制在 Schema 範圍內，非有限數值與未知欄位仍會拒絕。銀行回傳 `Map<name, voice>`。

```js
import { parseVoiceBank } from '../src/voices/schema.js';
const response = await fetch('../src/voices/examples.json');
const bank = parseVoiceBank(await response.text());
for (const [name, voice] of bank) opm.loadVoice(name, voice);
```

上例同樣是放在 `demo/` 中的 module script，且 `opm` 已先建立；`fetch` 路徑以該頁面為基準。音色物件由引擎正規化並複製，後續修改傳入物件不會改變已發聲的音符。
