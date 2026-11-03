import assert from 'assert'
import dispatchAiFallbackRaw from '../src/dispatchAiFallback.mjs'
import { resolveQuotaGate, createQuotaGateState, isGoEntry, judgeGoUsage, checkGoQuota } from '../src/goQuotaGate.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


//mkStore, 逐次呼叫獨立之記憶體store(遞補層預設之游標存於行程內共用狀態, 同id之測試會互相影響游標)
let mkStore = () => {
    let s = null
    return {
        get: () => s,
        set: (x) => {
            s = x
        }
    }
}

//dispatchAiFallback, 未給store時每次呼叫給新store
let dispatchAiFallback = (prompt, opt) => dispatchAiFallbackRaw(prompt, { store: mkStore(), ...opt })


// 規格來源: Gitea #67 §2(Go用量達95%視為冷卻; rolling／weekly／monthly各一鍵; 快取60秒; 端點失敗不擋)、主控派工單〈主控之疑慮〉5
//   (端點官方未載, 失敗或欄位缺少都不得誤判為到頂)。用量結果之形狀見opencodeGoUsage.mjs檔頭(實測所得)。


//okUsage, 組opencodeGoUsage成功結果(三視窗: [percent, resetsAt]; status預設ok)
let okUsage = (rolling, weekly, monthly, extra = {}) => ({
    ok: true,
    provider: 'opencode-go',
    code: 200,
    usage: {
        rolling: rolling === null ? null : { status: 'ok', percent: rolling[0], resetsAt: rolling[1] ?? '2026-11-04T05:00:00.000Z', ...(rolling[2] || {}) },
        weekly: weekly === null ? null : { status: 'ok', percent: weekly[0], resetsAt: weekly[1] ?? '2026-11-09T00:00:00.000Z', ...(weekly[2] || {}) },
        monthly: monthly === null ? null : { status: 'ok', percent: monthly[0], resetsAt: monthly[1] ?? '2026-12-03T09:36:23.000Z', ...(monthly[2] || {}) },
    },
    limited: false,
    limitedWindows: [],
    unknownStatus: [],
    available: true,
    nextResetAt: null,
    ...extra,
})

let MAX95 = { rolling: 95, weekly: 95, monthly: 95 }


describe('goQuotaGate(R-SPAWNGATE-2)', function() {

    describe('resolveQuotaGate: 預設與種類解析', function() {

        it('預設: 三視窗各95, 快取60000ms, 查詢逾時5000ms; false關閉(回傳null)', function() {
            let c = resolveQuotaGate(undefined)
            assert.strict.deepEqual([c.max, c.cacheMs, c.timeoutMs, c.usage], [MAX95, 60000, 5000, null])
            assert.strict.deepEqual([null, true, 'x', 5, []].map((v) => resolveQuotaGate(v).max), [MAX95, MAX95, MAX95, MAX95, MAX95])
            assert.strict.deepEqual(resolveQuotaGate(false), null)
        })

        it('各視窗門檻可獨立覆寫(0~100之有效數字, 數字字串轉換後使用), false關閉該視窗, 非預期值改用預設95(K3)', function() {
            let c = resolveQuotaGate({ rollingMax: 80, weeklyMax: '90', monthlyMax: false })
            assert.strict.deepEqual(c.max, { rolling: 80, weekly: 90, monthly: null })
            let bad = [0, -1, 101, 'abc', NaN, true, {}, '', Infinity]
            for (let v of bad) {
                let d = resolveQuotaGate({ rollingMax: v, weeklyMax: v, monthlyMax: v })
                assert.strict.deepEqual(d.max, MAX95)
            }
        })

        it('cacheMs／timeoutMs須為正數毫秒(上限2147483647), 否則改用預設; usage／now須為函數', function() {
            let f = () => 1
            let c = resolveQuotaGate({ cacheMs: 1000, timeoutMs: '2000', usage: f, now: f })
            assert.strict.deepEqual([c.cacheMs, c.timeoutMs, c.usage === f, c.now === f], [1000, 2000, true, true])
            for (let v of [0, -1, 'x', 2147483648, NaN, {}]) {
                let d = resolveQuotaGate({ cacheMs: v, timeoutMs: v, usage: v, now: v })
                assert.strict.deepEqual([d.cacheMs, d.timeoutMs, d.usage, d.now === Date.now], [60000, 5000, null, true])
            }
        })

        it('quotaGate不可讀(拋錯getter)視為未給, 不拋錯', function() {
            let hostile = {}
            Object.defineProperty(hostile, 'rollingMax', {
                enumerable: true,
                get() {
                    throw new Error('boom')
                }
            })
            assert.strict.deepEqual(resolveQuotaGate(hostile).max, MAX95)
        })

        it('isGoEntry: 只有kind為opencode且provider為opencode-go才是Go條目', function() {
            let r = [
                { kind: 'opencode', provider: 'opencode-go' },
                { kind: 'opencode', provider: 'opencode' },
                { kind: 'claude', provider: 'opencode-go' },
                { kind: 'opencode' },
                {},
                null,
            ].map(isGoEntry)
            assert.strict.deepEqual(r, [true, false, false, false, false, false])
        })
    })

    describe('judgeGoUsage: 何時擋、何時不擋(不得誤判為到頂)', function() {

        it('percent ≥ 門檻才擋: 94不擋, 95與96擋(邊界); 三視窗各自判定(issue §2)', function() {
            for (let name of ['rolling', 'weekly', 'monthly']) {
                let mk = (p) => okUsage(...['rolling', 'weekly', 'monthly'].map((n) => (n === name ? [p] : [10])))
                let r = [94, 94.9, 95, 96, 100].map((p) => judgeGoUsage(mk(p), MAX95).blocked)
                assert.strict.deepEqual([name, r], [name, [false, false, true, true, true]])
                let d = judgeGoUsage(mk(96), MAX95)
                assert.strict.deepEqual([d.reason, d.windows.map((w) => [w.name, w.percent, w.limited])], ['limit', [[name, 96, false]]])
            }
        })

        it('門檻可調: rollingMax 99 時96%不擋; 視窗門檻為null(關閉)時100%亦不擋', function() {
            assert.strict.deepEqual(judgeGoUsage(okUsage([96], [10], [10]), { rolling: 99, weekly: 95, monthly: 95 }).blocked, false)
            assert.strict.deepEqual(judgeGoUsage(okUsage([100], [10], [10]), { rolling: null, weekly: 95, monthly: 95 }).blocked, false)
        })

        it('多視窗同時超標: windows全列, until取resetsAt之最晚者(任一缺漏或無法解析為null)', function() {
            let d = judgeGoUsage(okUsage([97, '2026-11-04T05:00:00.000Z'], [96, '2026-11-09T00:00:00.000Z'], [10]), MAX95)
            assert.strict.deepEqual([d.windows.map((w) => w.name), d.until], [['rolling', 'weekly'], '2026-11-09T00:00:00.000Z'])
            let d2 = judgeGoUsage(okUsage([97, '2026-11-04T05:00:00.000Z'], [96, 'not-a-date'], [10]), MAX95)
            assert.strict.deepEqual(d2.until, null)
            let d3 = judgeGoUsage(okUsage([97, '2026-11-04T05:00:00.000Z'], [10], [10]), MAX95)
            assert.strict.deepEqual(d3.until, '2026-11-04T05:00:00.000Z')
        })

        it('端點明說被限(status rate-limited)亦擋(即使percent低或缺); 未知status字樣不當作被限', function() {
            let d = judgeGoUsage(okUsage([10, undefined, { status: 'rate-limited' }], [10], [10]), MAX95)
            assert.strict.deepEqual([d.blocked, d.windows.map((w) => [w.name, w.percent, w.limited])], [true, [['rolling', 10, true]]])
            let d2 = judgeGoUsage(okUsage([null, undefined, { status: 'rate-limited', percent: undefined }], [10], [10]), MAX95)
            assert.strict.deepEqual([d2.blocked, d2.windows[0].percent], [true, null])
            let d3 = judgeGoUsage(okUsage([10, undefined, { status: 'weird-new-status' }], [10], [10]), MAX95)
            assert.strict.deepEqual(d3.blocked, false)
            let d4 = judgeGoUsage(okUsage([99, undefined, { status: 'weird-new-status' }], [10], [10]), MAX95)
            assert.strict.deepEqual(d4.blocked, true) //percent仍依門檻判定
        })

        it('端點失敗(各errorType)一律不擋, reason為error並帶errorType與code(fail-open)', function() {
            for (let errorType of ['params', 'auth', 'forbidden', 'ratelimit', 'http', 'parse', 'timeout', 'network', 'toolarge', 'other']) {
                let d = judgeGoUsage({ ok: false, errorType, code: 500, error: 'x' }, MAX95)
                assert.strict.deepEqual([d.blocked, d.reason, d.errorType, d.code, d.windows], [false, 'error', errorType, 500, []])
            }
            for (let bad of [null, undefined, 'x', 5, {}, { ok: true }, { ok: true, usage: null }, { ok: true, usage: 'x' }, { ok: 'true', usage: {} }]) {
                let d = judgeGoUsage(bad, MAX95)
                assert.strict.deepEqual([d.blocked, d.reason], [false, 'error'])
            }
        })

        it('欄位缺少或非數字一律不擋: 視窗缺漏、percent缺漏／null／NaN／Infinity／布林／文字／物件', function() {
            assert.strict.deepEqual(judgeGoUsage(okUsage(null, null, null), MAX95).blocked, false)
            assert.strict.deepEqual(judgeGoUsage({ ok: true, usage: {} }, MAX95).blocked, false)
            for (let p of [undefined, null, NaN, Infinity, -Infinity, true, false, 'abc', '', {}, [], 'NP', '-']) {
                let u = okUsage([p], [p], [p])
                assert.strict.deepEqual([String(p), judgeGoUsage(u, MAX95).blocked], [String(p), false])
            }
        })

        it('percent為數字字串時轉換後判定(K4: 檢測之值即使用之值)', function() {
            let d = judgeGoUsage(okUsage(['96'], [10], [10]), MAX95)
            assert.strict.deepEqual([d.blocked, d.windows[0].percent], [true, 96])
            assert.strict.deepEqual(judgeGoUsage(okUsage([' 94 '], [10], [10]), MAX95).blocked, false)
        })

        it('回應物件拋錯getter等不可讀情形由checkGoQuota攔截為不擋(見下)', function() {
            let hostile = {
                ok: true,
                get usage() {
                    throw new Error('boom')
                }
            }
            assert.throws(() => judgeGoUsage(hostile, MAX95)) //純函數本身不吞例外, 由checkGoQuota之最後防線處理
        })
    })

    describe('checkGoQuota: 快取、並行共用、失敗不擋', function() {

        let mk = (usage, extra = {}) => {
            let state = createQuotaGateState()
            let clock = { t: 0 }
            let calls = []
            let cfg = resolveQuotaGate({
                state,
                now: () => clock.t,
                usage: async (o) => {
                    calls.push(o)
                    return typeof usage === 'function' ? usage(o) : usage
                },
                ...extra,
            })
            return { cfg, state, clock, calls }
        }

        it('快取60秒內不重打(cached true), 到期後重查; 同一次判定結果一致', async function() {
            let m = mk(okUsage([96], [10], [10]))
            let d1 = await checkGoQuota(m.cfg, 'oc_sk_aaaaaaaa')
            m.clock.t = 59999
            let d2 = await checkGoQuota(m.cfg, 'oc_sk_aaaaaaaa')
            assert.strict.deepEqual([d1.blocked, d1.cached, d2.blocked, d2.cached, m.calls.length], [true, false, true, true, 1])
            m.clock.t = 60000
            let d3 = await checkGoQuota(m.cfg, 'oc_sk_aaaaaaaa')
            assert.strict.deepEqual([d3.cached, m.calls.length], [false, 2])
        })

        it('不同金鑰各自查詢與快取(各工作區之用量獨立)', async function() {
            let m = mk((o) => (o.key === 'oc_sk_aaaaaaaa' ? okUsage([96], [10], [10]) : okUsage([10], [10], [10])))
            let a = await checkGoQuota(m.cfg, 'oc_sk_aaaaaaaa')
            let b = await checkGoQuota(m.cfg, 'oc_sk_bbbbbbbb')
            assert.strict.deepEqual([a.blocked, b.blocked, m.calls.map((c) => c.key)], [true, false, ['oc_sk_aaaaaaaa', 'oc_sk_bbbbbbbb']])
        })

        it('同一把金鑰並行之多個呼叫共用同一次查詢(整批只打一次)', async function() {
            let release = null
            let m = mk(() => new Promise((resolve) => {
                release = () => resolve(okUsage([96], [10], [10]))
            }))
            let ps = [1, 2, 3, 4, 5].map(() => checkGoQuota(m.cfg, 'oc_sk_aaaaaaaa'))
            await new Promise((resolve) => setImmediate(resolve))
            release()
            let rs = await Promise.all(ps)
            assert.strict.deepEqual([m.calls.length, rs.map((r) => r.blocked), rs.map((r) => r.cached).sort()], [1, [true, true, true, true, true], [false, true, true, true, true]])
        })

        it('查詢失敗(拋錯、reject、非預期回傳、回應不可讀)不擋, reason為error; 失敗亦快取同長度(免對壞端點每個呼叫都打)', async function() {
            let behaviors = [
                () => {
                    throw new Error('boom')
                },
                () => Promise.reject(new Error('boom')),
                () => undefined,
                () => ({ ok: false, errorType: 'network', code: null }),
                () => ({
                    ok: true,
                    get usage() {
                        throw new Error('boom')
                    }
                }),
            ]
            for (let b of behaviors) {
                let m = mk(b)
                let d1 = await checkGoQuota(m.cfg, 'oc_sk_aaaaaaaa')
                let d2 = await checkGoQuota(m.cfg, 'oc_sk_aaaaaaaa')
                assert.strict.deepEqual([d1.blocked, d1.reason, d1.cached, d2.cached, m.calls.length], [false, 'error', false, true, 1])
            }
        })

        it('查詢懸置(永不落定)以逾時判為失敗而不擋(timeoutMs加2秒之外層上限)', async function() {
            let m = mk(() => new Promise(() => {}), { timeoutMs: 10 })
            let d = await checkGoQuota(m.cfg, 'oc_sk_aaaaaaaa')
            assert.strict.deepEqual([d.blocked, d.reason, d.errorType], [false, 'error', 'timeout'])
        })

        it('快取鍵為金鑰指紋, 狀態物件不存金鑰本體', async function() {
            let m = mk(okUsage([96], [10], [10]))
            await checkGoQuota(m.cfg, 'oc_sk_SECRETSECRET')
            let dump = JSON.stringify([...m.state.cache.entries()].map(([k, v]) => [k, v.decision]))
            assert.strict.deepEqual([dump.includes('SECRETSECRET'), [...m.state.cache.keys()].every((k) => /^[0-9a-f]{16}$/.test(k))], [false, true])
        })

        it('呼叫usage時帶key與timeoutMs; 預設usage為opencodeGoUsage(經注入替換之證據: 注入者被呼叫)', async function() {
            let m = mk(okUsage([10], [10], [10]), { timeoutMs: 1234 })
            await checkGoQuota(m.cfg, 'oc_sk_aaaaaaaa')
            assert.strict.deepEqual(m.calls, [{ key: 'oc_sk_aaaaaaaa', timeoutMs: 1234 }])
        })
    })

    describe('dispatchAiFallback整合(假CLI; 用量以注入函數代替端點)', function() {

        let fake = null
        before(function() {
            fake = createFakeCli('fake-goquota')
        })
        after(function() {
            if (fake) {
                fake.clean()
            }
        })

        let goEntry = (extra = {}) => ({ id: 'ocgo:fake', kind: 'opencode', provider: 'opencode-go', model: 'opencode-go/beam-free', exe: fake.exe, keys: ['oc_sk_AAAAAAAA', 'oc_sk_BBBBBBBB'], ...extra })
        let keyUsed = (r) => {
            let auth = JSON.parse(JSON.parse(r.stdout).env.OPENCODE_AUTH_CONTENT)
            return auth['opencode-go'].key
        }
        let quota = (map, calls = []) => ({
            state: createQuotaGateState(),
            usage: async (o) => {
                calls.push(o.key)
                let v = map[o.key]
                return typeof v === 'function' ? v() : v
            },
        })

        it('用量達門檻之金鑰被略過(不派), 改用下一把未達門檻者; 事件quota-skip帶視窗與預計解除時刻, tried記quota-skip', async function() {
            let calls = []
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [goEntry()],
                quotaGate: quota({ oc_sk_AAAAAAAA: okUsage([96, '2026-11-04T05:00:00.000Z'], [10], [10]), oc_sk_BBBBBBBB: okUsage([50], [10], [10]) }, calls),
                onEvent: (e) => events.push(e),
            })
            assert.strict.deepEqual([r.ok, keyUsed(r), r.keyIndex], [true, 'oc_sk_BBBBBBBB', 1])
            assert.strict.deepEqual(calls, ['oc_sk_AAAAAAAA', 'oc_sk_BBBBBBBB'])
            assert.strict.deepEqual(r.tried.map((t) => t.outcome), ['quota-skip', 'ok'])
            let skip = events.find((e) => e.type === 'quota-skip')
            assert.strict.deepEqual([skip.providerId, skip.keyIndex, skip.windows.map((w) => [w.name, w.percent]), skip.until, skip.cached], ['ocgo:fake', 0, [['rolling', 96]], '2026-11-04T05:00:00.000Z', false])
            assert.strict.deepEqual(/^QUOTA_COOLDOWN: .*rolling 96%; resets at 2026-11-04T05:00:00.000Z/.test(skip.error), true)
            //事件與tried皆不含金鑰
            assert.strict.deepEqual(JSON.stringify([events.filter((e) => e.type === 'quota-skip'), r.tried]).includes('oc_sk_'), false)
        })

        it('組內每把金鑰皆達門檻: 不派任何請求(假CLI未被執行)、遞補下一條目、最終QUOTA_EXHAUSTED不出現(下一條目成交)但group-exhausted標quotaExhausted', async function() {
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [goEntry(), { id: 'oc:plain', kind: 'opencode', exe: fake.exe }],
                quotaGate: quota({ oc_sk_AAAAAAAA: okUsage([99], [10], [10]), oc_sk_BBBBBBBB: okUsage([10], [96], [10]) }),
                onEvent: (e) => events.push(e),
            })
            assert.strict.deepEqual([r.ok, r.providerId], [true, 'oc:plain'])
            assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.outcome]), [['ocgo:fake', 'quota-skip'], ['ocgo:fake', 'quota-skip'], ['oc:plain', 'ok']])
            let ge = events.find((e) => e.type === 'group-exhausted')
            assert.strict.deepEqual([ge.providerId, ge.attempted, ge.by, ge.quotaExhausted, ge.errorTypes], ['ocgo:fake', 0, 'all-keys', true, []])
            assert.strict.deepEqual(r.quotaExhausted, undefined) //成交之結果不帶quotaExhausted(僅最終失敗結果帶)
        })

        it('唯一條目且每把皆達門檻: 最終失敗為QUOTA_EXHAUSTED、quotaExhausted列出條目、errorType quota、子進程從未啟動', async function() {
            let timeline = []
            let r = await dispatchAiFallback('abc', {
                providers: [goEntry({ onTrace: (e) => timeline.push(e.type) })],
                quotaGate: quota({ oc_sk_AAAAAAAA: okUsage([99], [10], [10]), oc_sk_BBBBBBBB: okUsage([10], [10], [97]) }),
            })
            assert.strict.deepEqual([r.ok, r.errorType, r.quotaExhausted, r.attempts], [false, 'quota', ['ocgo:fake'], 0])
            assert.strict.deepEqual(/^QUOTA_EXHAUSTED: provider "ocgo:fake" has no credit on all 2 key\(s\) \(QUOTA_COOLDOWN: /.test(r.error), true)
            assert.strict.deepEqual(timeline.includes('spawn'), false)
        })

        it('cooldownMs>0時整組皆達門檻之條目降至鏈尾(同既有沒額度處置): 下一次呼叫先試其他條目', async function() {
            let store = {
                s: null,
                get() {
                    return this.s
                },
                set(x) {
                    this.s = x
                }
            }
            let qg = quota({ oc_sk_AAAAAAAA: okUsage([99], [10], [10]), oc_sk_BBBBBBBB: okUsage([99], [10], [10]) })
            let providers = [goEntry(), { id: 'oc:plain', kind: 'opencode', exe: fake.exe }]
            let ev1 = []
            await dispatchAiFallback('abc', { providers, quotaGate: qg, store, cooldownMs: 600000, onEvent: (e) => ev1.push(e) })
            //(store為本測試獨立之記憶體store, 不與其他測試共用游標與冷卻)
            let cooled = ev1.find((e) => e.type === 'cooled')
            assert.strict.deepEqual([cooled.scope, cooled.failureKind], ['entry', 'no-credit'])
            let ev2 = []
            let r2 = await dispatchAiFallback('abc', { providers, quotaGate: qg, store, cooldownMs: 600000, onEvent: (e) => ev2.push(e) })
            assert.strict.deepEqual([r2.ok, ev2.filter((e) => e.type === 'try').map((e) => e.providerId)], [true, ['oc:plain']])
        })

        it('quotaGate:false 不查用量(不發任何查詢事件、照常派工); 對照: 未關閉而用量查詢失敗時發quota-gate-error事件但仍不擋', async function() {
            let events = []
            let r = await dispatchAiFallback('abc', { providers: [goEntry({ keys: ['oc_sk_AAAAAAAA'] })], quotaGate: false, onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r.ok, events.filter((e) => e.type === 'quota-gate-error' || e.type === 'quota-skip').length], [true, 0])

            //對照: 未關閉(以注入之usage使其失敗, 不連外網)
            let ev2 = []
            let r2 = await dispatchAiFallback('abc', {
                providers: [goEntry({ keys: ['oc_sk_AAAAAAAA'] })],
                quotaGate: { state: createQuotaGateState(), usage: () => ({ ok: false, errorType: 'network', code: null, error: 'x' }) },
                onEvent: (e) => ev2.push(e),
            })
            assert.strict.deepEqual([r2.ok, ev2.filter((e) => e.type === 'quota-gate-error').length], [true, 1])
        })

        it('只作用於Go條目: provider不是opencode-go、kind不是opencode、無keys之條目從不查用量', async function() {
            let calls = []
            let qg = quota({}, calls)
            let r = await dispatchAiFallback('abc', {
                providers: [
                    { id: 'a', kind: 'opencode', provider: 'opencode', exe: fake.exe, keys: ['k-aaaaaaaa'], extraArgs: ['--fake-exit=1'] },
                    { id: 'b', kind: 'claude', provider: 'opencode-go', exe: fake.exe, keys: ['k-bbbbbbbb'], extraArgs: ['--fake-exit=1'] },
                    { id: 'c', kind: 'opencode', provider: 'opencode-go', exe: fake.exe },
                ],
                quotaGate: qg,
            })
            assert.strict.deepEqual([r.ok, r.providerId, r.tried.map((t) => t.providerId), calls], [true, 'c', ['a', 'b', 'c'], []])
        })

        it('用量查詢失敗不擋: 照常派工, 發quota-gate-error事件(快取期間內同一把金鑰不再重複發)', async function() {
            let events = []
            let calls = []
            let qg = quota({ oc_sk_AAAAAAAA: () => ({ ok: false, errorType: 'http', code: 500, error: 'x' }), oc_sk_BBBBBBBB: okUsage([10], [10], [10]) }, calls)
            let providers = [goEntry()]
            let store = mkStore()
            let r1 = await dispatchAiFallback('abc', { providers, store, quotaGate: qg, onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r1.ok, keyUsed(r1)], [true, 'oc_sk_AAAAAAAA'])
            let ge = events.filter((e) => e.type === 'quota-gate-error')
            assert.strict.deepEqual(ge.map((e) => [e.providerId, e.keyIndex, e.errorType, e.code]), [['ocgo:fake', 0, 'http', 500]])
            //第二次呼叫: 游標已推進至B(用量10%), A之失敗仍在快取期; 再輪到A時不再發事件
            events.length = 0
            let r2 = await dispatchAiFallback('abc', { providers, store, quotaGate: qg, onEvent: (e) => events.push(e) })
            let r3 = await dispatchAiFallback('abc', { providers, store, quotaGate: qg, onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r2.ok, r3.ok, keyUsed(r3), events.filter((e) => e.type === 'quota-gate-error').length], [true, true, 'oc_sk_AAAAAAAA', 0])
            assert.strict.deepEqual(calls.filter((k) => k === 'oc_sk_AAAAAAAA').length, 1)
        })

        it('欄位缺少不擋(視窗缺漏、percent缺漏), 照常派工', async function() {
            let r = await dispatchAiFallback('abc', {
                providers: [goEntry({ keys: ['oc_sk_AAAAAAAA'] })],
                quotaGate: quota({ oc_sk_AAAAAAAA: okUsage(null, [undefined], null) }),
            })
            assert.strict.deepEqual([r.ok, r.tried.map((t) => t.outcome)], [true, ['ok']])
        })

        it('門檻可由quotaGate覆寫; 條目之quotaGate優先於呼叫層(false可單獨關閉某條目)', async function() {
            let usage = okUsage([96], [10], [10])
            let r1 = await dispatchAiFallback('abc', { providers: [goEntry({ keys: ['oc_sk_AAAAAAAA'] })], quotaGate: { ...quota({ oc_sk_AAAAAAAA: usage }), rollingMax: 99 } })
            assert.strict.deepEqual(r1.ok, true)
            let r2 = await dispatchAiFallback('abc', { providers: [goEntry({ keys: ['oc_sk_AAAAAAAA'], quotaGate: false })], quotaGate: quota({ oc_sk_AAAAAAAA: usage }) })
            assert.strict.deepEqual(r2.ok, true)
            let r3 = await dispatchAiFallback('abc', { providers: [goEntry({ keys: ['oc_sk_AAAAAAAA'], quotaGate: { ...quota({ oc_sk_AAAAAAAA: usage }) } })], quotaGate: false })
            assert.strict.deepEqual([r3.ok, r3.errorType], [false, 'quota'])
        })

        it('有budgetMs時: 用量查詢於預算計算之前(耗時自然計入budgetMs); 全部金鑰被略過回quota失敗, 不誤判為budget exhausted', async function() {
            let r = await dispatchAiFallback('abc', {
                providers: [goEntry()],
                quotaGate: quota({ oc_sk_AAAAAAAA: okUsage([99], [10], [10]), oc_sk_BBBBBBBB: okUsage([99], [10], [10]) }),
                budgetMs: 30000,
            })
            assert.strict.deepEqual([r.ok, r.errorType, r.tried.every((t) => t.outcome === 'quota-skip')], [false, 'quota', true])
        })
    })
})
