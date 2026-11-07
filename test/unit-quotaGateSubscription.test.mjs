import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { createQuotaGateState } from '../src/goQuotaGate.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// 規格來源: Gitea semi/opensrcOper#93(使用端建議)與主控派工單ke340:
//   A. quotaGate擴及訂閱類條目(claude無金鑰者、codex、antigravity依model對到/usage群組scope; 任一視窗usedPercent≥門檻即略過不派、until取被擋視窗resetAt最晚者;
//      快取以讀者家族為鍵、並行共用; 讀者失敗/未授權/欄位缺漏一律不擋〔fail-open〕);
//   B. 重置時刻入帳(store.quota; now<until期間直接略過、不再查詢; Claude官方額度字樣與opt.quotaUntilOf注入; until上限8天; store無效退回行程內記憶體);
//   C. quota-skip事件加source(usage-api／ledger／limit-text)。
// 本檔全部以注入之讀者(quotaGate.readers)與假CLI執行, 不連網、不呼叫真實額度查詢、不呼叫任何模型。
// 判定「不呼叫轉接器」之依據: 無try事件(遞補層於呼叫轉接器前一刻才發try)、attempts為0、tried只有quota-skip。


//以注入之時鐘取代真實時間(早於真實現在: 萬一入帳殘留於行程內記憶體, 對其他測試亦已過期)
let T0 = Date.UTC(2026, 0, 1, 4, 0, 0)
let iso = (ms) => new Date(ms).toISOString()
let H = 3600000
let D = 86400000


//mkJsonStore, 以JSON文字保存之store(每次get皆為全新解析之物件, 模擬「下一個行程讀回持久化之狀態」, 並證明入帳可JSON序列化)
let mkJsonStore = () => {
    let text = null
    return {
        get: () => (text === null ? null : JSON.parse(text)),
        set: (x) => {
            text = JSON.stringify(x)
        },
        text: () => text,
        state: () => (text === null ? null : JSON.parse(text)),
    }
}


//win, 組統一窗口(toQuotaWindow之輸出形狀)
let win = (label, usedPercent, resetAt, scope = '') => ({
    key: label,
    label,
    windowSeconds: null,
    usedPercent,
    remainingPercent: typeof usedPercent === 'number' ? 100 - usedPercent : null,
    resetAt,
    resetAfterSeconds: null,
    scope,
    active: false,
    severity: 'normal',
})

//okQuota, 組讀者成功結果(toQuotaResult之輸出形狀)
let okQuota = (windows, extra = {}) => ({ ok: true, provider: 'fake', email: '', matched: null, plan: '', planTier: '', source: 'fake', windows, credits: null, raw: null, error: '', errorType: '', durationMs: 1, ...extra })


//mkGate, 組quotaGate注入物件(每次獨立之快取狀態); readers為{claude,codex,antigravity}之結果或函數, calls記錄被呼叫之家族與參數
let mkGate = (readersDef, calls = [], extra = {}) => {
    let readers = {}
    for (let fam of Object.keys(readersDef)) {
        readers[fam] = async (o) => {
            calls.push([fam, o])
            let v = readersDef[fam]
            return typeof v === 'function' ? v(o) : v
        }
    }
    return { state: createQuotaGateState(), readers, now: () => T0, ...extra }
}


describe('quotaGate擴及訂閱類條目(ke340; Gitea #93)', function() {

    let fake = null
    before(function() {
        fake = createFakeCli('fake-subq')
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    let claudeE = (extra = {}) => ({ id: 'claude:sonnet', kind: 'claude', model: 'sonnet', exe: fake.exe, ...extra })
    let codexE = (extra = {}) => ({ id: 'codex:terra', kind: 'codex', model: 'gpt-6.1-terra', exe: fake.exe, ...extra })
    let agyE = (model, extra = {}) => ({ id: `agy:${model}`, kind: 'antigravity', model, exe: fake.exe, skipPermissions: false, addDirs: ['.'], ...extra })
    let plainE = (extra = {}) => ({ id: 'oc:plain', kind: 'opencode', exe: fake.exe, ...extra })
    let tries = (events) => events.filter((e) => e.type === 'try').map((e) => e.providerId)

    describe('A. 達門檻即略過、不呼叫轉接器(四種kind與群組對應)', function() {

        it('claude(無金鑰): 任一視窗≥95即quota-skip, 無try事件、attempts 0、遞補下一條目; 事件帶windows、until(被擋視窗resetAt最晚者)、source usage-api', async function() {
            let calls = []
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [claudeE(), plainE()],
                store: mkJsonStore(),
                quotaGate: mkGate({ claude: okQuota([win('5小時', 96, iso(T0 + H)), win('7天', 97, iso(T0 + 2 * D)), win('7天(Fable)', 10, iso(T0 + 3 * D), 'Fable')]) }, calls),
                onEvent: (e) => events.push(e),
            })
            assert.strict.deepEqual([r.ok, r.providerId, tries(events)], [true, 'oc:plain', ['oc:plain']])
            assert.strict.deepEqual(calls.map((c) => c[0]), ['claude'])
            let skip = events.find((e) => e.type === 'quota-skip')
            assert.strict.deepEqual([skip.providerId, skip.keyIndex, skip.keyId, skip.source, skip.cached, skip.until], ['claude:sonnet', null, 'claude:sonnet', 'usage-api', false, iso(T0 + 2 * D)])
            assert.strict.deepEqual(skip.windows.map((w) => [w.name, w.percent]), [['5小時', 96], ['7天', 97]])
            assert.strict.deepEqual(/^QUOTA_COOLDOWN: /.test(skip.error), true)
            let t0 = r.tried[0]
            assert.strict.deepEqual([t0.providerId, t0.outcome, t0.errorType, t0.failureKind, t0.source, t0.until], ['claude:sonnet', 'quota-skip', 'quota', 'no-credit', 'usage-api', iso(T0 + 2 * D)])
        })

        it('codex: 達門檻略過、不呼叫轉接器; 唯一條目時最終失敗為errorType quota、attempts 0、error以QUOTA_COOLDOWN開頭', async function() {
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [codexE()],
                store: mkJsonStore(),
                quotaGate: mkGate({ codex: okQuota([win('5小時', 99, iso(T0 + H)), win('7天', 51, iso(T0 + D))]) }),
                onEvent: (e) => events.push(e),
            })
            assert.strict.deepEqual([r.ok, r.errorType, r.failureKind, r.attempts, tries(events)], [false, 'quota', 'no-credit', 0, []])
            assert.strict.deepEqual(/^QUOTA_COOLDOWN: /.test(r.error), true)
            assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.outcome]), [['codex:terra', 'quota-skip']])
        })

        it('antigravity: 依model對到群組scope——Gemini系只看Gemini Models、Argon只看Gemini 4 Argon、claude-／gpt-oss-只看Claude and GPT models; 他群組到頂不擋', async function() {
            let windows = [
                win('7天(Gemini Models)', 10, iso(T0 + D), 'Gemini Models'),
                win('5小時(Claude and GPT models)', 99, iso(T0 + H), 'Claude and GPT models'),
                win('7天(Gemini 4 Argon)', 97, iso(T0 + 2 * D), 'Gemini 4 Argon'),
            ]
            let run = async (model) => {
                let events = []
                let calls = []
                let r = await dispatchAiFallback('abc', { providers: [agyE(model)], store: mkJsonStore(), quotaGate: mkGate({ antigravity: okQuota(windows) }, calls), onEvent: (e) => events.push(e) })
                return { ok: r.ok, tried: tries(events).length, calls: calls.length, skip: events.find((e) => e.type === 'quota-skip') }
            }
            let flash = await run('gemini-3.8-flash-high')
            assert.strict.deepEqual([flash.ok, flash.tried, flash.calls, flash.skip], [true, 1, 1, undefined])
            let argon = await run('gemini-4-argon-high')
            assert.strict.deepEqual([argon.ok, argon.tried, argon.skip.windows.map((w) => w.name), argon.skip.until], [false, 0, ['7天(Gemini 4 Argon)'], iso(T0 + 2 * D)])
            let opus = await run('claude-opus-5-5-high')
            assert.strict.deepEqual([opus.ok, opus.tried, opus.skip.windows.map((w) => w.name)], [false, 0, ['5小時(Claude and GPT models)']])
            let gptoss = await run('gpt-oss-120b')
            assert.strict.deepEqual([gptoss.ok, gptoss.skip.windows.map((w) => w.name)], [false, ['5小時(Claude and GPT models)']])
        })

        it('antigravity: model對不到群組(未知、未給)時取全部視窗', async function() {
            let windows = [win('7天(Gemini Models)', 10, iso(T0 + D), 'Gemini Models'), win('5小時(Claude and GPT models)', 99, iso(T0 + H), 'Claude and GPT models')]
            for (let model of ['totally-new-model', undefined]) {
                let events = []
                let r = await dispatchAiFallback('abc', { providers: [{ id: 'agy:x', kind: 'antigravity', exe: fake.exe, skipPermissions: false, addDirs: ['.'], ...(model ? { model } : {}) }], store: mkJsonStore(), quotaGate: mkGate({ antigravity: okQuota(windows) }), onEvent: (e) => events.push(e) })
                assert.strict.deepEqual([r.ok, tries(events).length, events.find((e) => e.type === 'quota-skip').windows.map((w) => w.name)], [false, 0, ['5小時(Claude and GPT models)']])
            }
        })

        it('門檻邊界: 94.99不擋、95擋(≥); claudeMax／codexMax／antigravityMax可調, false關閉該家; 非數字usedPercent不擋', async function() {
            let run = async (entry, fam, windows, gate = {}) => {
                let events = []
                let r = await dispatchAiFallback('abc', { providers: [entry], store: mkJsonStore(), quotaGate: mkGate({ [fam]: okQuota(windows) }, [], gate), onEvent: (e) => events.push(e) })
                return events.some((e) => e.type === 'quota-skip') ? 'skip' : (r.ok ? 'ok' : 'fail')
            }
            let reset = iso(T0 + H)
            assert.strict.deepEqual(await run(claudeE(), 'claude', [win('7天', 94.99, reset)]), 'ok')
            assert.strict.deepEqual(await run(claudeE(), 'claude', [win('7天', 95, reset)]), 'skip')
            assert.strict.deepEqual(await run(claudeE(), 'claude', [win('7天', 80, reset)], { claudeMax: 80 }), 'skip')
            assert.strict.deepEqual(await run(codexE(), 'codex', [win('7天', 80, reset)], { codexMax: '81' }), 'ok')
            assert.strict.deepEqual(await run(agyE('gemini-3.8-flash-high'), 'antigravity', [win('7天(Gemini Models)', 99, reset, 'Gemini Models')], { antigravityMax: false }), 'ok')
            assert.strict.deepEqual(await run(claudeE(), 'claude', [win('7天', null, reset)]), 'ok')
            assert.strict.deepEqual(await run(claudeE(), 'claude', [win('7天', 'abc', reset)]), 'ok')
            assert.strict.deepEqual(await run(claudeE(), 'claude', []), 'ok')
        })

        it('windowMax: 逐視窗label設門檻(數字或false)覆蓋該家門檻', async function() {
            let run = async (windows, gate) => {
                let events = []
                await dispatchAiFallback('abc', { providers: [claudeE()], store: mkJsonStore(), quotaGate: mkGate({ claude: okQuota(windows) }, [], gate), onEvent: (e) => events.push(e) })
                return events.some((e) => e.type === 'quota-skip')
            }
            let ws = [win('5小時', 97, iso(T0 + H)), win('7天', 50, iso(T0 + D))]
            assert.strict.deepEqual(await run(ws, {}), true)
            assert.strict.deepEqual(await run(ws, { windowMax: { '5小時': false } }), false)
            assert.strict.deepEqual(await run(ws, { windowMax: { '5小時': 98 } }), false)
            assert.strict.deepEqual(await run(ws, { windowMax: { '7天': 40 } }), true)
        })

        it('claude/codex之model別視窗(scope非空)只在model相符時計入: 他模型之週限額到頂不擋本條目; 無scope之視窗一律計入', async function() {
            let ws = [win('7天', 30, iso(T0 + D)), win('7天(Fable)', 100, iso(T0 + 3 * D), 'Fable')]
            let run = async (entry, fam, windows) => {
                let events = []
                await dispatchAiFallback('abc', { providers: [entry], store: mkJsonStore(), quotaGate: mkGate({ [fam]: okQuota(windows) }), onEvent: (e) => events.push(e) })
                return events.find((e) => e.type === 'quota-skip')
            }
            assert.strict.deepEqual(await run(claudeE(), 'claude', ws), undefined) //sonnet不受Fable週限額影響
            let fable = await run(claudeE({ id: 'claude:fable', model: 'fable' }), 'claude', ws)
            assert.strict.deepEqual(fable.windows.map((w) => w.name), ['7天(Fable)'])
            assert.strict.deepEqual(await run(codexE(), 'codex', [win('GPT-5.3-Codex-Spark', 100, iso(T0 + D), 'GPT-5.3-Codex-Spark'), win('7天', 10, iso(T0 + D))]), undefined)
            let all = await run(claudeE(), 'claude', [win('7天', 99, iso(T0 + D))])
            assert.strict.deepEqual(all.windows.map((w) => w.name), ['7天'])
        })

        it('帶金鑰之claude(API計費)不適用: keys／key／env.ANTHROPIC_API_KEY任一在場皆不查讀者、行為不變', async function() {
            let calls = []
            let gate = mkGate({ claude: okQuota([win('7天', 100, iso(T0 + D))]) }, calls)
            for (let extra of [{ keys: ['sk-ant-api03-AAAAAAAAAAAAAAAA'] }, { key: 'sk-ant-api03-BBBBBBBBBBBBBBBB' }, { env: { ANTHROPIC_API_KEY: 'sk-ant-api03-CCCCCCCCCCCCCCCC' } }]) {
                let events = []
                let r = await dispatchAiFallback('abc', { providers: [claudeE(extra)], store: mkJsonStore(), quotaGate: gate, onEvent: (e) => events.push(e) })
                assert.strict.deepEqual([r.ok, tries(events).length, events.some((e) => e.type === 'quota-skip')], [true, 1, false])
            }
            assert.strict.deepEqual(calls, [])
        })

        it('Go條目(ocgo:)之quota-skip事件與tried亦帶source usage-api(只增欄位, 其餘判定與形狀不變); Go不寫額度帳', async function() {
            let events = []
            let store = mkJsonStore()
            let usage = async () => ({ ok: true, usage: { rolling: { status: 'ok', percent: 96, resetsAt: iso(T0 + H) }, weekly: { status: 'ok', percent: 10, resetsAt: iso(T0 + D) }, monthly: { status: 'ok', percent: 10, resetsAt: iso(T0 + 9 * D) } } })
            let r = await dispatchAiFallback('abc', {
                providers: [{ id: 'ocgo:fake', kind: 'opencode', provider: 'opencode-go', model: 'opencode-go/beam-free', exe: fake.exe, keys: ['oc_sk_AAAAAAAA'] }],
                store,
                quotaGate: { state: createQuotaGateState(), usage, now: () => T0 },
                onEvent: (e) => events.push(e),
            })
            let skip = events.find((e) => e.type === 'quota-skip')
            assert.strict.deepEqual([r.ok, r.errorType, skip.source, r.tried[0].source, skip.until, skip.cached], [false, 'quota', 'usage-api', 'usage-api', iso(T0 + H), false])
            assert.strict.deepEqual(Object.keys(skip).sort(), ['cached', 'error', 'keyId', 'keyIndex', 'providerId', 'source', 'type', 'until', 'windows'])
            assert.strict.deepEqual(Object.keys((store.state() || {}).quota || {}), [])
        })

        it('只作用於訂閱類: opencode(含無金鑰)、api-*類條目從不查訂閱讀者', async function() {
            let calls = []
            let r = await dispatchAiFallback('abc', { providers: [plainE()], store: mkJsonStore(), quotaGate: mkGate({ claude: okQuota([win('7天', 100, iso(T0 + D))]), codex: okQuota([win('7天', 100, iso(T0 + D))]) }, calls) })
            assert.strict.deepEqual([r.ok, calls], [true, []])
        })

        it('預設(未明給quotaGate)只作用於「真的該CLI」: exe為假CLI／包裝腳本時不查讀者; 明給true或物件則不論exe皆作用', async function() {
            //未明給時, 對假exe不查任何讀者(以未注入之預設讀者會連真實帳號為由, 此處只能由行為證明: 假exe被派工、無quota-skip)
            let events = []
            let r = await dispatchAiFallback('abc', { providers: [claudeE()], store: mkJsonStore(), onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r.ok, tries(events).length, events.some((e) => e.type === 'quota-skip' || e.type === 'quota-gate-error')], [true, 1, false])
            //明給物件(帶注入讀者): 作用於假exe
            let ev2 = []
            await dispatchAiFallback('abc', { providers: [claudeE()], store: mkJsonStore(), quotaGate: mkGate({ claude: okQuota([win('7天', 100, iso(T0 + D))]) }), onEvent: (e) => ev2.push(e) })
            assert.strict.deepEqual(ev2.some((e) => e.type === 'quota-skip'), true)
        })
    })

    describe('A. fail-open: 查詢失敗、未授權、欄位缺漏、讀者拋錯／逾時一律不擋', function() {

        let failCases = {
            '讀者回ok:false(未授權)': () => ({ ok: false, windows: [], error: 'x', errorType: 'auth' }),
            '讀者回ok:false但帶達門檻之windows': () => ({ ok: false, windows: [win('7天', 100, iso(T0 + D))], error: 'x', errorType: 'http' }),
            '讀者拋錯': () => {
                throw new Error('boom')
            },
            '讀者reject': () => Promise.reject(new Error('boom')),
            '讀者回null': () => null,
            '讀者回字串': () => 'oops',
            '讀者回windows非陣列': () => ({ ok: true, windows: 'x' }),
            '讀者回ok但無windows': () => ({ ok: true }),
        }
        for (let name of Object.keys(failCases)) {
            it(`${name}: 照常派工, 發quota-gate-error事件(errorType字串), 不入帳`, async function() {
                let events = []
                let store = mkJsonStore()
                let r = await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: failCases[name] }), onEvent: (e) => events.push(e) })
                assert.strict.deepEqual([r.ok, tries(events).length, events.some((e) => e.type === 'quota-skip')], [true, 1, false])
                let ge = events.filter((e) => e.type === 'quota-gate-error')
                assert.strict.deepEqual([ge.length, typeof ge[0].errorType, ge[0].providerId], [1, 'string', 'claude:sonnet'])
                assert.strict.deepEqual(Object.keys((store.state() || {}).quota || {}), [])
            })
        }

        it('讀者逾時(超過timeoutMs+緩衝仍未回): 不擋、照常派工', async function() {
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [claudeE()],
                store: mkJsonStore(),
                quotaGate: mkGate({ claude: () => new Promise(() => {}) }, [], { timeoutMs: 20 }),
                onEvent: (e) => events.push(e),
            })
            assert.strict.deepEqual([r.ok, tries(events).length, events.find((e) => e.type === 'quota-gate-error').errorType], [true, 1, 'timeout'])
        })

        it('達門檻但視窗缺resetAt: 仍略過(until null)、不入帳(回到逐次快取查詢)', async function() {
            let events = []
            let store = mkJsonStore()
            let r = await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('7天', 99, '')]) }), onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r.ok, events.find((e) => e.type === 'quota-skip').until], [false, null])
            assert.strict.deepEqual(Object.keys((store.state() || {}).quota || {}), [])
        })
    })

    describe('A. 快取與並行', function() {

        it('快取以讀者家族為鍵: cacheMs內第二次呼叫不重查(cached true), 到期後重查; 不同家族各自查', async function() {
            let calls = []
            let clock = { t: T0 }
            let gate = mkGate({ claude: okQuota([win('7天', 10, iso(T0 + D))]), codex: okQuota([win('7天', 10, iso(T0 + D))]) }, calls, { now: () => clock.t, cacheMs: 60000 })
            let d = (entry) => dispatchAiFallback('abc', { providers: [entry], store: mkJsonStore(), quotaGate: gate })
            await d(claudeE())
            await d(claudeE({ id: 'claude:opus', model: 'opus' })) //同家族(claude)共用
            await d(codexE())
            assert.strict.deepEqual(calls.map((c) => c[0]), ['claude', 'codex'])
            clock.t = T0 + 59999
            await d(claudeE())
            assert.strict.deepEqual(calls.length, 2)
            clock.t = T0 + 60000
            await d(claudeE())
            assert.strict.deepEqual(calls.map((c) => c[0]), ['claude', 'codex', 'claude'])
        })

        it('antigravity快取另設(預設300000ms)且各群組共用同一次/usage查詢', async function() {
            let calls = []
            let clock = { t: T0 }
            let gate = mkGate({ antigravity: okQuota([win('7天(Gemini Models)', 1, iso(T0 + D), 'Gemini Models'), win('7天(Gemini 4 Argon)', 1, iso(T0 + D), 'Gemini 4 Argon')]) }, calls, { now: () => clock.t })
            let d = (m) => dispatchAiFallback('abc', { providers: [agyE(m)], store: mkJsonStore(), quotaGate: gate })
            await d('gemini-3.8-flash-high')
            await d('gemini-4-argon-high')
            assert.strict.deepEqual(calls.length, 1)
            clock.t = T0 + 299999
            await d('gemini-3.8-flash-high')
            assert.strict.deepEqual(calls.length, 1)
            clock.t = T0 + 300000
            await d('gemini-3.8-flash-high')
            assert.strict.deepEqual(calls.length, 2)
        })

        it('讀者呼叫帶timeoutMs: claude／codex預設15000、antigravity預設60000; 可由timeoutMs／antigravityTimeoutMs覆寫', async function() {
            let calls = []
            let gate = mkGate({ claude: okQuota([]), codex: okQuota([]), antigravity: okQuota([]) }, calls)
            for (let e of [claudeE(), codexE(), agyE('gemini-3.8-flash-high')]) {
                await dispatchAiFallback('abc', { providers: [e], store: mkJsonStore(), quotaGate: gate })
            }
            assert.strict.deepEqual(calls.map((c) => [c[0], c[1].timeoutMs]), [['claude', 15000], ['codex', 15000], ['antigravity', 60000]])
            let calls2 = []
            let gate2 = mkGate({ claude: okQuota([]), antigravity: okQuota([]) }, calls2, { timeoutMs: 7000, antigravityTimeoutMs: 9000 })
            for (let e of [claudeE(), agyE('gemini-3.8-flash-high')]) {
                await dispatchAiFallback('abc', { providers: [e], store: mkJsonStore(), quotaGate: gate2 })
            }
            assert.strict.deepEqual(calls2.map((c) => [c[0], c[1].timeoutMs]), [['claude', 7000], ['antigravity', 9000]])
        })

        it('同行程並行兩呼叫共用進行中之查詢(讀者只被呼叫一次)', async function() {
            let calls = []
            let gate = mkGate({ claude: () => new Promise((resolve) => setTimeout(() => resolve(okQuota([win('7天', 99, iso(T0 + D))])), 30)) }, calls)
            let d = () => dispatchAiFallback('abc', { providers: [claudeE()], store: mkJsonStore(), quotaGate: gate })
            let [r1, r2] = await Promise.all([d(), d()])
            assert.strict.deepEqual([calls.length, r1.ok, r2.ok, r1.tried[0].outcome, r2.tried[0].outcome], [1, false, false, 'quota-skip', 'quota-skip'])
        })
    })

    describe('B. 重置時刻入帳(store.quota)', function() {

        it('門檻判定blocked且until可解析即入帳(JSON可序列化): 鍵為讀者家族, 內容until／at／source／windows(只含name、percent、resetsAt)', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('5小時', 96, iso(T0 + H)), win('7天', 97, iso(T0 + 2 * D))]) }) })
            let q = store.state().quota
            assert.strict.deepEqual(Object.keys(q), ['claude'])
            assert.strict.deepEqual([q.claude.until, q.claude.at, q.claude.source], [iso(T0 + 2 * D), iso(T0), 'usage-api'])
            assert.strict.deepEqual(q.claude.windows, [{ name: '5小時', percent: 96, resetsAt: iso(T0 + H), scope: '' }, { name: '7天', percent: 97, resetsAt: iso(T0 + 2 * D), scope: '' }])
            assert.strict.deepEqual(/sk-|token|email/i.test(store.text()), false)
        })

        it('跨行程: 入帳後新建遞補(同store、全新快取)不呼叫讀者即略過, 事件source ledger、cached true; 讀者從未被呼叫', async function() {
            let store = mkJsonStore()
            let prov = [claudeE(), plainE()]
            await dispatchAiFallback('abc', { providers: prov, store, quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 2 * D))]) }) })
            let calls = []
            let events = []
            let r = await dispatchAiFallback('abc', { providers: prov, store, quotaGate: mkGate({ claude: okQuota([win('7天', 1, iso(T0 + D))]) }, calls, { now: () => T0 + H }), onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r.ok, r.providerId, calls.length, tries(events)], [true, 'oc:plain', 0, ['oc:plain']])
            let skip = events.find((e) => e.type === 'quota-skip')
            assert.strict.deepEqual([skip.source, skip.until, skip.cached, skip.providerId], ['ledger', iso(T0 + 2 * D), true, 'claude:sonnet'])
            assert.strict.deepEqual([r.tried[0].outcome, r.tried[0].source, r.tried[0].errorType, r.tried[0].failureKind], ['quota-skip', 'ledger', 'quota', 'no-credit'])
        })

        it('帳以讀者家族為鍵: 同登入態之其他claude條目(不同id)同樣被略過; codex條目不受claude帳影響', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 2 * D))]) }) })
            let calls = []
            let events = []
            let r = await dispatchAiFallback('abc', { providers: [claudeE({ id: 'claude:opus', model: 'opus' }), codexE()], store, quotaGate: mkGate({ codex: okQuota([win('7天', 1, iso(T0 + D))]) }, calls, { now: () => T0 + H }), onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r.providerId, calls.map((c) => c[0]), events.find((e) => e.type === 'quota-skip').providerId], ['codex:terra', ['codex'], 'claude:opus'])
        })

        it('model別視窗之帳不外洩到他model: Fable條目因「7天(Fable)」到頂入帳後, 同家族之sonnet條目不被帳擋(改查讀者、照常派工); 而Fable條目本身仍被帳略過', async function() {
            let store = mkJsonStore()
            let fableWins = [win('7天', 30, iso(T0 + D)), win('7天(Fable)', 100, iso(T0 + 3 * D), 'Fable')]
            let fableE = claudeE({ id: 'claude:fable', model: 'fable' })
            await dispatchAiFallback('abc', { providers: [fableE], store, quotaGate: mkGate({ claude: okQuota(fableWins) }) })
            let q = store.state().quota
            assert.strict.deepEqual([Object.keys(q), q.claude.windows.map((w) => [w.name, w.scope])], [['claude'], [['7天(Fable)', 'Fable']]])
            //sonnet: 帳內視窗不適用 → 不被帳擋, 改查讀者(未達門檻)並派工
            let calls = []
            let events = []
            let r = await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota(fableWins) }, calls, { now: () => T0 + H }), onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r.ok, calls.length, events.some((e) => e.type === 'quota-skip')], [true, 1, false])
            //Fable條目: 帳命中, 不查讀者
            let calls2 = []
            let ev2 = []
            let r2 = await dispatchAiFallback('abc', { providers: [fableE], store, quotaGate: mkGate({ claude: okQuota([]) }, calls2, { now: () => T0 + H }), onEvent: (e) => ev2.push(e) })
            assert.strict.deepEqual([r2.ok, calls2.length, ev2.find((e) => e.type === 'quota-skip').source], [false, 0, 'ledger'])
        })

        it('過期後重查: now≥until時重新呼叫讀者; 讀者回未達門檻即照常派工並清除過期之帳', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 2 * D))]) }) })
            let calls = []
            let events = []
            let r = await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('7天', 3, iso(T0 + 9 * D))]) }, calls, { now: () => T0 + 2 * D }), onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r.ok, calls.length, tries(events)], [true, 1, ['claude:sonnet']])
            assert.strict.deepEqual(Object.keys(store.state().quota || {}), [])
        })

        it('now恰等於until即視為過期(now<until才略過)', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + H))]) }) })
            let calls = []
            await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([]) }, calls, { now: () => T0 + H - 1 }) })
            assert.strict.deepEqual(calls.length, 0)
            await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([]) }, calls, { now: () => T0 + H }) })
            assert.strict.deepEqual(calls.length, 1)
        })

        it('調高門檻後, 以新門檻重判入帳之視窗: 96%在claudeMax 99下不再略過(帳作廢並重查)', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('7天', 96, iso(T0 + 2 * D))]) }) })
            let calls = []
            let r = await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('7天', 96, iso(T0 + 2 * D))]) }, calls, { now: () => T0 + H, claudeMax: 99 }) })
            assert.strict.deepEqual([r.ok, calls.length], [true, 1])
        })

        it('until上限8天: 逾者截斷為now+8天; 入帳之until亦不可信地超過上限時(時鐘回撥等)忽略並重查', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 30 * D))]) }) })
            assert.strict.deepEqual(store.state().quota.claude.until, iso(T0 + 8 * D))
            //帳被改成遠超上限(如時鐘回撥後讀回): 忽略, 回到讀者
            let st = store.state()
            st.quota.claude.until = iso(T0 + 100 * D)
            st.quota.claude.windows = []
            store.set(st)
            let calls = []
            let r = await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([]) }, calls, { now: () => T0 + H }) })
            assert.strict.deepEqual([r.ok, calls.length], [true, 1])
        })

        it('store無效(未給／缺get或set／拋錯)時退回行程內記憶體: 同一行程內第二次呼叫仍略過且不查讀者', async function() {
            for (let badStore of [undefined, {}, { get: () => null }, { set: () => {} }]) {
                let prov = [claudeE()]
                let withStore = (o) => ({ providers: prov, ...(badStore === undefined ? {} : { store: badStore }), ...o })
                await dispatchAiFallback('abc', withStore({ quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 2 * D))]) }) }))
                let calls = []
                let r = await dispatchAiFallback('abc', withStore({ quotaGate: mkGate({ claude: okQuota([]) }, calls, { now: () => T0 + H }) }))
                assert.strict.deepEqual([r.ok, calls.length], [false, 0])
                //收尾: 令行程內記憶體之帳過期並清除, 免影響他測試(行程內記憶體為模組層共用)
                let r2 = await dispatchAiFallback('abc', withStore({ quotaGate: mkGate({ claude: okQuota([]) }, [], { now: () => T0 + 3 * D }) }))
                assert.strict.deepEqual(r2.ok, true)
            }
        })

        it('quotaGate:false(呼叫層或條目)不查讀者、不讀帳、不寫帳; 條目false優先於呼叫層物件', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 2 * D))]) }) })
            for (let cfg of [{ quotaGate: false }, { quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 2 * D))]) }), entryGate: false }]) {
                let calls = []
                let events = []
                let entry = claudeE(cfg.entryGate === false ? { quotaGate: false } : {})
                let gate = cfg.quotaGate === false ? false : mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 2 * D))]) }, calls, { now: () => T0 + H })
                let r = await dispatchAiFallback('abc', { providers: [entry], store, quotaGate: gate, onEvent: (e) => events.push(e) })
                assert.strict.deepEqual([r.ok, calls.length, events.some((e) => e.type === 'quota-skip')], [true, 0, false]) //有帳亦不擋
            }
            let st = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [claudeE({ quotaGate: false })], store: st, quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 2 * D))]) }) })
            assert.strict.deepEqual(Object.keys((st.state() || {}).quota || {}), [])
        })

        it('入帳不改變cooling／keyCooling／cursors之既有語意: 略過訂閱條目不寫條目冷卻(cooldownMs>0亦然)', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [claudeE(), plainE()], store, cooldownMs: 600000, quotaGate: mkGate({ claude: okQuota([win('7天', 99, iso(T0 + 2 * D))]) }) })
            let st = store.state()
            assert.strict.deepEqual([st.cooling, st.keyCooling], [{}, undefined])
        })
    })

    describe('B. CLI文字入帳(limit-text): Claude官方額度字樣與opt.quotaUntilOf注入', function() {

        let TEXT = 'You\'ve hit your weekly limit · resets Nov 9, 5pm (Asia/Taipei)'
        let limitFake = null
        before(function() {
            limitFake = createFakeCli('fake-subq-limit', `process.stdin.resume(); process.stdin.on('data', () => {}); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(TEXT)}); process.exit(1) })`)
        })
        after(function() {
            if (limitFake) {
                limitFake.clean()
            }
        })
        let limitE = (kind, extra = {}) => ({ id: `${kind}:lim`, kind, model: 'sonnet', exe: limitFake.exe, ...(kind === 'antigravity' ? { skipPermissions: false, addDirs: ['.'] } : {}), ...extra })
        //2026-11-06 12:00(Asia/Taipei)為「現在」, 重置為2026-11-09 17:00(+08:00)=09:00Z
        let NOW = Date.UTC(2026, 10, 6, 4, 0, 0)
        let gateAt = (readers = {}, calls = [], extra = {}) => mkGate(readers, calls, { now: () => NOW, ...extra })

        it('claude訂閱條目失敗結果命中官方字樣: 解析重置時刻入帳(鍵entry:<id>)、發quota-skip(source limit-text)、該次嘗試之tried照舊(next-key)', async function() {
            let store = mkJsonStore()
            let events = []
            let r = await dispatchAiFallback('abc', { providers: [limitE('claude'), plainE()], store, quotaGate: gateAt({ claude: okQuota([win('7天', 10, iso(NOW + D))]) }), onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r.ok, r.tried.map((t) => t.outcome)], [true, ['next-key', 'ok']])
            let q = store.state().quota
            assert.strict.deepEqual(Object.keys(q), ['entry:claude:lim'])
            assert.strict.deepEqual([q['entry:claude:lim'].until, q['entry:claude:lim'].source], ['2026-11-09T09:00:00.000Z', 'limit-text'])
            let ev = events.filter((e) => e.type === 'quota-skip')
            assert.strict.deepEqual(ev.map((e) => [e.source, e.until, e.providerId]), [['limit-text', '2026-11-09T09:00:00.000Z', 'claude:lim']])
        })

        it('跨行程: 文字入帳後新建遞補(同store)略過該條目、不呼叫轉接器、不查讀者(source ledger); 其他條目不受影響', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [limitE('claude')], store, quotaGate: gateAt({ claude: okQuota([]) }) })
            let calls = []
            let events = []
            let r = await dispatchAiFallback('abc', { providers: [limitE('claude'), claudeE({ id: 'claude:other' })], store, quotaGate: gateAt({ claude: okQuota([]) }, calls, { now: () => NOW + H }), onEvent: (e) => events.push(e) })
            assert.strict.deepEqual([r.ok, r.providerId, tries(events)], [true, 'claude:other', ['claude:other']])
            assert.strict.deepEqual(events.filter((e) => e.type === 'quota-skip').map((e) => [e.source, e.providerId]), [['ledger', 'claude:lim']])
            assert.strict.deepEqual(calls.map((c) => c[0]), ['claude']) //claude:other之家族用量查詢(不在帳內); claude:lim未查
        })

        it('不入帳: 無時區／無resets／無法解析之字樣、validation失敗、quotaGate:false、索引式id、帶金鑰之claude、成功結果', async function() {
            let cases = []
            let mkFake = (name, text, code = 1) => createFakeCli(name, `process.stdin.resume(); process.stdin.on('data', () => {}); process.stdin.on('end', () => { process.stdout.write(${JSON.stringify(text)}); process.exit(${code}) })`)
            let fk = [
                mkFake('fake-subq-limit-a', 'You\'ve hit your weekly limit · resets Nov 9, 5pm'),
                mkFake('fake-subq-limit-b', 'You\'ve hit your weekly limit'),
                mkFake('fake-subq-limit-c', 'You\'ve hit your weekly limit · resets soon (Asia/Taipei)'),
                mkFake('fake-subq-limit-d', 'You\'ve hit your weekly limit · resets Nov 9, 5pm (Not/AZone)'),
            ]
            try {
                for (let f of fk) {
                    let store = mkJsonStore()
                    await dispatchAiFallback('abc', { providers: [{ id: 'claude:x', kind: 'claude', model: 'sonnet', exe: f.exe }], store, quotaGate: gateAt({ claude: okQuota([]) }) })
                    cases.push(Object.keys((store.state() || {}).quota || {}))
                }
                //quotaGate:false
                let s1 = mkJsonStore()
                await dispatchAiFallback('abc', { providers: [limitE('claude')], store: s1, quotaGate: false })
                cases.push(Object.keys((s1.state() || {}).quota || {}))
                //索引式id(未明給id)
                let s2 = mkJsonStore()
                await dispatchAiFallback('abc', { providers: [{ kind: 'claude', model: 'sonnet', exe: limitFake.exe }], store: s2, quotaGate: gateAt({ claude: okQuota([]) }) })
                cases.push(Object.keys((s2.state() || {}).quota || {}))
                //帶金鑰之claude(API計費)
                let s3 = mkJsonStore()
                await dispatchAiFallback('abc', { providers: [limitE('claude', { keys: ['sk-ant-api03-AAAAAAAAAAAAAAAA'] })], store: s3, quotaGate: gateAt({ claude: okQuota([]) }) })
                cases.push(Object.keys((s3.state() || {}).quota || {}))
                //成功結果即使含字樣也不處理
                let okFake = mkFake('fake-subq-limit-ok', TEXT, 0)
                try {
                    let s4 = mkJsonStore()
                    await dispatchAiFallback('abc', { providers: [{ id: 'claude:ok', kind: 'claude', model: 'sonnet', exe: okFake.exe }], store: s4, quotaGate: gateAt({ claude: okQuota([]) }) })
                    cases.push(Object.keys((s4.state() || {}).quota || {}))
                }
                finally {
                    okFake.clean()
                }
            }
            finally {
                for (let f of fk) {
                    f.clean()
                }
            }
            assert.strict.deepEqual(cases, [[], [], [], [], [], [], [], []])
        })

        it('codex／antigravity不內建字樣(不猜): 同一字樣不入帳; 經opt.quotaUntilOf注入判定函數才入帳(收到完整失敗結果; 回Date／ISO字串／毫秒數皆可; 回null、拋錯、回Promise、無效值皆不入帳)', async function() {
            let run = async (kind, hook) => {
                let store = mkJsonStore()
                let seen = []
                await dispatchAiFallback('abc', {
                    providers: [limitE(kind)],
                    store,
                    quotaGate: gateAt({ codex: okQuota([]), antigravity: okQuota([]) }),
                    ...(hook
                        ? {
                            quotaUntilOf: (r) => {
                                seen.push(r); return hook(r)
                            }
                        }
                        : {})
                })
                return { q: (store.state() || {}).quota || {}, seen }
            }
            for (let kind of ['codex', 'antigravity']) {
                assert.strict.deepEqual(Object.keys((await run(kind, null)).q), [])
                let a = await run(kind, () => new Date(NOW + 2 * H))
                assert.strict.deepEqual([Object.keys(a.q), a.q[`entry:${kind}:lim`].until, a.q[`entry:${kind}:lim`].source], [[`entry:${kind}:lim`], iso(NOW + 2 * H), 'limit-text'])
                assert.strict.deepEqual([typeof a.seen[0].stdout, a.seen[0].ok], ['string', false])
                assert.strict.deepEqual((await run(kind, () => iso(NOW + 3 * H))).q[`entry:${kind}:lim`].until, iso(NOW + 3 * H))
                assert.strict.deepEqual((await run(kind, () => NOW + 4 * H)).q[`entry:${kind}:lim`].until, iso(NOW + 4 * H))
                for (let bad of [() => null, () => undefined, () => {
                    throw new Error('x')
                }, () => Promise.resolve(new Date(NOW + H)), () => 'not a date', () => NaN, () => new Date(NaN), () => NOW - H]) {
                    assert.strict.deepEqual(Object.keys((await run(kind, bad)).q), [])
                }
            }
        })

        it('注入之quotaUntilOf優先於內建Claude字樣解析; 入帳之until上限8天(截斷)', async function() {
            let store = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [limitE('claude')], store, quotaGate: gateAt({ claude: okQuota([]) }), quotaUntilOf: () => new Date(NOW + 20 * D) })
            assert.strict.deepEqual(store.state().quota['entry:claude:lim'].until, iso(NOW + 8 * D))
            let s2 = mkJsonStore()
            await dispatchAiFallback('abc', { providers: [limitE('claude')], store: s2, quotaGate: gateAt({ claude: okQuota([]) }), quotaUntilOf: () => new Date(NOW + 2 * H) })
            assert.strict.deepEqual(s2.state().quota['entry:claude:lim'].until, iso(NOW + 2 * H))
        })

        it('quotaUntilOf為本層自用鍵: 不轉傳轉接器(假CLI收到之args不含該鍵之痕跡)、非函數視為未給', async function() {
            let store = mkJsonStore()
            let r = await dispatchAiFallback('abc', { providers: [claudeE()], store, quotaGate: mkGate({ claude: okQuota([]) }), quotaUntilOf: 'not a function' })
            assert.strict.deepEqual(r.ok, true)
            assert.strict.deepEqual(JSON.stringify(JSON.parse(r.stdout).args).includes('quotaUntilOf'), false)
        })
    })
})
