import assert from 'assert'
/* eslint-disable no-new-wrappers */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import resolveCatalogue from '../src/resolveCatalogue.mjs'
import createAiCaller from '../src/createAiCaller.mjs'
import providersAll from '../src/providers.mjs'
import { checkSafeOpts, readPatchOpt, checkConfigOpt } from '../src/readSafeOpt.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import { SENT, revoked, pathWithoutRealCli } from './tools/hostileValuesForTest.mjs'


// unit-patchCatalogueConfig.test.mjs — patch逐id之值、resolveCatalogue之catalogue、dispatchOpencode之config「給了而無效即拒絕」(排程第601項tdai2b之主控裁定; 帳本R-SAFEOPT-1規則11; dspec〈輸入參數之檢測機制〉§11、K4、K9)
//
// 規格句(每案註解標明):
//   P1 patch內逐id之值須為一般物件(undefined、null為未給該id; 未列之id照舊): 字串、數字、布林、陣列、Map、函數、包裝物件、Symbol、BigInt、''、已撤銷之Proxy → resolveProviders／resolveCatalogue／createAiCaller同步throw
//      (與patch非物件同一單一來源readPatchOpt、同一訊息家族`patch values must be objects when given (N invalid, first got <typeof>)…`, 不回顯id與值); patch物化一次(getter只讀一次, K4)。
//   C1 resolveCatalogue之catalogue給了而非陣列 → 同步throw(`catalogue must be an array when given…`, 與pick同一判定assertArrOpt); 未給(undefined、null)照舊用內建目錄, 空陣列為合法(空目錄)。
//   O1 dispatchOpencode之config給了而非字串亦非一般物件(數字、布林、陣列、Map、函數、包裝物件、Symbol、BigInt) → params(attempts 0、不起子行程、不回顯);
//      未給(undefined、null)、''、字串(JSON或否)、一般物件照舊; 不可讀者(已撤銷之Proxy)訊息同修前('config is not JSON-serializable: …')。agent維持(退回build)。
//   O2 遞補層(checkSafeOpts)於發try事件之前即判opencode條目之config(與轉接器同一判定checkConfigOpt); 內建36條目皆通過。
//
// 安全: 不呼叫外部AI服務——假執行檔; before把PATH換成移除真CLI者、after還原。


let NUM = 123456789
let ID_MARK = 'id-SECRET-MARK-5c1e' //patch之id, 訊息不得出現

//記號檔(測試中之臨時檔放test/_tmp/<案名>/, 由本檔after清除): 假opencode每被啟動即附加一字元並回聲config
let MARK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'patchCatalogueConfig')
let MARK_FILE = path.join(MARK_DIR, 'mark.txt')
let MARK_CODE = `
import fs from 'fs'
fs.appendFileSync(${JSON.stringify(MARK_FILE)}, 'x')
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify({ args: process.argv.slice(2), config: process.env.OPENCODE_CONFIG_CONTENT === undefined ? null : process.env.OPENCODE_CONFIG_CONTENT }))
    process.exit(0)
})
`

//patch內逐id之非物件值(不含undefined、null: 其為未給該id)
let badPatchVals = () => ['x', '', NUM, 0, true, false, [], [SENT], new Map(), () => 1, new String(SENT), Symbol(SENT), 10n, revoked()]

//非陣列之catalogue值(不含undefined、null)
let badCatalogues = () => ['x', '', NUM, 0, true, false, { id: 'a', kind: 'claude' }, new Map(), () => 1, new String(SENT), Symbol(SENT), 10n]

//非字串亦非一般物件之config值(不含undefined、null; 已撤銷之Proxy另案)
let badConfigs = () => [NUM, 0, true, false, [], [SENT], new Map(), () => 1, new String(SENT), Symbol(SENT), 10n]

//desc, 輸入值之標籤(不可讀者不得使標籤本身拋錯)
let desc = (v) => {
    try {
        return typeof v === 'symbol' ? 'symbol' : typeof v === 'bigint' ? 'bigint' : (JSON.stringify(v) ?? typeof v)
    }
    catch {
        return 'unreadable'
    }
}
let thrown = (fn) => {
    try {
        fn()
        return null
    }
    catch (err) {
        return String(err && err.message)
    }
}
let isParams = (t) => t.ok === false && t.errorType === 'params' && t.attempts === 0
let noEcho = (s) => !String(s).includes(SENT) && !String(s).includes(String(NUM)) && !String(s).includes(ID_MARK)


describe('patch逐id之值、catalogue、opencode config給了而無效 → 拒絕(tdai2b)', function() {

    let fake = null
    let savedPath = null

    before(function() {
        savedPath = process.env.PATH === undefined ? null : process.env.PATH
        process.env.PATH = pathWithoutRealCli()
        fs.mkdirSync(MARK_DIR, { recursive: true })
        fake = createFakeCli('fake-patch-catalogue-config', MARK_CODE)
    })

    after(function() {
        if (savedPath !== null) {
            process.env.PATH = savedPath
        }
        if (fake) {
            fake.clean()
        }
        fs.rmSync(MARK_DIR, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(MARK_DIR))
        }
        catch {}
    })

    beforeEach(function() {
        fs.rmSync(MARK_FILE, { force: true })
    })

    let spawned = () => fs.existsSync(MARK_FILE)

    //---------- P1: patch逐id之值 ----------
    describe('P1 patch內逐id之值須為一般物件', function() {

        let providers = () => [{ id: 'claude:sonnet', kind: 'claude' }, { id: 'other', kind: 'codex' }]

        it('P1 resolveProviders、resolveCatalogue、createAiCaller: 逐id之值為非物件(含\'\'、陣列、Map、函數、包裝物件、Symbol、BigInt、已撤銷之Proxy)同步throw、訊息不回顯id與值; 不限於目錄內之id', function() {
            let rows = badPatchVals().map((v) => {
                let m1 = thrown(() => resolveProviders(providers(), { patch: { [ID_MARK]: v } }))
                let m2 = thrown(() => resolveCatalogue({ catalogue: providers(), patch: { 'claude:sonnet': v } }))
                let m3 = thrown(() => createAiCaller({ catalogue: providers(), patch: { 'claude:sonnet': v, [ID_MARK]: v } }))
                let re = /^patch values must be objects when given \((\d+) invalid, first got \w+\)/
                return [desc(v), [m1, m2, m3].every((m) => m !== null && re.test(m) && noEcho(m)), m3 !== null && /\(2 invalid,/.test(m3)]
            })
            assert.strict.deepEqual(rows, badPatchVals().map((v) => [desc(v), true, true]))
        })

        it('P1 逐id之值為undefined、null(未給該id)、一般物件(含空物件)、未列之id照舊: 結果與修前相同', function() {
            let r1 = resolveProviders(providers(), { patch: { 'claude:sonnet': undefined, 'other': null, [ID_MARK]: undefined } })
            assert.strict.deepEqual(r1.providers.map((p) => [p.id, p.timeoutMs]), [['claude:sonnet', undefined], ['other', undefined]])
            let r2 = resolveProviders(providers(), { patch: { 'claude:sonnet': { timeoutMs: 123, model: 'opus' }, 'other': {} } })
            assert.strict.deepEqual(r2.providers.map((p) => [p.id, p.timeoutMs, p.model]), [['claude:sonnet', 123, 'opus'], ['other', undefined, undefined]])
            let r3 = resolveCatalogue({ catalogue: providers(), timeoutMs: 5, patch: { 'claude:sonnet': { model: 'x' }, 'other': undefined } })
            assert.strict.deepEqual(r3.resolved.providers.map((p) => [p.id, p.timeoutMs, p.model]), [['claude:sonnet', 5, 'x'], ['other', 5, undefined]])
            assert.strict.deepEqual(resolveProviders(providers(), { patch: {} }).providers.length, 2)
        })

        it('P1/K4 patch物化一次: getter只讀一次, 檢查之值即套用之值(同id之多個條目套用同一份); getter回傳非物件者throw; resolveCatalogue亦只讀一次', function() {
            let n = 0
            let patch = {
                get dup() {
                    n++
                    return { timeoutMs: n * 1000 }
                },
            }
            let r = resolveProviders([{ id: 'dup', kind: 'claude' }, { id: 'dup', kind: 'claude' }], { patch })
            assert.strict.deepEqual([n, r.providers.map((p) => p.timeoutMs)], [1, [1000, 1000]])
            n = 0
            resolveCatalogue({ catalogue: [{ id: 'dup', kind: 'claude' }], patch })
            assert.strict.deepEqual(n, 1)
            let bad = {
                get dup() {
                    n++
                    return 'not-an-object'
                },
            }
            n = 0
            let m = thrown(() => resolveProviders([{ id: 'dup', kind: 'claude' }], { patch: bad }))
            assert.strict.deepEqual([n, /^patch values must be objects when given \(1 invalid, first got string\)/.test(m), noEcho(m)], [1, true, true])
        })

        it('P1 檢核先於合併(extraProviders不合規時以patch之訊息回報); readPatchOpt(單一來源)回物化副本、未給回null、非物件與無效值回err', function() {
            let m = thrown(() => resolveCatalogue({ extraProviders: 5, patch: { a: 'x' } }))
            assert.strict.deepEqual([/^patch values must be objects/.test(m), m.includes('extraProviders')], [true, false])
            let src = { a: { x: 1 } }
            let r = readPatchOpt(src, 'patch')
            assert.strict.deepEqual([r.err, r.patch, r.patch === src, r.patch.a === src.a], ['', { a: { x: 1 } }, false, true])
            assert.strict.deepEqual([readPatchOpt(undefined).patch, readPatchOpt(null).err], [null, ''])
            assert.strict.deepEqual([readPatchOpt('x').err !== '', readPatchOpt({ a: 1 }).err !== '', readPatchOpt(revoked()).err.startsWith('patch is not readable')], [true, true, true])
        })

    })

    //---------- C1: catalogue ----------
    describe('C1 resolveCatalogue之catalogue給了而非陣列 → 同步throw', function() {

        it('C1 resolveCatalogue與createAiCaller: catalogue為非陣列(字串、\'\'、數字、布林、物件、Map、函數、包裝物件、Symbol、BigInt)同步throw、訊息不回顯(不改用含付費條目之內建目錄); 先於合併與envFile', function() {
            let rows = badCatalogues().map((v) => {
                let m1 = thrown(() => resolveCatalogue({ catalogue: v }))
                let m2 = thrown(() => createAiCaller({ catalogue: v }))
                let m3 = thrown(() => resolveCatalogue({ catalogue: v, extraProviders: 5, envFile: './not-exist.env' })) //extraProviders不合規之訊息不得先出
                let re = /^catalogue must be an array when given \(got \w+\)/
                return [desc(v), [m1, m2, m3].every((m) => m !== null && re.test(m) && noEcho(m))]
            })
            assert.strict.deepEqual(rows, badCatalogues().map((v) => [desc(v), true]))
        })

        it('C1 catalogue未給(undefined、null)用內建目錄(照舊); 空陣列為合法之空目錄; 有效陣列照用; 不可讀者throw「is not readable」(既有)', function() {
            for (let v of [undefined, null]) {
                let r = resolveCatalogue({ catalogue: v, env: {} })
                assert.strict.deepEqual([r.merged.length, r.merged.length === providersAll.length, r.resolved.providers.some((p) => p.id === 'claude:sonnet')], [providersAll.length, true, true])
            }
            assert.strict.deepEqual(resolveCatalogue({ catalogue: [], env: {} }).resolved.providers.length, 0)
            assert.strict.deepEqual(resolveCatalogue({ catalogue: [{ id: 'z', kind: 'claude' }] }).resolved.providers.map((p) => p.id), ['z'])
            assert.strict.deepEqual(thrown(() => resolveCatalogue({ catalogue: revoked() })).startsWith('catalogue is not readable: '), true)
        })

    })

    //---------- O1、O2: opencode config ----------
    describe('O1、O2 dispatchOpencode之config給了而非字串亦非一般物件 → params', function() {

        it('O1 config為非字串非物件(數字、布林、陣列、Map、函數、包裝物件、Symbol、BigInt)以params拒絕、attempts 0、不起子行程(不改沿用既有設定)、訊息不回顯', async function() {
            let r = []
            for (let v of badConfigs()) {
                fs.rmSync(MARK_FILE, { force: true })
                let t = await dispatchOpencode('abc', { exe: fake.exe, config: v })
                r.push([desc(v), isParams(t), noEcho(t.error), /^config must be a string or an object when given \(got \w+\)/.test(String(t.error)), spawned()])
            }
            assert.strict.deepEqual(r, badConfigs().map((v) => [desc(v), true, true, true, false]))
        })

        it('O1 config未給(undefined、null)、\'\'、字串、一般物件照舊: 物件序列化為JSON注入, 字串原樣注入, 其餘不注入(沿用既有設定)', async function() {
            let cfg = async (config) => {
                let t = await dispatchOpencode('abc', { exe: fake.exe, config })
                return [t.ok, JSON.parse(t.stdout).config]
            }
            assert.strict.deepEqual(await cfg(undefined), [true, null])
            assert.strict.deepEqual(await cfg(null), [true, null])
            assert.strict.deepEqual(await cfg(''), [true, null])
            assert.strict.deepEqual(await cfg('{"a":1}'), [true, '{"a":1}'])
            assert.strict.deepEqual(await cfg('not json but a string'), [true, 'not json but a string'])
            assert.strict.deepEqual(await cfg({ permission: { edit: 'deny' } }), [true, JSON.stringify({ permission: { edit: 'deny' } })])
            assert.strict.deepEqual(await cfg({}), [true, '{}'])
        })

        it('O1 不可讀之config(已撤銷之Proxy)之訊息同修前(\'config is not JSON-serializable: …\'); 與continueLoopOnDeny並用時非字串非物件之config先以config之訊息拒絕', async function() {
            let t = await dispatchOpencode('abc', { exe: fake.exe, config: revoked() })
            assert.strict.deepEqual([isParams(t), /^config is not JSON-serializable: /.test(String(t.error))], [true, true])
            let u = await dispatchOpencode('abc', { exe: fake.exe, config: NUM, continueLoopOnDeny: true })
            assert.strict.deepEqual([isParams(u), /^config must be a string or an object when given/.test(String(u.error)), spawned()], [true, true, false])
            let w = await dispatchOpencode('abc', { exe: fake.exe, continueLoopOnDeny: true })
            assert.strict.deepEqual([w.ok, JSON.parse(JSON.parse(w.stdout).config)], [true, { experimental: { continue_loop_on_deny: true } }])
        })

        it('O1 維持: agent給了無效退回build(不拒絕)', async function() {
            let t = await dispatchOpencode('abc', { exe: fake.exe, agent: NUM })
            let a = JSON.parse(t.stdout).args
            assert.strict.deepEqual([t.ok, a[a.indexOf('--agent') + 1]], [true, 'build'])
        })

        it('O2 checkSafeOpts: opencode之config給了而無效回訊息(不可讀者同轉接器之訊息); 有效與未給回空字串; 他kind不判config', function() {
            let bad = badConfigs().map((v) => checkSafeOpts('opencode', { config: v }))
            assert.strict.deepEqual(bad.map((m) => /^config must be a string or an object when given \(got \w+\)/.test(m) && noEcho(m)), badConfigs().map(() => true))
            assert.strict.deepEqual(['opencode'].flatMap((k) => [undefined, null, '', '{"a":1}', 'x', {}, { a: 1 }].map((v) => checkSafeOpts(k, { config: v }))), [undefined, null, '', '{"a":1}', 'x', {}, { a: 1 }].map(() => ''))
            assert.strict.deepEqual(checkSafeOpts('opencode', { config: revoked() }).startsWith('config is not JSON-serializable: '), true)
            assert.strict.deepEqual(['claude', 'codex', 'antigravity', 'api-anthropic'].map((k) => checkSafeOpts(k, { config: NUM })), ['', '', '', ''])
            assert.strict.deepEqual([checkConfigOpt(undefined, 'config'), checkConfigOpt('', 'config'), checkConfigOpt({}, 'config'), checkConfigOpt(NUM, 'config') !== ''], ['', '', '', true])
        })

        it('O2 遞補層: opencode條目之config給了而無效走條目層params、不發try事件、不起子行程; 正常條目(物件config)照發try', async function() {
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [
                    { id: 'bad:num', kind: 'opencode', exe: fake.exe, config: NUM },
                    { id: 'bad:bool', kind: 'opencode', exe: fake.exe, config: true },
                    { id: 'bad:arr', kind: 'opencode', exe: fake.exe, config: [{}] },
                    { id: 'bad:keyed', kind: 'opencode', exe: fake.exe, keys: ['sk-test-patchcfg-0001'], provider: 'opencode', config: new Map() },
                    { id: 'ok:one', kind: 'opencode', exe: fake.exe, config: { permission: { edit: 'deny', bash: 'ask' } } },
                ],
                onEvent: (ev) => events.push(ev),
            })
            let tries = events.filter((e) => e.type === 'try').map((e) => e.providerId)
            assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.errorType]), [['bad:num', 'params'], ['bad:bool', 'params'], ['bad:arr', 'params'], ['bad:keyed', 'params'], ['ok:one', undefined]])
            assert.strict.deepEqual([r.ok, r.providerId, tries], [true, 'ok:one', ['ok:one']])
        })

        it('O2 內建36條目逐條 checkSafeOpts(kind, entry, { keyed: true }) 皆回空字串(合法輸入之行為不變); 內建opencode條目之config皆為一般物件', function() {
            let bad = providersAll.map((p) => [p.id, checkSafeOpts(p.kind, p, { keyed: true })]).filter(([, m]) => m !== '')
            assert.strict.deepEqual([providersAll.length, bad], [36, []])
            let cfgKinds = providersAll.filter((p) => p.kind === 'opencode' && p.config !== undefined).map((p) => Object.prototype.toString.call(p.config))
            assert.strict.deepEqual([cfgKinds.length > 0, cfgKinds.every((t) => t === '[object Object]')], [true, true])
        })

    })

})
