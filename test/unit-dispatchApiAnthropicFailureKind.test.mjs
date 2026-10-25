import assert from 'assert'
import dispatchApiAnthropic from '../src/dispatchApiAnthropic.mjs'
import dispatchAi from '../src/dispatchAi.mjs'
import fakeServerForAnthropicTest from './tools/fakeServerForAnthropicTest.mjs'


// unit-dispatchApiAnthropicFailureKind.test.mjs — dispatchApiAnthropic失敗結果之failureKind細分類(2026-10-25 dispatch-run01)
//
// 規格來源: README「失敗細分類(failureKind)」表、帳本R-ANTHROPIC-5(sgud/rule/rulebook_failurekind.md)、src/failureKind.mjs檔頭:
//   官方errors頁(400/401/402/403/413/429/504/529與error.type)、rate-limits頁(自設花費上限=400「You have reached your specified … API usage limits」;
//   月花費上限=429且error.details.error_code為enforced_spend_limit_reached、無retry-after)、context-windows頁(輸入超過視窗=400「prompt is too long」)。
// 全部打本機假伺服器(或注入之fetch), 不發出任何Anthropic請求。


let KEY = 'sk-ant-api03-TESTKEY-AAAA1111BBBB2222cccc3333'


describe('dispatchApiAnthropic failureKind', function() {

    let srv = null

    before(async function() {
        srv = await fakeServerForAnthropicTest()
    })

    after(async function() {
        if (srv) {
            await srv.close()
        }
    })

    let call = (model, opt = {}) => dispatchApiAnthropic('abc', { baseURL: srv.url, key: KEY, model, ...opt })

    //每條: [假伺服器model路由, 預期failureKind, 預期code]
    let cases = [
        ['err-credit-400', 'no-credit', 400],
        ['err-spend-limit-400', 'no-credit', 400],
        ['err-spend-limit-ws-400', 'no-credit', 400],
        ['err-spend-cap-429', 'no-credit', 429], //429但為月花費上限, 不是一般限流
        ['err-402', 'no-credit', 402],
        ['err-context-400', 'context-too-long', 400],
        ['err-413', 'context-too-long', 413],
        ['err-429', 'rate-limit', 429],
        ['err-529', 'overloaded', 529],
        ['err-403', 'no-permission', 403],
        ['err-504', 'network', 504],
        ['err-400', 'other', 400],
        ['err-404', 'other', 404],
        ['err-500', 'other', 500],
    ]
    for (let [model, want, code] of cases) {
        it(`HTTP失敗 ${model} → failureKind ${want}(errorType照舊為http、code ${code})`, async function() {
            let t = await call(model)
            assert.strict.deepEqual([t.ok, t.errorType, t.code, t.failureKind], [false, 'http', code, want])
        })
    }

    it('401(無效金鑰)→ key-invalid', async function() {
        let t = await dispatchApiAnthropic('abc', { baseURL: srv.url, key: 'sk-bad-key-0000', model: 'ok' })
        assert.strict.deepEqual([t.ok, t.code, t.failureKind], [false, 401, 'key-invalid'])
    })

    it('401閘道HTML(無JSON本體)→ key-invalid(狀態碼即可判)', async function() {
        let t = await call('err-html-401')
        assert.strict.deepEqual([t.code, t.apiErrorType, t.failureKind], [401, '', 'key-invalid'])
    })

    it('failureDetail為API錯誤訊息(脈絡過長含token數；額度含原句)，不含金鑰', async function() {
        let a = await call('err-context-400')
        let b = await call('err-credit-400')
        assert.strict.deepEqual([a.failureDetail, b.failureDetail.startsWith('Your credit balance is too low')], ['prompt is too long: 250000 tokens > 200000 maximum', true])
    })

    it('errorType／error／apiErrorType／stderr維持1.0.56之樣子(failureKind為另加欄位)', async function() {
        let t = await call('err-context-400')
        assert.strict.deepEqual([t.errorType, t.error, t.apiErrorType, t.stderr.includes('prompt is too long')], ['http', 'HTTP 400', 'invalid_request_error', true])
    })

    it('failureDetail遮蔽訊息中回顯之金鑰', async function() {
        let t = await call('echo-key-error')
        assert.strict.deepEqual([t.failureKind, t.failureDetail.includes(KEY), t.failureDetail.includes('[REDACTED]')], ['other', false, true])
    })

    it('脈絡過長與額度不足(400)不重試，限流(429)與過載(529)依maxRetries重試', async function() {
        let r = []
        for (let model of ['err-context-400', 'err-credit-400', 'err-429', 'err-529']) {
            let t = await call(model, { maxRetries: 2, retryDelayMs: 1 })
            r.push([t.failureKind, t.attempts])
        }
        assert.strict.deepEqual(r, [['context-too-long', 1], ['no-credit', 1], ['rate-limit', 3], ['overloaded', 3]])
    })

    it('連線拒絕(已關閉之真實埠)→ network(errorType照舊fetch)', async function() {
        let s2 = await fakeServerForAnthropicTest()
        let closedUrl = s2.url
        await s2.close()
        let t = await dispatchApiAnthropic('abc', { baseURL: closedUrl, key: KEY, model: 'ok' })
        assert.strict.deepEqual([t.errorType, t.failureKind], ['fetch', 'network'])
    })

    it('逾時 → network(errorType照舊timeout)', async function() {
        let t = await call('slow', { timeoutMs: 300 })
        assert.strict.deepEqual([t.errorType, t.error, t.failureKind], ['timeout', 'TIMEOUT after 0.3s', 'network'])
    })

    it('截斷、拒答、工具、結構不合規、驗證失敗 → other(遞補層維持既有處置)', async function() {
        let r = []
        for (let model of ['max-tokens', 'refusal', 'tool-use', 'no-content', 'thinking-only', 'not-json']) {
            let t = await call(model)
            r.push([t.errorType, t.failureKind])
        }
        let v = await call('ok', { validate: () => false })
        r.push([v.errorType, v.failureKind])
        assert.strict.deepEqual(r, [
            ['incomplete', 'other'],
            ['refusal', 'other'],
            ['tool-unsupported', 'other'],
            ['invalid-response', 'other'],
            ['invalid-response', 'other'],
            ['invalid-response', 'other'],
            ['validation', 'other'],
        ])
    })

    it('參數檢核失敗(params)亦帶failureKind other', async function() {
        let a = await dispatchApiAnthropic('', { key: KEY, model: 'ok' })
        let b = await dispatchApiAnthropic('abc', { key: KEY })
        assert.strict.deepEqual([a.errorType, a.failureKind, b.errorType, b.failureKind], ['params', 'other', 'params', 'other'])
    })

    it('成功結果不帶failureKind與failureDetail', async function() {
        let t = await call('ok')
        assert.strict.deepEqual([t.ok, 'failureKind' in t, 'failureDetail' in t], [true, false, false])
    })

    it('經dispatchAi(kind: api-anthropic)同樣帶failureKind', async function() {
        let t = await dispatchAi('api-anthropic', 'abc', { baseURL: srv.url, key: KEY, model: 'err-credit-400' })
        assert.strict.equal(t.failureKind, 'no-credit')
    })

    it('opt.fetch可注入: 呼叫的是注入的函數(收到url與init)而非全域fetch，不連網', async function() {
        let calls = []
        let fakeFetch = async (url, init) => {
            calls.push([url, init.headers['x-api-key'] === KEY, JSON.parse(init.body).model])
            return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 9 tokens > 5 maximum' } }), { status: 400, headers: { 'content-type': 'application/json' } })
        }
        let t = await dispatchApiAnthropic('abc', { key: KEY, model: 'claude-haiku-5-5', baseURL: 'http://never.invalid', fetch: fakeFetch })
        assert.strict.deepEqual([calls, t.failureKind], [[['http://never.invalid/v1/messages', true, 'claude-haiku-5-5']], 'context-too-long'])
    })

    it('注入之fetch拋出有cause.code之例外 → network，訊息遮蔽金鑰', async function() {
        let fakeFetch = async (url, init) => {
            let e = new TypeError(`boom with ${init.headers['x-api-key']}`)
            e.cause = { code: 'ECONNRESET' }
            throw e
        }
        let t = await dispatchApiAnthropic('abc', { key: KEY, model: 'claude-haiku-5-5', fetch: fakeFetch })
        assert.strict.deepEqual([t.failureKind, t.errorType, t.error, t.error.includes(KEY)], ['network', 'fetch', 'FETCH_ERROR: ECONNRESET', false])
    })

    //外審#7: 非法金鑰(標頭值含換行)曾被歸為網路故障致遞補層整組跳過、有效金鑰永遠不試
    it('注入之fetch拋出標頭值非法之例外(金鑰含換行) → key-invalid(須換把，不是網路故障)，訊息遮蔽金鑰', async function() {
        let fakeFetch = async (url, init) => {
            throw new TypeError(`Headers.append: "${init.headers['x-api-key']}" is an invalid header value`)
        }
        let t = await dispatchApiAnthropic('abc', { key: KEY, model: 'claude-haiku-5-5', fetch: fakeFetch })
        assert.strict.deepEqual([t.failureKind, t.errorType, t.error.includes(KEY), t.error.includes('[REDACTED]')], ['key-invalid', 'fetch', false, true])
    })

    it('注入之fetch拋出無法判定之例外(無cause.code、非標頭問題) → other(維持既有處置: 換下一把)，不憑空歸為網路', async function() {
        let fakeFetch = async (url, init) => {
            throw new Error(`boom with ${init.headers['x-api-key']}`)
        }
        let t = await dispatchApiAnthropic('abc', { key: KEY, model: 'claude-haiku-5-5', fetch: fakeFetch })
        assert.strict.deepEqual([t.failureKind, t.errorType, t.error.includes(KEY), t.error.includes('[REDACTED]')], ['other', 'fetch', false, true])
    })

    //外審#15: 純分類器測過error_code，但轉接器是否把error.details.error_code接進分類須獨立驗證(訊息不含任何已知字樣)
    it('429且訊息為opaque、只有error.details.error_code為enforced_spend_limit_reached → no-credit(隔離錯誤碼接線)', async function() {
        let t = await call('err-spend-cap-opaque-429')
        assert.strict.deepEqual([t.code, t.failureDetail, t.failureKind], [429, 'opaque message', 'no-credit'])
    })

    //外審#6: 月花費上限之429無retry-after且持續失敗，重試只會再送必敗請求
    it('沒額度(含月花費上限之429)與脈絡過長不重試；限流429與過載529照舊依maxRetries重試', async function() {
        let r = []
        for (let model of ['err-spend-cap-429', 'err-spend-cap-opaque-429', 'err-credit-400', 'err-context-400', 'err-429', 'err-529']) {
            let t = await call(model, { maxRetries: 2, retryDelayMs: 1 })
            r.push([t.failureKind, t.attempts])
        }
        assert.strict.deepEqual(r, [['no-credit', 1], ['no-credit', 1], ['no-credit', 1], ['context-too-long', 1], ['rate-limit', 3], ['overloaded', 3]])
    })

    it('opt.fetch非函數視為未給(退回全域fetch)', async function() {
        let t = await call('ok', { fetch: 'not-a-function' })
        assert.strict.equal(t.ok, true)
    })

})
