import assert from 'assert'
/* eslint-disable no-new-wrappers */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dispatchCodex from '../src/dispatchCodex.mjs'
import dispatchClaude from '../src/dispatchClaude.mjs'
import dispatchOpencode from '../src/dispatchOpencode.mjs'
import dispatchAntigravity from '../src/dispatchAntigravity.mjs'
import dispatchApiAnthropic from '../src/dispatchApiAnthropic.mjs'
import dispatchApiOpenaiCompat from '../src/dispatchApiOpenaiCompat.mjs'
import dispatchApiOpenaiResponses from '../src/dispatchApiOpenaiResponses.mjs'
import dispatchApiTypesafeSystemone from '../src/dispatchApiTypesafeSystemone.mjs'
import dispatchAiFallback from '../src/dispatchAiFallback.mjs'
import createAiCaller from '../src/createAiCaller.mjs'
import resolveProviders from '../src/resolveProviders.mjs'
import probeAnthropicKeys, { probeAnthropicKey } from '../src/probeAnthropicKeys.mjs'
import opencodeGoUsage from '../src/opencodeGoUsage.mjs'
import getQuotaClaude from '../src/quota/getQuotaClaude.mjs'
import getQuotaCodex from '../src/quota/getQuotaCodex.mjs'
import getQuotaAntigravity from '../src/quota/getQuotaAntigravity.mjs'
import filterOpencodeFree from '../src/filterOpencodeFree.mjs'
import makeArrayCoverageValidator from '../src/wkf/makeArrayCoverageValidator.mjs'
import createFakeCli from './tools/fakeCliForTest.mjs'
import { SENT, revoked, hostile, pathWithoutRealCli } from './tools/hostileValuesForTest.mjs'


// unit-safeOpts.test.mjs — 影響安全或計費之純量opt「給了而無效即拒絕」(排程第553項; 帳本R-SAFEOPT-1; dspec〈輸入參數之檢測機制〉§11安全相關opt為K3之例外、K9)
//
// 規格句(每案註解標明):
//   S1 未給(undefined、null)用預設; 有效值照用(合法輸入之行為不變)。
//   S2 給了而無效(非原始字串／布林／陣列／物件、空字串、不可讀者)一律以params回報(ok false、errorType 'params'、attempts 0), 不起子行程、不送請求, 不退回較寬或官方之預設。
//   S3 訊息不回顯輸入值(K9): 只含參數名、期望之種類與typeof。
//   涵蓋: codex sandbox; claude／agy skipPermissions; agy addDirs; REST baseURL(四家); 各家exe／cwd; A3 getQuotaClaude／getQuotaCodex之env; B2 resolveProviders之envVar＋無效keys;
//   C1 條目params失敗不發try事件(onUsage不入帳); A5 probeAnthropicKeys之keys／opt不可讀; A7 makeArrayCoverageValidator與callAI之不可讀設定。
//
// 安全: 全部不實際呼叫外部AI服務——CLI一律假執行檔(修前之無效exe會退回PATH上之真CLI, 故全檔須於移除真CLI之PATH下執行, before守門確認),
//   全域fetch於測試期間換為記錄替身(不發真實請求), 額度讀者指向空之暫存目錄且codex不起app-server。


let FD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '_tmp', 'safeOpts')
let NUM = 123456789 //數字輸入: 訊息不得出現其字面(SENT標記字串、revoked、hostile、pathWithoutRealCli改由test/tools/hostileValuesForTest.mjs取用)


let revokedArr = () => {
    let r = Proxy.revocable([], {})
    r.revoke()
    return r.proxy
}
let throwingLenArr = () => new Proxy([SENT], {
    get(t, k) {
        if (k === 'length') {
            throw new Error('length boom')
        }
        return t[k]
    },
})

//非原始非空字串之全部無效值(含空字串、包裝物件、不可讀者); 供exe、cwd、sandbox、baseURL
let badStrs = () => [NUM, '', false, true, {}, [], new String(SENT), hostile(), revoked(), () => 1, [SENT]]

//非原始布林之全部無效值; 供skipPermissions
let badBools = () => ['false', 'true', 0, 1, '', {}, [], new Boolean(false), hostile(), revoked(), () => 1]


//isParams, 該結果為params拒絕(未送出)
let isParams = (t) => t.ok === false && t.errorType === 'params' && t.attempts === 0
//noEcho, 訊息不含輸入值之標記(K9)
let noEcho = (t) => {
    let s = String(t.error)
    return !s.includes(SENT) && !s.includes(String(NUM))
}


//(修前之無效exe會退回PATH上之預設執行檔而起真實子行程、耗外部額度; 本檔於執行期間改用pathWithoutRealCli()之PATH並於after還原, 不依賴外部包裝, 開發機PATH上有真CLI時亦可直接執行)


describe('安全相關opt給了而無效即拒絕(排程第553項)', function() {

    let fake = null
    let realFetch = null
    let calls = [] //全域fetch替身收到之請求網址(不發真實請求)
    let savedPath = null

    before(function() {
        savedPath = process.env.PATH === undefined ? null : process.env.PATH
        process.env.PATH = pathWithoutRealCli()
        fs.mkdirSync(FD, { recursive: true })
        fake = createFakeCli('fake-safe-opts')
        realFetch = globalThis.fetch
        globalThis.fetch = async (url) => {
            calls.push(String(url))
            return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
    })

    after(function() {
        if (savedPath !== null) {
            process.env.PATH = savedPath
        }
        if (realFetch !== null) {
            globalThis.fetch = realFetch
        }
        if (fake) {
            fake.clean()
        }
        fs.rmSync(FD, { recursive: true, force: true })
        try {
            fs.rmdirSync(path.dirname(FD))
        }
        catch {}
    })

    beforeEach(function() {
        calls.length = 0
    })

    //---------- CLI四家: exe、cwd ----------
    let adapters = {
        'dispatchCodex': (opt) => dispatchCodex('abc', opt),
        'dispatchClaude': (opt) => dispatchClaude('abc', opt),
        'dispatchOpencode': (opt) => dispatchOpencode('abc', opt),
        'dispatchAntigravity': (opt) => dispatchAntigravity('abc', opt),
    }

    for (let [name, call] of Object.entries(adapters)) {

        it(`${name}: exe給了而無效(S2)以params回報且不起子行程、不退回PATH上之預設執行檔; 訊息不回顯(S3)`, async function() {
            let r = []
            for (let v of badStrs()) {
                let t = await call({ exe: v })
                r.push([isParams(t), noEcho(t), /exe/.test(t.error)])
            }
            assert.strict.deepEqual(r, badStrs().map(() => [true, true, true]))
        })

        it(`${name}: cwd給了而無效(S2)以params回報且不起子行程(不退回process.cwd()); 有效cwd照用、未給(undefined、null)用預設(S1)`, async function() {
            let r = []
            for (let v of badStrs()) {
                let t = await call({ exe: fake.exe, cwd: v })
                r.push([isParams(t), noEcho(t), /cwd/.test(t.error)])
            }
            assert.strict.deepEqual(r, badStrs().map(() => [true, true, true]))
            let ok = []
            for (let cwd of [fake.fd, undefined, null]) {
                let t = await call({ exe: fake.exe, cwd })
                ok.push(t.ok)
            }
            assert.strict.deepEqual(ok, [true, true, true])
        })

    }

    //---------- codex sandbox ----------
    it('dispatchCodex: sandbox給了而無效(S2)以params回報且不起子行程(不退回workspace-write放寬); 有效值照用、未給用預設(S1); 訊息不回顯(S3)', async function() {
        let r = []
        for (let v of badStrs()) {
            let t = await dispatchCodex('abc', { exe: fake.exe, sandbox: v })
            r.push([isParams(t), noEcho(t), /sandbox/.test(t.error)])
        }
        assert.strict.deepEqual(r, badStrs().map(() => [true, true, true]))
        let ok = []
        for (let sb of ['read-only', 'danger-full-access', undefined, null]) {
            let t = await dispatchCodex('abc', { exe: fake.exe, sandbox: sb })
            let o = JSON.parse(t.stdout)
            ok.push([t.ok, o.args[o.args.indexOf('--sandbox') + 1]])
        }
        assert.strict.deepEqual(ok, [[true, 'read-only'], [true, 'danger-full-access'], [true, 'workspace-write'], [true, 'workspace-write']])
    })

    //---------- claude／agy skipPermissions ----------
    for (let [name, call, flag] of [
        ['dispatchClaude', (opt) => dispatchClaude('abc', opt), '--dangerously-skip-permissions'],
        ['dispatchAntigravity', (opt) => dispatchAntigravity('abc', opt), '--dangerously-skip-permissions'],
    ]) {
        it(`${name}: skipPermissions給了而無效(S2)以params回報且不起子行程(不退回true關掉權限閘門); 布林照用、未給用預設true(S1); 訊息不回顯(S3)`, async function() {
            let r = []
            for (let v of badBools()) {
                let t = await call({ exe: fake.exe, skipPermissions: v })
                r.push([isParams(t), noEcho(t), /skipPermissions/.test(t.error)])
            }
            assert.strict.deepEqual(r, badBools().map(() => [true, true, true]))
            let ok = []
            for (let sp of [true, false, undefined, null]) {
                let t = await call({ exe: fake.exe, skipPermissions: sp })
                ok.push([t.ok, JSON.parse(t.stdout).args.includes(flag)])
            }
            assert.strict.deepEqual(ok, [[true, true], [true, false], [true, true], [true, true]])
        })
    }

    //---------- agy addDirs ----------
    it('dispatchAntigravity: addDirs給了而無效(非陣列、不可讀、元素全無效)(S2)以params回報且不起子行程(不退回[cwd]放寬可視範圍); 空陣列與含有效字串者照舊(S1); 訊息不回顯(S3)', async function() {
        let bad = [SENT, NUM, true, false, '', {}, hostile(), revoked(), revokedArr(), throwingLenArr(), [NUM], [{}], [true, NUM], [hostile()], [revoked()]]
        let r = []
        for (let v of bad) {
            let t = await dispatchAntigravity('abc', { exe: fake.exe, addDirs: v })
            r.push([isParams(t), noEcho(t), /addDirs/.test(t.error)])
        }
        assert.strict.deepEqual(r, bad.map(() => [true, true, true]))
        let ok = []
        for (let v of [[], ['c:/a'], ['c:/a', NUM, null, '', 'c:/b'], undefined, null]) {
            let t = await dispatchAntigravity('abc', { exe: fake.exe, addDirs: v })
            let a = JSON.parse(t.stdout).args
            ok.push([t.ok, a.filter((x, i) => a[i - 1] === '--add-dir')])
        }
        assert.strict.deepEqual(ok, [[true, []], [true, ['c:/a']], [true, ['c:/a', 'c:/b']], [true, [process.cwd()]], [true, [process.cwd()]]])
    })

    //---------- REST baseURL ----------
    describe('REST四家之baseURL', function() {

        let Q = {
            category: { type: 'choice', instructions: '哪一類?', criteria: { '報修': '設備故障', '其他': null } },
            urgent: { type: 'noul', instructions: '是否急迫?' },
        }

        //必填者(Compat、Responses: 未給即拒絕, 本就不退回預設)與可省略者(Anthropic、TypeSafe: 未給用官方端點)
        let optional = {
            'dispatchApiAnthropic': [(opt) => dispatchApiAnthropic('abc', { key: 'sk-ant-test-0001', model: 'm', ...opt }), 'https://api.anthropic.com/v1/messages'],
            'dispatchApiTypesafeSystemone': [(opt) => dispatchApiTypesafeSystemone('abc', { key: 'sk-test-0001', model: 'm', questions: Q, ...opt }), null],
        }
        let required = {
            'dispatchApiOpenaiCompat': (opt) => dispatchApiOpenaiCompat('abc', { key: 'sk-test-0001', model: 'm', ...opt }),
            'dispatchApiOpenaiResponses': (opt) => dispatchApiOpenaiResponses('abc', { key: 'sk-test-0001', model: 'm', ...opt }),
        }

        for (let [name, [call]] of Object.entries(optional)) {
            it(`${name}: baseURL給了而無效(S2)以params回報、不送請求(不退回官方端點使金鑰改送官方); 未給(undefined、null)用官方端點(S1); 訊息不回顯(S3)`, async function() {
                let r = []
                for (let v of badStrs()) {
                    let t = await call({ baseURL: v })
                    r.push([isParams(t), noEcho(t), /baseURL/.test(t.error)])
                }
                assert.strict.deepEqual(r, badStrs().map(() => [true, true, true]))
                assert.strict.deepEqual(calls, []) //無效者一律未送出任何請求
                let seen = []
                for (let v of [undefined, null]) {
                    calls.length = 0
                    await call({ baseURL: v })
                    seen.push(calls.length)
                }
                assert.strict.deepEqual(seen, [1, 1]) //未給者送往官方端點(經記錄替身, 未發真實請求)
            })
        }

        for (let [name, call] of Object.entries(required)) {
            it(`${name}: baseURL必填, 未給或無效一律以params回報(本就不退回預設; 保持案)、訊息不回顯(S3)、不送請求`, async function() {
                let r = []
                for (let v of [undefined, null, ...badStrs()]) {
                    let t = await call({ baseURL: v })
                    r.push([isParams(t), noEcho(t)])
                }
                assert.strict.deepEqual(r, [undefined, null, ...badStrs()].map(() => [true, true]))
                assert.strict.deepEqual(calls, [])
            })
        }

        it('probeAnthropicKey／probeAnthropicKeys: baseURL給了而無效不送請求(金鑰不改送官方); opencodeGoUsage: baseURL給了而非http(s)網址以params回報', async function() {
            let r = []
            for (let v of badStrs()) {
                let t = await probeAnthropicKey('sk-ant-test-0001', { baseURL: v })
                r.push([t.ok, t.kind, /baseURL/.test(t.detail), t.detail.includes(SENT)])
            }
            assert.strict.deepEqual(r, badStrs().map(() => [false, 'other', true, false]))
            let rs = []
            for (let v of badStrs()) {
                let t = await probeAnthropicKeys(['sk-ant-test-0001'], { baseURL: v })
                rs.push([t.errorType, t.results.length, noEcho(t)])
            }
            assert.strict.deepEqual(rs, badStrs().map(() => ['params', 0, true]))
            let g = []
            for (let v of [NUM, '', 'ftp://x', 'not a url', {}, [], true, new String('https://x')]) {
                let t = await opencodeGoUsage({ key: 'sk-test-visible-ascii-0001', baseURL: v })
                g.push([t.ok, t.errorType, noEcho(t)])
            }
            assert.strict.deepEqual(g, [NUM, '', 'ftp://x', 'not a url', {}, [], true, new String('https://x')].map(() => [false, 'params', true]))
            assert.strict.deepEqual(calls, []) //無效者一律未送出任何請求
        })

    })

    //---------- A3: getQuotaClaude／getQuotaCodex之env ----------
    describe('A3 額度讀者之env', function() {

        let emptyHome = null

        before(function() {
            emptyHome = path.join(FD, 'home')
            fs.mkdirSync(emptyHome, { recursive: true })
        })

        let throwingEnv = () => ({
            get CLAUDE_CONFIG_DIR() {
                throw new Error('env boom')
            },
        })
        let badEnvs = () => [revoked(), throwingEnv(), SENT, NUM, true, false, [], [SENT], new Map([[SENT, SENT]]), new String(SENT), () => 1]

        it('getQuotaClaude: env給了而無效(非一般物件、不可讀)(S2)以params回報(errorType params), 不退回process.env改查預設帳號; 未給與一般物件照用(S1); 訊息不回顯(S3)', async function() {
            let r = []
            for (let v of badEnvs()) {
                let t = await getQuotaClaude('', { env: v, homeDir: emptyHome, configDir: emptyHome, profileFallback: false })
                r.push([t.ok, t.errorType, noEcho(t)])
            }
            assert.strict.deepEqual(r, badEnvs().map(() => [false, 'params', true]))
            let ok = []
            for (let v of [undefined, null, {}]) {
                let t = await getQuotaClaude('', { env: v, homeDir: emptyHome, configDir: emptyHome, profileFallback: false })
                ok.push(t.errorType !== 'params')
            }
            assert.strict.deepEqual(ok, [true, true, true])
            assert.strict.deepEqual(calls, [])
        })

        it('getQuotaCodex: env給了而無效(S2)以params回報(errorType params), 不退回process.env; 未給與一般物件照用(S1); 訊息不回顯(S3)', async function() {
            let r = []
            for (let v of badEnvs()) {
                let t = await getQuotaCodex('', { env: v, homeDir: emptyHome, codexHome: emptyHome, useAppServer: false })
                r.push([t.ok, t.errorType, noEcho(t)])
            }
            assert.strict.deepEqual(r, badEnvs().map(() => [false, 'params', true]))
            let ok = []
            for (let v of [undefined, null, {}]) {
                let t = await getQuotaCodex('', { env: v, homeDir: emptyHome, codexHome: emptyHome, useAppServer: false })
                ok.push(t.errorType !== 'params')
            }
            assert.strict.deepEqual(ok, [true, true, true])
            assert.strict.deepEqual(calls, [])
        })

        it('額度讀者之exe、cwd、homeDir、configDir、codexHome給了而無效(S2)以params回報、不起子行程(不退回預設而換執行檔或查預設帳號之目錄); filterOpencodeFree之exe同; 訊息不回顯(S3); env為行程環境本身(process.env)照用', async function() {
            let r = []
            for (let v of badStrs()) {
                let a = await getQuotaClaude('', { homeDir: v, configDir: emptyHome, profileFallback: false })
                let b = await getQuotaClaude('', { homeDir: emptyHome, configDir: v, profileFallback: false })
                let c = await getQuotaCodex('', { exe: v, homeDir: emptyHome, codexHome: emptyHome, useAppServer: false })
                let d = await getQuotaCodex('', { homeDir: v, codexHome: emptyHome, useAppServer: false })
                let e = await getQuotaCodex('', { homeDir: emptyHome, codexHome: v, useAppServer: false })
                let f = await getQuotaAntigravity('', { exe: v, cwd: emptyHome, checkVersion: false })
                let g = await getQuotaAntigravity('', { exe: fake.exe, cwd: v, checkVersion: false })
                let h = await filterOpencodeFree([], { exe: v })
                r.push([a, b, c, d, e, f, g].map((t) => [t.ok, t.errorType, noEcho(t)]).concat([[h.ok, h.errorType, noEcho(h)]]))
            }
            assert.strict.deepEqual(r, badStrs().map(() => Array(8).fill(null).map(() => [false, 'params', true])))
            let ok = await getQuotaClaude('', { env: process.env, homeDir: emptyHome, configDir: emptyHome, profileFallback: false })
            assert.strict.deepEqual(ok.errorType !== 'params', true)
        })

    })

    //---------- checkSafeOpts(遞補層於發try事件之前判定之單一來源) ----------
    it('checkSafeOpts: 依kind判定轉接器之安全相關opt(給了而無效回訊息、有效或未給回空字串; 表外kind回空字串; 讀取拋錯回訊息; 訊息不回顯)', async function() {
        let { checkSafeOpts } = await import('../src/readSafeOpt.mjs') //動態匯入: 修前此模組不存在時只使本案紅燈(其餘案以行為斷言紅燈, 可逐案統計)
        let boom = {
            get exe() {
                throw new Error('exe boom')
            },
        }
        let r = [
            checkSafeOpts('codex', { sandbox: NUM }),
            checkSafeOpts('codex', { sandbox: 'read-only', exe: 'x', cwd: 'y', cleanCodexRefs: false }),
            checkSafeOpts('codex', { cleanCodexRefs: 'no' }),
            checkSafeOpts('claude', { skipPermissions: 'false' }),
            checkSafeOpts('claude', { exe: '' }),
            checkSafeOpts('opencode', { cwd: {} }),
            checkSafeOpts('antigravity', { addDirs: 'c:/a' }),
            checkSafeOpts('antigravity', { addDirs: [], skipPermissions: false }),
            checkSafeOpts('api-anthropic', { baseURL: 123 }),
            checkSafeOpts('api-typesafe-systemone', { baseURL: undefined }),
            checkSafeOpts('api-openai-compat', { baseURL: 123 }),
            checkSafeOpts('unknown-kind', { exe: 123 }),
            checkSafeOpts('claude', boom),
            checkSafeOpts('codex', null),
        ]
        assert.strict.deepEqual(r.map((s) => s !== ''), [true, false, true, true, true, true, true, false, true, false, false, false, true, false])
        assert.strict.deepEqual(r.every((s) => !s.includes(String(NUM))), true)
    })

    it('dispatchCodex: cleanCodexRefs給了而非布林以params拒絕(破壞性開關不退回「開」)、不起子行程; true、false、未給照用', async function() {
        let bad = []
        for (let v of [0, 1, 'false', 'no', '', {}, [], new Boolean(false)]) {
            let t = await dispatchCodex('abc', { exe: fake.exe, cleanCodexRefs: v })
            bad.push([isParams(t), noEcho(t), /cleanCodexRefs/.test(t.error)])
        }
        assert.strict.deepEqual(bad, Array(8).fill([true, true, true]))
        let ok = []
        for (let v of [true, false, undefined, null]) {
            let t = await dispatchCodex('abc', { exe: fake.exe, cleanCodexRefs: v })
            ok.push(t.ok)
        }
        assert.strict.deepEqual(ok, [true, true, true, true])
    })

    //---------- B2: resolveProviders之envVar＋無效keys ----------
    it('B2 resolveProviders: 條目帶envVar而keys給了無效(字串、物件、數字、元素全無效)時不以環境變數之金鑰取代(原樣通過留待遞補層params拒絕); keys未給(undefined、null、[]、元素全空)才依envVar展開; 有效keys照用', function() {
        let env = { ENV_TEST_KEYS: 'sk-env-1,sk-env-2' }
        let mk = (keys) => ({ id: 'e1', kind: 'claude', envVar: 'ENV_TEST_KEYS', ...(keys === undefined ? {} : { keys }) })
        let run = (keys) => resolveProviders([mk(keys)], { env }).providers[0].keys
        let r = {
            badStr: run(SENT),
            badObj: run({}),
            badNum: run(NUM),
            badEls: run([NUM, {}]),
            badTrue: run(true),
            unset: run(undefined),
            nul: run(null),
            empty: run([]),
            emptyEls: run(['', null]),
            valid: run(['sk-own']),
        }
        assert.strict.deepEqual(r, {
            badStr: SENT,
            badObj: {},
            badNum: NUM,
            badEls: [NUM, {}],
            badTrue: true,
            unset: ['sk-env-1', 'sk-env-2'],
            nul: ['sk-env-1', 'sk-env-2'],
            empty: ['sk-env-1', 'sk-env-2'],
            emptyEls: ['sk-env-1', 'sk-env-2'],
            valid: ['sk-own'],
        })
    })

    //---------- C1: 條目params失敗不發try事件 ----------
    it('C1 params失敗(keys給了而無效; 轉接器之安全相關opt exe／cwd／sandbox／skipPermissions／addDirs／baseURL給了而無效)不發try事件、onUsage不入帳; 失敗仍進tried; 正常條目照發try', async function() {
        let events = []
        let r = await dispatchAiFallback('abc', {
            providers: [
                { id: 'bad:keys', kind: 'claude', exe: fake.exe, keys: SENT },
                { id: 'bad:exe', kind: 'claude', exe: NUM },
                { id: 'bad:sandbox', kind: 'codex', exe: fake.exe, sandbox: {} },
                { id: 'bad:addDirs', kind: 'antigravity', exe: fake.exe, addDirs: 'c:/a' },
                { id: 'bad:baseURL', kind: 'api-anthropic', model: 'm', key: 'sk-test-0001', baseURL: [] },
                { id: 'ok:one', kind: 'claude', exe: fake.exe },
            ],
            onEvent: (ev) => events.push(ev),
        })
        let tries = events.filter((e) => e.type === 'try').map((e) => e.providerId)
        assert.strict.deepEqual([r.ok, r.providerId, tries, r.tried.map((t) => [t.providerId, t.errorType])], [true, 'ok:one', ['ok:one'], [['bad:keys', 'params'], ['bad:exe', 'params'], ['bad:sandbox', 'params'], ['bad:addDirs', 'params'], ['bad:baseURL', 'params'], ['ok:one', undefined]]])
        assert.strict.deepEqual(calls, [])
        let used = []
        let caller = createAiCaller({
            extraProviders: [{ id: 'bad:keys', kind: 'claude', exe: fake.exe, keys: SENT }, { id: 'ok:one', kind: 'claude', exe: fake.exe }],
            pick: ['bad:keys', 'ok:one'],
            catalogue: [],
            onUsage: (id) => used.push(id),
        })
        let rc = await caller.callAI('abc')
        assert.strict.deepEqual([rc.ok, used], [true, ['ok:one']])
    })

    //---------- A5: probeAnthropicKeys之不可讀設定 ----------
    it('A5 probeAnthropicKeys: keys或opt不可讀、陣列length讀取拋錯(S2)以params回報(不reject、不探測任何金鑰、不送請求); 一般輸入照舊(S1)', async function() {
        let bad = [revoked(), revokedArr(), throwingLenArr()]
        let r = []
        for (let v of bad) {
            let t = await probeAnthropicKeys(v)
            r.push([t.errorType, t.results.length, t.summary.total, noEcho(t)])
        }
        let t2 = await probeAnthropicKeys(['sk-ant-test-0001'], revoked())
        r.push([t2.errorType, t2.results.length, t2.summary.total, noEcho(t2)])
        assert.strict.deepEqual(r, [...bad, null].map(() => ['params', 0, 0, true]))
        assert.strict.deepEqual(calls, [])
        let ok = await probeAnthropicKeys(['sk-ant-test-0001', ''], {})
        assert.strict.deepEqual([ok.errorType, ok.results.map((x) => x.kind), ok.summary.total], [undefined, ['ok', 'other'], 2])
        let none = await probeAnthropicKeys(undefined)
        assert.strict.deepEqual([none.errorType, none.results.length], [undefined, 0])
    })

    //A5(length之值): 陣列(含以Proxy偽裝者)之length不是合法陣列長度(undefined、負數、NaN、字串、小數、Infinity)或超過上限(10000)以params回報、不探測、不送請求(帳本R-SAFEOPT-1; 複審補: 變異S29移除length守門而存活)
    it('A5 probeAnthropicKeys: 陣列length非合法長度(undefined、-1、NaN、字串、1.5)或超過10000把以params回報(訊息不回顯值; 不送請求)', async function() {
        let withLen = (len) => new Proxy([SENT], { get: (t, k) => (k === 'length' ? len : Reflect.get(t, k)) })
        let r = []
        for (let len of [undefined, -1, NaN, 'abc', 1.5]) { //(Infinity於修前使迴圈無窮、記憶體耗盡而行程中止, 無從在修前版本取得摘要, 故不列; 其判定與NaN同為Number.isInteger為假)
            let t = await probeAnthropicKeys(withLen(len))
            r.push([t.errorType, t.results.length, /^keys is not readable: length is not a valid array length/.test(String(t.error)), noEcho(t)])
        }
        for (let big of [new Array(10001).fill('sk-ant-test-0001'), new Array(10001)]) { //(超大稀疏陣列如2**32-1於修前會使行程記憶體耗盡中止而無摘要, 故取剛過上限者; 超大者之判定另見unit-keyOptReject之readKeys)
            let t = await probeAnthropicKeys(big)
            r.push([t.errorType, t.results.length, /^keys has too many elements \(more than 10000\)/.test(String(t.error)), noEcho(t)])
        }
        assert.strict.deepEqual(r, Array.from({ length: 7 }, () => ['params', 0, true, true]))
        assert.strict.deepEqual(calls, [])
    })

    //---------- A7: 不可讀之設定 ----------
    it('A7 makeArrayCoverageValidator: contentFields、maxLengths給了而不可讀即throw(同indices, 組裝期fail fast; 不靜默放寬); 可讀而型別不符者照舊視為未給', function() {
        for (let k of ['contentFields', 'maxLengths']) {
            for (let v of [revoked(), revokedArr()]) {
                assert.throws(() => makeArrayCoverageValidator({ indices: [1], [k]: v }), TypeError)
            }
        }
        assert.strict.doesNotThrow(() => makeArrayCoverageValidator({ indices: [1], contentFields: 'x', maxLengths: 5 }))
        assert.strict.doesNotThrow(() => makeArrayCoverageValidator({ indices: [1], contentFields: undefined, maxLengths: null }))
    })

    it('A7 createAiCaller之callAI(prompt, o): 逐次設定o不可讀(S2)以params回報(不送出、不reject); 一般物件與非物件(視為未給)照舊(S1)', async function() {
        let caller = createAiCaller({ extraProviders: [{ id: 'ok:one', kind: 'claude', exe: fake.exe }], pick: ['ok:one'], catalogue: [] })
        let bad = [
            revoked(),
            {
                get validate() {
                    throw new Error('o boom')
                },
            },
        ]
        let r = []
        for (let o of bad) {
            let t = await caller.callAI('abc', o)
            r.push([t.ok, t.errorType, t.attempts, noEcho(t)])
        }
        assert.strict.deepEqual(r, bad.map(() => [false, 'params', 0, true]))
        let ok = []
        for (let o of [undefined, null, {}, 'x', 5]) {
            let t = await caller.callAI('abc', o)
            ok.push(t.ok)
        }
        assert.strict.deepEqual(ok, [true, true, true, true, true])
    })

})
