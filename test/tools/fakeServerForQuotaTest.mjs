import http from 'http'


// fakeServerForQuotaTest.mjs — 額度查詢用之假HTTP伺服器
//
// 三個額度轉接器之REST路徑分別打Anthropic之/api/oauth/usage(+/profile)與chatgpt.com之
// /backend-api/wham/usage; 其可觀察行為為「送了什麼標頭、如何處理各種狀態碼與回應形狀」,
// 故起本機伺服器依路徑與Authorization權杖決定回應, 令getQuotaClaude/getQuotaCodex/fetchQuotaJson
// 可離線逐條斷言, 不依賴真帳號與網路。回應fixture形狀取自2026-09-05本機實測之真實回應。
//
// 【行為路由(依Bearer權杖)】對所有路徑一致:
//   tok-ok        — 200, 依路徑回對應fixture
//   tok-401       — 401 {error:{type:'authentication_error'}}
//   tok-403-org   — 403, 本文含oauth_not_allowed_for_organization
//   tok-429       — 429
//   tok-500       — 500
//   tok-notjson   — 200但本體非JSON
//   tok-slow      — 延遲10秒(逾時路徑用)
//   tok-big       — 200但本體約2MB(toolarge路徑用)
//   tok-echo      — 200, 回{ headers }(斷言送出之標頭用)
//   tok-legacy    — 200, claude usage僅有頂層舊欄位(無limits[], 回退路徑用)
//   其他/無權杖   — 401


//claude之/api/oauth/usage回應fixture(新結構limits[]+頂層舊欄位並存, 實測形狀)
let FIXTURE_CLAUDE_USAGE = {
    five_hour: { utilization: 3, resets_at: '2099-01-01T05:00:00.000Z' },
    seven_day: { utilization: 13, resets_at: '2099-01-03T00:00:00.000Z' },
    seven_day_opus: { utilization: 0, resets_at: '2099-01-03T00:00:00.000Z' },
    limits: [
        { kind: 'session', group: 'session', percent: 3, severity: 'normal', resets_at: '2099-01-01T05:00:00.000Z', scope: null, is_active: false },
        { kind: 'weekly_all', group: 'weekly', percent: 13, severity: 'normal', resets_at: '2099-01-03T00:00:00.000Z', scope: null, is_active: false },
        { kind: 'weekly_scoped', group: 'weekly', percent: 15, severity: 'normal', resets_at: '2099-01-03T00:00:00.000Z', scope: { model: { display_name: 'Fable' }, surface: null }, is_active: true },
    ],
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
    spend: { used: { amount_minor: 0, currency: 'USD' }, percent: 0 },
}


//claude之/api/oauth/usage僅頂層舊欄位之fixture(回退路徑用)
let FIXTURE_CLAUDE_USAGE_LEGACY = {
    five_hour: { utilization: 42, resets_at: '2099-01-01T05:00:00.000Z' },
    seven_day: { utilization: 7, resets_at: '2099-01-03T00:00:00.000Z' },
    seven_day_sonnet: { utilization: 1, resets_at: '2099-01-03T00:00:00.000Z' },
}


//claude之/api/oauth/profile回應fixture
let FIXTURE_CLAUDE_PROFILE = {
    account: { email: 'profile-user@example.com', full_name: 'Profile User' },
}


//codex之/backend-api/wham/usage回應fixture(實測形狀, additional_rate_limits取自同類工具fixture)
let FIXTURE_CODEX_USAGE = {
    email: 'codex-user@example.com',
    plan_type: 'plus',
    rate_limit: {
        primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_after_seconds: 17999, reset_at: 4102444800 },
        secondary_window: { used_percent: 31, limit_window_seconds: 604800, reset_after_seconds: 501107, reset_at: 4102444800 },
    },
    code_review_rate_limit: {
        primary_window: { used_percent: 5, limit_window_seconds: 18000, reset_after_seconds: 1000 },
    },
    additional_rate_limits: [
        { limit_name: 'codex-spark', display_name: 'GPT-5.3-Codex-Spark', primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_after_seconds: 500 } },
    ],
    credits: { has_credits: false, unlimited: false, balance: '0' },
    rate_limit_reset_credits: { available_count: 1 },
    spend_control: { reached: false, individual_limit: null },
    rate_limit_reached_type: null,
}


/**
 * 啟動額度查詢用之假HTTP伺服器
 *
 * @returns {Promise} 回傳Promise，resolve回傳物件，內含port(埠號)、url(基底網址字串，如http://127.0.0.1:PORT)、usageUrlClaude、profileUrlClaude、usageUrlCodex(三個端點完整網址)、close(關閉伺服器之async函數)
 */
async function fakeServerForQuotaTest() {

    //sockets, 追蹤連線供close時強制斷開(避免keep-alive令close懸置)
    let sockets = new Set()

    let server = http.createServer((req, res) => {

        let auth = req.headers['authorization'] || ''
        let tok = auth.replace(/^Bearer\s+/i, '')
        let send = (code, obj) => {
            res.writeHead(code, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(obj))
        }

        //權杖行為
        if (tok === 'tok-401' || tok === '') {
            return send(401, { type: 'error', error: { type: 'authentication_error', message: 'OAuth token has expired.' } })
        }
        if (tok === 'tok-403-org') {
            return send(403, { type: 'error', error: { type: 'permission_error', message: 'oauth_not_allowed_for_organization' } })
        }
        if (tok === 'tok-429') {
            return send(429, { type: 'error', error: { type: 'rate_limit_error', message: 'Too many requests' } })
        }
        if (tok === 'tok-500') {
            return send(500, { type: 'error', error: { type: 'api_error', message: 'internal' } })
        }
        if (tok === 'tok-notjson') {
            res.writeHead(200, { 'Content-Type': 'text/plain' })
            return res.end('<html>not json</html>')
        }
        if (tok === 'tok-slow') {
            return setTimeout(() => send(200, FIXTURE_CLAUDE_USAGE), 10000)
        }
        if (tok === 'tok-big') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) }))
        }
        if (tok === 'tok-echo') {
            return send(200, { headers: req.headers })
        }
        if (tok !== 'tok-ok' && tok !== 'tok-legacy') {
            return send(401, { type: 'error', error: { type: 'authentication_error', message: 'Invalid token' } })
        }

        //路徑fixture
        if (req.url.endsWith('/api/oauth/usage')) {
            return send(200, tok === 'tok-legacy' ? FIXTURE_CLAUDE_USAGE_LEGACY : FIXTURE_CLAUDE_USAGE)
        }
        if (req.url.endsWith('/api/oauth/profile')) {
            return send(200, FIXTURE_CLAUDE_PROFILE)
        }
        if (req.url.endsWith('/backend-api/wham/usage')) {
            return send(200, FIXTURE_CODEX_USAGE)
        }
        return send(404, { error: { message: 'not found' } })
    })

    server.on('connection', (s) => {
        sockets.add(s)
        s.on('close', () => sockets.delete(s))
    })

    //listen於127.0.0.1動態埠
    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve)
    })
    let port = server.address().port
    let url = `http://127.0.0.1:${port}`

    let close = async () => {
        for (let s of sockets) {
            s.destroy()
        }
        await new Promise((resolve) => {
            server.close(resolve)
        })
    }

    return {
        port,
        url,
        usageUrlClaude: `${url}/api/oauth/usage`,
        profileUrlClaude: `${url}/api/oauth/profile`,
        usageUrlCodex: `${url}/backend-api/wham/usage`,
        close,
    }
}


export default fakeServerForQuotaTest
export { FIXTURE_CLAUDE_USAGE, FIXTURE_CLAUDE_USAGE_LEGACY, FIXTURE_CLAUDE_PROFILE, FIXTURE_CODEX_USAGE }
