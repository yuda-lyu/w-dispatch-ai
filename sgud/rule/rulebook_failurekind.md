# 規則帳本(類型:failurekind)

> 自 `rulebook_anthropic.md` 抽出(2026-10-25 依全域 sgud 規則整理:原檔約 46KB,過長;節號與標題不變,內容逐字搬移,不刪).類型說明:失敗細分類 `failureKind`、CLI「沒額度」REST 交叉確認、遞補依分類處置、金鑰探測與 `*_KEYS` 分隔符(R-ANTHROPIC-5,dispatch-run01 修正輪)及其變異驗證表.R-ANTHROPIC-1～4 與其餘見 `rulebook_anthropic.md`;主檔索引見 `sgud/rule/rulebook.md`.

### R-ANTHROPIC-5 失敗細分類 `failureKind`、CLI「沒額度」REST 交叉確認、遞補處置、金鑰探測與 `*_KEYS` 分隔符(2026-10-25,dispatch-run01 修正輪)

- 現象與來源(主控 2026-10-25,Claude Code 2.1.302):於 Claude Code 工作階段內以 `env:{ANTHROPIC_API_KEY}`＋`--bare` 呼叫 `claude-opus-5-5`,init 之 `apiKeySource=ANTHROPIC_API_KEY`,assistant 與 result 皆為「Credit balance is too low」(`is_error: true`、費用 0);同一把金鑰經 `key` 參數(不加 `--bare`)正常回覆並扣費,REST(`max_tokens` 64000)亦正常.先前有子代理據此誤判「API 額度用盡」.使用者要求「沒額度」與「超過脈絡上限」須以不同方式區分處置,否則遞補會亂用(把所有金鑰輪過一遍、誤判額度用盡).**成因未隔離**(`--bare`、`env` 傳遞或繼承之父 session 變數何者所致不明).
- 軸:`failureKind`{`no-credit`、`context-too-long`、`rate-limit`、`overloaded`、`key-invalid`、`no-permission`、`network`、`env-error`、`other`}× 來源{REST、CLI 純文字、CLI stream-json}× 證據{HTTP 狀態碼、`error.type`、`error.message`、`error.details.error_code`、`assistant.error`、`result.api_error_status`、失敗文字}× 範圍{Anthropic 官方端點金鑰條目、自訂 `baseURL` 條目、訂閱路徑、其他 kind}× 處置{換把、略過、整組跳過、結束整個呼叫、冷卻}.
- **R5.1 分類單一來源 `src/failureKind.mjs`**(`classifyRestFailure`、`classifyCliFailure`、`FAILURE_KINDS`):`errorType`／`error` 不動,`failureKind`／`failureDetail` 另加;只對 `api-anthropic` 之全部失敗結果與 `claude` 在 API 金鑰在場(`key`,或 `opt.env.ANTHROPIC_API_KEY` 有效字串)且已進入執行階段之失敗結果加(另含 `key` 含 NUL 字元而在啟動前被拒之 `INVALID_KEY`:`failureKind: 'key-invalid'`、`attempts: 0`——外審二#8);成功結果、訂閱路徑與其他 kind **不加**(結果物件不變).優先序:沒額度(402、`billing_error`、額度字樣、花費上限字樣與 `error_code === 'enforced_spend_limit_reached'`)→ 脈絡過長(413、`request_too_large`、`prompt is too long`／`request too large` 字樣)→ 401 `key-invalid`→ 403 `no-permission`→ 429 `rate-limit`→ 529 `overloaded`→ 504 `network`→ `other`.**額度字樣先於狀態碼**:花費上限之 429 與 400 不是一般限流或參數錯誤.
- **R5.2 依據(2026-10-25 查證)**:HTTP 碼與 `error.type`＝官方 errors 頁;花費上限(自設=400「You have reached your specified (workspace) API usage limits」;月上限=429、無 `retry-after`、`error_code` 為 `enforced_spend_limit_reached`)＝官方 rate-limits 頁;脈絡過長(輸入本身超過視窗=400 `invalid_request_error`「prompt is too long」)＝官方 context-windows 頁;「Your credit balance is too low…」**官方 errors 頁未逐字載明**(第三方回報為 400),以訊息比對;CLI 結構化訊號＝官方 Agent SDK 文件(`SDKAssistantMessage.error` 十二值、`SDKResultMessage.api_error_status`,僅 stream-json);CLI 字樣＝Claude Code 2.1.302 之 `claude.exe` 內嵌字串(grep 取得,**程式內含之字串不等於各情境之實際輸出**,僅「Credit balance is too low」經主控於 stream-json 實測).官方載明脈絡超限時「輸入＋`max_tokens` 超過視窗」於 4.5 以後模型不是錯誤(`stop_reason: model_context_window_exceeded`,HTTP 200)——本轉接器對未知 `stop_reason` 視為成功(既有行為,未動),舊模型之驗證錯誤逐字訊息官方未載明,歸 `other`.
- **R5.3 CLI 分類只認失敗訊息**:逾時→`network`;spawn／params／驗證失敗→`other`(stdout 是模型輸出,即使含額度字樣);離開碼須為非零數值.**純文字 stdout 之採信規則(外審 #4、#5 後收緊)**:只取**末行**(多次嘗試 `maxRetries` 累積之輸出只看最後一次)、須**以 Claude Code 錯誤訊息開頭**(`RE_CLI_ERROR_START`:`API Error`、`Error: `、`Credit balance is too low`、`Prompt is too long`、`Request too large`、`Invalid API key`、`Unable to connect to API`、`Request timed out`、`Repeated 529`、`Server is temporarily limiting`、`Authentication error`、`OAuth token`)、單行 ≤1000 字元;stdout 無證據時才取 stderr 末三行(有 stdout 證據時不混入);stream-json 只取最後一個 `init` 事件之後之事件,`assistant.error`／`result.api_error_status` 為協定欄位不受開頭限制.開頭不在清單者歸 `other`(維持既有處置),避免「提到關鍵字的短模型回答」被誤判(例:模型答「The phrase 'Prompt is too long' means…」而離開碼非零).`execCli` 失敗時 stdout 只留**前** 500 字元(`strTruncate`),stream-json 之 result 事件在尾端會被截掉——故金鑰在場時 `dispatchClaude` 以 `onStdout`／`onStderr` 另錄尾段(64KB／16KB;分類用,不外送,呼叫端回調所見不變).
- **R5.4 CLI「沒額度」須經 REST 交叉確認**(`dispatchClaude`;預設開,`opt.crossCheck: false` 關):CLI 分類為 `no-credit` 時以**同一把金鑰**對 REST 送 `max_tokens: 1`、模型 `claude-haiku-5-5` 之極小請求(`probeAnthropicKey`;`opt.fetch` 可注入,`crossCheckBaseURL`／`crossCheckModel` 可改):REST `no-credit`→`no-credit`(已確認);REST `ok`→**`env-error`**(不得當成沒額度);REST 其他(限流、金鑰無效、網路、一般 400)→`other`(無法確認,不判額度);結果另帶 `crossCheck: { done, restKind, restStatus }`.交叉確認請求不進結果物件(`failureDetail` 先 `redactApiKeyText`).**期限(外審 #8)**:交叉確認與 CLI 共用同一次嘗試之期限——timeout＝`min(30000, max(timeoutMs − CLI 已耗時, 1))`,耗時併入 `durationMs`,故遞補層 `budgetMs` 契約不破;探測自身不 reject(`probeAnthropicKey` 有最後防線,`addFailureKind` 再包一層).
- **R5.5 遞補處置(`dispatchAiFallback`)**:見 README「遞補層依 failureKind 的處置」表.實作要點:①`no-credit`→本次呼叫內 `deadKeys`(金鑰指紋→失敗結果與其條目 id),範圍限 `isAnthropicKeyScope`(`claude-api:` 與 `anthropic:` 共用同一組 `ANTHROPIC_KEYS` 與同一額度池;**外審 #2、#3 後收緊**:`api-anthropic` 須未自訂 `baseURL`〔顯式官方網址 `api.anthropic.com` 視同官方〕且 `headers` 未覆寫 `x-api-key`／`authorization`〔覆寫時實際認證身分不是 `keys[]` 所示〕;`claude` 須未自訂 `crossCheckBaseURL`,且條目 `env` 與 `process.env` 之 `ANTHROPIC_BASE_URL` 皆未導向官方以外;任何讀取失敗保守視為範圍外;`settings.json` 之 `env` 區塊所設者看不到＝已知限制),後續條目遇之 `skip-key`(不送請求、不算嘗試;`shouldStop` 於略過判定**之前**檢查〔外審 #13〕;最終結果以**合成**之失敗結果表示——只帶 `error`／`errorType`／`failureKind`／`failureDetail`,`code` 為 null、無 pid／stdout／stderr,`skippedFrom` 標明證據來自哪個條目〔外審 #12〕);指紋於組前一次算好,`String` 包裝物件先取原始字串,無法計算者本組退出範圍〔外審 #14〕;`quotaExhausted` 須**組內每一把**皆沒額度(`noCreditIdx.size === nk`);`cooldownMs>0` 另記 `store.keyCooling[sha256 前 16 碼]`(**不存金鑰本體**,僅首次寫入才建立此鍵,故未啟用時 store 形狀不變),下次呼叫該把降序至組內最後(只降序不移除、全冷卻仍試)、整組沒額度之條目記條目冷卻;②`context-too-long`→立即 `return`(不換金鑰、不試後續條目、不寫游標與冷卻),`error` 為 `CONTEXT_TOO_LONG: …`;③`network`／`env-error`→`isKeyIndependentFail`(整組跳過,續試下一條目);④`rate-limit`→內建冷卻觸發:有 `failureKind` 者只認 `'rate-limit'`(月花費上限之 429 是 `no-credit` 不是限流,不得因原始 HTTP 429 提前冷卻條目,與 CLI 路徑對稱——外審 #11),無 `failureKind` 之其他 kind 維持 HTTP 429 判準,另加 TIMEOUT;`coolDetect` 與內建為「或」(內建先判,coolDetect 只能增加);金鑰冷卻之 `keyCooling` 於該把成功時解除(恢復即復位);整組沒額度之條目冷卻與金鑰冷卻之寫入皆包 try/catch(凍結 state 退化為不記冷卻);⑤`key-invalid`／`no-permission`／`overloaded`→換下一把,不冷卻;`other`→沿用既有分流(`isKeyIndependentFail`:例如 `refusal`、截斷、驗證失敗整組跳過,其餘換下一把——外審二#9);⑥最終結果:有整組沒額度之供應商時帶 `quotaExhausted: [id…]`,最後一筆為該情形時 `error`＝`QUOTA_EXHAUSTED: …`,`env-error`→`ENV_ERROR: …`;`group-exhausted` 之 `attempted`／`errorTypes` 不含 `skip-key`,有 `failureKind` 時另帶 `failureKinds`.
- **R5.5b fetch 例外與重試(外審 #6、#7)**:REST 之 fetch 例外依 `classifyFetchError`:有 `cause.code`(連線拒絕、DNS、重設、TLS、無效網址)＝`network`;標頭值非法(金鑰含換行,送出前拋出、無 `cause.code`)＝`key-invalid`(屬金鑰層,須換把;曾被一律歸 `network` 致整組跳過、有效金鑰永遠不試);其餘無法判定＝`other`(維持既有處置:換下一把,不憑空歸為網路故障);逾時＝`network`.REST 對 `no-credit`(含月花費上限 429)與 `context-too-long` 不重試(決定性失敗);CLI 之 `maxRetries` 重試由 `execCli` 在分類前進行,決定性失敗仍會重送 CLI(已知限制,預設 0).
- **R5.6 金鑰探測 `probeAnthropicKeys(keys, opt)`**(`src/probeAnthropicKeys.mjs`):每把一個 `max_tokens: 1` 請求(預設 `claude-haiku-5-5`)依序執行,回傳 `{ model, results, summary }`,各項 `{ index, length, kind, ok, status, apiErrorType, detail, limits, retryAfterSec, durationMs }`;`kind` 為 `ok`｜`no-credit`｜`key-invalid`｜`no-permission`｜`rate-limit`｜`overloaded`｜`network`｜`other`;`limits` 取自 `anthropic-ratelimit-{requests|tokens|input-tokens|output-tokens}-{limit|remaining|reset}`,`retryAfterSec` 取自 `retry-after`;**不回傳金鑰本體或任何片段**(只有序號與長度;`detail` 與來自伺服器之文字欄位 `limits.*.reset` 先遮蔽金鑰並截斷〔外審 #1〕);**一般金鑰無查餘額端點,只判斷「此刻能否呼叫」**;值域不含 `context-too-long`(413 等歸 `other`,外審 #18);fetch 例外同 R5.5b;不 reject(讀取例外一律用 `errField`／`errMsg`,另有最後防線——注入之 fetch 回畸形回應物件亦以該把 `other` 回報,外審 #10).
- **R5.7 `*_KEYS` 分隔符**(`src/splitKeys.mjs`、`resolveProviders`):名稱以 `_KEYS` 結尾之環境變數遇分號視同逗號並於回傳 `warnings`(`[{ envVar, code: 'KEYS_SEMICOLON', message, ids }]`,每變數一則、不含金鑰值)回報;非 `_KEYS` 名稱與條目自帶 `keys` 不受影響;`opt.splitSemicolon: false` 可關閉拆分(仍 warning).理由:已知內建供應商金鑰字元不含分號,含分號幾乎必為分隔錯誤,自動拆開比整串送出(401 而非明顯的設定錯誤)貼近意圖,warning 避免靜默;只作用於複數形變數以保相容.
- 盤點指令:`Grep "failureKind" src`——預期:`failureKind.mjs`(定義)、`dispatchApiAnthropic.mjs`(HTTP／fetch／逾時分類與 `mkResult` 預設 `other`)、`dispatchClaude.mjs`(`addFailureKind`、INVALID_KEY)、`dispatchAiFallback.mjs`(處置與事件)、`wkf/callAiWithFallback.mjs`(透傳)、`probeAnthropicKeys.mjs`(間接);`Grep "keyCooling" src`——預期只在 `dispatchAiFallback.mjs`;`Grep "createHash" src`——預期 `dispatchAiFallback.mjs`(指紋)與既有 `quota/getQuotaAntigravity.mjs`.
- 對應測試:`test/unit-failureKind.test.mjs`(REST 狀態碼×訊息×`error_code` 之案例矩陣〔共約二十列,非窮舉〕;CLI 純文字十五種字樣、`assistant.error` 十二值、`api_error_status`、尾段分類、逾時／spawn／params／驗證失敗／離開碼 null 與 0／過長 stdout 之排除;外審後新增:`classifyFetchError`〔cause.code／標頭非法／無法判定〕、模型本文提到關鍵字不採信、多次嘗試只看最後一次〔純文字末行、stream-json 最後 init〕、單行過長不採信)、`test/unit-dispatchApiAnthropicFailureKind.test.mjs`(假伺服器十四種 HTTP 失敗、連線拒絕、逾時、`other` 類、`params`、成功不帶欄位、`opt.fetch` 注入、遮蔽)、`test/unit-dispatchClaudeFailureKind.test.mjs`(交叉確認兩種結果與其餘結果、關閉開關與預設開、請求形狀、stream-json 尾段、非額度類不呼叫 fetch、訂閱路徑不變、env 金鑰＋`--bare` 路徑、金鑰不外洩、回調)、`test/unit-dispatchAiFallbackKinds.test.mjs`(沒額度換把／全部用盡／部分不算／CLI 確認／跨條目略過／自訂 baseURL 不共享／金鑰冷卻指紋不含金鑰本體／降序與全冷卻仍試／過期清除;脈絡過長立即結束之 REST、413、CLI、先沒額度再過長、經 `callAiWithFallback`;限流與過載;金鑰無效與無權限不冷卻;網路不換金鑰;`env-error`;`other` 與不得改變)、`test/unit-probeAnthropicKeys.test.mjs`(各狀態分類、請求形狀、限額標頭、輸出不含金鑰片段、例外遮蔽、逾時、字串輸入、無效元素、假伺服器整合)、`test/unit-resolveProvidersKeys.test.mjs`(`splitKeys`、`warnings`、`_KEYS` 範圍、`splitSemicolon: false`、相容)、`test/unit-WDispatchAi.test.mjs`(多一個匯出).假伺服器新增路由:`err-credit-400`、`err-spend-limit-400`／`-ws-400`、`err-spend-cap-429`、`err-context-400`、`ok-with-limits`、`by-key`(依金鑰字樣路由,供遞補測試).
- 未驗證(不得發真實請求,待主控實測):真實 CLI 於額度不足時之實際輸出(文字或 stream-json 欄位);「Your credit balance is too low」之真實 HTTP 碼與 `error.type`;`max_tokens: 1` 對 `claude-haiku-5-5` 之接受度(探測與交叉確認皆用,含自適應思考下是否接受);真實 `prompt is too long` 訊息之逐字格式;`claude` 在額度不足時之離開碼(假設非零).主控實測腳本與便宜觸發脈絡過長之作法見報告.

### 變異驗證(2026-10-25 dispatch-run01,R-ANTHROPIC-5;94 個變異全數被抓到)

工具 `tmp/dispatch-run01/mutate.mjs`(證據副本 `agent-out/dispatch-run01-evidence/mutate.mjs`)於 `./tmp` 副本逐一施加,先跑基準(未變異,11 個測試檔 380 條須全綠),`find` 須恰出現一次否則標 BAD_MUTANT(定義過期者更新後單獨重跑);「failing」為該變異下失敗條數.任務書要求之三個變異 R1(脈絡過長仍換金鑰)、R2(CLI 沒額度不交叉確認)、R3(探測輸出含金鑰)皆被抓到.第一輪(外審前,62 個)存活 2 個:F20(沒額度之略過不更新 `lastResult`——所有情境恰使新舊結果相同)與 K5(CLI 驗證失敗也分類——被「離開碼 0」之守門遮蔽成等價變異),補測試後皆被抓到;外審兩輪修正後對最終程式重跑全部 94 個(含外審新增之變異),0 存活.完整輸出:`agent-out/dispatch-run01-evidence/mutation-final.log`(F17、K14 因程式改寫而更新 `find` 後單獨重跑,見同資料夾 `mutation-rerun-F17-K14.log`).

| # | 變異 | failing |
|---|---|---|
| R1 | 脈絡過長仍換金鑰(不立即結束) | 5 |
| R2 | CLI沒額度不交叉確認 | 21 |
| R3 | 探測輸出含金鑰 | 2 |
| F1 | 脈絡過長改為只整組跳過(仍試後續條目) | 5 |
| F2 | 脈絡過長錯誤字串不再明確(無CONTEXT_TOO_LONG前綴) | 4 |
| F3 | 沒額度之金鑰在後續條目不略過(每個條目都輪一遍) | 6 |
| F4 | 全部沒額度不標quotaExhausted | 6 |
| F5 | 只要有一把沒額度就算額度用盡 | 2 |
| F6 | network不整組跳過(換金鑰) | 4 |
| F7 | env-error換金鑰(不整組跳過) | 2 |
| F8 | key-invalid亦觸發冷卻 | 1 |
| F9 | 內建冷卻不含failureKind為rate-limit(CLI限流不冷卻) | 2 |
| F10 | 金鑰冷卻存金鑰本體而非指紋 | 6 |
| F11 | 冷卻中之金鑰不降序 | 1 |
| F12 | 冷卻中之金鑰被移除(全冷卻時無金鑰可試) | 2 |
| F13 | skip-key計入attempted | 1 |
| F14 | coolDetect可否決內建觸發 | 1 |
| F15 | 沒額度視為與金鑰無關(整組跳過) | 15 |
| F16 | 整組沒額度不記條目冷卻 | 1 |
| F17 | 自訂baseURL之條目也共享沒額度紀錄 | 1 |
| F18 | claude(CLI)不在官方端點金鑰範圍(跨條目不略過) | 4 |
| F19 | 沒額度不記入金鑰冷卻(cooldownMs>0時) | 2 |
| F20 | 沒額度之略過不標skippedFrom(最終結果不指明證據來源) | 1 |
| F20b | 略過時最終結果掛他家轉接器之stdout／code／pid(混合來源) | 1 |
| F21 | 冷卻中之金鑰成功後不解除金鑰冷卻 | 1 |
| F22 | shouldStop於略過判定之後才檢查(全部略過之條目不遵守中止) | 1 |
| F23 | 月花費上限429仍以原始HTTP 429提前冷卻條目 | 1 |
| F24 | 範圍判定忽略條目env之ANTHROPIC_BASE_URL | 1 |
| F25 | 範圍判定忽略process.env之ANTHROPIC_BASE_URL | 1 |
| F26 | 範圍判定忽略crossCheckBaseURL | 1 |
| F27 | 顯式官方網址被當成自訂端點(不共享) | 2 |
| F28 | 範圍判定忽略headers覆寫認證標頭 | 1 |
| F29 | String包裝物件金鑰指紋不先取原始字串(與原始字串金鑰指紋不一致) | 1 |
| F30 | 範圍檢查執行env內ANTHROPIC_BASE_URL之getter(多讀一次呼叫端物件) | 1 |
| F31 | headers覆寫認證標頭仍視為keys[]即實際認證(累計quotaExhausted並共享) | 2 |
| F32 | 脈絡過長提前返回遺失先前已確認之quotaExhausted | 1 |
| F33 | 整組沒額度之條目冷卻寫入不防凍結state(reject) | 2 |
| F34 | 金鑰冷卻寫入不防凍結state(reject) | 2 |
| C1 | REST成功仍判no-credit(不判env-error) | 5 |
| C2 | REST其他結果(限流等)仍判no-credit | 4 |
| C3 | 交叉確認用錯金鑰 | 7 |
| C4 | 不錄輸出尾段(stream-json無法分類) | 4 |
| C5 | failureDetail不遮蔽金鑰 | 3 |
| C6 | 訂閱路徑(未給金鑰)也分類 | 3 |
| C7 | env金鑰路徑不處理 | 2 |
| C8 | 成功結果也加failureKind | 1 |
| C9 | crossCheck: false仍交叉確認 | 2 |
| C10 | crossCheck預設關(只有明給true才開) | 21 |
| C11 | 未給key時env物件被讀兩次 | 1 |
| C12 | INVALID_KEY不帶failureKind | 1 |
| C13 | 交叉確認重新取得完整timeout(不扣CLI已耗時) | 1 |
| C14 | 交叉確認耗時不併入durationMs | 1 |
| C15 | 探測最後防線改為重拋(畸形回應使探測reject) | 1 |
| C16 | 未給key且env不可讀時不直接回params(交下層重讀放行) | 1 |
| C17 | 分類改採累積之尾段而非最後一次嘗試之原始stdout(重試輸出無換行時黏在一起) | 1 |
| A1 | fetch例外一律歸network(含非法標頭／無法判定) | 4 |
| A1b | fetch例外一律歸other(有cause.code者不判network) | 6 |
| A2 | 逾時不歸network | 1 |
| A3 | failureDetail不遮蔽金鑰 | 4 |
| A4 | opt.fetch不生效 | 39 |
| A5 | 失敗未明給failureKind時不補other | 1 |
| A6 | HTTP失敗不帶failureKind(只帶other) | 39 |
| A7 | 沒額度與脈絡過長仍依maxRetries重試 | 1 |
| K1 | 413不歸脈絡過長 | 2 |
| K2 | 額度字樣不辨識 | 51 |
| K3 | 月花費上限error_code不辨識 | 5 |
| K4 | CLI單行過長(模型輸出)也當失敗訊息 | 1 |
| K5 | CLI驗證失敗也分類 | 1 |
| K6 | CLI逾時不歸network | 2 |
| K7 | assistant.error billing_error不對映 | 1 |
| K8 | api_error_status忽略 | 4 |
| K9 | 429先判限流(月花費上限被當限流) | 10 |
| K10 | CLI離開碼null/0也分類 | 1 |
| K11 | 純文字stdout不要求以Claude Code錯誤訊息開頭(模型本文提到關鍵字也算) | 2 |
| K12 | stream-json多次嘗試不只看最後一次init之後 | 1 |
| K13 | 純文字stdout取末三行(多次嘗試被先前輸出蓋過) | 2 |
| K14 | stdout有證據時仍混入stderr | 1 |
| K15 | fetch例外有cause.code不判network | 9 |
| K16 | fetch例外標頭值非法不判key-invalid | 4 |
| K17 | 結構化證據(狀態碼／assistant.error)無文字時stderr仍混入並蓋過 | 1 |
| P1 | 探測錯誤訊息不遮蔽金鑰 | 2 |
| P2 | 探測請求max_tokens不為1 | 6 |
| P3 | 探測不解析限額標頭 | 4 |
| P4 | 探測預設模型不是haiku | 2 |
| P5 | 探測fetch例外訊息不遮蔽(整段原樣) | 1 |
| P6 | 探測限額標頭reset回顯金鑰時不遮蔽 | 2 |
| P7 | 探測413等context-too-long不歸other | 1 |
| P8 | 探測fetch例外一律歸network | 3 |
| S1 | 分號不拆 | 6 |
| S2 | 分號不發warning | 6 |
| S3 | 所有變數名都拆分號(含非_KEYS) | 1 |
| S4 | warning含金鑰值 | 1 |
| S5 | splitSemicolon:false不生效 | 1 |
| W1 | callAiWithFallback不透傳failureKind | 1 |

修前紅(2026-10-25):`git archive HEAD src` 解到 `./tmp/dispatch-run01/red/src`,疊上當時六個新測試檔與 `test/tools`,逐檔跑(`runTests.mjs`)——`unit-dispatchAiFallbackKinds` 8 passing／36 failing、`unit-dispatchApiAnthropicFailureKind` 3／26、`unit-dispatchClaudeFailureKind` 4／30,`unit-failureKind`、`unit-probeAnthropicKeys`、`unit-resolveProvidersKeys` 因 `src/failureKind.mjs`、`probeAnthropicKeys.mjs`、`splitKeys.mjs` 不存在而 MODULE_NOT_FOUND;修前仍通過者(15 條)皆為「不得改變」守門(成功不帶新欄位、訂閱路徑不帶欄位、無 failureKind 時事件形狀不變、`cooldownMs` 未啟用時 store 形狀不變等).外審後新增之測試未重跑修前紅(其對應變異 F20/F20b/F21–F29、C13–C16、A1b/A7、K11–K16、P6–P8 皆已被抓到,等價於證明測試能區分正誤實作).
