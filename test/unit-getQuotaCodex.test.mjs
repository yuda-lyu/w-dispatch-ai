import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import getQuotaCodex from '../src/quota/getQuotaCodex.mjs'
import fakeServerForQuotaTest from './tools/fakeServerForQuotaTest.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


//產物落test/tmp/(同fakeCliForTest慣例), 測試結束清除
let FD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tmp', 'quota-codex')


//假codex app-server: 一行一則JSON之RPC, 依MODE決定account/read之回應
//(模擬2026-09-05實測之真實形狀: account.type/email/planType; rateLimits含primary/secondary與byLimitId)
let codeAppServer = (mode) => `
import readline from 'readline'
let mode = '${mode}'
let rl = readline.createInterface({ input: process.stdin })
rl.on('line', (l) => {
    let m = null
    try {
        m = JSON.parse(l)
    }
    catch (e) {
        return
    }
    if (m.id === undefined) {
        return
    }
    let out = (result) => process.stdout.write(JSON.stringify({ id: m.id, result }) + '\\n')
    let err = (message) => process.stdout.write(JSON.stringify({ id: m.id, error: { code: -1, message } }) + '\\n')
    if (m.method === 'initialize') {
        return out({ userAgent: 'fake-codex' })
    }
    if (m.method === 'account/read') {
        if (mode === 'nologin') return out({ account: null })
        if (mode === 'apikey') return out({ account: { type: 'apikey' } })
        if (mode === 'rpcfail') return err('boom')
        return out({ account: { type: 'chatgpt', email: 'codex-user@example.com', planType: 'plus' } })
    }
    if (m.method === 'account/rateLimits/read') {
        return out({
            rateLimits: {
                limitId: 'codex', planType: 'plus',
                primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 4102444800 },
                secondary: { usedPercent: 31, windowDurationMins: 10080, resetsAt: 4102444800 },
                credits: { hasCredits: false, unlimited: false, balance: '0' },
            },
            rateLimitsByLimitId: {
                codex: {},
                'codex-spark': { limitName: 'GPT-5.3-Codex-Spark', primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 4102444800 } },
            },
            rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'c1', title: 'Reset' }] },
        })
    }
    err('unknown method ' + m.method)
})
rl.on('close', () => process.exit(0))
`


//以base64url組一枚不驗簽之JWT(僅供解出payload)
let mkJwt = (payload) => {
    let b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}


//建立假codexHome(auth.json)
let mkCodexHome = (name, auth) => {
    let fd = path.join(FD, name)
    fs.mkdirSync(fd, { recursive: true })
    if (auth !== null) {
        fs.writeFileSync(path.join(fd, 'auth.json'), JSON.stringify(auth), 'utf8')
    }
    return fd
}


describe('getQuotaCodex', function() {

    let svr = null
    let fakes = []
    let mkFake = (mode) => {
        let f = createFakeCli(`fake-codex-${mode}`, codeAppServer(mode))
        fakes.push(f)
        return f.exe
    }

    before(async function() {
        svr = await fakeServerForQuotaTest()
        fs.mkdirSync(FD, { recursive: true })
    })

    after(async function() {
        if (svr) {
            await svr.close()
        }
        for (let f of fakes) {
            f.clean()
        }
        fs.rmSync(FD, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD))
        }
        catch (e) {}
    })

    it('app-server主路徑: 帳號與額度經JSON-RPC取得, byLimitId另列並略過與彙總同id者, severity對稱推導', async function() {
        let r = await getQuotaCodex('', { exe: mkFake('ok'), env: {}, timeoutMs: 20000 })
        let rr = [
            r.ok, r.matched, r.provider, r.email, r.plan, r.source,
            r.windows.map((w) => `${w.key}|${w.label}|${w.usedPercent}|${w.scope}|${w.severity}`),
            r.credits.resetCreditsAvailable,
            r.raw.accountType,
        ]
        assert.strict.deepEqual(rr, [
            true, null, 'codex', 'codex-user@example.com', 'plus', 'codex-app-server',
            ['primary|5小時|0||normal', 'secondary|7天|31||normal', 'codex-spark:primary|5小時(GPT-5.3-Codex-Spark)|12|GPT-5.3-Codex-Spark|normal'],
            1,
            'chatgpt',
        ])
    })

    it('app-server回報尚未登入(account為null)→notfound且不走備援(以notLoggedIn旗標判別, 非字串比對)', async function() {
        let codexHome = mkCodexHome('nologin', { tokens: { access_token: 'tok-ok' } })
        let r = await getQuotaCodex('', { exe: mkFake('nologin'), env: {}, codexHome, usageUrl: svr.usageUrlCodex, timeoutMs: 20000 })
        let rr = [r.ok, r.errorType, r.source, /codex login/.test(r.error)]
        assert.strict.deepEqual(rr, [false, 'notfound', 'codex-app-server', true])
    })

    it('app-server回報非chatgpt帳號型別(如apikey)→unsupported且不走備援', async function() {
        let codexHome = mkCodexHome('apikey-rpc', { tokens: { access_token: 'tok-ok' } })
        let r = await getQuotaCodex('', { exe: mkFake('apikey'), env: {}, codexHome, usageUrl: svr.usageUrlCodex, timeoutMs: 20000 })
        let rr = [r.ok, r.errorType, r.source, /\[apikey\]/.test(r.error)]
        assert.strict.deepEqual(rr, [false, 'unsupported', 'codex-app-server', true])
    })

    it('app-server之RPC失敗或exe不存在→退回HTTP備援, 成功時raw記錄app-server之錯誤', async function() {
        let codexHome = mkCodexHome('fallback', {
            auth_mode: 'chatgpt',
            tokens: { access_token: 'tok-ok', account_id: 'acct-123456', id_token: mkJwt({ 'email': 'jwt@example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' } }) },
        })
        let r1 = await getQuotaCodex('', { exe: mkFake('rpcfail'), env: {}, codexHome, usageUrl: svr.usageUrlCodex, timeoutMs: 20000 })
        let r2 = await getQuotaCodex('', { exe: 'codex-no-such-exe-xyz', env: {}, codexHome, usageUrl: svr.usageUrlCodex, timeoutMs: 20000 })
        let rr = [
            [r1.ok, r1.source, r1.email, r1.plan, r1.windows.length, /boom/.test(r1.raw.appServerError)],
            [r2.ok, r2.source, r2.raw.appServerError !== ''],
        ]
        //回應之email/plan為權威值(覆蓋id_token所解); fixture有主窗口2+code review1+additional1=4
        assert.strict.deepEqual(rr, [[true, 'chatgpt-wham-usage-api', 'codex-user@example.com', 'plus', 4, true], [true, 'chatgpt-wham-usage-api', true]])
    })

    it('fallbackHttp為false時app-server失敗即回報, 不打備援', async function() {
        let r = await getQuotaCodex('', { exe: mkFake('rpcfail'), env: {}, fallbackHttp: false, usageUrl: svr.usageUrlCodex, timeoutMs: 20000 })
        let rr = [r.ok, r.source, r.errorType]
        assert.strict.deepEqual(rr, [false, 'codex-app-server', 'rpc'])
    })

    it('HTTP備援(useAppServer:false): 憑證不存在→notfound; API key模式→unsupported; 401→auth附刷新指引', async function() {
        let h1 = mkCodexHome('nocred', null)
        let h2 = mkCodexHome('apikey-http', { OPENAI_API_KEY: 'sk-xxx' })
        let h3 = mkCodexHome('expired', { tokens: { access_token: 'tok-401', id_token: mkJwt({ email: 'old@example.com' }) } })
        let o = { useAppServer: false, env: {}, usageUrl: svr.usageUrlCodex, timeoutMs: 5000 }
        let r1 = await getQuotaCodex('', { ...o, codexHome: h1 })
        let r2 = await getQuotaCodex('', { ...o, codexHome: h2 })
        let r3 = await getQuotaCodex('', { ...o, codexHome: h3 })
        let rr = [
            [r1.ok, r1.errorType, /auth\.json/.test(r1.error)],
            [r2.ok, r2.errorType, /API key mode/.test(r2.error)],
            [r3.ok, r3.errorType, r3.email, /run any codex command/.test(r3.error), /tok-401/.test(r3.error)],
        ]
        //401時仍以id_token指出本機綁定帳號; 錯誤訊息不外洩權杖
        assert.strict.deepEqual(rr, [[false, 'notfound', true], [false, 'unsupported', true], [false, 'auth', 'old@example.com', true, false]])
    })

    it('HTTP備援之env注入: OPENAI_API_KEY僅存在於env時亦判為API key模式', async function() {
        let codexHome = mkCodexHome('apikey-env', {})
        let r = await getQuotaCodex('', { useAppServer: false, env: { OPENAI_API_KEY: 'sk-yyy' }, codexHome, usageUrl: svr.usageUrlCodex, timeoutMs: 5000 })
        let rr = [r.ok, r.errorType]
        assert.strict.deepEqual(rr, [false, 'unsupported'])
    })

    it('帳號比對: 不符時ok為false、matched為false且額度仍回傳', async function() {
        let r = await getQuotaCodex('someone-else@example.com', { exe: mkFake('ok'), env: {}, timeoutMs: 20000 })
        let rr = [r.ok, r.matched, r.errorType, r.windows.length, /codex-user@example.com/.test(r.error)]
        assert.strict.deepEqual(rr, [false, false, 'account', 3, true])
    })

})
