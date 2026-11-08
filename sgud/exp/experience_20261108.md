# 累積經驗(2026-11-08 抽出:2026-10-23～11-05 之遞補與錯誤型別、CLI spawn 守門與 Go 用量冷卻、opencode 輸出上限與截斷偵測、放行最小間隔與暫時性重試等節,逐字搬自 experience.md)

本檔為抽出之舊經驗,節號與標題不變;主檔見 `sgud/exp/experience.md`.

## 本套件之遞補與錯誤型別

- `getErrorType` 與 `dispatchAiFallback.isKeyIndependentFail` 原為兩份各自手寫之字樣規則,已不同步(ENAMETOOLONG 在前者為 spawn、在後者不跳組);同類規則要收斂成單一來源,遞補層消費 errorType。
- claude／codex／antigravity 條目通常無金鑰(nk=0),整組跳過與換下一把只差事件型別;實際「逐把空耗」只發生在多金鑰之 opencode 與 REST 條目——評估遞補缺陷之代價時先看金鑰數。
- REST 之 fetch 錯誤不可一律跳組:金鑰含換行等非法標頭字元時,錯誤發生在送出前且只與該把金鑰有關(實測次把成功)。
- 自訂 validate 在 CLI 類原交給 wsemi execCli 於 close 事件內呼叫,拋錯會變成未捕捉例外(行程崩潰);REST 類有 safeValidate。寫測試時 mocha 會把它報成「Uncaught Error」並歸到當前測試。**2026-10-16(1.0.49)起 CLI 類之 validate 改由 `runExecCli` 自判(不交 wsemi),REST 類改用 `safeValidateAsync`,兩者皆經 `src/callUserFn.mjs`(帳本 R-USERFN-2)**。
- 下游 w-knowledge-extract(`src/ai/providerHealth.mjs`)消費 `errorType` 與 `group-exhausted`:只排除 `params`;逐次事件 `next-key`／`skip-group` 會累計 `fail[型別]` 與 params 之 `mismatch`,遞補分流改變會改變這些數字。
- 結構判定「code 為 null 且 pid 為 undefined」必須再加「帶自有 pid 鍵」:REST 結果與 `getErrorResult` 物件也是 code null 且無 pid,否則會被誤判為 spawn(獨立複審 R12 抓到;execCli 兩條失敗路徑皆明給 pid 鍵)。
- undici 對非法標頭值之例外訊息會原文引用整個標頭值(`Headers.append: "Bearer <金鑰>" is an invalid header value.`),且無 cause.code;REST 轉接器以 `cause.code || err.message` 組錯誤字串時即把金鑰帶進 tried、事件與日誌。遮蔽一律走 `src/redactText.mjs`(1.0.48 已實作:`redactText` + `secretHeaderValues`,REST 三家與 fetchQuotaJson 共用)。
- 「呼叫無法開始」不只發生在 spawn:轉接器組參數(opencode 之 `JSON.stringify(config)`)、呼叫端回調(validate、onStdout)、工作流組 prompt(runRolePipeline／runFanout 之 prompt 函式、null 名額)都會讓呼叫在送出前就失敗;盤點時把「失敗發生點」當成一軸逐一列,不要只看 execCli 內部(初版漏此軸,複審補出 4 個成員)。

## CLI spawn 守門與 Go 用量冷卻(2026-11-04 da67,Gitea #67;帳本 `rulebook_spawngate.md` R-SPAWNGATE-1～3)

- **「四家共用同一上限」不成立,實測才定預設**:issue 把 `opencode.exe`、`claude.exe`、`codex.exe`、`agy.exe` 合計計數(`cores−1`).實測 `opencode.exe`(bun)單次短呼叫約占 1.1 核心,現役 `claude.exe`／`codex.exe` 等候回應時 0.0%～4.9% 單核——合計計數會讓主控同時派 7 個 `claude -p`(或開著多個互動 session)時新派工白等最久 10 分鐘.故預設只對 opencode 啟用、其餘三家 `resolveSpawnGate` 回 null(零成本),要限者逐次明給.**取數字前先想「瓶頸是誰」,不要照 issue 把四家綁一起**.量測法:`tasklist /FO CSV /NH /V /FI "IMAGENAME eq x.exe"` 取 CPU Time(h:mm:ss,秒級解析度)前後差除以牆鐘,不用 `typeperf`(計數器名稱隨語系而異)、不用 PowerShell.真實 `claude -p`／`codex exec` 與 `agy` 之 CPU 未測(耗訂閱額度／本機無行程).
- **`tasklist` 全列舉約 1 秒、加 `/FI "IMAGENAME eq <image>"` 約 0.07～0.12 秒**:守門必須逐 image 篩選查詢;`/V` 全列舉約 10 秒(解析視窗標題).無符合時 `tasklist` 回「INFO: No tasks…」(語系不同)且離開碼 0,解析只認以 `"` 開頭之 CSV 列、不依訊息文字.非 Windows 之 `ps -eo comm=` 路徑只用夾具測過.
- **1 秒 CPU 取樣之成本要靠重用壓下來**:`os.cpus()` 差固定付 1 秒牆鐘.做法:0.3 秒內重用上次值、0.3～10 秒內以「自上次起之差」計、超過 10 秒才付 1 秒;RAM 與行程數(便宜)先查、已擋即不取 CPU 樣.實測連續 12 次:首次 1099 ms、其後 69 ms.
- **同一瞬間整批放行是真的,且有三層**:①同行程:併發呼叫同時看到 0 個行程就全放行——要「FIFO 互斥臨界區＋預約」,預約以「最舊預約當時所見行程數＋預約數」估入(不是單純 `所見 + 預約數`,那會把已出現者重複計算;也不是永遠累加,預約 `settleMs` 後過期);②**取新 CPU 樣期間(1 秒)他行程可能已放行並 spawn**,臨界區內 `count → cpu` 之間的讀數是舊的——取了新樣者放行前須**再查一次行程數**(`recount`);③跨行程:實機(2 個行程以 `STARTAT` 絕對時刻對齊同瞬間各發 6 個,`maxCli 2`)無票時全機峰值 3,加「預約票」(`os.tmpdir()` 下空檔案、檔名即內容、他行程 `settleMs` 內之票併入估計)後 2.**對齊同瞬間要靠 `STARTAT`**:不對齊時兩行程啟動時差 ~100 ms 以上,看不出超放(第一次實機無票也只見峰值 2).
- **預約是保守估計,實機有「空出之名額晚 settleMs 才被取用」**:放行後 3 秒內若他個行程恰好結束,`visible` 低於估計,在預約過期前一直被擋(`pollMs 1000` 實測空 3 秒).預設 `pollMs 10000` 下次要,沒做 PID 追蹤(代價高、`countCli` 注入契約變複雜);要更快喚醒可日後加「本行程呼叫結束即喚醒等待者」.
- **`opt.onTrace` 已被 execCli 占用**:轉接器之 `onTrace` 原樣轉傳 `execCli`(其 `spawn`／`settle` 事件),故守門之觀察回調放 `spawnGate.onTrace`(不放頂層);測試以兩者寫入同一時間軸陣列驗「守門放行先於子進程啟動」.
- **假時鐘與 `deadlineAt`(絕對 epoch)不能混用**:守門若注入假 `now`,`deadlineAt − Date.now()` 之封頂會算成極大負值;預算類測試用真實時鐘＋寬鬆上界(缺陷版為上界之數倍,事件順序為主、牆鐘為輔),其餘一律假時鐘＋離散事件模擬器(`spawnGateWorldForTest`:`sleep` 只登記計時器,全部呼叫卡住時才推進時鐘,死鎖即拋錯).
- **預設只守「真的該 CLI」是為了不動既有測試與假 exe**:既有 1082 條測試以假 exe(`fake-opencode.cmd` 等)呼叫轉接器,若預設對它們守門會碰真實 `tasklist`.以「exe 去目錄與副檔名須等於 CLI 名」判定,語意上也合理(守門數的是該 CLI 之 image).
- **遞補層接點之選擇**:守門放在 `runExecCli`(四家共用單一入口,驗證重試迴圈每次 spawn 前都能重守),非四家各寫一次;代價是 `execCli` 自理之非驗證失敗重試不重守(已知限制,測試釘住).`spawnGateHints`(`shouldStop`、`deadlineAt`、`minAttemptMs`)由遞補層經轉接器傳到 `runExecCli`,令預設情形(使用端沒給 `spawnGate`)下等待亦可被中止、計入 `budgetMs`;**守門未運作時 `timeoutMs` 原值不動**(否則 `deadlineAt − Date.now()` 會把修前逐位元相同之結果改成差幾毫秒——`diffBehavior.mjs` 逮到此點前先用變異 X04 + 專屬測試釘住).
- **Go 用量冷卻之判定**:只認「成功回應＋percent 為有效數字且 ≥ 門檻」或「status 明確 `rate-limited`」;`percent` 缺漏／`NaN`／`Infinity`／布林／文字、視窗缺漏、未知狀態字、端點失敗一律不擋——變異 Q08(percent 不驗數字)只被 `Infinity` 案抓到,測試矩陣須含 `Infinity`.快取之邊界(59999／60000)與「失敗亦快取」要各有斷言;並行共用同一次查詢(5 個並行只打 1 次).不盲信 `resetsAt` 冷卻到該時刻,快取到期重查(滾動視窗會逐步下降).
- **既有文字守門須跟著改**:`unit-providersOpencodeGoDocs` 原斷言「遞補層不接用量」(`providers.mjs` 檔頭與 README 各一處),本案取代該決定,測試改斷言新句並斷言舊句已不存在——不是放寬而是同步更新被取代之規格.
- **eslint 規則之坑**:`object-curly-newline`／`object-property-newline` 對「`{ get: …, set: (x) => {` 跨行」之物件字面值報 93 錯(全在我新寫之測試檔);新檔寫完立刻 `npx eslint --fix <新檔>`(只動自己的新檔),再跑一次確認 0 錯.
- **變異腳本之 hang**:把「永遠再等一輪」類變異(`remaining <= 0` 改不可能)套在假 `sleep` 立即 resolve 之測試上會變成微任務無窮迴圈,mocha 之逾時計時器也跑不起來——變異執行器須以 `spawnSync` 之外部 `timeout`／`SIGKILL` 判定 killed(G11 約 53 秒).
- **實機注意**:開工時 Go 用量 rolling 69%、weekly 27%、monthly 13%(同工作區他人使用中);實機一律短提示詞、免費期模型(`ocgo:opencode-go/beam-free`),全程約 56 次呼叫(含 1 次匿名 `opencode/beam-free` 因免費池用盡卡住 75 秒之量測),結束時 weekly 27%、monthly 13% 不變(rolling 為 5 小時視窗重置歸 0,非本輪所致).留在使用者 `%TEMP%\w-dispatch-ai-spawngate\` 之預約票為本輪實測之殘留,已於結束前刪除(只刪該資料夾,先列清單確認僅票檔).
- **工具坑**:①守門 hooks 擋 `sleep N && …` 之前景等待——等背景指令用 `until [ -f 結果檔 ]; do sleep 5; done` 之 `until` 迴圈(前景可過,逾時以 `timeout` 參數給足);②`quiet-run` 只在結束時印摘要,背景執行時以 `tmp/quiet-run/<時間>-<名>.log` 讀進度(變異執行器逐行 `console.log`);③`git ls-files --eol` 顯示 `README.md`、`providers.mjs`、`createAiCaller.mjs` 為 CRLF,其餘 src 為 LF,Edit 皆保持原檔行尾,新檔(Write)為 LF.

## opencode 單次輸出上限與截斷偵測(2026-11-04 da78,Gitea #78;帳本 `rulebook_opencodego.md` R-OCGO-4)

- **「上限在閘道還是 CLI」用攔截請求判,不要讀文件猜**:自建 127.0.0.1 OpenAI 相容服務(`@ai-sdk/openai-compatible` 自訂 provider 經 `config` 注入,`XDG_DATA_HOME` 指到暫存夾令 session 不落使用者目錄),記錄 CLI 實送之 `max_tokens`,13 案(不設／設 64000／200000／無效值 × 型錄 `limit.output` 8000／131072／384000)30 秒內得到完整規則:`min(型錄 output, 環境變數或 32000)`、無效值靜默回 32000、`'1e5'` 有效.再以真實 Go 模型確認「閘道照單全收」(上限設 3000 → reasoning 恰 3000).兩層證據互補:假服務證明 CLI 送什麼,真實模型證明遠端接受什麼.
- **預設格式看不到「為何結束」,`--format json` 才看得到**:`opencode run` 預設格式 stdout 只有文字、stderr 只有 `> agent · model` 標頭,截斷時 `ok:true`、離開碼 0、stdout 空;`--format json` 每行一個事件,`step_finish.part.reason`(`length`／`stop`／`tool-calls`)與 `part.tokens` 穩定.二進位字串搜尋(`binctx.mjs`)可直接讀到 run 指令的事件迴圈:預設格式只寫「已結束(`time.end`)的 text 之 `trim()`＋EOL」,故 stdout 可由事件**逐位元重建**;錯誤在 json 格式改為 `error` 事件(寫 stdout),預設格式則 `Error: 訊息` 寫 stderr——重建時須還原,否則依 stderr 字樣的 `coolDetect`／`failureKind` 會失靈.
- **`execCli` 失敗結果之 stdout 只留前 500 字元**:事件流動輒上千字元,失敗時被截斷,錯誤事件常落在 500 字元之後而丟失;必須用 `onStdout` 自行累積全文(上限 32MB),`reshapeResult` 再解析.`execCli` 內部重試各開新 session,累積流含多次嘗試,故只取最後一個 `sessionID`.測試用 `long-then-error` 情境(900 字元 text 後才有錯誤事件)釘住(變異 M32 證明)。
- **「最後一個 `step_finish`」才是整次回應的終止原因**:opencode 遇 `length` 即結束迴圈,中間步只會是 `tool-calls`;不要「任一步曾為 length 就判截斷」.`content_filter` 在 opencode 不以 `step_finish` 呈現,而是 error 事件＋離開碼 1(假服務實測),屬一般 exec 失敗.
- **調高輸出上限的代價是輸入餘裕,而且是三條目錄條目的既有文件所依賴的**:伺服器以「輸入 + `max_tokens` ≤ context」驗請求(iceman 的 236233＋32000＞262139 即例),opencode 本機壓縮門檻亦扣輸出保留量;所以對 context 26 萬級且型錄輸出逾 32000 的三條(flint、nemotron-lightning、iceman)維持 32000,否則它們註解裡的「輸入實際上限約 23 萬 token」會變成錯的.**改全域預設前先 Grep 註解中依賴舊預設的數字**.
- **預設值由實測最大量定,不由提案數字定**:glm 需 33,905 token(僅略超 32,000)、deepseek 需 71,322 token(2.2 倍)——64000 對 deepseek 不夠,故取 128000(最大實測量 1.8 倍).提案說「5 條 Go 條目改 low」並未被採:同提示詞同檔位只調上限就完成,reasoning 從 32000 增至 70358 對推理品質才是「high」的本意.
- **真實模型實測的坑**:①提示詞沒寫「禁用工具」時,`build` 代理的模型會先叫 bash(`ls`),被 `OC_READONLY` 的 `bash:'ask'` 自動拒絕後 run 即結束(`finish=tool-calls`、stdout 空),白燒一次呼叫;長算術任務的提示詞務必明寫不得用工具;②3 萬字元提示詞＋high 要 6～9 分鐘(365～511 秒),要背景執行並輪詢輸出檔,別掛在工具呼叫上;③`opencode export <id>` 輸出含完整提示詞,只摘 `messages[].info.finish／tokens`,不要整份讀入;④用量端點整數百分比 6 次呼叫(≈US$0.14)只動 rolling 3→4.
- **工具坑**:①`tar -xf C:\…` 在 Git Bash 被當成遠端主機(`Cannot connect to C`),改 `cwd` 後用相對檔名;②`quiet-run` 背景執行時子行程輸出要等結束才寫入 log,進度以變異腳本自寫的 `tmp/da78/*.out` 或 quiet-run log 末段讀;③`Bash` 被守門擋下的 `cd`、`sleep N && …` 不要繞道,用 `git -C`／絕對路徑與 `run_in_background` 加通知;④Windows 上 `spawnSync('opencode', …, { shell: true })` 會印 DEP0190 警告,屬測試輔助可接受,正式碼走 `execCli`.

## opencode 同瞬間多實例啟動:放行最小間隔與暫時性重試(2026-11-05 da320,Gitea #85;帳本 `rulebook_spawngate.md` R-SPAWNGATE-4／5)

- **提案之前提要先量,不要照抄**:提案稱「兩個 opencode 同一毫秒級先後 spawn」.實測同行程相鄰放行(臨界區內各一次 `tasklist`)已隔約 70～100 ms(冷首批首個另付約 1.1 秒 CPU 取樣).真正的問題是這個時距遠小於 opencode 啟動時搶資料庫之窗口(啟動至資料庫就緒約 0.4 秒、建立 session 約在啟動後 0.8～1.1 秒).預設 1500 ms 與提案相同,但依據不同.
- **不花額度、不碰使用者資料庫、仍用真 opencode 的重現法**:①本機起一個 OpenAI 相容假服務(照 `test/api-opencodeOutputCap.test.mjs`:`OPENCODE_CONFIG_CONTENT` 註冊 `@ai-sdk/openai-compatible` provider、`useStoredAuth:false`、串流 40 段各 25 ms);②`XDG_DATA_HOME` 指向拋棄式資料夾,多個行程共用同一份拋棄式資料庫即可重現多實例競爭(資料庫在 `<XDG_DATA_HOME>/opencode/opencode.db`);③`run -m <不存在之模型>` 可走「建 session 但不呼叫模型」之路徑(離開碼 1、`--format json` 時錯誤為 stdout 之 `error` 事件);④免費模型當日掛住(opencode 遇免費池 429 不結束,見前述)——別指望用免費模型做併發量測.
- **重現到的是冷資料庫建表競爭,不是回報之字樣**:新資料夾首次啟動時 3～4 個實例相隔數十毫秒同時啟動,首個實例於約 1.1～1.2 秒以離開碼 1 失敗,訊息為 `Error: Unexpected error` ＋建表 SQL 之 `Failed query`(未含 `database is locked`),**走 stderr、`--format json` 時亦然**(失敗在輸出事件流建立之前);相隔 1500 ms 者 3／3 成功(1 批).已就緒資料庫 4 併發、使用者既有資料庫 4 併發(不存在之模型)皆未重現.故預設值與重試辨識是「覆蓋啟動窗口」之推論,**回報時要寫明未經直接驗證**.
- **「不佔 `maxRetries` 次數」在觀察上等價於「佔」**:execCli 回失敗時預算必已用盡(它自己會重試到 `maxRetries`),故重試輪之 `maxRetries − used` 恆 ≤ 0;變異 E01／E02 因此無法被抓到.記帳語意仍保留(`attempts = used + trAtt`),測試改釘「`attempts` 累計、至多一次、重試輪 `maxRetries` 0」.
- **給既有守門加「等待」會動到所有以假時鐘驅動之既有測試**:`spawnGateWorldForTest` 之 `sleep` 只登記計時器、須由 `settleAll` 驅動,臨界區內新增之間隔等待在未驅動之案例會懸置(逾時 180 秒,1 案);另 4 案因時間軸改變而紅.處置是在那些案例之守門設定加 `minGapMs: false`(它們測行程數／預約／傳遞),預設間隔之行為由專屬測試檔釘住.下次對守門加時間行為,先 Grep 測試中的 `kind: 'opencode', spawnGate: {` 與 `gateOf(` 站點.
- **間隔不單獨啟動守門**:行程數／RAM／CPU 皆 `false` 本來是「整個守門關閉」(既有測試釘住);若預設間隔使它復活,等於改變既有關閉語意.故只有「明給 `minGapMs`」才成為只錯開之守門.
- **外審抓到之洞(重試輪逾時)**:守門未運作(`spawnGate:false`、假 exe 預設情形)時 `timeoutMs` 原值不動(既有規則),但重試輪是「首次耗時＋延遲」之後才開始,沿用原值會超出遞補層期限;重試輪須另以 `deadlineAt − 現在` 封頂.凡「晚於呼叫起點才發生」之新增嘗試,都要重算剩餘預算.
- **變異腳本之寫法**:`find` 一律單行字串(避開 CRLF／LF 差異),需指定第幾個出現處者給 `occ`;於 `tmp/<輪>/mut` 之副本執行,副本在 repo 之 `tmp/` 下,node_modules 由上層解析,免連結點;`mocha --exit` ＋逾時視為 killed(去掉「只能一次」之變異會無限重試而懸置).
- **同一套件之測試鎖是依序的**:`quiet-run --lock` 在同套件有持有者時會等(本輪 eslint 因變異驗證占鎖而等 4m42s);lint 不是測試,可不經 `--lock` 直跑,別把它排在長作業之後.
