import assert from 'assert'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { coolEntry, coolingOf, streakOf } from '../src/cooling.mjs'
import wi from '../src/WDispatchAi.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-cooling — 匯出之coolEntry／coolingOf／streakOf(供知識管線之免費池與健康摘要以同一規則寫讀)
// (2026-11-11 di402; 設計 da402-審計報告 §4.2 DA-4、DA-9、§5.2〈DA〉DA-9; 帳本 sgud/rule/rulebook_cooling.md R-COOL-2)


let MIN = 60000
let H = 3600000
let CFG = { cooldownMs: 15 * MIN, cooldownGrowth: 4, cooldownMaxMs: 4 * H }

//TABLE, 同一組表格: 寫入前之紀錄(相對now之分鐘數) × 原因 → 寫入後之n與有效視窗(分鐘)
let TABLE = [
    { name: '無紀錄 → 新建n 1', pre: null, reason: 'rate-limit', n: 1, win: 15 },
    { name: '視窗外(20分前, n 1)再觸發 → n 2、60分', pre: { ago: 20, n: 1, reason: 'timeout' }, reason: 'rate-limit', n: 2, win: 60 },
    { name: '視窗內(50分前, n 2)再觸發 → n不增(只更新at)', pre: { ago: 50, n: 2, reason: 'timeout' }, reason: 'rate-limit', n: 2, win: 60 },
    { name: '視窗外, reason quota → n不動、15分', pre: { ago: 300, n: 3, reason: 'timeout' }, reason: 'quota', n: 3, win: 15 },
    { name: '視窗外, reason budget → n不動、15分', pre: { ago: 300, n: 3, reason: 'timeout' }, reason: 'budget', n: 3, win: 15 },
    { name: 'n大 → 有效視窗為上限4小時', pre: { ago: 300, n: 10, reason: 'timeout' }, reason: 'timeout', n: 11, win: 240 },
    { name: '舊格式數字(20分前) → 視為n 1, 再觸發n 2', pre: { num: 20 }, reason: 'timeout', n: 2, win: 60 },
]

function preOf(row, now) {
    if (row.pre === null) {
        return undefined
    }
    if (row.pre.num !== undefined) {
        return now - row.pre.num * MIN
    }
    return { at: now - row.pre.ago * MIN, n: row.pre.n, reason: row.pre.reason }
}


describe('coolEntry／coolingOf／streakOf(da402 DA-9)', function() {

    describe('coolEntry: 同一組表格', function() {
        for (let row of TABLE) {
            it(row.name, function() {
                let now = 10 * 24 * H
                let state = { cooling: {} }
                let p = preOf(row, now)
                if (p !== undefined) {
                    state.cooling.x = p
                }
                let r = coolEntry(state, 'x', { ...CFG, reason: row.reason, now })
                assert.strict.deepEqual([r.n, r.cooldownMs, r.at, state.cooling.x.n], [row.n, row.win * MIN, now, row.n])
            })
        }
    })

    describe('與遞補層之內建觸發同一規則(同一組表格之rate-limit列, 經dispatchAiFallback之429)', function() {
        let srv = null
        before(async function() {
            srv = await fakeServerForDeadlineTest()
        })
        after(async function() {
            await srv.close()
        })
        for (let [i, row] of TABLE.filter((x) => x.reason === 'rate-limit').entries()) {
            it(`內建429: ${row.name}`, async function() {
                let st = { cursors: {}, cooling: {} }
                let p = preOf(row, Date.now())
                if (p !== undefined) {
                    st.cooling.x = p
                }
                let ev = []
                await dispatchAiFallback('abc', { ...CFG, store: { get: () => st, set: () => {} }, providers: [{ id: 'x', kind: 'api-openai-compat', baseURL: srv.url, model: `429:tbl-${i}`, keys: ['sk-x'] }], onEvent: (e) => ev.push(e) })
                let c = ev.filter((e) => e.type === 'cooled')
                assert.strict.deepEqual([st.cooling.x.n, c.map((e) => e.cooldownMs)], [row.n, [row.win * MIN]])
            })
        }
    })

    it('store{get,set}: 經get讀出、寫入後set寫回一次', function() {
        let st = { cooling: {} }
        let sets = 0
        let r = coolEntry({ get: () => st, set: () => sets++ }, 'oc:x', { cooldownMs: 15 * MIN, reason: 'quota', now: 1000 })
        assert.strict.deepEqual([r, sets, st.cooling['oc:x']], [{ at: 1000, n: 1, reason: 'quota', cooldownMs: 15 * MIN, until: 1000 + 15 * MIN }, 1, { at: 1000, n: 1, reason: 'quota' }])
    })

    it('參數無效同步throw(先於副作用); 寫不進(凍結、get拋錯、set拋錯)回null', function() {
        let thrown = []
        for (let f of [
            () => coolEntry(null, 'x', { cooldownMs: 1 }),
            () => coolEntry({}, '', { cooldownMs: 1 }),
            () => coolEntry({}, 'x', { cooldownMs: 0 }),
            () => coolEntry({}, 'x', { cooldownMs: 1, reason: 'nope' }),
            () => coolingOf(null, 'x'),
            () => streakOf({}, 1),
        ]) {
            try {
                f()
                thrown.push(false)
            }
            catch {
                thrown.push(true)
            }
        }
        let frozen = Object.freeze({ cooling: Object.freeze({}) })
        let r = [
            coolEntry(frozen, 'x', { cooldownMs: 1000 }),
            coolEntry({
                get: () => {
                    throw new Error('g')
                },
                set: () => {}
            }, 'x', { cooldownMs: 1000 }),
            coolEntry({
                get: () => ({ cooling: {} }),
                set: () => {
                    throw new Error('s')
                }
            }, 'x', { cooldownMs: 1000 }),
        ]
        assert.strict.deepEqual([thrown, r], [[true, true, true, true, true, true], [null, null, null]])
    })

    it('coolingOf: 無cooldownMs只回紀錄; 給cooldownMs另回有效視窗、until、cooling; 舊格式數字以n 1呈現且不改寫; 無紀錄回null', function() {
        let state = { cooling: { a: { at: 1000, n: 2, reason: 'timeout' }, b: 500 } }
        let r = [
            coolingOf(state, 'a'),
            coolingOf(state, 'a', { ...CFG, now: 2000 }),
            coolingOf(state, 'b'),
            state.cooling.b,
            coolingOf(state, 'zz'),
        ]
        assert.strict.deepEqual(r, [
            { at: 1000, n: 2, reason: 'timeout' },
            { at: 1000, n: 2, reason: 'timeout', cooldownMs: 60 * MIN, until: 1000 + 60 * MIN, cooling: true },
            { at: 500, n: 1, reason: 'timeout' },
            500,
            null,
        ])
    })

    it('streakOf: 讀failStreak之k, 無紀錄回0; store讀不出回0', function() {
        let r = [streakOf({ failStreak: { a: { k: 3, at: 1 } } }, 'a'), streakOf({}, 'a'), streakOf({
            get: () => {
                throw new Error('x')
            },
            set: () => {}
        }, 'a')]
        assert.strict.deepEqual(r, [3, 0, 0])
    })

    it('經WDispatchAi對外匯出(同一函數)', function() {
        assert.strict.deepEqual([wi.coolEntry === coolEntry, wi.coolingOf === coolingOf, wi.streakOf === streakOf], [true, true, true])
    })

})
