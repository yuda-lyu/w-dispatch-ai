# 規則帳本:opencode 免費池用盡／免費層 429／訂閱到頂即時終止(R-OCLIMIT-1、R-OCLIMIT-2)

本檔自 2026-11-15 wda156(Gitea #156,使用端回報)起單列(全域 §14:依類型分檔);2026-11-16 wda158(Gitea #158)增 R-OCLIMIT-2(訂閱 `opencode-go` 到頂).索引見 `sgud/rule/rulebook.md`.規則以「程式碼須長成什麼樣」為單位,附盤點指令、站點全集與判準.

來源:使用端以呼叫端直呼 `dispatchOpencode` 撞到免費池用盡(`Free usage limit reached`)時 `opencode run` 不結束,本套件以 TIMEOUT 回報、每次嘗試耗滿 `timeoutMs`(使用端實況:兩個節點各空等 7,202 秒).主控判定根因在本套件,建議檔要求:讀到主要請求之該類錯誤列即樹狀終止、數秒內回 `errorType: 'quota'`、遞補層以額度冷卻改派.呼叫端契約:`r.ok === false && r.errorType === 'quota'` = 因額度而未完成(不讀 stderr、不自行終止;另一派工同時依此改呼叫端,**不得改名**).

## R-OCLIMIT-1 主要請求之免費池用盡／免費層 429 ⇒ 樹狀終止、可判讀之分類、不重試、遞補改派

1. **ERROR 列之取得**(`src/dispatchOpencode.mjs` 以 `logFlagsToAdd`,`src/opencodeLimit.mjs`):`stopOnLimit`(預設 true)時,呼叫端未給任何 `--print-logs` 形式(`--print-logs`、`--print-logs=…`、`--no-print-logs`)者補 `--print-logs`,且未給 `--log-level`(含 `--log-level=…`)時另補 `--log-level ERROR`;已給 `--print-logs` 類者一律不補(其層級原樣).位置:固定旗標(`run --agent X [-m M] [--format json]`)之後、`extraArgs` 之前.**不採讀日誌檔**:日誌檔為多行程共用之累積檔,同模型並行無從歸屬(`state_diag.md` 已知缺口),據以終止會誤殺;stderr 為本行程專屬.
2. **判準**(`classifyLimitLine`):去 ANSI 與行尾 CR 後以頂層 key=value 解析(`parseLogFields`;引號內文字不當欄位,外審 terra #16)①`level` 為 `ERROR` ②有 `agent` 欄且值非 `title` ③`mode` 欄存在時須為 `primary`(子 agent 不算主要請求,外審 terra #17)④`providerID=opencode` ⑤原因(`error.error`,其次 `error`、`message`)含 `Free usage limit reached` ⇒ `quota`;含 `Rate limit exceeded` **且 `modelID` 以 `-free` 結尾** ⇒ `rate-limit`(本機日誌之 429 列皆為 `-free` 模型;按量模型之 429 無實例,不臆測,外審 terra #18).其餘(含舊版非 key=value 格式、`opencode-go`〔訂閱到頂之專屬字樣例外,見 R-OCLIMIT-2〕、第三方 provider、無後綴之免費模型之 429)不判,退回修前(等到逾時).
3. **逐行**(`createLimitWatch`):只判完整行(跨區塊於收到換行時才判);超過 `LINE_MAX`(64 KiB)之行不論是否跨區塊一律捨棄、不判(外審 terra #9);先去色碼再比對 `level=ERROR`(外審 agy #10);每次嘗試(spawn 事件)重置、至多觸發一次;保留本次嘗試之 ERROR 列(至多 50 行、每行 4000 字元)供上游原因.
4. **終止**(`src/killProcessTree.mjs`):判中即發 `onTrace` 事件 `limit-stop { kind, pid }`(先於終止),以該次 spawn 事件之 pid 樹狀終止.Windows:`execFile('taskkill', ['/F','/T','/PID',pid], { windowsHide: true, timeout: 15000 })`(不經 shell);其他平台:`execFile('ps', ['-A','-o','pid=,ppid='])` 一次列舉、由深至淺 `process.kill(pid,'SIGKILL')`、最後終止根,`ps` 失敗只終止根(錯誤由 callback 承接——不用 tree-kill:其 spawn 未監聽 `error`,`ps` 不存在時令呼叫端崩潰,外審 terra #4);列舉當下之子孫才終止、未於真實 Linux／macOS 實測為已知限制.永不 reject.`dispatchOpencode` 等終止完成(上限 20 秒)後才回傳.已知限制(外審 terra #2／#3):終止失敗時須等 `execCli` 逾時;`execCli` 之「樹殺後 3 秒仍未 close 即定案」後若重試,舊行程遲到之 stderr 仍進監看(`execCli` 之 `onStderr` 不分嘗試)——皆須終止失敗在先,未處理.
5. **結果**:最後一次嘗試判中且 `ok !== true` 者——`quota`:`errorType: 'quota'`、`failureKind: 'no-credit'`;`rate-limit`:`errorType` 不動(被終止之子行程為非零離開 ⇒ `exec`)、`failureKind: 'rate-limit'`;兩者帶 `failureDetail`(遮蔽、折行、至多 200 字元)、`errorDetail.upstream`(**觸發終止之該列**原因,同區塊其後之他列不取代)、`error` 加分類(`Exit code 1 [Free usage limit]: …`/`[rate limit]`).子行程於終止前已自行以 0 結束者**亦回失敗**(不等 validate;`error` 為 `Exit code 0 [分類]: …`、stdout 裁 500、去掉 `finish`／`outputChars`、加 `errorDetail`;外審 terra #1).
6. **不重試**(`src/runExecCli.mjs` 內部鍵 `stopRetryIf`):命中之結果為最終結果——不跑 `maxRetries`、不做暫時性重試(`canTransient` 先判 `!isStop`)、不做非驗證失敗之接管重試.wsemi `execCli` 內部重試無法中途喊停(終止後離開碼 1 屬可重試),故給了 `stopRetryIf` 且 `maxRetries > 0` 時由 `runExecCli` 接管(交 `execCli` 之 `maxRetries` 為 0):無驗證路徑沿用 R-COOL-4 之接管迴圈(事件序列同 `execCli`;無期限時沿用首次之逾時、不重新守門);有驗證路徑於無期限時(`stopOnly`)以「一次 `execCli` 呼叫」為虛擬呼叫逐項比照修前:虛擬呼叫內先用完 `maxRetries` 才考慮暫時性重試、間隔以虛擬呼叫內次數計、不重新守門(`skipGate`)、事件序列相同(`traceTakeover`＋`flushVc` 補發單一 `done`);有期限者沿既有(暫時性重試先、接管重試後、重新守門).驗證不過之重試亦先判 `isStop`.`maxRetries` 為 0 或未給 `stopRetryIf` 者逐位元同修前.(初版之路徑 B 順序與事件序列異於修前,外審 agy-hydrogen #5／#6 指出後改正.)
7. **上游原因之來源**:日誌列印到 stderr 者(`logsOnStderr`)由本次 stderr 之 ERROR 列取(`upstreamFromLines`:`provider/model` 相符、非 title 優先、其次最後一筆),**不讀日誌檔**(opencode 帶 `--print-logs` 時不寫入日誌檔——本機實測成功路徑 0 位元組 vs 17490 位元組;失敗路徑為同一日誌初始化,推定相同、未以失敗實例實測);否則照 R-FAILDIAG-3 讀日誌檔.
8. **遞補層**(`src/dispatchAiFallback.mjs`):實際嘗試回 `errorType 'quota'`＋`failureKind 'no-credit'`(`isAdapterQuota`;**免費池用盡不論有無金鑰**——免費池用盡與金鑰無關,`providers.mjs` 檔頭診斷段①,外審 terra #7;**訂閱到頂〔`limitScope: 'key'`〕且條目有金鑰者例外,見 R-OCLIMIT-2 第 5 點**)⇒ ①內建冷卻觸發 `reason: 'quota'`(固定視窗,先於 `coolDetect`,亦先於逾時字樣;`cooldownMs > 0` 且明給 id;已在他原因有效視窗內者依 R-COOL-2 只更新 at)②**整組跳過**(`skip-group`)、改派下一條目③不計持久連敗(`adapterQuota`)④不判為 `budget-cut`(外審 terra #5)⑤不標 `quotaExhausted`(未逐把確認).429 ⇒ 既有 `failureKind === 'rate-limit'` 冷卻.`quota-skip`(Go 與訂閱類之合成結果)在派送前 `continue`,不經此處——語意不變.
9. **不臆測**:`opencode-go`(訂閱)之 429 與免費池字樣、其他視窗(5 小時、月)到頂之字樣無實例,不判、不寫推測字樣;訂閱到頂(週視窗)已有實例,見 R-OCLIMIT-2(原「訂閱到頂無實例」於 2026-11-16 由使用端實測取代).
10. **退回路徑**:`stopOnLimit: false` ⇒ 不補旗標、不監看、讀日誌檔,與修前逐位元相同;呼叫端明示 `--print-logs=false`/`--no-print-logs` ⇒ 無從監看,同 false.

## R-OCLIMIT-2 訂閱(`opencode-go`)到頂 ⇒ 同樣樹狀終止並回額度類失敗,另帶範圍與重置資訊;遞補層改換組內下一把金鑰(2026-11-16 wda158,Gitea #158;使用端修改案,本庫採納並增修)

來源:使用端把一把已訂閱 Go 之金鑰之週視窗打到 100%(用量端點於同一秒回 `limited: true`、`limitedWindows: ['weekly']`),以真實 opencode 1.19.5 實測:主要請求收到下列錯誤後 `run` 不結束、不重試、不再輸出(到頂當下進行中之 3 個請求、到頂後另起之 2 次極小請求、一個工作到第 16 步之 agent 皆然;前 5 者等滿 240 秒逾時,後者 10 分鐘無紀錄後由使用端終止).修前本套件以 `errorType: 'timeout'` 回報,與一般逾時無從分辨.使用端另以修改版對同一把到頂金鑰實測:約 5 秒回 `quota`(修前原版 60 秒逾時).

1. **實例之錯誤列**(工作區代號以 `<…>` 代替):`… level=ERROR … message="stream error" providerID=opencode-go modelID=deepseek-v4.1-flash … small=false agent=build mode=primary error.error="AI_APICallError: OpenCode Go usage limit reached (weekly, resets in 5h 3m). To keep going now, turn on Extra Usage or upgrade to Go Plus at https://opencode.ai/console/<工作區代號>/go."`;新開之 session 另有 `small=true agent=title` 之 `AI_RetryError: Failed after 3 attempts. Last error: OpenCode Go usage limit reached (…)`.帶 `--print-logs --log-level ERROR` 者該列約 25 秒出現於 stderr;不帶者 stdout 空、stderr 只有 session 標頭.重置所餘隨時間遞減(`resets in 4h 55m`).
2. **判準**(`classifyLimitLine`;R-OCLIMIT-1 第 2 點之①②③沿用):`providerID=opencode-go` 且原因含 `OpenCode Go usage limit reached`(不分大小寫,同 `RE_QUOTA`)⇒ `quota`,回傳另帶 `scope: 'key'`(額度綁該金鑰所屬之訂閱)與 `parseGoLimit` 可解析時之 `window`(小寫視窗名)、`resetsInMs`(`resets in` 之後每一詞皆為「整數+d/h/m/s」才帶,有一詞不合即整段不採;括號須緊接專屬字樣 `OpenCode Go usage limit reached` 之後,文字內他處之 `usage limit reached (…)` 不取,外審 terra #5).**不以視窗名為判準**;`opencode-go` 之 429 與免費池字樣、`providerID=opencode` 出現訂閱字樣者皆不判.
3. **結果**(`dispatchOpencode`):同 R-OCLIMIT-1 第 5 點之 `quota` 形狀(`errorType: 'quota'`、`failureKind: 'no-credit'`、`failureDetail`、`errorDetail.upstream`),`error` 之分類詞 `[Go usage limit]`(`UPSTREAM_CLASSES`);另帶 `limitScope: 'key'`、`limitWindow`、`limitResetsInMs`、`limitUntil`(判中時刻〔`onHit` 當下,每次 spawn 重置〕加重置所餘,ISO 字串;字樣只到分鐘,精度為分鐘級)——解析不到者不帶;免費池用盡之結果不帶此四欄(形狀不變).
4. **遮蔽**(`DIAG_PATTERNS`;診斷輸出與遮罩規格 D1:本套件只宣告具名樣式、由 wsemi `maskDiagText` 執行):`wrk_` 後接 8 個以上英數(opencode Console 之工作區代號;非金鑰,屬帳號識別,錯誤文字之網址必帶)以 `***` 取代 ⇒ `failureDetail`、`errorDetail`、`error` 尾段皆不含.已知取捨:`DIAG_PATTERNS` 為各 CLI 轉接器之診斷文字共用(`maskDiag`),故其他 CLI 之診斷文字(`error`、`errorDetail.stderrTail`)內以 `wrk_` 起首之 8 碼以上英數詞亦會被遮(外審 terra #8;依派工指示於本庫既有樣式表處理,不另設 opencode 專屬路徑);`parseGoLimit` 之 `window` 亦經 `maskDiag`(外審 terra #7);結果之 `stderr` 欄與 `tried[].stderr`／失敗事件之 `stderr`(子行程原始輸出之前段)不經此遮蔽,同既有(欄內含金鑰以外之原始輸出,見 R-FAILDIAG 之邊界),呼叫端記錄這些欄位時仍可見工作區代號.
5. **遞補層分流**(`src/dispatchAiFallback.mjs`,`isKeyQuota = isAdapterQuota && r.limitScope === 'key' && trusted && isestr(attemptOpt.provider)`;`trusted` 已含條目有金鑰;須給 `provider` 因金鑰只在 key 與 provider 皆有效時才注入,未給者各把金鑰沿用同一份登入態、換鑰無意義,外審 terra #1):
   - ①走既有 `failureKind 'no-credit'` 之「該把沒額度 → 換組內下一把」路徑(`fk === 'no-credit' && nk > 0 && trusted` 併入 `noCreditIdx`;事件 `next-key`、tried outcome `next-key`),**不整組跳過**;
   - ②**每次嘗試不單獨寫條目冷卻**(他把可能成交;同 no-credit 之既有語意),不經 `coolDetect`(同 no-credit);**`isKeyQuota` 先於 `isKeyIndependentFail` 判定**——該結果由錯誤列確認為該把訂閱之額度,即使 `error` 因樹狀終止失敗而等到逾時(`TIMEOUT` 開頭)或帶截斷旗標,成因亦非「同服務卡住」或「換鑰結果必然相同」,仍換下一把、不降格為 `timeout` 冷卻(外審 terra #2／#4;`test/tools/fakeOpencodeLimitForTest.mjs` 之 `go-limit-orphan`:根行程先結束、孫行程後印到頂列,令 taskkill 打在已不存在之 pid 上);
   - ③組內每一把皆到頂(或本次呼叫內已被 `quotaGate` 略過〔併入 `noCreditIdx`〕)⇒ 同既有整組沒額度:`group-exhausted`(`by: 'all-keys'`)帶 `quotaExhausted: true`、`cooldownMs > 0` 且明給 id 時以 `reason: 'quota'` 寫條目冷卻(同既有寫法 `coolNow(id, 'quota')`:固定視窗、不動 n;**該條目已在他原因〔如 `timeout`〕之有效視窗內者依 R-COOL-2 只更新 `at`、`reason` 與 `n` 不變,有效視窗仍為既有紀錄之視窗**〔外審 terra #3〕;`scope: 'entry'` 之 `cooled` 事件)、不計持久連敗、最終 `error` 為 `QUOTA_EXHAUSTED: …`、結果帶 `quotaExhausted` 清單;
   - ④部分到頂(他把另有一般失敗)不算整組沒額度:無 `quotaExhausted`、無 `quota` 冷卻,依既有 no-credit 之處置計入持久連敗(`adapterQuota` 只對非 `isKeyQuota` 者標記);
   - ⑤**維持整組跳過**(R-OCLIMIT-1 第 8 點原語意):免費池用盡(無 `limitScope`)、條目無金鑰(nk 0,如登入態)、金鑰身分不可信、條目未給 `provider` 者;
   - ⑥**不做**金鑰層級之跨條目共享略過(`deadKeys`／`skip-key`)與金鑰冷卻(`keyCooling`):兩者之範圍限 Anthropic 官方端點(`scoped`),且 Go 金鑰到頂時其他 `ocgo:` 條目之模型是否亦不可用無實證(`goQuotaGate.mjs` 檔頭【Unlimited 免費期條目之連坐】);跨呼叫之略過由 `quotaGate`(預設開)負責——用量端點到頂之同一秒即回 `limited`,但閘門有快取(`cacheMs` 預設 60 秒)且查詢失敗一律不擋(fail-open),故中途到頂後快取期內仍可能再派該把一次(外審 terra #11).
6. **額度帳(`store.quota`)入帳:不做**(派工裁定(b)之核實結果):既有額度帳之鍵只有讀者家族(`claude`／`codex`／`antigravity:<群組>`)與 `entry:<條目id>`(`quotaLedger.mjs` 檔頭),入帳者僅 `kind` 為 claude／codex／antigravity 之訂閱類(`subQuotaGate.mjs` `resolveSubQuotaGate`),`learnQuotaFromFailure` 不處理 Go;`goQuotaGate.mjs` 之快取為行程內記憶體、以金鑰指紋為鍵、不入 store,且刻意「不盲信 resetsAt」(用量降回門檻即恢復,使用者可能升級方案或開 Extra Usage).故「既有 Go 金鑰之帳鍵」不存在,入帳須新設計(Go 金鑰之帳鍵、帳號比對與作廢〔升級／Extra Usage 令金鑰於重置前復用〕、`forgetQuota` 涵蓋、事件語意),不屬極小改動;且用量端點即時反映,入帳只省一次查詢.待辦見 `state_oclimit.md`.
7. **用量端點**:到頂之同一秒即回 `limited` ⇒ 派前之檢查(`quotaGate`)於快取過期且查詢成功時可擋住「已到頂」者;本規則處理「呼叫中途才到頂」者與閘門未擋住者(快取期、fail-open).
8. **去識別**:本庫(程式、測試、sgud、README)不寫使用端之專案名與真實工作區代號;測試之工作區代號為假值 `wrk_FAKE0WORKSPACE0ID0000000001`.

測試(`npx mocha --no-parallel <檔> --timeout 180000`;假 CLI 情境 `go-limit`、`go-limit-keyed`〔以注入之金鑰子字串區分到頂／一般失敗／成功,`--fake-limited-key`／`--fake-bad-key`〕、`--fake-go-text=weekly|monthly|bare`):

| 項目 | 測試檔(案數) | 修前(1.0.95 之 src＋新測試) |
|---|---|---|
| 判準(判中與回傳形狀、不判者九種、`parseGoLimit` 十二形、跨區塊只判一次) | `test/unit-opencodeLimit.test.mjs`(新增 4) | 載入即失敗(無 `parseGoLimit` 匯出) |
| 終止與結果(四欄、`limitUntil` 區間、遮蔽、樹狀終止)、字樣變體(月視窗、無括號)、免費池不帶新欄、不重試與 `stopOnLimit:false` | `test/unit-dispatchOpencodeLimit.test.mjs`(新增 4) | 3 紅(免費池不帶新欄為守門綠) |
| 遞補:第一把到頂換第二把成功、每把皆到頂、單條目鏈之最終結果、部分到頂、免費池整組跳過(守門)、無金鑰整組跳過、未給 provider 整組跳過、終止失敗(TIMEOUT 開頭)仍換鑰、quota-skip 與到頂併入同一組盡、與 quotaGate 合成 | `test/unit-dispatchAiFallbackOpencodeLimit.test.mjs`(新增 10) | 9 紅(免費池整組跳過、未給 provider 整組跳過為守門綠;初版 7 案時 6 紅) |
| 工作區代號遮蔽、短詞不遮、上游分類 | `test/unit-failureDiag.test.mjs`(新增 1) | 紅 |
| 文件守門(dispatchOpencode【OpenCode Go】段、providers 診斷段之「未查明／未知」敘述改為實例) | `test/unit-providersOpencodeGoDocs.test.mjs`(改寫 3 案) | 紅(新敘述) |

變異驗證(副本內逐項改壞一處,33 項全數轉紅,基準 94 案全綠):字樣、供應商、不限字樣、免費池供應商亦判、不帶 scope、不帶視窗／重置、視窗不轉小寫、不合形狀之詞仍累計、0 仍帶、單位錯置、免費池亦帶 scope、結果不帶四欄(各一)、`limitUntil` 未加重置所餘、未記判中時刻、`limitUntil` 以回傳時刻為基準、附帶欄未併入、代號不遮、長度下限、分類不含、`parseGoLimit` 不錨定括號、視窗名不遮罩、遞補層不分流、不檢 `limitScope`、不檢有金鑰、不檢 `provider`、每次嘗試寫條目冷卻、經 `coolDetect`、仍標 `adapterQuota`、整組跳過條件仍含到頂、到頂先經 `isKeyIndependentFail`、到頂不併入 `noCreditIdx`.初擬之「不檢 `nk > 0`」為等價變異(`trusted` 已含 `nk > 0`),改為去掉 `trusted`(無金鑰案轉紅),並刪冗餘之 `nk > 0`.

### 站點全集(盤點指令:`git grep -n "stopRetryIf\|logFlagsToAdd\|createLimitWatch\|killProcessTree\|adapterQuota\|isAdapterQuota" -- src`)

| 站點 | 角色 | 判定 |
|---|---|---|
| `src/dispatchOpencode.mjs`(`stopOn`／`logArgs`／`logsOnStderr`、`lim` 包 onStderr/onTrace、判中後改標、上游原因來源) | 唯一使用端 | 已套 |
| `src/runExecCli.mjs`(`stopFn`／`isStop`／`takeover`、路徑 A 接管迴圈、路徑 B `skipGate`、`canTransient`) | 不重試 | 已套 |
| `src/opencodeLimit.mjs` | 判準、旗標、逐行、上游原因 | 已套 |
| `src/killProcessTree.mjs` | 樹殺 | 已套 |
| `src/dispatchAiFallback.mjs`(`adapterQuota`、`isAdapterQuota` 冷卻原因、連敗排除;R-OCLIMIT-2 之 `isKeyQuota` 分流) | 遞補 | 已套 |
| `src/failureDiag.mjs`(`DIAG_PATTERNS` 之 `wrk_` 樣式、`UPSTREAM_CLASSES` 之 `Go usage limit`) | 遮蔽與分類(R-OCLIMIT-2 第 3、4 點) | 已套 |
| `dispatchClaude`／`dispatchCodex`／`dispatchAntigravity` | 其他 CLI | 刻意不套(agy 額度用盡會自行結束〔離開碼 3〕;claude／codex 未見不結束之實例) |
| REST 四家 | HTTP 429 本即回應 | 不適用 |

### 測試(spec 翻譯;`npx mocha --no-parallel <檔> --timeout 180000`)

| 項目 | 測試檔 | 修前(HEAD 之 src) |
|---|---|---|
| 判準①～⑤(含引號內欄位、mode、429 限 -free)、parseLogFields、旗標(含字串包裝物件)、printLogsOn、逐行(跨區塊、一次、reset、超長行兩種切法、色碼)、upstreamFromLines | `test/unit-opencodeLimit.test.mjs`(11) | 模組不存在(紅) |
| taskkill 參數與 windowsHide、失敗不 reject、非 Windows 之 ps 列舉與由深至淺、ps 不存在不崩潰、descendantsOf、無效 pid、實際樹殺(detached 孫行程) | `test/unit-killProcessTree.test.mjs`(7) | 模組不存在(紅) |
| 假 CLI(只在 --print-logs 時印錯誤列、印後不結束、繼承 stdio 之 detached 孫行程):quota、429、跨區塊、title 不終止、opencode-go 不臆測、其他上游錯誤之 upstream 取自 stderr、不重試(兩路)、不做暫時性重試、一般失敗與暫時性重試之順序／事件序列同修前(兩路)、第 2 次才判中、旗標、stopOnLimit:false、自行非 0／0 結束、判中列之 upstream、暫時性重試輪後不接管、無效 maxRetries、日誌列不算暫時性、detectTruncation、並行、呼叫端回調 | `test/unit-dispatchOpencodeLimit.test.mjs`(23) | 13 紅／5 綠為守門(其後所增 5 案見報告) |
| 遞補:quota 冷卻改派與下次降尾、coolDetect 之後、有期限不重試、cooldownMs 0 仍改派、429 rate-limit 冷卻、不計連敗＋最終 quota、有金鑰整組跳過 | `test/unit-dispatchAiFallbackOpencodeLimit.test.mjs`(7) | 7 紅 |
| 讀日誌檔只在日誌未印到 stderr 時(R-FAILDIAG-3 之預設改變) | `test/unit-failureDiagCli.test.mjs`「預設不讀日誌檔」案;同 describe 其餘案改以 `stopOnLimit:false` 驗讀檔路徑 | — |

### 變異驗證(證明測試抓得到)

31 個變異全數被抓到(清單與抓到之測試見 `sgud/state/state_oclimit.md`):不終止、title 亦算、不改派、不冷卻、不跨區塊、會重試(兩路)、會暫時性重試、opencode-go 亦判、已帶旗標仍補、windowsHide 缺、只殺根行程、quota 標成 exec、上游仍讀日誌檔、quota 計入連敗、已判中之成功仍驗證、路徑 B 暫時性重試先於 maxRetries、路徑 B 不補 retry、先比對再去色碼、暫時性重試後仍接管、無效 maxRetries 仍接管、日誌列仍算暫時性、引號內欄位被誤取、mode 不限、429 不限 -free、超長完整行仍判、判中之成功仍當成功、upstream 取最後一列、有金鑰仍逐把換鑰、POSIX 子孫由淺至深、字串包裝物件不正規化.**測「樹狀終止」須以 detached 孫行程**(Windows libuv 之 job 物件令根 node 行程結束即連帶結束非 detached 子行程,「只殺根行程」之變異初版為等價變異).

### 破壞性／行為變更紀錄

- 2026-11-15:`dispatchOpencode` 命令列預設多 `--print-logs --log-level ERROR`;免費池用盡由 `timeout` 改為 `quota`;`errorDetail.upstream` 預設改取 stderr、不讀日誌檔;`maxRetries > 0` 之 opencode 呼叫改由 `runExecCli` 接管重試.README 行為變更第 74 條.
- 2026-11-16 wda158:訂閱(`opencode-go`)到頂由 `timeout` 改為 `quota`(另帶 `limitScope`、`limitWindow`、`limitResetsInMs`、`limitUntil`);診斷文字遮蔽工作區代號(`wrk_…`);遞補層對「訂閱到頂＋條目有金鑰」由「整組跳過、改派下一條目」改為「先換組內下一把金鑰」(R-OCLIMIT-1 第 8 點之例外).README 行為變更第 75 條.
