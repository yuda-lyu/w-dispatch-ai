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
// 【zen免費模型清單為「更新日快照」, 不保證即為當前狀態】zen:系收錄截至2026-08-21
//   經GET https://opencode.ai/zen/v1/models 查得之「全部」免費模型(*-free), 不做好用篩選——
//   新模型會上線、舊模型可能下架或限流, 且各模型能力/速度/輸出習慣差異極大
//   (各條目註解記錄已測特性), 由呼叫端自行評估選用; 要查當前清單, 以OPENCODE_KEYS
//   打上述/models端點即可。暫時打不通的條目(限流/額度)依本套件哲學保留不移除:
//   恢復的偵測就是下次再打一次, 代價僅一次快速失敗(fallback/cooldownMs即為此而生)。
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
        id: 'agy:gemini-3.7-flash-high',
        model: 'gemini-3.7-flash-high',
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
        id: 'zen:laguna-s-2.1-free',
        model: 'laguna-s-2.1-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-08-21實測4.0s; 同一laguna之第三條路(Poolside官方REST/oc CLI/zen), 三者故障域獨立
    },
    {
        id: 'zen:x-preview-f-free',
        model: 'x-preview-f-free', //官方顯示名Ox Alpha Free
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-08-21實測2.4s; 使用端回報批次涵蓋率偏低(3篇輸入常只回1~2篇), 批次任務慎用
    },
    {
        id: 'zen:muse-spark-1.2-contributor-free',
        model: 'muse-spark-1.2-contributor-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-08-21實測3.9s; 使用端回報批次涵蓋率100%、術語標準、內容密度高
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
        id: 'zen:hy3-free',
        model: 'hy3-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
        //2026-08-21實測3.2s
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

]


export default providers
