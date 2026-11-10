import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFileStore from '../src/wkf/createFileStore.mjs'
import fakeServerForDeadlineTest from './tools/fakeServerForDeadlineTest.mjs'


// unit-createFileStoreShared — 同一行程同一檔案共用一個狀態物件(並行之呼叫不再各持舊快照整份寫回)
// (2026-11-11 di402; 設計 da402-審計報告 §4.2 DA-10、§5.2〈DA〉DA-10; opus#20、terra#16)


let MIN = 60000


describe('createFileStore 同一行程同一檔案共用狀態物件(da402 DA-10)', function() {

    let srv = null
    let fdTmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'di402-filestore')
    before(async function() {
        srv = await fakeServerForDeadlineTest()
        fs.mkdirSync(fdTmp, { recursive: true })
    })
    after(async function() {
        await srv.close()
        fs.rmSync(fdTmp, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(fdTmp)) //test/_tmp已空才移除(並行之他測試仍在用時失敗即忽略)
        }
        catch {}
    })

    let rest = (id, model, extra = {}) => ({ id, kind: 'api-openai-compat', baseURL: srv.url, model, keys: [`sk-${id}`], ...extra })

    it('[真時間] 兩個並行呼叫各觸發一次: 檔內n只+1、已刪紀錄不復活', async function() {
        let file = path.join(fdTmp, 'shared.json')
        let now = Date.now()
        //x以舊格式數字預寫(修前版本亦視為冷卻中), 令「已刪紀錄被後寫者復活」於修前可重現
        fs.writeFileSync(file, JSON.stringify({ cursors: {}, cooling: { z: { at: now - 20 * MIN, n: 1, reason: 'timeout' }, x: now - 1 * MIN } }), 'utf8')
        let opt = { cooldownMs: 15 * MIN, cooldownGrowth: 4 }
        //A: z(429, 視窗外 → n 2) → x(冷卻中排尾, 成交 → 刪紀錄); B(並行): z(429, 視窗內 → n不增) → y(掛起300ms逾時 → 冷卻)
        let [ra, rb] = await Promise.all([
            dispatchAiFallback('abc', { ...opt, store: createFileStore({ file }), providers: [rest('x', 'ok:fs-x'), rest('z', '429:fs-za')] }),
            dispatchAiFallback('abc', { ...opt, store: createFileStore({ file }), providers: [rest('z', '429:fs-zb'), rest('y', 'hang:fs-y', { timeoutMs: 300 })] }),
        ])
        let disk = JSON.parse(fs.readFileSync(file, 'utf8')).cooling
        assert.strict.deepEqual(
            [ra.ok, ra.tried.map((t) => t.providerId), rb.ok, disk.z.n, disk.x, disk.y.reason],
            [true, ['z', 'x'], false, 2, undefined, 'timeout'],
        )
    })

    it('同一檔之兩個store之get回同一物件; 檔案於行程外被改動或刪除時, 下一次get重讀並就地換掉內容', function() {
        let file = path.join(fdTmp, 'reload.json')
        fs.writeFileSync(file, JSON.stringify({ cursors: { a: 1 } }), 'utf8')
        let s1 = createFileStore({ file })
        let s2 = createFileStore({ file })
        let o1 = s1.get()
        let same = o1 === s2.get()
        s1.set(o1)
        let afterOwnWrite = s2.get() === o1
        fs.writeFileSync(file, JSON.stringify({ cursors: { b: 2 }, at: 'x' }), 'utf8')
        let o3 = s2.get()
        let reloaded = [o3 === o1, JSON.stringify(o3)]
        fs.rmSync(file)
        let o4 = s1.get()
        assert.strict.deepEqual([same, afterOwnWrite, reloaded, o4 === o1, JSON.stringify(o4)], [true, true, [true, '{"cursors":{"b":2}}'], true, '{}'])
    })

})
