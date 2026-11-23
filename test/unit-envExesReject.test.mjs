import assert from 'assert'
/* eslint-disable no-new-wrappers */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
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
import createFakeCli from './tools/fakeCliForTest.mjs'
import { SENT, revoked, pathWithoutRealCli } from './tools/hostileValuesForTest.mjs'


// unit-envExesReject.test.mjs — 四家CLI(runExecCli)、resolveProviders／resolveCatalogue之env、exes「給了而非物件即拒絕」(排程第553項之裁示②; 帳本R-SAFEOPT-1規則10; dspec〈輸入參數之檢測機制〉§11、K9)
//
// 規格句(每案註解標明):
//   E1 env給了而非物件(字串、數字、布林、陣列、Map、函數、包裝物件、Symbol、BigInt; 含空字串) → 四家CLI以params拒絕(attempts 0、不起子行程, 子行程不得繼承process.env而「視為未給」); claude之key模式亦同。
//   E2 env未給(undefined、null)、一般物件、process.env本身 → 照舊(合法輸入之行為不變)。不可讀者(已撤銷之Proxy)本就params(保持案)。
//   E3 resolveProviders／resolveCatalogue(／createAiCaller建構): env、exes給了而非物件 → 同步throw(無params結果通道; 同不可讀者之處置); 未給(undefined、null)照舊, 一般物件照用。
//   E4 訊息不回顯輸入值(K9): 只含參數名、期望之種類與typeof。
//   E5 遞補層於發try事件之前即判(checkSafeOpts, 與轉接器共用同一判定): 四家CLI條目之env無效者走條目層params、不發try。
//   E6 filterOpencodeFree(opencode models子行程)之env同口徑(同形站點)。
//   E7 起子行程之前即拒絕(以「每次被啟動即留記號」之假執行檔驗零次啟動, 含agy之stdin路徑--version探測); 可讀之env只讀一次(getter計數, 檢查之值即使用之值, K4)。
//   (2026-11-23 tdai2: exes之各kind值為非字串、env之各變數值為非字串原為「刻意不改」之保持案(列需裁示), 經主控裁定改為拒絕, 見unit-envExesValues.test.mjs(規則11)。)
//
// 安全: 不呼叫外部AI服務——假執行檔; before把PATH換成移除真CLI者、after還原。


let KEY = 'sk-test-envexes-0001-SECRET'
let NUM = 123456789

//記號檔(測試中之臨時檔放test/_tmp/<案名>/, 由本檔after清除): 記號假執行檔每被啟動一次即附加一字元, 供斷言「零次啟動」
let MARK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'envExesReject')
let MARK_FILE = path.join(MARK_DIR, 'mark.txt')
let MARK_CODE = `
import fs from 'fs'
fs.appendFileSync(${JSON.stringify(MARK_FILE)}, 'x')
process.stdin.on('data', () => {})
process.stdin.on('end', () => {
    process.stdout.write(JSON.stringify({ env: { FAKE_ENV: process.env.FAKE_ENV || '' } }))
    process.exit(0)
})
`


//全部「給了而非物件」之可讀env／exes值(含空字串、陣列、Map、函數、包裝物件、Symbol、BigInt)
let badObjs = () => [SENT, '', NUM, 0, true, false, [], [SENT], new String(SENT), new Map([['A', SENT]]), () => 1, Symbol(SENT), 10n]


let isParams = (t) => t.ok === false && t.errorType === 'params' && t.attempts === 0
let noEcho = (t) => {
    let s = String(t.error)
    return !s.includes(SENT) && !s.includes(KEY) && !s.includes(String(NUM))
}
//thrown, 呼叫fn取其拋出之訊息(未拋回null)
let thrown = (fn) => {
    try {
        fn()
        return null
    }
    catch (err) {
        return String(err && err.message)
    }
}


describe('env、exes給了而非物件 → 拒絕(排程第553項裁示②)', function() {

    let fake = null
    let savedPath = null

    before(function() {
        savedPath = process.env.PATH === undefined ? null : process.env.PATH
        process.env.PATH = pathWithoutRealCli()
        fake = createFakeCli('fake-env-exes-reject')
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

    //---------- E1、E2: CLI四家與runExecCli ----------
    let sites = {
        'dispatchCodex': (opt) => dispatchCodex('abc', { exe: fake.exe, ...opt }),
        'dispatchClaude(未給key)': (opt) => dispatchClaude('abc', { exe: fake.exe, ...opt }),
        'dispatchClaude(key模式)': (opt) => dispatchClaude('abc', { exe: fake.exe, key: KEY, ...opt }),
        'dispatchOpencode': (opt) => dispatchOpencode('abc', { exe: fake.exe, ...opt }),
        'dispatchAntigravity': (opt) => dispatchAntigravity('abc', { exe: fake.exe, ...opt }),
        'runExecCli': (opt) => runExecCli(fake.exe, [], opt),
    }

    for (let [name, call] of Object.entries(sites)) {

        it(`E1 ${name}: env給了而非物件以params回報且不起子行程(不視為未給而繼承process.env); 訊息不回顯(E4)`, async function() {
            let r = []
            for (let v of badObjs()) {
                let t = await call({ env: v })
                r.push([isParams(t), noEcho(t), /^env must be an object/.test(String(t.error))])
            }
            assert.strict.deepEqual(r, badObjs().map(() => [true, true, true]))
        })

        it(`E2 ${name}: env未給(undefined、null)、一般物件、process.env本身照舊; 已撤銷之Proxy本就params(保持案)`, async function() {
            let rows = []
            for (let v of [undefined, null, { FAKE_ENV: 'v1' }, process.env]) {
                let t = await call({ env: v })
                rows.push([t.ok, name === 'dispatchAntigravity' ? '' : JSON.parse(t.stdout).env.FAKE_ENV])
            }
            assert.strict.deepEqual(rows, [[true, ''], [true, ''], [true, name === 'dispatchAntigravity' ? '' : 'v1'], [true, '']])
            let t = await call({ env: revoked() })
            assert.strict.deepEqual([isParams(t), /^env is not readable/.test(String(t.error))], [true, true])
        })

    }

    //---------- E5: checkSafeOpts與遞補層 ----------
    it('E5 checkSafeOpts: 四家CLI之env給了而非物件回訊息; 一般物件、未給回空字串; REST種類不判env', async function() {
        let { checkSafeOpts } = await import('../src/readSafeOpt.mjs') //動態匯入: 本案以行為斷言逐項紅燈
        let kinds = ['claude', 'codex', 'opencode', 'antigravity']
        let rows = []
        for (let k of kinds) {
            rows.push([
                badObjs().map((v) => checkSafeOpts(k, { env: v }) !== '').every((x) => x === true),
                checkSafeOpts(k, { env: { A: '1' } }),
                checkSafeOpts(k, { env: undefined }),
                checkSafeOpts(k, { env: null }),
                checkSafeOpts(k, { env: process.env }),
                !checkSafeOpts(k, { env: SENT }).includes(SENT),
            ])
        }
        assert.strict.deepEqual(rows, kinds.map(() => [true, '', '', '', '', true]))
        assert.strict.deepEqual(['api-anthropic', 'api-typesafe-systemone', 'api-openai-compat', 'api-openai-responses'].map((k) => checkSafeOpts(k, { env: SENT, baseURL: undefined })), ['', '', '', ''])
    })

    it('E5 遞補層: 四家CLI條目之env給了而非物件走條目層params、不發try事件; 正常條目照發try', async function() {
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [
                { id: 'bad:claude', kind: 'claude', exe: fake.exe, env: SENT },
                { id: 'bad:claude-key', kind: 'claude', exe: fake.exe, keys: [KEY], env: [] },
                { id: 'bad:codex', kind: 'codex', exe: fake.exe, env: NUM },
                { id: 'bad:opencode', kind: 'opencode', exe: fake.exe, env: true },
                { id: 'bad:antigravity', kind: 'antigravity', exe: fake.exe, env: new Map() },
                { id: 'ok:one', kind: 'claude', exe: fake.exe, env: { FAKE_ENV: 'v1' } },
            ],
            onEvent: (ev) => events.push(ev),
        })
        let tries = events.filter((e) => e.type === 'try').map((e) => e.providerId)
        assert.strict.deepEqual(r.tried.map((t) => [t.providerId, t.errorType]), [['bad:claude', 'params'], ['bad:claude-key', 'params'], ['bad:codex', 'params'], ['bad:opencode', 'params'], ['bad:antigravity', 'params'], ['ok:one', undefined]])
        assert.strict.deepEqual([r.ok, r.providerId, tries], [true, 'ok:one', ['ok:one']])
    })

    it('E5 遞補層(checkSafeOpts)與resolveProviders之env判定只驗形狀、不執行env內之getter(由轉接器物化讀一次, K4; 既有契約: 範圍檢查不執行條目env內getter)', async function() {
        let { checkSafeOpts } = await import('../src/readSafeOpt.mjs')
        let n = 0
        let mkEnv = () => ({
            get FAKE_ENV() {
                n++
                return 'v-getter'
            },
        })
        checkSafeOpts('claude', { env: mkEnv() })
        checkSafeOpts('codex', { env: mkEnv() })
        resolveProviders([{ id: 'a', kind: 'claude' }], { env: mkEnv() })
        assert.strict.deepEqual(n, 0)

        //exes(2026-11-23 tdai2, 規則11): 各kind之值須為非空字串, 故物化一次(getter只讀一次, 檢查之值即使用之值, K4); env仍不執行getter
        resolveProviders([{ id: 'a', kind: 'claude' }], { env: mkEnv(), exes: mkEnv() })
        assert.strict.deepEqual(n, 1)
        n = 0
        let r = await dispatchAiFallback('abc', { providers: [{ id: 'g:codex', kind: 'codex', exe: fake.exe, env: mkEnv() }] })
        assert.strict.deepEqual([r.ok, n], [true, 1])
    })

    //---------- E7: 零次啟動與只讀一次 ----------
    it('E7 env給了而非物件者於起任何子行程之前即拒絕(記號假執行檔零次被啟動; 含agy stdin路徑之--version探測、claude key模式、filterOpencodeFree); 有效env為對照(確會啟動)', async function() {
        fs.mkdirSync(MARK_DIR, { recursive: true })
        let mk = createFakeCli('fake-env-exes-mark', MARK_CODE)
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
                await call({ env: [SENT] })
                let spawnedOnBad = fs.existsSync(MARK_FILE)
                fs.rmSync(MARK_FILE, { force: true })
                await call({ env: { FAKE_ENV: 'v1' } })
                let spawnedOnGood = fs.existsSync(MARK_FILE)
                rows.push([name, spawnedOnBad, spawnedOnGood])
            }
            assert.strict.deepEqual(rows, Object.keys(calls).map((name) => [name, false, true]))
        }
        finally {
            mk.clean()
        }
    })

    it('E7 dispatchCodex: env給了而非物件者連派工前之git基準列舉(refs/codex)都不起(以GIT_TRACE觀察git是否被啟動); 有效env為對照(確會啟動)', async function() {
        let repo = path.join(MARK_DIR, 'repo')
        fs.mkdirSync(repo, { recursive: true })
        execFileSync('git', ['init', '-q'], { cwd: repo, windowsHide: true })
        let trace = path.join(MARK_DIR, 'git-trace.txt')
        let saved = process.env.GIT_TRACE
        process.env.GIT_TRACE = trace
        try {
            fs.rmSync(trace, { force: true })
            let tBad = await dispatchCodex('abc', { exe: fake.exe, cwd: repo, env: [SENT] })
            let badSpawned = fs.existsSync(trace)
            fs.rmSync(trace, { force: true })
            let tGood = await dispatchCodex('abc', { exe: fake.exe, cwd: repo, env: { FAKE_ENV: 'v1' } })
            let goodSpawned = fs.existsSync(trace)
            assert.strict.deepEqual([isParams(tBad), badSpawned, tGood.ok, goodSpawned], [true, false, true, true])
        }
        finally {
            if (saved === undefined) {
                delete process.env.GIT_TRACE
            }
            else {
                process.env.GIT_TRACE = saved
            }
        }
    })

    it('E7 可讀之env只讀一次(檢查之值即使用之值, K4): getter計數為1且子行程收到該值(四家CLI、claude key模式、runExecCli)', async function() {
        let rows = []
        for (let [name, call] of Object.entries({
            'dispatchCodex': (o) => dispatchCodex('abc', { exe: fake.exe, ...o }),
            'dispatchClaude': (o) => dispatchClaude('abc', { exe: fake.exe, ...o }),
            'dispatchClaude(key)': (o) => dispatchClaude('abc', { exe: fake.exe, key: KEY, ...o }),
            'dispatchOpencode': (o) => dispatchOpencode('abc', { exe: fake.exe, ...o }),
            'dispatchAntigravity': (o) => dispatchAntigravity('abc', { exe: fake.exe, ...o }),
            'runExecCli': (o) => runExecCli(fake.exe, [], o),
        })) {
            let n = 0
            let env = {
                get FAKE_ENV() {
                    n++
                    return 'v-getter'
                },
            }
            let t = await call({ env })
            rows.push([name, t.ok, n, name === 'dispatchAntigravity' ? 'skip' : JSON.parse(t.stdout).env.FAKE_ENV])
        }
        assert.strict.deepEqual(rows, [
            ['dispatchCodex', true, 1, 'v-getter'],
            ['dispatchClaude', true, 1, 'v-getter'],
            ['dispatchClaude(key)', true, 1, 'v-getter'],
            ['dispatchOpencode', true, 1, 'v-getter'],
            ['dispatchAntigravity', true, 1, 'skip'],
            ['runExecCli', true, 1, 'v-getter'],
        ])
    })

    it('E6 filterOpencodeFree: 有效之env確實交給查詢子行程(假執行檔依FAKE_ENV印出模型id; env未給時子行程無該變數)', async function() {
        let mk = createFakeCli('fake-env-exes-models', `process.stdout.write('opencode/' + (process.env.FAKE_ENV || 'none') + '-free\\n')\nprocess.exit(0)\n`)
        try {
            let providersIn = [{ id: 'oc:v1-free', kind: 'opencode', model: 'opencode/v1-free' }]
            let withEnv = await filterOpencodeFree(providersIn, { exe: mk.exe, env: { FAKE_ENV: 'v1' } })
            let noEnv = await filterOpencodeFree(providersIn, { exe: mk.exe })
            assert.strict.deepEqual(
                [withEnv.ok, withEnv.available.map((p) => p.id), withEnv.removed.length, noEnv.ok, noEnv.available.length, noEnv.removed.map((p) => p.id)],
                [true, ['oc:v1-free'], 0, true, 0, ['oc:v1-free']],
            )
        }
        finally {
            mk.clean()
        }
    })

    //---------- E6: filterOpencodeFree ----------
    it('E6 filterOpencodeFree: env給了而非物件以params回報、不起子行程; 未給與一般物件不是params(走到解析)', async function() {
        let providersIn = [{ id: 'oc:x-free', kind: 'opencode', model: 'opencode/x-free' }]
        let rows = []
        for (let v of badObjs()) {
            let t = await filterOpencodeFree(providersIn, { exe: fake.exe, env: v })
            rows.push([t.ok, t.errorType, /^env must be an object/.test(String(t.error)), !String(t.error).includes(SENT)])
        }
        assert.strict.deepEqual(rows, badObjs().map(() => [false, 'params', true, true]))
        let ok = []
        for (let v of [undefined, null, { FAKE_ENV: 'v1' }]) {
            let t = await filterOpencodeFree(providersIn, { exe: fake.exe, env: v })
            ok.push(t.errorType !== 'params')
        }
        assert.strict.deepEqual(ok, [true, true, true])
    })

})


describe('resolveProviders／resolveCatalogue／createAiCaller: env、exes給了而非物件 → 同步throw(排程第553項裁示②)', function() {

    let providers = () => [{ id: 'a', kind: 'claude' }, { id: 'b', kind: 'claude', envVar: 'ENV_EXES_REJECT_KEYS' }]

    it('E3 resolveProviders: env給了而非物件(含空字串、陣列、Map) → throw「env must be an object」、訊息不回顯', function() {
        let rows = badObjs().map((v) => {
            let m = thrown(() => resolveProviders(providers(), { env: v }))
            return [m !== null && /^env must be an object/.test(m), m !== null && !m.includes(SENT)]
        })
        assert.strict.deepEqual(rows, badObjs().map(() => [true, true]))
    })

    it('E3 resolveProviders: exes給了而非物件 → throw「exes must be an object」、訊息不回顯', function() {
        let rows = badObjs().map((v) => {
            let m = thrown(() => resolveProviders(providers(), { exes: v }))
            return [m !== null && /^exes must be an object/.test(m), m !== null && !m.includes(SENT)]
        })
        assert.strict.deepEqual(rows, badObjs().map(() => [true, true]))
    })

    it('E3 resolveProviders: env、exes未給(undefined、null)與一般物件照舊(含空物件不改用process.env); 已撤銷之Proxy本就throw「is not readable」(exes之各kind值非字串已於tdai2改為拒絕, 見unit-envExesValues)', function() {
        //未給: env用process.env(此環境變數未設, 條目b缺金鑰而skipped)、exes不注入
        for (let v of [undefined, null]) {
            let r = resolveProviders(providers(), { env: v, exes: v })
            assert.strict.deepEqual([r.providers.map((p) => p.id), r.skipped.map((s) => s.id), r.providers.map((p) => p.exe)], [['a'], ['b'], [undefined]])
        }

        //一般物件: env取該物件之金鑰、exes依kind注入
        let r1 = resolveProviders(providers(), { env: { ENV_EXES_REJECT_KEYS: 'sk-1,sk-2' }, exes: { claude: 'C:/x/claude.exe' } })
        assert.strict.deepEqual(r1.providers.map((p) => [p.id, p.keys, p.exe]), [['a', undefined, 'C:/x/claude.exe'], ['b', ['sk-1', 'sk-2'], 'C:/x/claude.exe']])

        //空物件為有效之env(不退回process.env)
        let r2 = resolveProviders(providers(), { env: {}, exes: {} })
        assert.strict.deepEqual([r2.providers.map((p) => p.id), r2.skipped.map((s) => s.id)], [['a'], ['b']])

        //exes之各kind值為非字串: 2026-11-23 tdai2起拒絕(規則11; 見unit-envExesValues.test.mjs), 修前(tdai1b之保持案)照舊略過

        //不可讀: 本就throw
        assert.strict.deepEqual([thrown(() => resolveProviders(providers(), { env: revoked() })).startsWith('env is not readable: '), thrown(() => resolveProviders(providers(), { exes: revoked() })).startsWith('exes is not readable: ')], [true, true])
    })

    it('E3 resolveCatalogue: env、exes給了而非物件 → throw(含env與envFile並給時); 未給與一般物件照舊(env原物件原樣回傳)', function() {
        let rows = badObjs().map((v) => {
            let m1 = thrown(() => resolveCatalogue({ catalogue: [], env: v }))
            let m2 = thrown(() => resolveCatalogue({ catalogue: [], exes: v }))
            let m3 = thrown(() => resolveCatalogue({ catalogue: [], env: v, envFile: './not-exist.env' }))
            return [m1 !== null && /^env must be an object/.test(m1), m2 !== null && /^exes must be an object/.test(m2), m3 !== null && /^env must be an object/.test(m3), [m1, m2, m3].every((m) => m !== null && !m.includes(SENT))]
        })
        assert.strict.deepEqual(rows, badObjs().map(() => [true, true, true, true]))
        let env = { ENV_EXES_REJECT_KEYS: 'sk-1' }
        let r = resolveCatalogue({ catalogue: [], extraProviders: providers(), env })
        assert.strict.deepEqual([r.env === env, r.resolved.providers.map((p) => p.id)], [true, ['a', 'b']])
        for (let v of [undefined, null]) {
            let r2 = resolveCatalogue({ catalogue: [], extraProviders: providers(), env: v, exes: v })
            assert.strict.deepEqual([r2.env, r2.resolved.providers.map((p) => p.id)], [null, ['a']])
        }
    })

    it('E3 createAiCaller: 建構時env、exes給了而非物件 → throw(經resolveCatalogue); 一般物件照舊', function() {
        let m1 = thrown(() => createAiCaller({ env: SENT, catalogue: [] }))
        let m2 = thrown(() => createAiCaller({ exes: [], catalogue: [] }))
        assert.strict.deepEqual([/^env must be an object/.test(m1), !m1.includes(SENT), /^exes must be an object/.test(m2)], [true, true, true])
        assert.strict.deepEqual(thrown(() => createAiCaller({ env: {}, exes: {}, catalogue: [] })), null)
    })

})
