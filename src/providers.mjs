// providers.mjs — 預設providers定義檔(實測可用之供應商條目, 開發端可直接全用或自選)
//
// 【性質】純資料檔, 不讀環境變數。金鑰以envVar間接引用(機密不落設定檔),
//   使用前須經resolveProviders展開(envVar → keys, 缺變數者自動停用並回報);
//   展開後之陣列可直接餵dispatchAiFallback, table可直接餵dispatchAiWkf。
//
// 【id命名】依「路徑:模型」規則(詳dispatchAiFallback.mjs檔頭之id設計規則):
//   oc:＝經opencode CLI(有工具、較慢) / agy:＝antigravity CLI / claude:/codex:＝訂閱登入態CLI
//   zen:/agnes:/poolside:＝REST直呼(免CLI免登入、快, 純文字生成)
//   同一模型之CLI版與REST版屬不同供應商(能力與額度池皆不同), 故各為一條。
//
// ══════════════════════════════════════════════════════════════════════════════
// 【OpenCode Zen 接入方式——動 zen:條目前必讀, 免得又把「打錯端點」誤判成「模型壞了」】
// ══════════════════════════════════════════════════════════════════════════════
//
//   權威來源(唯一, 有疑問先查它, 不要憑既有條目推論):
//     https://opencode.ai/docs/zh-tw/zen/   ← 內含「端點」章節之逐模型端點對照表
//     https://opencode.ai/zen/v1/models     ← 當前可用model id清單(需Bearer金鑰)
//
//   ★ 核心事實: zen「不是」單一OpenAI相容端點, 端點依模型家族而異 ★
//     依官方文件之端點欄(2026-09-03查證):
//       /zen/v1/chat/completions   @ai-sdk/openai-compatible  ← 本套件api-openai-compat僅支援此種
//         mimo-v2.5-free / ling-3.0-flash-fin-free / nemotron-3-ultra-free /
//         nemotron-3.5-lightning-free / big-pickle / glm-* / kimi-* / minimax-* / deepseek-v4-*
//       /zen/v1/responses          @ai-sdk/openai        (OpenAI Responses API, 非chat/completions)
//         muse-spark-1.2-contributor-free / muse-spark-1.3-contributor-free / GPT系 / Grok系
//       /zen/v1/messages           @ai-sdk/anthropic     Claude系 / Qwen系
//       /zen/v1/models/<model-id>  @ai-sdk/google        Gemini系
//
//   ★ 因此: 模型出現在/models清單 ≠ 可用kind:'api-openai-compat'收錄 ★
//     dispatchApiOpenaiCompat固定POST至<baseURL>/chat/completions(那是它的定義, 非bug),
//     對走/responses或/messages的模型必然失敗, 且失敗碼是HTTP 500(不是404/400),
//     極易被誤讀為「模型故障, 等一下就好」而反覆重試——實際上再等一年也不會通。
//     殷鑑(2026-09-03): muse-spark-1.2/1.3走/chat/completions連續10次500,
//     同金鑰同模型改打/responses立即200且正常作答;
//     且1.2於2026-08-21曾以/chat/completions實測3.9s成功——即opencode「事後改過路由」,
//     故「以前能用」不構成「現在該能用」的證據, 一律回頭查文件端點欄。
//
//   ★ 收錄zen:條目前之檢核(缺一不可) ★
//     ① 該model id在 /zen/v1/models 清單內;
//     ② 依官方文件端點欄挑對kind: /chat/completions → api-openai-compat;
//        /responses → api-openai-responses; /messages與/models/<id> 本套件尚無對應kind,
//        不得硬收為既有kind(必失敗), 需要時改收其opencode CLI版(oc:);
//     ③ 實測至少連續數次200(端點時斷時續者仍可收, 但須於條目註解記錄可用率, 見ling條)。
//
//   ★ 診斷流程(收到失敗時先分類, 不要直接歸咎模型) ★
//     HTTP 500  → 先驗端點: 查文件端點欄; 該走/responses卻打了/chat/completions即為此症。
//                 驗法: curl -X POST https://opencode.ai/zen/v1/responses \
//                        -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
//                        -d '{"model":"<id>","input":"hi"}'   → 200即證明是端點問題非模型問題
//     HTTP 503  → 上游時斷時續(server_error: Upstream request failed: Endpoint is unavailable),
//                 暫時性, 遞補層換家即可; 判別法: 同時段打另一免費模型作對照組。
//     HTTP 429  → 閘道容量型限流(FreeUsageLimitError), 與金鑰無關(換金鑰照樣429), 暫時性。
//     HTTP 401/400 → 額度/促銷結束或模型暫時下架(訊息如Free promotion has ended、
//                 Upstream request failed: Model is unavailable), 屬服務端狀態非設定錯誤。
//     任一碼皆非「條目寫錯」之證據——model id寫錯時閘道回的是其他4xx且訊息明指model。
//
//   ★ 走不通REST時的替代路徑: 同模型改用oc:(opencode CLI) ★
//     opencode CLI內建各模型正確的端點與AI SDK, 故REST不通的模型走CLI往往正常
//     (實測: muse-spark 1.2/1.3之REST 500而CLI皆秒級成功)。CLI版模型id為
//     `opencode/<model-id>`, 可用 `opencode models` 列出; 兩者屬不同供應商條目(見id命名)。
//
// 【zen免費模型清單為「更新日快照」, 不保證即為當前狀態】zen:系收錄截至2026-08-21
//   經GET https://opencode.ai/zen/v1/models 查得之免費模型(*-free), 不做好用篩選——
//   新模型會上線、舊模型可能下架或限流, 且各模型能力/速度/輸出習慣差異極大
//   (各條目註解記錄已測特性), 由呼叫端自行評估選用; 要查當前清單, 以OPENCODE_KEYS
//   打上述/models端點即可。暫時打不通的條目(限流/額度/上游中斷)依本套件哲學保留不移除:
//   恢復的偵測就是下次再打一次, 代價僅一次快速失敗(fallback/cooldownMs即為此而生);
//   但「端點種類不符」(如上述muse-spark走/responses)屬結構性錯配而非暫時失敗, 不適用此哲學。
//   2026-09-03複查之漂移: 新增muse-spark-1.3-contributor-free(端點為/responses,
//   同日新增api-openai-responses轉接器後已收錄zen:版, 另亦收其opencode CLI版)
//   與ling-3.0-flash-fin-free(已收錄, 上游時斷時續詳見該條); zen:x-preview-f-free與zen:hy3-free已自本檔移除——兩者同時滿足
//   「不在/models清單」與「實測回401」兩條件, 屬服務端已下架而非暫時限流(對照deepseek為
//   仍在清單之401/400故保留), 留著只會讓全取者每輪空耗兩次快速失敗。
//   註: zen:deepseek-v4-flash-free與zen:laguna-s-2.1-free未列於官方文件端點表
//   (文件僅列付費版deepseek-v4-flash/pro, laguna全無), 屬未文件化之免費變體,
//   端點種類係沿用實測結果(/chat/completions), 日後若失效須優先懷疑其端點已變。
//
// 【使用方式】
//   import providers from 'w-dispatch-ai/src/providers.mjs'
//   import resolveProviders from 'w-dispatch-ai/src/resolveProviders.mjs'
//   import readEnvFile from 'w-dispatch-ai/src/readEnvFile.mjs'
//   let env = readEnvFile('./.env') //OPENCODE_KEYS/AGNES_KEYS/POOLSIDE_KEYS, 逗號分隔多把; 不污染process.env
//   let { providers: ps, table, skipped } = resolveProviders(providers, { env }) //全取
//   let r2 = resolveProviders(providers, { env, pick: ['agnes:agnes-2.5-flash', 'claude:sonnet'] }) //自選, pick順序即遞補優先序
//
// 【timeout規劃】各條目刻意不帶timeoutMs, 由上層依任務型態統一給定、條目僅於特例覆寫:
//   簡單任務(秒級~分鐘級): 沿用套件統一預設即可(全轉接器一律300000＝5分鐘, 見dfTimeoutMs.mjs)。
//   複雜任務(單一AI工作約15分鐘、fallback須能走到最末):
//     timeoutMs:    1200000 (20min＝15min工作＋33%餘裕, 單次嘗試上限)
//     minAttemptMs: 1200000 (剩餘預算不足完整視窗即不開工——開了也不可能完成, 純浪費)
//     budgetMs:     鏈長K×timeoutMs (逾時型失敗每組只燒一次timeout即跳組, 故K×20min
//                   保證能走到最末; 例K=4 → 4800000＝80min。無外部排程時限則可null＝不限)
//     agy之printTimeout由timeoutMs自動推導(−30s), 無須另設。
//   工作流層總時長: RolePipeline為各階段序列相加(M階段≈M×名額預算);
//   Fanout各名額並行(≈單一名額預算＋整合名額預算), 外部排程上限須據此預留。
//   外部調整四層(細者覆蓋粗者): dispatchAiWkf之defaults(全域) → 各工作流callOpt
//   → 各階段/名額規格 → 各provider條目。


let providers = [

    //cli版
    {
        id: 'oc:agnes-ai/agnes-2.5-flash',
        model: 'agnes-ai/agnes-2.5-flash',
        kind: 'opencode',
        envVar: 'AGNES_KEYS',
        provider: 'agnes-ai',
        config: {
            provider: {
                'agnes-ai': {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'Agnes',
                    options: { baseURL: 'https://apihub.agnes-ai.com/v1' },
                    models: { 'agnes-2.5-flash': { name: 'Agnes 2.5 Flash' } },
                },
            },
            permission: { edit: 'deny', write: 'deny', bash: 'deny' },
        },
    },
    {
        id: 'oc:poolside/poolside/laguna-s-2.1',
        model: 'poolside/poolside/laguna-s-2.1',
        kind: 'opencode',
        envVar: 'POOLSIDE_KEYS',
        provider: 'poolside',
        config: {
            provider: {
                'poolside': {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'Poolside',
                    options: { baseURL: 'https://inference.poolside.ai/v1' },
                    models: { 'poolside/laguna-s-2.1': { name: 'Laguna S 2.1' } },
                },
            },
            permission: { edit: 'deny', write: 'deny', bash: 'deny' },
        },
    },
    {
        id: 'oc:opencode/muse-spark-1.2-contributor-free',
        model: 'opencode/muse-spark-1.2-contributor-free',
        kind: 'opencode',
        envVar: 'OPENCODE_KEYS',
        provider: 'opencode',
        config: {
            permission: { edit: 'deny', write: 'deny', bash: 'deny' },
        },
        //2026-09-03實測8.1s(opencode CLI 1.18.27); 同模型另有zen:REST版, 額度池與故障域各自獨立
    },
    {
        id: 'oc:opencode/muse-spark-1.3-contributor-free',
        model: 'opencode/muse-spark-1.3-contributor-free',
        kind: 'opencode',
        envVar: 'OPENCODE_KEYS',
        provider: 'opencode',
        config: {
            permission: { edit: 'deny', write: 'deny', bash: 'deny' },
        },
        //2026-09-03實測6.1s(opencode CLI 1.18.27)。註: 同日同模型走zen REST回HTTP 500,
        //僅CLI路徑可用——同模型不同路徑屬不同供應商之實例(故未增zen:對應條目)
    },
    {
        id: 'oc:opencode/deepseek-v4-flash-free',
        model: 'opencode/deepseek-v4-flash-free',
        kind: 'opencode',
        envVar: 'OPENCODE_KEYS',
        provider: 'opencode',
        config: {
            permission: { edit: 'deny', write: 'deny', bash: 'deny' },
        },
        //2026-08-21實測失敗(UnknownError, 與zen:deepseek同日之401同源); 保留理由見該條註記
    },
    {
        id: 'agy:gemini-3.8-flash-high',
        model: 'gemini-3.8-flash-high', //2026-09-03自3.7升版(agy 1.1.25): 實測12.5s vs 3.7之62.2s, 讀檔14.6s vs 57.6s
        kind: 'antigravity',
        addDirs: ['.'],
        //保留CLI權限閘門(條目自帶防寫, 與其餘三家CLI條目一致): canary實測(2026-08-15)
        //無此鎖時要求建檔會真的落地(12.5s); false之下寫入被擋且不卡逾時(6.4s正常返回)、
        //唯讀工具照常(8.0s讀檔答對)。注意被擋時agy回ok:true且stdout為空(靜默拒絕非報錯),
        //工作流層無害(空回覆過不了validate而自動遞補); 需要寫入能力請於條目覆寫為true
        skipPermissions: false,
    },
    {
        id: 'claude:sonnet',
        model: 'sonnet',
        kind: 'claude',
        extraArgs: ['--disallowedTools', 'Write,Edit,NotebookEdit,Bash'],
    },
    {
        id: 'codex:gpt-5.6-luna',
        model: 'gpt-5.6-luna',
        kind: 'codex',
        sandbox: 'read-only',
    },

    //api版
    //zen:系為2026-08-21快照(檔頭聲明), 各條註記當日以「請只回覆兩個字：完成」實測之結果
    {
        id: 'agnes:agnes-2.5-flash',
        model: 'agnes-2.5-flash',
        kind: 'api-openai-compat',
        envVar: 'AGNES_KEYS',
        baseURL: 'https://apihub.agnes-ai.com/v1',
        body: { max_tokens: 8192 },
    },
    {
        id: 'poolside:laguna-s-2.1',
        model: 'poolside/laguna-s-2.1',
        kind: 'api-openai-compat',
        envVar: 'POOLSIDE_KEYS',
        baseURL: 'https://inference.poolside.ai/v1',
        body: {
            max_tokens: 8192,
            chat_template_kwargs: { enable_thinking: false },
        },
    },
    {
        id: 'zen:laguna-s-2.1-free',
        model: 'laguna-s-2.1-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-08-21實測4.0s; 同一laguna之第三條路(Poolside官方REST/oc CLI/zen), 三者故障域獨立
    },
    {
        id: 'zen:muse-spark-1.2-contributor-free',
        model: 'muse-spark-1.2-contributor-free',
        kind: 'api-openai-responses',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_output_tokens: 8192 },
        //端點為/responses(官方文件端點欄), 故kind為api-openai-responses而非api-openai-compat:
        //2026-08-21曾以/chat/completions實測3.9s成功, 2026-09-03同路徑連續500——opencode事後改過路由,
        //改打/responses即200。此即檔頭「端點依模型家族而異」之實例
        //2026-09-03實測ok; 使用端回報批次涵蓋率100%、術語標準、內容密度高
    },
    {
        id: 'zen:muse-spark-1.3-contributor-free',
        model: 'muse-spark-1.3-contributor-free',
        kind: 'api-openai-responses',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_output_tokens: 8192 }, //Responses API之輸出上限欄位名(非max_tokens)
        //2026-09-03實測ok(同日以/chat/completions連續10次500, 改/responses立即200);
        //reasoning型模型, 實測output_tokens中多數為reasoning_tokens, 上限勿設過小否則status為incomplete
    },
    {
        id: 'zen:deepseek-v4-flash-free',
        model: 'deepseek-v4-flash-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-08-21實測回401(官方訊息: Free promotion has ended); opencode方案端仍列此模型,
        //判讀為用量壓力下之暫時狀態而保留, 恢復之偵測即下次再打
    },
    {
        id: 'zen:mimo-v2.5-free',
        model: 'mimo-v2.5-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-08-21實測連續429(FreeUsageLimitError, 容量型)——429證明閘道認得此id(寫錯會回其他4xx)
    },
    {
        id: 'zen:ling-3.0-flash-fin-free',
        model: 'ling-3.0-flash-fin-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-09-03實測: 上游時斷時續, 20次量測200者僅7次(且呈段落式: 連6次成功後連13次失敗),
        //失敗一律HTTP 503(server_error: Upstream request failed: Endpoint is unavailable),
        //同時段對照組nemotron 7/7正常, 故屬本模型上游而非閘道或金鑰問題;
        //503為暫時性且非金鑰相關, 遞補層會換下一家, 建議搭配cooldownMs降低重複踩中的成本
    },
    {
        id: 'zen:nemotron-3-ultra-free',
        model: 'nemotron-3-ultra-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-08-21實測2.2s; function calling協定實測可用(tool_calls格式標準, 但本套件api類不支援工具)
    },
    {
        id: 'zen:nemotron-3.5-lightning-free',
        model: 'nemotron-3.5-lightning-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-08-21實測27.4s——名為lightning實測卻最慢, timeout與批量規劃須留意
    },

]


export default providers
