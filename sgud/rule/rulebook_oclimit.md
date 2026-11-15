# 規則帳本:opencode 免費池用盡／免費層 429 即時終止(R-OCLIMIT-1)

本檔自 2026-11-15 wda156(Gitea #156,使用端回報)起單列(全域 §14:依類型分檔);索引見 `sgud/rule/rulebook.md`.規則以「程式碼須長成什麼樣」為單位,附盤點指令、站點全集與判準.

來源:使用端以呼叫端直呼 `dispatchOpencode` 撞到免費池用盡(`Free usage limit reached`)時 `opencode run` 不結束,本套件以 TIMEOUT 回報、每次嘗試耗滿 `timeoutMs`(使用端實況:兩個節點各空等 7,202 秒).主控判定根因在本套件,建議檔要求:讀到主要請求之該類錯誤列即樹狀終止、數秒內回 `errorType: 'quota'`、遞補層以額度冷卻改派.呼叫端契約:`r.ok === false && r.errorType === 'quota'` = 因額度而未完成(不讀 stderr、不自行終止;另一派工同時依此改呼叫端,**不得改名**).

## R-OCLIMIT-1 主要請求之免費池用盡／免費層 429 ⇒ 樹狀終止、可判讀之分類、不重試、遞補改派

1. **ERROR 列之取得**(`src/dispatchOpencode.mjs` 以 `logFlagsToAdd`,`src/opencodeLimit.mjs`):`stopOnLimit`(預設 true)時,呼叫端未給任何 `--print-logs` 形式(`--print-logs`、`--print-logs=…`、`--no-print-logs`)者補 `--print-logs`,且未給 `--log-level`(含 `--log-level=…`)時另補 `--log-level ERROR`;已給 `--print-logs` 類者一律不補(其層級原樣).位置:固定旗標(`run --agent X [-m M] [--format json]`)之後、`extraArgs` 之前.**不採讀日誌檔**:日誌檔為多行程共用之累積檔,同模型並行無從歸屬(`state_diag.md` 已知缺口),據以終止會誤殺;stderr 為本行程專屬.
2. **判準**(`classifyLimitLine`):去 ANSI 與行尾 CR 後以頂層 key=value 解析(`parseLogFields`;引號內文字不當欄位,外審 terra #16)①`level` 為 `ERROR` ②有 `agent` 欄且值非 `title` ③`mode` 欄存在時須為 `primary`(子 agent 不算主要請求,外審 terra #17)④`providerID=opencode` ⑤原因(`error.error`,其次 `error`、`message`)含 `Free usage limit reached` ⇒ `quota`;含 `Rate limit exceeded` **且 `modelID` 以 `-free` 結尾** ⇒ `rate-limit`(本機日誌之 429 列皆為 `-free` 模型;按量模型之 429 無實例,不臆測,外審 terra #18).其餘(含舊版非 key=value 格式、`opencode-go`、第三方 provider、無後綴之免費模型之 429)不判,退回修前(等到逾時).
3. **逐行**(`createLimitWatch`):只判完整行(跨區塊於收到換行時才判);超過 `LINE_MAX`(64 KiB)之行不論是否跨區塊一律捨棄、不判(外審 terra #9);先去色碼再比對 `level=ERROR`(外審 agy #10);每次嘗試(spawn 事件)重置、至多觸發一次;保留本次嘗試之 ERROR 列(至多 50 行、每行 4000 字元)供上游原因.
4. **終止**(`src/killProcessTree.mjs`):判中即發 `onTrace` 事件 `limit-stop { kind, pid }`(先於終止),以該次 spawn 事件之 pid 樹狀終止.Windows:`execFile('taskkill', ['/F','/T','/PID',pid], { windowsHide: true, timeout: 15000 })`(不經 shell);其他平台:`execFile('ps', ['-A','-o','pid=,ppid='])` 一次列舉、由深至淺 `process.kill(pid,'SIGKILL')`、最後終止根,`ps` 失敗只終止根(錯誤由 callback 承接——不用 tree-kill:其 spawn 未監聽 `error`,`ps` 不存在時令呼叫端崩潰,外審 terra #4);列舉當下之子孫才終止、未於真實 Linux／macOS 實測為已知限制.永不 reject.`dispatchOpencode` 等終止完成(上限 20 秒)後才回傳.已知限制(外審 terra #2／#3):終止失敗時須等 `execCli` 逾時;`execCli` 之「樹殺後 3 秒仍未 close 即定案」後若重試,舊行程遲到之 stderr 仍進監看(`execCli` 之 `onStderr` 不分嘗試)——皆須終止失敗在先,未處理.
5. **結果**:最後一次嘗試判中且 `ok !== true` 者——`quota`:`errorType: 'quota'`、`failureKind: 'no-credit'`;`rate-limit`:`errorType` 不動(被終止之子行程為非零離開 ⇒ `exec`)、`failureKind: 'rate-limit'`;兩者帶 `failureDetail`(遮蔽、折行、至多 200 字元)、`errorDetail.upstream`(**觸發終止之該列**原因,同區塊其後之他列不取代)、`error` 加分類(`Exit code 1 [Free usage limit]: …`/`[rate limit]`).子行程於終止前已自行以 0 結束者**亦回失敗**(不等 validate;`error` 為 `Exit code 0 [分類]: …`、stdout 裁 500、去掉 `finish`／`outputChars`、加 `errorDetail`;外審 terra #1).
6. **不重試**(`src/runExecCli.mjs` 內部鍵 `stopRetryIf`):命中之結果為最終結果——不跑 `maxRetries`、不做暫時性重試(`canTransient` 先判 `!isStop`)、不做非驗證失敗之接管重試.wsemi `execCli` 內部重試無法中途喊停(終止後離開碼 1 屬可重試),故給了 `stopRetryIf` 且 `maxRetries > 0` 時由 `runExecCli` 接管(交 `execCli` 之 `maxRetries` 為 0):無驗證路徑沿用 R-COOL-4 之接管迴圈(事件序列同 `execCli`;無期限時沿用首次之逾時、不重新守門);有驗證路徑於無期限時(`stopOnly`)以「一次 `execCli` 呼叫」為虛擬呼叫逐項比照修前:虛擬呼叫內先用完 `maxRetries` 才考慮暫時性重試、間隔以虛擬呼叫內次數計、不重新守門(`skipGate`)、事件序列相同(`traceTakeover`＋`flushVc` 補發單一 `done`);有期限者沿既有(暫時性重試先、接管重試後、重新守門).驗證不過之重試亦先判 `isStop`.`maxRetries` 為 0 或未給 `stopRetryIf` 者逐位元同修前.(初版之路徑 B 順序與事件序列異於修前,外審 agy-hydrogen #5／#6 指出後改正.)
7. **上游原因之來源**:日誌列印到 stderr 者(`logsOnStderr`)由本次 stderr 之 ERROR 列取(`upstreamFromLines`:`provider/model` 相符、非 title 優先、其次最後一筆),**不讀日誌檔**(opencode 帶 `--print-logs` 時不寫入日誌檔——本機實測成功路徑 0 位元組 vs 17490 位元組;失敗路徑為同一日誌初始化,推定相同、未以失敗實例實測);否則照 R-FAILDIAG-3 讀日誌檔.
8. **遞補層**(`src/dispatchAiFallback.mjs`):實際嘗試回 `errorType 'quota'`＋`failureKind 'no-credit'`(`isAdapterQuota`;**不論有無金鑰**——免費池用盡與金鑰無關,`providers.mjs` 檔頭診斷段①,外審 terra #7)⇒ ①內建冷卻觸發 `reason: 'quota'`(固定視窗,先於 `coolDetect`,亦先於逾時字樣;`cooldownMs > 0` 且明給 id;已在他原因有效視窗內者依 R-COOL-2 只更新 at)②**整組跳過**(`skip-group`)、改派下一條目③不計持久連敗(`adapterQuota`)④不判為 `budget-cut`(外審 terra #5)⑤不標 `quotaExhausted`(未逐把確認).429 ⇒ 既有 `failureKind === 'rate-limit'` 冷卻.`quota-skip`(Go 與訂閱類之合成結果)在派送前 `continue`,不經此處——語意不變.
9. **不臆測**:`opencode-go`(訂閱)到頂之字樣與行為無實例,不判、不寫推測字樣;使用端或主控見到實例後再擴充判準(需實際錯誤列).
10. **退回路徑**:`stopOnLimit: false` ⇒ 不補旗標、不監看、讀日誌檔,與修前逐位元相同;呼叫端明示 `--print-logs=false`/`--no-print-logs` ⇒ 無從監看,同 false.

### 站點全集(盤點指令:`git grep -n "stopRetryIf\|logFlagsToAdd\|createLimitWatch\|killProcessTree\|adapterQuota\|isAdapterQuota" -- src`)

| 站點 | 角色 | 判定 |
|---|---|---|
| `src/dispatchOpencode.mjs`(`stopOn`／`logArgs`／`logsOnStderr`、`lim` 包 onStderr/onTrace、判中後改標、上游原因來源) | 唯一使用端 | 已套 |
| `src/runExecCli.mjs`(`stopFn`／`isStop`／`takeover`、路徑 A 接管迴圈、路徑 B `skipGate`、`canTransient`) | 不重試 | 已套 |
| `src/opencodeLimit.mjs` | 判準、旗標、逐行、上游原因 | 已套 |
| `src/killProcessTree.mjs` | 樹殺 | 已套 |
| `src/dispatchAiFallback.mjs`(`adapterQuota`、`isAdapterQuota` 冷卻原因、連敗排除) | 遞補 | 已套 |
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
