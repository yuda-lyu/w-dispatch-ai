# 規則帳本(類型:timeout)

> 2026-11-13 da-hy(排程第 438 項)立.類型說明:`timeoutMs`(單次嘗試之計時毫秒設定)之判定單一來源 `castTimerMs`(R-TIMEOUT-1).主檔索引見 `sgud/rule/rulebook.md`.
> 來源:主控帳本 G17(opt 之數值以 `ise*` 判定「可計算」,`is*` 只作數學定義之判斷)、跨套件規格〈輸入參數之檢測機制〉§11 第 19～21 項、wsemi 1.9.59 起 `execCli` 之 `timeoutMs` 以 `iseint` 之計時器範圍判定(`node_modules/wsemi/src/execCli.mjs` 之 `RULE_TIMEOUT_MS = { use: 'timer', min: 1 }`).

## R-TIMEOUT-1 `timeoutMs` 一律經 `castTimerMs` 判定:1～2147483647 之整數才採用,其餘用各入口之預設,不夾上限

### 軸

- 輸入值類別:有效(1、999、5000、數字字串、含空白之數字字串、恰 2147483647)、超過計時器上限(2147483648、3e9、`Number.MAX_SAFE_INTEGER`、`Number.MAX_VALUE`)、非有限(`Infinity`、`'Infinity'`、`-Infinity`、`NaN`)、非正或非整(0、-1、1.5、40000.5)、非十進位字串(`'0x10'`、`'abc'`、`''`)、非原始數值(`null`、未給、布林、陣列、物件、包裝物件 `new Number(5000)`、BigInt).輸入表單一來源 `test/tools/timeoutCasesForTest.mjs`(31 格,測試與探針共用).
- 入口:CLI 四家轉接器、`runExecCli`、REST 四家轉接器、遞補層(共用與條目)、`createAiCaller`(建構與逐次)、`resolveCatalogue`／`timeoutPatch`(逐層)、`budgetFor`、工作流(`callAi`、`runFanout`、`runRolePipeline`)、額度讀者(`getQuotaClaude`／`Codex`／`Antigravity`、`fetchQuotaJson`)、`opencodeGoUsage`、`probeAnthropicKeys`、`filterOpencodeFree`、`checkAgyStdinSupport`、`checkTruncation`.

### 規則

1. **判定**(`src/castTimerMs.mjs`,單一份):`iseint(v, { use: 'timer', min: 1 })` 為真才採用(1～2147483647 之整數,數字或可無損轉數字之十進位字串),回 `Number(trim 後之值)`(K4:檢測之值即使用之值);其餘回呼叫端給之預設.**不夾至上限、不報錯**(dspec §11 第 19～21 項:非預期視為未給、改用預設).與 wsemi `execCli` 之判定逐案相同,但無效時用**本套件之預設**(轉接器與遞補層為 `dfTimeoutMs`＝300000)而非 `execCli` 自有之 120000——故入口須先判定,不得把原值交給 `execCli` 由它回退.
2. **為何不用舊判定(`ispint` 通過後 `cint`,即修前之 `castPintOr`)**:`ispint` 為數學定義(`Infinity` 為真、`'0x10'` 為真、包裝物件為真),通過後 `cint`:`Infinity`→`1.7976931348623157e308`、`'0x10'`→16、`new Number(5000)`→5000、超過 2147483647 者原樣通過;轉交 `execCli`(1.9.59 起)時,1.797e308 與超過上限者被它判為無效而改用 120000(外層實際 120 秒、本套件預設 300 秒,兩層不一致),`'0x10'`(16)與包裝物件(5000)則被當有效而得 16 毫秒／原值(非預期之採用);REST 類把原值交 `setTimeout`,超過 2147483647 者被 Node 視為 1 毫秒(立即 `TIMEOUT`,實測 `TimeoutOverflowWarning`).
6. **其餘毫秒設定同判定(外審 #7～#9、#3,「同類毫秒參數」;2026-11-13 同輪補)**:`castPintOr` 之內部改為 `iseint(v, { min: 1 })`(1～`Number.MAX_SAFE_INTEGER` 之整數或其十進位數字字串;`Infinity`、`'0x10'`、包裝物件、2**53 以上一律回預設),其站點一次改正:`minAttemptMs`(遞補層、`runExecCli`、期限提示 `attemptHints`)、`cooldownMs`／`cooldownMaxMs`(`dispatchAiFallback`、`cooling.mjs` 四處)、`retryDelayMs`(REST 四家、`runExecCli`)、`transientRetry.fastMs`、`budgetMs` 之建構值、`coolAfterFails`、`maxBodyBytes`;**交計時器者另用 `castTimerMs`**:`transientRetry.delayMs`(交 wsemi `delay`,超過上限者被它改用 10 毫秒).**由期限導出之逾時須為整數**:`capByDeadline`(`runExecCli`)與 `capByHints`(`attemptDeadline`)之剩餘毫秒向下取整(呼叫端自給之 `deadlineAt` 可為小數;小數 `timeoutMs` 交 `execCli` 會被判為無效而改用 120000).**逐層回退**:`dispatchAiFallback` 之 `entryTimeout`＝條目自帶有效值 → 共用 `opt.timeoutMs` 有效值 → 預設(條目自帶之無效值不得遮蔽有效之共用值,同 `timeoutPatch` 逐層落下).**額度閘之讀者逾時**(`goQuotaGate`／`subQuotaGate` 之 `timeoutMs`、`antigravityTimeoutMs`)改與讀者同判定(整數);`cacheMs` 等快取間隔仍為 `isenum` timer(允許小數).
3. **各入口自己之預設不同**:轉接器、遞補層、`createAiCaller`(未給即不寫入)、工作流:300000(`dfTimeoutMs`);額度讀者:20000(`dfQuotaTimeoutMs`);`getQuotaAntigravity`:60000;`opencodeGoUsage`:10000;`probeAnthropicKeys`:20000;`filterOpencodeFree`:30000;`checkAgyStdinSupport`:15000(且有效值超過 15000 者取 15000,上限不變).
4. `dispatchAntigravity` 之 `--print-timeout` 未給時推導為 `floor(生效 timeoutMs / 1000) + 30` 秒(不再 `Math.min` 封頂:生效值恆 ≤ 2147483647,最大 `2147513s`,在 agy 可解析之 Go duration 範圍內);`getQuotaAntigravity.agyPrint` 之 `/usage` 為 `max(5, ceil(生效 timeoutMs / 1000))` 秒(同).
5. **刻意不改**(非本規則之站點,理由):
   - `src/callUserFn.mjs` 之 `awaitUserFn`:內部原語,各呼叫端已先正規化;其 `Math.min(…, TIMER_MAX)` 為自身防線,保留(不屬「入口」).
   - `src/goQuotaGate.mjs`、`src/subQuotaGate.mjs` 之 `ms()`(閘門之**快取間隔** `cacheMs`／`antigravityCacheMs` 等):仍以 `isenum(v, { use: 'timer', gt: 0 })` 判定(dspec §7.1「計時毫秒一般用 isenum timer」,允許小數;非 `timeoutMs`).其**讀者逾時**(`timeoutMs`／`antigravityTimeoutMs`)已於 2026-11-13 改為 `castTimerMs`(規則 6).兩種寫法(整數 vs 允許小數)並存,見 `sgud/feedback/feedback.md`.
   - `src/cliSpawnGate.mjs` 之 `pollMs`／`gateWaitMaxMs`／`settleMs`／`probeTimeoutMs`／`probeFailCooldownMs`／`minGapMs`:已以 `isenum` timer 判定.
   - `budgetMs`:「執行期剩餘時間」,`castBudgetMs`(R-CALLER-1-6、D11 甲);建構值走 `castPintOr`(規則 6).
   - **次數／索引類(非毫秒,本輪不動,見 `state_timeout.md` 待辦)**:`maxRetries`(REST 四家、`runExecCli` 以 `isp0int`＋`cint`:`Infinity`→1.8e308 近乎無限重試)、`keepDays`、`maxLengths`、`minCandidates`、`parseIndexList` 之 `min`／`max`／`topN`、遞補層之 `cursor`(索引)與舊式冷卻時間戳 `ts`、內部結果值 `appliedTimeoutMs`.

### 站點全集(32 站點,27 檔;含規則 6 之 5 個新增站點)

`Grep "castTimerMs\(" src` 排除 `castTimerMs.mjs` 自身後逐檔計數(`test/unit-castTimerMs.test.mjs`「站點全集」固定此表;新增站點須先檢查再改此表與本表).`castPintOr` 之站點(規則 6)不在此表:`minAttemptMs`(`dispatchAiFallback`、`runExecCli`、`attemptDeadline`)、`cooldownMs`／`cooldownMaxMs`／`coolAfterFails`、`cooling.mjs` 四處、REST 四家與 `runExecCli` 之 `retryDelayMs`、`transientRetry.fastMs`、`createAiCaller` 之 `budgetMs` 建構值、`fetchQuotaJson` 之 `maxBodyBytes`:

| 檔 | 站 | 預設 |
|---|---|---|
| `budgetFor.mjs` | 1(條目 `timeoutMs`,以實際採用值加總) | 300000 |
| `checkAgyStdinSupport.mjs` | 1 | 15000(外層 min 15000) |
| `checkTruncation.mjs` | 1(`safeValidateAsync`) | 300000 |
| `createAiCaller.mjs` | 1(逐次;建構經 `resolveCatalogue`) | 未給不寫入 |
| `dispatchAiFallback.mjs` | 2(`entryTimeout`:條目層、共用層逐層) | 300000 |
| `goQuotaGate.mjs` | 1(Go 額度閘之讀者逾時) | 5000 |
| `subQuotaGate.mjs` | 2(訂閱類額度閘之讀者逾時:`timeoutMs`、`antigravityTimeoutMs`) | 15000／60000 |
| `dispatchAntigravity.mjs`、`dispatchClaude.mjs`、`dispatchCodex.mjs`、`dispatchOpencode.mjs` | 各 1 | 300000 |
| `dispatchApiAnthropic.mjs`、`dispatchApiOpenaiCompat.mjs`、`dispatchApiOpenaiResponses.mjs`、`dispatchApiTypesafeSystemone.mjs` | 各 1 | 300000 |
| `filterOpencodeFree.mjs`、`opencodeGoUsage.mjs`、`probeAnthropicKeys.mjs` | 各 1 | 30000／10000／20000 |
| `quota/fetchQuotaJson.mjs`、`quota/getQuotaClaude.mjs`、`quota/getQuotaCodex.mjs` | 各 1 | 20000 |
| `quota/getQuotaAntigravity.mjs` | 1 | 60000 |
| `resolveCatalogue.mjs` | 3(`timeoutPatch`:全域、`providerTimeouts` 層、條目層) | null(該層視為未給,落到下一層) |
| `runExecCli.mjs` | 2(`timeoutMs`:直呼時之一致性,四家轉接器已先正規化;`transientRetry.delayMs`:交 wsemi `delay`) | 300000／2000 |
| `wkf/callAiWithFallback.mjs`、`wkf/runFanout.mjs`、`wkf/runRolePipeline.mjs` | 各 1(validate／parse 等待上限) | 300000 |

### 盤點指令

- `Grep "castPintOr\([^)]*timeoutMs" src` → 0 筆(舊判定不得殘留;`test/unit-castTimerMs.test.mjs`「src 內無 castPintOr(… timeoutMs …) 站點」).
- `Grep "castTimerMs\(" src` → 32 站點(同檔「站點全集」);`Grep "ispint\(|isp0int\(|isint\(" src`(排除註解)應只剩「次數／索引類」清單(規則 5 末項).

### 對應測試

- `test/unit-castTimerMs.test.mjs`:判定件(34 格輸入表、回傳型別、不夾上限、取值拋錯之物件不 throw)與站點盤點(3 案:無舊式站點、無行為測試之 8 站逐行固定、32 站全集).
- `test/unit-castPintOr.test.mjs`(新增 1 案)、`test/unit-msParamsG17.test.mjs`(7 案;規則 6:冷卻設定、期限提示與取整、額度閘讀者逾時、`minAttemptMs` 實呼)、`test/unit-opencodeTransientRetry.test.mjs`(新增 1 案:`transientRetry.delayMs` 無效回退 2000).
- `test/unit-timeoutEntrances.test.mjs`(26 案):①子行程探針(18 案,含「遞補層逐層回退」「守門運作之小數 `deadlineAt`」;`test/tools/probeTimeoutSitesForTest.mjs` 以 `module.register` 把 wsemi `execCli` 換成記錄替身 `recordExecCliForTest.mjs`,不 spawn、與負載無關)觀察 11 個入口實際交給 `execCli` 之 `timeoutMs` 與 `--print-timeout`(CLI 四家、`runExecCli`、`dispatchAiFallback`〔條目與共用〕、`createAiCaller`〔建構與逐次〕、`checkAgyStdinSupport`、`getQuotaAntigravity`);②REST 四家(4 案;真實 `setTimeout` 與 `fetch`,經 `test/tools/delayProxyForTest.mjs` 令伺服器端固定延遲 300 毫秒:誤採為 1 或 16 毫秒者必 `TIMEOUT`);③`fetchQuotaJson`、`probeAnthropicKey`(2 案;同延遲代理);④`budgetFor`、`timeoutPatch`(2 案).
- `test/unit-dispatchAntigravity.test.mjs`「printTimeout 未給時推導為 timeoutMs 加 30 秒…」:實際啟動假 CLI 者只取 `timeoutMs`≥40000 之格;極短值(1、999、1001 毫秒等)之推導改由上列參數層驗證(不依賴子進程啟動速度).
- 未有行為測試而僅由「站點盤點」固定者:`checkTruncation`、`filterOpencodeFree`、`opencodeGoUsage`、`getQuotaClaude`、`getQuotaCodex`、`wkf/callAiWithFallback`、`wkf/runFanout`、`wkf/runRolePipeline`(見變異驗證表).

### 變異驗證(副本 `tmp/da-hy/mut/` 上套用,`tmp/da-hy/mutate.mjs`,不入庫)

44 個變異,**44/44 被抓到**(括號內為 failing 數):
- 第一批(站點與判定件,M01～M34,測試檔 `unit-castTimerMs`＋`unit-timeoutEntrances`):M01～M27 各站點檔(27 檔)之 `castTimerMs` 改回 `castPintOr`(2～4);M28 `castTimerMs` 去掉 `min: 1`(15)、M29 超過上限者夾至 2147483647(18)、M30 回傳原值不轉 number(15)、M31 `--print-timeout` 緩衝 30→20 秒(2)、M32 `/usage` 之 `ceil` 改 `floor`(1)、M33 僅 `providerTimeouts` 層改回 `castPintOr`(2)、M34 `checkAgyStdinSupport` 外層 `Math.min` 移除(1).
- 第二批(外審後補修之規則 6,N01～N10,全部相關測試檔):N01 `castPintOr` 改回 `ispint`＋`cint`(5)、N02 `capByDeadline` 去 `Math.floor`(1)、N03 `capByHints` 去 `Math.floor`(1)、N04 `entryTimeout` 改回只看合併後之 `attemptOpt`(2)、N05 `transientRetry.delayMs` 改回 `castPintOr`(2)、N06 Go 額度閘讀者逾時改回 `ms()`(2)、N07 訂閱類額度閘讀者逾時改回 `ms()`(2)、N08 `coolCfgOf` 之 `cooldownMs` 改回 `ispint`＋`cint`(1)、N09 `readAttemptHints` 之 `minAttemptMs` 改回 `ispint`＋`cint`(1)、N10 遞補層 `minAttemptMs` 改回 `ispint`＋`cint`(1);首輪 N10 因重複 import 而載入失敗(trivial 擊殺),修正變異後重跑得 1.
- **僅被「站點盤點」(無行為測試)抓到者**:M03(`checkTruncation`)、M14(`filterOpencodeFree`)、M15(`opencodeGoUsage`)、M19／M20(`getQuotaClaude`／`Codex`)、M23～M25(工作流三站)各 3 failing(盤點之「無舊式站點」「逐行固定」「站點全集」三案);其餘站點另有行為案(探針、REST 延遲代理、fetch 讀者、純函數).
**修前紅**:`git archive HEAD` 解至 `tmp/da-hy/head`(修前 src／README／sgud)疊上新測試逐檔跑:`unit-timeoutEntrances` 24 failing／2 passing(後者為輸入表覆蓋與「無入口拋錯」;全檔 26 案)、`unit-msParamsG17` 7 failing／0 passing、`unit-castTimerMs` 載入失敗(模組不存在)、`unit-castPintOr` 1 failing、`unit-opencodeTransientRetry` 1 failing、`unit-providersHydrogenDocs` 3 failing／1 passing(公開庫守門為保持案)、`unit-dispatchAntigravity` 1、`unit-agyFailShapes` 1、三個條目數檔各 1;`unit-subQuotaGate` 之 `agyGroupOf` Hydrogen 例為保持案(規則未改,修前即綠).
