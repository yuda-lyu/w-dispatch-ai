# 規則帳本(類型:spawn)

> 自 `rulebook.md` 抽出(2026-10-25 依全域 sgud 規則整理:過長即依類型拆檔;節號與標題不變,不刪內容,只搬移).類型說明:子進程未能啟動／呼叫無法開始之回報與分流、遞補分流、CLI 單一入口、validate 判定、錯誤訊息遮蔽、不 reject(R-SPAWN-1～3、R-VALIDATE-1、R-REDACT-1、R-NOREJECT-1).主檔索引見 `sgud/rule/rulebook.md`.

## 「子進程未能啟動／呼叫無法開始」之回報與分流(2026-10-14 立)

> 狀態:**生效**(2026-10-14,依主控任務 20261014001436 之 run01 複審裁示 Q1–Q11;run02 依此實作,版本 1.0.48)。
> 來源:`建議w-dispatch-ai調整.md`;審計回應 `C:\opensrcOper\dnow\20261014001436\agent-out\run01-審計回應.md`;主控裁示 `C:\opensrcOper\dnow\20261014001436\review\run01-複審.md`;全盤 `./tmp/spawnfail-20261014-全盤.md`(含獨立複審之採納)。
> 依賴:wsemi ≥1.9.15(execCli 對 spawn 同步錯誤回結果物件,不再 reject);`package.json` 之 `wsemi ^1.9.15` 與本組規則之實作同一提交(主控已更新)。
> 裁示摘要:Q1 結構判定;Q2 params 整組跳過;Q3 移除 antigravity 之 try/catch;Q4 runExecCli 單一入口(validate 拋錯);Q5 額度查詢歸類;Q6 cwd 訊息等 wsemi(1.9.16 一路),本套件不前置檢查;Q8 REST fetch 錯誤維持現行分流與重試,只做遮蔽,預檢列已知限制;Q9 onStdout/onStderr 只文件化;Q10 fetchQuotaJson 之網路錯誤附 cause.code;Q11 F8–F10 併入。

### 軸

- 呼叫點:CLI 四家(`dispatchClaude`、`dispatchCodex`、`dispatchOpencode`、`dispatchAntigravity`,皆經 `runExecCli` → wsemi `execCli`);REST 三家(`dispatchApiOpenaiCompat`、`dispatchApiOpenaiResponses`、`dispatchApiTypesafeSystemone`,皆經 fetch);`dispatchAi`;`dispatchAiFallback`;工作流(`wkf/callAiWithFallback`、`wkf/runRolePipeline`、`wkf/runFanout` 及其上各層);額度查詢(`quota/getQuotaAntigravity` 經 execCli、`quota/getQuotaCodex` 經 wsemi `execCliJsonRpc`、`quota/fetchQuotaJson` 經 fetch)。
- 失敗發生點:轉接器組參數(P1)、execCli 內 spawn 之 try 之前(P2,屬 wsemi)、spawn(同步拋錯／'error' 事件)、啟動後(離開碼／訊號／逾時)、驗證、呼叫端回調(P3)、工作流組 prompt／名額規格(P4)。
- 失敗來源層級:呼叫層／條目層／金鑰層(金鑰層之呼叫無法開始只有「金鑰含非法標頭字元」)。
- 回報欄位:是否 reject、ok、errorType、attempts、code、pid、error 字串(不得含參數、環境變數或金鑰之值)。

### R-SPAWN-1 「未能啟動」之判定只有一處:`isSpawnFail`(結構判定,不列錯誤碼)

- 規則:execCli 之失敗結果 `code === null`,且**帶自有 pid 鍵**而其值為 `undefined`,即子進程未能啟動(node 文件:未能 spawn 時 `subprocess.pid` 為 undefined;wsemi 1.9.15 之同步拋錯與 'error' 事件兩路皆帶 pid 鍵;已啟動者皆帶 pid 數值)。`isSpawnFail(r)` 定義於 `src/getErrorType.mjs` 並匯出;`getErrorType` 以之產出 `'spawn'`;`quota/getQuotaAntigravity` 之版本把關與 `agyPrint` 以之歸 `'notfound'`(已啟動而逾時或非零離開者歸 `'timeout'`／`'exit'`,皆附安裝指引)。禁止在他處另寫錯誤碼字樣比對來判定未能啟動。
- 要求 pid 鍵存在之理由:REST 結果與 `getErrorResult` 物件亦為 code null 且無 pid,不限定即被誤判。不帶 pid 鍵之輸入以 ENOENT／ENAMETOOLONG 字樣判定(相容)。
- 已知限制(2026-10-16 改寫,依 wsemi 1.9.16 實測,同日 wsemi 1.9.17 再解除 npm shim 一項;原載「`.cmd`／`.bat` 經 cmd.exe 退路啟動後才失敗者歸 exec(路徑不存在之部分已交 wsemi);getQuotaCodex 除 ENOENT 外歸 exit;cwd 不存在之訊息誤指執行檔」):
  - 不存在之 `.cmd`／`.bat`(絕對、相對、只給檔名皆然)於 wsemi ≥1.9.16 為 `ENOENT: spawn <路徑> ENOENT`、code null、pid 鍵 undefined → `'spawn'`、attempts 1(**已解除**)。
  - npm shim 形狀之 `.cmd` 存在而其入口檔缺失者:wsemi 1.9.16 走 cmd.exe 退路(離開碼 1、帶 pid → `'exec'`,依 maxRetries 重試);wsemi ≥1.9.17(`execCliCore.mjs` 之 `parseJsEntryFromCmd` 回 `{ entry, exists, isExecLine }`,入口位於 shim 執行行而 `exists` 為 false 時 `buildSpawnArgs` 拋 ENOENT)為 `ENOENT: spawn <入口> ENOENT`(`<入口>` 為 shim 指向之 JS 入口而非 `.cmd` 本身)、code null、pid 鍵 undefined → `'spawn'`、attempts 1、不重試(**已解除**,2026-10-16 實測四家轉接器、`getQuotaCodex`、`getQuotaAntigravity`;原由本套件建議 wsemi 修正之 ⑦-1)。遞補層對此情境由「換組內下一把」(1.9.16:`next-key`／`exec`)變「整組跳過」(`skip-group`／`spawn`,R-SPAWN-2)。僅限入口位於 cmd-shim 執行行者;自訂批次檔於判斷句內引用同樣式而另有退路者,wsemi 仍交 cmd.exe,失敗為一般 `exec`(wsemi `buildSpawnArgs` 註解)。
  - `getQuotaCodex`:app-server 未能啟動(名稱查無、非有效執行檔、不存在之 `.cmd`、入口缺失之 npm shim〔1.9.17〕)於 wsemi 之 `execCliJsonRpc` 歸 `'notfound'`(**已解除**;`getQuotaCodex` 原樣轉出其 errorType,`fallbackHttp` 為 true 時照舊改走 HTTP 備援);cwd 不存在之訊息已為 `ENOENT: cwd is not an existing folder: <cwd>`(**已解除**)。`getQuotaAntigravity`:版本把關與 `agyPrint` 依 `isSpawnFail` 歸 `'notfound'`,npm shim 入口缺失同(1.9.16 為 `'exit'`)。
  - 只給檔名之 `.cmd`／`.bat`,wsemi 依 cmd.exe 語意**先搜子進程 cwd 再搜 PATH**(README `exe` 列;cwd 為不可信工作區時請給絕對路徑)。
- 盤點指令:`Grep "isSpawnFail|includes\('ENOENT'\)|includes\('ENAMETOOLONG'\)" src`——預期:`src/getErrorType.mjs`(定義與字樣後備)、`src/quota/getQuotaAntigravity.mjs`(兩處使用)、`src/dispatchAiFallback.mjs`(ENOENT 字樣,見 R-SPAWN-2);`Grep "import .*wsemi/src/exec" src` 列出所有 spawn 站點(`src/runExecCli.mjs`、`src/quota/getQuotaAntigravity.mjs`、`src/quota/getQuotaCodex.mjs`),新增站點須一併套用;`Grep "shimNoEntryExe" test`——「子進程未能啟動」情境之站點全集,預期:`test/tools/fakeCliForTest.mjs`(定義)、`test/tools/spawnFailCasesForTest.mjs`(情境 `shim-no-entry`)、四家 CLI 轉接器測試(傳入 `spawnFailCases`)、`test/unit-dispatchAiFallback.test.mjs`、`test/unit-getQuotaCodex.test.mjs`、`test/unit-getQuotaAntigravity.test.mjs`(各自列舉未能啟動之執行檔者;新增這類列舉須一併納入)。
- 對應測試:T1 `test/unit-dispatchAntigravity.test.mjs`(命令列過長之 `[false, true, 1, 'spawn']`);T2 四家 CLI 轉接器測試之「子進程未能啟動…errorType為spawn、code為null且attempts為1」(情境單一來源 `test/tools/spawnFailCasesForTest.mjs`,含 `cmd-missing`(不存在之 `.cmd`、maxRetries 2 仍 attempts 1;wsemi 1.9.15 下為紅,依賴守門)與 `shim-no-entry`(npm shim 存在而入口缺失、maxRetries 2 仍 attempts 1;僅 Windows〔POSIX 無 shim 解析,`shimNoEntryExe` 為空字串〕;wsemi 1.9.16 下為紅〔`exec`、attempts 3〕,依賴守門);夾具 `createUnstartableExe`(回 `exe`、`shimNoEntryExe`、`clean`)與共用之 `buildShimCmdText` 於 `test/tools/fakeCliForTest.mjs`);T3 `test/unit-getErrorType.test.mjs`(結構判定 9 例、isSpawnFail 8 例);T5 `test/unit-getQuotaAntigravity.test.mjs`(notfound 與版本把關逾時／非零離開;「子進程未能啟動…」含 shim 入口缺失之版本把關與略過把關,1.9.16 下為 `exit`、紅);T11 `test/unit-getQuotaCodex.test.mjs` 之「app-server子進程未能啟動…notfound」(含 shim 入口缺失;依賴守門);T4b `test/unit-dispatchAiFallback.test.mjs` 之「子進程未能啟動…整組跳過」之 `shim-no-entry` 變體(3 把金鑰仍 `skip-group`／`spawn`、`group-exhausted` 之 `attempted` 1;1.9.16 下為 3 次 `next-key`／`exec`、紅)。

### R-SPAWN-2 遞補之「與金鑰無關」依 errorType 與來源層級

- 規則:`isKeyIndependentFail` 對 `errorType === 'spawn'`、`errorType === 'params'` 回 true;既有之 ENOENT 字樣判準保留(亦涵蓋 REST 之 `FETCH_ERROR: ENOENT`,屬條目層);逾時、CLI 參數錯誤(code 2)、驗證失敗、截斷、工具不支援、本體非 JSON 維持原判準;`fetch` 維持換下一把(Q8)。
- 不變式:`errorType 'params'` 只可用於與金鑰無關之檢核(呼叫層或條目層);逐把金鑰之檢核須另給 errorType,否則一把壞金鑰會令整組跳過。前提:所有失敗結果必帶 errorType(CLI 經 `runExecCli`→`attachErrorType`、REST 各失敗分支明給、`getErrorResult` 預設 `'params'`)。
- 已知限制(Q8):REST 之條目層 fetch 錯誤(無效網址、連線拒絕、DNS、TLS、協定不支援)仍逐把換金鑰,且送出前之確定性錯誤與 TLS 驗證失敗於 maxRetries>0 時仍會重試;改善方案為 fetch 前以 `new Request()` 預檢(無效網址與 body 不可序列化回 params,金鑰層標頭錯誤回固定文字並換把),另議。
- 盤點指令:`Grep "getErrorResult\(" src`(所有 params 來源,逐一確認與金鑰無關);`Grep "errorType: '" src`。
- 對應測試:T4 `test/unit-dispatchAiFallback.test.mjs` 之「子進程未能啟動…整組跳過」「參數或設定檢核失敗…整組跳過」「金鑰相依之連線前失敗…仍換組內下一把, 且錯誤訊息不夾帶金鑰」「子進程未能啟動時dispatchAiFallback不reject…」「opencode條目之config不可序列化時整組跳過」;既有 ENOENT、kind 無效、code 2 之案例維持。

### R-SPAWN-3 CLI 轉接器之 execCli 呼叫只有一個入口 `runExecCli`,不自包 try/catch

- 規則:四家 CLI 轉接器一律 `return runExecCli(exe, args, {...})`(`src/runExecCli.mjs`:env 經 `readCallerObj` 物化、validate 由本層判定(R-USERFN-2)、失敗結果補 errorType);不另包 try/catch(依 wsemi ≥1.9.15 之不 throw 契約;自建 catch 之訊息會帶回 node 之「. Received 值」)。
- 2026-10-16 改寫(原載「病態 env(拋錯之 getter)使 execCli reject 屬 wsemi(已交 wsemi)」):env 不可讀(拋錯之 getter、已撤銷之 Proxy)於 `runExecCli` 啟動前以 `params` 回報(`env is not readable: <訊息>`,attempts 0),四家同;opencode 自組 env 前同經 `readCallerObj`。wsemi 1.9.16 對 getter 拋錯已回結果物件,但對已撤銷 Proxy 之 env 仍 reject(`execCli.mjs:485-486` 之 `isobj(env)` 在 try 外,已提 `建議wsemi修正.md`),本層之物化使兩者皆不到達 wsemi。wsemi ≥1.9.17 對兩者皆回結果物件(`UNKNOWN: <訊息>`、code null、pid 鍵 undefined、attempts 1;已撤銷 Proxy 不再 reject),**本層前置判讀仍須保留**:移除後兩者被 `isSpawnFail` 歸 `'spawn'`(attempts 1)而非 `params`(attempts 0),把呼叫端之壞輸入誤報為子進程啟動失敗(2026-10-16 實測 wsemi 1.9.17 直呼 `execCli` 與經 `runExecCli` 之對照;於 `./tmp` 副本移除前置判讀,claude／codex／antigravity 各 1 案「env不可讀(getter拋錯)…」與 `unit-userFnValidate` 之「CLI四家之env: …已撤銷之Proxy以params回報」1 案,共 4 案轉紅,opencode 因自組 env 時另經 `readCallerObj` 不受影響;即現有測試已釘住,無需新增)。
- 盤點指令:`Grep "execCli\(|attachErrorType\(|try \{" src/dispatchClaude.mjs src/dispatchCodex.mjs src/dispatchOpencode.mjs src/dispatchAntigravity.mjs`——預期只剩 `dispatchOpencode.mjs` 包住 `JSON.stringify(config)` 之 try 一筆(R-NOREJECT-1);execCli 呼叫只在 `src/runExecCli.mjs`。
- 對應測試:T1、T2(四家 CLI 轉接器不 reject 且結構一致);四家測試之「env不可讀(getter拋錯)時不reject, 以params回報…」(T12,情境 `envUnreadableOpt` 於 `test/tools/spawnFailCasesForTest.mjs`)。

### R-VALIDATE-1 自訂 validate 拋錯視同驗證失敗並註記訊息(CLI 與 REST 同規則)

- 規則(2026-10-16 改寫,細則併入 R-USERFN-2):CLI 類由 `runExecCli` 自行判定 validate(不交 wsemi 之 execCli),REST 類經 `safeValidateAsync`(`src/checkTruncation.mjs`);兩類同判定、同註記:同步拋錯與 reject → stderr 前綴 `validate threw: <訊息>`,逾時 → `validate timed out: did not settle within <N>s`,error 恰為 `OUTPUT_VALIDATION_FAILED`、errorType `validation`;註記只屬該次結果(重試不殘留前次訊息)。原載:「CLI 類經 runExecCli 把自訂函式包成拋錯回 false(`!!fn(stdout)`)…REST 類經 safeValidate」——同步包裝使回傳 Promise 之 validate 恆通過、reject 使行程崩潰,已由 R-USERFN-2 取代。緣由:execCli 於 close 事件內呼叫 validate,拋錯成為未捕捉例外(wsemi 1.9.15 實測);README 1.0.37 變更紀錄第 3 條已承諾此行為。
- onStdout／onStderr(Q9):拋錯仍會使行程崩潰(wsemi 文件載明不攔截),本套件只於 README 文件化,不包裝;回調為 async 者其 rejection 同樣不被攔截(2026-10-16 補)。
- 對應測試:T6 四家 CLI 轉接器測試之「自訂validate拋錯時視同驗證失敗…且stderr前綴validate threw訊息」;R-USERFN-2 之 T-U3～T-U9。

### R-REDACT-1 錯誤訊息不得夾帶機密值;遮蔽規則單一來源 `redactText`

- 規則:`src/redactText.mjs`(`redactText`、`secretHeaderValues`)為唯一遮蔽實作;REST 三家之 fetch 例外訊息(無 cause.code 時)以請求標頭中 Content-Type、Accept-Encoding 以外之值遮蔽;`quota/fetchQuotaJson` 之 redact 亦用之,其網路錯誤訊息附 cause.code(Q10,整句先經 redact)。
- 盤點指令:`Grep "redactText|REDACT_MASK" src`——預期定義只在 `src/redactText.mjs`;`Grep "FETCH_ERROR|network error" src` 之每處皆經遮蔽。
- 對應測試:T7 REST 三家測試之「金鑰含換行等非法標頭字元(送出前失敗)時錯誤訊息遮蔽金鑰」;T4 之守門案例(tried 不含金鑰);T10 `test/unit-fetchQuotaJson.test.mjs` 之「連線拒絕之network錯誤附cause.code」。

### R-NOREJECT-1 參數組裝與工作流之呼叫端程式拋錯不得 reject

- 規則:轉接器組參數時可能拋錯之操作(如 opencode 之 `JSON.stringify(config)`、REST 三家之 body 序列化)須承接並回 `getErrorResult(…)`(params);工作流之 prompt 函式拋錯以該階段／整合失敗回報並保留已完成成果;runFanout 之名額規格非物件時該名額回 params 失敗、其餘照跑。
- 2026-10-16 補(R-USERFN-1 之落實):錯誤訊息一律經 `errMsg`(`src/callUserFn.mjs`;getErrorMessage → String → `'unknown error'`,截斷 500)——原載各處 `get(err,'message',String(err))` 遇已撤銷 Proxy 等惡意拋出值會在 catch 內再拋而 reject;組錯誤訊息時序列化呼叫端資料(如 callAi 之 spec)一律經不拋錯之 `safeJson`;prompt 函式之回傳值以 `typeof` 判型(不觸發使用者程式碼)。REST 之 body 於送出前預檢可序列化,失敗為 params(原載:歸 `fetch` 逐把空耗)。
- 盤點指令:`Grep "JSON.stringify\(" src`(逐一確認在 try 內或輸入不可能拋錯;預期 REST 三家各一筆預檢 try、opencode config 一筆、callAiWithFallback 之 `safeJson`、runFanout 預設模板經 `awaitUserFn`);`Grep "get\(err, 'message'|err\.name" src`(預期只剩 `src/quota/fetchQuotaJson.mjs` 2 筆:其 err 來自 fetch 內部、標頭由本套件自憑證組成,無呼叫端拋出值;轉接器之 catch 一律 `errField`／`errMsg`,2026-10-16 外審 opus F1 更正原載「預期 0 筆」);REST 三家之 body 於外層序列化一次為 `bodyText` 交 `callOnce`(重試共用,`toJSON`／getter 只執行一次),標頭值於送出前 `String()` 物化一次(轉換拋錯回 params);`Grep "Fn\(" src/wkf`(呼叫端函式之呼叫點皆經 callUserFn,見 R-USERFN-1)。
- 對應測試:T8 `test/unit-dispatchOpencode.test.mjs` 之「config不可序列化…不reject」;T9 `test/unit-runRolePipeline.test.mjs` 之「階段prompt函式拋錯…不reject」、`test/unit-runFanout.test.mjs` 之「名額規格非物件…整合prompt函式拋錯…皆不reject」;`test/unit-userFnWorkflow.test.mjs` 之「runFanout預設整合模板遇不可序列化之候選…」「呼叫端物件不可讀…皆以params回報」。

### 文件同步點(改上列規則時一併改)

- `README.md`:errorType 表之 `spawn` 列、遞補分流表、`maxRetries` 列、`onStdout`／`onStderr` 之說明、`exec` 列(原載 `.cmd` 已知限制,2026-10-16 隨 wsemi 1.9.17 刪除;`spawn` 列與 `exe` 列、遞補分流表之 `spawn` 列、行為變更紀錄第 29／35 條記 npm shim 入口缺失歸 `spawn`)、行為變更紀錄(1.0.48 起;第 17 條末之「已知例外」記病態 env 致四家 reject——2026-10-16 已由 1.0.49 起之條目改寫:env 不可讀一律 params)。
- `src/getErrorType.mjs` 檔頭與 JSDoc;`src/getErrorResult.mjs` 之 errorType 參數說明(params 不變式);`src/dispatchAiFallback.mjs` 檔頭【失敗分流】與 JSDoc 特點;`src/dispatchAntigravity.mjs` 檔頭【命令列長度上限】;`src/runExecCli.mjs`、`src/redactText.mjs` 檔頭;四家 CLI 轉接器 `@returns`(補 errorType)。

### 驗證指令

- 全套:`npm test`(mocha --parallel;run02 基準 352 個測試,實作後 376 passing)。**判讀一律確認摘要行(`N passing`)存在**(2026-10-16 立,主控裁示 Q15):`--parallel` 多檔時若有未處理 rejection 交 mocha,會因 `ERR_MOCHA_MULTIPLE_DONE` 不印摘要且離開碼 0(假綠);經 `node C:/opensrcOper/tools/quiet-run.mjs --name test -- npm test` 執行時缺摘要會警告。
- 依賴下限:`node --import ./tmp/spawnfail-20261014/hook-old.mjs node_modules/mocha/bin/mocha.js test/unit-dispatchAntigravity.test.mjs`(wsemi 1.9.12 下 T1/T2 應為紅)。
- 修前紅:以 `git show HEAD:<path>` 取 src 副本置 `./tmp/spawnfail-20261014/run02-pre/src/`,配新測試跑 `npx mocha --parallel "tmp/spawnfail-20261014/run02-pre/test/*.test.mjs" --timeout 180000`。
- 使用者視角:`node ./tmp/spawnfail-20261014/probe.mjs final` 後 `node ./tmp/spawnfail-20261014/compare-final.mjs`(與 `out-proto.json` 逐列比對,97 情境;run02:97/97 一致);`node ./tmp/spawnfail-20261014/summarize3.mjs`。注意 `./tmp/` 會被清除,上列腳本僅供本案期間重跑。
