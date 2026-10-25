# 現況(state)

本檔記本套件**目前已開發功能之最新狀態**;接續工作時先讀此檔,與規則帳本(`sgud/rule/rulebook.md` 索引 → 各 `rulebook_<類型>.md`)比對即知尚未做到者.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- 已發布:1.0.55(`99a33bc`,2026-10-20).
- **工作區未發布之改動**,下次發布時一併帶出(使用者指示「更新 w-dispatch-ai 等下次再發布」):
  - (2026-10-23,主控直辦)指引要求文件遷移為 sgud 配置(`CLAUDE_experience.md` → `sgud/exp/experience.md`、`CLAUDE_rulebook.md` → `sgud/rule/rulebook.md`;`.gitignore` 調整、新建 `.npmignore`);`src/providers.mjs`:`oc:opencode/beam-free` 加脈絡長度實測註記(完整 1,048,576,不覆寫)、`oc:opencode/nemotron-3.5-super-vl-free` 覆寫 `limit`(context 1000000、input 950000、output 131072)並加實測註記.
  - (2026-10-24～25,主控任務 20261024231618 之 dispatch-run01／run02)**Anthropic Console API 金鑰計費**:①`dispatchClaude` 新增選用 `key`(給了才以 API 金鑰計費:子進程環境設 `ANTHROPIC_API_KEY`、移除 `ANTHROPIC_AUTH_TOKEN`／`CLAUDE_CODE_USE_*`／`CLAUDE_CODE_OAUTH_TOKEN`／`ANTHROPIC_PROFILE`／`ANTHROPIC_FEDERATION_RULE_ID`,結果遮蔽 key;未給時行為不變);②新 kind `api-anthropic`(`src/dispatchApiAnthropic.mjs`,直呼 `POST /v1/messages`);③`redactText.mjs` 新增 `maskApiKeys`、`redactApiKeyText`;④`dispatchAiFallback`:`errorType === 'refusal'` 整組跳過;⑤`providers.mjs` 新增 6 條(`claude-api:`×3、`anthropic:`×3,`envVar: 'ANTHROPIC_KEYS'`,集中於清單末端);⑥`adapters`／`dispatchAi`／`WDispatchAi` 登錄新 kind;⑦README(Claude以API金鑰計費、Options only for dispatchApiAnthropic、行為變更紀錄第 40–45 條)、各檔頭與 JSDoc、`getErrorType.mjs` 一覽.
  - 2026-10-25 規則帳本依全域 sgud 規則拆檔(`rulebook.md` 只留索引;內容逐字搬移,節號與標題不變).
  - (2026-10-25,主控任務 20261024231618 之 dispatch-run03)**`dispatchClaude` 給 key 時移除繼承之父 Claude Code session 連結變數**:主控實測(Claude Code 2.1.302)在 Claude Code 工作階段內呼叫時,子 `claude` 因繼承 `CLAUDE_CODE_*`／`CLAUDE_AGENT_SDK_VERSION`／`CLAUDE_PID`／`CLAUDE_EFFORT` 等而沿用父登入,`apiKeySource=none`(run02 之 key 入環境本身正確,但被蓋過).修正:`buildKeyEnv` 自**繼承之 `process.env`** 移除前綴 `CLAUDE_CODE_`／`CLAUDE_AGENT_SDK_` 與完整名稱 `CLAUDECODE`／`CLAUDE_PID`／`CLAUDE_EFFORT`／`CLAUDE_JOB_DIR`(Windows 不分大小寫),保留 `CLAUDE_CODE_GIT_BASH_PATH`,**`opt.env` 明確傳入者保留**,**未給 key 時完全不動**;帳本 R-ANTHROPIC-4.README 補「在 Claude Code 工作階段內呼叫時」段與行為變更紀錄第 46 條.
  - (2026-10-25,主控任務 20261025112705 之 dispatch-run01 修正輪)**失敗細分類 `failureKind`、CLI「沒額度」REST 交叉確認、遞補依分類處置、金鑰探測、`*_KEYS` 分號處置**(帳本 `rulebook_failurekind.md` R-ANTHROPIC-5):①新 `src/failureKind.mjs`(單一來源:`classifyRestFailure`／`classifyCliFailure`),`api-anthropic` 全部失敗與 `claude` 在 API 金鑰在場(`key`，或 `opt.env.ANTHROPIC_API_KEY`)之失敗結果另帶 `failureKind`(`no-credit`／`context-too-long`／`rate-limit`／`overloaded`／`key-invalid`／`no-permission`／`network`／`env-error`／`other`)與 `failureDetail`，`errorType` 照舊;②`dispatchClaude`:新選項 `crossCheck`(預設 true)／`fetch`／`crossCheckBaseURL`／`crossCheckModel`，CLI 稱沒額度時以同金鑰 REST(`max_tokens: 1`，haiku)確認——REST 成功判 `env-error`，其他結果判 `other`;金鑰在場時另錄 stdout／stderr 尾段(execCli 失敗時 stdout 只留前 500 字元);③`dispatchApiAnthropic`:`failureKind`／`failureDetail`、選項 `fetch`;④`dispatchAiFallback`:脈絡過長立即結束整個呼叫(`CONTEXT_TOO_LONG`)、沒額度本次呼叫內跨條目略過(`skip-key`)／全組皆沒額度標 `quotaExhausted`／`cooldownMs>0` 時金鑰指紋冷卻(`store.keyCooling`)、網路與 `env-error` 整組跳過、`failureKind === 'rate-limit'` 納入內建冷卻觸發、`coolDetect` 與內建為「或」;⑤新匯出 `probeAnthropicKeys`(`src/probeAnthropicKeys.mjs`);⑥`resolveProviders`:`*_KEYS` 遇分號視同逗號並回報 `warnings`(新回傳鍵)，`splitSemicolon: false` 關閉(`src/splitKeys.mjs`);⑦`callAiWithFallback` 透傳 `failureKind`／`quotaExhausted`;⑧README(失敗細分類、交叉確認、遞補處置表、探測、分隔符、勿用 `--bare` 與 `env` 傳金鑰之重現紀錄、行為變更紀錄第 47–52 條)、各檔頭與 JSDoc、`getErrorType.mjs` 一覽、`providers.mjs` 註解.
- 驗證(2026-10-25):`npm test` 同款指令(`mocha --parallel "test/*.test.mjs"`)**526 passing**、0 failing(run02 為 516;run03 加 `unit-dispatchClaudeKey` R08 十條,該檔 28 passing);eslint 0 錯;43 個變異(M1～M40 含 M2b／M2c／M4b)全數被抓到,其中 run03 新增 M25～M40 共 16 個;run03 修前紅:R08 十條在 run02 源碼上 5 failing、5 passing(後者為「不得改變」守門).run02 之外審(sol＝gpt-6.1-sol max)11 條發現中 10 條已處理並補測試／變異／文件、1 條(#7 計費來源無聲切換)記為已知限制(見 `rulebook_anthropic.md` 與報告);離線驗收:run02 版 10 項 PASS,run03 版(`dispatch-run03-real-check.mjs` 對假 `.env`＋假伺服器＋模擬「元兇變數在場即 `none`」之假 claude,含 `--control`、`--bisect`)13 項 PASS.run03 本輪不派外審.
- 驗證(2026-10-25,dispatch-run01 修正輪,最終程式):全套 `mocha --parallel "test/*.test.mjs"` **772 passing**、0 failing(開工時 526;新增六個測試檔與假伺服器路由);eslint 0 錯;94 個變異(`tmp/dispatch-run01/mutate.mjs`,含任務書指定之 R1 脈絡過長仍換金鑰、R2 CLI 沒額度不交叉確認、R3 探測輸出含金鑰)全數被抓到;修前紅:`git archive HEAD src` 上新測試 111 failing／17 passing(passing 者皆為「不得改變」守門)、三檔 MODULE_NOT_FOUND;離線乾跑 `accept.mjs`(假 .env＋假伺服器＋假 claude)15+9 項 PASS;外審 sol 兩輪共 29 條(20＋9),25 條屬實或部分屬實並已修、餘為範圍外觀察／待實測;未發任何真實 Anthropic 請求、未讀任何 `.env`.
- **尚未驗證(受限不得發真實請求,待主控實測回填)**:真實 `claude` CLI 於給 key 時 init 事件 `apiKeySource` 為 `ANTHROPIC_API_KEY`(run02 實測在 Claude Code 工作階段內為 `none`,run03 已修,待以 `dispatch-run03-real-check.mjs` 複測;元兇變數未隔離,可加 `--bisect`)、`--effort high` 對三模型之接受度;真實 Messages API 對 `claude-haiku-5-5`／`effort`／`max_tokens` 之回應;額度不足之真實錯誤字樣與 CLI 類 `coolDetect` 簽章.

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 |
|---|---|---|
| CLI 帶 `key` 以 API 金鑰計費 | `rulebook_anthropic.md` R-ANTHROPIC-1 | `test/unit-dispatchClaudeKey.test.mjs`(R01～R07) |
| CLI 帶 `key` 時移除繼承之父 Claude Code session 連結變數 | R-ANTHROPIC-4 | `test/unit-dispatchClaudeKey.test.mjs`(R08 十條) |
| kind `api-anthropic` | R-ANTHROPIC-2 | `test/unit-dispatchApiAnthropic.test.mjs`(假伺服器 `test/tools/fakeServerForAnthropicTest.mjs`) |
| 6 條計費條目與 `ANTHROPIC_KEYS` | R-ANTHROPIC-3 | `test/unit-providers.test.mjs`、`test/unit-resolveProviders.test.mjs`、`test/unit-providersAnthropicEntries.test.mjs`(條目經 resolveProviders→dispatchAiFallback 整合) |
| 失敗細分類 `failureKind`(REST 與 CLI) | R-ANTHROPIC-5(R5.1～R5.3) | `test/unit-failureKind.test.mjs`、`test/unit-dispatchApiAnthropicFailureKind.test.mjs`、`test/unit-dispatchClaudeFailureKind.test.mjs` |
| CLI「沒額度」REST 交叉確認(預設開、`fetch` 可注入) | R-ANTHROPIC-5(R5.4) | `test/unit-dispatchClaudeFailureKind.test.mjs` |
| 遞補依 `failureKind` 處置(沒額度／脈絡過長／網路／`env-error`／限流冷卻／`coolDetect` 疊加) | R-ANTHROPIC-5(R5.5) | `test/unit-dispatchAiFallbackKinds.test.mjs` |
| 金鑰探測 `probeAnthropicKeys` | R-ANTHROPIC-5(R5.6) | `test/unit-probeAnthropicKeys.test.mjs`、`test/unit-WDispatchAi.test.mjs` |
| `*_KEYS` 分號視同逗號＋`warnings` | R-ANTHROPIC-5(R5.7) | `test/unit-resolveProvidersKeys.test.mjs` |
| 遮蔽單一來源 | R-REDACT-1(`rulebook_spawn.md`)、R-ANTHROPIC-1 | `test/unit-redactText.test.mjs` |
| 子進程啟動分流、validate、注入函數、agy | `rulebook_spawn.md`／`rulebook_userfn.md`／`rulebook_agy.md` | 既有測試(全綠) |

## 三、已知待辦

- **dispatch-run01 待主控實測回填**(不得發真實請求，故皆未驗證;腳本 `agent-out/dispatch-run01-evidence/dispatch-run01-real-check.mjs`):①真實 CLI 額度不足時之實際輸出(純文字或 stream-json 之 `assistant.error`／`api_error_status`)與離開碼(假設非零);②`max_tokens: 1` 對 `claude-haiku-5-5`(自適應思考)是否被接受(探測與交叉確認皆用);③「credit balance is too low」之真實 HTTP 碼與 `error.type`;④真實 `prompt is too long` 逐字格式(以 `claude-haiku-4-5`＋約 120 萬字元偽隨機詞便宜觸發，預期 400 拒收);⑤`env`＋`--bare` 之重現是否經交叉確認判為 `env-error`。回填後更新 R-ANTHROPIC-5 與 README「判定依據與未實測者」.
- 已知限制(不修):`stop_reason: model_context_window_exceeded`(HTTP 200，4.5 以後「輸入＋`max_tokens` 超過視窗」之行為)被視為未知 `stop_reason` 而成功(既有行為);較舊模型之驗證錯誤逐字訊息官方未載明，歸 `other`.

- 主控實測後,依結果回填:`providers.mjs` 中 `claude-api:` 條目註解之「未實測」句、README「額度不足／限流之辨識」之 CLI 字樣;若 `apiKeySource` 不為 `ANTHROPIC_API_KEY`,依官方優先序查是否有未處理之憑證來源(`settings.json` 之 `env`、gateway 登入),並以 `dispatch-run03-real-check.mjs --bisect` 找出仍作祟之連結變數(不在前綴範圍者須加進 `LINK_PREFIXES`／`LINK_NAMES`;若是 mTLS 等必要變數誤被前綴吃掉,加進 `LINK_KEEP`).
- 若實測得知真正元兇只有少數變數,可收斂 `dispatchClaude.mjs` 之前綴規則(目前為保守整批移除);收斂前須保留 R08 之未知名稱測試意圖或同步改測試.
- `sgud/exp/experience.md` 約 24KB,尚未達約 30KB 之整理門檻.
