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
// 【使用方式】
//   import providers from 'w-dispatch-ai/src/providers.mjs'
//   import resolveProviders from 'w-dispatch-ai/src/resolveProviders.mjs'
//   process.loadEnvFile('./.env') //OPENCODE_KEYS/AGNES_KEYS/POOLSIDE_KEYS, 逗號分隔多把
//   let { providers: ps, table, skipped } = resolveProviders(providers) //全取
//   let r2 = resolveProviders(providers, { pick: ['agnes:agnes-2.5-flash', 'claude:sonnet'] }) //自選, pick順序即遞補優先序
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
    {
        id: 'zen:deepseek-v4-flash-free',
        model: 'deepseek-v4-flash-free',
        kind: 'api-openai-compat',
        envVar: 'OPENCODE_KEYS',
        baseURL: 'https://opencode.ai/zen/v1',
        body: { max_tokens: 8192 },
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
