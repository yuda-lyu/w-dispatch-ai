# 現況:冷卻、健康與預算之語意邊界(排程第 402 項、併 Gitea #130)

## 一、版本與未發布之改動

- 2026-11-11 di402(實作第一階段,設計 da402 經主控採納;裁示 D11 甲、D13 甲):DA-1～DA-11 全數實作,**未發布**(發布由使用者／主控;須與 w-knowledge-capture 之 CA 階段**同一發布窗**——舊版讀到新冷卻格式會刪除,README〈Breaking changes〉第 72 條)。
- 新增檔:`src/cooling.mjs`、`src/castBudgetMs.mjs`、`src/attemptDeadline.mjs`;改動:`dispatchAiFallback.mjs`、`runExecCli.mjs`、REST 四家、`createAiCaller.mjs`、`wkf/createFileStore.mjs`、`wkf/runFanout.mjs`、`wkf/runRolePipeline.mjs`、`wkf/logAiOutcome.mjs`、`WDispatchAi.mjs`、README。
- 2026-11-11 di402b(DA 補修,主控裁示甲;承 ci402 查出之迴歸):`envDown` 之等待改恆為 5 秒上限、不以剩餘預算封頂(整鏈結束時剩餘 ≈ 0 之斷網得以歸因);`callAiWithFallback` 失敗回傳於遞補層 `envDown === true` 時帶 `envDown: true`。仍**未發布**。改動檔:`dispatchAiFallback.mjs`(`:1289` 與註解／JSDoc／檔頭)、`wkf/callAiWithFallback.mjs`、README、帳本 R-COOL-3;新測試 `unit-dispatchAiFallbackEnvDownWait`,移除 `unit-dispatchAiFallbackFailStreak` 之封頂案。
- 新增匯出(供 CA 階段):`castBudgetMs`、`coolEntry`、`coolingOf`、`streakOf`(簽章見 `rulebook_cooling.md` R-COOL-2⑦)。
- 2026-11-11 d417(排程第 417 項與第 421 項,皆承第 402 項;主控已裁示)——仍**未發布**(同一發布窗):①第 417 項:呼叫端自給之 `spawnGate.deadlineAt` 與遞補層期限**取較早者**(`cliSpawnGate.resolveSpawnGate`、`runExecCli` 之 `effDeadline`／`capByDeadline`／`budgetOk`;封頂標記 `callerBound` 依取早後之來源,見 R-COOL-5);`minAttemptMs`／`shouldStop` 之優先序不動。②第 421 項:條目層 `cooled` 事件與 `coolEntry` 回傳加布林 `renewed`(寫入前已在有效視窗內＝視窗內之重申),見 R-COOL-2 第 10 點。改動檔:`cliSpawnGate.mjs`、`runExecCli.mjs`、`cooling.mjs`、`dispatchAiFallback.mjs`、README(〈Breaking changes〉第 72 條 ④⑨、〈CLI spawn 守門〉、`cooled` 事件說明、`coolEntry` 匯出)、帳本 `rulebook_cooling.md`(R-COOL-5 新增、R-COOL-2 第 10 點、已知限制 2 結案)與 `rulebook_spawngate.md`(R-SPAWNGATE-1 ⑧、-4 ⑤、-5 ③);新測試 `unit-spawnGateDeadlineEarlier`、`unit-coolRenewed`;改動之既有測試 `unit-cliSpawnGate`(提示與物件之解析案改為取早)、`unit-opencodeTransientRetry`(加取早案、`spawnGate: false` 只給 `attemptHints` 時照常重試、守門未運作之重試輪標記)、`unit-cooling`(store 案加 `renewed: false`)、`unit-dispatchAiFallbackKinds`(條目層事件帶 `renewed`、金鑰層不帶)。外審 terra 之屬實項已修:期限來源不併入 `attemptHints`(#02,初版迴歸)、暫時性重試輪標記依取早後之來源(#03)、封頂值與標記取自同一快照(#04)、quota 事件寫不進時不帶 `renewed`(#09)、測試補下界與裕度(#11～#13)、文件用語(#14、#15);既有未動項列 R-COOL-5 第 6 點。

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 | 狀態 |
|---|---|---|---|
| 封頂逾時 `budget-cut`(標記、判定、鏈首例外、邊界政策) | R-COOL-1 | `unit-dispatchAiFallbackBudgetCut`(含 `judgeBudgetCut` 邊界與 `[真時間]` 七案)、改寫之既有案(`unit-dispatchAiFallback`、`unit-cliSpawnGateAdapters`、`unit-createAiCaller`、`unit-userFnValidate`) | 完成 |
| 提前返回帶 `quotaExhausted`、預算先於額度閘 | R-COOL-1、R-COOL-4 | 同上 DA-2、DA-3 | 完成 |
| 冷卻紀錄 `{at,n,reason}` 與加長、清理、匯出 | R-COOL-2 | `unit-dispatchAiFallbackCoolGrowth`、`unit-cooling` | 完成 |
| 持久連敗、`envDown`(等待恆 5 秒上限、不以剩餘預算封頂;di402b) | R-COOL-3 | `unit-dispatchAiFallbackFailStreak`、`unit-dispatchAiFallbackEnvDownWait` | 完成 |
| 工作流 `callAiWithFallback` 回傳帶出 `envDown`(為 true 時;di402b) | R-COOL-3 第 4 點 | `unit-dispatchAiFallbackEnvDownWait` | 完成 |
| 期限約束重試(REST 四家、CLI 接管) | R-COOL-4 | `unit-retryDeadline`(真時間) | 完成 |
| `castBudgetMs` 與兩類宣告(三入口) | R-CALLER-1-6(改寫) | `unit-castBudgetMs`、`unit-budgetMsCast`、`unit-createAiCaller` | 完成 |
| 新選項三入口接線 | R-COOL-2／3 | `unit-coolOptionsWiring` | 完成 |
| `createFileStore` 同檔共用物件 | R-COOL-2⑧(相容) | `unit-createFileStoreShared` | 完成 |
| `OUTCOME_TEXT` 之 `budget-cut` | — | `unit-logAiOutcome` | 完成 |
| 呼叫端 `spawnGate.deadlineAt` 與遞補層期限取早(守門等待、spawn 逾時封頂、暫時性重試預算、封頂標記之來源;d417) | R-COOL-5(併 R-SPAWNGATE-1 ⑧、-4 ⑤、-5 ③) | `unit-spawnGateDeadlineEarlier`(含 `[真時間]` 案)、`unit-cliSpawnGate`、`unit-opencodeTransientRetry` | 完成 |
| `cooled` 事件與 `coolEntry` 回傳之 `renewed`(d417) | R-COOL-2 第 10 點 | `unit-coolRenewed`、`unit-cooling` | 完成 |

最近一次驗證:2026-11-11 di402b 全套 `npm test`(經測試鎖)1746 passing／1 pending／0 failing(= di402 收尾 1741 + 新增 6 案 − 移除 1 案);di402b 變異 3 個(恢復剩餘預算封頂、上限 5→10 秒、`callAiWithFallback` 不帶出)皆被抓到。前次(di402 收尾):1741 passing／1 pending／0 failing(修前 HEAD 1647 passing);變異 39 個全數被抓到;真時間檔連跑 3 次皆綠;外審 terra 屬實之缺陷已修並補測試(見修正報告)。

## 三、已知待辦

1. CA 階段(w-knowledge-capture):`reservedAiCallOf`、`captureCallMsOf` 多席、`callJson` 歸類、健康層只觀察、免費池經 `coolEntry`、評比分類;依賴本套件新版並同一發布窗(主控派工)。
2. 額度閘等候以剩餘預算截斷時,用量查詢於背景續跑(結果照常快取;`subGateDecide` 可能於本次回傳後寫 state)——已知、未處理(設計之「用量查詢之逾時以剩餘預算封頂」以截斷等候實作,見修正報告需裁示)。
3. ~~呼叫端自給之 `spawnGate.deadlineAt` 優先於遞補層期限~~:已處理(d417,兩者取早,R-COOL-5)。**待裁示**:同形之 `minAttemptMs`／`shouldStop` 仍物件優先(R-COOL-5 第 5 點:呼叫端自給 `shouldStop` 時遞補層之中止請求不中止守門等待;呼叫端較小之 `minAttemptMs` 令守門截止較遲),是否同改取嚴(`shouldStop` 以「或」合併、`minAttemptMs` 取較大者)。
4. 無驗證路徑之 CLI 接管重試不重新守門(同修前 execCli 內部重試之已知限制);agy stdin 路徑之版本探測與主程序各計逾時(既有)。
5. 跨行程同時寫同一狀態檔仍互相覆寫(單行程假設不變);`createFileStore` 之簽章比對(mtime＋大小)察覺不到等長同時刻之行程外改寫。
6. 帳本 `rulebook_cooling.md`〈已知限制與待裁示〉為上列之單一來源。
