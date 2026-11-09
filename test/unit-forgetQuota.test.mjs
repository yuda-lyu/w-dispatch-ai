import assert from 'assert'
import forgetQuota from '../src/forgetQuota.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { createQuotaGateState } from '../src/goQuotaGate.mjs'
import wi from '../src/WDispatchAi.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'


// 規格來源: Gitea semi/opensrcOper#116建議4與主控派工單da116:
//   forgetQuota(state, familyKey)供使用端在換帳號後明示清帳: 清除額度帳(state.quota)中該家族之帳項目, 其餘狀態(cursors、cooling、他家族之帳)不動;
//   familyKey為家族名('claude'／'codex'／'antigravity')時涵蓋該家族之全部帳項目(含claude之`claude@<雜湊>`設定目錄鍵、antigravity之各群組鍵、帶family欄之entry帳),
//   為其他字串時只清該鍵(如`entry:<id>`、`antigravity:Gemini Models`), 為'*'時清全部; state亦可為store{get,set}(經store讀寫);
//   回傳被清除之鍵陣列; 失敗通道(dspec〈輸入參數之檢測機制〉K2／§5.1, 同步且有副作用之入口): state非物件或不可讀、familyKey非空字串以外者同步throw Error且先於任何副作用;
//   參數有效但清不掉(state凍結、store.get拋錯或回傳非物件、store.set拋錯)不throw, 如實回傳實際清除之鍵(通常為[])。
// 本檔不連網、不呼叫任何模型(整合案以注入之讀者與假CLI執行)。


let T = Date.UTC(2026, 10, 9, 4, 0, 0)
let D = 86400000
let iso = (ms) => new Date(ms).toISOString()
let rec = (extra = {}) => ({ until: iso(T + 3 * D), at: iso(T), source: 'usage-api', ...extra })


describe('forgetQuota: 明示清除額度帳', function() {

    let mkState = () => ({
        cursors: { a: 1 },
        cooling: { p: 123 },
        quota: {
            'claude': rec({ account: 'aaaa' }),
            'claude@1a2b3c4d': rec(),
            'codex': rec(),
            'antigravity:Gemini Models': rec(),
            'antigravity:*': rec(),
            'antigravity:Claude and GPT models': rec(),
            'entry:claude:sonnet': rec({ source: 'limit-text', family: 'claude', account: null }),
            'entry:codex:terra': rec({ source: 'limit-text', family: 'codex', account: null }),
            'entry:old:legacy': rec({ source: 'limit-text' }),
        },
    })

    it('claude: 清claude、claude@雜湊與family為claude之entry帳; 他家族與cursors／cooling不動; 回傳被清除之鍵', function() {
        let st = mkState()
        let r = forgetQuota(st, 'claude')
        assert.strict.deepEqual(r.sort(), ['claude', 'claude@1a2b3c4d', 'entry:claude:sonnet'])
        assert.strict.deepEqual(Object.keys(st.quota).sort(), ['antigravity:*', 'antigravity:Claude and GPT models', 'antigravity:Gemini Models', 'codex', 'entry:codex:terra', 'entry:old:legacy'])
        assert.strict.deepEqual([st.cursors, st.cooling], [{ a: 1 }, { p: 123 }])
    })

    it('codex: 清codex與family為codex之entry帳', function() {
        let st = mkState()
        assert.strict.deepEqual(forgetQuota(st, 'codex').sort(), ['codex', 'entry:codex:terra'])
        assert.strict.deepEqual(Object.hasOwn(st.quota, 'claude'), true)
    })

    it('antigravity: 家族名清全部群組鍵; 帶群組之鍵只清該群組', function() {
        let st = mkState()
        assert.strict.deepEqual(forgetQuota(st, 'antigravity').sort(), ['antigravity:*', 'antigravity:Claude and GPT models', 'antigravity:Gemini Models'])
        let st2 = mkState()
        assert.strict.deepEqual(forgetQuota(st2, 'antigravity:Gemini Models'), ['antigravity:Gemini Models'])
        assert.strict.deepEqual(Object.hasOwn(st2.quota, 'antigravity:*'), true)
    })

    it('其他字串只清該鍵(精確比對); 無family欄之舊entry帳不被家族名涵蓋, 但可依精確鍵或*清除', function() {
        let st = mkState()
        assert.strict.deepEqual(forgetQuota(st, 'entry:old:legacy'), ['entry:old:legacy'])
        let st2 = mkState()
        forgetQuota(st2, 'claude')
        assert.strict.deepEqual(Object.hasOwn(st2.quota, 'entry:old:legacy'), true)
        assert.strict.deepEqual(forgetQuota(mkState(), 'cla'), [])
        assert.strict.deepEqual(forgetQuota(mkState(), 'claud'), [])
    })

    it('\'*\'清全部帳(含舊entry帳)但不動cursors／cooling', function() {
        let st = mkState()
        let r = forgetQuota(st, '*')
        assert.strict.deepEqual([r.length, Object.keys(st.quota)], [9, []])
        assert.strict.deepEqual([st.cursors, st.cooling], [{ a: 1 }, { p: 123 }])
    })

    it('無此帳／無quota欄／quota非物件: 回[], 不新增欄位', function() {
        let st = {}
        assert.strict.deepEqual(forgetQuota(st, 'claude'), [])
        assert.strict.deepEqual(Object.hasOwn(st, 'quota'), false)
        assert.strict.deepEqual(forgetQuota({ quota: 'x' }, 'claude'), [])
        assert.strict.deepEqual(forgetQuota({ quota: [] }, 'claude'), [])
        assert.strict.deepEqual(forgetQuota({ quota: { codex: rec() } }, 'claude'), [])
    })

    it('參數有效但清不掉(凍結之state): 不throw、回[]、帳原樣', function() {
        let frozen = Object.freeze({ quota: Object.freeze({ claude: rec() }) })
        assert.doesNotThrow(() => forgetQuota(frozen, 'claude'))
        assert.strict.deepEqual(forgetQuota(frozen, 'claude'), [])
        assert.strict.deepEqual(Object.keys(frozen.quota), ['claude'])
    })

    it('無效參數同步throw Error且先於任何副作用: state非物件(null、undefined、數字、字串、陣列)、不可讀物件; familyKey非空字串(null、undefined、數字、空字串、物件、陣列)', function() {
        for (let bad of [null, undefined, 5, 'x', []]) {
            assert.throws(() => forgetQuota(bad, 'claude'), /^Error: forgetQuota: invalid state/, String(bad))
        }
        let st = mkState()
        let before = JSON.stringify(st)
        for (let badKey of [null, undefined, 5, '', {}, []]) {
            assert.throws(() => forgetQuota(st, badKey), /^Error: forgetQuota: invalid familyKey/, String(badKey))
        }
        assert.strict.deepEqual(JSON.stringify(st), before) //無副作用
        let hostile = new Proxy({}, {
            get() {
                throw new Error('x')
            },
            has() {
                throw new Error('x')
            },
            ownKeys() {
                throw new Error('x')
            }
        })
        assert.throws(() => forgetQuota(hostile, 'claude'), /^Error: forgetQuota: invalid state/)
        //store: familyKey無效時不呼叫get／set
        let calls = []
        let store = { get: () => calls.push('get'), set: () => calls.push('set') }
        assert.throws(() => forgetQuota(store, ''), /invalid familyKey/)
        assert.strict.deepEqual(calls, [])
    })

    it('原型鍵不誤清: toString／constructor／__proto__不影響', function() {
        let st = mkState()
        assert.strict.deepEqual([forgetQuota(st, 'toString'), forgetQuota(st, 'constructor'), forgetQuota(st, '__proto__')], [[], [], []])
        assert.strict.deepEqual(Object.keys(st.quota).length, 9)
    })

    it('store形式{get,set}: 經store讀出、清除後set回一次; 無可清除者不set', function() {
        let st = mkState()
        let sets = []
        let store = { get: () => JSON.parse(JSON.stringify(st)), set: (x) => sets.push(x) }
        assert.strict.deepEqual(forgetQuota(store, 'codex').sort(), ['codex', 'entry:codex:terra'])
        assert.strict.deepEqual(sets.length, 1)
        assert.strict.deepEqual([Object.hasOwn(sets[0].quota, 'codex'), sets[0].cursors, sets[0].cooling], [false, { a: 1 }, { p: 123 }])
        assert.strict.deepEqual(forgetQuota(store, 'nothing'), [])
        assert.strict.deepEqual(sets.length, 1)
    })

    it('store清不掉不throw、如實回[]: get拋錯、get回非物件／Promise、set拋錯(未寫回); set回傳Promise之rejection靜默(視為已交出)', async function() {
        assert.strict.deepEqual(forgetQuota({
            get: () => {
                throw new Error('x')
            },
            set: () => {}
        }, 'claude'), [])
        assert.strict.deepEqual(forgetQuota({ get: () => null, set: () => {} }, 'claude'), [])
        assert.strict.deepEqual(forgetQuota({ get: () => Promise.resolve(mkState()), set: () => {} }, 'claude'), [])
        assert.strict.deepEqual(forgetQuota({
            get: () => mkState(),
            set: () => {
                throw new Error('x')
            }
        }, 'claude'), [])
        let r = forgetQuota({ get: () => mkState(), set: () => Promise.reject(new Error('x')) }, 'codex')
        assert.strict.deepEqual(r.sort(), ['codex', 'entry:codex:terra'])
        await new Promise((resolve) => setImmediate(resolve)) //rejection已被承接, 無unhandledRejection
    })

    it('對外匯出: WDispatchAi.forgetQuota即本函數', function() {
        assert.strict.deepEqual(wi.forgetQuota === forgetQuota, true)
    })
})


describe('forgetQuota: 清帳後立即生效(遞補層整合, 注入讀者＋假CLI)', function() {

    let fake = null
    before(function() {
        fake = createFakeCli('fake-forget116')
    })
    after(function() {
        if (fake) {
            fake.clean()
        }
    })

    let mkJsonStore = () => {
        let text = null
        return {
            get: () => (text === null ? null : JSON.parse(text)),
            set: (x) => {
                text = JSON.stringify(x)
            },
            state: () => (text === null ? null : JSON.parse(text)),
        }
    }
    let E = {
        claude: { id: 'claude:sonnet', kind: 'claude', model: 'sonnet' },
        codex: { id: 'codex:terra', kind: 'codex', model: 'gpt-6.1-terra' },
        antigravity: { id: 'agy:flash', kind: 'antigravity', model: 'gemini-3.8-flash-high', skipPermissions: false, addDirs: ['.'] },
    }
    let KEY = { claude: 'claude', codex: 'codex', antigravity: 'antigravity:Gemini Models' }
    let SCOPE = { claude: '', codex: '', antigravity: 'Gemini Models' }
    let okQ = (windows) => ({ ok: true, provider: 'fake', email: '', matched: null, plan: '', planTier: '', source: 'fake', windows, credits: null, raw: null, error: '', errorType: '', durationMs: 1 })

    for (let fam of ['claude', 'codex', 'antigravity']) {
        it(`${fam}: 帳在重置前擋住該家族條目; forgetQuota(store, '${fam}')後同一時刻之下一次派工即不被帳擋(改查讀者, 新帳號未達門檻即派工)`, async function() {
            let store = mkJsonStore()
            let w = (pct) => ({ key: '7天', label: '7天', windowSeconds: null, usedPercent: pct, resetAt: iso(T + 3 * D), scope: SCOPE[fam] })
            let gate = (pct, calls) => ({
                state: createQuotaGateState(),
                readers: {
                    [fam]: async () => {
                        calls.push(1)
                        return okQ([w(pct)])
                    }
                },
                now: () => T + 60000
            })
            let prov = [{ ...E[fam], exe: fake.exe }]
            //先入帳(以T為時鐘)
            await dispatchAiFallback('abc', { providers: prov, store, quotaGate: { ...gate(96, []), now: () => T } })
            assert.strict.deepEqual(Object.keys(store.state().quota), [KEY[fam]])
            //帳擋住(間隔內不查讀者)
            let c1 = []
            let r1 = await dispatchAiFallback('abc', { providers: prov, store, quotaGate: gate(1, c1) })
            assert.strict.deepEqual([r1.ok, r1.tried[0].source, c1.length], [false, 'ledger', 0])
            //清帳
            assert.strict.deepEqual(forgetQuota(store, fam), [KEY[fam]])
            let c2 = []
            let r2 = await dispatchAiFallback('abc', { providers: prov, store, quotaGate: gate(1, c2) })
            assert.strict.deepEqual([r2.ok, c2.length], [true, 1])
        })
    }
})
