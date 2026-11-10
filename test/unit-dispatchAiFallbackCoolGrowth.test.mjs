import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFileStore from '../src/wkf/createFileStore.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-dispatchAiFallbackCoolGrowth — 冷卻紀錄{ at, n, reason }與冷卻加長(Gitea #130)
// (2026-11-11 di402; 設計 da402-審計報告 §4.2 DA-4、§5.2〈DA〉DA-4; 帳本 sgud/rule/rulebook_cooling.md R-COOL-2)
//
// 以預先寫入之store紀錄模擬時間經過(不需假時鐘); 觸發改用替身伺服器之429快速回應。判定以store內容、tried順序與cooled事件為準。


let MIN = 60000
let H = 3600000

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


describe('dispatchAiFallback 冷卻紀錄與加長(da402 DA-4)', function() {

    let srv = null
    let fake = null
    let fdTmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'di402-coolgrowth')
    before(async function() {
        srv = await fakeServerForDeadlineTest()
        fake = createFakeCli('fake-di402-coolgrowth')
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
    let cfg = { cooldownMs: 15 * MIN, cooldownGrowth: 4, cooldownMaxMs: 4 * H }

    it('視窗外再觸發: { at: 現在−20分, n: 1 }、15分、growth 4 → 在鏈首, 觸發後n 2、cooled.cooldownMs 3600000', async function() {
        let store = memStore({ 'a:429': { at: Date.now() - 20 * MIN, n: 1, reason: 'timeout' } })
        let ev = []
        let r = await dispatchAiFallback('abc', { ...cfg, store, providers: [rest('a:429', '429:g1'), rest('a:ok', 'ok:g1')], onEvent: (e) => ev.push(e) })
        let c = ev.filter((e) => e.type === 'cooled')
        assert.strict.deepEqual(
            [r.tried.map((t) => t.providerId), c.map((e) => [e.providerId, e.n, e.cooldownMs, e.reason]), store.peek().cooling['a:429'].n],
            [['a:429', 'a:ok'], [['a:429', 2, 3600000, 'rate-limit']], 2],
        )
    })

    it('視窗內不加長且排尾: { at: 現在−50分, n: 2 }(有效視窗60分)→ 排尾; 前面條目成交則不被嘗試', async function() {
        let store = memStore({ 'b:429': { at: Date.now() - 50 * MIN, n: 2, reason: 'timeout' } })
        let r = await dispatchAiFallback('abc', { ...cfg, store, providers: [rest('b:429', '429:g2'), rest('b:ok', 'ok:g2')] })
        assert.strict.deepEqual([r.ok, r.tried.map((t) => t.providerId), store.peek().cooling['b:429'].n], [true, ['b:ok'], 2])
    })

    it('視窗內之觸發(最後手段)只更新at、n不增', async function() {
        let at0 = Date.now() - 5 * MIN
        let store = memStore({ 'c:429': { at: at0, n: 2, reason: 'timeout' } })
        let ev = []
        let r = await dispatchAiFallback('abc', { ...cfg, store, providers: [rest('c:429', '429:g3'), rest('c:500', '500:g3')], onEvent: (e) => ev.push(e) })
        let rec = store.peek().cooling['c:429']
        assert.strict.deepEqual([r.tried.map((t) => t.providerId), rec.n, rec.at > at0, ev.filter((e) => e.type === 'cooled').map((e) => [e.providerId, e.n])], [['c:500', 'c:429'], 2, true, [['c:429', 2]]])
    })

    it('同一次呼叫兩把金鑰各429 → n只+1、cooled只一則', async function() {
        let store = memStore({ 'd:429': { at: Date.now() - 20 * MIN, n: 1, reason: 'timeout' } })
        let ev = []
        await dispatchAiFallback('abc', { ...cfg, store, providers: [rest('d:429', '429:g4', { keys: ['sk-d1', 'sk-d2'] })], onEvent: (e) => ev.push(e) })
        assert.strict.deepEqual([store.peek().cooling['d:429'].n, ev.filter((e) => e.type === 'cooled').length, ev.filter((e) => e.type === 'next-key').length], [2, 1, 2])
    })

    it('成交刪紀錄(n歸零)', async function() {
        let store = memStore({ 'e:ok': { at: Date.now() - 20 * MIN, n: 3, reason: 'timeout' } })
        let r = await dispatchAiFallback('abc', { ...cfg, store, providers: [rest('e:ok', 'ok:g5')] })
        assert.strict.deepEqual([r.ok, store.peek().cooling['e:ok']], [true, undefined])
    })

    it('n大 → 有效視窗為cooldownMaxMs(4小時)', async function() {
        let store = memStore({ 'f:429': { at: Date.now() - 5 * H, n: 10, reason: 'timeout' } })
        let ev = []
        await dispatchAiFallback('abc', { ...cfg, store, providers: [rest('f:429', '429:g6')], onEvent: (e) => ev.push(e) })
        assert.strict.deepEqual(ev.filter((e) => e.type === 'cooled').map((e) => [e.n, e.cooldownMs]), [[11, 4 * H]])
    })

    it('reason quota(整組沒額度)不動n、有效視窗恆為cooldownMs', async function() {
        let store = memStore({ 'g:go': { at: Date.now() - 5 * H, n: 3, reason: 'timeout' } })
        let ev = []
        await dispatchAiFallback('abc', {
            ...cfg,
            store,
            providers: [{ id: 'g:go', kind: 'opencode', provider: 'opencode-go', model: 'opencode-go/x', exe: fake.exe, keys: ['go-key-di402-g7'], quotaGate: { usage: async () => ({ ok: true, usage: { rolling: { percent: 99, resetsAt: new Date(Date.now() + H).toISOString() } } }) } }],
            onEvent: (e) => ev.push(e),
        })
        let rec = store.peek().cooling['g:go']
        assert.strict.deepEqual([rec.n, rec.reason, ev.filter((e) => e.type === 'cooled').map((e) => [e.scope, e.reason, e.n, e.cooldownMs])], [3, 'quota', [['entry', 'quota', 3, 15 * MIN]]])
    })

    it('cooldownGrowth未給: 視窗恆為cooldownMs, 排序與修前相同(舊格式數字紀錄: 10分前冷卻中排尾、20分前已過期在前)', async function() {
        let now = Date.now()
        let store = memStore({ 'h:a': now - 10 * MIN, 'h:b': now - 20 * MIN })
        let r = await dispatchAiFallback('abc', { cooldownMs: 15 * MIN, store, providers: [rest('h:a', '500:g8a'), rest('h:b', '500:g8b')] })
        assert.strict.deepEqual(r.tried.map((t) => t.providerId), ['h:b', 'h:a'])
    })

    it('舊格式數字紀錄讀入視為n 1: 過期後再觸發 → n 2、cooldownMs 60分', async function() {
        let store = memStore({ 'i:429': Date.now() - 20 * MIN })
        let ev = []
        await dispatchAiFallback('abc', { ...cfg, store, providers: [rest('i:429', '429:g9')], onEvent: (e) => ev.push(e) })
        assert.strict.deepEqual([store.peek().cooling['i:429'].n, ev.filter((e) => e.type === 'cooled').map((e) => e.cooldownMs)], [2, [60 * MIN]])
    })

    it('at在未來 → 視為現在(冷卻中排尾, 並改寫為不晚於現在)', async function() {
        let store = memStore({ 'j:a': { at: Date.now() + 10 * H, n: 1, reason: 'timeout' } })
        let r = await dispatchAiFallback('abc', { ...cfg, store, providers: [rest('j:a', '500:g10a'), rest('j:b', '500:g10b')] })
        assert.strict.deepEqual([r.tried.map((t) => t.providerId), store.peek().cooling['j:a'].at <= Date.now()], [['j:b', 'j:a'], true])
    })

    it('畸形紀錄丟棄(at非數、n<1); 不在本次providers之久未觸發紀錄被清除, 未逾清除門檻者保留', async function() {
        let now = Date.now()
        let store = memStore({
            'k:bad1': { at: 'x', n: 1 },
            'k:bad2': { at: now, n: 0 },
            'k:gone': { at: now - 30 * H, n: 1, reason: 'timeout' }, //逾有效視窗(15分)＋cooldownMaxMs(預設24小時)
            'k:keep': { at: now - 1 * H, n: 1, reason: 'timeout' },
        })
        await dispatchAiFallback('abc', { cooldownMs: 15 * MIN, store, providers: [rest('k:ok', 'ok:g11')] })
        assert.strict.deepEqual(Object.keys(store.peek().cooling).sort(), ['k:keep'])
    })

    it('持久化: 以新store物件(createFileStore同一檔)讀回之n延續, 檔內為{ at, n, reason }', async function() {
        let file = path.join(fdTmp, 'state.json')
        fs.writeFileSync(file, JSON.stringify({ cursors: {}, cooling: { 'l:429': { at: Date.now() - 20 * MIN, n: 1, reason: 'timeout' } } }), 'utf8')
        await dispatchAiFallback('abc', { ...cfg, store: createFileStore({ file }), providers: [rest('l:429', '429:g12')] })
        let onDisk = JSON.parse(fs.readFileSync(file, 'utf8')).cooling['l:429']
        let again = createFileStore({ file }).get().cooling['l:429']
        assert.strict.deepEqual([onDisk.n, onDisk.reason, again.n], [2, 'rate-limit', 2])
    })

})
