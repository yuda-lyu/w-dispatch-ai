import assert from 'assert'
import { awaitUserFn, callHookSync } from '../src/callUserFn.mjs'
import userFnForms, { captureUnhandled } from './tools/userFnFormsForTest.mjs'


describe('callUserFn', function() {

    it('awaitUserFn: 各回傳形態皆落定且不拋錯, 同步值與resolve值為value、拋錯與reject為threw(附訊息)、永不落定與慢於上限為timeout', async function() {
        //規格: 帳本R-USERFN-1——內容類回調支援非同步, 以timeoutMs為等待上限; 拋錯、reject、逾時皆以結果回報, 不拋錯不reject
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of userFnForms('T', 'F', 400)) {
                let t0 = Date.now()
                let v = await awaitUserFn(() => f.fn(), 150)
                let ms = Date.now() - t0
                rows.push([f.label, v.state, v.state === 'value' ? v.value : null, typeof v.msg, v.state === 'timeout' ? (ms >= 140 && ms < 1000) : true])
            }
            return rows
        })
        let rr = [
            ['sync-true', 'value', 'T', 'string', true],
            ['sync-false', 'value', 'F', 'string', true],
            ['sync-throw', 'threw', null, 'string', true],
            ['throw-null', 'threw', null, 'string', true],
            ['throw-revoked', 'threw', null, 'string', true],
            ['async-true', 'value', 'T', 'string', true],
            ['async-false', 'value', 'F', 'string', true],
            ['async-reject', 'threw', null, 'string', true],
            ['reject-revoked', 'threw', null, 'string', true],
            ['thenable-throws', 'threw', null, 'string', true],
            ['never', 'timeout', null, 'string', true],
            ['slow-true', 'timeout', null, 'string', true],
        ]
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('awaitUserFn: 拋錯訊息取message(null為null、已撤銷Proxy為unknown error), 逾時訊息載明秒數, 超長訊息截斷至500字元並標註原長', async function() {
        //規格: 帳本R-USERFN-1之訊息規則(同wsemi之execCli: getErrorMessage→String→unknown error, 截斷500)
        let p = Proxy.revocable({}, {})
        p.revoke()
        let a = await awaitUserFn(() => {
            throw new Error('x-msg')
        }, 100)
        let b = await awaitUserFn(() => {
            throw null // eslint-disable-line no-throw-literal
        }, 100)
        let c = await awaitUserFn(() => {
            throw p.proxy
        }, 100)
        let d = await awaitUserFn(() => new Promise(() => {}), 100)
        let e = await awaitUserFn(() => {
            throw new Error('L'.repeat(200000))
        }, 100)
        let r = [a.msg, b.msg, c.msg, d.msg, e.msg.length < 600, e.msg.includes('total 200000 chars')]
        let rr = ['x-msg', 'null', 'unknown error', 'did not settle within 0.1s', true, true]
        assert.strict.deepEqual(r, rr)
    })

    it('awaitUserFn: 逾時後使用者Promise才reject亦不成為未處理之rejection; 正常落定後不殘留計時器', async function() {
        //規格: 帳本R-USERFN-1之不變式——任何回傳形態皆不得使行程因未處理之rejection結束
        let { value: r, seen } = await captureUnhandled(async () => {
            let late = await awaitUserFn(() => new Promise((resolve, reject) => setTimeout(() => reject(new Error('late')), 150)), 50)
            await new Promise((resolve) => setTimeout(resolve, 200))
            let n0 = process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length
            await awaitUserFn(async () => 1, 60000)
            let n1 = process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length
            return [late.state, n1 <= n0]
        })
        let rr = ['timeout', true]
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('awaitUserFn: Promise.resolve同步拋錯(原生Promise之constructor getter拋錯)時回threw且不遺留計時器', async function() {
        //規格: 帳本R-USERFN-1之不變式(不拋錯、不reject、不遺留計時器); 複審B3
        let p = Promise.resolve(true)
        Object.defineProperty(p, 'constructor', {
            get: () => {
                throw new Error('ctor-boom')
            },
        })
        await new Promise((resolve) => setImmediate(resolve)) //先讓mocha於測試函數回傳Promise後重設其逾時計時器, 再取基準數
        let n0 = process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length
        let v = await awaitUserFn(() => p, 60000)
        let n1 = process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length
        assert.strict.deepEqual([v.state, v.msg, n1 <= n0], ['threw', 'ctor-boom', true])
    })

    it('callHookSync: 同步值照用, 拋錯為threw, 回傳Promise為async且其rejection被承接', async function() {
        //規格: 帳本R-USERFN-1——控制類回調同步契約, 回傳thenable視同失敗並承接其rejection
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of userFnForms(true, false, 50)) {
                let h = callHookSync(() => f.fn())
                rows.push([f.label, h.state, h.state === 'value' ? h.value : null])
            }
            await new Promise((resolve) => setTimeout(resolve, 100))
            return rows
        })
        let rr = [
            ['sync-true', 'value', true],
            ['sync-false', 'value', false],
            ['sync-throw', 'threw', null],
            ['throw-null', 'threw', null],
            ['throw-revoked', 'threw', null],
            ['async-true', 'async', null],
            ['async-false', 'async', null],
            ['async-reject', 'async', null],
            ['reject-revoked', 'async', null],
            ['thenable-throws', 'async', null],
            ['never', 'async', null],
            ['slow-true', 'async', null],
        ]
        assert.strict.deepEqual([r, seen], [rr, []])
    })

})
