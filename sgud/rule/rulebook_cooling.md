# 規則帳本:冷卻、健康與預算之語意邊界(R-COOL-1～4)

> 2026-11-11 建立(排程第 402 項、併 Gitea #130;設計輪 da402、實作輪 di402)。需求出處:每小時一輪之呼叫端(Gitea #130:冷卻視窗固定、跨輪而 15 分到下一輪已過期);設計輪探測 P1～P7。
> 原則:本套件擁有「失敗歸因(可由嘗試事實判定者)」「降序紀錄與視窗」「持久連敗」「預算之正規化與執行(含重試)」;呼叫端提供本套件拿不到之環境事實(本機斷網,`envDown`)。冷卻紀錄之唯一寫法在 `src/cooling.mjs`,呼叫端經匯出之 `coolEntry` 寫入、`coolingOf`／`streakOf` 讀取。
> 主控裁示(2026-11-11):採設計 §4.2;D11 甲(`castBudgetMs`,見 R-CALLER-1-6 改寫,`rulebook_aishell.md`);D13 甲(`cooldownGrowth` 預設 1、`cooldownMaxMs` 預設 24 小時)。

## R-COOL-1 封頂逾時 `budget-cut`(被呼叫端預算封頂之逾時不是條目之故障)

1. **標記於封頂發生處**:`dispatchAiFallback` 有期限時,對每次嘗試以內部鍵 `attemptHints = { deadlineAt, minAttemptMs, entryTimeoutMs }` 傳給轉接器(`src/attemptDeadline.mjs`);`runExecCli`(CLI 四家)與 REST 四家之重試層以 `createCutTracker` 於最後一次逾時標記 `cutByDeadline: true`、`appliedTimeoutMs`,條件:最後一次以逾時類結束(`TIMEOUT` 開頭,或 `OUTPUT_VALIDATION_FAILED` 且 stderr 以 `validate timed out` 開頭)、其逾時值 < `entryTimeoutMs`、非呼叫端自給之 `spawnGate.deadlineAt` 早於遞補層期限所致(`callerBound`)、同一嘗試內先前之重試沒有以 ≥ `entryTimeoutMs` 之逾時結束者。不以 `durationMs` 反推。
2. **遞補層判定**(`judgeBudgetCut`,純函數,`src/dispatchAiFallback.mjs`):逾時類 ∧ 有標記 ∧ 剩餘 < `minAttemptMs`(整鏈確已用盡)∧ 差額(`entryTimeoutMs − appliedTimeoutMs`)≥ `minAttemptMs`。成立則:不寫冷卻、不動 n 與連敗、不發 `skip-group`／`group-exhausted`;`tried` 記 `outcome: 'budget-cut'`(保留 `error`、`errorType`、`durationMs`、`stdout`、`stderr`,另記 `appliedTimeoutMs`、`entryTimeoutMs`);發事件 `budget-cut`;回 `{ error: 'budget exhausted', errorType: 'budget' }`(帶已累積之 `quotaExhausted`)。標記欄自結果移除,不外流。
3. **鏈首例外(D1-b)**:被封頂者為本次第一個實際嘗試(`attemptsSent === 1`;不含 `skip-key`／`quota-skip`／不可讀條目,亦不含未送出之 `params`／`spawn`／`aborted` 失敗——外審 terra F04)且 `cooldownMs > 0`、明給 id 時,以 `reason: 'budget'` 降序一個固定視窗(不動 n 與連敗、不發組盡);後段被封頂者不降序。
4. **邊界政策**:差額 < `minAttemptMs` 者照條目自己之逾時處置(冷卻、組盡、最終 `timeout`)——「預算＝各條目逾時之和」時末家恆被毫秒級封頂(探測 P2)。末家／非末家之最終型別不對稱為刻意(整鏈是否試完)。
5. 站點全集(重試層與標記):`src/runExecCli.mjs`(無驗證路徑之首次與接管重試、暫時性重試、有驗證路徑每輪)、`src/dispatchApiOpenaiCompat.mjs`、`src/dispatchApiOpenaiResponses.mjs`、`src/dispatchApiAnthropic.mjs`、`src/dispatchApiTypesafeSystemone.mjs` 之重試迴圈——皆 `cut.note`／`cut.mark`。盤點:`rg -n "createCutTracker|cut\.(note|mark)" src`。
6. 測試:`test/unit-dispatchAiFallbackBudgetCut.test.mjs`(`judgeBudgetCut` 邊界:差額 = `minAttemptMs` 為是、`minAttemptMs−1` 為否;`[真時間] DA-1` ①～⑦);既有案改寫:`unit-dispatchAiFallback`(剩餘預算壓進 timeoutMs)、`unit-cliSpawnGateAdapters`(守門＋預算)、`unit-createAiCaller`(逐次預算整合)、`unit-userFnValidate`(驗證等待逾時於被封頂之嘗試)。

## R-COOL-2 冷卻紀錄與加長(#130)

1. 紀錄 `state.cooling[id] = { at, n, reason }`;`reason` ∈ `timeout`／`rate-limit`／`detect`／`streak`／`quota`／`budget`。有效視窗＝固定視窗原因(`quota`、`budget`)? `cooldownMs` : `min(cooldownMs × cooldownGrowth^(n−1), cooldownMaxMs)`。
2. n 只在**視窗外**之觸發 +1(固定視窗原因不動 n;新建紀錄 n 為 1);**視窗內之觸發只更新 `at`**(所有寫者一律如此;n 與 reason 不變——既有加長視窗內遇 quota／budget 觸發仍沿用原視窗,即取嚴,外審 terra F07;事件之 `reason` 為觸發原因);每次呼叫每條目至多 +1(遞補層以 `incN` 追蹤,**本次新建亦算一級**,第二次起 `applyCool(..., noInc=true)`——terra F06)。
3. 成交刪紀錄(n 歸零);讀到過期不刪(保留 n);重排前 `sweepCooling` 掃整表:畸形紀錄(`at` 非正數、`n` 非正整數)與「現在 − at ≥ 有效視窗＋`cooldownMaxMs`」者刪除,舊格式數字改寫為 `{ at, n: 1, reason: 'timeout' }`,`at` 晚於現在者改寫為現在。
4. 選項:`cooldownGrowth`(≥1 之數字或數字字串,非預期之值 1)、`cooldownMaxMs`(正整數,非預期之值 24 小時,小於 `cooldownMs` 取 `cooldownMs`)。預設下視窗恆為 `cooldownMs`(排序同修前)。
5. 事件:條目層 `cooled` 每次呼叫每條目至多一則(`cooledIds`;內建觸發優先於 streak),`cooldownMs` 為本次有效視窗,另帶 `n`、`reason`;整組沒額度者仍帶 `scope: 'entry'`、`failureKind: 'no-credit'`。金鑰層 `keyCooling` 不在此列,維持固定視窗(`scope: 'key'`)。
6. 寫者全集(單一寫法 `applyCool`):遞補層內建觸發(逾時、限流、`coolDetect`)、整組沒額度(`quota`)、鏈首封頂(`budget`)、持久連敗(`streak`)、呼叫端經 `coolEntry`(如免費池,`quota`)。盤點:`rg -n "state\.cooling\[|\.cooling\[" src`(應只見 `cooling.mjs` 之寫入、`dispatchAiFallback.mjs` 之成交刪除與 envDown 還原)。
7. 匯出:`coolEntry(stateOrStore, id, { cooldownMs, reason, cooldownGrowth, cooldownMaxMs, now })` → `{ at, n, reason, cooldownMs, until }` 或 null(寫不進);`coolingOf(stateOrStore, id, opt?)` → `{ at, n, reason }`(給 `cooldownMs` 另帶 `cooldownMs`、`until`、`cooling`)或 null;`streakOf(stateOrStore, id)` → k(無則 0)。一般參數無效同步 throw(K2)。
8. **相容性**:修前版本讀到新格式會當過期而刪除——共用同一份持久 store 之所有使用者須同一次升版(README〈Breaking changes〉第 72 條)。
9. 測試:`test/unit-dispatchAiFallbackCoolGrowth.test.mjs`(預寫 store 紀錄模擬時間經過,429 快速觸發)、`test/unit-cooling.test.mjs`(同一組表格經 `coolEntry` 與經遞補層之 429)。

## R-COOL-3 持久連敗與環境歸因

1. `coolAfterFails`(正整數,僅 `cooldownMs > 0` 時有效):組盡(本組未成交而試完)且實際送出之嘗試數 > 0、各次 `errorType` 不全為 `params`、非整組沒額度時,`state.failStreak[id] = { k, at }` 之 k+1;成交刪除;達門檻以 `reason: 'streak'` 冷卻(`cooled` 另帶 `streak`、`errorType`〔本組最後一個計入之型別〕、`keys`、`attempted`);觸發後不歸零(其後每次再敗皆重申);同一次呼叫已有內建觸發之 `cooled` 者只累計不再發。
2. `failStreak` 之清理:`sweepCooling` 只刪畸形者;**不依時間過期**(設計無過期規則;初版曾依 `cooldownMaxMs` 過期,外審 terra F05 指出「上限短＋輪距長」之呼叫端永遠累計不到門檻,已撤回)。
3. `envDown`(`async () => Boolean`):整鏈皆敗(最終全敗之回傳路徑)且有實際嘗試(`attemptsSent > 0`)時詢問一次(等待恆為上限 `ENV_DOWN_WAIT_MS` 5 秒,**不以剩餘預算封頂**——2026-11-11 di402b 主控裁示甲,撤銷初版 terra F17 之封頂:環境歸因屬整鏈結束後之記帳,而使用端預算恆為各條目逾時之和或更小,斷網時條目常等滿逾時、整鏈結束時剩餘 ≈ 0,封頂則等待約 1 毫秒、呼叫端之真實探測〔數十毫秒至數秒〕來不及回覆即視同「通」,斷網被計為條目故障、n 與連敗落定並跨輪保留;拋錯、reject、逾時、非 `true` 皆視為否);為真即以**減去本次增量**還原(terra F03:等待期間並行呼叫可能已改動同一條目):冷卻紀錄 n−1(下限 1;本次新建者維持 n 1;`at` 保留;本次寫入之 reason 仍為現值時還原為寫入前之 reason——terra F08)、連敗 k−本次遞增數(歸 0 即刪);紀錄已被他呼叫刪除(成交)者不復活。結果帶 `envDown: true`。提前返回(budget-out、budget-cut、中止、脈絡過長)不詢問。
4. **工作流帶出**(di402b):`callAiWithFallback`(`src/wkf/callAiWithFallback.mjs`)失敗回傳於遞補層結果 `envDown === true` 時帶 `envDown: true`(僅為 true 時有此鍵;成交、未給、為否、拋錯者皆無此鍵),上層(工作流入口、呼叫端)不必另問。經 `createAiCaller.callAI` 者原已以展開帶出。站點全集:`rg -n "envDown" src`(遞補層詢問處一處、`callAiWithFallback` 帶出一處、`createAiCaller`／`dispatchAiWkf` 僅轉傳選項)。
5. 測試:`test/unit-dispatchAiFallbackFailStreak.test.mjs`(不落定之還原、詢問條件、並行不復活);`test/unit-dispatchAiFallbackEnvDownWait.test.mjs`(di402b:剩餘 ≈ 0 之整鏈失敗 + 延遲 50 毫秒／2 秒回 true → `envDown: true` 且 n 與連敗不落定、延遲 6 秒 → 視為否〔5 秒上限〕、`callAiWithFallback` 帶出;`[真時間]` 案依計時器規範:條目逾時 = 預算使剩餘 ≈ 0,詢問時自證剩餘 < `minAttemptMs`)。原 FailStreak 之「以剩餘預算封頂」案(永不落定之 envDown 於 4 秒內結束)隨封頂撤銷而移除。

## R-COOL-4 期限約束一切重試

1. 有期限時(`attemptHints`),每次重試之逾時以剩餘預算封頂(`capByHints`),「剩餘 − 退避 < `minAttemptMs`」即不再重試(`retryFits`)。REST 四家之重試迴圈(429／5xx／網路／逾時等可重試之失敗)與 `runExecCli` 皆適用;首次嘗試之逾時已由遞補層封頂。
2. **CLI 由 `runExecCli` 接管**:有期限且 `maxRetries > 0` 時交 `execCli` 之 `maxRetries` 為 0,本層逐次呼叫,不重試判準沿用 `execCli` 之觀察事件 `done` 之 `reason`(`spawn`／`enoent`／`code2` 不重試,`exhausted` 可重試),間隔公式同 `execCli`(`retryDelayMs × 已嘗試次數`,上限 15000)。無驗證路徑之接管重試不重新守門(同修前 `execCli` 內部重試之已知限制);有驗證路徑每次重試(含驗證不過之重試)回迴圈頂再守門並受 `retryFits` 約束。無驗證路徑接管時,呼叫端 `onTrace` 所見與 `execCli` 自身之重試迴圈相同(`attempt` 之 n 累計、重試前補發 `retry { n, ms }`、`done` 只一則且 n 為總次數——terra F13);有驗證路徑之事件序列本即每次呼叫 `execCli` 各一組(修前之驗證重試即如此)。opencode 之暫時性錯誤重試亦以 `attemptHints` 判 `retryFits`(守門關閉時亦然——terra F01)。不擴充 wsemi(原則 16)。無期限時與修前逐位元相同。
3. 測試:`test/unit-retryDeadline.test.mjs`(**真時間,集中於本檔**,計時器規格 P6):REST 四家收件 ≤2(修前 3)、CLI 兩路徑 spawn 事件 ≤2(修前 3)、末次判為 `budget-cut`;轉接器層(直呼帶 `attemptHints`)REST 四家 `attempts` ≤2 且末次逾時值 < 給定之 1500;驗證重試之 `retryFits`(spawn 1);接管時之觀察事件序列;opencode 暫時性重試於守門關閉時之期限;無期限對照收件 3。

## 已知限制與待裁示(di402;外審 terra 所提、經核對屬實而本輪不改者)

1. **額度閘之等候截斷(R-COOL-4/DA-3)**:有期限時以 `capWait` 截斷遞補層對額度閘之等候,用量讀者本身之逾時不變——查詢於背景續跑並照常快取,`subGateDecide` 可能於本次回傳後寫(作廢或入帳)額度帳(terra F02)。未改讀者逾時之理由:讀者逾時之失敗會被快取 60 秒而令額度閘於快取期間 fail-open。列需裁示(修正報告 §0.3-1)。
2. **呼叫端自給之 `spawnGate.deadlineAt` 優先於遞補層期限(既有,Gitea #67)**:呼叫端給較晚之期限時,守門等待可越過 `budgetMs`、放行後之首次 spawn 沿用先前算出之逾時(terra F11)。設計未列此改動;建議改為兩者取早(原則 3),列需裁示。
3. **agy stdin 路徑之版本探測(既有,ke342)**:探測與主程序各以 `timeoutMs` 計,守門未運作時兩段可能各耗一輪預算(terra F12);範圍外,列已知。
4. **`createFileStore` 之外來副本(DA-10)**:`set` 收到非 `get` 所回之物件時以頂層鍵併入(同設計所引之知識管線作法),副本缺少之頂層鍵不刪除、副本之巢狀物件整鍵取代;簽章以 mtime＋大小比對,等長且同時刻之行程外改寫察覺不到(terra F10、F15)。
5. **`castBudgetMs` 之極端值**:超出安全整數之有限數視為不限(K6),下溢之數字字串(如 `'1e-400'`,`isenum` 依 dspec 判無效)視為不限(terra F09;兩者實務上等同不限,未改)。

## 變異驗證表(di402;`tmp/di402/mutate.mjs` 於副本 `tmp/di402/mut` 逐一套用、跑對應測試,不改 repo 之 src;經 `quiet-run --lock`)

見修正報告 `di402-修正報告.md`〈變異驗證〉之表(28 個變異之 KILLED／SURVIVED 與歸因)。
