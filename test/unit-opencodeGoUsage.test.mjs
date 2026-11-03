import assert from 'assert'
import opencodeGoUsage from '../src/opencodeGoUsage.mjs'
import fakeServerForGoUsageTest, { W_OK } from './tools/fakeServerForGoUsageTest.mjs'


// unit-opencodeGoUsage.test.mjs — OpenCode Go 用量查詢(Gitea #65, 2026-11-03 da65; 帳本 sgud/rule/rulebook_opencodego.md R-OCGO-2)
//
// 規格來源(任務書〈要做的事〉3與〈必要之測試〉第一項, 以及issue #65 §2):
//   S1 GET＋Authorization: Bearer(端點只認Bearer);
//   S2 不印、不寫金鑰(結果與日誌皆不含);
//   S3 逾時與網路錯誤以結果物件回報, 不reject;
//   S4 回傳三視窗原值, 不換算金額;
//   S5 status未知值不得當正常;
//   S6 本機假站台: 200正常、rate-limited、401、403、逾時、非JSON、網路錯誤、缺金鑰各回對應結果;
//   S7 nextResetAt: issue原寫「被限視窗中最早之resetsAt」, 本實作改為「被限視窗全部解除之時刻＝最晚者」(同時被限的視窗須全部重置才恢復,
//      取最早者會在其餘視窗仍被限時誤判可用; 帳本R-OCGO-2); 實測未撞限過, 此為依狀態語意之推論。
// 假站台形狀取自2026-11-03對真實端點之實測(見test/tools/fakeServerForGoUsageTest.mjs); 全程不連外網。


let srv = null
let KEY = 'oc_sk_ok'

before(async function() {
    srv = await fakeServerForGoUsageTest()
})

after(async function() {
    await srv.close()
})

beforeEach(function() {
    srv.requests.length = 0
})

//call, 以假站台呼叫
let call = (key, extra = {}) => opencodeGoUsage({ key, baseURL: srv.url, ...extra })

//captureOutput, 呼叫期間攔截console與stdout/stderr之輸出, 回傳[結果, 輸出陣列]
let captureOutput = async (fn) => {
    let out = []
    let names = ['log', 'info', 'warn', 'error', 'debug']
    let saved = {}
    for (let n of names) {
        saved[n] = console[n]
        console[n] = (...args) => {
            out.push(args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
        }
    }
    let wo = process.stdout.write
    let we = process.stderr.write
    process.stdout.write = (s) => {
        out.push(String(s))
        return true
    }
    process.stderr.write = (s) => {
        out.push(String(s))
        return true
    }
    try {
        let r = await fn()
        return [r, out]
    }
    finally {
        for (let n of names) {
            console[n] = saved[n]
        }
        process.stdout.write = wo
        process.stderr.write = we
    }
}


describe('opencodeGoUsage(Go用量端點)', function() {

    describe('請求形狀(S1)', function() {

        it('GET <baseURL>/usage, 只帶Authorization: Bearer <金鑰>, 無本文, 不帶x-api-key', async function() {
            await call(KEY)
            let q = srv.requests[0]
            let r = [
                srv.requests.length,
                q.method,
                q.url,
                q.headers['authorization'],
                q.headers['x-api-key'],
                q.body,
            ]
            assert.strict.deepEqual(r, [1, 'GET', '/inference/go/v1/usage', `Bearer ${KEY}`, undefined, ''])
        })

        it('baseURL尾端斜線去除後仍請求 /usage', async function() {
            let r = await opencodeGoUsage({ key: KEY, baseURL: srv.url + '///' })
            assert.strict.deepEqual([r.ok, srv.requests[0].url], [true, '/inference/go/v1/usage'])
        })

    })

    describe('200正常與原值(S4)', function() {

        it('三視窗皆ok: 回原值、limited=false、available=true、nextResetAt=null、code=200', async function() {
            let r = await call(KEY)
            assert.strict.deepEqual(
                [r.ok, r.provider, r.source, r.code, r.usage, r.limited, r.limitedWindows, r.unknownStatus, r.available, r.nextResetAt],
                [true, 'opencode-go', 'opencode-go-usage-endpoint', 200, W_OK, false, [], [], true, null],
            )
        })

        it('視窗物件原樣保留(額外欄位、非整數percent、字串percent皆不轉換), 不換算金額', async function() {
            let r = await call('oc_sk_ok_extra')
            assert.strict.deepEqual(r.usage, {
                rolling: { status: 'ok', percent: 37.5, resetsAt: '2026-11-03T16:48:24.000Z', extraField: 'keep-me' },
                weekly: { status: 'ok', percent: '12', resetsAt: '2026-11-09T00:00:00.000Z' },
                monthly: { status: 'ok', percent: 0, resetsAt: '2026-12-03T09:36:23.000Z' },
            })
        })

        it('結果不含任何金額欄位(端點不給金額, 本函數不自行換算)', async function() {
            let r = await call(KEY)
            let s = JSON.stringify(r)
            assert.strict.deepEqual(/dollar|usd|cost|amount|\$/i.test(s), false)
        })

    })

    describe('rate-limited與nextResetAt(S7)', function() {

        it('rolling被限: limited=true、limitedWindows=[rolling]、available=false、nextResetAt=該視窗resetsAt', async function() {
            let r = await call('oc_sk_lim_rolling')
            assert.strict.deepEqual(
                [r.ok, r.limited, r.limitedWindows, r.unknownStatus, r.available, r.nextResetAt],
                [true, true, ['rolling'], [], false, '2026-11-03T16:48:24.000Z'],
            )
        })

        it('rolling與weekly同時被限(rolling較早): nextResetAt取較晚者(weekly), 因weekly仍被限時不可視為可用', async function() {
            let r = await call('oc_sk_lim_two')
            assert.strict.deepEqual([r.limitedWindows, r.nextResetAt], [['rolling', 'weekly'], '2026-11-09T00:00:00.000Z'])
        })

        it('rolling與monthly同時被限(rolling較晚): 取最晚者(rolling)而非最後一個視窗(monthly)', async function() {
            let r = await call('oc_sk_lim_two_rev')
            assert.strict.deepEqual([r.limitedWindows, r.nextResetAt], [['rolling', 'monthly'], '2026-12-01T00:00:00.000Z'])
        })

        it('被限視窗之一缺resetsAt: 無從得知何時全部解除, nextResetAt=null(不以其餘視窗之較早時間充數)', async function() {
            let r = await call('oc_sk_lim_nodate')
            assert.strict.deepEqual([r.limited, r.limitedWindows, r.nextResetAt], [true, ['rolling', 'weekly'], null])
        })

        it('被限視窗之resetsAt無法解析為日期: nextResetAt=null', async function() {
            let r = await call('oc_sk_lim_baddate')
            assert.strict.deepEqual([r.limited, r.nextResetAt], [true, null])
        })

    })

    describe('未知status不得當正常(S5)', function() {

        it('weekly.status為未知字(blocked): available=false、limited=false、unknownStatus=[weekly]、nextResetAt=null; 原值照回', async function() {
            let r = await call('oc_sk_unknown')
            assert.strict.deepEqual(
                [r.ok, r.limited, r.limitedWindows, r.unknownStatus, r.available, r.nextResetAt, r.usage.weekly.status],
                [true, false, [], ['weekly'], false, null, 'blocked'],
            )
        })

        it('status大小寫不同(OK)視為未知, 不當成ok', async function() {
            let r = await call('oc_sk_unknown_case')
            assert.strict.deepEqual([r.unknownStatus, r.available], [['rolling'], false])
        })

        it('視窗無status欄: 視為未知', async function() {
            let r = await call('oc_sk_nostatus')
            assert.strict.deepEqual([r.unknownStatus, r.available, r.usage.monthly.percent], [['monthly'], false, 2])
        })

        it('缺整個視窗(monthly): usage.monthly=null、列入unknownStatus、available=false', async function() {
            let r = await call('oc_sk_nomonthly')
            assert.strict.deepEqual([r.ok, r.usage.monthly, r.unknownStatus, r.available], [true, null, ['monthly'], false])
        })

        it('同時有被限視窗(rolling)與未知視窗(weekly): 分開列出; nextResetAt只由被限視窗決定', async function() {
            let r = await call('oc_sk_lim_and_unknown')
            assert.strict.deepEqual(
                [r.limited, r.limitedWindows, r.unknownStatus, r.available, r.nextResetAt],
                [true, ['rolling'], ['weekly'], false, '2026-11-03T16:48:24.000Z'],
            )
        })

    })

    describe('回應形狀不符(S6: 非預期本文)', function() {

        for (let tok of ['oc_sk_shape_empty', 'oc_sk_shape_arr', 'oc_sk_shape_str']) {
            it(`${tok}: ok=false、errorType=parse、不猜測`, async function() {
                let r = await call(tok)
                assert.strict.deepEqual([r.ok, r.errorType, r.code, 'usage' in r], [false, 'parse', 200, false])
            })
        }

        it('200但本文非JSON: errorType=parse', async function() {
            let r = await call('oc_sk_notjson')
            assert.strict.deepEqual([r.ok, r.errorType, r.code], [false, 'parse', 200])
        })

    })

    describe('HTTP錯誤(S6)', function() {

        it('401: errorType=auth、code=401、noGoSubscription=false', async function() {
            let r = await call('oc_sk_401')
            assert.strict.deepEqual([r.ok, r.errorType, r.code, r.noGoSubscription], [false, 'auth', 401, false])
        })

        it('金鑰不被辨識(其他權杖): 401 auth', async function() {
            let r = await call('oc_sk_unknown_token_value')
            assert.strict.deepEqual([r.errorType, r.code], ['auth', 401])
        })

        it('403 EntitlementError(Go訂閱不足): errorType=forbidden、noGoSubscription=true、code=403', async function() {
            let r = await call('oc_sk_403_go')
            assert.strict.deepEqual([r.ok, r.errorType, r.code, r.noGoSubscription], [false, 'forbidden', 403, true])
        })

        it('一般403(例如金鑰權限範圍): errorType=forbidden但noGoSubscription=false', async function() {
            let r = await call('oc_sk_403_scope')
            assert.strict.deepEqual([r.ok, r.errorType, r.code, r.noGoSubscription], [false, 'forbidden', 403, false])
        })

        it('429(端點自身限頻): errorType=ratelimit; 500: errorType=http、code=500', async function() {
            let a = await call('oc_sk_429')
            let b = await call('oc_sk_500')
            assert.strict.deepEqual([a.errorType, a.code, b.errorType, b.code], ['ratelimit', 429, 'http', 500])
        })

        it('noGoSubscription只在「403且為Go訂閱不足」為true: 其餘各類失敗(params、parse、auth、ratelimit、http、timeout、network)一律false', async function() {
            let s2 = await fakeServerForGoUsageTest()
            let closedUrl = s2.url
            await s2.close()
            let rs = [
                await opencodeGoUsage({ key: 'abc' }), //params
                await call('oc_sk_notjson'), //parse
                await call('oc_sk_shape_empty'), //parse(形狀)
                await call('oc_sk_401'), //auth
                await call('oc_sk_429'), //ratelimit
                await call('oc_sk_500'), //http
                await call('oc_sk_slow', { timeoutMs: 200 }), //timeout
                await opencodeGoUsage({ key: KEY, baseURL: closedUrl, timeoutMs: 3000 }), //network
            ]
            assert.strict.deepEqual(
                rs.map((r) => [r.errorType, r.noGoSubscription]),
                [['params', false], ['parse', false], ['parse', false], ['auth', false], ['ratelimit', false], ['http', false], ['timeout', false], ['network', false]],
            )
        })

        it('失敗結果帶provider／source與noGoSubscription欄位(成功時不帶error欄)', async function() {
            let a = await call('oc_sk_401')
            let b = await call(KEY)
            assert.strict.deepEqual(
                [a.provider, a.source, typeof a.error, typeof a.durationMs, 'error' in b, 'noGoSubscription' in b],
                ['opencode-go', 'opencode-go-usage-endpoint', 'string', 'number', false, false],
            )
        })

    })

    describe('逾時與網路錯誤以結果物件回報, 不reject(S3)', function() {

        it('逾時: errorType=timeout、code=null, 且在伺服器回應(5s)之前返回', async function() {
            let t0 = Date.now()
            let r = await call('oc_sk_slow', { timeoutMs: 300 })
            let dt = Date.now() - t0
            assert.strict.deepEqual([r.ok, r.errorType, r.code, dt < 3000], [false, 'timeout', null, true])
        })

        it('網路錯誤(埠已關閉): errorType=network、code=null, 不reject', async function() {
            let s2 = await fakeServerForGoUsageTest()
            let url = s2.url
            await s2.close()
            let r = await opencodeGoUsage({ key: KEY, baseURL: url, timeoutMs: 3000 })
            assert.strict.deepEqual([r.ok, r.errorType, r.code], [false, 'network', null])
        })

        it('timeoutMs無效(負數、字串、0)回退預設: 對快速站台仍正常取得結果', async function() {
            let rs = []
            for (let v of [-5, 'abc', 0, null, 1.5]) {
                let r = await call(KEY, { timeoutMs: v })
                rs.push(r.ok)
            }
            assert.strict.deepEqual(rs, [true, true, true, true, true])
        })

    })

    describe('缺金鑰與參數不合規: params, 不發請求(S6)', function() {

        it('缺key、空字串、全空白、過短、含空白、含換行、非字串: 皆params且假站台零請求', async function() {
            let cases = [undefined, null, '', '   ', 'abc', 'oc_sk_with space', 'oc_sk_with\nnewline', 'oc_sk_中文', 12345678, {}, ['oc_sk_ok']]
            let rs = []
            for (let k of cases) {
                let r = await opencodeGoUsage({ key: k, baseURL: srv.url })
                rs.push([r.ok, r.errorType, r.code])
            }
            assert.strict.deepEqual(
                [rs, srv.requests.length],
                [cases.map(() => [false, 'params', null]), 0],
            )
        })

        it('opt缺漏或非物件(undefined、null、字串、數字): 不reject, 回params', async function() {
            let rs = []
            for (let o of [undefined, null, 'oc_sk_ok', 123]) {
                let r = await opencodeGoUsage(o)
                rs.push([r.ok, r.errorType])
            }
            assert.strict.deepEqual([rs, srv.requests.length], [[[false, 'params'], [false, 'params'], [false, 'params'], [false, 'params']], 0])
        })

        it('已撤銷之Proxy作opt: 不reject, 回ok=false', async function() {
            let { proxy, revoke } = Proxy.revocable({}, {})
            revoke()
            let r = await opencodeGoUsage(proxy)
            assert.strict.deepEqual([r.ok, typeof r.errorType], [false, 'string'])
        })

        it('baseURL非http(s)網址(ftp、空字串、非字串、只有協定)視為未給而改用預設官方網址(dspec〈輸入參數之檢測機制〉K3: opt鍵之非預期輸入改用預設, 只有必須參數key報錯); 以替身fetch觀察實際請求網址, 不連網', async function() {
            let urls = []
            let ori = globalThis.fetch
            globalThis.fetch = async (url) => {
                urls.push(String(url))
                return new Response(JSON.stringify({ type: 'error', error: { type: 'AuthError', message: 'Unauthorized' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })
            }
            try {
                for (let b of ['ftp://127.0.0.1/x', '', 'not a url', 'http://', 123, {}, undefined, null]) {
                    await opencodeGoUsage({ key: KEY, baseURL: b })
                }
            }
            finally {
                globalThis.fetch = ori
            }
            assert.strict.deepEqual(urls, Array(8).fill('https://opencode.ai/inference/go/v1/usage'))
        })

        it('params錯誤訊息依V19格式「invalid <名稱>: must be <種類描述>」、固定詞彙、不回顯輸入值(K9)', async function() {
            let secret = 'bad key with spaces SECRET123'
            let r = await opencodeGoUsage({ key: secret })
            assert.strict.deepEqual(
                [r.errorType, r.error, r.error.includes('SECRET123')],
                ['params', 'invalid opt.key: must be a string of 6+ visible ASCII characters without whitespace', false],
            )
        })

    })

    describe('金鑰不外洩(S2)', function() {

        it('各種結果(正常、被限、401、403、逾時、非JSON、形狀不符)之序列化皆不含金鑰', async function() {
            let toks = ['oc_sk_ok', 'oc_sk_lim_two', 'oc_sk_401', 'oc_sk_403_go', 'oc_sk_notjson', 'oc_sk_shape_empty', 'oc_sk_500']
            let leaks = []
            for (let t of toks) {
                let r = await call(t)
                if (JSON.stringify(r).includes(t)) {
                    leaks.push(t)
                }
            }
            let rt = await call('oc_sk_slow', { timeoutMs: 200 })
            if (JSON.stringify(rt).includes('oc_sk_slow')) {
                leaks.push('oc_sk_slow')
            }
            assert.strict.deepEqual(leaks, [])
        })

        it('對端回顯完整Authorization標頭與金鑰時, 錯誤訊息中皆遮蔽(含[REDACTED]字樣)', async function() {
            let r = await call('oc_sk_echo')
            assert.strict.deepEqual(
                [r.ok, r.errorType, r.error.includes('oc_sk_echo'), r.error.includes('[REDACTED]')],
                [false, 'auth', false, true],
            )
        })

        it('呼叫期間不寫日誌: console與stdout/stderr皆無輸出(含錯誤路徑), 輸出中亦不含金鑰', async function() {
            let allOut = []
            for (let t of ['oc_sk_ok', 'oc_sk_echo', 'oc_sk_403_go', 'oc_sk_notjson']) {
                let [, out] = await captureOutput(() => call(t))
                allOut.push(...out)
            }
            let [, out2] = await captureOutput(() => opencodeGoUsage({ key: 'oc_sk_with space' }))
            allOut.push(...out2)
            assert.strict.deepEqual(allOut, [])
        })

        it('網路錯誤之訊息不含金鑰', async function() {
            let s2 = await fakeServerForGoUsageTest()
            let url = s2.url
            await s2.close()
            let r = await opencodeGoUsage({ key: 'oc_sk_network_secret_value', baseURL: url, timeoutMs: 3000 })
            assert.strict.deepEqual([r.errorType, JSON.stringify(r).includes('oc_sk_network_secret_value')], ['network', false])
        })

    })

})
