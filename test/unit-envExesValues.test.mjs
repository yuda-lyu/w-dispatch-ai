import assert from 'assert'
/* eslint-disable no-new-wrappers */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchCodex from '../src/dispatchCodex.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import runExecCli from '../src/runExecCli.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import resolveCatalogue from '../src/resolveCatalogue.mjs'
import createAiCaller from '../src/createAiCaller.mjs'
import filterOpencodeFree from '../src/filterOpencodeFree.mjs'
import getQuotaClaude from '../src/quota/getQuotaClaude.mjs'
import getQuotaCodex from '../src/quota/getQuotaCodex.mjs'
import { checkSafeOpts, readEnvOpt, readExesOpt, checkObjOpt, checkArrOpt } from '../src/readSafeOpt.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import { SENT, revoked, pathWithoutRealCli } from './tools/hostileValuesForTest.mjs'


// unit-envExesValues.test.mjs — env各變數之值、exes各kind之值、resolveProviders／resolveCatalogue之pick／patch「給了而無效即拒絕」(排程第553項之主控裁定; 帳本R-SAFEOPT-1規則11; dspec〈輸入參數之檢測機制〉§11、K4、K9)
//
// 規格句(每案註解標明):
//   V1 exes各kind之值須為非空字串: 空字串、數字、布林、物件、陣列、包裝物件、函數、Symbol、BigInt → resolveProviders／resolveCatalogue／createAiCaller同步throw(不略過而改用PATH上之預設執行檔); undefined、null為未給該kind(照舊略過); 有效字串照注入。
//   V2 env各變數之值須為字串: null、數字、布林、物件、陣列、包裝物件、函數、Symbol、BigInt → 四家CLI／runExecCli／filterOpencodeFree以params拒絕(attempts 0, 起任何子行程之前);
//      值為undefined合法(實測Node spawn不傳該變數; wsemi execCli載明「undefined代表移除該變數、可遮蔽繼承值」——故不是「視同未給」: 未給該變數時子行程繼承process.env之值, undefined則移除之); 空字串為合法之字串值。
//   V3 resolveProviders／resolveCatalogue之env: 資料屬性之值須為字串(undefined為缺值)、所取變數之值亦須為字串(含getter回傳者); 不執行未被取用之getter。
//   V4 pick給了而非陣列(字串、數字、布林、物件、函數、Symbol、BigInt、不可讀者)同步throw(不視為未給而全取含付費條目); 空陣列、未給(undefined、null)、有效陣列照舊。
//   V5 patch給了而非物件(字串、數字、布林、陣列、Map、函數等)同步throw(不略過); 未給、一般物件照舊。
//   V6 遞補層(checkSafeOpts)於發try事件之前即判env之資料屬性之值(與轉接器同一判定單一來源), 不執行getter。
//   V7 K9: 訊息不回顯值、不回顯變數名／kind名; K4: 檢查之值即使用之值(getter只讀一次)。
//
// 安全: 不呼叫外部AI服務——假執行檔; before把PATH換成移除真CLI者、after還原。


let KEY = 'sk-test-envvals-0001-SECRET'
let NUM = 123456789
let VARNAME = 'ENVVALS_VAR_NAME_SECRET'

//記號檔(測試中之臨時檔放test/_tmp/<案名>/, 由本檔after清除)
let MARK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'envExesValues')
let MARK_FILE = path.join(MARK_DIR, 'mark.txt')
let PROBE_CODE = `
import fs from 'fs'
fs.appendFileSync(${JSON.stringify(MARK_FILE)}, 'x')
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    let has = Object.prototype.hasOwnProperty.call(process.env, 'ENVVALS_PROBE')
    process.stdout.write(JSON.stringify({ has, v: has ? process.env.ENVVALS_PROBE : null, argv: process.argv.slice(2) }))
    process.exit(0)
})
`

//非字串之env變數值(含null、數字、布林、物件、陣列、包裝物件、函數、Symbol、BigInt)
let badEnvVals = () => [null, NUM, 0, true, false, {}, [], [SENT], new String(SENT), () => 1, Symbol(SENT), 10n]

//非空字串以外之exes值(含''、數字、布林、物件、陣列、包裝物件、函數、Symbol、BigInt; 不含undefined、null: 其為未給該kind)
let badExeVals = () => ['', NUM, 0, true, false, {}, [], [SENT], new String(SENT), () => 1, Symbol(SENT), 10n]

//非陣列之pick值(含字串、數字、布林、物件、函數、Symbol、BigInt; 空字串亦拒)
let badPicks = () => ['claude:sonnet', '', NUM, 0, true, false, { 'claude:sonnet': 1 }, new String(SENT), () => 1, Symbol(SENT), 10n]

//非物件之patch值
let badPatches = () => ['y', '', NUM, 0, true, false, [], [{ id: 'a' }], new Map(), new String(SENT), () => 1, Symbol(SENT), 10n]

let isParams = (t) => t.ok === false && t.errorType === 'params' && t.attempts === 0
let noEcho = (t) => {
    let s = String(t.error)
    return !s.includes(SENT) && !s.includes(KEY) && !s.includes(String(NUM)) && !s.includes(VARNAME)
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
//desc, 輸入值之標籤(僅供斷言列之對照; 不可讀者不得使標籤本身拋錯)
let desc = (v) => {
    try {
        return typeof v === 'symbol' ? 'symbol' : typeof v === 'bigint' ? 'bigint' : (JSON.stringify(v) ?? typeof v)
    }
    catch {
        return 'unreadable'
    }
}


describe('env各變數之值、exes各kind之值、pick／patch給了而無效 → 拒絕(排程第553項裁定; 規則11)', function() {

    let fake = null
    let savedPath = null

    before(function() {
        savedPath = process.env.PATH === undefined ? null : process.env.PATH
        process.env.PATH = pathWithoutRealCli()
        fs.mkdirSync(MARK_DIR, { recursive: true })
        fake = createFakeCli('fake-env-exes-values')
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

    //---------- V1: exes各kind之值 ----------
    describe('V1 exes各kind之值須為非空字串', function() {

        let providers = () => [{ id: 'a', kind: 'claude' }, { id: 'b', kind: 'codex' }]

        it('V1 resolveProviders: 各kind之值為非空字串以外(含\'\'、數字、布林、物件、陣列、包裝物件、函數、Symbol、BigInt)同步throw、訊息不回顯值與kind名', function() {
            let rows = badExeVals().map((v) => {
                let m = thrown(() => resolveProviders(providers(), { exes: { [VARNAME]: v } }))
                return [desc(v), m !== null && /^exes values must be non-empty strings when given \(1 invalid, first got \w+\)/.test(m), m !== null && !m.includes(SENT) && !m.includes(VARNAME) && !m.includes(String(NUM))]
            })
            assert.strict.deepEqual(rows, badExeVals().map((v) => [desc(v), true, true]))
        })

        it('V1 resolveProviders: 有效(非空字串)照注入; undefined、null為未給該kind(略過); 其餘kind之無效值亦拒絕(不限本目錄之kind); 多個無效者回個數', function() {
            let r1 = resolveProviders(providers(), { exes: { claude: 'C:/x/claude.exe', codex: undefined } })
            assert.strict.deepEqual(r1.providers.map((p) => [p.id, p.exe]), [['a', 'C:/x/claude.exe'], ['b', undefined]])
            let r2 = resolveProviders(providers(), { exes: { claude: null, codex: 'C:/x/codex.exe' } })
            assert.strict.deepEqual(r2.providers.map((p) => [p.id, p.exe]), [['a', undefined], ['b', 'C:/x/codex.exe']])
            assert.strict.deepEqual(resolveProviders(providers(), { exes: {} }).providers.map((p) => p.exe), [undefined, undefined])
            let m1 = thrown(() => resolveProviders(providers(), { exes: { 'not-in-catalogue': NUM } }))
            assert.strict.deepEqual([m1 !== null, /\(1 invalid, first got number\)/.test(m1)], [true, true])
            let m2 = thrown(() => resolveProviders(providers(), { exes: { claude: 'ok.exe', codex: 1, x: true, y: '' } }))
            assert.strict.deepEqual(/\(3 invalid, first got number\)/.test(m2), true)
        })

        it('V1 resolveCatalogue與createAiCaller(建構時經之): 同上throw; 先於讀envFile(env檔不存在時不拋ENOENT而拋exes之訊息); 有效者照注入', function() {
            let rows = badExeVals().map((v) => {
                let m1 = thrown(() => resolveCatalogue({ catalogue: [], exes: { claude: v } }))
                let m2 = thrown(() => resolveCatalogue({ catalogue: [], exes: { claude: v }, envFile: './not-exist.env' }))
                let m3 = thrown(() => createAiCaller({ catalogue: [], exes: { claude: v } }))
                return [desc(v), [m1, m2, m3].every((m) => m !== null && /^exes values must be non-empty strings/.test(m) && !m.includes(SENT))]
            })
            assert.strict.deepEqual(rows, badExeVals().map((v) => [desc(v), true]))
            let r = resolveCatalogue({ catalogue: [{ id: 'c1', kind: 'claude' }], exes: { claude: 'C:/bin/claude.exe' } })
            assert.strict.deepEqual(r.resolved.providers.map((p) => p.exe), ['C:/bin/claude.exe'])
        })

        it('V7 exes: 物化一次(getter只讀一次, 檢查之值即使用之值), 回傳之值即注入之值; 讀取拋錯之getter以「is not readable」throw', function() {
            let n = 0
            let exes = {
                get claude() {
                    n++
                    return n === 1 ? 'C:/first/claude.exe' : 'C:/second/claude.exe'
                },
            }
            let r = resolveProviders([{ id: 'a', kind: 'claude' }, { id: 'b', kind: 'claude' }, { id: 'c', kind: 'claude' }], { exes })
            assert.strict.deepEqual([n, r.providers.map((p) => p.exe)], [1, ['C:/first/claude.exe', 'C:/first/claude.exe', 'C:/first/claude.exe']])
            let boom = {
                get claude() {
                    throw new Error('getter boom')
                },
            }
            let m = thrown(() => resolveProviders([{ id: 'a', kind: 'claude' }], { exes: boom }))
            assert.strict.deepEqual(m, 'exes is not readable: getter boom')
            n = 0
            resolveCatalogue({ catalogue: [{ id: 'a', kind: 'claude' }], exes })
            assert.strict.deepEqual(n, 1) //resolveCatalogue物化一次, 其副本交resolveProviders(不再讀)
        })

        it('V1 readExesOpt: 回物化之副本(非原物件); 未給回null; 非物件與無效值回err', function() {
            let src = { claude: 'a.exe' }
            let r = readExesOpt(src, 'exes')
            assert.strict.deepEqual([r.err, r.exes, r.exes === src], ['', { claude: 'a.exe' }, false])
            assert.strict.deepEqual([readExesOpt(undefined).exes, readExesOpt(null).err], [null, ''])
            assert.strict.deepEqual([readExesOpt('x').err !== '', readExesOpt({ a: 1 }).err !== '', readExesOpt(revoked()).err.startsWith('exes is not readable')], [true, true, true])
        })

    })

    //---------- V2: CLI之env各值 ----------
    describe('V2 env各變數之值須為字串(四家CLI、runExecCli、filterOpencodeFree)', function() {

        let sites = {
            'dispatchCodex': (opt) => dispatchCodex('abc', { exe: fake.exe, ...opt }),
            'dispatchClaude(未給key)': (opt) => dispatchClaude('abc', { exe: fake.exe, ...opt }),
            'dispatchClaude(key模式)': (opt) => dispatchClaude('abc', { exe: fake.exe, key: KEY, ...opt }),
            'dispatchOpencode': (opt) => dispatchOpencode('abc', { exe: fake.exe, ...opt }),
            'dispatchAntigravity': (opt) => dispatchAntigravity('abc', { exe: fake.exe, ...opt }),
            'runExecCli': (opt) => runExecCli(fake.exe, [], opt),
        }

        for (let [name, call] of Object.entries(sites)) {

            it(`V2 ${name}: env之變數值為非字串(null、數字、布林、物件、陣列、包裝物件、函數、Symbol、BigInt)以params拒絕(attempts 0)、訊息不回顯值與變數名`, async function() {
                let r = []
                for (let v of badEnvVals()) {
                    let t = await call({ env: { [VARNAME]: v } })
                    r.push([desc(v), isParams(t), noEcho(t), /^env values must be strings when given \(1 invalid, first got \w+\)/.test(String(t.error))])
                }
                assert.strict.deepEqual(r, badEnvVals().map((v) => [desc(v), true, true, true]))
            })

            it(`V2 ${name}: env之變數值為字串(含空字串)照常交子行程; 一般物件與process.env照舊`, async function() {
                let rows = []
                for (let env of [{ FAKE_ENV: 'v1' }, { FAKE_ENV: '' }, { FAKE_ENV: 'v2', OTHER: undefined }, process.env]) {
                    let t = await call({ env })
                    rows.push(t.ok)
                }
                assert.strict.deepEqual(rows, [true, true, true, true])
            })

        }

        it('V2 filterOpencodeFree: env之變數值為非字串 → params; 字串照舊', async function() {
            let providersIn = [{ id: 'oc:x-free', kind: 'opencode', model: 'opencode/x-free' }]
            let bad = []
            for (let v of badEnvVals()) {
                let t = await filterOpencodeFree(providersIn, { exe: fake.exe, env: { A: v } })
                bad.push([t.errorType === 'params', !String(t.error).includes(SENT)])
            }
            assert.strict.deepEqual(bad, badEnvVals().map(() => [true, true]))
            let ok = await filterOpencodeFree(providersIn, { exe: fake.exe, env: { A: 'x' } })
            assert.strict.notEqual(ok.errorType, 'params')
        })

        it('V2 額度讀者(getQuotaClaude、getQuotaCodex; 與四家CLI同一判定readEnvOpt): env之變數值為非字串 → params、不起子行程、不送請求', async function() {
            let home = path.join(MARK_DIR, 'home')
            fs.mkdirSync(home, { recursive: true })
            let calls = 0
            let realFetch = globalThis.fetch
            globalThis.fetch = async () => {
                calls++
                return new Response('{}', { status: 200 })
            }
            try {
                let rows = []
                for (let v of badEnvVals()) {
                    let a = await getQuotaClaude('', { env: { A: v }, homeDir: home, configDir: home, profileFallback: false })
                    let b = await getQuotaCodex('', { env: { A: v }, homeDir: home, codexHome: home, useAppServer: false })
                    rows.push([a, b].map((t) => [t.ok, t.errorType, noEcho(t)]))
                }
                assert.strict.deepEqual(rows, badEnvVals().map(() => [[false, 'params', true], [false, 'params', true]]))
                assert.strict.deepEqual(calls, 0)
            }
            finally {
                globalThis.fetch = realFetch
            }
        })

        it('V2 實測語意: env值為undefined合法且為「移除」而非「視同未給」——未給該變數時子行程繼承process.env之值, undefined則自子行程移除(Node spawn不傳; wsemi execCli載明可遮蔽繼承值); 空字串為存在之空值', async function() {
            let pk = createFakeCli('fake-env-exes-values-probe', PROBE_CODE)
            let saved = process.env.ENVVALS_PROBE
            process.env.ENVVALS_PROBE = 'inherited'
            try {
                let probe = async (env) => {
                    let t = await dispatchCodex('abc', { exe: pk.exe, env })
                    return t.ok ? JSON.parse(t.stdout) : t
                }
                let a = await probe({}) //未給該變數: 繼承
                let b = await probe({ ENVVALS_PROBE: undefined }) //undefined: 移除(不是繼承、也不是字面字串)
                let c = await probe({ ENVVALS_PROBE: '' }) //空字串: 存在之空值
                let d = await probe({ ENVVALS_PROBE: 'given' })
                assert.strict.deepEqual([[a.has, a.v], [b.has, b.v], [c.has, c.v], [d.has, d.v]], [[true, 'inherited'], [false, null], [true, ''], [true, 'given']])
                //null若放行會成為字面字串'null'(實測), 故拒絕而不起子行程
                let n = await dispatchCodex('abc', { exe: pk.exe, env: { ENVVALS_PROBE: null } })
                assert.strict.deepEqual([isParams(n), n.stdout === undefined || n.stdout === ''], [true, true])
            }
            finally {
                if (saved === undefined) {
                    delete process.env.ENVVALS_PROBE
                }
                else {
                    process.env.ENVVALS_PROBE = saved
                }
                pk.clean()
            }
        })

        it('V2 零次啟動: env值無效者於起任何子行程之前即拒絕(記號假執行檔零次被啟動; 含agy stdin路徑之--version探測、claude key模式、filterOpencodeFree); 有效值為對照(確會啟動)', async function() {
            let mk = createFakeCli('fake-env-exes-values-mark', PROBE_CODE)
            try {
                let calls = {
                    'dispatchCodex': (o) => dispatchCodex('abc', { exe: mk.exe, ...o }),
                    'dispatchClaude': (o) => dispatchClaude('abc', { exe: mk.exe, ...o }),
                    'dispatchClaude(key)': (o) => dispatchClaude('abc', { exe: mk.exe, key: KEY, ...o }),
                    'dispatchOpencode': (o) => dispatchOpencode('abc', { exe: mk.exe, ...o }),
                    'dispatchAntigravity(stdin)': (o) => dispatchAntigravity('abc', { exe: mk.exe, promptVia: 'stdin', ...o }),
                    'runExecCli': (o) => runExecCli(mk.exe, [], o),
                    'filterOpencodeFree': (o) => filterOpencodeFree([{ id: 'oc:x-free', kind: 'opencode', model: 'opencode/x-free' }], { exe: mk.exe, ...o }),
                }
                let rows = []
                for (let [name, call] of Object.entries(calls)) {
                    fs.rmSync(MARK_FILE, { force: true })
                    await call({ env: { A: NUM } })
                    let spawnedOnBad = fs.existsSync(MARK_FILE)
                    fs.rmSync(MARK_FILE, { force: true })
                    await call({ env: { A: 'v1' } })
                    let spawnedOnGood = fs.existsSync(MARK_FILE)
                    rows.push([name, spawnedOnBad, spawnedOnGood])
                }
                assert.strict.deepEqual(rows, Object.keys(calls).map((name) => [name, false, true]))
            }
            finally {
                mk.clean()
            }
        })

        it('V7 env只讀一次(K4): 變數值取自getter者, 檢查之值即使用之值(getter計數為1, 子行程收到該值); getter回傳非字串者以params拒絕(不起子行程)', async function() {
            let n = 0
            let env = {
                get FAKE_ENV() {
                    n++
                    return 'v-getter'
                },
            }
            let t = await dispatchCodex('abc', { exe: fake.exe, env })
            assert.strict.deepEqual([t.ok, n, JSON.parse(t.stdout).env.FAKE_ENV], [true, 1, 'v-getter'])
            let m = 0
            let bad = {
                get FAKE_ENV() {
                    m++
                    return NUM
                },
            }
            let u = await dispatchCodex('abc', { exe: fake.exe, env: bad })
            assert.strict.deepEqual([isParams(u), m, noEcho(u)], [true, 1, true])
        })

    })

    //---------- V3、V6: 目錄展開之env與遞補層 ----------
    describe('V3、V6 目錄展開之env與遞補層(checkSafeOpts)', function() {

        let providers = () => [{ id: 'a', kind: 'claude' }, { id: 'b', kind: 'claude', envVar: 'ENVVALS_KEYS' }]

        it('V3 resolveProviders／resolveCatalogue: env之資料屬性之值為非字串(null、數字、布林、物件等)同步throw、訊息不回顯; undefined為缺值(條目停用); 字串照舊', function() {
            let rows = badEnvVals().map((v) => {
                let m1 = thrown(() => resolveProviders(providers(), { env: { [VARNAME]: v } }))
                let m2 = thrown(() => resolveCatalogue({ catalogue: [], env: { [VARNAME]: v } }))
                let m3 = thrown(() => resolveProviders(providers(), { env: { ENVVALS_KEYS: v } })) //被取用之變數
                return [desc(v), [m1, m2, m3].every((m) => m !== null && /^env values must be strings when given \(1 invalid, first got \w+\)/.test(m) && !m.includes(SENT) && !m.includes(VARNAME) && !m.includes(String(NUM)))]
            })
            assert.strict.deepEqual(rows, badEnvVals().map((v) => [desc(v), true]))
            let r1 = resolveProviders(providers(), { env: { ENVVALS_KEYS: undefined } })
            assert.strict.deepEqual([r1.providers.map((p) => p.id), r1.skipped.map((s) => s.id)], [['a'], ['b']])
            let r2 = resolveProviders(providers(), { env: { ENVVALS_KEYS: 'sk-1,sk-2', OTHER: undefined } })
            assert.strict.deepEqual(r2.providers.map((p) => [p.id, p.keys]), [['a', undefined], ['b', ['sk-1', 'sk-2']]])
            let r3 = resolveProviders(providers(), { env: { ENVVALS_KEYS: '' } })
            assert.strict.deepEqual(r3.skipped.map((s) => s.id), ['b']) //空字串仍為缺值(同修前)
        })

        it('V3/V7 resolveProviders: getter提供之變數值——被取用者只讀一次且須為字串(回傳非字串throw); 未被取用之getter不執行(計數0)', function() {
            let used = 0
            let unused = 0
            let envOk = {
                get ENVVALS_KEYS() {
                    used++
                    return 'sk-g1'
                },
                get UNRELATED() {
                    unused++
                    return NUM
                },
            }
            let r = resolveProviders(providers(), { env: envOk })
            assert.strict.deepEqual([used, unused, r.providers.map((p) => p.keys)], [1, 0, [undefined, ['sk-g1']]])
            let envBad = {
                get ENVVALS_KEYS() {
                    used++
                    return NUM
                },
            }
            used = 0
            let m = thrown(() => resolveProviders(providers(), { env: envBad }))
            assert.strict.deepEqual([used, /^env values must be strings/.test(m), !m.includes(String(NUM))], [1, true, true])

            //getter回傳null、布林、物件亦拒絕(資料屬性於一開始即判; 存取器只能於取值處判——null不得被當缺值而悄悄停用條目)
            let rows = []
            for (let v of [null, true, {}, 10n]) {
                let env = {
                    get ENVVALS_KEYS() {
                        return v
                    },
                }
                let mm = thrown(() => resolveProviders(providers(), { env }))
                rows.push([typeof v, mm !== null && /^env values must be strings when given \(1 invalid, first got \w+\)/.test(mm)])
            }
            assert.strict.deepEqual(rows, [['object', true], ['boolean', true], ['object', true], ['bigint', true]])
        })

        it('V3/V4/V5 resolveCatalogue: env值、pick、patch之檢核先於合併與其他副作用(extraProviders不合規時以env／pick／patch之訊息回報, 不留半成品)', function() {
            let bad = [
                [{ env: { A: NUM } }, /^env values must be strings/],
                [{ pick: 'claude:sonnet' }, /^pick must be an array/],
                [{ patch: 'x' }, /^patch must be an object/],
                [{ exes: { claude: NUM } }, /^exes values must be non-empty strings/],
            ]
            let rows = bad.map(([o, re]) => {
                let m = thrown(() => resolveCatalogue({ extraProviders: 5, ...o }))
                return [re.test(String(m)), String(m).includes('extraProviders')]
            })
            assert.strict.deepEqual(rows, bad.map(() => [true, false]))
            //對照: 該些opt皆有效時, 才輪到extraProviders之訊息
            assert.strict.deepEqual(thrown(() => resolveCatalogue({ extraProviders: 5 })), 'ai.extraProviders 須為陣列')
        })

        it('V6 checkSafeOpts: 四家CLI之env資料屬性之值為非字串回訊息、字串與undefined回空字串; getter不執行(計數0); REST種類不判env', function() {
            let kinds = ['claude', 'codex', 'opencode', 'antigravity']
            let rows = kinds.map((k) => [
                badEnvVals().map((v) => checkSafeOpts(k, { env: { A: v } }) !== '').every((x) => x === true),
                checkSafeOpts(k, { env: { A: 'x', B: '', C: undefined } }),
                checkSafeOpts(k, { env: process.env }),
                !checkSafeOpts(k, { env: { A: SENT, B: NUM } }).includes(SENT),
            ])
            assert.strict.deepEqual(rows, kinds.map(() => [true, '', '', true]))
            let n = 0
            let env = {
                get A() {
                    n++
                    return NUM
                },
            }
            assert.strict.deepEqual([checkSafeOpts('claude', { env }), n], ['', 0]) //存取器不執行(其值由轉接器物化時判)
            assert.strict.deepEqual(['api-anthropic', 'api-openai-compat'].map((k) => checkSafeOpts(k, { env: { A: NUM } })), ['', ''])
        })

        it('V6 遞補層: 條目env之變數值為非字串走條目層params、不發try事件; 字串者照發try', async function() {
            let events = []
            let r = await dispatchAiFallback('abc', {
                providers: [
                    { id: 'bad:claude', kind: 'claude', exe: fake.exe, env: { A: NUM } },
                    { id: 'bad:claude-key', kind: 'claude', exe: fake.exe, keys: [KEY], env: { A: null } },
                    { id: 'bad:codex', kind: 'codex', exe: fake.exe, env: { A: true } },
                    { id: 'bad:opencode', kind: 'opencode', exe: fake.exe, env: { A: {} } },
                    { id: 'bad:antigravity', kind: 'antigravity', exe: fake.exe, env: { A: [] } },
                    { id: 'ok:one', kind: 'claude', exe: fake.exe, env: { FAKE_ENV: 'v1', B: undefined } },
                ],
                onEvent: (ev) => events.push(ev),
            })
            let tries = events.filter((e) => e.type === 'try').map((e) => e.providerId)
            assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.errorType]), [['bad:claude', 'params'], ['bad:claude-key', 'params'], ['bad:codex', 'params'], ['bad:opencode', 'params'], ['bad:antigravity', 'params'], ['ok:one', undefined]])
            assert.strict.deepEqual([r.ok, r.providerId, tries], [true, 'ok:one', ['ok:one']])
        })

        it('V1/V6 checkObjOpt(單一來源): 形狀與值分開——不給vals只驗形狀(值為何皆可); vals為env／exe時另驗資料屬性之值', function() {
            let o = { A: NUM }
            assert.strict.deepEqual([checkObjOpt(o, 'x'), checkObjOpt(o, 'x', 'env') !== '', checkObjOpt(o, 'x', 'exe') !== '', checkObjOpt({ A: 'a' }, 'x', 'exe'), checkObjOpt({ A: null }, 'x', 'exe'), checkObjOpt({ A: null }, 'x', 'env') !== ''], ['', true, true, '', '', true])
            assert.strict.deepEqual([readEnvOpt({ A: NUM }, 'env').err !== '', readEnvOpt({ A: undefined }, 'env').err, readEnvOpt({ A: '' }, 'env').err], [true, '', ''])
        })

    })

    //---------- V4: pick ----------
    describe('V4 pick給了而非陣列 → 同步throw(不視為未給而全取)', function() {

        let providers = () => [{ id: 'claude:sonnet', kind: 'claude' }, { id: 'paid:x', kind: 'api-anthropic', model: 'm' }]

        it('V4 resolveProviders: pick為非陣列之定義值(字串、數字、布林、物件、函數、包裝物件、Symbol、BigInt、\'\')throw、訊息不回顯', function() {
            let rows = badPicks().map((v) => {
                let m = thrown(() => resolveProviders(providers(), { pick: v }))
                return [desc(v), m !== null && /^pick must be an array when given \(got \w+\)/.test(m) && !m.includes(SENT) && !m.includes('claude:sonnet')]
            })
            assert.strict.deepEqual(rows, badPicks().map((v) => [desc(v), true]))
        })

        it('V4 resolveProviders: 未給(undefined、null)與空陣列全取; 有效陣列依其順序; pick內元素為非字串者列入missing(不throw)', function() {
            let all = ['claude:sonnet', 'paid:x']
            assert.strict.deepEqual([undefined, null, []].map((v) => resolveProviders(providers(), { pick: v }).providers.map((p) => p.id)), [all, all, all])
            let r = resolveProviders(providers(), { pick: ['paid:x', 'claude:sonnet'] })
            assert.strict.deepEqual(r.providers.map((p) => p.id), ['paid:x', 'claude:sonnet'])
            let r2 = resolveProviders(providers(), { pick: [NUM, 'claude:sonnet'] })
            assert.strict.deepEqual([r2.providers.map((p) => p.id), r2.missing], [['claude:sonnet'], [String(NUM)]])
        })

        it('V4 resolveCatalogue與createAiCaller: pick為非陣列同步throw(先於讀envFile與逾時三層); 有效者照舊', function() {
            let rows = badPicks().map((v) => {
                let m1 = thrown(() => resolveCatalogue({ catalogue: providers(), pick: v }))
                let m2 = thrown(() => resolveCatalogue({ catalogue: providers(), pick: v, envFile: './not-exist.env' }))
                let m3 = thrown(() => createAiCaller({ catalogue: providers(), pick: v }))
                return [desc(v), [m1, m2, m3].every((m) => m !== null && /^pick must be an array when given/.test(m))]
            })
            assert.strict.deepEqual(rows, badPicks().map((v) => [desc(v), true]))
            let r = resolveCatalogue({ catalogue: providers(), pick: ['claude:sonnet'] })
            assert.strict.deepEqual(r.resolved.providers.map((p) => p.id), ['claude:sonnet'])
        })

        it('V4 pick為字串者修前全取含付費條目: 現拒絕(內建目錄 pick: \'claude:sonnet\' 不得回傳全部條目)', function() {
            let m = thrown(() => resolveCatalogue({ pick: 'claude:sonnet' }))
            assert.strict.deepEqual([m !== null, /^pick must be an array/.test(m)], [true, true])
        })

        it('V4 checkArrOpt(單一來源): 未給與陣列(含空陣列)回空字串; 非陣列、不可讀回訊息', function() {
            assert.strict.deepEqual([checkArrOpt(undefined, 'pick'), checkArrOpt(null, 'pick'), checkArrOpt([], 'pick'), checkArrOpt(['a'], 'pick')], ['', '', '', ''])
            assert.strict.deepEqual([checkArrOpt('a', 'pick') !== '', checkArrOpt({ length: 0 }, 'pick') !== '', checkArrOpt(revoked(), 'pick').startsWith('pick is not readable')], [true, true, true])
            let rp = Proxy.revocable([], {})
            rp.revoke()
            assert.strict.deepEqual(checkArrOpt(rp.proxy, 'pick').startsWith('pick is not readable'), true)
            //偽造Symbol.toStringTag為'Array'之一般物件不是陣列
            assert.strict.deepEqual(checkArrOpt({ [Symbol.toStringTag]: 'Array' }, 'pick') !== '', true)
        })

    })

    //---------- V5: patch ----------
    describe('V5 patch給了而非物件 → 同步throw(不略過)', function() {

        let providers = () => [{ id: 'claude:sonnet', kind: 'claude' }]

        it('V5 resolveProviders與resolveCatalogue: patch為非物件(字串、數字、布林、陣列、Map、函數、包裝物件、Symbol、BigInt、\'\')throw、訊息不回顯; 未給(undefined、null)與一般物件照舊', function() {
            let rows = badPatches().map((v) => {
                let m1 = thrown(() => resolveProviders(providers(), { patch: v }))
                let m2 = thrown(() => resolveCatalogue({ catalogue: providers(), patch: v }))
                let m3 = thrown(() => createAiCaller({ catalogue: providers(), patch: v }))
                return [desc(v), [m1, m2, m3].every((m) => m !== null && /^patch must be an object when given \(got \w+\)/.test(m) && !m.includes(SENT))]
            })
            assert.strict.deepEqual(rows, badPatches().map((v) => [desc(v), true]))
            for (let v of [undefined, null]) {
                assert.strict.deepEqual(resolveProviders(providers(), { patch: v }).providers.map((p) => p.timeoutMs), [undefined])
            }
            let r = resolveProviders(providers(), { patch: { 'claude:sonnet': { timeoutMs: 123, model: 'opus' } } })
            assert.strict.deepEqual(r.providers.map((p) => [p.timeoutMs, p.model]), [[123, 'opus']])
            assert.strict.deepEqual(resolveProviders(providers(), { patch: {} }).providers.map((p) => p.timeoutMs), [undefined])
        })

    })

})
