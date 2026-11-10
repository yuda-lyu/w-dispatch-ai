import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import callAiWithFallback from '../src/wkf/callAiWithFallback.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-dispatchAiFallbackEnvDownWait — 環境歸因envDown之等待不以剩餘預算封頂(上限5秒), 且工作流callAiWithFallback之回傳帶出envDown
// (2026-11-11 di402b; 使用端回報: 整鏈耗盡預算而斷網者, envDown只等約1毫秒, 呼叫端之真實探測來不及回覆即視同「通」, 斷網被計為條目故障;
//  帳本 sgud/rule/rulebook_cooling.md R-COOL-3 第3點)
//
// 判定以結果欄位、store內容與事件為準, 不以牆鐘斷言(除下列前置條件)。
// 【真時間】標記之案使用真實之逾時(本機替身伺服器收件後不回應, 由轉接器逾時; 計時器規格P6): 條目逾時＝預算＝400毫秒, 使嘗試結束時剩餘預算 ≈ 0;
//   envDown以計時器延遲d毫秒回true(模擬呼叫端之真實探測需數十毫秒至數秒)。因果: 修前等待＝max(剩餘, 1)＝約1毫秒 < d → 視為否; 修後等待＝5000毫秒 > d → 為真。
//   負載只使嘗試更晚結束(剩餘更少)或探測更晚回覆(但d與5000之裕度 ≥ 3秒、與1毫秒之裕度 ≥ 49毫秒), 不改變判定。
//   前置條件(剩餘預算 < minAttemptMs)於envDown被詢問時自證: 詢問時刻距期限 < minAttemptMs。


let MIN = 60000
let H = 3600000

function memStore(init = { cursors: {}, cooling: {} }) {
    let st = init
    return {
        get: () => st,
        set: (s) => {
            st = s
        },
        peek: () => st,
    }
}

//delayedEnvDown, 延遲d毫秒回true之envDown(記錄被詢問之時刻與次數); cancel清除計時器(測試收尾, 不留懸置計時器)
function delayedEnvDown(d, value = true) {
    let timers = []
    let o = {
        askedAt: [],
        fn: () => {
            o.askedAt.push(Date.now())
            return new Promise((resolve) => {
                timers.push(setTimeout(() => resolve(value), d))
            })
        },
        cancel: () => {
            for (let t of timers) {
                clearTimeout(t)
            }
        },
    }
    return o
}


describe('dispatchAiFallback 環境歸因envDown之等待與工作流回傳(di402b)', function() {

    let srv = null
    before(async function() {
        srv = await fakeServerForDeadlineTest()
    })
    after(async function() {
        await srv.close()
    })

    let rest = (id, model, extra = {}) => ({ id, kind: 'api-openai-compat', baseURL: srv.url, model, keys: [`sk-${id}`], ...extra })
    let base = { cooldownMs: 15 * MIN, coolAfterFails: 3, cooldownGrowth: 4 }

    //預寫「視窗外」之舊紀錄(n 1、k 1): 本次再敗時n會+1(視窗外)、k會+1; 不落定時應維持n 1、k 1
    let seeded = (id) => {
        let at0 = Date.now() - 2 * H
        return { at0, store: memStore({ cursors: {}, cooling: { [id]: { at: at0, n: 1, reason: 'timeout' } }, failStreak: { [id]: { k: 1, at: at0 } } }) }
    }

    describe('[真時間] 有期限且整鏈結束時剩餘預算 ≈ 0', function() {

        //R-COOL-3 第3點(甲): 環境歸因屬整鏈結束後之記帳, 其等待不以剩餘預算封頂
        //① 剩餘 ≈ 0 之整鏈失敗, envDown延遲50毫秒與2秒回true → envDown: true、n與連敗不落定(修前: 等待約1毫秒 → 視為否, n 2、k 2)
        it('① envDown延遲50毫秒／2秒回true → 結果envDown: true, n與連敗不落定(冷卻時間戳保留)', async function() {
            this.timeout(30000)
            let out = []
            for (let d of [50, 2000]) {
                let id = `e1:hang${d}`
                let { at0, store } = seeded(id)
                let ed = delayedEnvDown(d)
                let ev = []
                let t0 = Date.now()
                let r = await dispatchAiFallback('abc', {
                    ...base,
                    budgetMs: 400,
                    minAttemptMs: 100,
                    store,
                    envDown: ed.fn,
                    providers: [rest(id, `hang:ed1-${d}`, { timeoutMs: 400 })],
                    onEvent: (e) => ev.push(e),
                })
                ed.cancel()
                let st = store.peek()
                out.push({
                    d,
                    errorType: r.errorType, //一般逾時(非budget): 條目逾時 = 預算, 差額 < minAttemptMs
                    envDown: r.envDown,
                    asked: ed.askedAt.length,
                    remainingLtMin: ed.askedAt.length === 1 && (t0 + 400) - ed.askedAt[0] < 100, //前置條件: 詢問時剩餘預算 < minAttemptMs
                    exhausted: ev.filter((e) => e.type === 'group-exhausted').length,
                    n: st.cooling[id].n,
                    atKept: st.cooling[id].at > at0,
                    k: st.failStreak[id].k,
                })
            }
            let want = (d) => ({ d, errorType: 'timeout', envDown: true, asked: 1, remainingLtMin: true, exhausted: 1, n: 1, atKept: true, k: 1 })
            assert.strict.deepEqual(out, [want(50), want(2000)])
        })

        //R-COOL-3 第3點(既有上限5秒): 延遲超過5秒 → 視為否, 增量照常落定、結果不帶envDown(取代修前以「永不落定」驗剩餘預算封頂之案: 該封頂已撤銷)
        it('② envDown延遲6秒(超過5秒上限)才回true → 視為否: 結果不帶envDown, n與連敗照常落定', async function() {
            this.timeout(30000)
            let id = 'e2:hang'
            let { store } = seeded(id)
            let ed = delayedEnvDown(6000)
            let r = await dispatchAiFallback('abc', {
                ...base,
                budgetMs: 400,
                minAttemptMs: 100,
                store,
                envDown: ed.fn,
                providers: [rest(id, 'hang:ed2', { timeoutMs: 400 })],
            })
            ed.cancel()
            let st = store.peek()
            assert.strict.deepEqual([r.errorType, r.envDown, ed.askedAt.length, st.cooling[id].n, st.failStreak[id].k], ['timeout', undefined, 1, 2, 2])
        })

        //③b 工作流callAiWithFallback同一情境: 回傳帶envDown: true, 上層不必另問
        it('③b callAiWithFallback: 剩餘預算 ≈ 0 之整鏈失敗, envDown延遲50毫秒回true → 回傳envDown: true、連敗不落定', async function() {
            this.timeout(30000)
            let id = 'e3b:hang'
            let { store } = seeded(id)
            let ed = delayedEnvDown(50)
            let r = await callAiWithFallback('abc', {
                ...base,
                budgetMs: 400,
                minAttemptMs: 100,
                store,
                envDown: ed.fn,
                providers: { [id]: { kind: 'api-openai-compat', baseURL: srv.url, model: 'hang:ed3b', keys: ['sk-e3b'], timeoutMs: 400 } },
                spec: { use: id },
            })
            ed.cancel()
            assert.strict.deepEqual([r.ok, r.errorType, r.envDown, store.peek().cooling[id].n, store.peek().failStreak[id].k], [false, 'timeout', true, 1, 1])
        })

    })

    describe('callAiWithFallback 之回傳帶出遞補層之envDown(為true時才帶)', function() {

        let call = (model, extra = {}) => callAiWithFallback('abc', {
            providers: { 'e3:p': { kind: 'api-openai-compat', baseURL: srv.url, model, keys: ['sk-e3'] } },
            spec: { use: 'e3:p' },
            rawText: true,
            ...extra,
        })

        //③ 失敗且envDown為true → 回傳envDown: true(修前: 無此鍵)
        it('③ 全敗且envDown回true → ok false、envDown: true', async function() {
            let r = await call('429:e3a', { envDown: async () => true })
            assert.strict.deepEqual([r.ok, r.errorType, r.envDown], [false, 'http', true])
        })

        it('③ envDown回false／拋錯／未給 → 回傳不帶envDown鍵', async function() {
            let rs = [
                await call('429:e3b', { envDown: async () => false }),
                await call('429:e3c', {
                    envDown: () => {
                        throw new Error('x')
                    },
                }),
                await call('429:e3d'),
            ]
            assert.strict.deepEqual(rs.map((r) => [r.ok, 'envDown' in r]), [[false, false], [false, false], [false, false]])
        })

        it('③ 成交 → 不詢問envDown、回傳不帶envDown鍵', async function() {
            let asked = 0
            let r = await call('ok:e3e', {
                envDown: async () => {
                    asked++
                    return true
                },
            })
            assert.strict.deepEqual([r.ok, asked, 'envDown' in r], [true, 0, false])
        })

    })

})
