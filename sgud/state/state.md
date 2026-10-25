# 現況(state)

本檔記本套件**目前已開發功能之最新狀態**;接續工作時先讀此檔,與規則帳本(`sgud/rule/rulebook.md` 索引 → 各 `rulebook_<類型>.md`)比對即知尚未做到者.只記現況,過程寫入經驗(`sgud/exp/experience.md`).

## 一、版本與未發布之改動

- 已發布:1.0.55(`99a33bc`,2026-10-20).
- **工作區未發布之改動**,下次發布時一併帶出(使用者指示「更新 w-dispatch-ai 等下次再發布」):
  - (2026-10-23,主控直辦)指引要求文件遷移為 sgud 配置(`CLAUDE_experience.md` → `sgud/exp/experience.md`、`CLAUDE_rulebook.md` → `sgud/rule/rulebook.md`;`.gitignore` 調整、新建 `.npmignore`);`src/providers.mjs`:`oc:opencode/beam-free` 加脈絡長度實測註記(完整 1,048,576,不覆寫)、`oc:opencode/nemotron-3.5-super-vl-free` 覆寫 `limit`(context 1000000、input 950000、output 131072)並加實測註記.
  - (2026-10-24～25,主控任務 20261024231618 之 dispatch-run01／run02)**Anthropic Console API 金鑰計費**:①`dispatchClaude` 新增選用 `key`(給了才以 API 金鑰計費:子進程環境設 `ANTHROPIC_API_KEY`、移除 `ANTHROPIC_AUTH_TOKEN`／`CLAUDE_CODE_USE_*`／`CLAUDE_CODE_OAUTH_TOKEN`／`ANTHROPIC_PROFILE`／`ANTHROPIC_FEDERATION_RULE_ID`,結果遮蔽 key;未給時行為不變);②新 kind `api-anthropic`(`src/dispatchApiAnthropic.mjs`,直呼 `POST /v1/messages`);③`redactText.mjs` 新增 `maskApiKeys`、`redactApiKeyText`;④`dispatchAiFallback`:`errorType === 'refusal'` 整組跳過;⑤`providers.mjs` 新增 6 條(`claude-api:`×3、`anthropic:`×3,`envVar: 'ANTHROPIC_KEYS'`,集中於清單末端);⑥`adapters`／`dispatchAi`／`WDispatchAi` 登錄新 kind;⑦README(Claude以API金鑰計費、Options only for dispatchApiAnthropic、行為變更紀錄第 40–45 條)、各檔頭與 JSDoc、`getErrorType.mjs` 一覽.
  - 2026-10-25 規則帳本依全域 sgud 規則拆檔(`rulebook.md` 只留索引;內容逐字搬移,節號與標題不變).
  - (2026-10-25,主控任務 20261024231618 之 dispatch-run03)**`dispatchClaude` 給 key 時移除繼承之父 Claude Code session 連結變數**:主控實測(Claude Code 2.1.302)在 Claude Code 工作階段內呼叫時,子 `claude` 因繼承 `CLAUDE_CODE_*`／`CLAUDE_AGENT_SDK_VERSION`／`CLAUDE_PID`／`CLAUDE_EFFORT` 等而沿用父登入,`apiKeySource=none`(run02 之 key 入環境本身正確,但被蓋過).修正:`buildKeyEnv` 自**繼承之 `process.env`** 移除前綴 `CLAUDE_CODE_`／`CLAUDE_AGENT_SDK_` 與完整名稱 `CLAUDECODE`／`CLAUDE_PID`／`CLAUDE_EFFORT`／`CLAUDE_JOB_DIR`(Windows 不分大小寫),保留 `CLAUDE_CODE_GIT_BASH_PATH`,**`opt.env` 明確傳入者保留**,**未給 key 時完全不動**;帳本 R-ANTHROPIC-4.README 補「在 Claude Code 工作階段內呼叫時」段與行為變更紀錄第 46 條.
- 驗證(2026-10-25):`npm test` 同款指令(`mocha --parallel "test/*.test.mjs"`)**526 passing**、0 failing(run02 為 516;run03 加 `unit-dispatchClaudeKey` R08 十條,該檔 28 passing);eslint 0 錯;43 個變異(M1～M40 含 M2b／M2c／M4b)全數被抓到,其中 run03 新增 M25～M40 共 16 個;run03 修前紅:R08 十條在 run02 源碼上 5 failing、5 passing(後者為「不得改變」守門).run02 之外審(sol＝gpt-6.1-sol max)11 條發現中 10 條已處理並補測試／變異／文件、1 條(#7 計費來源無聲切換)記為已知限制(見 `rulebook_anthropic.md` 與報告);離線驗收:run02 版 10 項 PASS,run03 版(`dispatch-run03-real-check.mjs` 對假 `.env`＋假伺服器＋模擬「元兇變數在場即 `none`」之假 claude,含 `--control`、`--bisect`)13 項 PASS.run03 本輪不派外審.
- **尚未驗證(受限不得發真實請求,待主控實測回填)**:真實 `claude` CLI 於給 key 時 init 事件 `apiKeySource` 為 `ANTHROPIC_API_KEY`(run02 實測在 Claude Code 工作階段內為 `none`,run03 已修,待以 `dispatch-run03-real-check.mjs` 複測;元兇變數未隔離,可加 `--bisect`)、`--effort high` 對三模型之接受度;真實 Messages API 對 `claude-haiku-5-5`／`effort`／`max_tokens` 之回應;額度不足之真實錯誤字樣與 CLI 類 `coolDetect` 簽章.

## 二、功能現況(對應帳本與測試)

| 功能 | 帳本 | 測試 |
|---|---|---|
| CLI 帶 `key` 以 API 金鑰計費 | `rulebook_anthropic.md` R-ANTHROPIC-1 | `test/unit-dispatchClaudeKey.test.mjs`(R01～R07) |
| CLI 帶 `key` 時移除繼承之父 Claude Code session 連結變數 | R-ANTHROPIC-4 | `test/unit-dispatchClaudeKey.test.mjs`(R08 十條) |
| kind `api-anthropic` | R-ANTHROPIC-2 | `test/unit-dispatchApiAnthropic.test.mjs`(假伺服器 `test/tools/fakeServerForAnthropicTest.mjs`) |
| 6 條計費條目與 `ANTHROPIC_KEYS` | R-ANTHROPIC-3 | `test/unit-providers.test.mjs`、`test/unit-resolveProviders.test.mjs`、`test/unit-providersAnthropicEntries.test.mjs`(條目經 resolveProviders→dispatchAiFallback 整合) |
| 遮蔽單一來源 | R-REDACT-1(`rulebook_spawn.md`)、R-ANTHROPIC-1 | `test/unit-redactText.test.mjs` |
| 子進程啟動分流、validate、注入函數、agy | `rulebook_spawn.md`／`rulebook_userfn.md`／`rulebook_agy.md` | 既有測試(全綠) |

## 三、已知待辦

- 主控實測後,依結果回填:`providers.mjs` 中 `claude-api:` 條目註解之「未實測」句、README「額度不足／限流之辨識」之 CLI 字樣;若 `apiKeySource` 不為 `ANTHROPIC_API_KEY`,依官方優先序查是否有未處理之憑證來源(`settings.json` 之 `env`、gateway 登入),並以 `dispatch-run03-real-check.mjs --bisect` 找出仍作祟之連結變數(不在前綴範圍者須加進 `LINK_PREFIXES`／`LINK_NAMES`;若是 mTLS 等必要變數誤被前綴吃掉,加進 `LINK_KEEP`).
- 若實測得知真正元兇只有少數變數,可收斂 `dispatchClaude.mjs` 之前綴規則(目前為保守整批移除);收斂前須保留 R08 之未知名稱測試意圖或同步改測試.
- `sgud/exp/experience.md` 約 24KB,尚未達約 30KB 之整理門檻.
