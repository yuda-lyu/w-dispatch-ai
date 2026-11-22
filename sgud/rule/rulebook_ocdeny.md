# 規則帳本(類型:ocdeny opencode ask 被自動拒絕)

> 2026-11-22 tdai1(排程第 454 項)立.類型說明:`opencode run` 於 `ask` 權限被自動拒絕後整個工作階段結束(離開碼仍為 0)之判讀與專用 `errorType 'denied'`、`continueLoopOnDeny` 注入選項(R-OCDENY-1).主檔索引見 `sgud/rule/rulebook.md`.
> 來源:全域技能 dispatch-opencode〈`ask` 被自動拒絕＝整個工作階段結束,離開碼仍是 0(`continue_loop_on_deny`)〉(2026-11-13 本機實測,opencode 1.19.5,免費模型實呼 21 次;機制取自執行檔內之程式字串,升版後可能變動);使用端回報(Gitea #141);主控裁示(排程第 454 項).

## R-OCDENY-1 `ask` 被自動拒絕而結束 → `errorType 'denied'`;`continueLoopOnDeny` 才併入 `experimental.continue_loop_on_deny`

### 軸

- 工作階段結局:被拒而結束(最後一步 `tool-calls` 且有被拒之 `tool_use`)、被拒後續跑收尾(最後一步 `stop`)、規則明訂 `deny`(訊息 `The user has specified a rule…`,不設 blocked、續跑)、離開碼非 0、預設格式下已有文字輸出才被拒、正常結束.
- 輸出格式:事件流(`--format json`:`opt.detectTruncation` 轉接器自加或呼叫端自給)與預設格式(stdout 為文字、stderr 為簽章行 `permission requested: <類別> (<樣式>); auto-rejecting`).
- 選項:`continueLoopOnDeny`(`true`／未給／`false`／非布林)× `config`(物件、JSON 字串、未給、非 JSON 物件之字串).

### 規則

1. **判讀**(兩來源,皆不執行外部程式、不讀日誌檔):①事件流(`parseOpencodeEvents` 之 `denied`):已知事件之最後一筆為 `step_finish`、其 `reason` 為 `tool-calls`(正規化 `tool_calls`)、該步(最後一個 `step_start` 之後)內有 `tool_use` 之 `part.state.status` 為 `error` 且 `part.state.error` 含 `rejected permission`(不一定是該步最後一筆 `tool_use`);規則 `deny` 之訊息不含此字樣、續跑者最後一步為 `stop`、被拒之後仍有事件者皆不判;**被拒之同一步已有可見文字(非空 `text` 事件)者不判**(複審:模型於同一步已交出答案、被拒者為附帶之工具呼叫〔如 `todowrite`〕時,改標失敗反使完整答案被裁為失敗結果之前段;前一步有文字而最後一步無文字者仍判,因工作未完成);工具名取 `part.tool`(缺者 `'unknown'`);②stderr 簽章行(`opencodeDeny.mjs` 之 `createDenyWatch`,逐行、跨區塊、每次 spawn 重置):**僅在事件流不可讀(`evSeen` 為假,即預設格式)且 stdout 為空時採信**——stdout 非空者可能是續跑(如使用者自己之 opencode 設定已開 `continue_loop_on_deny`),不誤判(**已知限制**:預設格式下已有文字輸出才被拒者無從確認會話是否續跑,不改標;須開 `detectTruncation` 以事件流判讀).事件流可讀者只信事件流.
2. **處置**:僅處理「成功」與「僅驗證失敗(`errorType 'validation'`)」之結果(`hit === null`,即非額度類終止);離開碼非 0、逾時、額度等失敗原因已明,不改標.改標為 `ok: false`、`errorType: 'denied'`、`error` 以 `PERMISSION_DENIED:` 開頭(內含處置提示)、`failureDetail`(被拒之簽章行或「tool X rejected permission」,經 `maskDiag`、上限 `LIMIT_DETAIL_MAX`)、`deniedTool`(事件流所見工具名,無則 `''`)、`deniedRule`(stderr 所見之「類別 (樣式)」,無則 `''`);去掉成功專屬欄位 `finish`／`outputChars`／`truncated`／`finishReason`／`tokens`;加 `errorDetail`;**不讀日誌檔取上游原因**(原因已明、規則決定).
3. **遞補層**:`errorType 'denied'` 為與金鑰無關(`isKeyIndependentFail`:同規則下模型再發同樣之呼叫必被拒,換金鑰必然再被拒)——整組跳過、改派下一條目(`skip-group`),`tried` 帶 `errorType 'denied'`.
4. **`continueLoopOnDeny`**:恰為 `true` 才把 `experimental.continue_loop_on_deny: true` 併入注入之 `config`(`OPENCODE_CONFIG_CONTENT`):`config` 為物件則保留其餘鍵與 `experimental` 下其他鍵(`continue_loop_on_deny` 以 `true` 覆寫);為 JSON 字串則解析為物件後併入(解析失敗或非物件回 `params`,**訊息固定、不回顯內容**——JSON 解析錯誤訊息會夾帶片段,可能含金鑰);未給則單獨注入;非 `true`(未給、`false`、`'true'`、`1`、`null`)視為未給,**不注入**(維持沿用使用者既有設定檔,字串 `config` 照舊原樣).`opencode` 本身只把錯誤交回模型、權限規則不變.
5. **唯讀條目不加**:`OC_READONLY`(`edit: 'deny'`、`bash: 'ask'`)之條目加此鍵會使被鎖擋下之回覆變成「看似成功」(模型續跑並回 `FAILED` 之非空文字,`nonempty` 放行、遞補鏈不換家;技能實測).內建條目(含唯讀條目)一律不帶 `continueLoopOnDeny`(`test/unit-opencodeDeny.test.mjs` S6 以 `providers.mjs` 全文與條目欄位釘住).
6. **README／JSDoc**:選項 `continueLoopOnDeny`、errorType 一覽之 `denied`(`getErrorType.mjs` 檔頭與 README 表)、行為變更第 81 條.
7. **已知限制**(自派複審所提,屬實而本批不改):①呼叫端自給 `--format json` 而未開 `detectTruncation` 時,事件流不經本轉接器解析、stdout 恆非空,**不判 `denied`**(被拒敏感之派工須開 `detectTruncation`);②預設格式下被拒前已有文字輸出者不判(規則 1②);③帶 `validate` 且 `maxRetries > 0` 時,驗證不過(被拒使輸出為空)先依 `maxRetries` 重跑(每次必再被拒),最後才改標 `denied`——改標發生於 `runExecCli` 之後,為既有流程之順序,未改.

### 盤點指令

- `Grep "errorType === 'denied'" src` → `dispatchAiFallback.mjs`(`isKeyIndependentFail`);`Grep "continueLoopOnDeny" src` → `dispatchOpencode.mjs`(`OWN_KEYS`、JSDoc、config 合併)與 `providers.mjs` 0 筆.

### 對應測試

- `test/unit-opencodeDeny.test.mjs`(15 案:`parseOpencodeEvents` 之 `denied` 5 案〔判中、不誤判、同步驟有文字、終止原因／訊息／跨步之不誤判、`lastSessionOnly` 與預設值〕、`dispatchOpencode` 之 `denied` 6 案〔事件流、預設格式含 `validate nonempty` 與 `stopOnLimit:false`、被拒者不讀日誌檔之上游原因、不誤判六種、事件流優先、遞補層整組跳過〕、`continueLoopOnDeny` 4 案〔合併、字串非 JSON 物件之 `params` 不回顯、開啟後續跑不變、內建條目不帶〕);假 CLI(依 `--scn` 與是否帶 `--format json` 輸出),不呼叫真 opencode.
- 修前紅:HEAD 快照上 11 failing／4 passing(後者為 `parseOpencodeEvents` 之「不誤判」「預設值」案與唯讀條目不帶 `continueLoopOnDeny`).

### 變異驗證

見 `sgud/state/state_tdai1.md`〈驗證〉(D 系列 17 項;變異腳本為一次性、不入庫).
