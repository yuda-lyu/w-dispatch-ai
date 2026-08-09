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
    // => KINDS: [ 'opencode', 'claude', 'codex' ]

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

    //以供應商條目輪替, 一個條目即一組(kind, model, 可選的key與provider與config), 輪到誰就用誰的CLI與模型
    //opencode支援逐次注入金鑰, 故同一provider之多把金鑰可各成一個條目
    let items = [
        { kind: 'claude', model: 'sonnet' },
        { kind: 'codex', model: 'gpt-5.6-luna', sandbox: 'read-only' },
        { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', key: opencodeKeys[0], timeoutMs: 180000 },
        { kind: 'opencode', model: 'opencode/deepseek-v4-flash-free', provider: 'opencode', key: opencodeKeys[1], timeoutMs: 180000 },
        { kind: 'opencode', model: 'agnes-ai/agnes-2.0-flash', provider: 'agnes-ai', key: agnesKeys[0], config: configAgnes, timeoutMs: 180000 },
    ]
    for (let item of items) {
        let r = await wdi.dispatchAi(item.kind, prompt, item)
        console.log('dispatchAi ' + item.model + ':', r.ok, r.stdout.trim())
        // => dispatchAi sonnet: true 完成
        // => dispatchAi gpt-5.6-luna: true 完成
        // => dispatchAi opencode/deepseek-v4-flash-free: true 完成
        // => dispatchAi opencode/deepseek-v4-flash-free: true 完成
        // => dispatchAi agnes-ai/agnes-2.0-flash: true 完成
    }

    //未知供應商回傳error結果物件, 不會reject
    let r4 = await wdi.dispatchAi('gemini', prompt)
    console.log('invalid kind:', r4.ok, r4.error)
    // => invalid kind: false unknown ai kind: "gemini" (available: opencode, claude, codex)

    //prompt非有效字串亦回傳error結果物件
    let r5 = await wdi.dispatchClaude('')
    console.log('invalid prompt:', r5.ok, r5.error)
    // => invalid prompt: false prompt must be a non-empty string

    //CLI執行失敗時, 由ok、code、error與stderr判斷原因
    let r6 = await wdi.dispatchOpencode(prompt, {
        model: 'opencode/deepseek-v4-flash-free',
        provider: 'opencode',
        key: 'sk-invalid-key',
    })
    console.log('invalid key:', r6.ok, r6.code, r6.error, r6.stderr.includes('Invalid API key'))
    // => invalid key: false 1 Exit code 1 true

}
await test()
    .catch((err) => {
        console.log(err)
    })


//node g.mjs
