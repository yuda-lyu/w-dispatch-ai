import fs from 'fs'
import path from 'path'
import http from 'http'
import { fileURLToPath } from 'url'
import assert from 'assert'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchApiOpenaiResponses from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import dispatchAiWkf from '../src/dispatchAiWkf.mjs'
import callAiWithFallback from '../src/wkf/callAiWithFallback.mjs'
import runRolePipeline from '../src/wkf/runRolePipeline.mjs'
import runFanout from '../src/wkf/runFanout.mjs'
import createFileStore from '../src/wkf/createFileStore.mjs'
import createUsageCounter from '../src/wkf/createUsageCounter.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import fakeServerForApiTest from './tools/fakeServerForApiTest.mjs'
import { revoked, captureUnhandled } from './tools/userFnFormsForTest.mjs'


// 第三方獨立審(2026-10-16, opus/sol/deepseek)所補之格: 回傳形態與呼叫端物件之邊界、終止路徑、對稱性與時限
// 規格出處: 帳本R-USERFN-1/2、R-NOREJECT-1、R-REDACT-1; README「All functions never reject」與行為變更紀錄1.0.49起各條


//slowCompatServer, 延遲delayMs才回OpenAI相容回覆之假伺服器(供量測「驗證與HTTP共用該次嘗試之時限」), listen(0)取動態埠
async function slowCompatServer(delayMs) {
    let srv = http.createServer((req, res) => {
        req.resume()
        req.on('end', () => {
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ choices: [{ message: { content: 'slow-ok' }, finish_reason: 'stop' }] }))
            }, delayMs)
        })
    })
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
    let port = srv.address().port
    return {
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((resolve) => {
            srv.closeAllConnections()
            srv.close(resolve)
        }),
    }
}


//badGetter, 帶一個拋錯getter之一般物件
function badGetter(key = 'X', msg = 'getter boom') {
    let o = {}
    Object.defineProperty(o, key, {
        enumerable: true,
        get: () => {
            throw new Error(msg)
        },
    })
    return o
}


describe('呼叫端注入之函數與物件(外審補格)', function() {

    let fake = null
    let svr = null
    let fdTmp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', `ufh-${process.pid}`) //測試暫存落test/_tmp/<案名>/(gitignore), after刪除

    before(async function() {
        fake = createFakeCli('fake-ufh')
        svr = await fakeServerForApiTest()
        fs.rmSync(fdTmp, { recursive: true, force: true })
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

    it('callAi: 逾時而被遞補淘汰之前一家, 其晚到之parse結果不得覆寫後一家(同stdout)之成果json', async function() {
        //規格: 帳本R-USERFN-2「成果json取驗證通過時記下之解析結果」(Q6); README行為變更紀錄1.0.49起第25條; 外審sol F1
        let base = { baseURL: svr.url, model: 'echo', key: 'sk-late' } //兩家同金鑰同模型, 回聲之content(=stdout)相同
        let count = 0
        let releaseFirst = null
        let r = await callAiWithFallback('p', {
            providers: { A: { kind: 'api-openai-compat', ...base, timeoutMs: 150 }, B: { kind: 'api-openai-compat', ...base } },
            spec: { use: 'A', fallback: ['B'] },
            promptPrefix: '',
            parse: () => {
                count++
                if (count === 1) {
                    return new Promise((resolve) => {
                        releaseFirst = resolve
                    })
                }
                return { parsedFor: 'B' }
            },
            onEvent: (ev) => {
                if (ev.type === 'ok' && ev.providerId === 'B' && releaseFirst) {
                    releaseFirst({ parsedFor: 'A-late' }) //A之解析於B成交當下才落定(最易與取成果競爭之時點)
                }
            },
        })
        await new Promise((resolve) => setTimeout(resolve, 50))
        assert.strict.deepEqual([r.ok, r.providerId, r.json, r.tried.map((x) => [x.providerId, x.outcome])], [true, 'B', { parsedFor: 'B' }, [['A', 'skip-group'], ['B', 'ok']]])
    })

    it('validate回傳之thenable: then為有狀態getter時只讀一次並以之承接(resolve假即不過); 原生Promise之自有then getter拋錯時以內建then承接其結果, 不遺留rejection', async function() {
        //規格: 帳本R-USERFN-1之awaitUserFn(then只讀一次; 原生Promise以內建then承接)、不變式(不得使行程因未處理之rejection結束); 外審sol F3、F4
        let mkStateful = () => {
            let n = 0
            let o = {}
            Object.defineProperty(o, 'then', {
                get: () => {
                    n++
                    return n === 1 ? (resolve) => resolve(false) : undefined
                },
            })
            return o
        }
        let mkHiddenThen = (fail) => {
            let p = fail ? Promise.reject(new Error('hidden-then-rejection')) : Promise.resolve(false)
            Object.defineProperty(p, 'then', {
                get: () => {
                    throw new Error('then-getter-boom')
                },
            })
            return p
        }
        let { value: rows, seen } = await captureUnhandled(async () => {
            let out = []
            for (let [label, mk] of [['stateful-then', mkStateful], ['native-hidden-then-false', () => mkHiddenThen(false)], ['native-hidden-then-reject', () => mkHiddenThen(true)]]) {
                let c = await dispatchClaude('abc', { exe: fake.exe, validate: () => mk() })
                let s = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-th', model: 'echo', validate: () => mk() })
                out.push([label, c.ok, c.errorType, s.ok, s.errorType])
            }
            return out
        })
        let rr = [
            ['stateful-then', false, 'validation', false, 'validation'],
            ['native-hidden-then-false', false, 'validation', false, 'validation'],
            ['native-hidden-then-reject', false, 'validation', false, 'validation'],
        ]
        assert.strict.deepEqual([rows, seen], [rr, []])
    })

    it('dispatchAiFallback: 啟用冷卻時條目之id getter拋錯以params整組跳過續試下一組(不reject), 有狀態之id getter只讀一次; 已撤銷之條目不悄悄濾除而留下params歷程', async function() {
        //規格: 帳本R-USERFN-1之readCallerObj(只讀一次、不可讀即params、遞補條目整組跳過續試下一組); README行為變更紀錄1.0.49起第28條; 外審opus F3、sol F5、F12
        let ok = { id: 'OK', kind: 'claude', exe: fake.exe }
        let bad = badGetter('id', 'id-getter')
        bad.kind = 'claude'
        let r1 = await dispatchAiFallback('abc', { providers: [bad, ok], cooldownMs: 1000 })
        let reads = 0
        let stateful = { kind: 'claude', exe: fake.exe }
        Object.defineProperty(stateful, 'id', {
            enumerable: true,
            get: () => {
                reads++
                return `S-${reads}`
            },
        })
        let r2 = await dispatchAiFallback('abc', { providers: [stateful], cooldownMs: 1000 })
        let r3 = await dispatchAiFallback('abc', { providers: [revoked(), ok] })
        let rows = [
            [r1.ok, r1.providerId, r1.tried.map((x) => [x.outcome, x.errorType || null])],
            [r2.ok, r2.providerId, reads],
            [r3.ok, r3.providerId, r3.tried.map((x) => [x.outcome, x.errorType || null]), /^providers\[0\] is not readable: /.test(r3.tried[0].error)],
        ]
        let rr = [
            [true, 'OK', [['skip-group', 'params'], ['ok', null]]],
            [true, 'S-1', 1],
            [true, 'OK', [['skip-group', 'params'], ['ok', null]], true],
        ]
        assert.strict.deepEqual(rows, rr)
    })

    it('REST三家: 標頭值之toString拋null或為已撤銷Proxy、body巢狀toJSON有狀態(第2次拋null)時不reject; 標頭值物化為字串一次, body只序列化一次(重試共用)', async function() {
        //規格: README「All functions never reject」; 帳本R-NOREJECT-1(錯誤訊息一律errMsg、REST之body送出前序列化一次)、R-USERFN-1(呼叫端物件不可讀即params); 外審opus F1、sol F6、F7
        let calls = {
            compat: (o) => dispatchApiOpenaiCompat('abc', { baseURL: svr.url, key: 'sk-h1', model: 'echo', ...o }),
            responses: (o) => dispatchApiOpenaiResponses('abc', { baseURL: svr.url, key: 'sk-h2', model: 'echo', ...o }),
            systemone: (o) => dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-h3', model: 'echo', questions: { q1: { type: 'noul', instructions: 'x?' } }, ...o }),
        }
        let rows = []
        for (let k of Object.keys(calls)) {
            let rec = async (label, o) => {
                try {
                    let t = await calls[k](o)
                    rows.push([k, label, t.ok, t.errorType])
                }
                catch (err) {
                    rows.push([k, label, 'rejected', String(err && err.message)])
                }
            }
            await rec('header-toString-throws-null', {
                headers: {
                    'X-A': {
                        toString() {
                            throw null // eslint-disable-line no-throw-literal
                        },
                    },
                },
            })
            await rec('header-revoked', { headers: { 'X-A': revoked() } })
            let n = 0
            await rec('body-toJSON-2nd-throws-null', {
                maxRetries: 1,
                retryDelayMs: 1,
                body: {
                    extra: {
                        toJSON() {
                            n++
                            if (n > 1) {
                                throw null // eslint-disable-line no-throw-literal
                            }
                            return 'once'
                        },
                    },
                },
            })
            rows.push([k, 'toJSON-calls', n])
        }
        let rr = []
        for (let k of Object.keys(calls)) {
            rr.push([k, 'header-toString-throws-null', false, 'params'], [k, 'header-revoked', false, 'params'], [k, 'body-toJSON-2nd-throws-null', true, undefined], [k, 'toJSON-calls', 1])
        }
        assert.strict.deepEqual(rows, rr)
    })

    it('REST: 以toString交出秘密之標頭包裝物件, 送出前失敗之錯誤訊息亦遮蔽其值(同字串標頭)', async function() {
        //規格: 帳本R-REDACT-1(錯誤訊息不得夾帶機密值; 遮蔽集合為Content-Type、Accept-Encoding以外之標頭值); 外審opus F8
        let secret = 'sk-SECRET\n-123456'
        let wrap = {
            toString() {
                return secret
            },
        }
        let a = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, model: 'echo', headers: { 'X-Api-Key': secret } })
        let b = await dispatchApiOpenaiCompat('abc', { baseURL: svr.url, model: 'echo', headers: { 'X-Api-Key': wrap } })
        let r = [a.ok, a.errorType, a.error.includes('sk-SECRET'), b.ok, b.errorType, b.error.includes('sk-SECRET')]
        assert.strict.deepEqual(r, [false, 'fetch', false, false, 'fetch', false])
    })

    it('REST(systemone): body覆寫之questions為已撤銷Proxy時以params回報(實際送出之questions同一try內判型), 不reject', async function() {
        //規格: 帳本R-USERFN-1(systemone之questions為呼叫端物件)、R-NOREJECT-1; 外審sol F17
        let t = null
        try {
            t = await dispatchApiTypesafeSystemone('abc', { baseURL: svr.url, key: 'sk-q', model: 'echo', questions: { q1: { type: 'noul', instructions: 'x?' } }, body: { questions: revoked() } })
        }
        catch (err) {
            t = { ok: `rejected:${String(err && err.message)}` }
        }
        assert.strict.deepEqual([t.ok, t.errorType], [false, 'params'])
    })

    it('工作流之交集validate與parse/check: 同步回傳已撤銷Proxy或then getter拋錯之物件時以真值判定, 與直呼轉接器一致', async function() {
        //規格: 帳本R-USERFN-2「同步值或resolve值以真值判定」(CLI、REST、遞補、工作流同規則); 外審sol F8
        let thenBoom = {}
        Object.defineProperty(thenBoom, 'then', {
            get: () => {
                throw new Error('then-getter-boom')
            },
        })
        let ps = () => ({ A: { kind: 'claude', exe: fake.exe } })
        let rows = []
        for (let [label, mk] of [['revoked', () => revoked()], ['then-getter', () => thenBoom]]) {
            let top = await callAiWithFallback('abc', { providers: ps(), spec: { use: 'A' }, promptPrefix: '', validate: () => mk() })
            let p2 = ps()
            p2.A.validate = () => mk()
            let ent = await callAiWithFallback('abc', { providers: p2, spec: { use: 'A' }, promptPrefix: '' })
            let chk = await callAiWithFallback('abc', { providers: ps(), spec: { use: 'A' }, promptPrefix: '', check: () => mk() })
            rows.push([label, top.ok, ent.ok, chk.ok])
        }
        //check須恰為true, 故回傳物件(真值而非true)為不過——同修前之check規則
        assert.strict.deepEqual(rows, [['revoked', true, true, false], ['then-getter', true, true, false]])
    })

    it('callAi: providers定義表、spec或spec.fallback不可讀時以params回報並標明是哪一個, 不reject', async function() {
        //規格: 帳本R-USERFN-1(callAi之providers條目與spec為呼叫端物件); 外審sol F9、opus F15
        let ps = { A: { kind: 'claude', exe: fake.exe } }
        let spec2 = badGetter('use', 'use-getter')
        let rows = []
        for (let [label, o] of [['providers-revoked', { providers: revoked(), spec: { use: 'A' } }], ['spec-revoked', { providers: ps, spec: revoked() }], ['spec-use-getter', { providers: ps, spec: spec2 }], ['spec-fallback-revoked', { providers: ps, spec: { use: 'A', fallback: revoked() } }]]) {
            let t = null
            try {
                t = await callAiWithFallback('abc', { ...o, promptPrefix: '' })
            }
            catch (err) {
                t = { ok: 'rejected', errorType: String(err && err.message), error: '' }
            }
            rows.push([label, t.ok, t.errorType, t.error.split(':')[0]])
        }
        let rr = [
            ['providers-revoked', false, 'params', 'providers is not readable'],
            ['spec-revoked', false, 'params', 'spec is not readable'],
            ['spec-use-getter', false, 'params', 'spec is not readable'],
            ['spec-fallback-revoked', false, 'params', 'spec is not readable'],
        ]
        assert.strict.deepEqual(rows, rr)
    })

    it('工作流規格不可讀(名額、整合、階段、callOpt之getter拋錯或已撤銷)時以該段失敗回報並保留已完成成果, 不reject; dispatchAiWkf不同步拋錯', async function() {
        //規格: 帳本R-USERFN-1(工作流規格為呼叫端物件)、R-NOREJECT-1(名額規格非物件該名額params失敗其餘照跑; prompt函式拋錯以該段失敗回報並保留成果); 外審opus F2、F5、sol F10
        let ps = { A: { kind: 'claude', exe: fake.exe } }
        let co = { promptPrefix: '' }
        let toStrBoom = {
            [Symbol.toStringTag]: 'Spec',
            toString() {
                throw new Error('toString-boom')
            },
        }
        let rec = async (fn) => {
            try {
                return await fn()
            }
            catch (err) {
                return { rejected: String(err && err.message) }
            }
        }
        let f1 = await rec(() => runFanout({ providers: ps, task: 't', agents: [badGetter('use', 'agent-use-getter'), { use: 'A' }, { use: 'A' }], integrate: { use: 'A' }, callOpt: co }))
        let f2 = await rec(() => runFanout({ providers: ps, task: 't', agents: [toStrBoom, { use: 'A' }], integrate: { use: 'A' }, callOpt: co }))
        let f3 = await rec(() => runFanout({ providers: ps, task: 't', agents: [{ use: 'A' }, { use: 'A' }], integrate: Object.assign(badGetter('prompt', 'integrate-getter'), { use: 'A' }), callOpt: co }))
        let p1 = await rec(() => runRolePipeline({ providers: ps, stages: [{ id: 'one', use: 'A', prompt: () => 'p' }, Object.assign(badGetter('prompt', 'stage-getter'), { id: 'two', use: 'A' })], callOpt: co }))
        let p2 = await rec(() => runRolePipeline({ providers: ps, stages: [{ id: 'one', use: 'A', prompt: () => 'p' }], callOpt: badGetter('timeoutMs', 'callopt-getter') }))
        let w = null
        try {
            let pr = dispatchAiWkf({ providers: ps }).runFanout({ task: 't', agents: [{ use: 'A' }], callOpt: badGetter('x', 'wkf-callopt-getter') })
            w = await pr
        }
        catch (err) {
            w = { rejected: String(err && err.message) }
        }
        let rows = [
            ['fanout-agent-getter', f1.ok, (f1.agents || []).map((x) => x.errorType || 'ok'), (f1.candidates || []).length],
            ['fanout-agent-toString', f2.ok, (f2.agents || []).map((x) => x.errorType || 'ok'), (f2.candidates || []).length],
            ['fanout-integrate-getter', f3.ok, (f3.candidates || []).length, /^integrate is not readable: /.test(f3.error)],
            ['pipeline-later-stage-getter', p1.ok, p1.failedStage, Object.keys(p1.results || {}), /^stages\[1\] is not readable: /.test(p1.error)],
            ['pipeline-callOpt-getter', p2.ok, /^callOpt is not readable: /.test(p2.error)],
            ['wkf-callOpt-getter', w.ok, /^callOpt is not readable: /.test(w.error)],
        ]
        let rr = [
            ['fanout-agent-getter', true, ['params', 'ok', 'ok'], 2],
            ['fanout-agent-toString', true, ['params', 'ok'], 1],
            ['fanout-integrate-getter', false, 2, true],
            ['pipeline-later-stage-getter', false, 'stage2', ['one'], true],
            ['pipeline-callOpt-getter', false, true],
            ['wkf-callOpt-getter', false, true],
        ]
        assert.strict.deepEqual(rows, rr)
    })

    it('工作流之agents/stages恰含1個敵意元素(已撤銷Proxy、Symbol.toStringTag拋錯)時與≥2個元素時同樣以該名額/階段失敗回報, 不reject', async function() {
        //規格: 帳本R-USERFN-1(工作流規格逐元素經readCallerObj); README行為變更紀錄1.0.49起第28條; 外審deepseek F1(wsemi之isearr於長度為1時判型第0個元素)
        let ps = { A: { kind: 'claude', exe: fake.exe } }
        let tagBoom = {}
        Object.defineProperty(tagBoom, Symbol.toStringTag, {
            get: () => {
                throw new Error('tag-boom')
            },
        })
        let rows = []
        for (let [label, el] of [['revoked', revoked()], ['tag-getter', tagBoom]]) {
            let f = null
            let p = null
            try {
                f = await runFanout({ providers: ps, task: 't', agents: [el], integrate: { use: 'A' }, callOpt: { promptPrefix: '' } })
            }
            catch (err) {
                f = { ok: `rejected:${String(err && err.message)}` }
            }
            try {
                p = await runRolePipeline({ providers: ps, stages: [el], callOpt: { promptPrefix: '' } })
            }
            catch (err) {
                p = { ok: `rejected:${String(err && err.message)}` }
            }
            rows.push([label, f.ok, f.error, (f.agents || []).map((x) => x.errorType), p.ok, p.failedStage])
        }
        let rr = [
            ['revoked', false, 'all agents failed', ['params'], false, 'stage1'],
            ['tag-getter', false, 'all agents failed', ['params'], false, 'stage1'],
        ]
        assert.strict.deepEqual(rows, rr)
    })

    it('頂層prompt(轉接器、遞補、callAi)與runFanout之task為String包裝物件時取其原始字串照常執行(不reject), 空包裝與已撤銷Proxy以params回報', async function() {
        //規格: README「All functions never reject」與各函數「prompt must be a non-empty string」之檢核; 帳本R-USERFN-1之asText; 外審deepseek F2(String包裝物件直穿wsemi之stdin寫入而reject)
        let rows = []
        let rec = async (label, fn) => {
            try {
                let t = await fn()
                rows.push([label, t.ok, t.errorType])
            }
            catch (err) {
                rows.push([label, 'rejected', String(err && err.message)])
            }
        }
        let w = () => new String('abc') // eslint-disable-line no-new-wrappers
        await rec('claude-wrapper', () => dispatchClaude(w(), { exe: fake.exe }))
        await rec('fallback-wrapper', () => dispatchAiFallback(w(), { providers: [{ id: 'A', kind: 'claude', exe: fake.exe }] }))
        await rec('callAi-wrapper', () => callAiWithFallback(w(), { providers: { A: { kind: 'claude', exe: fake.exe } }, spec: { use: 'A' }, promptPrefix: '' }))
        await rec('fanout-task-wrapper', () => runFanout({ providers: { A: { kind: 'claude', exe: fake.exe } }, task: w(), agents: [{ use: 'A' }], callOpt: { promptPrefix: '' } }))
        await rec('claude-empty-wrapper', () => dispatchClaude(new String(''), { exe: fake.exe })) // eslint-disable-line no-new-wrappers
        await rec('compat-revoked', () => dispatchApiOpenaiCompat(revoked(), { baseURL: svr.url, key: 'sk-p', model: 'echo' }))
        let rr = [
            ['claude-wrapper', true, undefined],
            ['fallback-wrapper', true, undefined],
            ['callAi-wrapper', true, undefined],
            ['fanout-task-wrapper', true, undefined],
            ['claude-empty-wrapper', false, 'params'],
            ['compat-revoked', false, 'params'],
        ]
        assert.strict.deepEqual(rows, rr)
    })

    it('dispatchAiWkf之defaults不可讀時於組裝期throw(同providers), 帶有狀態getter者只讀一次且其後各綁定函數之呼叫不同步拋錯; dispatchAi之kind為toString拋錯之物件時以params回報', async function() {
        //規格: dispatchAiWkf.mjs檔頭「本函數為同步工廠會throw(設定錯誤應於啟動期即失敗)」與JSDoc「回傳之各函數皆不reject」; README「All functions never reject」; 外審deepseek F3、F4
        let ps = { A: { kind: 'claude', exe: fake.exe } }
        let factoryErr = ''
        try {
            dispatchAiWkf({ providers: ps, defaults: badGetter('timeoutMs', 'defaults-getter') })
        }
        catch (err) {
            factoryErr = String(err && err.message)
        }
        let reads = 0
        let defaults = { promptPrefix: '' }
        Object.defineProperty(defaults, 'timeoutMs', {
            enumerable: true,
            get: () => {
                reads++
                if (reads > 1) {
                    throw new Error('defaults-2nd-read')
                }
                return 30000
            },
        })
        let wkf = dispatchAiWkf({ providers: ps, defaults })
        let syncThrow = ''
        let r = null
        try {
            let pr = wkf.callAi('abc', { spec: { use: 'A' } })
            r = await pr
        }
        catch (err) {
            syncThrow = String(err && err.message)
        }
        let kindBoom = {
            toString() {
                throw new Error('toString-boom')
            },
        }
        let k = await dispatchAiFallback('abc', { providers: [{ id: 'K', kind: kindBoom }] })
        let rows = [/^dispatchAiWkf: opt\.defaults is not readable: defaults-getter$/.test(factoryErr), syncThrow, r && r.ok, reads, k.ok, k.tried[0].errorType, /^unknown ai kind: "\[object\]"/.test(k.tried[0].error)]
        assert.strict.deepEqual(rows, [true, '', true, 1, false, 'params', true])
    })

    it('runRolePipeline與runFanout之prompt函式回傳String包裝物件時照舊接受(同修前isestr)', async function() {
        //規格: README行為變更紀錄1.0.48第21條與1.0.49起第25條(prompt可為async; 其餘接受範圍不變); 外審opus F12
        let ps = { A: { kind: 'claude', exe: fake.exe } }
        let p = await runRolePipeline({ providers: ps, stages: [{ id: 's1', use: 'A', prompt: () => new String('hello-wrapper') }], callOpt: { promptPrefix: '' } }) // eslint-disable-line no-new-wrappers
        let q = await runFanout({ providers: ps, task: 't', agents: [{ use: 'A' }, { use: 'A' }], integrate: { use: 'A', prompt: async () => new String('int-wrapper') }, callOpt: { promptPrefix: '' } }) // eslint-disable-line no-new-wrappers
        assert.strict.deepEqual([p.ok, q.ok, q.integrated], [true, true, true])
    })

    it('工廠注入之同步回傳值: stamp不可序列化(BigInt、已撤銷Proxy)退預設時戳而照常寫檔、數值照用; getDate/keyOf回已撤銷Proxy不外拋, keyOf非字串照舊不計數', async function() {
        //規格: createFileStore.mjs檔頭「執行期之get/set則不throw」、createUsageCounter.mjs檔頭「執行期之記帳與查詢則不throw」; 帳本R-USERFN-1之工廠注入(Q10退預設); 外審opus F9、sol F14
        let rows = []
        for (let [label, v] of [['bigint', 1n], ['revoked', revoked()], ['number', 1234]]) {
            let fp = path.join(fdTmp, `s-${label}.json`)
            createFileStore({ file: fp, stamp: () => v }).set({ cursors: { a: 1 } })
            let at = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf8')).at : null
            rows.push([`stamp-${label}`, label === 'number' ? at : typeof at])
        }
        for (let [label, getDate, keyOf] of [['getDate-revoked', () => revoked(), null], ['keyOf-revoked', null, () => revoked()], ['keyOf-empty', null, () => '']]) {
            let fu = path.join(fdTmp, `u-${label}.json`)
            let cu = createUsageCounter({ file: fu, ...(getDate ? { getDate } : {}), ...(keyOf ? { keyOf } : {}) })
            let threw = ''
            try {
                cu.onEvent({ type: 'try', keyId: 'kk' })
                cu.today()
            }
            catch (err) {
                threw = String(err && err.message)
            }
            let j = fs.existsSync(fu) ? JSON.parse(fs.readFileSync(fu, 'utf8')) : null
            rows.push([label, threw, j === null ? null : Object.values(j).map((o) => Object.keys(o)).flat()])
        }
        let rr = [
            ['stamp-bigint', 'string'],
            ['stamp-revoked', 'string'],
            ['stamp-number', 1234],
            ['getDate-revoked', '', ['kk']],
            ['keyOf-revoked', '', null],
            ['keyOf-empty', '', null],
        ]
        assert.strict.deepEqual(rows, rr)
    })

    it('時限: REST之validate與HTTP共用該次嘗試之timeoutMs(HTTP 0.8秒＋永不落定之validate, 嘗試於timeoutMs內落定而非timeoutMs+0.8秒)', async function() {
        //規格: 帳本R-USERFN-2「REST為timeoutMs − (now − callOnce之t0)」(Q2); README validate列「共用該次嘗試之timeoutMs」; 外審opus F10
        let slow = await slowCompatServer(800)
        try {
            let t0 = Date.now()
            let t = await dispatchApiOpenaiCompat('abc', { baseURL: slow.url, model: 'm', timeoutMs: 1500, validate: () => new Promise(() => {}) })
            let ms = Date.now() - t0
            let r = [t.ok, t.errorType, String(t.stderr).indexOf('validate timed out: ') === 0, ms < 1500 + 400, ms >= 1400]
            assert.strict.deepEqual(r, [false, 'validation', true, true, true])
        }
        finally {
            await slow.close()
        }
    })

    it('時限: 工作流prompt函式之耗時自該段budgetMs扣除(剩餘不足minAttemptMs即預算用盡); 永不落定之prompt於min(timeoutMs, budgetMs)內落定', async function() {
        //規格: 帳本R-USERFN-1「prompt函式為該段min(timeoutMs, budgetMs), 其耗時自budgetMs扣除後交下層」; README Timeout總覽之budgetMs列; 外審opus F10
        let ps = { A: { kind: 'claude', exe: fake.exe } }
        let slowPrompt = () => new Promise((resolve) => setTimeout(() => resolve('p'), 1000))
        let p1 = await runRolePipeline({ providers: ps, stages: [{ id: 's1', use: 'A', prompt: slowPrompt, budgetMs: 2500, minAttemptMs: 2000 }], callOpt: { promptPrefix: '' } })
        let f1 = await runFanout({ providers: ps, task: 't', agents: [{ use: 'A' }, { use: 'A' }], integrate: { use: 'A', prompt: slowPrompt, budgetMs: 2500, minAttemptMs: 2000 }, callOpt: { promptPrefix: '' } })
        let t0 = Date.now()
        let p2 = await runRolePipeline({ providers: ps, stages: [{ id: 's1', use: 'A', prompt: () => new Promise(() => {}), budgetMs: 1200 }], callOpt: { promptPrefix: '', timeoutMs: 5000 } })
        let ms = Date.now() - t0
        let rows = [
            [p1.ok, p1.stages.s1.errorType],
            [f1.ok, f1.integrated, /budget exhausted/.test(f1.error)],
            [p2.ok, /^stage\[s1\]\.prompt did not settle within 1\.2s$/.test(p2.error), ms < 2500],
        ]
        assert.strict.deepEqual(rows, [[false, 'budget'], [false, false, true], [false, true, true]])
    })

})
