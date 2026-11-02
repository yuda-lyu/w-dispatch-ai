import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import createAiCaller from '../src/createAiCaller.mjs'
import logAiOutcome, { createAiEventLogger } from '../src/wkf/logAiOutcome.mjs'
import createUsageCounter from '../src/wkf/createUsageCounter.mjs'
import makeArrayCoverageValidator from '../src/wkf/makeArrayCoverageValidator.mjs'
import providersAll from '../src/providers.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import fakeServerForCallerTest from './tools/fakeServerForCallerTest.mjs'


// unit-createAiCaller.test.mjs — 原始遞補呼叫器(2026-11-01 da40, Gitea #40; 帳本R-CALLER-1)
//
// 規格來源: 建議檔§2（行為契約）與主控裁定（與工作流callAiWithFallback並存、內部改取resolveCatalogue、onUsage保留）:
//   createAiCaller({ pick, env, envFile, catalogue, extraProviders, exes, patch, providerTimeouts, timeoutMs, maxRetries, budgetMs, minAttemptMs,
//     cooldownMs, coolDetect, cwd, store, onUsage, onEvent }) → { callAI, providers, skipped(字樣`${id}（${envVar} 無金鑰）`), missing, hints };
//   callAI(prompt, { timeoutMs, validate, acceptTruncated, onEvent }): 零供應商回與套件同形之失敗
//     { ok:false, stdout:'', stderr:'', code:null, durationMs:0, attempts:0, error:'無可用的 AI 供應商'＋（skipped以、相接; 無skipped則無括號; missing不進error）, tried:[], providersSkipped, providersMissing };
//     否則回dispatchAiFallback原始結果並掛providersSkipped／providersMissing; acceptTruncated僅布林時透傳;
//     onEvent包一層: type==='try'時呼叫onUsage(providerId), 再轉呼建構期onEvent與逐次onEvent; 不掛NO_SIDE_EFFECT前綴、不解析JSON。
// 逐次預算(2026-11-02 da52, Gitea #52; 帳本R-CALLER-1-6): callAI(prompt, { …, budgetMs })——有效(正整數)時本次budgetMs＝min(建構值 ?? Infinity, 逐次值),
//   只能收緊、不得放寬; 未給／null／非法視為未給(與timeoutMs之castPintOr同法); dispatchAiFallback之budgetMs／minAttemptMs語意不變。
// 全程以本機替身端點與假CLI實跑, 不連外網。


let TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'createAiCaller')

//ent, 指向替身端點之REST條目（自帶keys, 不經envVar）
let svr = null
let ent = (id, model, extra = {}) => ({ id, kind: 'api-openai-compat', baseURL: svr.url, model, keys: [`k-${id}`], ...extra })

//memStore, 行程內store（各caller獨立, 不共用套件預設之行程內狀態）
let memStore = () => {
    let st = { cursors: {} }
    return {
        get: () => st,
        set: (s) => {
            st = s
        },
        peek: () => st
    }
}

//reqOf, 替身端點收到的某model之請求
let reqOf = (model) => svr.requests.filter((r) => r.model === model)

//reqOfKey, 替身端點收到的某條目(以其自帶金鑰k-<id>辨識)之請求
let reqOfKey = (id) => svr.requests.filter((r) => r.auth.includes(`k-${id}`))

//probeSeq, probeBudget之條目編號
let probeSeq = 0

//probeBudget, 觀察本次callAI實際交給dispatchAiFallback之budgetMs:
//  建構期minAttemptMs設為極大, 有預算時首次嘗試前即發budget-out事件(不送請求、無計時器), 其remainingMs＝budgetMs扣去建立deadline至檢查之耗時;
//  無預算(budgetMs不限)時minAttemptMs不作用, 照常送出請求而無budget-out事件, 回remainingMs為null
let probeBudget = async (ctorOpt, callOpt) => {
    probeSeq++
    let id = `t:bp${probeSeq}`
    let c = createAiCaller({ extraProviders: [ent(id, 'echo')], pick: [id], store: memStore(), minAttemptMs: 1000000000, ...ctorOpt })
    let outs = []
    let r = await c.callAI('go', {
        ...callOpt,
        onEvent: (ev) => {
            if (ev.type === 'budget-out') {
                outs.push(ev.remainingMs)
            }
        }
    })
    return { r, remainingMs: outs.length > 0 ? outs[0] : null, budgetOuts: outs.length, sent: reqOfKey(id).length }
}

//isNear, remainingMs是否為expected扣去極小耗時(30秒內)之值; budgetMs間距皆遠大於30秒, 足以分辨取用哪個值
let isNear = (remainingMs, expected) => typeof remainingMs === 'number' && remainingMs <= expected && remainingMs > expected - 30000


describe('createAiCaller', function() {

    let fake = null

    before(async function() {
        svr = await fakeServerForCallerTest()
        fake = createFakeCli('fake-aicaller')
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(async function() {
        if (svr) {
            await svr.close()
        }
        if (fake) {
            fake.clean()
        }
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    describe('建構與回傳形狀', function() {

        // 現有測試意圖: opt非物件仍可建構
        it('opt非物件或省略仍可建構: 回{ callAI, providers, skipped, missing, hints }', function() {
            for (let o of [undefined, null, 'x', 5, [], {}]) {
                let c = createAiCaller(o)
                assert.strict.deepEqual(Object.keys(c), ['callAI', 'providers', 'skipped', 'missing', 'hints'])
                assert.strict.equal(typeof c.callAI, 'function')
                assert.strict.equal(Array.isArray(c.providers) && Array.isArray(c.skipped) && Array.isArray(c.missing), true)
            }
        })

        it('extraProviders不合規時建構throw（同resolveCatalogue）', function() {
            assert.throws(() => createAiCaller({ extraProviders: 'x' }), { message: 'ai.extraProviders 須為陣列' })
            assert.throws(() => createAiCaller({ extraProviders: [{ kind: 'claude' }] }), { message: 'ai.extraProviders[0] 須為含 id 之條目物件' })
        })

        // 建議檔 現有測試: extraProviders／exes／patch／providerTimeouts
        it('目錄展開共用: extraProviders追加與覆蓋、pick順序、exes、patch、逐id逾時＋全域逾時，皆反映在providers', function() {
            let c = createAiCaller({
                catalogue: [{ id: 'c1', kind: 'claude', model: 'sonnet' }, { id: 'x1', kind: 'codex', model: 'm1' }],
                extraProviders: [{ id: 'x1', model: 'm2' }, { id: 'n1', kind: 'opencode', model: 'o1' }],
                pick: ['n1', 'c1', 'x1'],
                exes: { claude: 'C:/bin/claude.exe' },
                patch: { c1: { effort: 'high' } },
                providerTimeouts: { x1: 5000 },
                timeoutMs: 300000,
            })
            assert.strict.deepEqual(c.providers, [
                { id: 'n1', kind: 'opencode', model: 'o1', timeoutMs: 300000 },
                { id: 'c1', kind: 'claude', model: 'sonnet', exe: 'C:/bin/claude.exe', effort: 'high', timeoutMs: 300000 },
                { id: 'x1', kind: 'codex', model: 'm2', timeoutMs: 5000 },
            ])
            assert.strict.deepEqual([c.skipped, c.missing, c.hints], [[], [], {}])
        })

        // 建議檔 現有測試: 缺金鑰列skipped、未知id列missing不拋
        it('缺金鑰列入skipped（字樣id（ENVVAR 無金鑰））；pick未知id列入missing並附hints，皆不throw', function() {
            let c = createAiCaller({
                env: {},
                extraProviders: [ent('t:nokey', 'echo', { keys: undefined, envVar: 'DA40_NOKEY_KEYS' })],
                pick: ['t:nokey', 'claude/sonnet', 'claude:sonnet'],
            })
            assert.strict.deepEqual(c.providers.map((p) => p.id), ['claude:sonnet'])
            assert.strict.deepEqual(c.skipped, ['t:nokey（DA40_NOKEY_KEYS 無金鑰）'])
            assert.strict.deepEqual(c.missing, ['claude/sonnet'])
            assert.strict.deepEqual(c.hints, { 'claude/sonnet': 'claude:sonnet' })
        })

        it('pick省略: 全取內建目錄（依env展開）；providers含金鑰（為解析後條目）', function() {
            let c = createAiCaller({ env: { AGNES_KEYS: 'a1,a2' } })
            let agnes = c.providers.find((p) => p.id === 'agnes:agnes-3.0-flash')
            assert.strict.deepEqual(agnes.keys, ['a1', 'a2'])
            assert.strict.equal(c.providers.length + c.skipped.length, providersAll.length)
        })

        it('條目於建構時解析一次: 建構後改動env物件不影響已建之providers與呼叫', async function() {
            let env = { DA40_ONCE_KEYS: 'first' }
            let c = createAiCaller({ env, catalogue: [{ id: 't:once', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', envVar: 'DA40_ONCE_KEYS' }], pick: ['t:once'], store: memStore() })
            env.DA40_ONCE_KEYS = 'second'
            let r = await c.callAI('hello')
            assert.strict.equal(r.ok, true)
            assert.strict.equal(JSON.parse(r.stdout).auth, 'Bearer first')
        })

    })

    describe('零供應商', function() {

        // 建議檔§7-3
        it('pick全為未知id: callAI回同形失敗（ok false、attempts 0、providersMissing），且logAiOutcome以ERROR記providerPick有無效id', async function() {
            let c = createAiCaller({ pick: ['no-such-id'] })
            let r = await c.callAI('x')
            assert.strict.deepEqual(Object.keys(r), ['ok', 'stdout', 'stderr', 'code', 'durationMs', 'attempts', 'error', 'tried', 'providersSkipped', 'providersMissing'])
            assert.strict.equal(r.ok, false)
            assert.strict.equal(r.attempts, 0)
            assert.strict.deepEqual([r.stdout, r.stderr, r.code, r.durationMs, r.tried], ['', '', null, 0, []])
            assert.strict.equal(r.error, '無可用的 AI 供應商') //只有missing: 無skipped則無括號, missing不進error（Gitea #42 §4）
            assert.strict.deepEqual([r.providersSkipped, r.providersMissing], [[], ['no-such-id']])
            let lines = []
            logAiOutcome({ result: r, log: { log: (m) => lines.push(['INFO', m]), logWarn: (m) => lines.push(['WARN', m]), logError: (m) => lines.push(['ERROR', m]) } })
            assert.strict.deepEqual(lines, [['ERROR', 'providerPick 有無效 id → no-such-id（請對照供應商目錄）']])
        })

        it('全部缺金鑰: 同形失敗並帶providersSkipped；失敗原因字樣含缺金鑰條目', async function() {
            let c = createAiCaller({ env: {}, catalogue: [{ id: 'a', kind: 'claude', envVar: 'DA40_A_KEYS' }, { id: 'b', kind: 'claude', envVar: 'DA40_B_KEYS' }] })
            let r = await c.callAI('x')
            assert.strict.deepEqual([r.ok, r.attempts, r.tried], [false, 0, []])
            assert.strict.deepEqual(r.providersSkipped, ['a（DA40_A_KEYS 無金鑰）', 'b（DA40_B_KEYS 無金鑰）'])
            assert.strict.equal(r.error, '無可用的 AI 供應商（a（DA40_A_KEYS 無金鑰）、b（DA40_B_KEYS 無金鑰））')
        })

        it('同時有缺金鑰與pick查無、以及條目清單為空: error只列skipped（以「、」相接），missing由providersMissing表達；無skipped則無括號', async function() {
            let c = createAiCaller({ env: {}, catalogue: [{ id: 'a', kind: 'claude', envVar: 'DA40_A_KEYS' }], pick: ['a', 'zz'] })
            let r = await c.callAI('x')
            assert.strict.equal(r.error, '無可用的 AI 供應商（a（DA40_A_KEYS 無金鑰））')
            assert.strict.deepEqual([r.providersSkipped, r.providersMissing], [['a（DA40_A_KEYS 無金鑰）'], ['zz']])
            let e = await createAiCaller({ catalogue: [] }).callAI('x')
            assert.strict.equal(e.error, '無可用的 AI 供應商')
        })

        it('零供應商之失敗不含金鑰與envVar值（只列id與變數名）', async function() {
            let c = createAiCaller({ env: { DA40_SEC_KEYS: '' }, catalogue: [{ id: 'a', kind: 'claude', envVar: 'DA40_SEC_KEYS' }] })
            let r = await c.callAI('x')
            assert.strict.equal(JSON.stringify(r).includes('Bearer'), false)
        })

        it('零供應商時prompt無效亦同形失敗（不reject）；providersSkipped為每次呼叫之新陣列', async function() {
            let c = createAiCaller({ pick: ['zz'] })
            let r1 = await c.callAI('')
            r1.providersMissing.push('mutated')
            let r2 = await c.callAI('x')
            assert.strict.deepEqual([r1.ok, r2.providersMissing, c.missing], [false, ['zz'], ['zz']])
        })

    })

    describe('callAI', function() {

        // 現有測試意圖: o非物件與省略一致
        it('第二參數非物件與省略一致（皆走預設逐次設定）', async function() {
            let c = createAiCaller({ extraProviders: [ent('t:o', 'echo')], pick: ['t:o'], store: memStore() })
            let pick = (r) => [r.ok, r.providerId, r.keyIndex, JSON.parse(r.stdout).prompt, r.providersSkipped, r.providersMissing]
            let base = pick(await c.callAI('same'))
            for (let o of [null, 'x', 5, []]) {
                assert.strict.deepEqual(pick(await c.callAI('same', o)), base)
            }
        })

        it('回dispatchAiFallback原始結果並掛providersSkipped／providersMissing（不解析、不加前綴）', async function() {
            let c = createAiCaller({
                env: {},
                extraProviders: [ent('t:raw', 'echo'), ent('t:nokey', 'echo', { keys: undefined, envVar: 'DA40_NOKEY_KEYS' })],
                pick: ['t:nokey', 't:raw', 'miss-id'],
                store: memStore(),
            })
            let r = await c.callAI('PROMPT-ASIS')
            assert.strict.equal(r.ok, true)
            assert.strict.deepEqual([r.providerId, r.keyIndex, r.kind, r.model], ['t:raw', 0, 'api-openai-compat', 'echo'])
            assert.strict.deepEqual(r.usage, { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33, completion_tokens_details: { reasoning_tokens: 5 } })
            assert.strict.equal(r.tried.length, 1)
            assert.strict.equal(r.tried[0].outcome, 'ok')
            assert.strict.deepEqual([r.providersSkipped, r.providersMissing], [['t:nokey（DA40_NOKEY_KEYS 無金鑰）'], ['miss-id']])
            //不解析: 結果無json欄位, stdout為原始字串
            assert.strict.equal('json' in r, false)
            assert.strict.equal(typeof r.stdout, 'string')
            //不加前綴: 送出之prompt即呼叫端所給
            assert.strict.deepEqual(reqOf('echo').filter((q) => q.prompt === 'PROMPT-ASIS').length >= 1, true)
            assert.strict.equal(JSON.parse(r.stdout).prompt, 'PROMPT-ASIS')
        })

        it('prompt無效: 不reject，回dispatchAiFallback之失敗並仍掛providersSkipped／providersMissing', async function() {
            let c = createAiCaller({ extraProviders: [ent('t:p', 'echo')], pick: ['t:p', 'zz'] })
            for (let p of ['', null, undefined, 5]) {
                let r = await c.callAI(p)
                assert.strict.deepEqual([r.ok, r.error, r.providersMissing], [false, 'prompt must be a non-empty string', ['zz']])
            }
        })

        it('依pick順序遞補: 前一家失敗換下一家，tried記載歷程；金鑰輪替游標走建構期store', async function() {
            let store = memStore()
            let c = createAiCaller({ extraProviders: [ent('t:f1', 'err-500'), ent('t:f2', 'echo', { keys: ['ka', 'kb'] })], pick: ['t:f1', 't:f2'], store })
            let r = await c.callAI('go')
            assert.strict.deepEqual([r.ok, r.providerId, r.keyIndex], [true, 't:f2', 0])
            assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.outcome]), [['t:f1', 'next-key'], ['t:f2', 'ok']])
            assert.strict.equal(store.peek().cursors['t:f2'], 1) //成功後游標推進（store有透傳）
            let r2 = await c.callAI('go2')
            assert.strict.equal(r2.keyIndex, 1) //第二次從下一把起
        })

        // 建議檔 現有測試: validate逐次給
        it('validate逐次給: 不合格即整組跳過換下一家；合格即放行（嚴格涵蓋率驗證器可直接作validate）', async function() {
            let c = createAiCaller({ extraProviders: [ent('t:v1', 'arr-part'), ent('t:v2', 'arr-full')], pick: ['t:v1', 't:v2'], store: memStore() })
            let reasons = []
            let validate = makeArrayCoverageValidator({ indices: [1, 2], contentFields: ['t'], onReject: (m) => reasons.push(m) })
            let r = await c.callAI('go', { validate })
            assert.strict.deepEqual([r.ok, r.providerId], [true, 't:v2'])
            assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.outcome, t.errorType]), [['t:v1', 'skip-group', 'validation'], ['t:v2', 'ok', undefined]])
            assert.strict.deepEqual(reasons, ['未涵蓋編號 2（缺項或內容為空）'])
            //未給validate: 第一家即成
            let r2 = await c.callAI('go')
            assert.strict.deepEqual([r2.ok, r2.providerId], [true, 't:v1'])
        })

    })

    describe('截斷放行（替身端點實跑）', function() {

        // 建議檔 現有測試: acceptTruncated給true時截斷內容交validate放行並標truncated, 未給依上游預設判incomplete; logAiOutcome加註截斷放行
        it('acceptTruncated給true: 截斷內容交validate、放行並標truncated；logAiOutcome加註截斷內容放行', async function() {
            let c = createAiCaller({ extraProviders: [ent('t:tr1', 'arr-trunc')], pick: ['t:tr1'], store: memStore() })
            let seen = []
            let r = await c.callAI('go', {
                acceptTruncated: true,
                validate: (s) => {
                    seen.push(s)
                    return true
                }
            })
            assert.strict.deepEqual([r.ok, r.truncated, r.finishReason], [true, true, 'length'])
            assert.strict.deepEqual(seen, ['[{"index":1,"t":"a"},{"index":2,"t":"b"},{"index":3,"t":'])
            let lines = []
            logAiOutcome({ result: r, log: { log: (m) => lines.push(m) } })
            assert.strict.equal(lines[0], '使用 AI t:tr1／key#1（api-openai-compat／arr-trunc，tokens 11+22（含思考 5）；截斷內容放行（finish_reason=length））')
        })

        it('acceptTruncated未給、false或非布林: 依上游預設判incomplete（validate不被呼叫）', async function() {
            let c = createAiCaller({ extraProviders: [ent('t:tr2', 'arr-trunc')], pick: ['t:tr2'], store: memStore() })
            let called = 0
            let validate = () => {
                called++
                return true
            }
            for (let o of [{ validate }, { validate, acceptTruncated: false }, { validate, acceptTruncated: 'yes' }, { validate, acceptTruncated: 1 }, { validate, acceptTruncated: null }]) {
                let r = await c.callAI('go', o)
                assert.strict.deepEqual([r.ok, r.errorType], [false, 'incomplete'])
            }
            assert.strict.equal(called, 0)
        })

        it('acceptTruncated為true但嚴格驗證器不收截斷陣列: 整體不合格（嚴格版不搶救半成品；截斷且驗證不過者上游維持incomplete）', async function() {
            let c = createAiCaller({ extraProviders: [ent('t:tr3', 'arr-trunc')], pick: ['t:tr3'], store: memStore() })
            let reasons = []
            let r = await c.callAI('go', { acceptTruncated: true, validate: makeArrayCoverageValidator({ indices: [1], onReject: (m) => reasons.push(m) }) })
            assert.strict.deepEqual([r.ok, r.errorType, r.truncated], [false, 'incomplete', true])
            assert.strict.deepEqual(reasons, ['非 JSON 陣列或輸出截斷']) //驗證器確實被呼叫並拒收
        })

    })

    describe('用量與事件', function() {

        it('onUsage於每次實際嘗試（try事件）以providerId呼叫；成功與其他事件不呼叫', async function() {
            let usage = []
            let c = createAiCaller({ extraProviders: [ent('t:u1', 'err-500'), ent('t:u2', 'echo')], pick: ['t:u1', 't:u2'], store: memStore(), onUsage: (id) => usage.push(id) })
            await c.callAI('go')
            assert.strict.deepEqual(usage, ['t:u1', 't:u2'])
        })

        it('事件順序: try事件先onUsage、再建構期onEvent、再逐次onEvent；三者拋錯或回傳Promise互不影響', async function() {
            let seq = []
            let unhandled = []
            let h = (e) => unhandled.push(e)
            process.on('unhandledRejection', h)
            try {
                let c = createAiCaller({
                    extraProviders: [ent('t:e1', 'echo')],
                    pick: ['t:e1'],
                    store: memStore(),
                    onUsage: (id) => {
                        seq.push(['usage', id])
                        throw new Error('usage boom')
                    },
                    onEvent: (ev) => {
                        seq.push(['ctor', ev.type])
                        return Promise.reject(new Error('ctor async boom'))
                    },
                })
                let r = await c.callAI('go', {
                    onEvent: (ev) => {
                        seq.push(['call', ev.type])
                    }
                })
                assert.strict.equal(r.ok, true)
                await new Promise((resolve) => setTimeout(resolve, 20))
            }
            finally {
                process.off('unhandledRejection', h)
            }
            assert.strict.deepEqual(seq, [['usage', 't:e1'], ['ctor', 'try'], ['call', 'try'], ['ctor', 'ok'], ['call', 'ok']])
            assert.strict.deepEqual(unhandled, [])
        })

        it('onUsage與onEvent非函數（或兩者皆無）: 忽略不throw', async function() {
            let c = createAiCaller({ extraProviders: [ent('t:e2', 'echo')], pick: ['t:e2'], store: memStore(), onUsage: 'x', onEvent: 5 })
            let r = await c.callAI('go', { onEvent: {} })
            assert.strict.equal(r.ok, true)
        })

        // 主控裁定: onUsage與createUsageCounter(...).onEvent等價（記到條目時）
        it('onUsage與createUsageCounter({ keyOf: (ev)=>ev.providerId }).onEvent於相同呼叫下記帳一致', async function() {
            let entries = [ent('t:q1', 'err-500'), ent('t:q2', 'echo')]
            let ids = []
            let c1 = createAiCaller({ extraProviders: entries, pick: ['t:q1', 't:q2'], store: memStore(), onUsage: (id) => ids.push(id) })
            let counter = createUsageCounter({ dir: TMP, keyOf: (ev) => ev.providerId, getDate: () => '2026-11-01' })
            let c2 = createAiCaller({ extraProviders: entries, pick: ['t:q1', 't:q2'], store: memStore(), onEvent: counter.onEvent })
            for (let i = 0; i < 3; i++) {
                await c1.callAI('go')
                await c2.callAI('go')
            }
            let byOnUsage = {}
            for (let id of ids) {
                byOnUsage[id] = (byOnUsage[id] || 0) + 1
            }
            assert.strict.deepEqual(counter.today().byKey, byOnUsage)
            assert.strict.deepEqual(byOnUsage, { 't:q1': 3, 't:q2': 3 })
        })

        it('冷卻事件可經createAiEventLogger寫成日誌（cooldownMs＋限流429；條目降序記入store）', async function() {
            let store = memStore()
            let lines = []
            let c = createAiCaller({
                extraProviders: [ent('t:cd1', 'err-429')],
                pick: ['t:cd1'],
                store,
                cooldownMs: 600000,
                onEvent: createAiEventLogger({ log: { logWarn: (m) => lines.push(m) } }),
            })
            let r = await c.callAI('go')
            assert.strict.equal(r.ok, false)
            assert.strict.equal(typeof store.peek().cooling['t:cd1'], 'number')
            assert.strict.equal(lines.length, 1)
            assert.strict.equal(lines[0].startsWith('AI 供應商進入冷卻 → t:cd1（'), true)
        })

    })

    describe('建構期設定之透傳', function() {

        it('coolDetect＋cooldownMs: 非內建觸發（500）經coolDetect判定亦冷卻；未給cooldownMs則不冷卻', async function() {
            let s1 = memStore()
            let c1 = createAiCaller({ extraProviders: [ent('t:cdt1', 'err-500')], pick: ['t:cdt1'], store: s1, cooldownMs: 60000, coolDetect: () => true })
            await c1.callAI('go')
            assert.strict.equal(typeof s1.peek().cooling['t:cdt1'], 'number')
            let s2 = memStore()
            let c2 = createAiCaller({ extraProviders: [ent('t:cdt2', 'err-500')], pick: ['t:cdt2'], store: s2, coolDetect: () => true })
            await c2.callAI('go')
            assert.strict.equal(s2.peek().cooling['t:cdt2'], undefined)
        })

        it('budgetMs／minAttemptMs: 預算低於最低嘗試門檻即budget exhausted（不送請求）；調低minAttemptMs即可嘗試', async function() {
            let before = reqOf('echo').length
            let c1 = createAiCaller({ extraProviders: [ent('t:b1', 'echo')], pick: ['t:b1'], store: memStore(), budgetMs: 10 })
            let r1 = await c1.callAI('go')
            assert.strict.deepEqual([r1.ok, r1.error, r1.errorType], [false, 'budget exhausted', 'budget'])
            assert.strict.equal(reqOf('echo').length, before)
            let c2 = createAiCaller({ extraProviders: [ent('t:b2', 'echo')], pick: ['t:b2'], store: memStore(), budgetMs: 5000, minAttemptMs: 1 })
            let r2 = await c2.callAI('go')
            assert.strict.equal(r2.ok, true)
        })

        it('maxRetries: 給1時失敗請求重試一次（共2次）；未給不重試（共1次）', async function() {
            let n0 = reqOf('err-500').length
            let c0 = createAiCaller({ extraProviders: [ent('t:mr0', 'err-500')], pick: ['t:mr0'], store: memStore() })
            await c0.callAI('go')
            assert.strict.equal(reqOf('err-500').length - n0, 1)
            let n1 = reqOf('err-500').length
            let c1 = createAiCaller({ extraProviders: [ent('t:mr1', 'err-500')], pick: ['t:mr1'], store: memStore(), maxRetries: 1 })
            await c1.callAI('go') //重試間隔為retryDelayMs(5秒)乘次數, 約5秒
            assert.strict.equal(reqOf('err-500').length - n1, 2)
        })

        // 建議檔 現有測試: 逾時三層
        it('逾時: 建構期timeoutMs寫入各條目而優先於逐次timeoutMs；未給建構期逾時時逐次timeoutMs生效', async function() {
            let t0 = Date.now()
            let c1 = createAiCaller({ extraProviders: [ent('t:to1', 'slow')], pick: ['t:to1'], store: memStore(), timeoutMs: 300 })
            let r1 = await c1.callAI('go', { timeoutMs: 60000 })
            assert.strict.deepEqual([r1.ok, r1.errorType, r1.error.startsWith('TIMEOUT')], [false, 'timeout', true])
            let c2 = createAiCaller({ extraProviders: [ent('t:to2', 'slow')], pick: ['t:to2'], store: memStore() })
            let r2 = await c2.callAI('go', { timeoutMs: 300 })
            assert.strict.deepEqual([r2.ok, r2.errorType], [false, 'timeout'])
            assert.strict.equal(Date.now() - t0 < 8000, true)
        })

        it('逐id逾時（providerTimeouts）只作用於該條目: 逾時的整組跳過、換下一家成功', async function() {
            let c = createAiCaller({ extraProviders: [ent('t:pt1', 'slow'), ent('t:pt2', 'echo')], pick: ['t:pt1', 't:pt2'], store: memStore(), providerTimeouts: { 't:pt1': 300 } })
            let r = await c.callAI('go')
            assert.strict.deepEqual([r.ok, r.providerId], [true, 't:pt2'])
            assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.outcome, t.errorType]), [['t:pt1', 'skip-group', 'timeout'], ['t:pt2', 'ok', undefined]])
        })

        // exes與cwd以假CLI實跑證明確實到達子進程
        it('exes與cwd: 以假CLI實跑，執行檔路徑經exes注入、工作目錄為建構期cwd、prompt原樣（無前綴）', async function() {
            let c = createAiCaller({
                catalogue: [{ id: 't:cli', kind: 'claude', model: 'sonnet' }],
                pick: ['t:cli'],
                exes: { claude: fake.exe },
                cwd: TMP,
                store: memStore(),
            })
            assert.strict.equal(c.providers[0].exe, fake.exe)
            let r = await c.callAI('CLI-PROMPT-ASIS')
            assert.strict.equal(r.ok, true)
            let echo = JSON.parse(r.stdout)
            assert.strict.equal(path.resolve(echo.cwd), path.resolve(TMP))
            assert.strict.equal(echo.stdin, 'CLI-PROMPT-ASIS')
        })

    })

    describe('逐次budgetMs（Gitea #52; 帳本R-CALLER-1-6）', function() {

        // 建議檔§1.4案1／主控裁定: 逐次小於建構 → 本次用逐次值
        it('逐次budgetMs小於建構budgetMs: 交dispatchAiFallback之budgetMs為逐次值（收緊）', async function() {
            let p = await probeBudget({ budgetMs: 600000 }, { budgetMs: 120000 })
            assert.strict.deepEqual([p.r.ok, p.r.errorType, p.r.error, p.budgetOuts, p.sent], [false, 'budget', 'budget exhausted', 1, 0])
            assert.strict.equal(isNear(p.remainingMs, 120000), true, `remainingMs=${p.remainingMs}`)
        })

        // 建議檔§1.4案2／主控裁定: 逐次大於建構 → 仍為建構值（只能收緊、不得放寬）
        it('逐次budgetMs大於建構budgetMs: 仍為建構值（封頂，不放寬）；相等亦為該值', async function() {
            let p = await probeBudget({ budgetMs: 120000 }, { budgetMs: 600000 })
            assert.strict.equal(isNear(p.remainingMs, 120000), true, `remainingMs=${p.remainingMs}`)
            let q = await probeBudget({ budgetMs: 120000 }, { budgetMs: 120000 })
            assert.strict.equal(isNear(q.remainingMs, 120000), true, `remainingMs=${q.remainingMs}`)
        })

        // 建議檔§1.4案3／主控裁定: 未給／null／非法視為未給 → 建構值
        it('逐次budgetMs未給、null或非法（非正整數）: 視為未給，仍為建構值', async function() {
            let bad = [undefined, null, 0, -1, -120000, 1.5, 'abc', '', NaN, {}, [], true, false]
            for (let v of bad) {
                let p = await probeBudget({ budgetMs: 120000 }, { budgetMs: v })
                assert.strict.equal(isNear(p.remainingMs, 120000), true, `budgetMs=${String(v)} remainingMs=${p.remainingMs}`)
            }
            let none = await probeBudget({ budgetMs: 120000 }, {})
            assert.strict.equal(isNear(none.remainingMs, 120000), true, `remainingMs=${none.remainingMs}`)
        })

        // 建議檔§1.4案4／主控裁定: 建構未給、逐次給 → 逐次值
        it('建構budgetMs未給（或非法視同未給）、逐次budgetMs給: 為逐次值', async function() {
            let p = await probeBudget({}, { budgetMs: 120000 })
            assert.strict.equal(isNear(p.remainingMs, 120000), true, `remainingMs=${p.remainingMs}`)
            for (let v of [null, 0, -1, 'abc', 1.5]) {
                let q = await probeBudget({ budgetMs: v }, { budgetMs: 120000 })
                assert.strict.equal(isNear(q.remainingMs, 120000), true, `ctor budgetMs=${String(v)} remainingMs=${q.remainingMs}`)
            }
        })

        // 主控裁定: 兩者皆未給 → 不限（語意不變）
        it('建構與逐次budgetMs皆未給或非法: 不限預算（無budget-out事件、請求照常送出）', async function() {
            let p = await probeBudget({}, {})
            assert.strict.deepEqual([p.r.ok, p.remainingMs, p.budgetOuts, p.sent], [true, null, 0, 1])
            let q = await probeBudget({ budgetMs: 'abc' }, { budgetMs: 0 })
            assert.strict.deepEqual([q.r.ok, q.remainingMs, q.budgetOuts, q.sent], [true, null, 0, 1])
        })

        // 逐次值只作用於該次呼叫: 建構期base不得被改寫
        it('逐次budgetMs只作用於該次呼叫: 同一caller下一次未給時回到建構值，不殘留', async function() {
            probeSeq++
            let id = `t:bp${probeSeq}`
            let c = createAiCaller({ extraProviders: [ent(id, 'echo')], pick: [id], store: memStore(), budgetMs: 600000, minAttemptMs: 1000000000 })
            let seen = []
            let onEvent = (ev) => {
                if (ev.type === 'budget-out') {
                    seen.push(ev.remainingMs)
                }
            }
            await c.callAI('go', { budgetMs: 120000, onEvent })
            await c.callAI('go', { onEvent })
            await c.callAI('go', { budgetMs: 300000, onEvent })
            assert.strict.deepEqual(seen.map((v) => [120000, 300000, 600000].find((e) => isNear(v, e))), [120000, 600000, 300000])
        })

        // 零供應商路徑與逐次budgetMs無關: 仍同形失敗
        it('零供應商時給逐次budgetMs: 仍回同形失敗（不送請求、不throw）', async function() {
            let c = createAiCaller({ pick: ['no-such-id'], budgetMs: 600000 })
            let r = await c.callAI('x', { budgetMs: 1000 })
            assert.strict.deepEqual([r.ok, r.attempts, r.tried, r.error], [false, 0, [], '無可用的 AI 供應商'])
        })

        // 建議檔§2-2（整合）: 兩個會逾時之替身條目, 建構60000、逐次1000、minAttemptMs 500
        it('整合: 兩家皆會逾時之條目，建構budgetMs 60000、逐次1000、minAttemptMs 500 → 第一家以約1秒逾時後預算用盡，第二家不被嘗試', async function() {
            let ev = []
            let c = createAiCaller({
                extraProviders: [ent('t:ib1', 'slow'), ent('t:ib2', 'slow')],
                pick: ['t:ib1', 't:ib2'],
                store: memStore(),
                budgetMs: 60000,
                minAttemptMs: 500,
                onEvent: (e) => ev.push(e),
            })
            let t0 = Date.now()
            let r = await c.callAI('go', { budgetMs: 1000 })
            let elapsed = Date.now() - t0

            //未依逐次值收緊時: 建構60000、條目預設逾時遠大於10秒，第一家於10秒後回'too late'而ok為true
            assert.strict.deepEqual([r.ok, r.errorType, r.error], [false, 'budget', 'budget exhausted'])
            assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.outcome, t.errorType]), [['t:ib1', 'skip-group', 'timeout'], ['t:ib2', 'budget-out', undefined]])
            assert.strict.deepEqual(ev.filter((e) => e.type === 'try').map((e) => e.providerId), ['t:ib1']) //只嘗試一家
            assert.strict.deepEqual([reqOfKey('t:ib1').length, reqOfKey('t:ib2').length], [1, 0]) //替身端點亦只見第一家之請求
            assert.strict.equal(elapsed < 8000, true, `elapsed=${elapsed}`) //遠小於替身'slow'路由之10秒回應
        })

    })

})
