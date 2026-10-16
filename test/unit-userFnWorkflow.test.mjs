import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import callAiWithFallback from '../src/wkf/callAiWithFallback.mjs'
import runRolePipeline from '../src/wkf/runRolePipeline.mjs'
import runFanout from '../src/wkf/runFanout.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createFileStore from '../src/wkf/createFileStore.mjs'
import createUsageCounter from '../src/wkf/createUsageCounter.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'
import userFnForms, { captureUnhandled } from './tools/userFnFormsForTest.mjs'


describe('工作流層與遞補層之注入函數(回傳形態)', function() {

    let fake = null
    let svr = null
    let fdTmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'ufw') //測試暫存落test/_tmp/<案名>/(gitignore), after刪除

    before(async function() {
        fake = createFakeCli('fake-ufw')
        svr = await fakeServerForApiTest()
        fs.mkdirSync(fdTmp, { recursive: true })
    })

    after(async function() {
        if (fake) {
            fake.clean()
        }
        if (svr) {
            await svr.close()
        }
        fs.rmSync(fdTmp, { recursive: true, force: true })
    })

    //假CLI之stdout為JSON回聲(含args/stdin), 故預設parse可解析出物件
    let providers = () => ({
        A: { kind: 'claude', exe: fake.exe, timeoutMs: 1500 },
        B: { kind: 'claude', exe: fake.exe, timeoutMs: 1500 },
    })

    it('callAi之check: 回傳Promise者以resolve值判定(須為true), 拋錯/reject視同驗證失敗且遞補歷程stderr帶validate threw、逾時帶validate timed out', async function() {
        //規格: 帳本R-USERFN-2——工作流之check經轉接器之validate判定, 拋錯不在工作流層吞掉; README dispatchAiWkf段(非法回覆視為該家失敗而自動遞補)
        let forms = userFnForms(true, false, 3000)
        let mark = (x) => {
            let s = String(x.stderr || '')
            return s.indexOf('validate threw: ') === 0 ? 'threw' : s.indexOf('validate timed out: ') === 0 ? 'timeout' : x.outcome
        }
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of forms) {
                let t = await callAiWithFallback('abc', { providers: providers(), spec: { use: 'A', fallback: ['B'] }, promptPrefix: '', check: f.fn })
                rows.push([f.label, t.ok, t.errorType, t.tried.map(mark)])
            }
            return rows
        })
        let rr = forms.map((f) => (f.kind === 'pass'
            ? [f.label, true, undefined, ['ok']]
            : [f.label, false, 'validation', f.kind === 'fail' ? ['skip-group', 'skip-group'] : [f.kind, f.kind]]))
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('callAi之條目validate鍵存在但值無效(undefined、null、空字串)時不得繞過工作流之parse＋check, 不過即換下一家', async function() {
        //規格: README行為變更紀錄1.0.37第4條(條目validate不再繞過工作流驗證); 複審B1
        let rows = []
        for (let v of [undefined, null, '']) {
            let ps = providers()
            ps.A.validate = v
            let t = await callAiWithFallback('abc', { providers: ps, spec: { use: 'A', fallback: ['B'] }, promptPrefix: '', check: (j) => j.nope === 1 })
            rows.push([String(v), t.ok, t.errorType, t.tried.map((x) => [x.providerId, x.outcome])])
        }
        let rr = ['undefined', 'null', ''].map((k) => [k, false, 'validation', [['A', 'skip-group'], ['B', 'skip-group']]])
        assert.strict.deepEqual(rows, rr)
    })

    it('runFanout預設整合模板遇不可序列化之候選(自訂parse回BigInt)時以integrate prompt threw回報, 不reject', async function() {
        //規格: README行為變更紀錄1.0.48第21條(整合prompt拋錯改回失敗結果並保留候選)與「All functions never reject」; 複審A1
        let q = await runFanout({ providers: providers(), task: 't', agents: [{ use: 'A' }, { use: 'B' }], integrate: { use: 'A' }, callOpt: { promptPrefix: '', parse: () => ({ n: 1n }) } })
        let r = [q.ok, q.candidates.length, /^integrate prompt threw: /.test(q.error)]
        assert.strict.deepEqual(r, [false, 2, true])
    })

    it('callAi之parse: 回傳Promise者以resolve值為成果(json為物件而非Promise), null/拋錯/逾時視同驗證失敗', async function() {
        //規格: README callAi之parse((stdout)=>Object|null); 帳本R-USERFN-2之「成果取驗證時之解析結果」
        let forms = userFnForms({ a: 1 }, null, 3000)
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of forms) {
                let t = await callAiWithFallback('abc', { providers: providers(), spec: { use: 'A' }, promptPrefix: '', parse: f.fn })
                rows.push([f.label, t.ok, t.ok ? t.json : t.errorType])
            }
            return rows
        })
        let rr = forms.map((f) => [f.label, f.kind === 'pass', f.kind === 'pass' ? { a: 1 } : 'validation'])
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('callAi之呼叫層validate與條目validate皆與工作流驗證取交集(不再被靜默忽略); 條目者不過換下一家', async function() {
        //規格: README行為變更紀錄1.0.37第4條(條目validate與工作流validate取交集), 延伸至呼叫層validate(帳本R-USERFN-2)
        let forms = userFnForms(true, false, 3000)
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of forms) {
                let top = await callAiWithFallback('abc', { providers: providers(), spec: { use: 'A', fallback: ['B'] }, promptPrefix: '', validate: f.fn })
                let ps = providers()
                ps.A.validate = f.fn
                let ent = await callAiWithFallback('abc', { providers: ps, spec: { use: 'A', fallback: ['B'] }, promptPrefix: '' })
                rows.push([f.label, top.ok, ent.ok, ent.providerId])
            }
            return rows
        })
        let rr = forms.map((f) => [f.label, f.kind === 'pass', true, f.kind === 'pass' ? 'A' : 'B'])
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('runRolePipeline之階段prompt與runFanout之整合prompt: 可為async, 拋錯/reject/逾時以該段失敗回報並保留成果, 不reject', async function() {
        //規格: README行為變更紀錄1.0.48第21條(prompt函式拋錯改回失敗結果); 帳本R-USERFN-1之prompt以該段timeoutMs為上限
        let forms = userFnForms('hi', '', 3000)
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of forms) {
                let p = await runRolePipeline({ providers: providers(), stages: [{ id: 's1', use: 'A', prompt: f.fn }], callOpt: { promptPrefix: '', timeoutMs: 1500 } })
                let q = await runFanout({ providers: providers(), task: 't', agents: [{ use: 'A' }, { use: 'B' }], integrate: { use: 'A', prompt: f.fn }, callOpt: { promptPrefix: '', timeoutMs: 1500 } })
                let pe = p.ok ? 'ok' : /prompt threw: /.test(p.error) ? 'threw' : /prompt did not settle within 1.5s/.test(p.error) ? 'timeout' : /prompt returned empty/.test(p.error) ? 'empty' : p.error
                let qe = q.ok ? 'ok' : /integrate prompt threw: /.test(q.error) ? 'threw' : /integrate prompt did not settle within 1.5s/.test(q.error) ? 'timeout' : /prompt must be a non-empty string/.test(q.error) ? 'empty' : q.error
                rows.push([f.label, pe, qe, q.candidates.length])
            }
            return rows
        })
        let rr = forms.map((f) => {
            let e = f.kind === 'pass' ? 'ok' : f.kind === 'fail' ? 'empty' : f.kind
            return [f.label, e, e, 2]
        })
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('dispatchAiFallback之控制類回調: 同步契約, 回傳Promise視同false/讀不到且其rejection不使行程崩潰; 同步真值照舊生效', async function() {
        //規格: README Options for dispatchAiFallback之shouldStop/coolDetect(回調拋出例外視同false)、onEvent(回調拋出例外不影響主流程)、store; 帳本R-USERFN-1
        let forms = userFnForms(true, false, 3000)
        let formsGet = userFnForms({ cursors: { G: 1 } }, null, 3000) //store.get之通過值為帶游標之state
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let [i, f] of forms.entries()) {
                let s = await dispatchAiFallback('abc', { providers: [{ id: 'A', kind: 'claude', exe: fake.exe }], shouldStop: f.fn })
                let st = { cursors: {} }
                await dispatchAiFallback('abc', {
                    providers: [{ id: 'A', kind: 'claude', exe: fake.exe, extraArgs: ['--fake-exit=1'] }, { id: 'B', kind: 'claude', exe: fake.exe }],
                    cooldownMs: 60000,
                    coolDetect: f.fn,
                    store: {
                        get: () => st,
                        set: (x) => {
                            st = x
                        }
                    },
                })
                let e = await dispatchAiFallback('abc', { providers: [{ id: 'A', kind: 'claude', exe: fake.exe }], onEvent: f.fn })
                let g = await dispatchAiFallback('abc', { providers: [{ id: 'G', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-k0', 'sk-k1'] }], store: { get: formsGet[i].fn, set: () => {} } })
                let w = await dispatchAiFallback('abc', { providers: [{ id: 'G', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-k0', 'sk-k1'] }], store: { get: () => ({ cursors: {} }), set: f.fn } })
                rows.push([f.label, s.error === 'ABORTED', !!(st.cooling && st.cooling.A), e.ok, g.keyIndex, w.ok])
            }
            return rows
        })
        let rr = forms.map((f) => [f.label, f.label === 'sync-true', f.label === 'sync-true', true, f.label === 'sync-true' ? 1 : 0, true])
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('createFileStore之stamp與createUsageCounter之getDate/keyOf: 拋錯或回傳Promise皆退用預設, 不外拋不崩潰', async function() {
        //規格: createFileStore.mjs檔頭「執行期之get/set則不throw」、createUsageCounter.mjs檔頭「執行期之記帳與查詢則不throw」; 帳本R-USERFN-1之工廠注入函數(複審D2/G1)
        let forms = userFnForms('X', 'Y', 50).filter((x) => x.kind !== 'pass' || x.label === 'async-true')
        let { value: r, seen } = await captureUnhandled(async () => {
            let rows = []
            for (let f of forms) {
                let fp = path.join(fdTmp, `s-${f.label}.json`)
                let threw = ''
                try {
                    createFileStore({ file: fp, stamp: f.fn }).set({ cursors: { a: 1 } })
                }
                catch {
                    threw = 'X'
                }
                let at = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')).at : null
                let fu = path.join(fdTmp, `u-${f.label}.json`)
                let cu = createUsageCounter({ file: fu, getDate: f.fn, keyOf: f.fn })
                let threwU = ''
                try {
                    cu.onEvent({ type: 'try', keyId: 'kk' })
                }
                catch {
                    threwU = 'X'
                }
                let j = fs.existsSync(fu) ? JSON.parse(fs.readFileSync(fu, 'utf8')) : null
                rows.push([f.label, threw, typeof at, threwU, j === null ? null : Object.values(j).map((o) => Object.keys(o)).flat()])
            }
            await new Promise((resolve) => setTimeout(resolve, 100)) //令慢速形態之Promise於監看期內落定
            return rows
        })
        let rr = forms.map((f) => {
            if (f.label === 'sync-false') {
                return [f.label, '', 'string', '', ['Y']] //同步值照用(Y)
            }
            return [f.label, '', 'string', '', ['kk']] //拋錯或非同步: 時戳退預設ISO字串、日期退預設、鍵退預設keyId
        })
        assert.strict.deepEqual([r, seen], [rr, []])
    })

    it('store.get拋錯、回傳Promise或回傳不可讀之物件, 或store本身不可讀時, 本次以全新狀態執行且不回寫(不覆寫既有之cursors與cooling), 不reject; get回null時照舊以全新狀態起始並寫回', async function() {
        //規格: README之store列(state原封存還; 自行實作時務必整包原封存還)——讀不到時不得以全新狀態覆寫; 帳本R-USERFN-1之store.get(同步契約、失敗本次不回寫); 複審C5
        let revoked = () => {
            let p = Proxy.revocable({}, {})
            p.revoke()
            return p.proxy
        }
        let rows = []
        for (let label of ['throws', 'async', 'get-revoked', 'store-revoked', 'get-getter-throws', 'get-null']) {
            let writes = 0
            let set = () => {
                writes++
            }
            let store = null
            if (label === 'throws') {
                store = {
                    get: () => {
                        throw new Error('get boom')
                    },
                    set,
                }
            }
            else if (label === 'async') {
                store = { get: async () => ({ cursors: { G: 1 } }), set }
            }
            else if (label === 'get-revoked') {
                store = { get: () => revoked(), set }
            }
            else if (label === 'store-revoked') {
                store = revoked()
            }
            else if (label === 'get-getter-throws') {
                store = { set }
                Object.defineProperty(store, 'get', {
                    get: () => {
                        throw new Error('get getter boom')
                    },
                })
            }
            else {
                store = { get: () => null, set }
            }
            let t = null
            try {
                t = await dispatchAiFallback('abc', {
                    providers: [{ id: 'G', kind: 'api-openai-compat', baseURL: svr.url, model: 'echo', keys: ['sk-s0', 'sk-s1'] }],
                    store,
                })
            }
            catch (err) {
                t = { ok: `rejected:${String(err && err.message)}` }
            }
            rows.push([label, t.ok, writes])
        }
        let rr = [['throws', true, 0], ['async', true, 0], ['get-revoked', true, 0], ['store-revoked', true, 0], ['get-getter-throws', true, 0], ['get-null', true, 1]]
        assert.strict.deepEqual(rows, rr)
    })

    it('呼叫端物件不可讀(拋錯之getter、已撤銷之Proxy)時不reject: REST之headers/body、body不可序列化、遞補與callAi之providers條目、遞補之providers陣列、systemone之questions、opencode之config皆以params回報', async function() {
        //規格: README「All functions never reject」; 帳本R-USERFN-1之呼叫端物件規則(readCallerObj); 複審G3、A2
        let bad = () => {
            let o = {}
            Object.defineProperty(o, 'X', {
                enumerable: true,
                get: () => {
                    throw new Error('getter boom')
                },
            })
            return o
        }
        let base = { baseURL: svr.url, model: 'echo', key: 'sk-g0' }
        let rows = []
        let rec = async (label, fn) => {
            try {
                let x = await fn()
                rows.push([label, x.ok, x.errorType])
            }
            catch (err) {
                rows.push([label, 'rejected', String(err && err.message)])
            }
        }
        await rec('headers', () => dispatchAiFallback('abc', { providers: [{ id: 'A', kind: 'api-openai-compat', ...base, headers: bad() }] }))
        await rec('body', () => dispatchAiFallback('abc', { providers: [{ id: 'A', kind: 'api-openai-compat', ...base, body: bad() }] }))
        await rec('body-bigint', () => dispatchAiFallback('abc', { providers: [{ id: 'A', kind: 'api-openai-compat', ...base, body: { n: 1n } }] }))
        await rec('fallback-entry', () => dispatchAiFallback('abc', { providers: [Object.assign(bad(), { id: 'A', kind: 'claude', exe: fake.exe })] }))
        await rec('callAi-entry', () => callAiWithFallback('abc', { providers: { A: Object.assign(bad(), { kind: 'claude', exe: fake.exe }) }, spec: { use: 'A' }, promptPrefix: '' }))
        let pv = Proxy.revocable([], {})
        pv.revoke()
        await rec('providers-array', () => dispatchAiFallback('abc', { providers: pv.proxy }))
        let pq = Proxy.revocable({}, {})
        pq.revoke()
        await rec('systemone-questions', () => dispatchAiFallback('abc', { providers: [{ id: 'A', kind: 'api-typesafe-systemone', ...base, questions: pq.proxy }] }))
        await rec('systemone-questions-getter', () => dispatchAiFallback('abc', { providers: [{ id: 'A', kind: 'api-typesafe-systemone', ...base, questions: bad() }] }))
        let pc = Proxy.revocable({}, {})
        pc.revoke()
        await rec('opencode-config', () => dispatchAiFallback('abc', { providers: [{ id: 'A', kind: 'opencode', exe: fake.exe, config: pc.proxy }] }))
        let rr = [
            ['headers', false, 'params'], ['body', false, 'params'], ['body-bigint', false, 'params'], ['fallback-entry', false, 'params'], ['callAi-entry', false, 'params'], ['providers-array', false, 'params'],
            ['systemone-questions', false, 'params'], ['systemone-questions-getter', false, 'params'], ['opencode-config', false, 'params'],
        ]
        assert.strict.deepEqual(rows, rr)
    })

})
