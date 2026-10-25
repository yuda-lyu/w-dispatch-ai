import assert from 'assert'
import probeAnthropicKeys, { probeAnthropicKey, readLimitHeaders } from '../src/probeAnthropicKeys.mjs'
import fakeServerForAnthropicTest from './tools/fakeServerForAnthropicTest.mjs'


// unit-probeAnthropicKeys.test.mjs — probeAnthropicKeys(金鑰探測)之規格測試(2026-10-25 dispatch-run01)
//
// 規格來源: 任務書範圍三、README「金鑰探測 probeAnthropicKeys」、帳本R-ANTHROPIC-5:
//   對每把金鑰送極小請求(max_tokens: 1, 預設claude-haiku-5-5), 回傳每把之分類(ok／no-credit／key-invalid／no-permission／rate-limit／overloaded／network／other)
//   與每分鐘限額標頭(anthropic-ratelimit-{requests|tokens|input-tokens|output-tokens}-{limit|remaining|reset}與retry-after, 見官方rate-limits頁「Response headers」);
//   不得記錄或回傳金鑰本體(只回序號、長度); 可注入fetch。Anthropic一般金鑰無查餘額之端點, 本函數只判斷「此刻能否呼叫」。
// 全部為注入之fetch或本機假伺服器, 不發出任何Anthropic請求, 不讀任何.env。


//測試用金鑰: 各含可辨識且「不會被樣式遮蔽覆蓋」的尾段, 以便斷言輸出中不存在其任何長片段
let K1 = 'sk-ant-api03-PROBEKEY-ONE-1111aaaa2222bbbb3333'
let K2 = 'sk-ant-api03-PROBEKEY-TWO-4444cccc5555dddd6666'

//以注入之fetch回應: 依金鑰(x-api-key)查表, 表值為 { status, body, headers }
let fetchByKey = (table, calls = []) => async (url, init) => {
    let key = init.headers['x-api-key']
    calls.push({ url, key, body: JSON.parse(init.body), headers: init.headers })
    let spec = table[key]
    if (spec instanceof Error) {
        throw spec
    }
    return new Response(spec.body === undefined ? '' : (typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body)), { status: spec.status, headers: spec.headers || { 'content-type': 'application/json' } })
}
let errBody = (type, message, extra = {}) => ({ type: 'error', error: { type, message, ...extra } })
let okBody = { id: 'msg_x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'h' }], stop_reason: 'max_tokens', usage: { input_tokens: 8, output_tokens: 1 } }


describe('probeAnthropicKeys (金鑰探測)', function() {

    it('各狀態分類: 200→ok、額度不足400→no-credit、402→no-credit、401→key-invalid、403→no-permission、429→rate-limit、花費上限429→no-credit、529→overloaded、504→network、404→other', async function() {
        let specs = [
            [{ status: 200, body: okBody }, 'ok'],
            [{ status: 400, body: errBody('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.') }, 'no-credit'],
            [{ status: 402, body: errBody('billing_error', 'billing') }, 'no-credit'],
            [{ status: 401, body: errBody('authentication_error', 'invalid x-api-key') }, 'key-invalid'],
            [{ status: 403, body: errBody('permission_error', 'no permission') }, 'no-permission'],
            [{ status: 429, body: errBody('rate_limit_error', 'rate limited'), headers: { 'content-type': 'application/json', 'retry-after': '12' } }, 'rate-limit'],
            [{ status: 429, body: errBody('rate_limit_error', 'You have reached your API usage limits: monthly', { details: { error_code: 'enforced_spend_limit_reached' } }) }, 'no-credit'],
            [{ status: 529, body: errBody('overloaded_error', 'Overloaded') }, 'overloaded'],
            [{ status: 504, body: errBody('timeout_error', 'timed out') }, 'network'],
            [{ status: 404, body: errBody('not_found_error', 'model: x') }, 'other'],
            [{ status: 500, body: errBody('api_error', 'Internal') }, 'other'],
            [{ status: 401, body: '<html>nope</html>' }, 'key-invalid'], //非JSON本體仍依狀態碼
        ]
        let r = []
        for (let [spec, want] of specs) {
            let t = await probeAnthropicKey(K1, { fetch: fetchByKey({ [K1]: spec }) })
            r.push([t.kind, want, t.kind === 'ok' ? t.ok : !t.ok])
        }
        assert.strict.deepEqual(r.map((x) => x[0]), r.map((x) => x[1]))
        assert.strict.deepEqual(r.map((x) => x[2]), r.map(() => true))
    })

    it('請求形狀: POST /v1/messages, x-api-key與anthropic-version標頭, 本體max_tokens為1、預設模型claude-haiku-5-5', async function() {
        let calls = []
        await probeAnthropicKeys([K1], { fetch: fetchByKey({ [K1]: { status: 200, body: okBody } }, calls), baseURL: 'http://probe.invalid/v1/' })
        let c = calls[0]
        assert.strict.deepEqual(
            [calls.length, c.url, c.key, c.headers['anthropic-version'], c.body.max_tokens, c.body.model, c.body.messages.length],
            [1, 'http://probe.invalid/v1/messages', K1, '2023-06-01', 1, 'claude-haiku-5-5', 1],
        )
    })

    it('opt.model可改探測用模型', async function() {
        let calls = []
        let r = await probeAnthropicKeys([K1], { fetch: fetchByKey({ [K1]: { status: 200, body: okBody } }, calls), model: 'claude-sonnet-5-5' })
        assert.strict.deepEqual([calls[0].body.model, r.model], ['claude-sonnet-5-5', 'claude-sonnet-5-5'])
    })

    it('每把一個請求、依序、結果依輸入順序並帶序號與長度；summary為各kind把數', async function() {
        let calls = []
        let r = await probeAnthropicKeys([K1, K2], {
            fetch: fetchByKey({
                [K1]: { status: 200, body: okBody },
                [K2]: { status: 400, body: errBody('invalid_request_error', 'Your credit balance is too low') },
            }, calls),
        })
        assert.strict.deepEqual(
            [calls.map((c) => c.key), r.results.map((x) => [x.index, x.length, x.kind, x.ok, x.status]), r.summary],
            [[K1, K2], [[0, K1.length, 'ok', true, 200], [1, K2.length, 'no-credit', false, 400]], { 'total': 2, 'ok': 1, 'no-credit': 1 }],
        )
    })

    it('回傳物件序列化後不含金鑰本體及其任何12字元以上之片段(只有序號與長度)', async function() {
        let r = await probeAnthropicKeys([K1, K2], {
            fetch: fetchByKey({
                [K1]: { status: 200, body: okBody },
                [K2]: { status: 401, body: errBody('authentication_error', `invalid x-api-key ${K2}`) }, //伺服器回顯金鑰
            }),
        })
        let json = JSON.stringify(r)
        let leaks = []
        for (let k of [K1, K2]) {
            for (let i = 0; i + 12 <= k.length; i++) {
                if (json.includes(k.slice(i, i + 12))) {
                    leaks.push(k.slice(i, i + 12))
                }
            }
        }
        assert.strict.deepEqual([leaks, json.includes('[REDACTED]')], [[], true])
    })

    it('fetch拋出夾帶金鑰之例外: 有cause.code → network；標頭值非法 → key-invalid；無法判定 → other；訊息皆遮蔽，不reject', async function() {
        let withCause = new TypeError(`socket failed for ${K1}`)
        withCause.cause = { code: 'ECONNRESET' }
        let headerBad = new TypeError(`Headers.append: "${K1}" is an invalid header value`)
        let generic = new Error(`socket failed for ${K1}`)
        let r = []
        for (let e of [withCause, headerBad, generic]) {
            let t = await probeAnthropicKeys([K1], { fetch: fetchByKey({ [K1]: e }) })
            let x = t.results[0]
            r.push([x.kind, x.detail.includes(K1)])
        }
        assert.strict.deepEqual(r, [['network', false], ['key-invalid', false], ['other', false]])
    })

    //外審#1: 限額標頭之文字欄位來自伺服器，不得因回顯而經limits回傳金鑰
    it('限額標頭reset回顯金鑰時: limits內之金鑰被遮蔽，回傳物件不含金鑰', async function() {
        let headers = {
            'content-type': 'application/json',
            'anthropic-ratelimit-requests-limit': '1000',
            'anthropic-ratelimit-requests-remaining': '999',
            'anthropic-ratelimit-requests-reset': `echo-${K1}-tail`,
        }
        let r = await probeAnthropicKeys([K1], { fetch: fetchByKey({ [K1]: { status: 200, body: okBody, headers } }) })
        let json = JSON.stringify(r)
        assert.strict.deepEqual([json.includes(K1), json.includes('PROBEKEY-ONE'), r.results[0].limits.requests.reset], [false, false, 'echo-[REDACTED]-tail'])
    })

    it('限額標頭reset過長時截斷至64字元', async function() {
        let headers = { 'content-type': 'application/json', 'anthropic-ratelimit-requests-reset': 'x'.repeat(500) }
        let r = await probeAnthropicKeys([K1], { fetch: fetchByKey({ [K1]: { status: 200, body: okBody, headers } }) })
        assert.strict.equal(r.results[0].limits.requests.reset.length <= 64 + '...'.length, true)
    })

    //外審#10: 錯誤處理本身不得使探測reject
    it('fetch拋出讀取即拋錯之物件(name／message／cause getter拋錯)與畸形回應物件 → 該把other，不reject', async function() {
        let thrower = {
            get name() {
                throw new Error('boom')
            },
            get message() {
                throw new Error('boom')
            },
            get cause() {
                throw new Error('boom')
            },
        }
        let weird = {
            get ok() {
                throw new Error('weird')
            },
            status: 200,
            headers: null,
            text: async () => '',
        }
        let throwing = async () => {
            throw thrower
        }
        let weirdRes = async () => weird
        let a = await probeAnthropicKeys([K1], { fetch: throwing })
        let b = await probeAnthropicKeys([K1], { fetch: weirdRes })
        assert.strict.deepEqual([a.results[0].kind, b.results[0].kind, b.results[0].ok], ['other', 'other', false])
    })

    it('413(請求過大)等context-too-long不在探測值域: 歸other', async function() {
        let t = await probeAnthropicKey(K1, { fetch: fetchByKey({ [K1]: { status: 413, body: errBody('request_too_large', 'too large') } }) })
        assert.strict.deepEqual([t.kind, t.status], ['other', 413])
    })

    it('429且訊息為opaque、只有error.details.error_code為enforced_spend_limit_reached → no-credit(隔離錯誤碼接線)', async function() {
        let t = await probeAnthropicKey(K1, { fetch: fetchByKey({ [K1]: { status: 429, body: errBody('rate_limit_error', 'opaque message', { details: { error_code: 'enforced_spend_limit_reached' } }) } }) })
        assert.strict.equal(t.kind, 'no-credit')
    })

    it('連線拒絕(cause.code)→ network，detail為錯誤碼', async function() {
        let e = new TypeError('fetch failed')
        e.cause = { code: 'ECONNREFUSED' }
        let t = await probeAnthropicKey(K1, { fetch: fetchByKey({ [K1]: e }) })
        assert.strict.deepEqual([t.kind, t.detail], ['network', 'ECONNREFUSED'])
    })

    it('逾時 → network', async function() {
        let slow = (url, init) => new Promise((resolve, reject) => {
            init.signal.addEventListener('abort', () => {
                let e = new Error('aborted')
                e.name = 'AbortError'
                reject(e)
            })
        })
        let t = await probeAnthropicKey(K1, { fetch: slow, timeoutMs: 200 })
        assert.strict.deepEqual([t.kind, t.detail], ['network', 'TIMEOUT after 0.2s'])
    })

    it('每分鐘限額標頭: requests／inputTokens／outputTokens之limit、remaining(數值)、reset(字串)與retry-after；缺席之組為null', async function() {
        let headers = {
            'content-type': 'application/json',
            'anthropic-ratelimit-requests-limit': '1000',
            'anthropic-ratelimit-requests-remaining': '998',
            'anthropic-ratelimit-requests-reset': '2026-10-25T12:00:00Z',
            'anthropic-ratelimit-input-tokens-limit': '2000000',
            'anthropic-ratelimit-input-tokens-remaining': '1999000',
            'anthropic-ratelimit-input-tokens-reset': '2026-10-25T12:00:01Z',
            'anthropic-ratelimit-output-tokens-limit': '400000',
            'anthropic-ratelimit-output-tokens-remaining': '399000',
            'anthropic-ratelimit-output-tokens-reset': '2026-10-25T12:00:02Z',
            'retry-after': '7',
        }
        let t = await probeAnthropicKey(K1, { fetch: fetchByKey({ [K1]: { status: 200, body: okBody, headers } }) })
        assert.strict.deepEqual(t.limits, {
            requests: { limit: 1000, remaining: 998, reset: '2026-10-25T12:00:00Z' },
            tokens: null,
            inputTokens: { limit: 2000000, remaining: 1999000, reset: '2026-10-25T12:00:01Z' },
            outputTokens: { limit: 400000, remaining: 399000, reset: '2026-10-25T12:00:02Z' },
        })
        assert.strict.equal(t.retryAfterSec, 7)
    })

    it('無限額標頭時limits為null、retryAfterSec為null', async function() {
        let t = await probeAnthropicKey(K1, { fetch: fetchByKey({ [K1]: { status: 401, body: errBody('authentication_error', 'x') } }) })
        assert.strict.deepEqual([t.limits, t.retryAfterSec], [null, null])
    })

    it('readLimitHeaders: 非數值limit視為null；headers不可讀時全null', function() {
        let h = new Headers({ 'anthropic-ratelimit-tokens-limit': 'abc', 'anthropic-ratelimit-tokens-remaining': '5' })
        let a = readLimitHeaders(h)
        let b = readLimitHeaders(null)
        assert.strict.deepEqual([a.limits.tokens, b.retryAfterSec, b.limits.requests], [{ limit: null, remaining: 5, reset: null }, null, null])
    })

    it('金鑰可給`ANTHROPIC_KEYS`原始字串: 逗號與分號皆分隔、修剪空白、濾除空項', async function() {
        let calls = []
        let r = await probeAnthropicKeys(` ${K1};${K2} , `, { fetch: fetchByKey({ [K1]: { status: 200, body: okBody }, [K2]: { status: 200, body: okBody } }, calls) })
        assert.strict.deepEqual([calls.map((c) => c.key), r.summary], [[K1, K2], { total: 2, ok: 2 }])
    })

    it('無效元素(非字串、空字串)不送請求，該項為other並註明；無效輸入回空結果；不reject', async function() {
        let calls = []
        let r = await probeAnthropicKeys([K1, '', 123, null], { fetch: fetchByKey({ [K1]: { status: 200, body: okBody } }, calls) })
        let e1 = await probeAnthropicKeys(null)
        let e2 = await probeAnthropicKeys(undefined, null)
        assert.strict.deepEqual(
            [calls.length, r.results.map((x) => [x.index, x.length, x.kind]), e1.summary, e2.results],
            [1, [[0, K1.length, 'ok'], [1, 0, 'other'], [2, 0, 'other'], [3, 0, 'other']], { total: 0 }, []],
        )
    })

    it('不給fetch時走全域fetch: 打本機假伺服器(ok-with-limits帶限額標頭、by-key依金鑰回不同結果)', async function() {
        let srv = await fakeServerForAnthropicTest()
        try {
            let a = await probeAnthropicKeys(['sk-ant-api03-A-GOODKEY-0001'], { baseURL: srv.url, model: 'ok-with-limits' })
            let b = await probeAnthropicKeys(['sk-ant-api03-nocredit-0002', 'sk-ant-api03-ratelimited-0003', 'sk-ant-api03-overloaded-0004', 'sk-ant-api03-forbidden-0005', 'sk-bad-0006', 'sk-ant-api03-fine-0007'], { baseURL: srv.url, model: 'by-key' })
            assert.strict.deepEqual(
                [a.results[0].kind, a.results[0].limits.requests, a.results[0].limits.outputTokens.remaining, b.results.map((x) => x.kind), srv.requests.every((q) => q.body.max_tokens === 1)],
                ['ok', { limit: 1000, remaining: 999, reset: '2026-10-25T12:00:00Z' }, 399000, ['no-credit', 'rate-limit', 'overloaded', 'no-permission', 'key-invalid', 'ok'], true],
            )
        }
        finally {
            await srv.close()
        }
    })

})
