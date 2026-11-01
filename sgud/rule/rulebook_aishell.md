# 規則帳本:自專案端執行殼移入之 AI 件(目錄展開、原始呼叫器、結果日誌、嚴格解析)

本檔為索引 `sgud/rule/rulebook.md` 所指之類型檔;來源為 Gitea #40(tai-kns-trade 提出,2026-11-01;建議檔 `建議w-dispatch-ai調整.md`,主控裁定見該 issue 留言與任務 `20261101152333` 之 `decisions.tsv`).專案端 srcRunner(w-task-runner 0.1.0)原始碼本機無複本,**實作一律依建議檔所載之行為契約與測試案**;契約未載明而由本套件補定者,逐條標「(推定)」,供主控與專案方對照.**2026-11-01 da42(Gitea #42)專案方對照 srcRunner 原始碼與測試後,其中 5 處推定與原契約不符,已全數改回原契約(見 R-AISHELL-5;下列各節對應處標「已依原契約」)**.

## 通則

- **R-AISHELL-1 既有函數行為不變**:本批只新增(`resolveCatalogue.mjs`、`createAiCaller.mjs`、`wkf/logAiOutcome.mjs`、`wkf/parseJsonArray.mjs`、`wkf/parseIndexList.mjs`、`wkf/makeArrayCoverageValidator.mjs`),唯一改動既有檔者為 `WDispatchAi.mjs`(多 8 個匯出鍵,25 → 33)與其測試;`dispatchAiFallback`、`callAiWithFallback`、`dispatchAiWkf`、`createFileStore`、`createUsageCounter`、`extractJsonLoose`、`salvageTruncatedArray`、`resolveProviders`、`readEnvFile` 零改動.盤點:`git diff --stat -- src` 僅應見 `src/WDispatchAi.mjs`.
- **R-AISHELL-2 不依賴 w-data-pipeline**:盤點指令 `Grep "w-data-pipeline" src` 應僅見說明註解(`wkf/logAiOutcome.mjs` 檔頭)、不得有 import;`oneline` 於 `logAiOutcome.mjs` 內嵌(`strTruncate(String(s ?? '').replace(/\s+/g, ' ').trim(), n)` 等價,另先遮蔽金鑰樣式).
- **R-AISHELL-3 失敗通道(規格〈輸入參數之檢測機制〉§5.1)**:同步工廠/組裝(`mergeCatalogue`、`timeoutPatch`、`resolveCatalogue`、`createAiCaller`、`makeArrayCoverageValidator`、`logAiOutcome`、`createAiEventLogger`)之必要參數不合規即 throw,先於副作用;`callAI` 為回結果物件者,不 reject,失敗以結果物件回報;opt 選填鍵不合規一律視為未給、改用預設(K3),不 throw;錯誤訊息不回顯輸入值(K9).
- **R-AISHELL-4 日誌不外洩憑證(規格〈診斷輸出與遮罩〉D3/D4)**:`logAiOutcome`/`createAiEventLogger` 每行輸出前套 `maskApiKeys`,記錄器自身失敗吞掉;`createAiCaller` 回傳之 `providers` 含金鑰(JSDoc 警示勿寫日誌),其 `skipped`/`error` 字串只含 id 與變數名.
- **R-AISHELL-5 與 srcRunner 原契約之字面一致(Gitea #42,2026-11-01 da42;主控裁定「行為與契約隨件移動、不改語意」)**:五處已改回原契約,各附盤點指令與判準(已套/刻意不套);契約字面逐字對照測試 `test/unit-srcRunnerContract.test.mjs`(18 條),其期望輸出逐字取自建議檔所引之 srcRunner 測試斷言(`unit-runner.test.mjs:263-297,359-384`、`unit-check-ai.test.mjs:44-97`)與建議檔 §7 驗證案;輸入物件依建議檔對各斷言之描述重建(srcRunner 原始碼本機無複本).
  1. **`tag` 原樣接在每行之前**(原契約 `core/ai/logAiOutcome.mjs:51-53,114`):`prefixOf(tag)` = `typeof tag === 'string' ? tag : ''`,不加 `[ ]` 與空白,分隔符由呼叫端自帶(`tag: '步驟6：'` → `步驟6：使用 AI …`).盤點:`Grep "prefixOf" src` 應見 `logAiOutcome` 與 `createAiEventLogger` 各一處呼叫;`Grep "\[\$\{tag\}\]" src` 應 0 筆.**已套**.
  2. **「使用 AI」行以 `providerId` 有值為準,不看 `ok`**(原契約 `core/ai/logAiOutcome.mjs:56`):條件 `isestr(result.providerId)`.後果(原契約如此,非本套件新增):`dispatchAiFallback` 全數失敗之結果帶最後嘗試之 `providerId`(`dispatchAiFallback.mjs:934` `{ ...r, ...lastMeta, tried }`),故失敗結果也會印「使用 AI」行,其後接遞補歷程.**刻意不套(保留 1.0.63 寫法,專案方不要求改回)**:`kind`/`model` 皆缺時省略括號(原契約恆印 `（${kind}／${model}…）`,會印出 `undefined`).
  3. **遞補歷程耗時 `toFixed(1)`、冷卻分鐘數 `Math.round(cooldownMs / 60000)`**(原契約 `core/ai/logAiOutcome.mjs:75,117`):盤點 `Grep "toFixed\|Math.round" src/wkf/logAiOutcome.mjs`.`cooldownMs` 無效(非數字、非有限、≤ 0)時寫「冷卻視窗內」;不足 30 秒者 `Math.round` 得 `0 分鐘內`(原契約如此,未另加特例).**刻意不套(保留 1.0.63 擴充,專案方不反對)**:金鑰冷卻行(`scope==='key'`,「降至組內最後」)與「冷卻視窗內」字樣.
  4. **`createAiCaller.callAI` 零供應商 `error`**(原契約 `core/ai/caller.mjs:97,18-20`):`無可用的 AI 供應商${skipped.length ? `（${skipped.join('、')}）` : ''}`,只列 skipped(各形如 `id（ENVVAR 無金鑰）`),missing 不進 error(由 `providersMissing` 與 `logAiOutcome` 之 ERROR 行表達).`providersSkipped`/`providersMissing`/`attempts`/`tried` 不變.
  5. **`makeArrayCoverageValidator` 之 `indices` 非陣列**(原契約 `core/ai/parsers.mjs:118`):`TypeError('makeArrayCoverageValidator 之 indices 須為陣列')`.
  盤點/重跑:`npx mocha --no-parallel test/unit-srcRunnerContract.test.mjs test/unit-logAiOutcome.test.mjs test/unit-createAiCaller.test.mjs test/unit-makeArrayCoverageValidator.test.mjs`(經 `node C:/opensrcOper/tools/quiet-run.mjs --lock`).

## R-CATALOGUE-1 目錄展開(`src/resolveCatalogue.mjs`)

規則:
1. `mergeCatalogue(catalogue, extraProviders)`:新 id 追加於末端、同 id 逐欄覆蓋(淺合併)、不改動輸入;`extraProviders` 為 undefined/null 視為 `[]`,給了非陣列拋 `ai.extraProviders 須為陣列`,條目非物件或缺 id(非空字串)拋 `ai.extraProviders[i] 須為含 id 之條目物件`(先全數檢核再合併);`catalogue` 非陣列用內建 `providers.mjs`(空陣列是陣列,不退回內建).
2. `timeoutPatch(merged, { pick, providerTimeouts, timeoutMs })`:逐 id 取 `providerTimeouts[id]` → 條目自帶 `timeoutMs` → 全域 `timeoutMs`,回 `{ [id]: { timeoutMs } }`;`pick` 省略/空陣列/非陣列對全目錄;`merged` 非陣列拋 `timeoutPatch 需要 merged（條目陣列）`.**(推定)** 契約寫「只收正整數」,實作為每層經 `castPintOr`(數字字串轉為數字、K4;無效層視為未給而落到下一層、K3),與逐字 `??`(無效值即止)僅在「某層給了無效值」時不同.
3. `resolveCatalogue(opt)`:`env` 為物件則用之,否則 `envFile` 有給才 `readEnvFile`,皆無交 `resolveProviders` 預設(`process.env`);逾時 patch 與 `opt.patch` 逐 id 淺合併、`opt.patch` 優先;回 `{ merged, env, resolved }`,`resolved` 即 `resolveProviders` 原始回傳(含 `warnings`).**(推定)** 皆無 env 時回傳之 `env` 為 `null`(不回 `process.env` 之參照,避免日誌誤傾印).`resolveProviders` 之 `splitSemicolon` 未開放(契約未列).
4. 訊息字面保留(srcRunner 時代鍵名 `ai.extraProviders`),不改字——專案端與 tai-news-ai 有測試以字樣比對;改字須另案並通知使用端.

盤點/重跑:`npx mocha --no-parallel test/unit-resolveCatalogue.test.mjs`(21 條;經 `node C:/opensrcOper/tools/quiet-run.mjs --lock`).建議檔 §7-2 驗收:`unit-resolveCatalogue` 之「逐id逾時優先於條目自帶…」.

## R-CALLER-1 原始遞補呼叫器(`src/createAiCaller.mjs`)

規則:
1. 與工作流(`callAiWithFallback`/`dispatchAiWkf.callAi`)**並存**,語意不同(回原始結果、不解析、不加 `NO_SIDE_EFFECT`、未知 id 不拋而回報 `missing`/`hints`);選型表見 README「原始呼叫器 vs 工作流（選型）」.
2. 建構:`resolveCatalogue` 展開一次,回 `{ callAI, providers, skipped(字樣 `${id}（${envVar} 無金鑰）`), missing, hints }`;建構後改動 env 不影響已建之條目;`extraProviders` 不合規時建構 throw.
3. `callAI(prompt, { timeoutMs, validate, acceptTruncated, onEvent })`:第二參數非物件視為 `{}`;零供應商回 `{ ok:false, stdout:'', stderr:'', code:null, durationMs:0, attempts:0, error:'無可用的 AI 供應商（…）', tried:[], providersSkipped, providersMissing }`(不含 `errorType`,依契約逐欄);否則 `dispatchAiFallback` 原始結果另掛 `providersSkipped`/`providersMissing`(每次呼叫之新陣列);`acceptTruncated` 僅布林時透傳;**逐次 `timeoutMs` 為共用預設,條目自帶(含建構期逾時三層寫入者)優先**(`dispatchAiFallback` 之既有分層).零供應商 `error` **已依原契約**(Gitea #42,見 R-AISHELL-5-4):`無可用的 AI 供應商` 後接 `（<skipped 以「、」相接>）`,無 skipped 則無括號,missing 不進 error(原 da40 推定為「缺金鑰略過：…；pick 查無：…」/「條目清單為空」,已廢).
4. 事件:`try` 事件先 `onUsage(providerId)`、再建構期 `onEvent`、再逐次 `onEvent`;三者以 `callHookSync` 互相隔離(拋錯、回傳 Promise 皆忽略).`onUsage` 與 `createUsageCounter({ keyOf: (ev) => ev.providerId }).onEvent` 記帳等價(測試證明);預設 `keyOf` 記到 `keyId`.
5. 已知限制(移入時不改):`budgetMs` 為建構參數,`callAI` 不收逐次預算.`warnings`(`*_KEYS` 分號)未納入回傳形狀(契約逐欄),需要者改用 `resolveCatalogue` 讀 `resolved.warnings`.

盤點/重跑:`npx mocha --no-parallel test/unit-createAiCaller.test.mjs`(30 條;零供應商字面另見 `test/unit-srcRunnerContract.test.mjs`,含一條約 5 秒之 `maxRetries` 實跑;全程本機替身端點 `test/tools/fakeServerForCallerTest.mjs` 與假 CLI,不連外網).

## R-LOG-1 結果日誌(`src/wkf/logAiOutcome.mjs`)

規則:
1. `OUTCOME_TEXT = { 'next-key':'換金鑰', 'skip-group':'整組跳過' }`(凍結).
2. `logAiOutcome({ result, log, tag })`:`log` 缺/非物件拋 `logAiOutcome 需要 log（記錄器）`;至多四行:①`使用 AI …`(INFO,`providerId` 有值即記、不看 `ok`,**已依原契約**,見 R-AISHELL-5-2)②`AI 遞補歷程 → …`(WARN,濾掉 `ok`)③`AI 供應商未納入 → …`(WARN)④`providerPick 有無效 id → …（請對照供應商目錄）`(ERROR);記錄器兩種介面逐等級擇一,**一律以成員呼叫形式觸發**(`log[name](line)`,不脫離物件);WARN/ERROR 無專屬方法時退用 INFO 之方法.
3. `createAiEventLogger({ log, tag })`:`cooled` 事件寫 WARN `AI 供應商進入冷卻 → …`;`scope:'key'` 者如實寫「降至組內最後」.
4. **已依原契約**(Gitea #42,見 R-AISHELL-5-1、3):`tag` 原樣接在每行之前(非字串視為 `''`);耗時 `(durationMs/1000).toFixed(1)` 後加 `s`;分鐘數 `Math.round(cooldownMs / 60000)`(原 da40 推定之 `[tag] ` 前綴、耗時 `durationMs/1000`、分鐘至多一位小數,已廢).**(推定,契約未載明而由本套件補定,仍待專案方對照)**:①行 `key#` 僅 `keyIndex` 為數字者、`tokens` 僅 `usage` 兩數皆為數字者(OpenAI 系 `prompt_tokens/completion_tokens`、Anthropic 系 `input_tokens/output_tokens`)、`含思考` 僅 `reasoning_tokens > 0`、截斷加註僅 `truncated===true`、`kind`/`model` 皆缺時省略括號;②行單筆缺 `errorType`/原因/耗時時省略對應片段;原因取 `reason`,無則 `error`.
5. 補強(規格 D3/D4):每行 `maskApiKeys`;記錄器拋錯/rejected Promise 吞掉(`callHookSync`).

盤點/重跑:`npx mocha --no-parallel test/unit-logAiOutcome.test.mjs`(34 條).

## R-PARSE-1 嚴格解析與涵蓋率驗證(`src/wkf/parseJsonArray.mjs`、`parseIndexList.mjs`、`makeArrayCoverageValidator.mjs`)

規則:
1. 與寬鬆版**刻意並存**:`parseJsonArray` 取第一個完整片段、非陣列或括號未閉合回 `null`、不搶救;`extractJsonLoose`/`salvageTruncatedArray` 零改動.截斷之兩種策略由呼叫端選.
2. `parseIndexList(text, { min=1, max=Infinity, topN=Infinity })`:取「數字個數最多的那一串」(逗號/全形逗號/頓號,兩側容許空白不含換行),同長度取最先;單一個 `0` → `{ isZero:true, indices:[] }`;其餘依 min/max 過濾、topN 截取(不去重不排序);找不到數字 `{ isZero:false, indices:[] }`;超出安全整數者略過;opt 無效改用預設.
3. `makeArrayCoverageValidator({ indices=[], indexField='index', contentFields=[], maxLengths={}, onReject })` → `(stdout)=>Boolean`:順序為 完整 JSON 陣列(否則 `非 JSON 陣列或輸出截斷`)→ 超長(`第 ${index} 項之 ${f} 為 ${len} 字，超過上限 ${max}`,整體不合格)→ 涵蓋(`未涵蓋編號 …（缺項或內容為空）`);`indices` 給了非陣列(含 `null`)拋 `TypeError('makeArrayCoverageValidator 之 indices 須為陣列')`(**已依原契約**,Gitea #42,見 R-AISHELL-5-5),省略視為 `[]`.**(推定)** 編號須為數字(字串數字不算涵蓋);`未涵蓋編號` 之編號以「、」相接;項號只回報數字編號(否則 `?`,不回顯回覆任意值);`maxLengths` 內非正整數之上限略過、只檢字串欄位;`onReject` 以 `callHookSync` 隔離.

盤點/重跑:`npx mocha --no-parallel test/unit-parseJsonArray.test.mjs test/unit-parseIndexList.test.mjs test/unit-makeArrayCoverageValidator.test.mjs`(6＋12＋18 條).

## 變異驗證表(da42,R-AISHELL-5;`tmp/da42/mutate.mjs` 於 `tmp/da42/mut/work` 副本逐一套用,每個變異跑兩組:A=契約檔 `unit-srcRunnerContract` 單獨、B=該功能既有單元檔單獨;皆經 `quiet-run --lock`)

共 23 個變異,**A、B 兩組皆 23/23 被抓到**(括號為 A 組失敗條數):X1a tag 改回 `[tag] `(5)、X1b tag 後多一空白(5)、X1c 非字串 tag 也字串化(1)、X1d 事件記錄器忽略 tag(1)、X1e logAiOutcome 忽略 tag(4)、X2a 使用 AI 要求 `ok===true`(8)、X2b providerId 只排除 undefined(1)、X2c 使用 AI 不檢 providerId(3)、X3a 耗時不 `toFixed(1)`(3)、X3b 耗時 `toFixed(2)`(3)、X3c 冷卻分鐘一位小數(1)、X3d 冷卻分鐘 `Math.floor`(1)、X3e 冷卻分鐘 `Math.ceil`(1;B 組初次未抓到,補 70000 ms 案例後抓到)、X3f 保留項「冷卻視窗內」被移除(1)、X3g 保留項金鑰冷卻行被移除(1)、X4a 零供應商 error 改回 1.0.63 形(5)、X4b 無 skipped 仍帶空括號(2)、X4c skipped 以全形逗號相接(1)、X4d missing 併入括號(2)、X4e 括號內加「缺金鑰略過：」(4)、X4f 括號改列 missing(4)、X5a TypeError 訊息改回 `opt.indices`(1)、X5b 改拋 `Error`(1).**逐處改回 1.0.63 寫法者**(任務書要求):X1a、X2a、X3a、X3c、X4a、X5a.**修前紅**:未改碼(1.0.63 源碼)上契約檔 18 條全 failing.重跑:自 repo 根 `node tmp/da42/mutate.mjs`(腳本存於任務證據夾 `agent-out/da42-evidence/`,不入版控;可帶一個正規表達式只跑符合之變異).

## 變異驗證表(da40;`tmp/da40/mutate.mjs` 於 `tmp/da40/mut/work` 副本逐一套用,以 `quiet-run --lock` 跑對應測試檔)

共 62 個變異,**61 個被抓到、1 個為等價變異**(括號為失敗條數;其中 L08「tag 前綴移除」、L16「ok:false 也寫使用 AI」所描述之基準行為已於 da42 改回原契約而反轉,其意義由 da42 表之 X1、X2 取代):

| 件 | 變異 → 結果 |
|---|---|
| R-CATALOGUE-1(`resolveCatalogue.mjs`,測試 `unit-resolveCatalogue`) | M01 同 id 不覆蓋而追加(2)、M02 改動輸入陣列(5)、M03 extraProviders 非陣列不拋(2)、M04 壞條目索引 +1(2)、M05 逾時優先序反(2)、M06 忽略 pick 過濾(1)、M07 逾時不轉為數字(1)、M08 呼叫端 patch 不優先(1)、M09 envFile 優先於 env(1)、M10 丟掉 exes(1)、M11 merged 非陣列不拋(1)、M12 某層無效不落下一層(1)、M13 catalogue 非陣列不用內建(7) |
| R-CALLER-1(`createAiCaller.mjs`,測試 `unit-createAiCaller`) | C01 onUsage 於 ok 而非 try(3)、C02 零供應商不短路(3)、C04 skipped 字樣改半形括號(4)、C05 結果不掛 providersSkipped(1)、C06 store 不透傳(3)、C07 事件順序反(1)、C08 逐次 timeoutMs 不透傳(1)、C09 回傳內部陣列本身(1)、C10 cwd 不透傳(1)、C11 exes 不傳給 resolveCatalogue(2)、C12 validate 不透傳(3)、C13 掛前綴(3)、C14 onUsage 拋錯不隔離(1)、C15 maxRetries 不透傳(1);**C03 acceptTruncated 非布林也透傳:SURVIVED(等價變異)**——上游轉接器以 `get(opt, 'acceptTruncated') === true` 判定(`dispatchApiOpenaiCompat.mjs:418`),非布林值本就不放行,「僅布林時透傳」是契約之忠實實作而無外部可觀察差異 |
| R-LOG-1(`logAiOutcome.mjs`,測試 `unit-logAiOutcome`) | L01 脫離物件呼叫記錄器(2)、L02 WARN 寫到 ERROR(10)、L03 遞補歷程不濾 ok(2)、L04 不遮蔽金鑰(1)、L05 oneline 80→100(1)、L06 key# 不 +1(9)、L07 不加截斷註記(2)、L08 tag 前綴移除(2)、L09 事件記錄器不限 cooled(1)、L10 記錄器拋錯不隔離(2)、L11 reason／error 優先序反(1)、L12 log 缺不拋(2)、L13 WARN 無專屬方法不退用 INFO(1)、L14 錯誤不壓單行(3)、L15 不顯示思考 token(1)、L16 ok:false 也寫使用 AI(1) |
| R-PARSE-1(三檔,測試 `unit-parseJsonArray`／`unit-parseIndexList`／`unit-makeArrayCoverageValidator`) | P01 物件也回傳(3)、P02 同長度取最後(3)、P03 取最先串而非最長(2)、P04 單一個 0 不視為空集合(2)、P05 topN 不截取(2)、P06 max 不過濾(3)、P07 min 不過濾(2)、P08 頓號不當分隔符(2)、P09 超出安全整數不略過(1)、V01 indices 非陣列不拋(1)、V02 超長改 >=(1)、V03 內容空仍算涵蓋(2)、V04 純空白算有內容(2)、V05 onReject 拋錯不隔離(1)、V06 字串數字也算涵蓋(1)、V07 不檢查超長(5)、V08 缺項不拒收(6)、V09 截斷也放行(2) |

重跑:變異腳本 `mutate.mjs` 存於任務證據夾 `agent-out/da40-evidence/`(不入版控,執行時置於 `tmp/da40/` 並自 repo 根執行);作法:複製 `src` 與新測試至 `tmp/da40/mut/work`,逐一以字串替換套用變異(`from` 須在原檔恰出現一次,否則 SKIP),以 `quiet-run --lock` 跑對應測試檔,結果落 `tmp/da40/mutation-result.txt`.**修前紅**:`git archive HEAD src` 解到 `tmp/da40/head/src` 後以新測試跑,六個新測試檔與 `unit-WDispatchAi` 皆 `ERR_MODULE_NOT_FOUND`(`resolveCatalogue.mjs` 不存在),0 條可執行.
