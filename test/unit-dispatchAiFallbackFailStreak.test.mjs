import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-dispatchAiFallbackFailStreak — 持久連敗coolAfterFails與環境歸因envDown
// (2026-11-11 di402; 設計 da402-審計報告 §4.2 DA-5、§5.2〈DA〉DA-5; 帳本 sgud/rule/rulebook_cooling.md R-COOL-3)
//
// 「三次各自獨立呼叫(同一持久store)」模擬每輪一個新行程之呼叫端: 連敗存於store而非行程記憶體。判定以store之failStreak／cooling與cooled事件為準。


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


describe('dispatchAiFallback 持久連敗與環境歸因(da402 DA-5)', function() {

    let srv = null
    let fake = null
    before(async function() {
        srv = await fakeServerForDeadlineTest()
        fake = createFakeCli('fake-di402-failstreak')
    })
    after(async function() {
        await srv.close()
        fake.clean()
    })

    let rest = (id, model, extra = {}) => ({ id, kind: 'api-openai-compat', baseURL: srv.url, model, keys: [`sk-${id}`], ...extra })
    let base = { cooldownMs: 15 * MIN, coolAfterFails: 3 }

    it('三次各自獨立呼叫(同一store)皆驗證失敗 → 第三次cooled reason streak, 帶streak、errorType、error、keys、attempted', async function() {
        let store = memStore()
        let evs = []
        for (let i = 0; i < 3; i++) {
            let ev = []
            await dispatchAiFallback('abc', { ...base, store, validate: 'json', providers: [rest('s1:bad', 'bad:s1')], onEvent: (e) => ev.push(e) })
            evs.push(ev.filter((e) => e.type === 'cooled'))
        }
        assert.strict.deepEqual(evs.map((c) => c.length), [0, 0, 1])
        let c = evs[2][0]
        assert.strict.deepEqual([c.reason, c.streak, c.errorType, c.error, c.keys, c.attempted, c.n], ['streak', 3, 'validation', 'OUTPUT_VALIDATION_FAILED', 1, 1, 1])
        assert.strict.deepEqual([store.peek().failStreak['s1:bad'].k, store.peek().cooling['s1:bad'].reason], [3, 'streak'])
    })

    it('全部quota-skip(attempted 0)之組盡不計連敗', async function() {
        let store = memStore()
        for (let i = 0; i < 3; i++) {
            await dispatchAiFallback('abc', {
                ...base,
                store,
                providers: [{ id: 's2:go', kind: 'opencode', provider: 'opencode-go', model: 'opencode-go/x', exe: fake.exe, keys: [`go-key-di402-s2-${i}`], quotaGate: { usage: async () => ({ ok: true, usage: { rolling: { percent: 99, resetsAt: new Date(Date.now() + H).toISOString() } } }) } }],
            })
        }
        assert.strict.deepEqual([store.peek().failStreak, store.peek().cooling['s2:go'].reason], [undefined, 'quota'])
    })

    it('各次型別皆為params之組盡不計連敗', async function() {
        let store = memStore()
        for (let i = 0; i < 3; i++) {
            await dispatchAiFallback('abc', { ...base, store, providers: [{ id: 's3:params', kind: 'no-such-kind' }] })
        }
        assert.strict.deepEqual(store.peek().failStreak, undefined)
    })

    it('成交歸零; 觸發後不歸零(其後每次再敗皆重申streak)', async function() {
        let store = memStore()
        await dispatchAiFallback('abc', { ...base, store, validate: 'json', providers: [rest('s4:x', 'bad:s4')] })
        await dispatchAiFallback('abc', { ...base, store, validate: 'json', providers: [rest('s4:x', 'bad:s4')] })
        let k2 = store.peek().failStreak['s4:x'].k
        await dispatchAiFallback('abc', { ...base, store, providers: [rest('s4:x', 'ok:s4')] }) //成交
        let afterOk = store.peek().failStreak['s4:x']
        let cs = []
        for (let i = 0; i < 4; i++) {
            let ev = []
            await dispatchAiFallback('abc', { ...base, store, validate: 'json', providers: [rest('s4:x', 'bad:s4')], onEvent: (e) => ev.push(e) })
            cs.push(ev.filter((e) => e.type === 'cooled').map((e) => e.streak))
        }
        assert.strict.deepEqual([k2, afterOk, cs, store.peek().failStreak['s4:x'].k], [2, undefined, [[], [], [3], [4]], 4])
    })

    it('envDown回true: 本次之n遞增與連敗遞增不落定(冷卻時間戳保留), 結果帶envDown: true', async function() {
        let at0 = Date.now() - 2 * H
        let store = memStore({ cursors: {}, cooling: { 's5:429': { at: at0, n: 1, reason: 'timeout' } }, failStreak: { 's5:429': { k: 1, at: at0 } } })
        let r = await dispatchAiFallback('abc', { ...base, cooldownGrowth: 4, store, envDown: async () => true, providers: [rest('s5:429', '429:s5')] })
        let st = store.peek()
        assert.strict.deepEqual([r.envDown, st.cooling['s5:429'].n, st.cooling['s5:429'].at > at0, st.failStreak['s5:429'].k], [true, 1, true, 1])
    })

    it('envDown回false、拋錯或未給: 遞增照常落定, 結果不帶envDown', async function() {
        let mk = () => memStore({ cursors: {}, cooling: { 's6:429': { at: Date.now() - 2 * H, n: 1, reason: 'timeout' } } })
        let out = []
        for (let ed of [async () => false, () => {
            throw new Error('x')
        }, undefined]) {
            let store = mk()
            let r = await dispatchAiFallback('abc', { ...base, cooldownGrowth: 4, store, envDown: ed, providers: [rest('s6:429', '429:s6')] })
            out.push([r.envDown, store.peek().cooling['s6:429'].n, store.peek().failStreak['s6:429'].k])
        }
        assert.strict.deepEqual(out, [[undefined, 2, 1], [undefined, 2, 1], [undefined, 2, 1]])
    })

    it('同一次呼叫逾時＋連敗達門檻 → 只一則cooled(reason timeout; 內建觸發優先), 連敗照計', async function() {
        let store = memStore({ cursors: {}, cooling: {}, failStreak: { 's7:hang': { k: 2, at: Date.now() } } })
        let ev = []
        await dispatchAiFallback('abc', { ...base, store, providers: [rest('s7:hang', 'hang:s7', { timeoutMs: 300 })], onEvent: (e) => ev.push(e) })
        assert.strict.deepEqual([ev.filter((e) => e.type === 'cooled').map((e) => e.reason), store.peek().failStreak['s7:hang'].k], [['timeout'], 3])
    })

    //外審terra F08: 不落定時一併還原reason——過期之quota(n 3)紀錄遇限流(n 4、rate-limit), envDown為真 → n 3、reason quota(固定視窗)
    it('envDown回true: 本次寫入之reason一併還原(quota之n 3遇429後不落定 → 仍為quota、n 3)', async function() {
        let store = memStore({ cursors: {}, cooling: { 's8:429': { at: Date.now() - 2 * H, n: 3, reason: 'quota' } } })
        let r = await dispatchAiFallback('abc', { ...base, cooldownGrowth: 4, store, envDown: async () => true, providers: [rest('s8:429', '429:s8')] })
        let rec = store.peek().cooling['s8:429']
        assert.strict.deepEqual([r.envDown, rec.n, rec.reason], [true, 3, 'quota'])
    })

    //外審terra F03: envDown等待期間另一呼叫成交而刪除同一條目之連敗與冷卻 → 不落定時不得以舊值復活
    it('envDown等待期間另一呼叫已成交(刪除連敗與冷卻) → 不落定時不復活已刪之紀錄', async function() {
        let store = memStore({ cursors: {}, cooling: { 's9:x': { at: Date.now() - 2 * H, n: 1, reason: 'timeout' } }, failStreak: { 's9:x': { k: 1, at: Date.now() } } })
        let gate = { release: null }
        let exhausted = null
        let gotExhausted = new Promise((resolve) => {
            exhausted = resolve
        })
        let pA = dispatchAiFallback('abc', {
            ...base,
            store,
            providers: [rest('s9:x', '429:s9')],
            envDown: () => new Promise((resolve) => {
                gate.release = resolve
            }),
            onEvent: (e) => {
                if (e.type === 'group-exhausted') {
                    exhausted()
                }
            },
        })
        await gotExhausted //A已組盡(連敗k 2、冷卻n 2), 並已同步進入envDown之等待(gate.release已就緒)
        let rB = await dispatchAiFallback('abc', { ...base, store, providers: [rest('s9:x', 'ok:s9')] }) //B成交: 刪除冷卻與連敗
        assert.strict.equal(typeof gate.release, 'function')
        gate.release(true)
        let rA = await pA
        let st = store.peek()
        assert.strict.deepEqual([rB.ok, rA.envDown, st.cooling['s9:x'], (st.failStreak || {})['s9:x']], [true, true, undefined, undefined])
    })

    //外審terra F05: 連敗不依時間過期——cooldownMaxMs為30分而前一次失敗在2小時前(每兩小時一輪), 連敗仍累計
    it('連敗不依cooldownMaxMs過期: 上限30分、前次失敗於2小時前(k 2) → 本次k 3、達門檻冷卻', async function() {
        let store = memStore({ cursors: {}, cooling: {}, failStreak: { 's13:bad': { k: 2, at: Date.now() - 2 * H } } })
        let ev = []
        await dispatchAiFallback('abc', { ...base, cooldownMaxMs: 30 * MIN, store, validate: 'json', providers: [rest('s13:bad', 'bad:s13')], onEvent: (e) => ev.push(e) })
        assert.strict.deepEqual([store.peek().failStreak['s13:bad'].k, ev.filter((e) => e.type === 'cooled').map((e) => [e.reason, e.streak])], [3, [['streak', 3]]])
    })

    //外審terra F06: 同一次呼叫內新建之紀錄亦算本次之一級, 其後之觸發不再+1(視窗極短而第二把金鑰之429落在視窗外時亦然)
    it('同一次呼叫內新建紀錄後, 第二把金鑰之429即使落在視窗外亦不+1(n維持1)', async function() {
        let store = memStore()
        await dispatchAiFallback('abc', { cooldownMs: 1, cooldownGrowth: 4, store, providers: [rest('s10:429', '429:s10', { keys: ['sk-a', 'sk-b'] })] })
        assert.strict.deepEqual(store.peek().cooling['s10:429'].n, 1)
    })

    //外審terra F04: 只有未送出之參數失敗時不詢問envDown(「有實際嘗試」)
    it('只有參數失敗(未送出)之全敗不詢問envDown', async function() {
        let asked = 0
        let envDown = async () => {
            asked++
            return true
        }
        let r = await dispatchAiFallback('abc', { ...base, store: memStore(), envDown, providers: [{ id: 's11:bad', kind: 'no-such-kind' }] })
        assert.strict.deepEqual([r.errorType, asked, r.envDown], ['params', 0, undefined])
    })

    //外審terra F17(以剩餘預算封頂envDown之等待)已於2026-11-11 di402b依主控裁示撤銷: 環境歸因屬整鏈結束後之記帳, 等待恆為5秒上限, 不以剩餘預算封頂;
    //有期限情境(剩餘 ≈ 0 仍等候探測)與上限5秒之案移至 unit-dispatchAiFallbackEnvDownWait.test.mjs(原本案以「永不落定之envDown於4秒內結束」釘住已撤銷之封頂)

})
