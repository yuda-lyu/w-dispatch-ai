# 規則帳本(類型:agy)

> 自 `rulebook.md` 抽出(2026-10-25 依全域 sgud 規則整理:過長即依類型拆檔;節號與標題不變,不刪內容,只搬移).類型說明:agy(Antigravity)型錄與額度結構、非成功結局與逾時階梯(R-QUOTA-1～2、R-AGY-1～3).主檔索引見 `sgud/rule/rulebook.md`.

## agy(Antigravity)型錄與額度結構變動之適應、非成功結局與逾時階梯(2026-10-16 立)

> 狀態:**生效**(2026-10-16,依主控任務 20261016164635 之 run01 複審裁示 Q1–Q7;run02 依此實作,行為變更記於 README「1.0.50 起」第 31–34 條)。
> 來源:`建議w-dispatch-ai調整.md`;審計回應 `C:\opensrcOper\dnow\20261016164635\agent-out\run01-審計回應.md`;主控複審 `…\review\run01-複審.md`;全盤 `./tmp/argon-20261016-全盤.md`(185 格);原型與擬增規格句 `./tmp/argon-20261016/proto/`。
> 裁示摘要:Q1 新增 `agy:gemini-4-argon-high` 置 3.8 之後、不取代不刪除;Q2 不做 slug→群組 helper,`active` 逐群組推導暫不做;Q3 `printTimeout` 推導改 `timeoutMs+30s`;Q4 格式漂移回 `parse`;Q5 未知比例之 severity 為空字串、Infinity 類視為未知;Q6 未給 model 之預設只文件化;Q7 預檢食譜入 README 不入遞補層;Q8 不做。
> **未驗證(明標,不得寫成事實)**:額度用盡時 agy 之輸出與離開碼;Ultra 方案之實際 `/usage` 結構;舊版 agy 之 `--print-timeout` 預設;外層強殺後 agy 之對話殘留。

### 軸

- 額度結構(`getQuotaAntigravity`):群組數與名稱;群組只有週或只有 5 小時窗口;群組與桶有無 `description`(桶之 description 隨用量狀態出現);`remaining_fraction` 之型別與邊界(數值、字串、null、缺鍵、越界、Infinity);`window` 字串;`reset_time`/`disabled`;格式漂移(`groups`/`buckets`/`id` 改名);群組缺席。
- agy 非成功結局(2026-10-16 agy 1.4.0 實測):未知模型(exit 1)、自身 `--print-timeout` 到時(**exit 0**+部分輸出)、權限閘門擋下(**exit 0**+stdout 空);額度用盡(**未驗證**)。
- 條目:id 命名、model 於型錄、防寫欄位、`addDirs`、檔位以 slug 表示、鏈位置。
- 逾時階梯:外層 `timeoutMs`、agy `--print-timeout`、`budgetMs`。

### R-QUOTA-1 agy `/usage` 之群組與窗口由 agy 決定,本函數不設定數、不推斷模型對應

- 規則:每個有 `id` 之桶產出一個窗口(`key`=桶 id 原值、`scope`=群組顯示名);群組可只有單一窗口,**不補造**;群組數/名/窗口種類改動不需改碼;群組與桶之 `description` 不進窗口信封,於 `raw.usage.command.data.groups[]` 取得;`scope` 找不到所需群組須視為「未知」而非「有額度」;本套件**不推斷**模型與群組之對應(`/usage` 無模型清單,`/quota` 為其別名,`agy models` 無 JSON);`groups:[]` 與所有群組 `buckets` 皆空陣列,視為 agy 未回報任何限額(`ok:true`、無窗口;各 `scope` 皆缺席=未知,不得寫成「無限額」之正面斷言);`window` 字串無法解析時 `windowSeconds` 為 null、標籤退回桶 `name`;只有部分群組改名(鍵變了)者不報錯,表現為該 `scope` 缺席(設計限制:維護者無訊號,文件載明需自行比對 `raw.usage`)。
- 設計限制(文件化,不修):桶 `id` 跨群組可重複(以 `scope`+`key` 辨識);未動用窗口之 `reset_time` 為「查詢時刻+窗口」會漂移、已動用者固定;5 小時窗口為滾動;`usedPercent` 讀數閒置時會在兩個值之間跳動且非單調(2026-10-16 同帳號 50 秒內三次:gemini-weekly 0.93→0.07→0.93、Argon 3.91→3.39→3.91,幅度可達約 0.5~0.9 個百分點;`tmp/fix-20261016/probe-reset-drift.out`);`active` 對 agy 恆為 `false`。
- 不修(有理由):`window='1M'` 經 `toLowerCase` 當 1 分鐘(agy 只發 `weekly`/`5h`,無觀察);比例 <0.005% 視為用罄(精度 0.01 個百分點);版本字串兩段(`'2.0'`)→`unsupported`。
- 盤點指令:`Grep "fromBucket|windowToSeconds|groups" src/quota/getQuotaAntigravity.mjs`;站點全集(文件):`Grep "4桶2群組|兩群組|每群組之5小時" src README.md`——預期 0 筆過時敘述。
- 對應測試:T-A1~T-A6 `test/unit-getQuotaAntigravityGroups.test.mjs`(Pro 實測形狀、群組增減、格式漂移、未知比例、越界夾值、window 字串;每條註明規格句 S1–S7)。

### R-QUOTA-2 格式漂移不得靜默成功;未知不得假造

- 規則:**格式漂移**=回應無 `groups` 陣列,或有群組但無任何群組帶 `buckets` 陣列,或有桶(`buckets` 非空)卻一個窗口也讀不出(`groups`/`buckets`/`id` 改名),回 `ok:false`、`errorType:'parse'`(不得回 `ok:true` 與 0 窗口);**以「結構辨識得到與否」判,不以窗口數判**(`buckets` 全為空陣列結構完整、與 `groups:[]` 同為「未回報限額」,`ok:true`)。parse 結果須保留已查得之獨立資料(`withCredits` 之 `credits` 與 `raw.credits`);錯誤訊息為診斷用,測試不釘英文片語。`remaining_fraction` 無法解讀(非有限數,含 `'Infinity'`、`1e400`、`-1e400`;字串只接受十進位形式,`'0x10'`/`'0o7'`/`'0b1'` 視為未知)時 `usedPercent`/`remainingPercent` 為 null 且 `severity` 為 `''`(**`disabled:true` 優先,仍為 `disabled`**);有限但越界者(`1.7`、`1e306`、`-0.2`)夾至 0~1 再換算(免極大值使 `(1-v)*10^4` 溢位);`severity` **以 `toQuotaWindow` 之三家一致推導為準**(用罄 `exhausted`/其餘 `normal`/未知 `''`),`fromBucket` 僅對 `disabled:true` 明給。共享層 `toQuotaWindow` 之 `usedPercent` 非有限(`Infinity`、`'1e400'`、`-Infinity`)亦視為未知(null),三家一致(此前被夾成 100%/0%);判有限一律以原值 `Number(v)`(`cdbl`=`toFinite` 會把 Infinity 換成 `MAX_VALUE`)。
- 盤點指令:`Grep "severity|isFinite" src/quota/getQuotaAntigravity.mjs src/quota/toQuotaWindow.mjs`;三家一致:`Grep "severity" src/quota/*.mjs`(Claude 由供應商給、Codex 與 agy 交 `toQuotaWindow` 推導)。
- 對應測試:T-A3(漂移 6 格,另「全部群組 buckets 為空陣列→ok」、`withCredits`×漂移)、T-A4(未知比例 12 格含非十進位字串、`disabled` 交叉格);`test/unit-toQuotaWindow.test.mjs` 之「usedPercent 非有限」。

### R-AGY-1 內建 agy 條目與型錄對齊;檔位以 slug 表示

- 規則:`kind:'antigravity'` 之內建條目 id 恆為 `agy:`+`model`;`model` 須為 `agy models < /dev/null` 第一欄之 slug 且取 `-high`(檔位以 slug 表示,不另帶 `--effort`;Argon/3.8 之 `/effort` available 僅 low/medium/high);自帶防寫(`skipPermissions:false`)與 `addDirs:['.']`;文件範例 slug 須為型錄第一欄之 slug,**或其去掉檔位之基礎 slug**(agy 接受,預設檔位 medium;2026-10-16 以 `/effort --model gemini-4-argon` 與生成呼叫〔`gemini-4-argon`+`effort:'low'`,12.7s〕皆驗證;以 `/effort --model <slug>` 驗證新增者)(2026-10-16 `gemini-3.6-flash-low`、`gemini-3.1-pro` 已不在,以 `gemini-3.8-flash-low`、基礎 slug `gemini-4-argon` 取代)。**不刪除已被下游引用之 id**(w-knowledge-extract `settingsDefault.mjs` 寫死 `agy:gemini-3.8-flash-high`)。`Gemini 4 Argon` 條目置 3.8 之後、`agy:claude-sonnet-5-5-high` 之前(本機 Pro 方案觀察到獨立額度群組、僅 7 天窗口;**額度池獨立不等於故障域獨立**——CLI、登入、網路仍共用;Ultra 依官方描述計入 Gemini 群組,**未驗證**)。
- 盤點指令:`agy models < /dev/null`(不耗額度;無 agy 之機器跳過)對 `Grep "kind: 'antigravity'" -B3 src/providers.mjs`;`Grep "gemini-[0-9]|claude-.*-5-5" README.md src/dispatchAntigravity.mjs`(範例 slug)。
- 對應測試:T-B1 `test/unit-agyFailShapes.test.mjs`「內建agy條目…」(id 命名、Argon 條目位置/防寫/addDirs);既有 `unit-providers.test.mjs`(防寫、檔位 high、id 唯一)。型錄對照需真 agy,不入 `npm test`。

### R-AGY-2 逾時階梯:外層先逾時,agy 自身計時只作後備

- 規則:`printTimeout` 未給時推導為 `floor(min(timeoutMs, 2147483647)/1000)+30` 秒,恆大於生效之 `timeoutMs`(外層 execCli 先逾時,`error` 以 `TIMEOUT` 開頭,遞補層整組跳過;**有明給 `id` 且 `cooldownMs`>0 才寫冷卻**;整輪仍可能因 `budgetMs` 用盡回 `budget`)。`2147483647` 為 wsemi `execCli` 之計時器上限(外層本就夾至此值),且 agy 拒收超出 Go duration 範圍之值(`invalid duration`,exit 2,實測 `9007199254770s`、`9223372037s` 皆拒)。原因:agy 1.4.0 自身 `--print-timeout` 到時是 **exit 0 交回部分輸出**(stderr `[agy] print timeout after Ns with turn in progress; returning partial output`,stdout 為已產出之部分、可能為空),原設計(`max(30, timeoutMs/1000−30)` 秒,自 agy 啟動後起算)令它先到時:自然耗時超過舊內層截止點之回合**一律被截斷並回 `ok:true`(連超過 `timeoutMs` 者亦然)**,TIMEOUT 分流與冷卻不可達,且成功還會解除既有冷卻。**行為變更之正確表述**:自然耗時介於舊內層截止點與 `timeoutMs` 者,由截斷之部分輸出改為**完整成功**;自然耗時達 `timeoutMs` 者,由「部分輸出 ok:true」改為 `TIMEOUT` 失敗(`stdout` 只留 500 字元;`maxRetries`>0 時 `TIMEOUT` 會被 execCli 重試,每次耗滿 `timeoutMs`,不受 `budgetMs` 約束)。(原載「介於 `timeoutMs`−30s 與 `timeoutMs` 者改為 TIMEOUT」把受影響區間寫反,2026-10-16 外審 opus#1、sol F02 更正。)明給 `printTimeout` 者不變(要部分輸出者明給小於 `timeoutMs` 之值,並自行驗證完整性;`extraArgs` 重帶 `--print-timeout` 之 last-wins 為推論,未實跑)。agy 1.4.0 之 `--print-timeout` 預設為 `0s`(等到完成);舊版預設未驗證。全取鏈中四條 agy 條目相鄰,agy 整體卡頓時會連續逾時 4 次(約 4×`timeoutMs`),宜搭配 `budgetMs` 與 `cooldownMs`。
- `getQuotaAntigravity.agyPrint` 之 `/usage` 不改:其 `--print-timeout` 為 `max(5, ceil(timeoutMs/1000))` 秒,恆 ≥ `timeoutMs` 且 agy 計時自啟動完成後才起算,故外層必先到(不變式,非僅「3~4 秒很快」之經驗值;真 agy 加 `--print-timeout 1s` 仍完整回 3 群組,3543ms)。
- 驗證註記:驗此路徑之假 CLI 必須理會 `--print-timeout` 且 `timeoutMs`>30s;不理會者(如「卡住」假 CLI 配 `timeoutMs` ≤30s)恰落在外層先殺之唯一區間,抓不到缺陷。
- 盤點指令:`Grep "print-timeout|printTimeout|PRINT_TIMEOUT" src README.md`——推導只在 `src/dispatchAntigravity.mjs`(`getQuotaAntigravity.agyPrint` 之 `/usage` 例外)。
- 對應測試:T-C1 `test/unit-dispatchAntigravity.test.mjs`「printTimeout未給時推導為timeoutMs加30秒…」(T∈{600000,120000,40000,5000,預設} 及非整秒、無效、字串、超大封頂;修前 5 格中 **4 格紅**〔570s/90s/30s/270s 皆 false〕,僅 5000 一格修前即綠)、「經遞補層之budgetMs壓縮…」;**行為測試**(慢,約 40 秒,會遵守 `--print-timeout` 之假 CLI)`test/unit-agyFailShapes.test.mjs`「慢回合…」:T=40000、自然 35 秒→完整成功(修前為部分輸出),自然 50 秒→`TIMEOUT`、`skip-group/timeout`、已冷卻;其餘 `--print-timeout` 預期值 `330s`(預設 300000)。

### R-AGY-3 agy 非成功結局之分流與用罄偵測

- 規則:已驗證形狀——未知模型 `exit 1`→`exec`;自身逾時與權限拒絕皆 **exit 0**→`ok:true`(自身逾時:stdout 為部分輸出,可能為空,僅於呼叫端明給 `printTimeout`≤`timeoutMs` 時才自然發生,`nonempty` 擋不住非空之部分輸出;權限拒絕:stdout 空、stderr `jetski: no output produced — …`,須以空輸出判別,故 agy 條目建議 `validate:'nonempty'`);**用罄輸出未驗證**,不新增偵測簽章(README Known design notes:CLI 類限流簽章不進套件),呼叫端自維護 `coolDetect`;預檢(派工前以 `getQuotaAntigravity` 查條目對應之 `scope`)不放進 `dispatchAiFallback`(`/usage` 約 3~4 秒、讀數有抖動、scope 缺席=未知),只在 README 給呼叫端食譜,條目→scope 之對應由呼叫端持有。未給 `model` 時 agy 1.4.0 預設為 **Gemini 4 Argon (Medium)**(2026-10-16 日誌 label 與額度差證實),耗用 Argon 之額度,只文件化(內建條目皆明給 model)。
- 盤點指令:`Grep "stdout為空|靜默" src README.md`(權限拒絕之敘述須含 stderr 說明);`Grep "agy自行決定" src`(model 預設敘述須含 Argon Medium)。
- 對應測試:T-B2 `test/unit-agyFailShapes.test.mjs`「權限閘門擋下寫入…」、「未知模型…」。

### 文件同步點(改上列規則時一併改)

- `README.md`:範例 slug(`model`/`effort` 列、各範例程式)、`timeoutMs`/`printTimeout` 列與 Timeout 階梯圖、額度段(群組與窗口、severity 句、errorType `parse`、預檢食譜)、內建 providers 計數、防寫對照表後之「靜默」敘述、行為變更紀錄「1.0.50 起」。
- JSDoc 與檔頭:`src/quota/getQuotaAntigravity.mjs`(檔頭資料來源、`fromBucket`、`@returns` windows、範例輸出)、`src/quota/toQuotaWindow.mjs`(key 說明)、`src/dispatchAntigravity.mjs`(檔頭雙逾時、`model`/`printTimeout` 參數、範例)、`src/dfTimeoutMs.mjs`、`src/providers.mjs`(EFFORT 註解、Argon 條目、權限拒絕註解)、`src/resolveProviders.mjs`(範例計數)。

### 驗證指令

- 全套:`node C:/opensrcOper/tools/quiet-run.mjs --name fix -- npm test`;**確認摘要行存在**(run02:基準 425 passing,實作後 **437 passing**;其中 `unit-agyFailShapes` 之「慢回合」一條約 40 秒,與全套並行,全套 wall 約 46 秒)。
- 修前紅:`git archive HEAD src | tar -x -C ./tmp/<案名>/pre`,連同新測試(`test/`)跑 `node node_modules/mocha/bin/mocha.js "tmp/<案名>/pre/test/*.test.mjs" --parallel --timeout 180000`(新行為測試應紅;期望值更新之舊測試亦紅)。
- 真 agy(不耗額度或極少):`MSYS_NO_PATHCONV=1 agy -p "/usage" --output-format json`;`agy models < /dev/null`;新條目之讀檔探測(經 `dispatchAntigravity`,條目設定)。
