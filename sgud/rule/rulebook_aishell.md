# 規則帳本:自專案端執行殼移入之 AI 件(目錄展開、原始呼叫器、結果日誌、嚴格解析)

本檔為索引 `sgud/rule/rulebook.md` 所指之類型檔;來源為 Gitea #40(使用端提出,2026-11-01;建議檔 `建議w-dispatch-ai調整.md`,主控裁定見該 issue 留言與任務 `20261101152333` 之 `decisions.tsv`).專案端執行殼(w-task-runner 0.1.0)原始碼本機無複本,**實作一律依建議檔所載之行為契約與測試案**;契約未載明而由本套件補定者,逐條標「(推定)」,供主控與專案方對照.**2026-11-01 da42(Gitea #42)專案方對照執行殼原始碼與測試後,其中 5 處推定與原契約不符,已全數改回原契約(見 R-AISHELL-5;下列各節對應處標「已依原契約」)**.

## 通則

- **R-AISHELL-1 既有函數行為不變**:本批只新增(`resolveCatalogue.mjs`、`createAiCaller.mjs`、`wkf/logAiOutcome.mjs`、`wkf/parseJsonArray.mjs`、`wkf/parseIndexList.mjs`、`wkf/makeArrayCoverageValidator.mjs`),唯一改動既有檔者為 `WDispatchAi.mjs`(多 8 個匯出鍵,25 → 33)與其測試;`dispatchAiFallback`、`callAiWithFallback`、`dispatchAiWkf`、`createFileStore`、`createUsageCounter`、`extractJsonLoose`、`salvageTruncatedArray`、`resolveProviders`、`readEnvFile` 零改動.盤點:`git diff --stat -- src` 僅應見 `src/WDispatchAi.mjs`.
- **R-AISHELL-2 不依賴 w-data-pipeline**:盤點指令 `Grep "w-data-pipeline" src` 應僅見說明註解(`wkf/logAiOutcome.mjs` 檔頭)、不得有 import;`oneline` 於 `logAiOutcome.mjs` 內嵌(`strTruncate(String(s ?? '').replace(/\s+/g, ' ').trim(), n)` 等價,另先遮蔽金鑰樣式;2026-11-02 r3da 起 `n` 先經 `iseint` 之 count 把關,無效則不截斷,見 R-LOG-2).
- **R-AISHELL-3 失敗通道(規格〈輸入參數之檢測機制〉§5.1)**:同步工廠/組裝(`mergeCatalogue`、`timeoutPatch`、`resolveCatalogue`、`createAiCaller`、`makeArrayCoverageValidator`、`logAiOutcome`、`createAiEventLogger`)之必要參數不合規即 throw,先於副作用;`callAI` 為回結果物件者,不 reject,失敗以結果物件回報;opt 選填鍵不合規一律視為未給、改用預設(K3),不 throw;錯誤訊息不回顯輸入值(K9).
- **R-AISHELL-4 日誌不外洩憑證(規格〈診斷輸出與遮罩〉D3/D4)**:`logAiOutcome`/`createAiEventLogger` 每行輸出前套 `maskApiKeys`,記錄器自身失敗吞掉;`createAiCaller` 回傳之 `providers` 含金鑰(JSDoc 警示勿寫日誌),其 `skipped`/`error` 字串只含 id 與變數名.
- **R-AISHELL-5 與執行殼原契約之字面一致(Gitea #42,2026-11-01 da42;主控裁定「行為與契約隨件移動、不改語意」)**:五處已改回原契約,各附盤點指令與判準(已套/刻意不套);契約字面逐字對照測試 `test/unit-execShellContract.test.mjs`(18 條),其期望輸出逐字取自建議檔所引之執行殼測試斷言(`unit-runner.test.mjs:263-297,359-384`、`unit-check-ai.test.mjs:44-97`)與建議檔 §7 驗證案;輸入物件依建議檔對各斷言之描述重建(執行殼原始碼本機無複本).
  1. **`tag` 原樣接在每行之前**(原契約 `core/ai/logAiOutcome.mjs:51-53,114`):`prefixOf(tag)` = `typeof tag === 'string' ? tag : ''`,不加 `[ ]` 與空白,分隔符由呼叫端自帶(`tag: '步驟6：'` → `步驟6：使用 AI …`).盤點:`Grep "prefixOf" src` 應見 `logAiOutcome` 與 `createAiEventLogger` 各一處呼叫;`Grep "\[\$\{tag\}\]" src` 應 0 筆.**已套**.
  2. **「使用 AI」行以 `providerId` 有值為準,不看 `ok`**(原契約 `core/ai/logAiOutcome.mjs:56`):條件 `isestr(result.providerId)`.後果(原契約如此,非本套件新增):`dispatchAiFallback` 全數失敗之結果帶最後嘗試之 `providerId`(`dispatchAiFallback.mjs:934` `{ ...r, ...lastMeta, tried }`),故失敗結果也會印「使用 AI」行,其後接遞補歷程.**刻意不套(保留 1.0.63 寫法,專案方不要求改回)**:`kind`/`model` 皆缺時省略括號(原契約恆印 `（${kind}／${model}…）`,會印出 `undefined`).
  3. **遞補歷程耗時 `toFixed(1)`、冷卻分鐘數 `Math.round(cooldownMs / 60000)`**(原契約 `core/ai/logAiOutcome.mjs:75,117`):盤點 `Grep "toFixed\|Math.round" src/wkf/logAiOutcome.mjs`.`cooldownMs` 無效(非數字、非有限、≤ 0)時寫「冷卻視窗內」;不足 30 秒者 `Math.round` 得 `0 分鐘內`(原契約如此,未另加特例).**刻意不套(保留 1.0.63 擴充,專案方不反對)**:金鑰冷卻行(`scope==='key'`,「降至組內最後」)與「冷卻視窗內」字樣.
  4. **`createAiCaller.callAI` 零供應商 `error`**(原契約 `core/ai/caller.mjs:97,18-20`):`無可用的 AI 供應商${skipped.length ? `（${skipped.join('、')}）` : ''}`,只列 skipped(各形如 `id（ENVVAR 無金鑰）`),missing 不進 error(由 `providersMissing` 與 `logAiOutcome` 之 ERROR 行表達).`providersSkipped`/`providersMissing`/`attempts`/`tried` 不變.
  5. **`makeArrayCoverageValidator` 之 `indices` 非陣列**(原契約 `core/ai/parsers.mjs:118`):`TypeError('makeArrayCoverageValidator 之 indices 須為陣列')`.
  盤點/重跑:`npx mocha --no-parallel test/unit-execShellContract.test.mjs test/unit-logAiOutcome.test.mjs test/unit-createAiCaller.test.mjs test/unit-makeArrayCoverageValidator.test.mjs`(經 `node C:/opensrcOper/tools/quiet-run.mjs --lock`).

## R-CATALOGUE-1 目錄展開(`src/resolveCatalogue.mjs`)

規則:
1. `mergeCatalogue(catalogue, extraProviders)`:新 id 追加於末端、同 id 逐欄覆蓋(淺合併)、不改動輸入;`extraProviders` 為 undefined/null 視為 `[]`,給了非陣列拋 `ai.extraProviders 須為陣列`,條目非物件或缺 id(非空字串)拋 `ai.extraProviders[i] 須為含 id 之條目物件`(先全數檢核再合併);`catalogue` 非陣列用內建 `providers.mjs`(空陣列是陣列,不退回內建).
2. `timeoutPatch(merged, { pick, providerTimeouts, timeoutMs })`:逐 id 取 `providerTimeouts[id]` → 條目自帶 `timeoutMs` → 全域 `timeoutMs`,回 `{ [id]: { timeoutMs } }`;`pick` 省略/空陣列/非陣列對全目錄;`merged` 非陣列拋 `timeoutPatch 需要 merged（條目陣列）`.**(推定)** 契約寫「只收正整數」,實作為每層經 `castPintOr`(數字字串轉為數字、K4;無效層視為未給而落到下一層、K3),與逐字 `??`(無效值即止)僅在「某層給了無效值」時不同.
3. `resolveCatalogue(opt)`:`env` 為物件則用之,否則 `envFile` 有給才 `readEnvFile`,皆無交 `resolveProviders` 預設(`process.env`);逾時 patch 與 `opt.patch` 逐 id 淺合併、`opt.patch` 優先;回 `{ merged, env, resolved }`,`resolved` 即 `resolveProviders` 原始回傳(含 `warnings`).**(推定)** 皆無 env 時回傳之 `env` 為 `null`(不回 `process.env` 之參照,避免日誌誤傾印).`resolveProviders` 之 `splitSemicolon` 未開放(契約未列).
4. 訊息字面保留(執行殼時代鍵名 `ai.extraProviders`),不改字——專案端與使用端有測試以字樣比對;改字須另案並通知使用端.

盤點/重跑:`npx mocha --no-parallel test/unit-resolveCatalogue.test.mjs`(21 條;經 `node C:/opensrcOper/tools/quiet-run.mjs --lock`).建議檔 §7-2 驗收:`unit-resolveCatalogue` 之「逐id逾時優先於條目自帶…」.

## R-CALLER-1 原始遞補呼叫器(`src/createAiCaller.mjs`)

規則:
1. 與工作流(`callAiWithFallback`/`dispatchAiWkf.callAi`)**並存**,語意不同(回原始結果、不解析、不加 `NO_SIDE_EFFECT`、未知 id 不拋而回報 `missing`/`hints`);選型表見 README「原始呼叫器 vs 工作流（選型）」.
2. 建構:`resolveCatalogue` 展開一次,回 `{ callAI, providers, skipped(字樣 `${id}（${envVar} 無金鑰）`), missing, hints }`;建構後改動 env 不影響已建之條目;`extraProviders` 不合規時建構 throw.
3. `callAI(prompt, { timeoutMs, budgetMs, validate, acceptTruncated, onEvent })`(`budgetMs` 見 R-CALLER-1-6):第二參數非物件視為 `{}`;零供應商回 `{ ok:false, stdout:'', stderr:'', code:null, durationMs:0, attempts:0, error:'無可用的 AI 供應商（…）', tried:[], providersSkipped, providersMissing }`(不含 `errorType`,依契約逐欄);否則 `dispatchAiFallback` 原始結果另掛 `providersSkipped`/`providersMissing`(每次呼叫之新陣列);`acceptTruncated` 僅布林時透傳;**逐次 `timeoutMs` 為共用預設,條目自帶(含建構期逾時三層寫入者)優先**(`dispatchAiFallback` 之既有分層).零供應商 `error` **已依原契約**(Gitea #42,見 R-AISHELL-5-4):`無可用的 AI 供應商` 後接 `（<skipped 以「、」相接>）`,無 skipped 則無括號,missing 不進 error(原 da40 推定為「缺金鑰略過：…；pick 查無：…」/「條目清單為空」,已廢).
4. 事件:`try` 事件先 `onUsage(providerId)`、再建構期 `onEvent`、再逐次 `onEvent`;三者以 `callHookSync` 互相隔離(拋錯、回傳 Promise 皆忽略).`onUsage` 與 `createUsageCounter({ keyOf: (ev) => ev.providerId }).onEvent` 記帳等價(測試證明);預設 `keyOf` 記到 `keyId`.
5. 已知限制:`warnings`(`*_KEYS` 分號)未納入回傳形狀(契約逐欄),需要者改用 `resolveCatalogue` 讀 `resolved.warnings`.(原「`budgetMs` 為建構參數、`callAI` 不收逐次預算」之限制已於 da52 解除,見 R-CALLER-1-6.)
6. **R-CALLER-1-6 逐次預算只收緊、不放寬(`createAiCaller.mjs`,Gitea #52,主控裁定 2026-11-02 da52;2026-11-11 主控改裁 D11 甲〔排程第 402 項,di402〕改寫值域)**:`callAI(prompt, { budgetMs })`——
   - **兩類宣告(K1)**:建構值為「設定值」——非正整數依 K3 視為未給(不限;`castPintOr`),**不得被當成已無時間**;逐次值為「執行期之剩餘時間」——以 `castBudgetMs` 正規化(`src/castBudgetMs.mjs`,與 `dispatchAiFallback` 之 `budgetMs`、工作流扣 prompt 等待後之值同一份):有限數或數字字串(K7)有效,**≤0 → 0(已無時間:本次不送出、回 `budget exhausted`)**、小數向下取整(0～1 毫秒為 0)、超出安全整數為不限;`+Infinity`／未給／`null`／非數值(`NaN`、非十進位字串、物件、布林)視為未給.
   - 逐次值有效時,本次 `callOpt.budgetMs = min(建構值, 逐次值)`;建構值不限時取逐次值;逐次值未給時沿用建構值;逐次值大於建構值時仍為建構值(封頂,**不視為錯誤**,不 throw).
   - (2026-11-02 原裁定為「逐次值 0、負數、小數視為未給而沿用建構值」;實害為剩 0 秒之呼叫端仍照跑整條鏈〔設計輪 da402 opus#22、#31〕,依原則 1、3 改裁.)
   - 只作用於該次呼叫:`callOpt` 為每次呼叫之副本,建構期 `base` 不被改寫(下一次未給時回到建構值).
   - `dispatchAiFallback` 之 `budgetMs`／`minAttemptMs` 語意不變(逐次預算小於 `minAttemptMs` 時依其既有規則回 `budget exhausted`、`errorType: 'budget'`,「不開工」之門檻由呼叫端先判);零供應商路徑不受影響.
   - 盤點:`Grep "budgetMs" src/createAiCaller.mjs` 應見 base 清單、建構值 `castPintOr(get(base, 'budgetMs'…))`(非正整數即自 base 刪除)、逐次值 `castBudgetMs(get(co, 'budgetMs'…))` 與 `Math.min(budgetMsBase, budgetMs)`.
   - 測試(`test/unit-createAiCaller.test.mjs` 之 `describe('逐次budgetMs（Gitea #52; 帳本R-CALLER-1-6）')`,8 條):以 `minAttemptMs` 設為極大令首次嘗試前即發 `budget-out` 事件,讀其 `remainingMs`(＝本次交 `dispatchAiFallback` 之 `budgetMs` 扣去極小耗時)判別取用哪個值——事件同步、無延時判定;案:逐次<建構→逐次、逐次>建構(及相等)→建構、未給／`null`／`+Infinity`／非數值 10 種→建構、**0／負／0～1 小數／數字字串 '0'、'-3' → 本次 `budget-out`、不送出,1.5 → 1(D11 甲,di402 新增)**、建構未給(或非法)＋逐次給→逐次、皆未給→不限(含建構值 0 而逐次未給 → 不限)、不殘留(同 caller 連呼三次)、零供應商、整合(兩家皆 `slow`、建構 60000／逐次 1000／`minAttemptMs` 500 → `errorType: 'budget'`、`tried` 為 `[['t:ib1','budget-cut','timeout']]`〔R-COOL-1,di402 改寫;修前為 skip-group 後 budget-out〕、只嘗試第一家、替身端點只見第一家之請求、耗時 <8 秒;實約 1 秒)。另見 `test/unit-budgetMsCast.test.mjs`(三入口之兩類宣告).
   - **(推定)** 建構期 `budgetMs` 非法(如 `'abc'`、0、負數)＋逐次有效 → 取逐次值(非法視同未給,與 `dispatchAiFallback` 一致;若取 `Math.min` 於未正規化之建構值會得 `NaN` 而靜默變成不限,故建構值先經 `castPintOr`).

盤點/重跑:`npx mocha --no-parallel test/unit-createAiCaller.test.mjs`(38 條;零供應商字面另見 `test/unit-execShellContract.test.mjs`,含一條約 5 秒之 `maxRetries` 實跑;全程本機替身端點 `test/tools/fakeServerForCallerTest.mjs` 與假 CLI,不連外網).

## R-LOG-1 結果日誌(`src/wkf/logAiOutcome.mjs`)

規則:
1. `OUTCOME_TEXT = { 'next-key':'換金鑰', 'skip-group':'整組跳過' }`(凍結).
2. `logAiOutcome({ result, log, tag })`:`log` 缺/非物件拋 `logAiOutcome 需要 log（記錄器）`;至多四行:①`使用 AI …`(INFO,`providerId` 有值即記、不看 `ok`,**已依原契約**,見 R-AISHELL-5-2)②`AI 遞補歷程 → …`(WARN,濾掉 `ok`)③`AI 供應商未納入 → …`(WARN)④`providerPick 有無效 id → …（請對照供應商目錄）`(ERROR);記錄器兩種介面逐等級擇一,**一律以成員呼叫形式觸發**(`log[name](line)`,不脫離物件);WARN/ERROR 無專屬方法時退用 INFO 之方法.
3. `createAiEventLogger({ log, tag })`:`cooled` 事件寫 WARN `AI 供應商進入冷卻 → …`;`scope:'key'` 者如實寫「降至組內最後」.
4. **已依原契約**(Gitea #42,見 R-AISHELL-5-1、3):`tag` 原樣接在每行之前(非字串視為 `''`);耗時 `(durationMs/1000).toFixed(1)` 後加 `s`;分鐘數 `Math.round(cooldownMs / 60000)`(原 da40 推定之 `[tag] ` 前綴、耗時 `durationMs/1000`、分鐘至多一位小數,已廢).**(推定,契約未載明而由本套件補定,仍待專案方對照)**:①行 `key#` 僅 `keyIndex` 為數字者、`tokens` 僅 `usage` 兩數皆為數字者(OpenAI 系 `prompt_tokens/completion_tokens`、Anthropic 系 `input_tokens/output_tokens`)、`含思考` 僅 `reasoning_tokens > 0`、截斷加註僅 `truncated===true`、`kind`/`model` 皆缺時省略括號;②行單筆缺 `errorType`/原因/耗時時省略對應片段;原因取 `reason`,無則 `error`.
5. 補強(規格 D3/D4):每行 `maskApiKeys`;記錄器拋錯/rejected Promise 吞掉(`callHookSync`).

盤點/重跑:`npx mocha --no-parallel test/unit-logAiOutcome.test.mjs`(34 條).

## R-LOG-2 `oneline` 自行檢查截斷字數 n(`src/wkf/logAiOutcome.mjs`;2026-11-02 r3da,wsemi 第 221 項第二批第 3 輪「下游先行」)

背景:wsemi 第 3 輪後 `strTruncate(str, maxLen, opt)` 之 `maxLen` 為必須參數(`iseint` 之 count),未給或非預期即拋錯(現行 1.9.44 為「原樣回傳不截斷」).下游先自行檢查、轉型其傳入值,不依賴 wsemi 之寬鬆處置(dspec〈輸入參數之檢測機制〉§11 第 18 項).

規則:
1. `oneline(s, n)` 以 `iseint(n, { use: 'count' })`(0～4294967295 之安全整數,數字或可無損轉數字之字串,如 `80`、`'80'`、`'1.5e1'`)判定 n:**有效才 `strTruncate(line, Number(n))`**(交給它的恆為 number);**無效(未給、`null`、負數、小數、`Infinity`、`'abc'`、`''`、`'0x10'`、`>4294967295`、包裝物件、陣列、BigInt、Symbol、取值即拋錯之物件…)一律不截斷,回壓平後之整行**,不 throw.與 w-data-pipeline 1.0.25 之 `oneline` 同語意.
2. **有效輸入之輸出逐字不變**:對照修前公式 `strTruncate(壓平行, n)`(以現行 wsemi 為底),20 種輸入 × 16 個有效 n 共 320 組全等(`unit-onelineStrictN`).修前後之行為差異僅限**無效 n**,現行 wsemi 下 4 案:`'0x10'`(修前截 16)、`new Number(80)`／`new String('80')`(修前截 80)、取值即拋錯之物件(修前拋錯),現況皆回整行;呼叫處 n 皆為字面 `80`／`60`,故對外輸出不變.
3. `oneline` 具名匯出**僅供單元測試取用**,不在 `WDispatchAi` 之匯出鍵內(`WDispatchAi.mjs` 只引 `default`、`createAiEventLogger`、`OUTCOME_TEXT`).
4. **src 內全部 wsemi `strTruncate(` 呼叫站點之 `maxLen` 須為非負整數字面**(字面恆為 `iseint` count 有效值),唯一例外為 `wkf/logAiOutcome.mjs` 之 `Number(n)`(前有 `iseint` 把關).盤點(2026-11-02):46 站點 = 45 字面(`500`×31、`1000`×7、`200`×3、`80`×2、`64`×1、`60`×1)＋1 例外;分佈:`dispatchApiAnthropic` 15、`dispatchApiOpenaiResponses` 10、`dispatchApiOpenaiCompat` 7、`dispatchApiTypesafeSystemone` 5、`probeAnthropicKeys` 4、`runExecCli` 2、`callUserFn` 1、`filterOpencodeFree` 1、`logAiOutcome` 1.新增站點若 `maxLen` 為變數或運算式,盤點測試即失敗,須先檢查再於本節登記.
5. `interp1`／`arrGroupByMaxmin`／`arrLookupByMaxmin`:本套件 `src` 內零站點(`Grep "interp1|arrGroupByMaxmin|arrLookupByMaxmin" src` 0 筆).

前瞻驗證(嚴格版替身):`test/tools/strictStrTruncateForTest.mjs` 依第 3 輪契約實作(`maxLen` 先查、須 `iseint` count,否則拋錯;有效時輸出與現行 `strTruncate` 逐字相同並記錄呼叫之 `maxLen` 型別);`test/tools/strictStrTruncateHooksForTest.mjs` 以 `module.register` 的 resolve hook 依「解析後 URL」把 `wsemi/src/strTruncate.mjs` 換成替身(src 與 wsemi 皆不改);`test/tools/probeOnelineStrictForTest.mjs` 於子行程在替身下跑 src 之 `oneline`／`logAiOutcome`／`createAiEventLogger`.n 輸入表 `test/tools/onelineCasesForTest.mjs`(40 案)測試與探針共用.

測試:`test/unit-onelineStrictN.test.mjs`(9 條)、`test/unit-strTruncateSites.test.mjs`(6 條).
盤點/重跑:`node node_modules/mocha/bin/mocha.js --no-parallel test/unit-onelineStrictN.test.mjs test/unit-strTruncateSites.test.mjs test/unit-logAiOutcome.test.mjs`(49 條);站點盤點 `Grep "strTruncate\(" src`(46 筆).

## 變異驗證表(r3da,R-LOG-2;`tmp/r3da/variants.mjs` 於 `tmp/r3da/v/<id>/` 建 `src`＋`test` 副本逐一套用,跑 `unit-onelineStrictN`＋`unit-strTruncateSites`＋`unit-logAiOutcome` 三檔;repo 內檔案不動;經 `quiet-run --lock`)

共 15 個變異,**15/15 被抓到**(括號為失敗條數):M1 移除 `iseint` 檢查(6)、M2 `strTruncate(line, n)` 不轉數字(4)、M3 `iseint(n)` 預設 safe 範圍(3;現行 wsemi 下輸出不變,直接呼叫之測試抓不到,由嚴格版替身與站點盤點之原始碼檢查抓到)、M4 `use: 'byte'`(5)、M5 以 `Number.isInteger(Number(n))` 取代 `iseint`(6)、M6 無效 n 回空字串(4)、M7 無效 n 當 0 截斷(5)、M8 `parseInt(n)` 取代 `Number(n)`(5)、M9 不壓平空白(7)、M10 `oneline(reason, 80)`→100(2)、M11 冷卻 60→80(2)、M12 他檔站點 `maxLen` 改變數(1)、M13 他檔站點缺 `maxLen`(1)、M14 測試工具:resolve hook 不重導(2)、M15 測試工具:替身不拋錯(2).**修前紅**:HEAD 之 `logAiOutcome.mjs`(僅加 `oneline` 匯出,否則因缺匯出而紅,不是因行為而紅)搭三檔,49 條中 6 failing(`unit-onelineStrictN` 4、`unit-strTruncateSites` 2)、43 passing(既有 34 條＋新增 9 條,含有效輸入逐字不變、替身自證、站點盤點不空等「不得改變」守門);嚴格版替身下修前碼對 40 案中 28 案(全部無效 n)拋錯、現況 0 案.

## R-PARSE-1 嚴格解析與涵蓋率驗證(`src/wkf/parseJsonArray.mjs`、`parseIndexList.mjs`、`makeArrayCoverageValidator.mjs`)

規則:
1. 與寬鬆版**刻意並存**:`parseJsonArray` 取第一個完整片段、非陣列或括號未閉合回 `null`、不搶救;`extractJsonLoose`/`salvageTruncatedArray` 零改動.截斷之兩種策略由呼叫端選.
2. `parseIndexList(text, { min=1, max=Infinity, topN=Infinity })`:取「數字個數最多的那一串」(逗號/全形逗號/頓號,兩側容許空白不含換行),同長度取最先;單一個 `0` → `{ isZero:true, indices:[] }`;其餘依 min/max 過濾、topN 截取(不去重不排序);找不到數字 `{ isZero:false, indices:[] }`;超出安全整數者略過;opt 無效改用預設.
3. `makeArrayCoverageValidator({ indices=[], indexField='index', contentFields=[], maxLengths={}, onReject })` → `(stdout)=>Boolean`:順序為 完整 JSON 陣列(否則 `非 JSON 陣列或輸出截斷`)→ 超長(`第 ${index} 項之 ${f} 為 ${len} 字，超過上限 ${max}`,整體不合格)→ 涵蓋(`未涵蓋編號 …（缺項或內容為空）`);`indices` 給了非陣列(含 `null`)拋 `TypeError('makeArrayCoverageValidator 之 indices 須為陣列')`(**已依原契約**,Gitea #42,見 R-AISHELL-5-5),省略視為 `[]`.**(推定)** 編號須為數字(字串數字不算涵蓋);`未涵蓋編號` 之編號以「、」相接;項號只回報數字編號(否則 `?`,不回顯回覆任意值);`maxLengths` 內非正整數之上限略過、只檢字串欄位;`onReject` 以 `callHookSync` 隔離.

盤點/重跑:`npx mocha --no-parallel test/unit-parseJsonArray.test.mjs test/unit-parseIndexList.test.mjs test/unit-makeArrayCoverageValidator.test.mjs`(6＋12＋18 條).

## 變異驗證表(da52,R-CALLER-1-6;`tmp/da52/mutate.mjs` 直接對 `src/createAiCaller.mjs` 逐一套用、跑新 describe〔`--grep 逐次budgetMs`〕、`finally` 還原並比對 sha256;皆經 `quiet-run --lock`)

共 7 個變異,**7/7 被抓到**(括號為失敗條數):M1 `min` 改 `max`(逐次可放寬;4)、M2 逐次直接覆蓋建構值(1)、M3 逐次值不經 `castPintOr`(1)、M4 建構未給時忽略逐次值(1)、M5 逐次結果寫回 `base`(殘留到下一次;1)、M6 建構值不經 `castPintOr`(建構非法時 `Math.min` 得 `NaN`;1)、M7 逐次值只檢有限數(0、負數、小數照收;1).**修前紅**:未改 src(僅加測試)時新 describe 8 條中 4 條 failing(逐次<建構、建構未給＋逐次給、不殘留、整合)、4 條 passing(皆為「不得改變」守門:逐次>建構、未給／非法、皆未給、零供應商).重跑:自 repo 根 `node tmp/da52/mutate.mjs [M編號]`(腳本存於任務證據夾 `agent-out/da52-evidence/`,不入版控).

## 變異驗證表(da42,R-AISHELL-5;`tmp/da42/mutate.mjs` 於 `tmp/da42/mut/work` 副本逐一套用,每個變異跑兩組:A=契約檔 `unit-execShellContract` 單獨、B=該功能既有單元檔單獨;皆經 `quiet-run --lock`)

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
