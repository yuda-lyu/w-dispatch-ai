# 規則帳本:CLI 失敗診斷(errorDetail)、opencode 日誌對時擷取、成功結果 finish／outputChars(R-FAILDIAG-1～5)

本檔自 2026-11-08 da110(Gitea #110,使用端建議)起單列(全域 §14:依類型分檔);索引見 `sgud/rule/rulebook.md`.規則以「程式碼須長成什麼樣」為單位,附盤點指令、站點全集與判準.

來源:使用端要讓「失敗原因在管線紀錄內自足」——此前 CLI 條目(尤其 opencode／opencode-go)失敗時上層只拿到 `Exit code 1` 或 `TIMEOUT after 300s`,真因要人去 opencode 日誌(UTC 時戳)對時才找得到.配額類錯誤(`QUOTA_COOLDOWN`)已帶完整原因,為對照組.主控已定(派工 da110):①非零離開碼之 `error` 為 `Exit code N: <stderr 尾段>`＋`errorDetail`,逾時同;②opencode 失敗時讀日誌對時擷取上游原因;③成功結果帶 `finish`／`outputChars`;④不得改變既有失敗分類與配額判定.

## 本機實查(2026-11-08;opencode 1.19.5、claude、codex 0.16x、agy 1.5.x;皆為「本機即失敗」,**未呼叫真實 AI**)

建議檔各點屬實,並補三項建議檔未寫的發現:

| CLI | 失敗形態(實查) | 對本規則之影響 |
|---|---|---|
| opencode(預設格式,不存在之 model,離開碼 1) | stderr 為帶 ANSI 色碼之 `Error: {pretty JSON: name UnknownError, data.message "Unexpected server error. Check server logs for details.", ref "err_…"}`,stdout 空;`ref` 不在日誌 | 通稱字樣,真因須看日誌;尾段須去色碼、折為單行 |
| opencode(`--format json`) | 錯誤改為 stdout 之 `type:error` 事件,**stderr 空** | `reshapeResult` 還原為 `Error: 訊息` 後以 `diagStderr` 提示交 `runExecCli`(原始擷取只有事件 JSON) |
| claude(`-p`,假 key+不可連線 base url,離開碼 1) | **失敗訊息在 stdout**(`API Error: Connection refused — … (ECONNREFUSED)`);給 `ANTHROPIC_API_KEY` 時 **stderr 另有無關警告**(`⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY …`) | `Exit code N` 之 error 文字對 claude 取 stdout 尾段優先(`prefer:'stdout'`),其他 CLI 取 stderr、其空才退用 stdout;`errorDetail` 兩者皆帶 |
| codex(`--sandbox` 值不合法,離開碼 2) | stderr 為 clap 之 `error: invalid value … [possible values: …]`,多行 | 折為單行即可讀 |
| agy(未知旗標,離開碼 2) | 第一行為錯誤,其後接整份 Usage(約 3.4KB) | 尾段落在 Usage 末端而非錯誤行——**已知限制**(固定旗標不會觸發,僅 `extraArgs` 誤給);agy 真實額度失敗之 `AGY_ERROR`／`Individual quota reached` 在 stderr 末端,尾段可用 |

opencode 日誌(**單一累積檔**,非依啟動分檔):`~/.local/share/opencode/log/opencode.log`(Windows 為 `C:\Users\<user>\.local\share\opencode\log\opencode.log`,實查 6MB／約 3 萬行起於 2026-07-06),格式 `timestamp=<ISO UTC>Z level=ERROR run=<id> message="stream error" providerID=<p> modelID=<m> session.id=… small=<bool> agent=<build|title> mode=primary error.error="<原因>"`.**原因鍵是 `error.error`**(建議檔寫 `error=`);同一次失敗常有 `agent=build`(實際請求)與 `agent=title`(標題小模型附帶請求,訊息可為 `AI_RetryError: Failed after 3 attempts. Last error: …`)兩筆;行序不嚴格依時戳(實查有數百毫秒倒序).`nosuchprov/nosuchmodel` 之 UnknownError **不寫** `stream error` 行(無 providerID/modelID 行可比對)——此類失敗 `upstream` 缺而 `error` 仍帶 stderr 尾段.

## R-FAILDIAG-1 失敗結果帶 errorDetail,error 文字帶尾段

**規則**:`runExecCli` 於每個最終結果(`withGate`)統一補(四家 CLI 轉接器共用,規則只寫一處):失敗且 `errorType` 為 `exec`／`timeout`(非零離開、訊號結束、逾時)時,結果加 `errorDetail: { exitCode(數字或 null), stderrTail, stdoutTail?(stdout 非空才有) }`,且 execCli 原生 error 形狀(`Exit code N`／`Signal: X`／`TIMEOUT after Ns[(子進程未能結束)]`)寫成 `<原始>: <尾段>`.
- 尾段:最後 300 字元(`DIAG_TAIL_MAX`),先去 ANSI、CRLF 正規化、行內空白折疊、略過空白行、遮蔽、再取尾(被截去開頭時以 `…` 接頭,不切代理對);error 文字內換行折為單一空白.
- 來源優先序:`reshapeResult` 帶來之 `diagStderr`／`diagStdout`(轉接器還原之完整文字;取用後自結果移除,不論成敗)> 本層擷取到之子進程輸出尾端(包 `onStdout`／`onStderr`／`onTrace`,每次 spawn 重置,保留最後 4096 字元;execCli 失敗結果之 `stderr` 欄位只留前 1000 字元、逾時前 500 字元,真正的尾端不在其中)> 結果之 `stdout`／`stderr` 欄位.
- error 文字取哪個輸出:預設 stderr,空且為 `Exit code` 時退用 stdout;claude(`spawnGateKind==='claude'`)之 `Exit code` 取 stdout 優先;逾時與訊號結束不退用 stdout(stdout 可能是模型的部分輸出).
- **不加**:`spawn`／`params`／`validation`／`incomplete`／`aborted`、成功結果;agy／opencode 轉接器自組之 error(如 `Exit code 1 | agy stream-json: …`)文字不變仍附 `errorDetail`;已加過原因者再處理不重複加(冪等).
- 既有欄位(`stdout`／`stderr`／`code`／`errorType` 等)一律不動;自給之回調照常呼叫(非函數視同未給).
- 盤點指令:`Grep "addErrorDetail|createTailCapture" src`(站點:`runExecCli.mjs` finalize 一處;其餘僅 `dispatchOpencode.mjs` 之 `addUpstream`).判準:已套＝經 `runExecCli` 之四家 CLI;不套＝REST 轉接器(不經子進程,無此概念).
- 測試:`test/unit-failureDiag.test.mjs`(純函數)、`test/unit-failureDiagCli.test.mjs`(四家×{非零離開+假金鑰、很長 stderr、逾時、驗證失敗／成功／無法啟動不加};各 CLI 形態;重試只取最後一次;回調照常).

## R-FAILDIAG-2 遮罩沿用既有函數(dspec〈診斷輸出與遮罩〉D1 單一實作)

**規則**:診斷尾段(stderr／stdout／日誌擷取)一律經 `failureDiag.maskDiag`,其內全部交 wsemi `maskDiagText`(呼叫端給的機密值、網址帳密、`password`／`token`／`secret`／`authorization`／`api-key` 鍵值對、`Bearer`),並以 `opt.patterns` **宣告**本套件之金鑰樣式(`DIAG_PATTERNS`:`sk-ant-`〔沿用 `redactText.mjs` 匯出之 `API_KEY_PATTERN`,單一來源〕、`sk-`／`oc_sk_`／`pk-`／`rk-`、`AIza…`、`ghp_` 等、JWT),一律以 `***` 取代(與共用語料期望一致).**不另寫遮罩函數**(dspec D1);遮罩失敗回 `***`(fail-closed);遮蔽先於截尾.共用語料(dspec D5):`wsemi/src/_diagCases.mjs` 中 `wire:true` 且受測函數為 `maskDiagText` 之案(T01、T07)以本套件呼叫點 `maskDiag` 在 `unit-failureDiag.test.mjs` 重跑(語料改版令 wire 案消失時先紅).機密值名單:`runExecCli` 之 `opt.diagSecrets`(內部鍵,轉接器傳入本次注入之金鑰:opencode 之 `key`、claude 之 `key` 與 `opt.env.ANTHROPIC_API_KEY`).`dispatchClaude.redactResult` 對 `errorDetail` 再套一次作最後防線.
- 範圍:新增欄位(`error` 尾段、`errorDetail.*`)已遮;結果之 `stdout`／`stderr` 欄位維持既有行為(claude key 模式既有遮蔽,其餘不新增).
- 已知限制:`maskDiagText` 以子字串比對鍵名,輸出中的 `PWD=…`／`"PWD":"…"` 被當密碼值遮成 `***`(寧可多遮).
- 測試:`unit-failureDiag.test.mjs`「maskDiag／tailOf」(11 種金鑰形態、無機密文字原樣、先遮後截);`unit-failureDiagCli.test.mjs` 各 CLI 假金鑰案.

## R-FAILDIAG-3 opencode 失敗時日誌對時擷取(`src/opencodeUpstream.mjs`)

**規則**:`dispatchOpencode` 於 `runExecCli` 回失敗且已有 `errorDetail` 時,讀日誌檔尾(至多 2MiB,`UPSTREAM_TAIL_BYTES`)**一次**,取時窗內 `providerID`／`modelID` 與 `-m provider/model` 相符之 `level=ERROR` 行的 `error.error`(退用 `error`、非通稱之 `message`),遮蔽並折為單行(至多 300 字元)附入 `errorDetail.upstream`,並把簡短分類放進 error 文字(`Exit code 1 [overloaded]: <尾段>`).
- 時窗:失敗時刻(讀檔當下)±60 秒;失敗耗時超過 60 秒者(逾時),下界延至該次嘗試起點(`tFail − durationMs`),否則慢失敗之原因行(免費層 429 令 run 不結束,原因行在起點後約 1 秒)落在時窗外;下界另留 2 秒寬限.
- 擇一:優先 `agent` 非 `title`,其次時戳最晚.**已知限制**:同模型並行呼叫在同一時窗內同時失敗時無從區分(通常同因).
- 分類:方括號詞(`[overloaded]`、`[prefill_cap_refused]`)優先,其次已知字樣表(`Free usage limit`、`Model access is disabled`、`Invalid API key`、`Go subscription required`…);無則 error 文字不加方括號.
- 路徑:`opt.opencodeLog`(字串覆寫;`false` 關閉);預設 `<XDG_DATA_HOME(opt.env 優先於 process.env)或 ~/.local/share>/opencode/log/opencode.log`,找不到時退用同資料夾最新之 `*.log`(明給路徑者不退用).
- 略過(欄位缺、error 文字同無日誌時,**不拋錯**):檔案不存在／為資料夾／不可讀、`model` 無 `provider/` 前綴、無相符行、擷取內容為空.只在失敗(exec／逾時)時讀;成功與 `incomplete`／`spawn` 等不讀.
- 實跑:本機真實日誌(2026-11-05 免費層用盡紀錄,`opencode/beam-free`)可取到 `Free usage limit`,單次讀取約 9ms;時窗外與 provider/model 不符皆回 null.
- 測試:`unit-failureDiag.test.mjs`「opencodeUpstream」(路徑、`pickUpstream` 時窗／不符／擇一、遮罩、慢失敗下界、不存在／資料夾／無前綴、`*.log` 退用、大檔只讀尾端);`unit-failureDiagCli.test.mjs`「opencode 日誌對時擷取」(±60 秒內相符、model／provider 不符、時窗外、逾時、`opencodeLog:false`、XDG 預設路徑、金鑰遮罩、成功不讀).

## R-FAILDIAG-4 成功結果帶 finish 與 outputChars

**規則**:成功結果加 `outputChars`(`stdout` 字元數)與 `finish`(終止原因簡值:`stop`／`length`／其他原值小寫／`unknown`;`end_turn`／`stop_sequence`／`completed`→`stop`,`max_tokens`→`length`);已有者不覆寫.
- CLI 類:`runExecCli` 補;`finish` 僅 `dispatchOpencode` 開 `detectTruncation` 時取得(事件流最後一步之終止原因,`reshapeResult` 先給),其餘 CLI 輸出不揭露,恆 `unknown`.REST 類:`dispatchAi`(含經它之 `dispatchAiFallback`)依 `finishReason` 補;**直呼 `dispatchApi*` 者不帶**.
- 不加:失敗結果(含 `incomplete`——截斷失敗之形狀不變,`reshapeResult` 先給之 `finish` 於 `shape()` 移除)、`validation` 失敗(其形狀由 `unit-userFnValidate` 與 wsemi `execCli` 釘在一起).上層「驗證失敗之 WARN 帶 `finish=… chars=…`」所需者為 `r.ok===true` 之結果(上層調度層自驗),已涵蓋.
- 測試:`unit-failureDiagCli.test.mjs`「成功結果帶 finish 與 outputChars」(四家 CLI、opencode 偵測 stop／tool-then-stop／acceptTruncated length、既有 `incomplete` 案不變、REST 三種、失敗不加);`unit-failureDiag.test.mjs`「finish／outputChars」.

## R-FAILDIAG-5 不改變既有失敗分類與配額判定(主控已定 4)

**規則**:error 文字加了原因後,以 error 文字判定之處一律只看原始部分(`failureDiag.baseErrorOf`:execCli 原生三形狀去掉本檔加的分類與尾段,其餘文字原樣).`errorType` 於補原因之前已由 `attachErrorType` 決定.
- 盤點指令:`Grep "\.error\b|get\([a-z]+, 'error'" src`;站點全集與判準:

| 站點 | 讀 error 的方式 | 判準 |
|---|---|---|
| `getErrorType.mjs` `getErrorType` | `indexOf('TIMEOUT')`、`includes('ENOENT'/'ENAMETOOLONG')`、`=== 'OUTPUT_VALIDATION_FAILED'` | **已套** `baseErrorOf`(尾段含 ENOENT 否則誤判 spawn) |
| `dispatchAiFallback.mjs` `isKeyIndependentFail` | `indexOf('TIMEOUT')`、`includes('ENOENT')`、`=== OUTPUT_VALIDATION_FAILED`、`indexOf('TOOL_CALLS_UNSUPPORTED'/BODY_NOT_JSON)` | **已套**(尾段含 ENOENT 否則由逐把換金鑰 `next-key` 改判整組跳過) |
| `subQuotaGate.mjs` `learnQuotaFromFailure`(claude) | `[error, stderr, stdout]` 串接找額度字樣 | **已套**(error 取原始部分;stderr／stdout 欄位照舊,字樣在其一仍入帳) |
| `dispatchAiFallback.mjs` 冷卻觸發 `r.error.indexOf('TIMEOUT')` | 前綴 | 前綴安全(尾段接在原始部分之後),不須套 |
| `failureKind.mjs` `classifyCliFailure` | `errorType`、`indexOf('TIMEOUT')`、`=== OUTPUT_VALIDATION_FAILED`;文字證據只讀 stdout／stderr 欄位 | 前綴／相等安全,不須套 |
| 呼叫端自給之 `coolDetect`／`quotaUntilOf` | 收完整結果 | **會看到含尾段之 error**(其輸入新增);README 指引改讀 stderr／stdout 欄位 |
| `opencodeGoUsage.mjs`、`quota/*` | 自有 execCli／REST,不經 `runExecCli` | 不適用 |

- 若再新增「以 error 文字內含字樣」之判定,必須讀 `baseErrorOf(r.error)` 或讀 stdout／stderr 欄位,並於上表補列.
- 測試(新增,對現況碼先紅):`unit-failureDiag.test.mjs`「不改變既有分類」(`getErrorType` 尾段含 ENOENT 仍 exec;`learnQuotaFromFailure` 尾段含額度字樣不入帳);`unit-failureDiagCli.test.mjs`「遞補層: 既有失敗分類不因 error 文字加了原因而改變」(stderr 尾段含 ENOENT 仍 `next-key`;逾時仍 `skip-group` 並觸發冷卻;離開碼 2 仍 `skip-group`;一般 exec 不觸發冷卻);既有 `unit-getErrorType`／`unit-failureKind*`／`unit-subQuotaGate`／`unit-dispatchAiFallback*` 全綠.
- 因 `error` 文字改變而更新期望值之既有測試(原斷言 `error === 'Exit code 1'`,新斷言仍釘離開碼／errorType／原始部分,非放寬)共 6 案:`unit-dispatchAntigravity`(離開碼非 0)、`unit-dispatchClaude`(離開碼非 0)、`unit-dispatchAiFallback`(全數失敗)、`unit-opencodeTruncation`(D6 離開碼非 0、D7 錯誤路徑)、`unit-opencodeTransientRetry`(兩次皆失敗).

## 變異驗證與限制

見 `sgud/exp/experience.md`「CLI 失敗帶回原因」節之變異紀錄.限制彙整:agy 參數錯誤之 Usage 傾印;`PWD` 被過度遮蔽;同模型並行同時失敗之日誌歸屬;REST 直呼無 `finish`／`outputChars`;codex／agy／claude 之 `finish` 恆 `unknown`(CLI 輸出不揭露,未驗證其 JSON／stream-json 模式是否可得).
