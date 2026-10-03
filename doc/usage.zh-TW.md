# OPM.js 使用說明（繁體中文）

[English](./usage.en.md) · [專案 README](../README.md) · [原始碼儲存庫](https://github.com/YueyuHoshizora/OPM.js)

GitHub Release **v1.9（套件 1.9.0）**加入可攜樂譜專案、Standard MIDI files、Arrangement 淡入淡出、自訂 MIDI CC 映射、Transport startupLead、兩首原創曲與可搜尋 HTML／完整 API 文件。保留 canonical v6 音色、表情控制、32 聲部與 Worker 匯出。GitHub 發佈不表示 npm 已上架。Node.js 需 22+；README 是公開契約。

音色格式版本與套件版本獨立：v1.9 與歷史 v1.7 使用 canonical v6；不可變的歷史 v1.6 Release 使用 v5。明確指定的舊音色版本 1–5 仍保留各自原有輸入格式。

- [安裝與範例頁面](#安裝與範例頁面)
- [瀏覽器靜態部署](#瀏覽器靜態部署)
- [瀏覽器 API 與自訂音色](#瀏覽器-api-與自訂音色)
- [Node.js 離線渲染](#nodejs-離線渲染)
- [音色格式與銀行載入](#音色格式與銀行載入)
- [壓縮部署](#壓縮部署)
- [疑難排解](#疑難排解)

## v1.9 新功能

**[HTTPS 線上範例](https://opm.js-package.xyz/)**需點擊播放按鈕才能啟動音訊。以下功能包含於 v1.9；歷史 Release 保持不變。GitHub Release 不表示 npm 上架或網站部署。使用端可直接安裝 Release tarball；原始碼貢獻者執行 `npm ci`、`npm run build`。

- `parseScoreProject(source: string | object)`／`serializeScoreProject(project)`讀寫 canonical version 1 專案：拍點 events、正規化 tempoMap／timeSignature、具名完整 voices 與 synthesis settings。預設為 120 BPM、4/4、44100 Hz、standard、8 聲部、mixGain 1、A4 440 Hz、oldest；嚴格 own-data 驗證且回傳 frozen snapshot。上限 8 MiB、65,536 events、128 voices／256 KiB 音色 JSON。`compileBeatSequence(events, { tempoMap?, bpm?, voices? })`轉為驗證過的秒制 `SequenceEvent[]`，供離線／Worker 渲染；Transport 直接使用拍點 events，先將具名音色載入 OPM。詳見[樂譜專案](./score-projects.md)。
- `importMidiFile(Uint8Array, options?)`回傳 `{ events, tempoMap, timeSignature, warnings }`；`exportMidiFile(events, options?)`回傳 `Uint8Array`，由 root、core 與 `opm.js/midi-file`匯出。僅支援 format 0／1 PPQN，嚴格拒絕截斷／損毀及超額資料。匯入預設將 sustain 納入音符長度、警告不支援的資料並拒絕未閉合音符；使用 channelVoices／defaultVoice 與匯出的 voiceChannels 明確映射 FM 音色。匯出拒絕 controls、非整數音高、非零 pan／priority、同音高配對歧義與 linear tempo ramp，不默默遺失表情。無 program-to-FM 轉換或 SysEx 傳送。詳見[MIDI 檔案](./midi-files.md)。
- `TransportOptions.startupLead`為 0–10 秒，預設 `min(0.05, horizon / 2)`：啟動／恢復／重建以未來時刻為原點，提前量期間維持音樂位置；0 可取消提前量。這修正歷史 beat-0 冷啟動缺陷，但不保證主執行緒停頓下的 deadline。
- Arrangement layer `gain`為 0–1（預設 1），`switchSection`／`setLayer`可指定 fade 0–10 秒；`setLayerGain(name, gain, { quantize?, fade? })`回傳提交拍點。共用 layer 不重新起音，gain 獨立乘上 expression，涵蓋自行擁有的 release tails 與新音符；layer score 的 gain controls 保留給 Arrangement，音樂力度請用 expression。詳見[自適應音樂](./adaptive-music.md)。
- `MidiAdapterOptions.controllerMap`至多 128 項，指定 controller、field、明確 min／max／ramp、選用 reset；operator tuple field 另需零起算 operator。重複 CC／target 與 CC64／120／121／123 拒絕。Scalar field 包含獨立 `NoteControls.gain`（0–1、預設 1）；CC121 恢復建立 adapter 時擷取的有效預設或 explicit reset，fixed-Hz 的 reset:null 回到 ratio mode。`performance.getPartControls(part)`回傳 frozen 有效聲部控制，不含個別 key override。詳見[MIDI 表情控制](./midi-performance.md)。
- 目前 checkout 建置 13 個 demo scripts，新增兩首原創歌曲的播放／停止、專案存取與 WAV 匯出；demo HTML 仍僅供 checkout／網站使用。

建置在 dist 輸出後產生 [HTML 文件](./index.html)與完整[編譯器產生的 API 參考](./api.html)，本機新建套件將它們放在 doc/；歷史套件不變。可直接開啟 doc/index.html，或連同頂層 Markdown／法律檔案部署整個 doc/。本機搜尋支援鍵盤，不需伺服器、遠端搜尋服務或 runtime dependencies；Markdown 仍是唯一文件來源。

## 安裝與範例頁面

需要 Node.js 22+ 與 npm。**不需 checkout 或建置工具鏈**即可在新專案安裝 GitHub Release 的附加套件：

```sh
mkdir opm-app
cd opm-app
npm init -y
npm install https://github.com/YueyuHoshizora/OPM.js/releases/download/v1.9/opm.js-1.9.0.tgz
```

v1.9 Release tarball 包含這份同步文件；原 v1.8 標籤與套件維持不變。若要從原始碼自行封裝，以下另一路徑先在 **OPM.js 儲存庫根目錄** 執行，`npm pack` 會自行執行建置（`prepack`），不必預先重複執行 `npm run build`：

```sh
npm ci
npm pack
```

此 checkout 的套件版本產生 `opm.js-1.9.0.tgz`。以下從儲存庫根目錄建立**同層的新專案** `opm-app`，假設 checkout 目錄名為 `OPM.js`；若名稱不同，請調整安裝指令中的路徑。若已用上面的 Release 路徑安裝，請跳過這段：

```sh
cd ..
mkdir opm-app
cd opm-app
npm init -y
npm install ../OPM.js/opm.js-1.9.0.tgz
```

既有專案只需在該目錄以 Release URL 或 tarball 的實際路徑執行 `npm install`，不需 `npm init`。此流程不假設已上架 npm registry；使用端不需建置依賴。封裝含 `dist` 的最小化 `.js` 模組、內嵌 TypeScript 原始碼的 `.js.map`、`.d.ts`、13 個 demo entry scripts、文件與法律檔案，不含獨立 TypeScript 原始碼檔案、tests、開發 scripts、13 個 HTML 範例頁面或 Vite 範例；維護指令應在 checkout 執行。

要直接試用儲存庫的範例，請在 **OPM.js 儲存庫根目錄** 啟動伺服器：

```sh
python3 -m http.server 8000
```

開啟 `http://localhost:8000/index.html` 查看 12 個範例：基本音符、前瞻排程、即時調變、共用 context、WAV、進階控制台、試聽、[共用樂譜／中斷恢復](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/sequence.html)、自適應音樂、表情樂器／MIDI、音色設計與音訊匯流排。HTML 頁面僅供 checkout 使用，頁面訊息為英文。Python 3 只提供本機 HTTP；既有 `dist` 不需安裝建置，原始碼／helper 改動後才執行 `npm ci`、`npm run build`。需 ES modules／AudioWorklet 與 HTTPS 或 localhost，不能用 `file://`。

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

Worker 匯出需要完整同版本樹，包括 companions、maps 與 declarations：

```text
public/opm/
├── api/
├── core/
├── worklet/
├── worker/render.js
└── voices/
```

Worker 為同源 HTTP(S) 靜態 module，不使用 blob／data／eval；正式 CSP 的 `worker-src`／`script-src` 應允許 `'self'`，資產須有正確 JavaScript MIME。不要把 worker 請求改寫為 SPA HTML。

使用 Vite 的獨立、子路徑部署範例見 [examples/vite/README.md（僅供 checkout）](https://github.com/YueyuHoshizora/OPM.js/blob/v1.9/examples/vite/README.md)：它安裝 tarball 並複製完整 `dist` 與 LICENSE，不依賴 npm registry 是否已上架。正式站點須提供正確 JavaScript MIME、真正的資產 404，且不得把 worklet 請求改寫成 SPA HTML；設定 CSP 時應使用外部 module script 與適當來源政策，不要為了範例的行內 script 放寬正式站點防護。部署安全細節見 [SECURITY.md](../SECURITY.md)。

已安裝套件也提供 `opm-assets`，可取代手動複製。從 `opm-app` 根目錄使用**尚不存在**的目的目錄：

```sh
npx --no-install opm-assets copy public/opm-1.9.0
npx --no-install opm-assets check https://your-host.example/opm-1.9.0/
```

第二行請換成實際部署 URL；本機可用 loopback HTTP。若採此目錄，頁面匯入路徑也須改為 `./opm-1.9.0/api/index.js`。copy 原子複製完整 dist／LICENSE、逐檔雜湊並建立 manifest，絕不覆寫既有目錄；check 比對實際回應的狀態、JavaScript MIME、`nosniff` 與 SHA-256，拒絕 redirect／SPA fallback，但不驗證頁面 CSP 或啟動音訊。一般 Python HTTP server 不提供 `nosniff`，不符合預設 check；正式主機須設定此標頭。完整契約見[宿主整合](./host-integration.md#other-bundlers-and-ssr-hosts)。

## 瀏覽器 API 與自訂音色

| API | 用法與限制 |
| --- | --- |
| `new OPM({ sampleRate, context, destination, workletUrl, onEvent, mixGain=1, tuning={}, stealing='oldest', interruption='cancel', quality='standard', maxVoices=8 }={})` | 整數 sampleRate 8000–96000 Hz；maxVoices 為整數 1–32，預設 8。quality／maxVoices 建構後不可變，close／重啟仍保留。借用 context 不會被關閉／暫停；省略 destination 接到其 destination，null 不自動接線。workletUrl 可改變同源完整 worklet 模組樹的位置，但不放寬安全來源、CSP 或 MIME 限制。 |
| `await opm.start()`／`await opm.resume()` | 在使用者互動中啟動／恢復並等待，再播放。並行啟動會合併；既有 context 被瀏覽器暫停後可恢復。 |
| `opm.connect(destination)`／`opm.disconnect(destination?)` | 對已啟動的輸出接線／斷線，回傳 opm；目的節點必須來自相同 context。省略斷線目的地會移除所有輸出連線。 |
| `opm.loadVoice(name, voice)` | 啟動前即可驗證、複製並註冊音色；名稱為 1–64 個 ASCII 英文字母、數字、`_` 或 `-`，registry 最多 128 筆。覆蓋只影響未來音符。 |
| `opm.voices` | `ReadonlyMap` 的防禦性快照；音色深度凍結。更換音色須用 `loadVoice`，修改取得的 Map 不會改變引擎。 |
| `opm.replaceVoiceBank(bank)`／`opm.exportVoiceBank()`／`opm.removeVoice(name)` | 完整驗證後原子替換；bank 是 JSON 字串或完整音色陣列，最多 128 筆／JSON 256 KiB。直接傳 `[]` 清空，但 JSON `"[]"` 依 parser 契約拒絕。export 回傳具名不可變音色的 canonical JSON（空銀行為 `[]`），上限 256 KiB。remove 回傳 boolean，不終止正在播放／排隊的快照。 |
| `opm.playNote({ voice='brass', note, time=0, at, duration=null, velocity=1, pan=0, voicePriority=0, late='start' })` | 有限 MIDI 小數 0–127；相對 time 0–60 秒或互斥的絕對 at（最多提前 60 秒）。duration 為 `(0,60]` 或 null 持續音；力度 0–1、聲像 −1–1、voicePriority 為整數 0–127。回傳正安全整數音符 ID，不代表接收成功。 |
| `opm.stop(id,{at,cancelControls}={})` | 一般 stop 取消待開始音符／開始 release，保留自然尾音的 automation。`cancelControls:true` 立即取消此 ID 的排隊 onset／control／off 並 release；cancelControls 欄位即使為 false，也不能與 at 共用。未知、終止或已 release 目標會回報命令拒絕。 |
| `opm.updateNote(id,controls,{at}={})` | 回傳命令 ID；待開始控制保留到 onset，release 中仍可更新。無效、inactive 或 queue-full 命令會回報拒絕。 |
| `opm.allNotesOff()`／`opm.panic()` | 回傳命令 ID，不受已滿排程佇列阻擋。前者取消待處理事件並自然 release；後者立即移除所有尾音並發出 reset，保留路由／快取。 |
| `opm.setMixGain(gain)`／`opm.setTuning(tuning)` | 須先啟動，回傳命令 ID；設定保留到 node 重建，不重設 phase／包絡。 |
| `await opm.getDiagnostics()` | 回傳 `{type:'diagnostics',requestId,activeVoices,pendingEvents,errors,rejectedNotes}`；context 須在 running，最多 64 個未完成請求。暫停／關閉／processor 失敗會拒絕待回覆請求，請先 resume 再重試。 |
| `await opm.close()` | 與初始化依序處理，斷開 node，只關閉自行建立的 context。再次啟動會重建自有 context；借用的 context 仍可由宿主使用。 |
| `opm.subscribe(listener)` | 獨立事件訂閱，回傳冪等的取消訂閱函式；各回呼例外隔離。 |
| `await opm.waitForCommand(commandId,{timeout,signal}={})` | 僅等待 admission：預設 5000 ms、整數 1–60000 ms，可由 AbortSignal 取消；最多 64 pending waits／128 receipts。拒絕拋出 CommandRejectedError；accepted 不是執行完成。 |
| `await opm.dispose()` | 終止式清理，不能重新啟動；close 仍可重新 start。 |

`onEvent` 除 note／diagnostics／error，新增 `{type:'command',command,commandId?,id?,state,reason?,frame,time}`、context 狀態與全域 reset。命令 state 為 accepted／rejected；accepted 只表示接收或立即套用，不保證未來一定執行。以 commandId 對應拒絕；frame／time 為音訊邊界而非回呼送達時間。reset 原因為 close／failure／panic／interruption，收到時清除自有 gate 紀錄；close／failure 不保證每音符終止回覆。回呼例外隔離。

遲到音符預設 `late:'start'`：在可用的第一個影格開始，數值 duration 從實際開始保留完整 gate；`late:'drop'` 則以 `reason:'late'` 拒絕，包含訊息處理延遲造成的遲到。同影格依序處理 stop、onset、controls；onset 前收到的控制保留到開始。

controls 為非空 own-data 物件：pitch −48..48 半音；glide 0..10 秒且須搭配 pitch；expression 0..1；pan −1..1；modulation 0..2（AM 上限 1、PM 1200 音分）；operatorLevels 是四個 0..2 的原音色 level 倍率。新增 feedback 0..7、lfoRate 0..20 Hz、amDepth 0..1、pmDepth 0..1200 音分；operatorRatios 為四個 0.125..32，operatorFrequencies 為四個 1..20000 Hz 或 null（恢復 ratio 模式），operatorADSR 為四個完整 `{a,d,s,r}`。ramp 0..10 秒獨立平滑指定的 scalar／level／ratio／frequency 欄位，省略／零立即生效；glide 獨立以半音線性滑動。phase／回授歷史保留，但 ADSR 從當前 dB 重新錨定：held 音重啟 attack，released 音開始新縮放 release（最多 10 秒），零 release 立即進入 filter drain。固定 Hz 仍跟隨 pitch 控制，忽略 tuning table 的移調。未知欄位、存取器、非有限／超界值拒絕。詳細控制語意見[表情音色](./expressive-voices.md)，宿主時鐘／生命週期見[宿主整合](./host-integration.md)。

v1.9 新增 gain（0–1、預設 1），獨立乘上 expression，依 ramp 平滑且不重啟 phase／包絡；Arrangement layer fade 使用這個獨立倍率。

最多 maxVoices 個邏輯聲部（1–32，預設 8），另有至多八個獨立約 5 ms 搶音淡出；增加 maxVoices 不增加淡出數。滿額時只能搶走 voicePriority 不高於新音符的聲部，先選最低優先權，再依 stealing 政策決定。全部較高時回報音符拒絕 `reason:'priority'`，不搶走既有音符。預設 oldest；release-first 優先最早 release，quietest 按 carrier 包絡 × 力度 × expression 比較，同分取最早，不以瞬間波形判定。事件／ID 各限 256，未來定時音符佔兩筆，控制／stop 也佔額度；終止會回收過期事件。預備音色採 128 槽 content-key LRU，重新驗證後替換／重用 ID，既有排程與聲部保留原快照。無 setLFO；速率／深度可用 updateNote，波形與目標屬於音色。

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

任何 non-running context 或 reset 都會停止前瞻排程並通知 onError，須由使用者互動明確重啟。預設 interruption:'cancel' 取消中斷前 gate／automation；preserve 只保留直接音符／佇列，不自動恢復前瞻計時器。


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
      if (event.type === 'reset') {
        id = undefined;
        if (event.reason === 'close' || event.reason === 'failure') connected = false;
      }
      status.textContent = event.type === 'error' ? event.error.message
        : event.type === 'note' ? `${event.id}: ${event.state}`
        : event.type === 'diagnostics' ? `Voices: ${event.activeVoices}`
        : event.type === 'command' ? `${event.command}: ${event.state} ${event.reason ?? ''}`
        : event.type === 'context' ? `Context: ${event.state}` : `Reset: ${event.reason}`;
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

### 共用樂譜、全域調音與安全恢復

mixGain 是有限 0–1（預設 1），在 **tanh 前**縮放；下游 GainNode 只控制聆聽音量，無法還原已產生的飽和失真。tuning 替換完整設定：referenceHz（A4）20–20000 Hz，offsets 可省略表示零，否則為恰好 128 個 −4800..4800 的有限音分。小數 MIDI 線性插值相鄰偏移，127 使用自身端點。即時調音保留 phase／包絡與原音符 key scaling。

保留 quick-start 的 play／status，將 module script 替換為：

```html
<script type="module">
  import { OPM, playSequence } from './opm/api/index.js';
  import { renderSequence } from './opm/core/index.js';
  import { brass } from './opm/voices/brass.js';
  const settings = { mixGain: 0.5, tuning: { referenceHz: 442 }, stealing: 'release-first' };
  const opm = new OPM({ ...settings, interruption: 'cancel' });
  const score = [
    { type: 'note', id: 1, time: 0, duration: 0.4, voice: 'lead', note: 60.5 },
    { type: 'control', id: 1, time: 0.1, controls: { pan: -0.5, expression: 0.7, ramp: 0.03 } },
  ];
  let playback;
  document.querySelector('#play').addEventListener('click', async () => {
    try {
      await opm.start();
      playback?.stop();
      opm.loadVoice('lead', brass);
      playback = playSequence(opm, score, { at: opm.context.currentTime + 0.05 });
      const audio = renderSequence(score, { ...settings, sampleRate: opm.context.sampleRate, voices: opm.voices });
      document.querySelector('#status').textContent = `Rendered ${audio.left.length} frames; errors ${audio.diagnostics.errors}`;
    } catch (error) { document.querySelector('#status').textContent = error.message; }
  });
  window.disposeOPM = async () => { playback?.stop(); await opm.close(); };
</script>
```

樂譜使用相對秒數；note 為唯一正 ID 與有限 duration，stop／control 指向同一樂譜音符。整份驗證後才派送；限 128 notes、256 保留槽（每音符兩槽加命令）、含 gate 的 60 秒及離線 4,000,000 影格。playSequence 回傳防禦性 scoreId→noteId Map 與冪等 stop，不會對其他 caller 原子保留 worklet 容量。renderSequence 包含尾音；相同 PCM 須設定／取樣率／相對影格原點一致且無其他競爭音符。WAV 僅傳 left／right／sampleRate。

以 HTTPS 在實體 iOS／Android 使用[第 08 範例（僅供 checkout）](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/sequence.html)，依[行動裝置驗收流程與支援矩陣](./mobile-acceptance.md)記錄裝置／OS／瀏覽器／取樣率／政策、觀察與手動 pass／fail／unverified 判定。涵蓋鎖屏、切換 app、來電、耳機／Bluetooth、節電、長播放與主執行緒停頓。報告僅留本機；桌面、headless 與 analyser 訊號不代表實機恢復或聽感不中斷。恢復須手勢；借用 context 由宿主管理。

### 有界長樂譜

24 小時／65,536 個輸入事件以內，改用 `opm.js/core` 的 `prepareLongSequence`、`estimateSequenceCapacity` 與 `renderSequenceChunks`。估算會分別列出整段 buffer／單批 eligibility 與預設串流視窗密度，並不保證和其他 caller 競爭時的 admission。每塊 PCM 是借用 buffer，下一次 `next()` 就會覆寫；立即消費，只有需要保留時才複製。break、`cancel()` 或 AbortSignal 停止前進，`maxFrames` 可限制累計工作量；整段 PCM／WAV 預算不變。

```js
import { estimateSequenceCapacity, renderSequenceChunks } from 'opm.js/core';
const score = [{ type: 'note', id: 1, time: 0, duration: 61, note: 60 }];
const options = { sampleRate: 96000, chunkFrames: 4096 };
console.log(estimateSequenceCapacity(score, options));
let frames = 0, energy = 0;
const render = renderSequenceChunks(score, options);
for (const chunk of render) {
  for (let i = 0; i < chunk.frames; i++) energy += chunk.left[i] ** 2;
  frames += chunk.frames;
}
console.log(frames, energy, render.diagnostics.errors);
```

瀏覽器播放時與 OPM 一起 import `streamSequence`，建立 `const stream = streamSequence(opm, score, { onError: console.error })`，再於播放按鈕手勢內 `await stream.start()`。`stop()` 僅取消此串流的音符；`dispose()` 移除 listener 並永久終止此實例。control、明確 stop 與自動 release 跨視窗保留 score ID 對應。兩種政策的 interruption／reset 都停止串流；先恢復 context，再由使用者明確重啟。完整瀏覽器配方、預設值與密度限制見[串流契約](./streaming-sequences.md)。

### 拍點 Transport 與演奏聲部

`createTransport`、`createArrangement`、`createPerformance`、`createMidiAdapter`、`requestMidiAccess`、`playSequence`、`streamSequence`、`renderSequenceInWorker` 與套件版本常數 `VERSION` 由根入口 `opm.js`（靜態部署為 `./opm/api/index.js`）匯出。Transport 事件以 beat 取代 time，note.duration 也以四分音符拍計算。提供 start／resume、pause／stop、seek、setTempo（從目前位置起）、setTempoMap、setLoop、pump、dispose 與 state／position／running／snapshot／ids。它使用 AudioContext 時鐘，只管理自有音符。

bpm 預設 120、範圍 1–1000；tempoMap 從 beat 0 開始嚴格遞增，最多 1024 點，拍點上限 86400。timeSignature 分子 1–32，分母為不超過 32 的二次冪；horizon 0.01–10 秒、interval 0.001–horizon/2、maxSlots 1–256。pause／seek／loop 重啟包絡與 phase，不是 DSP snapshot；重建當前 scalar／ratio ramp 與剩餘時間，最新 fixed-Hz／null 政策立即套用（即使 frequency ramp 未完成），最新 ADSR 在重啟 onset 重新錨定。純核心亦匯出 beatsToSeconds／secondsToBeats／beatToBarBeat／barBeatToBeat／normalizeTempoMap。

下方配方保留音樂上的一拍 count-in。目前 checkout 額外使用 startupLead（預設 min(0.05,horizon/2) 秒）將時鐘原點放在未來，避免 beat 0 冷啟動時提交到已過期時刻；歷史 v1.8.1 套件沒有這項修正。late:'drop' 仍會拒絕真正晚到的起音、停止 helper 並通知 onError。Count-in／startupLead 不保證宿主停頓下仍能準時；start() 完成也不是每個音符已發聲的確認。

`createPerformance(opm,{parts:16,maxKeys:128,maxKeysPerPart:128,onError})` 提供零起算 1–16 個聲部，各自 configurePart 設定 voice、poly／mono、legato、last／high／low 按鍵選擇 priority、glide 0–10 秒、pan ±1 與 expression 0–1；兩種 key 額度皆為 1–128。先在使用者手勢中 `await opm.start()`，再呼叫 noteOn；回傳實體 key ID，須用 `noteOff(part,key)` 釋放，同音高按鍵仍獨立。另有 updatePart、sustain、allNotesOff(part?)、getPart 與 dispose。實際 held keys 優先於踏板保留；mono legato 在原 onset ±48 半音內重用 gate／包絡／原力度與 key scaling，超出時以真實音高重觸發。被偷走的 key 會移除，不自動重入；中斷／reset 即使 preserve 也清除 helper 自有狀態。可直接執行的 Transport／Performance 配方見[宿主整合](./host-integration.md)與[串流樂譜](./streaming-sequences.md)。

v1.8 的 `updateKey(part,key,controls)` 對單一實體按鍵套用 NoteControls；未選取的 mono key 保留控制，不改動目前 gate。`updatePartNotes(part,controls)` 更新整個聲部的自有音符（含 release 尾音）與未來音符預設。configurePart 的 `voiceLimit` 為 1–32，自有 release 尾音也佔額度，滿額 noteOn 拋出 RangeError；它不增加引擎聲部數。`voicePriority` 為 0–127（預設 0），與 last／high／low 的按鍵選擇 priority 不同。

選用的 `createMidiAdapter(performance,await requestMidiAccess(),options)` 將使用者授權的 MIDI inputs 映射到聲部，支援 note、sustain、bend、wheel、volume／expression、pan、pressure 與 all-notes-off。匯入模組不會要求權限，永不要求 SysEx；disconnect／dispose 只釋放 adapter 自有按鍵。詳細配方與限制見[表情演奏與 MIDI](./midi-performance.md)及[第 10 範例（僅供 checkout）](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/instrument.html)。

### 速度曲線、網格與分層編曲

`TempoPoint` 為 `{beat,bpm,curve?,endBpm?}`；省略 curve 或 `'step'` 為定速段，`'linear'` 使 BPM 隨拍點線性變化至下一點 bpm 或指定 endBpm（僅 linear 可用；末點不可 linear）。beatsToSeconds／secondsToBeats 使用閉式對數積分與反函式。`quantizeBeat`、`swingBeat`、`swingBeatEvents` 從根入口 `opm.js` 匯入（純瀏覽器使用部署的 `./opm/api/index.js`），不是 `opm.js/core` 匯出；後者連同音符起點與終點一起套用 swing。

`createArrangement(opm,{layers,sections,initialSection,bpm?,tempoMap?,timeSignature?})` 在共用拍點網格上循環具名 layers；`switchSection`／`setLayer` 在不早於已接收音符的第一個量化邊界提交（預設 bar，也可 beat／拍數），回傳提交拍點。共用 layer 保持連續，不重觸發；移除 layer 預設在邊界 release，`preserveNotes:true` 可讓它自然結束。layer 與 note 的 voicePriority 取較大值，優先權拒絕計入 `snapshot.priorityDrops` 而不停止編曲，其他拒絕會停止並通知 onError。至多 16 layers、32 sections、65,536 events，每層循環長度至多 256 拍；只清理自有音符。Arrangement pause／resume 不還原跨越恢復點的持續音，只從後續 onset 繼續；它和 Transport 都不是 DSP checkpoint。公式、密度上限及可執行配方見[自適應音樂](./adaptive-music.md)與[第 09 範例（僅供 checkout）](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/adaptive.html)。

保留 quick-start 的按鈕／輸出並替換 module script，可直接試用兩種 helper：

```html
<script type="module">
  import { OPM, createTransport, createPerformance } from './opm/api/index.js';
  const opm = new OPM();
  const transport = createTransport(opm, [
    { type: 'note', id: 1, beat: 1, duration: 1, note: 60 },
    { type: 'note', id: 2, beat: 2, duration: 1, note: 64 }
  ], { bpm: 120, onError: console.error });
  const performance = createPerformance(opm, { parts: 1 });
  performance.configurePart(0, {
    voice: 'brass', mode: 'mono', legato: true, priority: 'last', glide: 0.1
  });
  document.querySelector('#play').addEventListener('click', async () => {
    try {
      transport.stop();
      await transport.start();
      const key = performance.noteOn(0, 67, { velocity: 0.7 });
      performance.sustain(0, true);
      performance.noteOff(0, key);
      document.querySelector('#status').textContent = 'Release pedal to stop held note';
    } catch (error) {
      document.querySelector('#status').textContent = error.message;
    }
  });
  const pedal = document.createElement('button');
  pedal.textContent = 'Release pedal';
  document.body.append(pedal);
  pedal.addEventListener('click', () => performance.sustain(0, false));
  window.disposeOPM = async () => {
    transport.dispose();
    performance.dispose();
    await opm.close();
  };
</script>
```

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

`new Synth(sampleRate,maxVoices=8,{mixGain,tuning,stealing,quality='standard'}={})` 需要有限 8000–192000 Hz 與整數 1–32 聲部（預設 8）；noteOn 接受有限小數 MIDI 0–127、嚴格力度／聲像、voicePriority 0–127（預設 0）及未占用正安全 ID。滿額且所有聲部優先權較高時拋出 `VoiceAdmissionError`，保留既有聲部。noteOff／updateNote 回傳 boolean；allNotesOff 自然 release，panic 移除所有尾音；設定 gain／tuning 不重設 phase／包絡。onVoiceEnded 每音符一次 stolen／ended／error／cancelled；lastStolenId 無搶音時為 null。

`prepareVoice(input)` 一次嚴格驗證並建立不可變的可信任快照；不能用型別斷言或自製物件偽造。`Synth.noteOn` 可重用此快照，原始音色輸入則仍逐次驗證。核心預先配置 `maxVoices + 9` 個狀態槽（maxVoices 個邏輯聲部、八個淡出與一個入列暫存槽；預設 17 個），重用預備音色不需每音符配置 Float64 狀態陣列，但這不是整個 JavaScript／瀏覽器零配置保證。`synth.updateNote(id, controls)` 使用前述控制範圍，成功回傳 true，未知／已終止 ID 回傳 false。

`onVoiceEnded` 可呼叫 noteOn／noteOff；回呼中新增的音符最早在下一影格渲染，不回頭改寫已計算的當前影格。不可在回呼中遞迴呼叫 render；引擎會拒絕。通知有固定工作上限，應保持回呼簡短。

`render(left,right,offset=0,length=nativeLeftLength-offset)` 需原生 Float32Array，非負安全整數範圍容納於兩個實際緩衝區。遮蔽 length／fill 不能增加工作，Proxy／偽造及需數值 coercion 的輸入拒絕。自行分段渲染／保留 release；currentFrame 為累計影格，errorCount 記錄數值失敗。

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

renderNote 也接受嚴格 mixGain／tuning／stealing／quality，與 renderSequence、分塊渲染及 Worker 共用。quality 為 eco（2×／四階）、standard（預設 4×／八階，保留原預設輸出）或 high（8×／八階）；不是無混疊或即時期限保證。模式取捨見[聲學品質](./acoustic-quality.md)，CPU 須在目標宿主測量。

此函式與 Synth 使用相同包絡、LFO、濾波、力度、聲像及飽和路徑。長度為 `ceil((duration+最長有效release+0.01)*sampleRate)`，包含 note-dependent rate scaling，上限 4,000,000 影格。飽和前聲像增益為 `sqrt(2)*cos/sin((pan+1)*pi/4)`；飽和後不保證感知音量恆定。

其他 `opm.js/core` 公開項目：`normalizeVoice`（嚴格驗證並產生獨立複本）、`prepareVoice`、`NoteControls`／`PreparedVoice` 型別、`envelopeAt(time, gate, adsr)`（以秒為單位的時間／gate 計算 dB 包絡對應振幅）、不可變的八種訊號圖 `ALGORITHMS`、`HEADROOM = 0.7`、`OVERSAMPLE = 4`、`MAX_RENDER_SAMPLES = 4000000`，以及整數 8000–96000 取樣率驗證器 `sampleRateValue`。

## 音色格式與銀行載入

參考 [voice.schema.js](../dist/voices/voice.schema.js) 的 `voiceSchema` 與 [examples.js](../dist/voices/examples.js) 的 `examples` 匯出。下列為**單一音色 JSON 物件**，四個 `ops` 順序是訊號演算法的運算子順序；若要作為銀行，必須用 `[` 和 `]` 包成**陣列**：

```json
{
  "version": 6,
  "name": "simple",
  "algorithm": 7,
  "feedback": 0,
  "modIndex": 4,
  "lfo": { "rate": 0, "amDepth": 0, "pmDepth": 0, "waveform": "sine", "amTargets": [1, 1, 1, 1], "pmTargets": [1, 1, 1, 1] },
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
| `version`／`name` | 目前 canonical 版本 6；explicit 1–5 僅接受各自原有欄位。v1 無 keyScale，v1／2 無 velocitySensitivity，v1–3 無 waveform，v1–4 不接受 v5 欄位；v5 不接受 v6 targets。名稱為 1–64 ASCII 字母／數字／底線／連字號。 |
| `algorithm`／`feedback`／`modIndex` | 前兩者是 0–7 的整數；調變強度 `modIndex` 是 0–16。 |
| 四個 `ops` 各項 | 必須提供 `ratio` 0.125–32、`level` 0–1、`detune` -1200–1200 音分，以及 `adsr` 的 `a`、`d`、`s`、`r`；`a`／`d`／`r` 是 0–10 秒，`s` 是 0–1。 |
| `lfo` | rate 0–20 Hz、amDepth 0–1、pmDepth 0–1200 音分；waveform 為 sine（預設）、triangle、saw 或 square。 |
| `ops[i].keyScale` | 可省略表示平坦；breakpoint 為 MIDI 整數 0–127，leftDbPerOctave／rightDbPerOctave 為 0–24 dB／八度。 |
| `ops[i].velocitySensitivity` | 從版本 3 起可選，0–48 dB，省略為 0；定義 velocity=0 時的運算子衰減。 |
| `ops[i].frequency`／`ops[i].rateKeyScale` | v5 可選固定頻率 1–20000 Hz（ratio 仍必填）、速率鍵位縮放 0–4；ADSR 時間乘 `2 ** (-scale*(note-60)/12)` 並限制為最多 10 秒。 |
| `pitchEnvelope` | v5 可選 `{a,d,r,initial,peak,sustain,final}`；時間 0–10 秒、音高 −4800..4800 音分；release 從目前音高連續開始。 |
| `lfo.delay`／`lfo.sync`／`lfo.phase` | v5 可選 0–10 秒、note／global、0–1 圈，預設 0／note／0；delay 門控深度，不停止 phase 時鐘。 |
| `lfo.amTargets`／`lfo.pmTargets` | v6 可選各四個 0–1 權重；boolean 輸入正規化為數字。省略為 `[1,1,1,1]`，依運算子順序套用。 |

單一音色可省略 version／name／lfo／modIndex，仍需 algorithm／feedback 與四個完整運算子。預設目前格式、modIndex 4、LFO off／sine，輸出統一版本 6；舊版 1–5 嚴格保留原始形狀，不得挾帶後來欄位。內建音色與 DX7 匯出也採 canonical v6。所有路徑拒絕錯誤型別、未知欄位、存取器及稀疏陣列，嚴格路徑另拒絕超界數字。鍵位縮放依原音符；pan 屬於音符。完整組合語意見[表情音色參考](./expressive-voices.md)。

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

checkout 匯入改為 `./dist/core/index.js`、`./dist/voices/brass.js` 與 `./dist/voices/dx7.js`。`encodeWav({left,right?,sampleRate,format='pcm16'})` 回傳小端序 RIFF 位元組，format 可為 pcm16／pcm24／float32；省略 right 為單聲道。所有格式的 Float32Array 樣本須有限且在 −1–1，超界拒絕而非削波；立體聲長度須相同。取樣率整數 8000–192000，上限 4,000,000 影格。只傳這些自有資料欄位：整個 renderNote 結果有額外欄位，會被拒絕。編碼不會自動寫檔；短預覽可使用有明確記憶體預算的 Blob，長檔案須直接寫 sink。

增量 `createWavEncoder({sampleRate,channels:1|2,format,totalFrames})` 由 `opm.js/core` 匯出：先寫一次 `header()`，每次 `encode({left,right?})` 消費 1–65536 影格並回傳有界位元組，最後寫 `finalize()`（精確影格數與 RIFF padding）。它不保留完整 PCM／輸出，不受完整 buffer 的四百萬影格限制；仍受 RIFF32 大小與 24 小時加 release 預算限制。

瀏覽器長檔案用 `renderSequenceInWorker(score,{sampleRate,chunkFrames,quality,format,sink,signal,onProgress})`，sink 提供 `write(bytes)` 與可選 close／abort，write 可回傳 Promise 施加 backpressure；最多一塊編碼資料未確認。progress 提供 frames／totalFrames／bytesWritten／errors，結果為 capacity／format／bytesWritten／diagnostics。AbortSignal 取消立即終止 Worker 並拒絕，不等待卡住的 write／abort；sink 負責回滾／失效化未完成寫入。此 helper 僅限瀏覽器，純核心／Node 離線工具仍可用。可指定同源靜態 workerUrl，預設為樹內 `worker/render.js`。增量 WAV 契約與可執行的 Worker file sink／取消配方見[宿主整合](./host-integration.md)，長 PCM 消費配方見[串流樂譜](./streaming-sequences.md)。

Worker 在模組載入／解析／求值後送出 `{type:'ready',protocol:1}`，宿主收到有效 ready 才傳送樂譜。`startupTimeoutMs` 是選用整數 1–2,147,483,647 ms 的模組啟動 watchdog，僅從 Worker 建立量到 ready，逾時以 TimeoutError 拒絕並終止 Worker／abort sink，不限制渲染或慢速寫入。`phaseDiagnostics:true` 在成功結果的 `diagnostics.phases` 保留 initializing／rendering／writing／closing 與總時間；`onPhase` 同步通知轉換及 completed／cancelled／failed，回呼拋錯會使工作失敗。這些是宿主 wall-clock 時間，並非 DSP benchmark。

**沒有內建整體期限或自動重試**；可用 `signal:AbortSignal.timeout(300000)` 對整份工作設五分鐘政策。取消不等待卡住的 write／abort；sink 仍須失效化已寫入的部分輸出。完整診斷、deadline 與回滾配方見[Worker 診斷](./worker-diagnostics.md)。

[第 08 範例（僅供 checkout）](https://github.com/YueyuHoshizora/OPM.js/blob/v1.8/examples/sequence.html) 提供真正 Transport／Performance、控制／品質／銀行／WAV 格式預覽與長檔案 Worker sink／取消。長檔案僅用 File System Access，不聚合成 Blob；短預覽有明確 8 MiB 記憶體預算。

`importDX7(Uint8Array)` 只接受單個框架／checksum 正確的 **163-byte 單音色**或 **4104-byte／32 音色銀行**；拒絕原始、串接或非 7-bit payload，輸出完整版本 6 音色。describeDX7 回傳 name／sourceAlgorithm／algorithm／selectedOperators／droppedOperators／warnings；原 algorithm 1–32、轉換後 0–7，operator 編號依 DX7 的 1–6。

這仍是**六運算子轉四運算子的有損音樂啟發式轉換**，不是 DX7 合成／模擬。固定 Hz 運算子會保留；力度／速率鍵位縮放、減少階段的 pitch envelope 與 LFO delay／sync 採近似。下降 saw／sample-and-hold 波形以其他波形替代並附 warning；路由、oscillator sync、transpose 與包絡細節仍有損。轉換器將所選運算子的 AM sensitivity 簡化成共用深度，不保留逐運算子 AM，也不映射至選擇性 v6 amTargets。先看 descriptions、[表情音色與轉換限制](./expressive-voices.md)及[音色品質](./voice-quality.md)再試聽；不可信任檔案／下載仍須先限制大小。

## 品質與發佈驗收

在 checkout 執行維護指令，不是在已安裝的套件中：

所有程式皆使用 strict TypeScript；compile 輸出忽略追蹤的 .dev，npm test 編譯並選擇行為測試，不用裸 node --test。目前 build 由實作產生宣告、保留引擎路徑並建置 13 個 demo entry scripts，再由 Markdown 與輸出宣告產生靜態 HTML 文件；歷史 v1.8.1 為 12 個 scripts。每個 JS 配對 map／型別，typecheck 包含 source／tools／tests／demo／公開型別；使用端仍只需 JS，不需建置工具鏈。

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

可改用 firefox／webkit 安裝與測試其他引擎。CI 設定 Node 22／24／26 與三種瀏覽器，但設定本身不代表執行成功；實測版本與結果以 CHANGELOG 為準。瀏覽器驗收觀察真正 AudioWorklet 訊號、有限輸出、生命週期／release 與發佈路徑。發佈前置條件見[發佈指南](./publishing.md)；本儲存庫沒有 npm publish workflow，本文件也不表示已設定 registry 授權或已執行 npm publish。

Headless Linux Firefox 還需要運作中的原生音訊服務，只安裝瀏覽器函式庫並不足夠。CI 安裝 `pulseaudio`，執行 `pulseaudio --start --exit-idle-time=-1`、`pactl load-module module-null-sink sink_name=opm_ci`、`pactl set-default-sink opm_ci`，並以 `pactl info` 確認就緒後才執行 smoke。Null sink 僅丟棄喇叭輸出，仍保留原生音訊時鐘與真正 worklet graph；若初始化／resume 卡住，log 會列出等待階段及 context 狀態。

效能報告列出暖機後 128 影格區塊 p95／p99／最慢值與超過 `128/sampleRate` 秒的次數；`OPM_BENCH_BLOCKS`、`OPM_BENCH_WARMUP`、`OPM_BENCH_SAMPLE_RATE` 調整負載，p99／worst budget ratio 可設主機相關門檻。本機預設只報告；CI 設定 48 kHz 的 `OPM_BENCH_P99_BUDGET_RATIO=1`（2.667 ms），最慢值／GC 停頓僅報告，非所有平台即時保證。頻譜驗收比較 48 kHz 下折疊到 18 kHz 的 30 kHz 振盪器與同強度 1760 Hz 控制，要求至少 30 dB 衰減，不能宣稱所有 FM 無混疊。

另可在 checkout 執行 `npm run sound-quality`、`npm run voice-quality`、`npm run browser-stress -- chromium` 與 `npm run vite-smoke -- chromium`。品質矩陣涵蓋多取樣率、演算法、回授、音高、力度與多音；音色工具提供低／中／高音域與力度的 peak／RMS dBFS、建議宿主 trim 及 DX7 限制報告，並不自動重寫音色音量。詳細方法見[音色品質指南](./voice-quality.md)。已觀察到的矩陣通過與瀏覽器有限訊號，只證明所測條件；主執行緒事件間隔不等於 worklet CPU／GC 時間，也不能證明所有平台零爆音、任意 FM 無混疊或全部音色等響度。

獨立驗收含 Bessel PM、收斂／全強度回授能量界限、獨立四運算子串接／分支／多 carrier 參考，以及兩段 120 秒 LFO／glide 串流。4× 八階 Butterworth decimator 以相位／延遲取捨換取較平坦的可聽 passband 與受控 stopband 衰減；詳見[聲學參考數學與限制](./acoustic-quality.md)。這些不是任意音色、聽感、實體裝置或硬體保真保證。

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
| 多音符遺失 | 檢查事件的 rejected／stolen 與診斷；注意 maxVoices 1–32（預設 8）、voicePriority 拒絕、聲部自有 voiceLimit 及有界事件／ID，分批排程。 |
| Node 無聲、找不到 WAV | PCM 不會自動播放／寫檔；依上方 WAV 範例編碼並儲存。 |
| Processor 失敗 | 處理 onEvent error 與拒絕的診斷請求，關閉／重啟；不要以不安全 fallback 掩蓋錯誤。 |
| npm 回報 E404 | 不假設 registry 有此套件；依[安裝步驟](#安裝與範例頁面)安裝 GitHub Release tarball 或 checkout 封裝的本機 tarball。 |
| 音色銀行格式錯誤 | 必須是完整音色組成的**陣列**，並符合名稱、欄位、數量與大小限制；單一 JSON 物件須包入 `[...]`。 |
| 壓縮回應顯示亂碼 | 設定正確的 `Content-Encoding` 與 MIME 類型，或直接提供未壓縮的 `.js` 模組。 |
