import wdi from './src/WDispatchAi.mjs'


//由.env載入金鑰, OPENCODE_KEYS與AGNES_KEYS各以逗號分隔多把, 未提供時沿用各CLI既有登入狀態
try {
    process.loadEnvFile('./.env')
}
catch {}
let opencodeKeys = (process.env.OPENCODE_KEYS || '').split(',').filter(Boolean)
let agnesKeys = (process.env.AGNES_KEYS || '').split(',').filter(Boolean)


//agnes-ai為opencode未內建之第三方provider, 須另給其provider定義
let configAgnes = {
    provider: {
        'agnes-ai': {
            npm: '@ai-sdk/openai-compatible',
            name: 'Agnes',
            options: { baseURL: 'https://apihub.agnes-ai.com/v1' },
            models: { 'agnes-2.0-flash': { name: 'Agnes 2.0 Flash' } },
        },
    },
}


let test = async () => {

    //可用之AI供應商種類
    console.log('KINDS:', wdi.KINDS)
    // => KINDS: [ 'opencode', 'claude', 'codex', 'antigravity', 'api-openai-compat' ]

    let prompt = '請只回覆兩個字：完成，不要有任何其他文字'

    //以Claude Code CLI呼叫, 沿用CLI既有登入狀態
    let r1 = await wdi.dispatchClaude(prompt, { model: 'sonnet' })
    console.log('claude:', r1.ok, r1.stdout.trim())
    // => claude: true 完成

    //以Codex CLI呼叫, 可指定沙箱模式
    let r2 = await wdi.dispatchCodex(prompt, { model: 'gpt-5.6-luna', sandbox: 'read-only' })
    console.log('codex:', r2.ok, r2.stdout.trim())
    // => codex: true 完成

    //以opencode CLI呼叫, 未給key與provider即沿用CLI既有登入狀態
    let r3 = await wdi.dispatchOpencode(prompt, { model: 'opencode/deepseek-v4-flash-free', timeoutMs: 180000 })
    console.log('opencode:', r3.ok, r3.stdout.trim())
    // => opencode: true 完成

    //以antigravity CLI(agy)呼叫, prompt走--print旗標(長度上限30000字元), model須為`agy models`第一欄slug
    let r3b = await wdi.dispatchAntigravity(prompt, { model: 'gemini-3.6-flash-low' })
    console.log('antigravity:', r3b.ok, r3b.stdout.trim())
    // => antigravity: true 完成

    //以OpenAI相容API直呼(免CLI免登入), 給baseURL+key+model即可; Zen端點即opencode CLI之自家閘道
    let r3c = await wdi.dispatchApiOpenaiCompat(prompt, {
        baseURL: 'https://apihub.agnes-ai.com/v1',
        key: agnesKeys[0],
        model: 'agnes-2.0-flash',
    })
    console.log('api-openai-compat:', r3c.ok, r3c.code, r3c.stdout.trim())
    // => api-openai-compat: true 200 完成

    //以供應商條目輪替, 一個條目即一組(kind, model, 可選的key與provider與config), 輪到誰就用誰的CLI與模型
    //opencode支援逐次注入金鑰, 故同一provider之多把金鑰可各成一個條目
    let items = [
        { kind: 'claude', model: 'sonnet' },
        { kind: 'codex', model: 'gpt-5.6-luna', sandbox: 'read-only' },
        { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', key: opencodeKeys[0], timeoutMs: 180000 },
        { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', key: opencodeKeys[1], timeoutMs: 180000 },
        { kind: 'opencode', model: 'agnes-ai/agnes-2.0-flash', provider: 'agnes-ai', key: agnesKeys[0], config: configAgnes, timeoutMs: 180000 },
        { kind: 'antigravity', model: 'gemini-3.6-flash-low' },
    ]
    for (let item of items) {
        let r = await wdi.dispatchAi(item.kind, prompt, item)
        console.log('dispatchAi ' + item.model + ':', r.ok, r.stdout.trim())
        // => dispatchAi sonnet: true 完成
        // => dispatchAi gpt-5.6-luna: true 完成
        // => dispatchAi opencode/deepseek-v4-flash-free: true 完成
        // => dispatchAi opencode/deepseek-v4-flash-free: true 完成
        // => dispatchAi agnes-ai/agnes-2.0-flash: true 完成
        // => dispatchAi gemini-3.6-flash-low: true 完成
    }

    //未知供應商回傳error結果物件, 不會reject
    let r4 = await wdi.dispatchAi('gemini', prompt)
    console.log('invalid kind:', r4.ok, r4.error)
    // => invalid kind: false unknown ai kind: "gemini" (available: opencode, claude, codex, antigravity, api-openai-compat)

    //prompt非有效字串亦回傳error結果物件
    let r5 = await wdi.dispatchClaude('')
    console.log('invalid prompt:', r5.ok, r5.error)
    // => invalid prompt: false prompt must be a non-empty string

    //執行失敗時, 由ok、code、error與stderr判斷原因
    //REST路徑之錯誤依HTTP狀態碼分流(401金鑰無效、429限流、5xx服務端), 判別比CLI之stderr字串可靠
    let r6 = await wdi.dispatchApiOpenaiCompat(prompt, {
        baseURL: 'https://apihub.agnes-ai.com/v1',
        model: 'agnes-2.0-flash',
        key: 'sk-invalid-key',
    })
    console.log('invalid key:', r6.ok, r6.code, r6.error, r6.stderr.includes('无效的令牌'))
    // => invalid key: false 401 HTTP 401 true

    //多供應商自動遞補: providers順序即優先序, 組內keys以游標輪替
    //此例第1把金鑰無效 → 自動換組內下一把成功; 若整組用盡會遞補下一組, 依序往下
    //
    //【id命名】id為游標鍵與日誌標籤, 須區分到「模型」而非只到「廠商」——
    //  取'claude'則日後無法同時掛sonnet與opus, 且日誌看不出實際用了哪個模型;
    //  同一模型經不同路徑(REST／CLI／不同閘道)取得時額度池與故障域各自獨立,
    //  屬不同供應商, 故id須帶上路徑前綴加以區分
    let r7 = await wdi.dispatchAiFallback(prompt, {
        providers: [
            //REST版排前面: 免CLI、快3~5倍, 純文字任務優先走此路
            {
                id: 'api:agnes-2.0-flash',
                kind: 'api-openai-compat',
                baseURL: 'https://apihub.agnes-ai.com/v1',
                model: 'agnes-2.0-flash',
                keys: ['sk-invalid-key-demo', agnesKeys[0]], //第1把無效, 示範組內輪替
            },
            //同一個agnes模型之CLI版: 有工具能力但較慢, 額度池亦不同, 屬另一個供應商
            {
                id: 'oc:agnes-ai/agnes-2.0-flash',
                kind: 'opencode',
                model: 'agnes-ai/agnes-2.0-flash',
                provider: 'agnes-ai',
                keys: agnesKeys,
                config: configAgnes, //第三方provider須另給定義
                timeoutMs: 180000,
            },
            { id: 'claude:sonnet', kind: 'claude', model: 'sonnet' },
            { id: 'codex:gpt-5.6-luna', kind: 'codex', model: 'gpt-5.6-luna', sandbox: 'read-only' },
            { id: 'agy:gemini-3.6-flash-low', kind: 'antigravity', model: 'gemini-3.6-flash-low' },
        ],
        budgetMs: 600000,
        onEvent: (ev) => console.log('  event:', ev.type, ev.keyId, ev.error || ''),
    })
    console.log('fallback:', r7.ok, r7.providerId, r7.keyIndex, r7.stdout.trim())
    console.log('tried:', r7.tried.map((x) => `${x.keyId}:${x.outcome}`).join(', '))
    // =>   event: try api:agnes-2.0-flash#0
    // =>   event: next-key api:agnes-2.0-flash#0 HTTP 401
    // =>   event: try api:agnes-2.0-flash#1
    // =>   event: ok api:agnes-2.0-flash#1
    // => fallback: true api:agnes-2.0-flash 1 完成
    // => tried: api:agnes-2.0-flash#0:next-key, api:agnes-2.0-flash#1:ok

}
await test()
    .catch((err) => {
        console.log(err)
    })


//node g.mjs
