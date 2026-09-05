import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import getQuotaClaude from '../src/quota/getQuotaClaude.mjs'
import fakeServerForQuotaTest from './tools/fakeServerForQuotaTest.mjs'


//產物落test/tmp/(同fakeCliForTest慣例), 測試結束清除
let FD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tmp', 'quota-claude')


//建立一組假Claude設定目錄(憑證檔+帳號檔), 回傳目錄路徑
let mkConfigDir = (name, cred, conf) => {
    let fd = path.join(FD, name)
    fs.mkdirSync(fd, { recursive: true })
    if (cred !== null) {
        fs.writeFileSync(path.join(fd, '.credentials.json'), JSON.stringify(cred), 'utf8')
    }
    if (conf !== null) {
        fs.writeFileSync(path.join(fd, '.claude.json'), JSON.stringify(conf), 'utf8')
    }
    return fd
}


describe('getQuotaClaude', function() {

    let svr = null
    let base = null

    before(async function() {
        svr = await fakeServerForQuotaTest()
        fs.mkdirSync(FD, { recursive: true })
        //env注入空物件: 隔離本機之CLAUDE_CONFIG_DIR/CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_API_KEY
        base = { env: {}, usageUrl: svr.usageUrlClaude, profileUrl: svr.profileUrlClaude, timeoutMs: 5000 }
    })

    after(async function() {
        if (svr) {
            await svr.close()
        }
        fs.rmSync(FD, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD))
        }
        catch (e) {}
    })

    it('成功: 優先取limits[](含模型別週限額), plan/planTier取自憑證檔, email取自帳號檔', async function() {
        let configDir = mkConfigDir('ok',
            { claudeAiOauth: { accessToken: 'tok-ok', subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x', expiresAt: 4102444800000 } },
            { oauthAccount: { emailAddress: 'claude-user@example.com' } },
        )
        let r = await getQuotaClaude('', { ...base, configDir })
        let rr = [
            r.ok, r.matched, r.provider, r.email, r.plan, r.planTier, r.source,
            r.windows.map((w) => `${w.key}|${w.label}|${w.usedPercent}|${w.active}|${w.severity}`),
            r.raw.tokenSource,
            r.credits.spendCurrency,
        ]
        assert.strict.deepEqual(rr, [
            true, null, 'claude', 'claude-user@example.com', 'max', 'default_claude_max_20x', 'anthropic-oauth-usage-api',
            ['session|5小時|3|false|normal', 'weekly_all|7天|13|false|normal', 'weekly_scoped|7天(Fable)|15|true|normal'],
            'file',
            'USD',
        ])
    })

    it('帳號比對: 相符ok為true; 不符ok為false且matched為false但額度仍回傳', async function() {
        let configDir = mkConfigDir('match',
            { claudeAiOauth: { accessToken: 'tok-ok' } },
            { oauthAccount: { emailAddress: 'Claude-User@Example.com' } },
        )
        let r1 = await getQuotaClaude('claude-user@example.com', { ...base, configDir })
        let r2 = await getQuotaClaude('other@example.com', { ...base, configDir })
        let rr = [[r1.ok, r1.matched], [r2.ok, r2.matched, r2.errorType, r2.windows.length]]
        assert.strict.deepEqual(rr, [[true, true], [false, false, 'account', 3]])
    })

    it('無limits[]時回退頂層舊欄位(含模型別), 標籤由秒數推導', async function() {
        let configDir = mkConfigDir('legacy', { claudeAiOauth: { accessToken: 'tok-legacy' } }, { oauthAccount: { emailAddress: 'a@b.c' } })
        let r = await getQuotaClaude('', { ...base, configDir })
        let rr = r.windows.map((w) => `${w.key}|${w.label}|${w.usedPercent}|${w.scope}`)
        assert.strict.deepEqual(rr, ['five_hour|5小時|42|', 'seven_day|7天|7|', 'seven_day_sonnet|7天(Sonnet)|1|Sonnet'])
    })

    it('憑證不存在→notfound(訊息含檔案路徑與指引); 非訂閱模式環境變數→unsupported', async function() {
        let configDir = mkConfigDir('nocred', null, null)
        let r1 = await getQuotaClaude('', { ...base, configDir })
        let r2 = await getQuotaClaude('', { ...base, configDir, env: { ANTHROPIC_API_KEY: 'sk-ant-xxx' } })
        let rr = [
            [r1.ok, r1.errorType, r1.error.includes('.credentials.json'), r1.error.includes('claude auth login')],
            [r2.ok, r2.errorType, r2.error.includes('ANTHROPIC_API_KEY')],
        ]
        assert.strict.deepEqual(rr, [[false, 'notfound', true, true], [false, 'unsupported', true]])
    })

    it('權杖被拒(401)→auth, 訊息附本機到期時刻與「執行一次claude自行刷新、勿重新登入」指引', async function() {
        let configDir = mkConfigDir('expired', { claudeAiOauth: { accessToken: 'tok-401', expiresAt: 946684800000 } }, { oauthAccount: { emailAddress: 'a@b.c' } })
        let r = await getQuotaClaude('', { ...base, configDir })
        //錯誤訊息不得外洩權杖明文(redact於fetchQuotaJson層施作)
        let rr = [r.ok, r.errorType, /local recorded expiry: 2000-01-01/.test(r.error), /do NOT run claude auth login/.test(r.error), /tok-401/.test(r.error)]
        assert.strict.deepEqual(rr, [false, 'auth', true, true, false])
    })

    it('環境變數CLAUDE_CODE_OAUTH_TOKEN優先於憑證檔, 401時指引改為重新setup-token', async function() {
        let configDir = mkConfigDir('envtok', { claudeAiOauth: { accessToken: 'tok-ok' } }, { oauthAccount: { emailAddress: 'a@b.c' } })
        let r1 = await getQuotaClaude('', { ...base, configDir, env: { CLAUDE_CODE_OAUTH_TOKEN: 'tok-ok' } })
        let r2 = await getQuotaClaude('', { ...base, configDir, env: { CLAUDE_CODE_OAUTH_TOKEN: 'tok-401' } })
        let rr = [[r1.ok, r1.raw.tokenSource], [r2.ok, r2.errorType, /claude setup-token/.test(r2.error)]]
        assert.strict.deepEqual(rr, [[true, 'env'], [false, 'auth', true]])
    })

    it('帳號檔無email時改打profile端點取得(profileFallback), 關閉則email為空', async function() {
        let configDir = mkConfigDir('noemail', { claudeAiOauth: { accessToken: 'tok-ok' } }, {})
        let r1 = await getQuotaClaude('', { ...base, configDir })
        let r2 = await getQuotaClaude('', { ...base, configDir, profileFallback: false })
        let rr = [[r1.ok, r1.email], [r2.ok, r2.email]]
        assert.strict.deepEqual(rr, [[true, 'profile-user@example.com'], [true, '']])
    })

    it('403之oauth_not_allowed_for_organization附組織限制說明', async function() {
        let configDir = mkConfigDir('org', { claudeAiOauth: { accessToken: 'tok-403-org' } }, { oauthAccount: { emailAddress: 'a@b.c' } })
        let r = await getQuotaClaude('', { ...base, configDir })
        let rr = [r.ok, r.errorType, /organization disallows OAuth usage queries/.test(r.error)]
        assert.strict.deepEqual(rr, [false, 'forbidden', true])
    })

})
