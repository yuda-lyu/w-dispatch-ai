# 現況(state)(類型:timeoutMs 與其餘毫秒設定之判定單一來源 castTimerMs／castPintOr(排程第 438 項,da-hy))

本檔自 2026-11-13 da-hy 起單列(全域 §14:依功能類型分檔);索引見 `sgud/state/state.md`.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- 2026-11-13 da-hy(排程第 438 項;**未發布**,版本號與發布由主控處理):新增 `src/castTimerMs.mjs`,取代 27 個「`castPintOr(… timeoutMs …)`」站點(25 檔),外審後另補 5 站(`entryTimeout` 之共用層、額度閘 3 處、`transientRetry.delayMs`),共 32 站 27 檔;`castPintOr` 內部改 `iseint`(其餘毫秒設定同判定:`minAttemptMs`、`cooldownMs`、`cooldownMaxMs`、`retryDelayMs` 等;`cooling.mjs`、`attemptDeadline.mjs` 之 `ispint`＋`cint` 一併改);由期限導出之逾時向下取整(`capByDeadline`、`capByHints`);`dispatchAiFallback` 之 `entryTimeout` 逐層回退;`dispatchAntigravity` 移除 `MAX_TIMER_MS` 封頂;`getQuotaAntigravity.agyPrint` 移除 `Math.min(…, 2147483647)`;README 行為變更第 73 條(併 Hydrogen 條目)、第 32 條更正、「Timeout 總覽」補〈`timeoutMs` 之有效值〉段與選項表、agy 防寫邊界段.**行為變更**:超過 2147483647 者(CLI 修前原樣交 `execCli`〔1.9.59 起改用 120000〕、REST 修前交 `setTimeout`〔溢位 1 毫秒〕)、`Infinity`、`'0x10'`、包裝物件現一律用預設;`minAttemptMs: Infinity` 等修前得 1.8e308 者現用預設;條目自帶之無效 `timeoutMs` 不再遮蔽有效之共用值;有效值之行為不變.

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 | 狀態 |
|---|---|---|---|
| `castTimerMs` 判定件(34 格輸入表) | R-TIMEOUT-1 規則 1～2 | `test/unit-castTimerMs.test.mjs`(3 案判定件)、`test/tools/timeoutCasesForTest.mjs` | 完成 |
| 站點盤點(無舊式站點、無行為測試之 8 站逐行固定、32 站全集) | R-TIMEOUT-1 站點全集、盤點指令 | 同檔(3 案) | 完成 |
| 13 個入口實際交給 `execCli` 之 `timeoutMs` 與 `--print-timeout`(子行程探針,execCli 記錄替身;含遞補層逐層回退、守門運作之小數 `deadlineAt`) | R-TIMEOUT-1 規則 1、3、4、6 | `test/unit-timeoutEntrances.test.mjs`(探針 18 案;全檔 26 案)、`test/tools/probeTimeoutSitesForTest.mjs` 等 | 完成 |
| REST 四家與 `fetchQuotaJson`／`probeAnthropicKey` 非預期值採用預設(真實 `setTimeout`／`fetch`,延遲代理 300 毫秒) | R-TIMEOUT-1 規則 2 | 同檔(REST 4 案、fetch 讀者 2 案)、`test/tools/delayProxyForTest.mjs` | 完成 |
| `budgetFor`／`timeoutPatch` 與實際採用值一致 | R-TIMEOUT-1 軸「入口」 | 同檔(2 案) | 完成 |
| 其餘毫秒設定同判定(`castPintOr` 改 `iseint`;冷卻、期限提示、取整、額度閘讀者逾時、`minAttemptMs`、`transientRetry.delayMs`) | R-TIMEOUT-1 規則 6 | `test/unit-castPintOr.test.mjs`(+1)、`test/unit-msParamsG17.test.mjs`(7 案)、`test/unit-opencodeTransientRetry.test.mjs`(+1) | 完成 |
| `unit-dispatchAntigravity` 之 `printTimeout` 案不依賴子進程啟動速度 | R-AGY-2 對應測試註記 | `test/unit-dispatchAntigravity.test.mjs`(實際啟動者僅 `timeoutMs`≥40000 之 16 格) | 完成;高負載偶發空輸出已移除成因(未以人為負載重現,見經驗) |
| 變異驗證 | R-TIMEOUT-1 變異驗證 | `tmp/da-hy/mutate.mjs`(不入庫) | 44/44 被抓到 |

## 三、已知待辦

- **次數／索引類仍以 `ispint`／`isp0int`＋`cint` 判定(G17② 順改,非毫秒,本輪不動)**:`maxRetries`(REST 四家 `dispatchApi*.mjs`、`runExecCli.mjs`:`Infinity` 轉為極大有限數而近乎無限重試,外審 #4)、`keepDays`(`createUsageCounter`)、`maxLengths`(`makeArrayCoverageValidator`)、`minCandidates`(`runFanout`)、`parseIndexList` 之 `min`／`max`／`topN`、遞補層 `cursor`、舊式冷卻時間戳 `ts`、內部結果值 `appliedTimeoutMs`.待主控裁示是否另案一次改(語意:次數類以 `iseint` 之 `count`).
- **僅「站點盤點」固定、無行為測試之站點**:`checkTruncation`、`filterOpencodeFree`、`opencodeGoUsage`、`getQuotaClaude`、`getQuotaCodex`、`wkf/callAiWithFallback`、`wkf/runFanout`、`wkf/runRolePipeline`(變異 M03、M14、M15、M19、M20、M23～M25 各只被盤點 3 案抓到;盤點含逐行固定運算式,改回舊判定必紅);`fetchQuotaJson`、`probeAnthropicKey` 已補行為案.
- 整數(execCli 同,本套件 `timeoutMs`)與允許小數(閘門快取間隔 `ms()`:`isenum` timer、`gt: 0`)兩種判定並存,屬規格層(dspec §7.1 寫「計時毫秒一般用 `isenum` timer」,wsemi `execCli` 實作用 `iseint`),見 `sgud/feedback/feedback.md`.
- `dist/` 為發布時自動產製(全域 §5.1),未隨本輪更新;從套件主入口載入之測試不在本輪範圍.
