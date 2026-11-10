import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createAiCaller from '../src/createAiCaller.mjs'
import dispatchAiWkf from '../src/dispatchAiWkf.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-coolOptionsWiring — 新選項(cooldownGrowth、cooldownMaxMs、coolAfterFails、envDown)之三入口接線
// (2026-11-11 di402; 設計 da402-審計報告 §4.2 DA-8、§5.2〈DA〉DA-8; terra#25: createAiCaller建構白名單缺鍵)
//
// 三入口: dispatchAiFallback、createAiCaller(建構)、dispatchAiWkf之callAi／runFanout(defaults與callOpt); 讀cooled事件與結果確證生效。


let MIN = 60000

//storeWith, 預寫一筆已過期(20分前, 視窗15分)而未逾清除門檻(視窗＋上限30分)之冷卻紀錄(n 1)與連敗(k 1)
function storeWith(id) {
    let st = { cursors: {}, cooling: { [id]: { at: Date.now() - 20 * MIN, n: 1, reason: 'timeout' } }, failStreak: { [id]: { k: 1, at: Date.now() } } }
    return {
        get: () => st,
        set: (s) => {
            st = s
        },
        peek: () => st,
    }
}


describe('新選項之三入口接線(da402 DA-8)', function() {

    let srv = null
    before(async function() {
        srv = await fakeServerForDeadlineTest()
    })
    after(async function() {
        await srv.close()
    })

    let rest = (id, model) => ({ id, kind: 'api-openai-compat', baseURL: srv.url, model, keys: [`sk-${id}`] })

    //opts: growth 4、上限30分、連敗門檻2 → 429觸發後n 2、cooldownMs 30分(＝上限, 15分×4被截)、連敗達2之cooled併入同一則(內建優先); envDown回true則不落定
    let opts = { cooldownMs: 15 * MIN, cooldownGrowth: 4, cooldownMaxMs: 30 * MIN, coolAfterFails: 2 }
    let expectOf = (ev, store, id) => [ev.filter((e) => e.type === 'cooled').map((e) => [e.reason, e.n, e.cooldownMs]), store.peek().failStreak[id].k]

    it('dispatchAiFallback: cooldownGrowth、cooldownMaxMs、coolAfterFails生效', async function() {
        let store = storeWith('w1')
        let ev = []
        await dispatchAiFallback('abc', { ...opts, store, providers: [rest('w1', '429:w1')], onEvent: (e) => ev.push(e) })
        assert.strict.deepEqual(expectOf(ev, store, 'w1'), [[['rate-limit', 2, 30 * MIN]], 2])
    })

    it('createAiCaller(建構): cooldownGrowth、cooldownMaxMs、coolAfterFails生效; envDown經建構傳入', async function() {
        let store = storeWith('w2')
        let ev = []
        let c = createAiCaller({ extraProviders: [rest('w2', '429:w2')], pick: ['w2'], ...opts, store, onEvent: (e) => ev.push(e) })
        await c.callAI('go')
        let store2 = storeWith('w2b')
        let c2 = createAiCaller({ extraProviders: [rest('w2b', '429:w2b')], pick: ['w2b'], ...opts, store: store2, envDown: async () => true })
        let r2 = await c2.callAI('go')
        assert.strict.deepEqual([expectOf(ev, store, 'w2'), r2.envDown, store2.peek().cooling.w2b.n, store2.peek().failStreak.w2b.k], [[[['rate-limit', 2, 30 * MIN]], 2], true, 1, 1])
    })

    it('dispatchAiWkf.callAi(defaults)與runFanout(callOpt): 新選項生效', async function() {
        let s1 = storeWith('w3')
        let ev1 = []
        let w = dispatchAiWkf({ providers: { m: rest('w3', '429:w3') }, defaults: { ...opts, store: s1, rawText: true, onEvent: (e) => ev1.push(e) } })
        await w.callAi('go', { spec: { use: 'm' } })

        let s2 = storeWith('w4')
        let ev2 = []
        let w2 = dispatchAiWkf({ providers: { m: rest('w4', '429:w4') } })
        await w2.runFanout({ task: 'go', callOpt: { ...opts, store: s2, rawText: true, onEvent: (e) => ev2.push(e) }, agents: [{ use: 'm' }], integrate: { use: 'm' } })
        assert.strict.deepEqual([expectOf(ev1, s1, 'w3'), expectOf(ev2, s2, 'w4')], [[[['rate-limit', 2, 30 * MIN]], 2], [[['rate-limit', 2, 30 * MIN]], 2]])
    })

})
