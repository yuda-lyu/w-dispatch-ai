# 規則帳本(類型:anthropic)

> 自 `rulebook.md` 抽出(2026-10-25 依全域 sgud 規則整理:過長即依類型拆檔;節號與標題不變,不刪內容,只搬移).類型說明:Anthropic API 金鑰計費:CLI 帶 key 與 kind api-anthropic(R-ANTHROPIC-1～3).主檔索引見 `sgud/rule/rulebook.md`.

## Anthropic API 金鑰計費:CLI 帶 key 與 kind `api-anthropic`(2026-10-24 立)

> 狀態:**生效**(2026-10-24,主控任務 20261024231618 之 dispatch-run01/run02;工作區未發布,下次發布一併帶出).
> 來源:主控提示詞「使用者取得 Anthropic Console 之 API 額度(與 Claude 訂閱額度分開計費),要讓各台電腦經本套件以該額度呼叫 Claude」;官方依據 2026-10-24 查證:`code.claude.com/docs/en/authentication`(憑證優先序)、`code.claude.com/docs/en/agent-sdk/typescript`(`ApiKeySource`)、`platform.claude.com/docs/en/api/errors`(HTTP 錯誤碼)、claude-api 技能(模型、thinking／effort、`stop_reason`).
> 約束:**不得發出真實 Anthropic 請求**(真實實測由主控);不讀任何 `.env`;未給 key 時 `dispatchClaude` 與既有條目、kind 之行為完全不變.

### 軸

- 呼叫點:`dispatchClaude`(新 `key`)、`dispatchApiAnthropic`(新 kind `api-anthropic`)、`dispatchAiFallback`(`keys` 輪替、冷卻、`isKeyIndependentFail`)、`resolveProviders`(`envVar` 展開)、`providers.mjs` 六條新條目、`adapters`／`dispatchAi`／`WDispatchAi`(kind 清單).
- 金鑰可能外洩之出口:子進程 argv、`process.env`、結果物件之 `stdout`／`stderr`／`error`、`tried`、`onEvent` 事件、REST 之 `FETCH_ERROR` 訊息與 HTTP 錯誤本體、測試與文件範例.
- 輸入軸:`key`{有效字串、未給、空字串、非字串}× 父環境憑證變數{無、`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_USE_*`…}× `opt.env`{無、含衝突變數}× 子進程輸出{無回顯、回顯 key、回顯他把 `sk-ant-…`}.
- REST 回應軸:`stop_reason`{`end_turn`、`stop_sequence`、`max_tokens`、`refusal`、`tool_use`、`pause_turn`、未知值}× HTTP{200、400、401、402、403、404、413、429、500、529}× 傳輸{逾時、連線拒絕、非 JSON、缺 `content`、壓縮漏標}.

### R-ANTHROPIC-1 CLI 帶 key:只入該次子進程環境,並移除優先於它之憑證變數

- 規則:`dispatchClaude(prompt, { key })`,`key` 為有效字串(`isestr`)才啟用;①`env.ANTHROPIC_API_KEY = key`(經 `runExecCli`→wsemi `execCli` 之 `env`,只作用該次子進程,不寫 `process.env`、不進 argv);②自子進程環境移除 `CRED_VARS_REMOVED`(`CLAUDE_CODE_USE_BEDROCK`／`VERTEX`／`FOUNDRY`／`MANTLE`／`ANTHROPIC_AWS`、`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN`、`ANTHROPIC_PROFILE`、`ANTHROPIC_FEDERATION_RULE_ID`,以 `undefined` 遮蔽繼承值;`opt.env` 中同名者亦剔除,Windows 不分大小寫);③結果之 `stdout`／`stderr`／`error` 遮蔽 key.**未給或非有效字串:env 與結果完全不經此路徑(行為與舊版相同)**.
- 依據:官方憑證優先序 ①雲端供應商選擇器與 gateway ②`ANTHROPIC_AUTH_TOKEN` ③`ANTHROPIC_API_KEY`(`-p` 一律使用)④`apiKeyHelper` ⑤`CLAUDE_CODE_OAUTH_TOKEN` ⑥profile／federation ⑦訂閱 OAuth.序位高於③者殘留即蓋過 key,必移除;⑤⑥縱深防禦.環境變數處理不到而仍可能蓋過者(`settings.json` 之 `env` 區塊、gateway 登入、`ANTHROPIC_BASE_URL`)寫於 `dispatchClaude.mjs` 檔頭與 README,**故「確實走 API 金鑰」須以輸出驗證**:`--output-format stream-json --verbose` 之首個 `system/init` 事件 `apiKeySource` 為 `ANTHROPIC_API_KEY`(官方四值:`ANTHROPIC_API_KEY`｜`apiKeyHelper`｜`/login managed key`｜`none`).
- 遮蔽規則:精確 key 一律遮蔽(`redactText`);`stderr`、`error` 與**失敗**之 `stdout` 另遮蔽 `sk-ant-` 樣式(`redactApiKeyText`);**成功之 `stdout` 是模型輸出,只遮蔽 key 本身**(合法內容可含 `sk-ant-api03-…` 範例字樣).
- 回調與前置失敗(2026-10-25 外審回饋 #3、#5、#6 後補):①key 模式下呼叫端給的 `onStdout`／`onStderr`(派工腳本慣例以之寫 `stdout.log`)包 `createStreamRedactor`(`src/redactText.mjs`:機密值之真前綴與未完成之 `sk-ant-` 尾段留到下一塊判斷,且不切在完整出現之機密值中間;結束後補送保留尾端;stdout 回調只遮蔽 key、stderr 回調另遮蔽樣式);②啟動前之 params 錯誤(`opt.env` 不可讀)之訊息先 `redactApiKeyText`(外來例外訊息可能夾帶 key);③key 含 NUL(無法放進環境變數)回 `INVALID_KEY`(`errorType: 'exec'`,attempts 0,**與金鑰相依**:遞補層換下一把;若放行至 spawn,其失敗會被歸為與金鑰無關之 `spawn` 而整組跳過).
- 已知限制(寫入 README 與檔頭):`validate` 收到未遮蔽原始 stdout(需要原文判斷);長度不足 6 之 key 不遮蔽(`redactText` 最短長度);子進程(模型)自身若能讀其環境(Linux `/proc/self/environ`)可能在其輸出帶出 key,輸出經遮蔽不回呼叫端,但 CLI 自己的 session 紀錄可能含之.
- **`apiKeySource` 是必要條件而非充分條件**(外審 #10):它只證明來源種類為 `ANTHROPIC_API_KEY`,不證明是「本次傳入的那把 key」或預期的 Console／端點(`settings.json` 的 `env` 另設 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` 導向他處時仍顯示 `ANTHROPIC_API_KEY`);主控實測須另核對 Console 用量／費用(對應該 key 所屬組織與工作區).
- **計費來源無聲切換(已知限制,不修,外審 #7)**:`dispatchAiFallback`／`resolveProviders` 既有契約「條目沒有有效 `keys`＝沿用登入態」,故內建 `claude-api:` 條目若被呼叫端以 `keys: []`、全無效元素或 `patch` 清空,會等同 `claude:` 訂閱條目;缺 `ANTHROPIC_KEYS` 則正確 skipped.改此契約會動既有條目行為,不在本輪範圍.
- 共用額度池(外審 T14):`claude-api:`(CLI)與 `anthropic:`(REST)共用 `ANTHROPIC_KEYS` 與同一 Console 額度,游標與冷卻按條目 id 各自獨立;一條 429 冷卻不會自動冷卻其餘五條.建議 `pick` 自選.
- 盤點指令:`Grep "ANTHROPIC_API_KEY|CRED_VARS_REMOVED|buildKeyEnv|redactResult" src`——預期:`src/dispatchClaude.mjs`(定義與唯一使用處)、`src/providers.mjs`(僅註解)、`src/dispatchApiAnthropic.mjs`(僅註解);`Grep "process\.env\.ANTHROPIC" src`——預期 0 命中(不寫 `process.env`).
- 對應測試:`test/unit-dispatchClaudeKey.test.mjs`(R01 key 入子進程環境;R02 九個憑證變數自父環境與 `opt.env` 移除、其餘 `opt.env` 變數保留;R03 未給／無效(undefined、null、空、123、{}、[])時環境與 argv 與舊版相同、父環境 `ANTHROPIC_API_KEY` 等原樣流過;R04 key 不在 argv／stdin／`process.env`;R05 成功與失敗(非零離開、驗證失敗)結果遮蔽,未給 key 時不遮蔽;R06 並行各見自己的 key;R07 `dispatchAiFallback` 輪替且回傳、`tried`、事件不含任何 key,`coolDetect` 命中時 `cooled`).假 CLI 為 `createFakeCli('fake-claude-key', ENTRY)`,把子進程實際收到之 env／argv 寫入 `test/_tmp/dispatchClaudeKey/`(不走 stdout,因 stdout 會被遮蔽);外審補強:`onStdout`／`onStderr` 跨塊遮蔽(`--fake-split`)、未給 key 時回調原樣、`opt.env` getter 拋出夾帶 key 之例外、key 含 NUL(含遞補換鑰)、凍結之 `opt.env`、Windows 下不同大小寫之衝突變數、`key: null` 搭 `opt.env` 之相容.`test/unit-redactText.test.mjs` 另含 `createStreamRedactor` 以「任意兩切點」窮舉驗證合併輸出等同整段遮蔽.

### R-ANTHROPIC-2 REST kind `api-anthropic`:請求形狀、stop_reason 與 HTTP 錯誤之處置

- 規則(`src/dispatchApiAnthropic.mjs`,檔頭為完整說明):①`POST <baseURL>/v1/messages`(`baseURL` 預設 `https://api.anthropic.com`,尾端 `/v1` 與斜線去除);標頭 `x-api-key`(非 `Authorization`)、`anthropic-version: 2023-06-01`(缺則伺服器 400)、`Content-Type`、`Accept-Encoding: identity`;`opt.headers` 同名鍵**不分大小寫**覆寫預設而不重複送出;②本體 `{ model, max_tokens: 16000, messages: [{role:'user', content}], system?, output_config?: { effort } }`,`opt.body` 併入且同名鍵以 body 為準;**不送** `temperature`／`top_p`／`top_k`／`thinking`／`stream`／`tools`(5.5 系列移除取樣參數,thinking 省略即自適應,Opus 5.5 不可關閉);`model` 必填(無預設);③`stop_reason`:`end_turn`／`stop_sequence`／未知值＝成功;`max_tokens`＝截斷(預設失敗 `incomplete`、`truncated: true`、不重試,無可見輸出者即使 `acceptTruncated` 亦失敗);`refusal`＝失敗(`errorType: 'refusal'`、`error: 'REFUSED: stop_reason=refusal (category=…)'`、部分文字在 `stdout`、`stop_details` 在 `stderr`、不重試、遞補層整組跳過);`tool_use`＝`tool-unsupported`;`pause_turn`＝`incomplete`(非截斷);④HTTP 非 2xx:`errorType: 'http'`、`code`、`error: 'HTTP <碼>'`、`apiErrorType`(取自本體 `error.type`),4xx(429 除外)不重試,429／5xx(含 529)／網路錯誤／逾時依 `maxRetries` 重試;⑤錯誤路徑一律先 `redactApiKeyText`(本次全部機密標頭值+key 本身+`sk-ant-` 樣式),含:fetch 例外、HTTP 錯誤本體、refusal 細節、部分輸出、**非 JSON 診斷中之回應標頭值、呼叫端 `validate` 之例外註記(含 `d.note` 與 `v.note`)、啟動前 params 錯誤之外來例外訊息**(外審 #2～#4 後補;前兩者之 `red()` 在截斷前);成功之 `stdout` 只**精確遮蔽**本次機密值(外審 #1 後補),不做樣式遮蔽.
- 與金鑰之關係:`isKeyIndependentFail` 新增 `errorType === 'refusal'`→整組跳過;401／402／403／額度類 400／429 皆「換組內下一把」,429 觸發內建冷卻(`code === 429`).
- 盤點指令:`Grep "errorType: '" src/dispatchApiAnthropic.mjs`(各失敗分支皆明給 errorType;`params` 僅限進入前檢核);`Grep "refusal" src`——預期:`dispatchApiAnthropic.mjs`、`dispatchAiFallback.mjs`(一處)、`getErrorType.mjs`(一覽).
- 對應測試:`test/unit-dispatchApiAnthropic.test.mjs`(假伺服器 `test/tools/fakeServerForAnthropicTest.mjs`,**自帶把關:缺 `x-api-key`→401、缺 `anthropic-version`→400、缺 `max_tokens`→400**,令任何成功路徑測試同時守住標頭;請求形狀、system 頂層、effort 五值、body 覆寫、headers 大小寫覆寫、成功與 usage、多 text 區塊串接、空 text、`thinking-only`、`stop_sequence`／未知 stop、`max_tokens` 各情境、`refusal`(含部分文字)、`tool_use`、`pause_turn`、HTTP 400/402/403/404/413/429/500/529 與重試次數、401 不重試、flaky-429／529 重試後成功、逾時、連線拒絕、非 JSON／garbage／缺 content、壓縮漏標、金鑰不外洩三情境、validate 三態、`params` 三態、`dispatchAi` 分派;`dispatchAiFallback`:401 換鑰、429 冷卻、402 換鑰、refusal 整組跳過;外審補強:成功回覆回顯 key、`validate` 例外夾帶 key〔同步 throw、`Promise.reject`、`max_tokens` 放行後〕、啟動前 params 錯誤夾帶 key〔body／headers getter、`toJSON`、標頭值 `toString`〕、非 JSON 回應標頭值夾帶 key、集合外金鑰〔錯誤本體與 refusal 細節〕、504、401 回 HTML、`end_turn` 含 `tool_use`、`baseURL` 尾端 `/v1///`、真實已關閉埠之 ECONNREFUSED、`validate` 永不落定、跨次冷卻降序).

### R-ANTHROPIC-3 providers 與 envVar:`ANTHROPIC_KEYS`,不得用 `ANTHROPIC_API_KEY`;計費條目集中於清單末端

- 規則:內建 `claude-api:opus-5.5`／`sonnet-5.5`／`haiku-5.5`(kind `claude`,`extraArgs: [...CLAUDE_READONLY, ...CLAUDE_EFFORT]`)與 `anthropic:opus-5.5`／`sonnet-5.5`／`haiku-5.5`(kind `api-anthropic`,`effort: EFFORT`)共六條,`envVar` 一律 `'ANTHROPIC_KEYS'`(**任何條目的 `envVar` 不得為 `ANTHROPIC_API_KEY`**,以免使用端誤載入 `process.env` 使 Claude Code 全面改用 API 計費);模型寫完整 ID(`claude-opus-5-5`／`claude-sonnet-5-5`／`claude-haiku-5-5`,不加日期後綴);六條集中於清單末端(先 CLI 後 REST),全取遞補時最後才耗用 API 額度;思考強度 high:Opus 5.5 與 Haiku 5.5 之 API 預設為 medium,必須明給.
- 盤點指令:`Grep "envVar:" src/providers.mjs`;`Grep "ANTHROPIC_API_KEY" src/providers.mjs`——預期只在註解.
- 對應測試:`test/unit-providers.test.mjs`(六條 id／kind／model／envVar、無任何 `ANTHROPIC_API_KEY` envVar、六條位於末端、防寫白名單、思考強度 high 含 `api-anthropic` 之 `effort`)、`test/unit-resolveProviders.test.mjs`(缺 `ANTHROPIC_KEYS` 六條全 skipped 且 `ANTHROPIC_API_KEY` 不被當來源、有鑰展開含空白與尾逗號、`pick` 順序與 kind)、`test/unit-providersAnthropicEntries.test.mjs`(六條經 `resolveProviders`→`dispatchAiFallback` 之整合:REST 請求之金鑰、完整模型 ID、`effort: high`、標頭;游標前進;CLI 之 argv〔模型、白名單、`--effort high`〕、key 入子進程環境〔經遮蔽〕、父環境 `ANTHROPIC_AUTH_TOKEN` 被移除;缺 `ANTHROPIC_KEYS` 或只有 `ANTHROPIC_API_KEY` 時全 skipped).

### R-ANTHROPIC-4 CLI 帶 key:自「繼承之 `process.env`」移除父 Claude Code session 連結變數(2026-10-25,dispatch-run03)

- 現象(主控以 Claude Code 2.1.302 實測):呼叫端本身跑在 Claude Code 工作階段內(如 agent 派工)時,子 `claude` 繼承父 session 連結變數而**沿用父登入**,即使 `ANTHROPIC_API_KEY` 已注入,`apiKeySource` 仍為 `none`(實走訂閱額度).探測:全部繼承＋`ANTHROPIC_API_KEY`→`none`;移除繼承之 `CLAUDE_CODE_*`／`CLAUDE_AGENT_SDK_VERSION`／`CLAUDE_PID`／`CLAUDE_EFFORT` 後→`ANTHROPIC_API_KEY`(stderr 並出現 claude.ai connectors 因 `ANTHROPIC_API_KEY` 優先而停用之訊息).run02 之離線測試與 key 入子進程環境皆綠,卻抓不到此現象(假 CLI 的父環境無連結變數)——**教訓:憑證優先序類修正須以「呼叫端環境本身是 Claude Code 工作階段」為輸入軸之一**.
- 規則(`src/dispatchClaude.mjs` 之 `LINK_PREFIXES`／`LINK_NAMES`／`LINK_KEEP`／`isLinkVar`／`buildKeyEnv`):**僅 key 模式、僅作用於「繼承自 `process.env`」者、僅作用於該次子進程(不動 `process.env`)**.①移除:前綴 `CLAUDE_CODE_`、`CLAUDE_AGENT_SDK_`,完整名稱 `CLAUDECODE`、`CLAUDE_PID`、`CLAUDE_EFFORT`、`CLAUDE_JOB_DIR`(Windows 名稱不分大小寫);②保留(例外):`CLAUDE_CODE_GIT_BASH_PATH`;③**呼叫端以 `opt.env` 明確傳入者保留**(同名以呼叫端值為準;以「同名含大小寫已在 env 內」判定,值為 `undefined` 者維持移除;呼叫端以不同大小寫傳入者,execCli 於 Windows 視為同名覆蓋、非 Windows 為另一變數,皆為呼叫端值留存、繼承值移除);④憑證類(`CLAUDE_CODE_USE_*`、`CLAUDE_CODE_OAUTH_TOKEN` 等,R-ANTHROPIC-1)不適用③,連 `opt.env` 中者仍移除;⑤`CLAUDE_CONFIG_DIR` 不在前綴內,原樣繼承;⑥**未給／無效 key 時完全不處理**(行為與舊版相同).
- 為何用前綴而非窮舉:官方 env-vars 文件只載明這些變數「由 Claude Code 設定」(`CLAUDECODE`／`CLAUDE_CODE_CHILD_SESSION` 於子進程設為 1;`CLAUDE_CODE_MESSAGING_SOCKET`／`_TOKEN`「Set by Claude Code, not by you」;`CLAUDE_CODE_SESSION_ID`／`CLAUDE_PID`／`CLAUDE_EFFORT` 於 Bash／hook 子進程自動設定;`CLAUDE_JOB_DIR` 於背景 session),**未載明巢狀 session 如何沿用登入,亦未隔離元兇**;本套件未自行啟動真實 `claude` 探測(不得發真實請求),故前綴整批移除以涵蓋未知元兇與日後新增者.元兇可由實測腳本 `--bisect` 找出,屆時再收斂規則.
- 「整批移除 `CLAUDE_CODE_*` 會否誤刪必要變數」之判斷(依官方文件,**未實測**):文件列出的 `CLAUDE_CODE_*` 絕大多數為行為偏好(`TMPDIR`、`SHELL`、`USE_POWERSHELL_TOOL`、`EFFORT_LEVEL`、`SUBAGENT_MODEL`、`PLUGIN_*`、`DISABLE_NONESSENTIAL_TRAFFIC` 等),子進程缺之只是回到預設;唯一「缺了即可能無法啟動」者為 Windows 之 `CLAUDE_CODE_GIT_BASH_PATH`(Git Bash 不在 PATH 時用以定位),列為保留.要保留其他使用者設定者由 `opt.env` 傳入(README 與 JSDoc 已載明).mTLS／憑證類 `CLAUDE_CODE_*` 變數名未於本輪核實,故不列入保留(日後有需要加進 `LINK_KEEP`).
- 盤點指令:`Grep "LINK_PREFIXES|LINK_NAMES|LINK_KEEP|isLinkVar" src`——預期只在 `src/dispatchClaude.mjs`(定義、使用處各一);`Grep "CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDECODE" src --glob '!dispatchClaude.mjs'`——預期無新增處理(其餘僅註解、providers 條目文字與 `CLAUDE_CODE_USE_*` 憑證清單).
- 對應測試:`test/unit-dispatchClaudeKey.test.mjs` R08 共 10 條(給 key:十五個連結變數〔含前綴規則涵蓋之未知名稱 `CLAUDE_CODE_FUTURE_LINK_VAR`／`CLAUDE_AGENT_SDK_FUTURE_LINK_VAR`〕自繼承環境移除且 key 在;`process.env` 於呼叫後不變;非連結變數〔`CLAUDE_CONFIG_DIR`、保留清單之 `CLAUDE_CODE_GIT_BASH_PATH`、`FAKE_ENV`〕照常繼承;`opt.env` 明確傳入者〔含連結變數與同名覆蓋〕保留、其餘仍移除;傳入 `undefined` 維持移除;憑證類即使在 `opt.env` 仍移除而同前綴之 `CLAUDE_CODE_EFFORT_LEVEL` 保留;未給／無效 key〔undefined、null、空、123、{}、[]〕與未給 key 搭 `opt.env` 時連結變數原樣流入;Windows 不分大小寫〔小寫繼承移除、呼叫端小寫傳入者留其值〕;`dispatchAiFallback` 整條路徑).`withEnv` 改為逆序還原(Windows 同名不同大小寫鍵會互相覆蓋).
- 離線驗收:`agent-out/dispatch-run03-evidence/accept.mjs` 以假 `.env`、假 Anthropic 伺服器、模擬「元兇變數在場即 `none`」之假 claude 跑 `dispatch-run03-real-check.mjs`(含 `--control`、`--bisect`),13 項 PASS.
- 限制:本規則是令 key「有機會勝出」之必要修正,**未經真實 `claude` 實測**(待主控以 `dispatch-run03-real-check.mjs` 驗證 `apiKeySource` 轉為 `ANTHROPIC_API_KEY` 並核對 Console 用量);若實測仍為 `none`,元兇可能不在前綴範圍(如 `settings.json` 之 `env` 區塊、gateway 登入、`CLAUDE_CONFIG_DIR` 內之登入態),以 `--bisect` 與官方優先序再查.

### 變異驗證(2026-10-24;於 `./tmp` 副本逐一施加,須被測試抓到)

| # | 變異 | 抓到之測試 |
|---|---|---|
| M1 | key 未傳入子進程 | `unit-dispatchClaudeKey` R01、R02、R05–R07(7 failing) |
| M2 | CLI 結果不遮蔽 key | R05 等(3 failing) |
| M2b | CLI 只遮蔽精確 key、不遮蔽 `sk-ant-` 樣式 | R05、R07(3 failing) |
| M2c | REST 錯誤路徑不遮蔽 | `unit-dispatchApiAnthropic` 金鑰不外洩三情境(3 failing) |
| M3 | REST 缺 `anthropic-version` | 假伺服器把關令 23 條失敗 |
| M4／M4b | 未移除 `ANTHROPIC_AUTH_TOKEN`／`CLAUDE_CODE_USE_BEDROCK` | R02 兩條(各 2 failing) |
| M5 | REST 把 key 放 `Authorization` | 22 failing |
| M6 | `refusal` 當成功路徑(略過裁定) | 3 failing |
| M7 | `max_tokens` 截斷不裁定 | 2 failing |
| M8 | key 寫入 `process.env` | R04(1 failing) |
| M9 | key 進命令列參數 | R04 等(2 failing) |
| M10 | 遞補層不把 `refusal` 視為與金鑰無關 | skip-group 測試(1 failing) |
| M11 | 條目 `envVar` 改為 `ANTHROPIC_API_KEY` | providers／resolveProviders(3 failing) |
| M12 | 空字串／非字串 key 也啟用金鑰模式 | R03(1 failing) |
| M13 | `sk-ant-` 樣式遮蔽失效 | `unit-redactText`、R05、REST(5 failing) |
| M14 | REST 429 不被視為可重試 | 2 failing |
| M15 | `anthropic:haiku-5.5` 條目漏帶 `effort`(API 預設 medium) | `unit-providers`、`unit-providersAnthropicEntries`(2 failing) |
| M16 | `claude-api:sonnet-5.5` 條目漏帶 `--effort high` | 同上(2 failing) |
| M17 | REST 成功 `stdout` 不精確遮蔽(外審 #1) | `unit-dispatchApiAnthropic`(1 failing) |
| M18 | REST `validate` 例外註記不遮蔽(外審 #2) | 同上(1 failing) |
| M19 | REST 啟動前 params 訊息不遮蔽(外審 #3) | 同上(1 failing) |
| M20 | REST 非 JSON 診斷不遮蔽回應標頭值(外審 #4) | 同上(1 failing) |
| M21 | CLI 不包 `onStdout`／`onStderr` 遮蔽器(外審 #5) | `unit-dispatchClaudeKey`(1 failing) |
| M22 | CLI 不檢查 key 含 NUL(外審 #6) | 同上(1 failing) |
| M23 | 串流遮蔽器無尾端保留 | `unit-redactText`、`unit-dispatchClaudeKey`(3 failing) |
| M24 | REST 錯誤路徑只精確遮蔽、不遮蔽 `sk-ant-` 樣式(外審 #8) | `unit-dispatchApiAnthropic`(1 failing;集合外金鑰測試) |
| M25 | 不移除繼承之連結變數(僅設 key,同 run02) | `unit-dispatchClaudeKey` R08(5 failing) |
| M26 | 連結變數連呼叫端 `opt.env` 明確傳入者也移除 | R08(3 failing) |
| M27 | 保留清單失效(`CLAUDE_CODE_GIT_BASH_PATH` 被移除) | R08(1 failing) |
| M28 | 未給 key 時也移除連結變數 | R08(2 failing) |
| M29 | 只認完整名稱、無前綴規則 | R08(4 failing) |
| M30 | 前綴過寬(`CLAUDE_`,誤刪 `CLAUDE_CONFIG_DIR`) | R08(1 failing) |
| M31 | 名稱比對區分大小寫(Windows) | R08(1 failing;僅 win32 有效) |
| M32 | 以空字串取代移除(變數仍存在) | R08(5 failing) |
| M33 | 移除時順手刪本進程 `process.env` | R08(1 failing) |
| M34～M37 | 完整名稱清單各漏一個:`CLAUDECODE`／`CLAUDE_PID`／`CLAUDE_EFFORT`／`CLAUDE_JOB_DIR` | R08(各 3～4 failing) |
| M38／M39 | 前綴各漏一個:`CLAUDE_AGENT_SDK_`／`CLAUDE_CODE_` | R08(3／4 failing) |
| M40 | 移除範圍擴到非連結變數(以 `FAKE_ENV` 代表) | R08(1 failing) |

run03 以 `tmp/dispatch-run03/mutate.mjs`(沿用 run02 版,證據副本在 `agent-out/dispatch-run03-evidence/`)重跑全部 43 個變異(M1～M40 含 M2b／M2c／M4b)——全數 KILLED,不變異對照 109 passing 全綠.

修前紅:`git archive HEAD` 之 `src`／`test` 疊上本輪新增與改動之測試檔,逐檔重跑——`unit-dispatchClaudeKey` 4 passing／8 failing(passing 者為「未給 key 時行為不變」之 R03、R04 與未給 key 之 R05,即舊版即具之行為)、`unit-dispatchApiAnthropic`／`unit-adapters`／`unit-WDispatchAi` 模組不存在、`unit-redactText` 缺匯出、`unit-providers` 2 failing、`unit-resolveProviders` 1 failing、`unit-dispatchAi` 1 failing;`unit-dispatchClaude` 僅改一條測試標題,舊版亦綠(預期).

run03 修前紅:在 run02 源碼(未改 `dispatchClaude.mjs`)上先寫 R08 十條——5 條 failing(移除類:主案例、`opt.env` 明確傳入保留、`undefined` 維持移除、Windows 不分大小寫、`dispatchAiFallback` 整條路徑),5 條 passing(皆為「不得改變」之守門:`process.env` 不被動、非連結變數照常繼承、憑證類仍移除、未給／無效 key 與未給 key 搭 `opt.env` 時連結變數原樣流入);修後 28 passing(原 18＋R08 十條).

### 未驗證事項(不得發真實請求,由主控實測回填)

- `claude -p --output-format stream-json --verbose` 於給 key 時 `apiKeySource` 實際為 `ANTHROPIC_API_KEY`;`--effort high` 對 `claude-haiku-5-5`／`claude-sonnet-5-5` 之接受度(Claude Code 2.1.302).**run02 實測(主控):在 Claude Code 工作階段內為 `none`**(成因與 R-ANTHROPIC-4 的修正見上);run03 修正後待主控以 `dispatch-run03-real-check.mjs` 複測——哪個連結變數是元兇仍未隔離(`--bisect` 可找).
- 真實 Messages API 對本轉接器請求之回應(含 `claude-haiku-5-5` 於 `effort: high`、`max_tokens: 16000` 之接受度);額度不足之真實錯誤字樣(第三方回報為 400「Your credit balance is too low to access the Anthropic API」,官方碼表另有 402 `billing_error`).
- CLI 類限流字樣之 `coolDetect` 簽章(README 僅示範,未實測).

### 文件同步點(改上列規則時一併改)

README:Functions 表、Options only for dispatchClaude(`key`)、Options only for dispatchApiAnthropic、「Claude以API金鑰計費」(含「在 Claude Code 工作階段內呼叫時:繼承之父 session 連結變數」)、Choosing CLI or API 表、providers.mjs 段、行為變更紀錄第 40–46 條;`src/adapters.mjs` 檔頭(選型判準)、`src/dispatchClaude.mjs`(檔頭【key模式——繼承之父session連結變數】與 JSDoc)與 `src/dispatchApiAnthropic.mjs` 檔頭、`src/providers.mjs` 檔頭與條目註解、`src/getErrorType.mjs` errorType 一覽(`refusal`、`incomplete` 補述)、`src/dispatchAiFallback.mjs`(失敗分流與 `keys` 說明)、`src/redactText.mjs`.

### 驗證指令

- `node C:/opensrcOper/tools/quiet-run.mjs --lock --name <名> -- npx mocha --parallel "test/*.test.mjs" --timeout 180000`(全套約 45 秒,2026-10-25:run02 為 516 passing,run03 加 R08 十條後 526 passing).
- 本輪新增或改動之測試:`test/unit-dispatchClaudeKey`、`unit-dispatchApiAnthropic`、`unit-redactText`、`unit-providersAnthropicEntries`、`unit-providers`、`unit-resolveProviders`、`unit-adapters`、`unit-WDispatchAi`、`unit-dispatchAi`、`unit-dispatchClaude`.
