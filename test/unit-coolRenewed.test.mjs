import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import { coolEntry, coolingOf, applyCool, coolCfgOf } from '../src/cooling.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-coolRenewed — 條目層 cooled 事件與 coolEntry 回傳之布林欄 renewed(寫入前已在有效視窗內＝視窗內之重申)
// (排程第421項; 承 ci402 回饋2〔視窗內重申只更新時刻、n 不變, 與視窗外之新觸發同形, 只觀察之呼叫端須自記本行程之事件、跨行程不可得〕;
//  帳本 sgud/rule/rulebook_cooling.md R-COOL-2 第5、7點)
//
// 規格句(主控派工):
//   R1 新建、視窗外再觸發 → renewed:false; 視窗內再觸發 → renewed:true
//   R2 coolEntry 之回傳同帶此欄
//   R3 既有 cooled 欄位逐一不變(本項只加欄位, 不改既有欄位與冷卻規則)
// 以預先寫入之 store 紀錄模擬時間經過(不需假時鐘); 觸發用替身伺服器之 429/500 快速回應; 預算封頂案為真實之逾時(標【真時間】, 斷言只依因果)。


let MIN = 60000
let H = 3600000
let CFG = { cooldownMs: 15 * MIN, cooldownGrowth: 4, cooldownMaxMs: 4 * H }

function memStore(cooling = {}, extra = {}) {
    let st = { cursors: {}, cooling, ...extra }
    return {
        get: () => st,
        set: (s) => {
            st = s
        },
        peek: () => st,
    }
}


//TABLE, 寫入前之紀錄(距 now 之毫秒數)× 觸發原因 → 寫入後之 n 與 renewed
let NOW = 10 * 24 * H
let TABLE = [
    { name: '無紀錄(新建) → false', pre: null, reason: 'rate-limit', n: 1, renewed: false },
    { name: '視窗內(5分前, n 1, 15分) → true, n 與 reason 不變', pre: { ago: 5 * MIN, n: 1, reason: 'timeout' }, reason: 'rate-limit', n: 1, renewed: true, keepReason: 'timeout' },
    { name: '視窗外(20分前, n 1) → false(新觸發, n 2)', pre: { ago: 20 * MIN, n: 1, reason: 'timeout' }, reason: 'rate-limit', n: 2, renewed: false },
    { name: '加長視窗內(50分前, n 2, 有效視窗60分) → true', pre: { ago: 50 * MIN, n: 2, reason: 'timeout' }, reason: 'rate-limit', n: 2, renewed: true, keepReason: 'timeout' },
    { name: '加長視窗外(70分前, n 2, 有效視窗60分) → false(n 3)', pre: { ago: 70 * MIN, n: 2, reason: 'timeout' }, reason: 'rate-limit', n: 3, renewed: false },
    { name: '固定視窗原因 quota 視窗內(5分前) → true, n 不動', pre: { ago: 5 * MIN, n: 3, reason: 'quota' }, reason: 'quota', n: 3, renewed: true },
    { name: '固定視窗原因 budget 視窗外(30分前, 視窗15分) → false, n 不動', pre: { ago: 30 * MIN, n: 3, reason: 'budget' }, reason: 'budget', n: 3, renewed: false },
    { name: '視窗內遇不同原因(紀錄 timeout n 2 加長視窗內遇 quota) → true, n 與 reason 不變', pre: { ago: 30 * MIN, n: 2, reason: 'timeout' }, reason: 'quota', n: 2, renewed: true, keepReason: 'timeout' },
    { name: '舊格式數字(5分前) → true', pre: { num: 5 * MIN }, reason: 'timeout', n: 1, renewed: true },
    { name: '舊格式數字(20分前) → false(n 2)', pre: { num: 20 * MIN }, reason: 'timeout', n: 2, renewed: false },
    { name: '邊界: 距今恰為視窗(15分, n 1) → false(視窗為左閉右開)', pre: { ago: 15 * MIN, n: 1, reason: 'timeout' }, reason: 'timeout', n: 2, renewed: false },
    { name: '邊界: 距今為視窗減 1ms → true', pre: { ago: 15 * MIN - 1, n: 1, reason: 'timeout' }, reason: 'timeout', n: 1, renewed: true },
    { name: '時鐘回撥: 紀錄之 at 在未來 → 讀入視為現在 → 視窗內 → true, n 不變', pre: { ago: -5 * MIN, n: 1, reason: 'timeout' }, reason: 'timeout', n: 1, renewed: true },
]

function preOf(row) {
    if (row.pre === null) {
        return undefined
    }
    if (row.pre.num !== undefined) {
        return NOW - row.pre.num
    }
    return { at: NOW - row.pre.ago, n: row.pre.n, reason: row.pre.reason }
}


describe('cooled 事件與 coolEntry 之 renewed 欄(第421項)', function() {

    this.timeout(60000)

    describe('coolEntry: 回傳帶 renewed(R1、R2)', function() {

        for (let row of TABLE) {
            it(row.name, function() {
                let state = { cooling: {} }
                let p = preOf(row)
                if (p !== undefined) {
                    state.cooling.x = p
                }
                let r = coolEntry(state, 'x', { ...CFG, reason: row.reason, now: NOW })
                assert.strict.deepEqual([r.renewed, r.n, r.reason, r.at, typeof r.renewed], [row.renewed, row.n, row.keepReason || row.reason, NOW, 'boolean'])
            })
        }

        //R3: 既有回傳欄位逐一不變(at、n、reason、cooldownMs、until), 儲存之紀錄仍只有 at、n、reason(renewed 不入 store)
        it('R3 既有回傳欄位不變(at、n、reason、cooldownMs、until), store 之紀錄不含 renewed', function() {
            let st = { cooling: { x: { at: NOW - 5 * MIN, n: 2, reason: 'timeout' } } }
            let sets = 0
            let r = coolEntry({ get: () => st, set: () => sets++ }, 'x', { ...CFG, reason: 'rate-limit', now: NOW })
            assert.strict.deepEqual(r, { at: NOW, n: 2, reason: 'timeout', cooldownMs: 60 * MIN, until: NOW + 60 * MIN, renewed: true })
            assert.strict.deepEqual([sets, st.cooling.x], [1, { at: NOW, n: 2, reason: 'timeout' }])
        })

        it('coolingOf(唯讀)回傳不帶 renewed(它不寫入, 無「寫入前」可言)', function() {
            let state = { cooling: { a: { at: 1000, n: 2, reason: 'timeout' } } }
            assert.strict.deepEqual(['renewed' in coolingOf(state, 'a'), 'renewed' in coolingOf(state, 'a', { ...CFG, now: 2000 })], [false, false])
        })

        it('寫不進(凍結)回 null, 不帶 renewed', function() {
            assert.strict.deepEqual(coolEntry(Object.freeze({ cooling: Object.freeze({}) }), 'x', { cooldownMs: 1000 }), null)
        })
    })

    describe('applyCool: renewed 只看「寫入前是否在有效視窗內」, 與 noInc 無關', function() {

        let cfg = coolCfgOf(CFG)

        it('noInc=true: 寫入前在視窗內 → true; 寫入前在視窗外 → false(n 不增但仍非重申)', function() {
            let inWin = applyCool({ cooling: { x: { at: NOW - 5 * MIN, n: 1, reason: 'timeout' } } }, 'x', 'timeout', cfg, NOW, true)
            let outWin = applyCool({ cooling: { x: { at: NOW - 30 * MIN, n: 1, reason: 'timeout' } } }, 'x', 'timeout', cfg, NOW, true)
            let none = applyCool({ cooling: {} }, 'x', 'timeout', cfg, NOW, true)
            assert.strict.deepEqual([inWin.renewed, outWin.renewed, outWin.rec.n, none.renewed], [true, false, 1, false])
        })
    })

    describe('dispatchAiFallback: 條目層 cooled 事件帶 renewed(R1、R3)', function() {

        let srv = null
        let fake = null
        let fdTmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'ci421-coolrenewed')
        before(async function() {
            srv = await fakeServerForDeadlineTest()
            fake = createFakeCli('fake-ci421-coolrenewed')
            fs.mkdirSync(fdTmp, { recursive: true })
        })
        after(async function() {
            await srv.close()
            fake.clean()
            fs.rmSync(fdTmp, { recursive: true, force: true })
            try {
                fs.rmdirSync(path.dirname(fdTmp)) //test/_tmp已空才移除(並行之他測試仍在用時失敗即忽略)
            }
            catch {}
        })

        let rest = (id, model, extra = {}) => ({ id, kind: 'api-openai-compat', baseURL: srv.url, model, keys: [`sk-${id}`], ...extra })
        let cooledOf = (ev) => ev.filter((e) => e.type === 'cooled')

        //R1(內建觸發 rate-limit): 無紀錄 / 視窗外 / 視窗內
        it('內建觸發(429): 無紀錄 → renewed:false(n 1); 視窗外(20分前) → false(n 2); 視窗內(5分前) → true(n 不變)', async function() {
            let out = []
            for (let [i, pre] of [undefined, { at: Date.now() - 20 * MIN, n: 1, reason: 'timeout' }, { at: Date.now() - 5 * MIN, n: 1, reason: 'timeout' }].entries()) {
                let store = memStore(pre === undefined ? {} : { [`a${i}:429`]: pre })
                let ev = []
                await dispatchAiFallback('abc', { ...CFG, store, providers: [rest(`a${i}:429`, `429:cr-a${i}`)], onEvent: (e) => ev.push(e) })
                out.push(cooledOf(ev).map((e) => [e.n, e.renewed]))
            }
            assert.strict.deepEqual(out, [[[1, false]], [[2, false]], [[1, true]]])
        })

        //R1(內建觸發的另一入口: coolDetect 判定, reason detect)
        it('coolDetect 判定(reason detect): 視窗內 → true、視窗外 → false', async function() {
            let out = []
            for (let [i, ago] of [5 * MIN, 20 * MIN].entries()) {
                let store = memStore({ [`b${i}:500`]: { at: Date.now() - ago, n: 1, reason: 'timeout' } })
                let ev = []
                await dispatchAiFallback('abc', { ...CFG, coolDetect: () => true, store, providers: [rest(`b${i}:500`, `500:cr-b${i}`)], onEvent: (e) => ev.push(e) })
                out.push(cooledOf(ev).map((e) => [e.reason, e.n, e.renewed]))
            }
            assert.strict.deepEqual(out, [[['detect', 1, true]], [['detect', 2, false]]])
        })

        //每次呼叫每條目至多一則: 事件反映「本次呼叫之第一次寫入前」之狀態(同一呼叫第二把金鑰之寫入必在視窗內, 但不另發事件)
        it('同一次呼叫兩把金鑰各 429: cooled 只一則, renewed 反映第一次寫入前之狀態(視窗外 → false; 視窗內 → true)', async function() {
            let out = []
            for (let [i, ago] of [20 * MIN, 5 * MIN].entries()) {
                let store = memStore({ [`c${i}:429`]: { at: Date.now() - ago, n: 1, reason: 'timeout' } })
                let ev = []
                await dispatchAiFallback('abc', { ...CFG, store, providers: [rest(`c${i}:429`, `429:cr-c${i}`, { keys: [`sk-c${i}-1`, `sk-c${i}-2`] })], onEvent: (e) => ev.push(e) })
                out.push(cooledOf(ev).map((e) => [e.n, e.renewed]))
            }
            assert.strict.deepEqual(out, [[[2, false]], [[1, true]]])
        })

        //R1 + R3(整組沒額度 quota): 視窗內 → true、視窗外 → false; 既有欄位不變
        it('整組沒額度(reason quota, scope entry): 視窗外 → false、視窗內 → true; 既有欄位不變', async function() {
            let out = []
            let keys = null
            for (let [i, ago] of [5 * H, 5 * MIN].entries()) {
                let store = memStore({ [`d${i}:go`]: { at: Date.now() - ago, n: 3, reason: 'timeout' } })
                let ev = []
                await dispatchAiFallback('abc', {
                    ...CFG,
                    store,
                    providers: [{ id: `d${i}:go`, kind: 'opencode', provider: 'opencode-go', model: 'opencode-go/x', exe: fake.exe, keys: [`go-key-ci421-d${i}`], quotaGate: { usage: async () => ({ ok: true, usage: { rolling: { percent: 99, resetsAt: new Date(Date.now() + H).toISOString() } } }) } }],
                    onEvent: (e) => ev.push(e),
                })
                let c = cooledOf(ev)
                out.push(c.map((e) => [e.scope, e.reason, e.n, e.cooldownMs, e.renewed]))
                keys = Object.keys(c[0]).sort()
            }
            //視窗外: 固定視窗原因 quota 重寫(n 不動, 視窗 15分); 視窗內: 只更新 at、沿用原紀錄(timeout n 3 加長視窗 = 上限4小時, 即取嚴; 既有行為見 R-COOL-2 第2點)
            assert.strict.deepEqual(out, [[['entry', 'quota', 3, 15 * MIN, false]], [['entry', 'quota', 3, 4 * H, true]]])
            assert.strict.deepEqual(keys, ['cooldownMs', 'error', 'failureKind', 'keyId', 'keyIndex', 'n', 'providerId', 'reason', 'renewed', 'scope', 'type']) //既有欄位 + renewed
        })

        //R1 + R3(持久連敗 streak): 視窗內 → true、視窗外 → false; 既有欄位不變
        it('持久連敗(reason streak): 視窗內 → true、視窗外 → false; 既有欄位不變', async function() {
            let out = []
            let keys = null
            for (let [i, ago] of [5 * MIN, 20 * MIN].entries()) {
                let store = memStore({ [`e${i}:500`]: { at: Date.now() - ago, n: 1, reason: 'timeout' } })
                let ev = []
                await dispatchAiFallback('abc', { ...CFG, coolAfterFails: 1, store, providers: [rest(`e${i}:500`, `500:cr-e${i}`)], onEvent: (e) => ev.push(e) })
                let c = cooledOf(ev)
                out.push(c.map((e) => [e.reason, e.n, e.streak, e.renewed]))
                keys = Object.keys(c[0]).sort()
            }
            assert.strict.deepEqual(out, [[['streak', 1, 1, true]], [['streak', 2, 1, false]]])
            assert.strict.deepEqual(keys, ['attempted', 'cooldownMs', 'error', 'errorType', 'keyId', 'keyIndex', 'keys', 'n', 'providerId', 'reason', 'renewed', 'streak', 'type'])
        })

        //R3 內建觸發之既有欄位逐一不變(值與鍵集合)
        it('R3 內建觸發之 cooled 鍵集合 = 既有欄位 + renewed, 既有欄位之值不變', async function() {
            let store = memStore({})
            let ev = []
            let r = await dispatchAiFallback('abc', { ...CFG, store, providers: [rest('f:429', '429:cr-f')], onEvent: (e) => ev.push(e) })
            let c = cooledOf(ev)[0]
            let { renewed, ...rest0 } = c
            //error、keyId 與同一次嘗試之 tried 項對照(外審 terra #12: 不以事件自身之值當期望)
            assert.strict.deepEqual(
                [renewed, rest0],
                [false, { type: 'cooled', providerId: 'f:429', keyIndex: 0, keyId: r.tried[0].keyId, error: r.tried[0].error, cooldownMs: 15 * MIN, n: 1, reason: 'rate-limit' }],
            )
            assert.strict.deepEqual([typeof r.tried[0].keyId, r.tried[0].error.length > 0], ['string', true])
        })

        //外審 terra #12①: 內建觸發之 timeout 原因(逾時): 視窗內 → true、視窗外 → false(真實之逾時 300ms)
        it('[真時間] 內建觸發 reason timeout(條目逾時 300ms): 視窗內 → true、視窗外 → false', async function() {
            let out = []
            for (let [i, ago] of [5 * MIN, 20 * MIN].entries()) {
                let store = memStore({ [`i${i}:hang`]: { at: Date.now() - ago, n: 1, reason: 'timeout' } })
                let ev = []
                await dispatchAiFallback('abc', { ...CFG, store, providers: [rest(`i${i}:hang`, `hang:cr-i${i}`, { timeoutMs: 300 })], onEvent: (e) => ev.push(e) })
                out.push(cooledOf(ev).map((e) => [e.reason, e.n, e.renewed]))
            }
            assert.strict.deepEqual(out, [[['timeout', 1, true]], [['timeout', 2, false]]])
        })

        //外審 terra #09: 整組沒額度而冷卻紀錄寫不進(cooling 表已凍結)時, 無紀錄可言: 事件同 n 不帶 renewed(不硬編 false), 其餘既有欄位照舊
        it('整組沒額度且冷卻紀錄寫不進(cooling 表凍結): 事件不帶 n 與 renewed, 既有欄位不變', async function() {
            let st = { cursors: {}, cooling: Object.freeze({ 'j:go': { at: Date.now() - 5 * MIN, n: 1, reason: 'timeout' } }) }
            let ev = []
            await dispatchAiFallback('abc', {
                ...CFG,
                store: { get: () => st, set: () => {} },
                providers: [{ id: 'j:go', kind: 'opencode', provider: 'opencode-go', model: 'opencode-go/x', exe: fake.exe, keys: ['go-key-ci421-j'], quotaGate: { usage: async () => ({ ok: true, usage: { rolling: { percent: 99, resetsAt: new Date(Date.now() + H).toISOString() } } }) } }],
                onEvent: (e) => ev.push(e),
            })
            let c = cooledOf(ev)
            assert.strict.deepEqual(c.map((e) => [e.scope, e.reason, 'n' in e, 'renewed' in e, e.cooldownMs]), [['entry', 'quota', false, false, 15 * MIN]])
        })

        //R1(鏈首被預算封頂 reason budget): 真實之逾時, 預算 1500ms、條目逾時 6000ms; 預寫紀錄(視窗內/視窗外)
        it('[真時間] 鏈首被預算封頂(reason budget): 視窗內(預寫 1分前) → renewed:true、n 不動; 視窗外(預寫 2小時前) → false', async function() {
            let out = []
            for (let [i, ago] of [MIN, 2 * H].entries()) {
                let store = memStore({ [`g${i}:hang`]: { at: Date.now() - ago, n: 3, reason: 'timeout' } })
                let ev = []
                let r = await dispatchAiFallback('abc', {
                    providers: [rest(`g${i}:hang`, `hang:cr-g${i}`, { timeoutMs: 6000 })],
                    budgetMs: 1500, //預算 1.5 秒(排程停頓至多容忍約 1.4 秒仍不致在嘗試前耗盡)
                    minAttemptMs: 100,
                    cooldownMs: 5 * MIN,
                    store,
                    onEvent: (e) => ev.push(e),
                })
                out.push([r.errorType, cooledOf(ev).map((e) => [e.reason, e.n, e.renewed])])
            }
            //預寫 n 3、reason timeout、cooldownMs 5分、growth 1(未給) → 有效視窗 5分: 1分前在視窗內; 2小時前在視窗外
            assert.strict.deepEqual(out, [['budget', [['budget', 3, true]]], ['budget', [['budget', 3, false]]]])
        })
    })
})
